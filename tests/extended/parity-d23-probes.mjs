import { createParityReplayCollector } from '../../app/simulator/parity-replay-collector.js';
import { evaluateParityBalanceReplayYear } from '../../app/balance/parity-balance-replay.js';
import { runFixture, records, source } from './parity-replay-fixture.mjs';

function currentPersonalRun() {
    const collector = createParityReplayCollector({ source, initialRecords: records });
    const result = runFixture({ collector });
    return { result, log: collector.toLog() };
}
// D23 measurement paths adopted without fixture generation or filesystem writes.
import assert from 'node:assert/strict';
import { EngineAPI } from '../../engine/index.mjs';
import { buildBalanceEngineInputFromStorage } from '../../app/balance/balance-input-storage.js';
import { evaluateStoredAnnualHousehold } from '../../app/balance/balance-main-profilverbund.js';
import { evaluateAnnualDraft } from '../../app/balance/balance-annual-storage-commit.js';
import { computeAnnualPlanUpdate } from '../../app/balance/balance-annual-storage.js';
import { createManualAnnualQuote } from '../../app/balance/balance-annual-marketdata.js';
import { calculateHouseholdPensionForYear } from '../../app/simulator/simulator-household-pension.js';
import { resolveDynamicFlexRunnerHorizon } from '../../app/simulator/dynamic-flex-runner-horizon.js';
import { simulateOneYear } from '../../app/simulator/simulator-engine-direct.js';
import { buildCurrentYearMarketData } from '../../app/simulator/simulator-year-portfolio.js';
import { computeLiqNeedForFloor } from '../../app/simulator/simulator-engine-direct-utils.js';
import { deriveLiquidityRunwayPolicy } from '../../types/liquidity-runway-contract.js';
import { initializePortfolio } from '../../app/simulator/simulator-portfolio.js';
import { beginPersonalTaxYear, attributeSimulatorAction } from '../../app/simulator/simulator-personal-tax.js';
const copy = structuredClone;
const readOnly = records => ({ getItem: key => records[key] ?? null,
    setItem() { throw Error('READ_ONLY_STORAGE_WRITE'); },
    removeItem() { throw Error('READ_ONLY_STORAGE_DELETE'); } });
const engine = (input, state) => {
    const result = EngineAPI.simulateSingleYear(copy(input), copy(state));
    if (result.error) throw result.error;
    return result;
};
const sum = (items, field) => items.reduce((total, item) => total + (Number(item[field]) || 0), 0);
const action = a => ({ type: a.type, tax: a.steuer,
    sources: a.quellen.map(q => ({ owner: q.sourceProfileId ?? null, lot: q.trancheId ?? null,
        kind: q.kind, gross: q.brutto, net: q.netto ?? null, tax: q.steuer ?? null })),
    uses: a.verwendungen });
const decision = r => ({ withdrawal: r.ui.spending.monatlicheEntnahme * 12,
    flexRate: r.newState.flexRate, budget: r.newState.lastTotalBudget,
    market: r.ui.market.sKey, runway: r.ui.runway?.months ?? null,
    coverageAfter: r.ui.liquiditaet?.deckungNachher ?? null, action: action(r.ui.action) });

function annualDraft(f) {
    const marketData = { ...copy(f.annualMarketData),
        etf: createManualAnnualQuote(f.price, `calendar-year:${f.targetYear}`) };
    const bytes = JSON.stringify(f.records);
    const draft = computeAnnualPlanUpdate({ targetYear: f.targetYear, marketData,
        storage: readOnly(f.records), now: () => new Date('2027-01-02T12:00:00Z') });
    assert.equal(JSON.stringify(f.records), bytes, 'Annual update mutated source records');
    assert.equal(draft.status, 'prepared');
    return draft;
}

function balance(records, year) {
    const bytes = JSON.stringify(records);
    const calc = buildBalanceEngineInputFromStorage({ storage: readOnly(records), referenceYear: year });
    const runs = evaluateStoredAnnualHousehold(calc.inputData, calc.profiles, calc.engineLastState,
        { engineApi: EngineAPI, withdrawalMode: calc.householdPlan.entry.values.householdWithdrawalMode });
    assert.equal(JSON.stringify(records), bytes, 'Records were mutated');
    return { calc, runs, result: runs.householdResult };
}

function runSimulator(f) {
    let boundary;
    const result = simulateOneYear(copy(f.stateBefore), copy(f.inputs), copy(f.yearData), f.yearIndex,
        null, 0, null, 1, { ...EngineAPI, simulateSingleYear(input, state) {
            boundary = { input: copy(input), state: copy(state ?? null) };
            const result = EngineAPI.simulateSingleYear(input, state);
            boundary.realReturnEq = result.ui?.market?.realReturnEq;
            return result;
        } });
    assert.equal(result.kind, 'success');
    assert(Math.abs(result.logData.portfolio_flow_delta) <= 0.01, 'Unexpected FlowDelta');
    return { result, boundary };
}

export function measure(f) {
    switch (f.kind) {
    case 'reset': {
        const sim = engine(f.input, f.lastState);
        const prev = balance(f.previousRecords, f.planningYear);
        const current = balance(f.currentRecords, f.planningYear);
        return { simulator: decision(sim), balanceWithPreviousEvidence: decision(prev.result),
            balanceWithCurrentEvidence: decision(current.result),
            previousStateKeys: Object.keys(prev.calc.engineLastState || {}),
            currentStateKeys: Object.keys(current.calc.engineLastState || {}),
            deltaAnnual: prev.result.ui.spending.monatlicheEntnahme * 12 - sim.ui.spending.monatlicheEntnahme * 12 };
    }
    case 'household': {
        const b = balance(f.records, f.planningYear);
        const input = { ...f.input, simulationPeople: b.calc.profiles.map(profile => ({
            profileId: profile.profileId, name: profile.name, ...profile.inputs,
            taxState: profile.balanceState?.lastState?.taxState || { lossCarry: 0 } })) };
        const portfolio = initializePortfolio(input);
        beginPersonalTaxYear(portfolio);
        const sim = attributeSimulatorAction(portfolio, engine(f.input, f.lastState).ui.action, input);
        const sources = sim.quellen;
        return { simulator: { ...action(sim), uses: { liquiditaet: 0, gold: 0, aktien: 0, geldmarkt: 0, bonds: 0, ...sim.verwendungen } }, balance: action(b.result.ui.action),
            simulatorPersonalTax: sim.taxSettlements.map(row => ({ id: row.profileId, tax: row.taxDue, lossCarry: row.taxStateNext.lossCarry })),
            simulatorPersonalPayout: currentPersonalRun().result.rows[0].row.personalPayout.items.map(row => ({ id: row.profileId, withdrawal: row.amount })),
            balancePeople: b.runs.map(r => ({ id: r.profileId,
                withdrawal: r.ui.spending.monatlicheEntnahme * 12,
                tax: r.ui.action.steuer, lossCarry: r.newState.taxState.lossCarry })),
            deltaTax: b.result.ui.action.steuer - sim.steuer,
            deltaGross: sum(b.result.ui.action.quellen, 'brutto') - sum(sources, 'brutto') };
    }
    case 'horizon': return f.variants.map(v => {
        const resolved = resolveDynamicFlexRunnerHorizon(v.runnerInput, { yearIndex: 0 });
        assert(resolved.valid);
        const b = balance(v.records, f.planningYear);
        const sim = engine({ ...b.calc.engineInput, deferTaxSettlement: false,
            finalizeThreeBucketAction: false, horizonYears: resolved.horizonYears }, b.calc.engineLastState);
        return { preset: v.preset, simulatorHorizon: resolved.horizonYears,
            balanceHorizon: b.calc.engineInput.horizonYears,
            deltaHorizonYears: b.calc.engineInput.horizonYears - resolved.horizonYears,
            simulatorWithdrawal: sim.ui.spending.monatlicheEntnahme * 12,
            balanceWithdrawal: b.result.ui.spending.monatlicheEntnahme * 12,
            simulatorDynamicFlex: sim.ui.vpw.dynamicFlex, balanceDynamicFlex: b.result.ui.vpw.dynamicFlex,
            deltaDynamicFlex: b.result.ui.vpw.dynamicFlex - sim.ui.vpw.dynamicFlex,
            deltaAnnual: b.result.ui.spending.monatlicheEntnahme * 12 - sim.ui.spending.monatlicheEntnahme * 12 };
    });
    case 'three_bucket': {
        const { result: sim, boundary } = runSimulator(f);
        // Single-owner finalizer isolates the strategy from household attribution.
        const raw = EngineAPI.simulateSingleYear({ ...boundary.input, finalizeThreeBucketAction: true }, boundary.state);
        const error = raw.error ? { name: raw.error.name, context: raw.error.context } : null;
        const before = sim.logData.balance_trace.find(t => t.phase === 'after_buys');
        return { nominalReturn: f.yearData.rendite,
            simulatorRealReturn: boundary.realReturnEq,
            balanceRealReturn: (boundary.input.endeVJ / boundary.input.endeVJ_1 - 1) - f.yearData.inflation / 100,
            simulator: sim.logData.threeBucket,
            balance: raw.ui?.threeBucket ?? null, balanceError: error,
            simulatorPlannedAction: action(sim.ui.action.plannedActionFlow),
            balancePlannedAction: raw.ui ? action(raw.ui.action) : null,
            simulatorBondBeforePayout: before.bonds,
            simulatorBondAtEnd: sim.logData.bondBucketAfter,
            balanceBondAfterTransaction: raw.ui?.threeBucket?.bondBucketAfter ?? null,
            deltaBondAfterTransaction: raw.ui?.threeBucket ? raw.ui.threeBucket.bondBucketAfter - before.bonds : null,
            deltaBondAtEnd: raw.ui?.threeBucket ? raw.ui.threeBucket.bondBucketAfter - sim.logData.bondBucketAfter : null,
            flowDelta: sim.logData.portfolio_flow_delta,
            phases: sim.logData.balance_trace.map(t => ({ phase: t.phase, bonds: t.bonds, cash: t.cash })) };
    }
    case 'pension_rounding': {
        const sim = engine(f.input, f.lastState);
        const c = buildBalanceEngineInputFromStorage({ storage: readOnly(f.records), referenceYear: f.planningYear });
        const draft = { records: f.records, values: c.householdPlan.entry.values,
            scope: c.scope, planningYear: f.planningYear, ageByPerson: {} };
        const bytes = JSON.stringify(f.records);
        const b = evaluateAnnualDraft(draft, { engineApi: EngineAPI });
        assert.equal(JSON.stringify(f.records), bytes);
        const balanceAnnualPension = (b.monthlyBudget - b.outcome.monthlyWithdrawal) * 12;
        return { annualPension: c.inputData.renteMonatlich * 12,
            balanceAnnualPension,
            simulatorMonthlyBudget: sim.newState.lastTotalBudget / 12,
            balanceMonthlyBudget: b.monthlyBudget,
            deltaMonthly: b.monthlyBudget - sim.newState.lastTotalBudget / 12,
            deltaAnnualIncome: balanceAnnualPension - c.inputData.renteMonatlich * 12 };
    }
    case 'cash': {
        const { log } = currentPersonalRun();
        const year = log.years[1];
        const b = evaluateParityBalanceReplayYear(log, 1, { engineApi: EngineAPI });
        assert(b.householdResult);
        const pool = year.cashAndLots.pooledLiquidity;
        const components = b.calculation.inputData.tagesgeld + b.calculation.inputData.geldmarktEtf;
        const accounts = year.cashAndLots.cashOwnership.persons;
        const accountSum = accounts.reduce((sum, person) => sum + person.tagesgeld + person.geldmarktEtf, 0);
        return { historicalDeltaLiquidity: f.observed.deltaLiquidity, historicalDeltaRunway: f.observed.deltaRunway,
            simulatorPool: pool, componentSum: components,
            simulatorRunway: year.expectedDecision.ui.runway.months, componentRunway: b.householdResult.ui.runway.months,
            deltaLiquidity: components - pool,
            deltaRunway: b.householdResult.ui.runway.months - year.expectedDecision.ui.runway.months,
            personalAccountDelta: accountSum - pool, personalAccounts: accounts.map(person => person.profileId) };
    }
    case 'partner_pension': {
        const sim = calculateHouseholdPensionForYear(copy(f.pensionArgs));
        const b = buildBalanceEngineInputFromStorage({ storage: readOnly(f.records), referenceYear: f.planningYear });
        return { simulatorPension: sim.pensionAnnual,
            balancePension: b.inputData.renteMonatlich * 12,
            simulatorPartnerPension: sim.rente2, partnerGross: sim.rente2_brutto,
            deltaAnnualIncome: b.inputData.renteMonatlich * 12 - sim.pensionAnnual };
    }
    case 'ath': {
        const simMarket = buildCurrentYearMarketData(copy(f.marketArgs)).marketDataCurrentYear;
        const draft = annualDraft(f);
        const bInput = buildBalanceEngineInputFromStorage({ storage: readOnly(draft.records),
            referenceYear: f.targetYear + 1 }).inputData;
        const balMarket = Object.fromEntries(['endeVJ','endeVJ_1','endeVJ_2','endeVJ_3','ath','jahreSeitAth']
            .map(key => [key, bInput[key]]));
        const s = engine({ ...f.input, ...simMarket }, null);
        const b = engine({ ...f.input, ...balMarket }, null);
        return { simulatorAth: simMarket.ath, balanceAth: balMarket.ath,
            deltaAth: balMarket.ath - simMarket.ath,
            simulatorYearsSince: simMarket.jahreSeitAth, balanceYearsSince: balMarket.jahreSeitAth,
            deltaYearsSince: balMarket.jahreSeitAth - simMarket.jahreSeitAth,
            simulatorDistancePct: s.ui.market.abstandVomAthProzent,
            balanceDistancePct: b.ui.market.abstandVomAthProzent,
            simulatorMarket: s.ui.market.sKey, balanceMarket: b.ui.market.sKey,
            deltaAnnual: b.ui.spending.monatlicheEntnahme * 12 - s.ui.spending.monatlicheEntnahme * 12 };
    }
    case 'annual_rounding': {
        const draft = annualDraft(f);
        const b = buildBalanceEngineInputFromStorage({ storage: readOnly(draft.records),
            referenceYear: f.targetYear + 1 });
        const sim = runSimulator(f).result;
        return { simulatorNextFloor: sim.newState.baseFloor, balanceNextFloor: b.inputData.floorBedarf,
            deltaFloor: b.inputData.floorBedarf - sim.newState.baseFloor,
            simulatorNextMinimumFlex: sim.newState.baseMinimumFlexAnnual, balanceNextMinimumFlex: b.inputData.minimumFlexAnnual,
            deltaMinimumFlex: b.inputData.minimumFlexAnnual - sim.newState.baseMinimumFlexAnnual,
            simulatorInflation: f.yearData.inflation, balanceInflation: b.inputData.inflation,
            deltaInflationPctPoints: b.inputData.inflation - f.yearData.inflation,
            simulatorCape: f.yearData.capeRatio, balanceCape: b.inputData.capeRatio,
            deltaCape: b.inputData.capeRatio - f.yearData.capeRatio,
            simulatorEndPrice: f.price, balanceEndPrice: b.inputData.endeVJ,
            deltaEndPrice: b.inputData.endeVJ - f.price };
    }
    case 'liquidity_plan': return f.years.map(years => {
        const policy = deriveLiquidityRunwayPolicy(years);
        const input = { ...f.input, liquidityRunwayYears: years };
        const r = engine(input, null);
        return { years, targetMonths: policy.targetMonths, hardMinimumMonths: policy.hardMinimumMonths,
            simulatorFloorNeed: computeLiqNeedForFloor({ inputs: input, inflatedFloor: f.netFloor }),
            engineHardMinimumMonths: r.ui.runway.hardMinimumMonths ?? r.diagnosis.keyParams.minimumFlexEmergencyMinRunwayMonths,
            minimumFlexRunway: r.diagnosis.keyParams.minimumFlexEmergencyMinRunwayMonths };
    });
    default: throw Error(`Unknown fixture kind: ${f.kind}`);
    }
}

export function checkObserved(actual, expected, at = '') {
    if (typeof expected === 'number') {
        assert(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-9,
            `${at}: ${actual} != ${expected}`);
    } else if (expected && typeof expected === 'object') {
        assert(actual && typeof actual === 'object', at);
        assert.deepEqual(Object.keys(actual), Object.keys(expected), at);
        for (const key of Object.keys(expected)) checkObserved(actual[key], expected[key], `${at}/${key}`);
    } else assert.equal(actual, expected, at);
}
