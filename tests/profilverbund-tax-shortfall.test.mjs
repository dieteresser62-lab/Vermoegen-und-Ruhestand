import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { normalizeWidowOptions } from '../app/simulator/simulator-sweep-utils.js';
import { EngineAPI } from '../engine/index.mjs';
import { attributeHouseholdAction, calculateActionLiquidityDelta } from '../app/profile/profilverbund-action-attribution.js';
import { resolvePlannedAction } from '../types/planned-action-contract.js';
import { settleTaxYear } from '../engine/tax-settlement.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { buildMonteCarloRuinLogRow } from '../app/simulator/mc-log-builder.js';
import { runFixture } from './extended/parity-replay-fixture.mjs';

const records = createMusterHaushaltRecords('2026-10-16');
const balance = buildBalanceEngineInputFromStorage({ referenceYear: 2026,
    storage: { getItem: key => records[key] ?? null } });
const planValues = balance.householdPlan.entry.values;
const profiles = Object.entries(JSON.parse(records.rs_profiles_v1).profiles).map(([profileId, entry]) => ({
    profileId, name: entry.meta.name,
    inputs: buildSimulatorInputsFromProfileData(entry.data, { referenceYear: 2026, planValues })
}));
const base = combineSimulatorProfiles(profiles, records.rs_current_profile, { planValues }).combined;
// The fresh Simulator form keeps care enabled, with these default costs.
// Profile aggregation replaces the portfolio/person/plan fields, not care inputs.
const care = { pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch',
    pflegeGradeConfigs: Object.fromEntries([
        [1, 6000, .75, 0], [2, 12000, .25, 0], [3, 18000, .1, 3], [4, 32000, 0, 5], [5, 60000, 0, 5]
    ].map(([grade, zusatz, flexCut, mortalityFactor]) => [grade, { zusatz, flexCut, mortalityFactor }])),
    pflegeStufe1Zusatz: 6000, pflegeStufe1FlexCut: .75, pflegeMaxFloor: 120000,
    pflegeRampUp: 5, pflegeMinDauer: 5, pflegeMaxDauer: 10, pflegeKostenDrift: .035, pflegeRegionalZuschlag: 0 };
const unchanged = JSON.stringify({ records, base });
for (const preset of ['off', 'konservativ', 'ausgewogen', 'offensiv']) for (const pathIndex of [186, 693]) {
    const inputs = { ...structuredClone(base), ...care, ...dynamicFlexPresetPatch(preset), stressPreset: 'NONE' };
    const result = await runMonteCarloChunk({ inputs,
        monteCarloParams: { anzahl: 10000, maxDauer: 35, methode: 'regime_markov', seed: 12345 },
        runRange: { start: pathIndex, count: 1 }, logIndices: [pathIndex], useCapeSampling: false,
        widowOptions: normalizeWidowOptions(inputs.widowOptions), engine: EngineAPI });
    assertEqual(result.financialMetricsValid, true, `${preset}: path ${pathIndex} remains evaluable`);
    assertEqual(result.technicalInventory.technicalError, 0, `${preset}: no technical failure`);
    assertEqual(result.technicalInventory.financiallyEvaluable, 1, `${preset}: path counted`);
    if (pathIndex === 186 && ['ausgewogen', 'offensiv'].includes(preset)) {
        const log = result.runMeta[0].logDataRows;
        assert(log.some(row => row.aktionUndGrund?.includes('Profilsteuern:')), `${preset}: scenario explains extra funding`);
    }
}
assertEqual(JSON.stringify({ records, base }), unchanged, 'Muster records and source inputs remain unchanged');

// Small depleted-depot cases use the Muster lot's ownership/tax contract.
const lot = (profileId, value, category = 'equity') => ({ ...structuredClone(base.detailledTranches[0]),
    sourceProfileId: profileId, trancheId: `${category}-lot`, category,
    type: category === 'gold' ? 'gold' : 'aktien_neu', taxExempt: category === 'gold',
    tqf: category === 'gold' ? 0 : .3, shares: value, currentPrice: 1, purchasePrice: 0,
    marketValue: value, costBasis: 0 });
function depletedProfiles(cashOwner = null, extraOwner = null, extraCategory = 'gold') {
    return ['a', 'b'].map(profileId => ({ profileId, hasExplicitTrancheOverride: true,
        inputs: { tagesgeld: profileId === cashOwner ? 1000 : 0, geldmarktEtf: 0,
            sparerPauschbetrag: 1000, kirchensteuerSatz: 0 },
        balanceState: { lastState: { taxState: { lossCarry: 0 } } },
        tranches: [...(profileId === 'b' ? [lot('b', 5000)] : []),
            ...(profileId === extraOwner ? [lot(profileId, 1000, extraCategory)] : [])] }));
}
const exhaustedAction = { type: 'TRANSACTION', quellen: [{ kind: 'aktien_neu', category: 'equity',
    trancheId: 'b:equity-lot', sourceProfileId: 'b', brutto: 5000, steuer: 395.625, netto: 4604.375,
    tqf: .3, realizedGainSigned: 5000, taxableAfterTqfSigned: 3500 }],
    verwendungen: { liquiditaet: 4604.375 } };
function checkAction(result, people, label) {
    // Same removal of the unused legacy money-market use as the simulator adapter.
    const action = { ...result.finalAction, verwendungen: Object.fromEntries(
        Object.entries(result.finalAction.verwendungen).filter(([key, value]) => key !== 'geldmarkt' || value !== 0)) };
    const resolution = resolvePlannedAction({ action,
        availableLiquidity: people.reduce((sum, p) => sum + p.inputs.tagesgeld, 0) });
    assertEqual(resolution.status, 'resolved', `${label}: valid sources, taxes and uses (${JSON.stringify(resolution.context)})`);
    for (const settlement of result.settlements) {
        const person = people.find(p => p.profileId === settlement.profileId);
        const tax = settleTaxYear({ rawAggregate: settlement.rawAggregate, sparerPauschbetrag: person.inputs.sparerPauschbetrag,
            kirchensteuerSatz: person.inputs.kirchensteuerSatz, taxStatePrev: person.balanceState.lastState.taxState });
        assertClose(settlement.taxDue, tax.taxDue, 1e-8, `${label}: personal tax stays exact`);
        for (const source of settlement.sources.filter(s => s.kind !== 'liquiditaet')) {
            const owned = person.tranches.find(t => `${person.profileId}:${t.trancheId}` === source.trancheId);
            assert(source.brutto <= owned.marketValue + 1e-8, `${label}: sale stays within owned lot`);
        }
    }
}
for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
    for (const cashOwner of ['a', 'b']) {
        const people = depletedProfiles(cashOwner);
        const result = attributeHouseholdAction({ householdAction: exhaustedAction, profiles: people, mode });
        checkAction(result, people, `${mode}/${cashOwner} cash`);
        assertClose(result.finalAction.personalTaxFunding.cash, 263.75, 1e-8, 'Own or partner cash covers the full tax gap');
        assertClose(calculateActionLiquidityDelta(result.finalAction), 4340.625, 1e-8, 'Existing cash never creates a fictitious inflow');
        assertEqual(result.finalAction.personalTaxFunding.shortfall, 0, 'Cash prevents shortfall');
    }
    for (const extraCategory of ['gold', 'equity']) {
        const people = depletedProfiles(null, 'a', extraCategory);
        const result = attributeHouseholdAction({ householdAction: exhaustedAction, profiles: people, mode });
        checkAction(result, people, `${mode}/${extraCategory} sale`);
        assertClose(result.finalAction.nettoErlös, 4604.375, 1e-8, 'Remaining household lots cover the intended use including their tax');
        assertEqual(result.finalAction.personalTaxFunding?.shortfall || 0, 0, 'Additional sale prevents shortfall');
    }
    const cappedPeople = depletedProfiles(null, 'a', 'equity');
    cappedPeople[1].tranches.push(lot('b', 100, 'gold'));
    const cappedAction = { ...exhaustedAction,
        quellen: [...exhaustedAction.quellen, { kind: 'gold', category: 'gold', trancheId: 'b:gold-lot',
            sourceProfileId: 'b', brutto: 100, netto: 100, steuer: 0, tqf: 0, taxExempt: true,
            realizedGainSigned: 100, taxableAfterTqfSigned: 0 }], verwendungen: { liquiditaet: 4704.375 } };
    const capped = attributeHouseholdAction({ householdAction: cappedAction, profiles: cappedPeople, mode });
    checkAction(capped, cappedPeople, `${mode}/bucket cap`);
    assertClose(capped.finalAction.nettoErlös, 4704.375, 1e-8, 'Exhausted gold bucket does not cap remaining equity');
    assert(capped.finalAction.personalTaxFunding.gap > 0, 'Bucket cap exercises the additional funding path');
    const purchasePeople = depletedProfiles('a');
    const purchase = attributeHouseholdAction({ profiles: purchasePeople, mode,
        householdAction: { ...exhaustedAction, verwendungen: { aktien: 4604.375 } } });
    checkAction(purchase, purchasePeople, `${mode}/purchase`);
    assertClose(purchase.finalAction.quellen.find(source => source.kind === 'liquiditaet').brutto,
        263.75, 1e-8, 'Partner Tagesgeld actually funds the purchase gap');
    const people = depletedProfiles();
    const result = attributeHouseholdAction({ householdAction: exhaustedAction, profiles: people, mode });
    checkAction(result, people, `${mode}/exhausted`);
    assertClose(result.finalAction.personalTaxFunding.shortfall, 263.75, 1e-8, 'Exhausted household reports the remaining gap');
    assertClose(result.finalAction.verwendungen.liquiditaet, 4340.625, 1e-8, 'Engine capped-use reconciliation limits the top-up');
}

for (const cash of [1000, 263.71]) {
    const people = depletedProfiles('a');
    people[0].inputs.tagesgeld = cash;
    people[1].balanceState.lastState.taxState.lossCarry = .1234;
    const result = attributeHouseholdAction({ profiles: people, householdAction: exhaustedAction });
    checkAction(result, people, `Unrounded tax/${cash}`);
    assertClose(result.finalAction.nettoErlös, result.finalAction.verwendungen.liquiditaet, 1e-8,
        'Fractional-cent tax and a sub-cent residual never break the action-flow contract');
}

const scarce = { ...structuredClone(base), dynamicFlex: false, pflegefallLogikAktivieren: false,
    startVermoegen: 50000, depotwertAlt: 0, depotwertNeu: 50000, einstandAlt: 0, tagesgeld: 0, geldmarktEtf: 0,
    simulationSourceProfileId: 'a', simulationPeople: ['a', 'b'].map(profileId => ({ profileId,
        tagesgeld: 0, sparerPauschbetrag: 1000, kirchensteuerSatz: 0, taxState: { lossCarry: 0 } })),
    detailledTranches: [{ ...lot('b', 50000), purchasePrice: .1, costBasis: 5000 }],
    startFloorBedarf: 50000, startFlexBedarf: 0, minimumFlexAnnual: 0,
    renteMonatlich: 0, partner: { aktiv: false }, goldStrategyDiagnostics: undefined };
const year = { jahr: 2000, rendite: -.4, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0 };
const ruined = simulateOneYear(initMcRunState(scarce, 100), scarce, year, 0, null, 0, null, 1, EngineAPI);
assertEqual(ruined.kind, 'ruin', 'Unfunded floor uses ordinary financial ruin');
assert(ruined.reason.includes('Profilsteuern:'), `Financial ruin explains the personal tax funding limit (${ruined.reason})`);
const ruinRow = buildMonteCarloRuinLogRow({ result: ruined, simulationsJahr: 0, yearData: year, inputs: scarce,
    lifeLogContext: { p1Alive: true, hasPartner: false } });
assert(ruinRow.aktionUndGrund.includes('Profilsteuern:'), 'MC terminal protocol retains the funding reason');
const backtest = runFixture({ input: scarce, selectedPeriod: { startYear: 2008, endYear: 2008 } });
assertEqual(backtest.outcome.kind, 'ruin', 'Historical backtest returns financial ruin rather than a technical error');
assert(backtest.rows[0].row.GuardNote.includes('Profilsteuern:'), 'Backtest terminal protocol explains the funding limit');
