import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { applyBondRefillPostprocessing } from '../app/simulator/simulator-bond-refill.js';
import { buildTaxRawAggregate } from '../app/simulator/simulator-tax-recompute.js';
import { sumDepot } from '../app/simulator/simulator-portfolio.js';
import { settleTaxYear } from '../engine/tax-settlement.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { calculateRealEquityReturn, finalizeThreeBucketAction } from '../engine/transactions/three-bucket-logic.mjs';
import { readFileSync } from 'node:fs';
import { buildDetailedTranchesFromPortfolio } from '../app/simulator/simulator-engine-direct-utils.js';

console.log('--- 3-Bucket Refill Tests ---');

function createMockEngine({ spending, action, marketSKey = 'hot_neutral' }) {
    return {
        simulateSingleYear(engineInput, lastState) {
            const taxRawAggregate = action?.taxRawAggregate
                || { sumRealizedGainSigned: 0, sumTaxableAfterTqfSigned: 0 };
            const taxSettlement = settleTaxYear({
                taxStatePrev: lastState?.taxState,
                rawAggregate: taxRawAggregate,
                sparerPauschbetrag: engineInput?.sparerPauschbetrag,
                kirchensteuerSatz: engineInput?.kirchensteuerSatz
            });
            return {
                ui: {
                    spending: {
                        monatlicheEntnahme: spending?.monatlicheEntnahme ?? 0,
                        kuerzungProzent: 0,
                        kuerzungQuelle: 'none',
                        details: {}
                    },
                    action: {
                        type: action?.type || 'NONE',
                        quellen: action?.quellen || [],
                        nettoErlös: action?.nettoErlös || 0,
                        steuer: action?.steuer || 0,
                        verwendungen: action?.verwendungen || { gold: 0, aktien: 0 },
                        taxRawAggregate,
                        taxSettlement: taxSettlement.details
                    },
                    market: { sKey: marketSKey, szenarioText: marketSKey },
                    zielLiquiditaet: 0,
                    liquiditaet: { deckungNachher: 100 },
                    runway: { months: 36 },
                    vpw: null
                },
                newState: {
                    alarmActive: false,
                    lastMarketSKey: marketSKey,
                    cumulativeInflationFactor: 1,
                    taxState: taxSettlement.taxStateNext
                }
            };
        }
    };
}

function baseInputs(overrides = {}) {
    return {
        startAlter: 65,
        renteStartOffsetJahre: 0,
        partner: { aktiv: false },
        rentAdjPct: 0,
        startFloorBedarf: 24000,
        startFlexBedarf: 0,
        flexBudgetAnnual: 0,
        flexBudgetYears: 0,
        flexBudgetRecharge: 0,
        targetEq: 60,
        runwayTargetMonths: 36,
        runwayMinMonths: 24,
        rebalBand: 5,
        maxSkimPctOfEq: 10,
        maxBearRefillPctOfEq: 5,
        rebalancingBand: 25,
        goldAktiv: false,
        goldZielProzent: 0,
        goldFloorProzent: 0,
        risikoprofil: 'sicherheits-dynamisch',
        startSPB: 1000,
        kirchensteuerSatz: 0,
        marketCapeRatio: 25,
        decumulation: {
            mode: '3_bucket_jilge',
            bondTargetFactor: 5,
            drawdownTrigger: 15,
            bondRefillThreshold: null
        },
        ...overrides
    };
}

function baseState(portfolio) {
    return {
        portfolio,
        baseFloor: 24000,
        baseFlex: 0,
        baseFlexBudgetAnnual: 0,
        baseFlexBudgetRecharge: 0,
        lastState: null,
        currentAnnualPension: 0,
        currentAnnualPension2: 0,
        marketDataHist: {
            endeVJ: 100,
            endeVJ_1: 100,
            endeVJ_2: 100,
            endeVJ_3: 100,
            ath: 100,
            jahreSeitAth: 0,
            capeRatio: 25,
            inflation: 2
        },
        widowPensionP1: 0,
        widowPensionP2: 0
    };
}

{
    const portfolio = {
        depotTranchesAktien: [
            { type: 'aktien_neu', category: 'equity', marketValue: 150000, costBasis: 150000, tqf: 0.3 }
        ],
        depotTranchesGold: [],
        depotTranchesGeldmarkt: [],
        liquiditaet: 0
    };
    const combinedTaxRawAggregate = buildTaxRawAggregate();
    const refill = applyBondRefillPostprocessing({
        is3Bucket: true,
        isBadYear: false,
        threeBucketInput: { bondTargetFactor: 5, bondRefillThresholdPct: null },
        jahresEntnahmeTarget: 12000,
        netFloorYear: 12000,
        portfolio,
        depotTranchesAktien: portfolio.depotTranchesAktien,
        engineInput: {
            sparerPauschbetrag: 0,
            kirchensteuerSatz: 0,
            goldAktiv: false,
            depotwertAlt: 0,
            depotwertNeu: 150000,
            goldWert: 0
        },
        market: { sKey: 'hot_neutral' },
        combinedTaxRawAggregate
    });
    const autoBond = portfolio.depotTranchesAktien.find(t => t.isin === 'BOND_BUCKET_AUTO');
    const equity = portfolio.depotTranchesAktien.find(t => t.category === 'equity');
    assert(autoBond, 'direct refill should create bond tranche');
    assertClose(autoBond.marketValue, refill.bondRefillNetDelta, 1e-6, 'direct refill should add net amount to bond market value');
    assertClose(autoBond.costBasis, autoBond.marketValue, 1e-6, 'direct refill should add net amount to bond cost basis');
    assert(equity.marketValue < 150000, 'direct refill should sell equity');
    assert(refill.didForcedSale === true, 'direct refill should request tax recompute');
}

{
    const portfolio = {
        depotTranchesAktien: [
            { type: 'aktien_neu', category: 'equity', marketValue: 200000, costBasis: 150000, tqf: 0.3 }
        ],
        depotTranchesGold: [],
        depotTranchesGeldmarkt: [],
        liquiditaet: 0
    };
    const beforeTotal = sumDepot({ depotTranchesAktien: portfolio.depotTranchesAktien });
    const combinedTaxRawAggregate = buildTaxRawAggregate();
    const refill = applyBondRefillPostprocessing({
        is3Bucket: true,
        isBadYear: false,
        threeBucketInput: { bondTargetFactor: 5, bondRefillThresholdPct: null },
        jahresEntnahmeTarget: 12000,
        netFloorYear: 12000,
        portfolio,
        depotTranchesAktien: portfolio.depotTranchesAktien,
        engineInput: {
            sparerPauschbetrag: 0,
            kirchensteuerSatz: 0,
            goldAktiv: false,
            depotwertAlt: 0,
            depotwertNeu: 200000,
            goldWert: 0
        },
        market: { sKey: 'hot_neutral' },
        combinedTaxRawAggregate
    });
    const afterTotal = sumDepot({ depotTranchesAktien: portfolio.depotTranchesAktien });
    const equity = portfolio.depotTranchesAktien.find(t => t.category === 'equity');
    assert(refill.bondRefillNetDelta > 0, 'Canonical equity refill should execute');
    assert(equity.marketValue < 200000, 'Canonical equity should be reduced by bond refill sale');
    assertClose(afterTotal, beforeTotal - refill.bondRefillTaxDelta, 1e-6, 'Equity bond refill should conserve wealth apart from tax');
}

{
    const portfolio = {
        depotTranchesAktien: [
            { type: 'aktien_neu', category: 'equity', marketValue: 200000, costBasis: 150000, tqf: 0.3 }
        ],
        depotTranchesGold: [],
        depotTranchesGeldmarkt: [],
        liquiditaet: 0
    };
    const beforeTotal = sumDepot({ depotTranchesAktien: portfolio.depotTranchesAktien });
    const combinedTaxRawAggregate = buildTaxRawAggregate();
    const refill = applyBondRefillPostprocessing({
        is3Bucket: true,
        isBadYear: false,
        threeBucketInput: { bondTargetFactor: 5, bondRefillThresholdPct: null },
        jahresEntnahmeTarget: 12000,
        netFloorYear: 12000,
        portfolio,
        depotTranchesAktien: portfolio.depotTranchesAktien,
        engineInput: {
            sparerPauschbetrag: 0,
            kirchensteuerSatz: 0,
            goldAktiv: false,
            depotwertAlt: 0,
            depotwertNeu: 200000,
            goldWert: 0
        },
        market: { sKey: 'hot_neutral' },
        combinedTaxRawAggregate
    });
    const afterTotal = sumDepot({ depotTranchesAktien: portfolio.depotTranchesAktien });
    const equity = portfolio.depotTranchesAktien.find(t => t.category === 'equity');
    assert(refill.bondRefillNetDelta > 0, 'Canonical category-equity refill should execute');
    assert(equity.marketValue < 200000, 'Canonical category-equity sale should reduce the equity lot');
    assertClose(afterTotal, beforeTotal - refill.bondRefillTaxDelta, 1e-6, 'Canonical equity bond refill should conserve wealth apart from tax');
}

{
    const state = baseState({
        depotTranchesAktien: [
            {
                trancheId: 'eq-bad-year',
                type: 'aktien_neu',
                category: 'equity',
                marketValue: 100000,
                costBasis: 100000,
                tqf: 0.3,
                taxExempt: false
            },
            {
                trancheId: 'bond-bad-year',
                type: 'anleihe',
                category: 'bonds',
                marketValue: 20000,
                costBasis: 20000,
                tqf: 0.0,
                taxExempt: false
            }
        ],
        depotTranchesGold: [],
        depotTranchesGeldmarkt: [],
        liquiditaet: 50000,
        tagesgeld: 50000,
        geldmarktEtf: 0
    });
    const inputs = baseInputs();
    const engine = createMockEngine({
        spending: { monatlicheEntnahme: 0 },
        action: {
            type: 'TRANSACTION',
            quellen: [{
                kind: 'aktien_neu',
                trancheId: 'eq-bad-year',
                brutto: 10000,
                steuer: 0,
                netto: 10000,
                realizedGainSigned: -4285.714285714286,
                taxableAfterTqfSigned: -3000
            }],
            nettoErlös: 10000,
            steuer: 0,
            verwendungen: { liquiditaet: 10000, gold: 0, aktien: 0 },
            taxRawAggregate: {
                sumRealizedGainSigned: -4285.714285714286,
                sumTaxableAfterTqfSigned: -3000
            }
        }
    });
    const yearData = { rendite: -0.3, gold_eur_perf: 0, zinssatz: 0, inflation: 2, jahr: 2008 };
    const result = simulateOneYear(state, inputs, yearData, 0, null, 0, null, 1, engine);

    const afterEquity = result.newState.portfolio.depotTranchesAktien.find(t => t.type === 'aktien_neu');
    const afterBond = result.newState.portfolio.depotTranchesAktien.find(t => t.type === 'anleihe');
    assertClose(afterEquity.marketValue, 70000, 1e-6, 'bad year must not sell equity tranches in 3-bucket mode');
    assert(afterBond.marketValue < 20400, 'bad year should route sales into bond bucket');
    assert(result.logData.threeBucket.isBadYear === true, 'bad year marker should be logged');
    assert(result.logData.threeBucket.bondSaleAmount > 0, 'bond sale amount should be logged in bad year');
    assert(result.logData.threeBucket.equityPreserved >= 10000, 'blocked equity sale should be tracked as preserved');
    assert(result.ui.action.taxSettlement.recomputedAfterActionTransform === true,
        'bad-year 3-bucket replacement must centrally settle the transformed action');
    assertClose(result.newState.lastState.taxState.lossCarry, 0, 1e-9,
        'final bond-sale aggregate must replace the blocked equity-loss aggregate in tax state');
    const executedTaxContract = result.ui.action.taxSettlement.executedTaxContract;
    const plannedSourceTax = result.ui.action.plannedActionFlow.quellen.reduce(
        (total, source) => total + source.steuer,
        0
    );
    assert(executedTaxContract.schemaVersion === 'SimulatorExecutedTaxContractV1',
        'post-execution action must expose its versioned annual-tax reconciliation');
    assert(executedTaxContract.status === 'reconciled',
        'post-execution action must report a reconciled reserve-to-settlement contract');
    assertClose(plannedSourceTax, result.ui.action.plannedActionFlow.steuer, 1e-9,
        'nested pre-execution plan must retain source/action tax consistency');
    assertClose(executedTaxContract.finalAnnualTax, result.ui.action.steuer, 1e-9,
        'legacy top-level action tax must be identified and reconciled as final annual tax');
    assertClose(
        executedTaxContract.rawTaxCashAdjustment,
        executedTaxContract.taxReservedTotal - executedTaxContract.finalAnnualTax,
        1e-9,
        'executed contract must explain the reserve-to-final-tax cash adjustment'
    );
}

{
    const state = baseState({
        depotTranchesAktien: [
            { type: 'aktien_neu', category: 'equity', marketValue: 150000, costBasis: 150000, tqf: 0.3 }
        ],
        depotTranchesGold: [],
        depotTranchesGeldmarkt: [],
        liquiditaet: 40000,
        tagesgeld: 40000,
        geldmarktEtf: 0
    });
    const inputs = baseInputs();
    const engine = createMockEngine({
        spending: { monatlicheEntnahme: 1000 },
        action: { type: 'NONE', quellen: [], nettoErlös: 0, steuer: 0 }
    });
    const yearData = { rendite: 0.1, gold_eur_perf: 0, zinssatz: 0, inflation: 2, jahr: 2010 };
    const result = simulateOneYear(state, inputs, yearData, 0, null, 0, null, 1, engine);
    const autoBond = result.newState.portfolio.depotTranchesAktien.find(t => t.isin === 'BOND_BUCKET_AUTO');
    assert(autoBond, 'good year refill should auto-create bond tranche if missing');
    assert(autoBond.marketValue > 0, 'auto-created bond tranche should be refilled');
    assertClose(autoBond.costBasis, autoBond.marketValue, 1e-6, 'bond refill must increase marketValue and costBasis equally');
    assert(result.logData.threeBucket.bondRefillNet > 0, 'bond refill net amount should be logged');
}

{
    const state = baseState({
        depotTranchesAktien: [
            { type: 'aktien_neu', category: 'equity', marketValue: 100000, costBasis: 100000, tqf: 0.3 },
            { type: 'anleihe', category: 'bonds', marketValue: 10000, costBasis: 10000, tqf: 0.0 }
        ],
        depotTranchesGold: [],
        depotTranchesGeldmarkt: [],
        liquiditaet: 30000,
        tagesgeld: 30000,
        geldmarktEtf: 0
    });
    const inputs = baseInputs({
        decumulation: {
            mode: '3_bucket_jilge',
            bondTargetFactor: 0,
            drawdownTrigger: 80,
            bondRefillThreshold: null
        }
    });
    const engine = createMockEngine({
        spending: { monatlicheEntnahme: 0 },
        action: { type: 'NONE', quellen: [], nettoErlös: 0, steuer: 0 }
    });
    const yearData = { rendite: -0.3, gold_eur_perf: 0, zinssatz: 3, inflation: 2, jahr: 2015 };
    const result = simulateOneYear(state, inputs, yearData, 0, null, 0, null, 1, engine);
    const bond = result.newState.portfolio.depotTranchesAktien.find(t => t.type === 'anleihe');
    const equity = result.newState.portfolio.depotTranchesAktien.find(t => t.type === 'aktien_neu');
    assertClose(bond.marketValue, 10300, 1e-6, 'bond tranche must use yearData zinssatz return');
    assertClose(equity.marketValue, 70000, 1e-6, 'equity tranche must still use market return');
}

{
    const state = baseState({
        depotTranchesAktien: [
            {
                trancheId: 'eq-standard-sale',
                type: 'aktien_neu',
                category: 'equity',
                marketValue: 200000,
                costBasis: 200000,
                tqf: 0.3,
                taxExempt: false
            },
            {
                trancheId: 'bond-standard-sale',
                type: 'anleihe',
                category: 'bonds',
                marketValue: 50000,
                costBasis: 50000,
                tqf: 0.0,
                taxExempt: false
            }
        ],
        depotTranchesGold: [],
        depotTranchesGeldmarkt: [],
        liquiditaet: 100000,
        tagesgeld: 100000,
        geldmarktEtf: 0
    });
    const inputs = baseInputs({
        decumulation: {
            mode: '3_bucket_jilge',
            bondTargetFactor: 0,
            drawdownTrigger: 80,
            bondRefillThreshold: null
        }
    });
    const engine = createMockEngine({
        spending: { monatlicheEntnahme: 0 },
        action: {
            type: 'TRANSACTION',
            quellen: [{
                kind: 'aktien_neu',
                trancheId: 'eq-standard-sale',
                brutto: 50000,
                steuer: 0,
                netto: 50000,
                realizedGainSigned: 0,
                taxableAfterTqfSigned: 0
            }],
            nettoErlös: 50000,
            steuer: 0,
            verwendungen: { liquiditaet: 50000, gold: 0, aktien: 0 },
            taxRawAggregate: {
                sumRealizedGainSigned: 0,
                sumTaxableAfterTqfSigned: 0
            }
        }
    });
    const yearData = { rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, jahr: 2021 };
    const result = simulateOneYear(state, inputs, yearData, 0, null, 0, null, 1, engine);
    const bond = result.newState.portfolio.depotTranchesAktien.find(t => t.category === 'bonds');
    const equity = result.newState.portfolio.depotTranchesAktien.find(t => t.category === 'equity');
    assertClose(bond.marketValue, 50000, 1e-6, 'equity transaction must not sell canonical bond tranche');
    assertClose(equity.marketValue, 150000, 1e-6, 'equity transaction should reduce equity tranche only');
    assertClose(result.logData.portfolio_total_end, 326000, 1e-6, 'asset sale should conserve total wealth apart from floor payout');
}

// FR-8/FR-9 and the historical reserve failure run through the production entry.
for (const id of ['4-drei-toepfe-rendite', '5-drei-toepfe-phase', '11-drei-toepfe-steuerreserve']) {
    const fixture = JSON.parse(readFileSync(new URL(`extended/fixtures/parity-d23/${id}.json`, import.meta.url)));
    const before = JSON.stringify(fixture);
    let boundary;
    let calls = 0;
    const result = simulateOneYear(structuredClone(fixture.stateBefore), structuredClone(fixture.inputs),
        fixture.yearData, 0, null, 0, null, 1, { ...EngineAPI, simulateSingleYear(input, state) {
            calls++;
            boundary = EngineAPI.simulateSingleYear(input, state);
            return boundary;
        } });
    assertEqual(result.kind, 'success', `${id}: no engine or reserve error`);
    assertEqual(calls, 1, `${id}: one annual engine call`);
    const plan = result.ui.action.plannedActionFlow;
    assertEqual(JSON.stringify(plan.quellen), JSON.stringify(boundary.ui.action.quellen), `${id}: no second sale plan`);
    assertClose(result.logData.portfolio_flow_delta, 0, 0.01, `${id}: payout flow conserves wealth`);
    const trace = result.logData.balance_trace;
    assertEqual(trace.some(row => row.phase === 'after_bond_refill'), false, `${id}: no late refill`);
    assertClose(trace.find(row => row.phase === 'after_buys').bonds, id.startsWith('4-') ? 0 : 150000,
        0.01, `${id}: complete bond inventory before payout`);
    const nextInventory = buildDetailedTranchesFromPortfolio(result.newState.portfolio);
    assertClose(nextInventory.filter(lot => lot.category === 'bonds').reduce((sum, lot) => sum + lot.marketValue, 0),
        result.logData.bondBucketAfter, 0.01, `${id}: refilled bonds remain available for the next year`);
    const start = trace[0].total;
    const end = trace.at(-1).total;
    assertClose(start - end, result.logData.entnahme_effektiv + result.logData.steuern_gesamt,
        0.01, `${id}: complete annual wealth loss equals payout plus tax`);
    const settlement = settleTaxYear({ rawAggregate: plan.taxRawAggregate, sparerPauschbetrag: 2000, kirchensteuerSatz: 0 });
    assertClose(plan.steuer, settlement.taxDue, 0.01, `${id}: combined sales share one allowance`);
    assertEqual(JSON.stringify(fixture), before, `${id}: old evidence stays readable and unchanged`);
}

{
    const inputs = { ...baseInputs(), floorBedarf: 10000, renteAktiv: false, sparerPauschbetrag: 0 };
    const tranches = [
        { trancheId: 'guard-equity', type: 'aktien_neu', category: 'equity', marketValue: 30000, costBasis: 0, tqf: 0, taxExempt: false },
        { trancheId: 'guard-bond', type: 'anleihe', category: 'bonds', marketValue: 50000, costBasis: 50000, tqf: 0, taxExempt: false }
    ];
    const pendingAction = { type: 'TRANSACTION', nettoErlös: 50000, steuer: 0,
        quellen: [{ kind: 'anleihe', category: 'bonds', trancheId: 'guard-bond', brutto: 50000, netto: 50000, steuer: 0 }],
        verwendungen: { liquiditaet: 50000 },
        taxRawAggregate: { sumRealizedGainSigned: 0, sumTaxableAfterTqfSigned: 0 } };
    const finalized = finalizeThreeBucketAction({ detailedTranches: tranches, engineInput: inputs,
        market: { sKey: 'peak_stable' }, pendingAction, realReturnEq: 0,
        annualWithdrawalTarget: 10000, currentBondValuation: 50000 });
    assertClose(finalized.threeBucketState.bondRefillGross, 20000, 0.01, 'Taxable refill preserves the 10,000 EUR equity guard in gross terms');
    assertClose(finalized.threeBucketState.bondBucketAfter, 14725, 0.01, 'Limited inventory produces only funded bond purchases');
    assertClose(finalized.updatedAction.steuer, 5275, 0.01, 'Limited refill reserves its full tax');
    assertClose(calculateRealEquityReturn(-14, 5), -0.19, 1e-12, 'Shared signal subtracts inflation');
    const atTrigger = finalizeThreeBucketAction({ detailedTranches: tranches, engineInput: inputs,
        market: { sKey: 'peak_stable' }, pendingAction, realReturnEq: calculateRealEquityReturn(-10, 5),
        annualWithdrawalTarget: 10000, currentBondValuation: 50000 });
    assertEqual(atTrigger.threeBucketState.isBadYear, false, 'Exact trigger remains a strict less-than boundary');
}

console.log('✅ 3-Bucket refill tests passed');
