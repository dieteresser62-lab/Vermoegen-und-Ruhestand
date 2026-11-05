import { readMU1Hash } from './helpers/mu-1-expectations.mjs';
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { readAN1Hash } from './helpers/an-1-expectations.mjs';
import { readJB2Hash } from './helpers/jb-2-expectations.mjs';
import { createHash } from 'node:crypto';
import { EngineAPI } from '../engine/index.mjs';
import { settleTaxYear, settleHouseholdTaxYear, capitalGainsTaxRate } from '../engine/tax-settlement.mjs';
import { calculateFlexRate } from '../engine/planners/flex-rate-policy.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { beginPersonalTaxYear, settlePersonalTaxYear } from '../app/simulator/simulator-personal-tax.js';
import { personalProfiles } from '../app/simulator/simulator-personal-accounts.js';
import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
import { PLAN_DEFAULTS, projectPlanToBalance, assertPlanValues } from '../app/profile/household-plan.js';
import { householdPlanFieldVisible } from '../app/shared/household-plan-fields.js';
import { protocolRowFlags } from '../app/simulator/protocol-columns.js';
import { householdInput, marketYear } from './helpers/ff-c-scenarios.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { unchangedFFD } from './helpers/ff-d-scenarios.mjs';

const taxRow = (income, carry = 0, allowance = 1000) => ({ rawAggregate: {
    sumRealizedGainSigned: income, sumTaxableAfterTqfSigned: income },
    sparerPauschbetrag: allowance, taxStatePrev: { lossCarry: carry }, kirchensteuerSatz: 0 });
const rate = capitalGainsTaxRate(0);
for (const [incomeA, expectedBase] of [[0, 3000], [-2000, 1000]]) {
    const rows = [taxRow(incomeA), taxRow(5000)], bytes = JSON.stringify(rows);
    for (const enabled of [false, true]) {
        const settled = settleHouseholdTaxYear(rows, enabled);
        assertClose(settled.reduce((s, row) => s + row.taxDue, 0), (enabled ? expectedBase : 4000) * rate, 1e-9,
            'FR-28: eigene Pauschbeträge, Partnerrest und Verluste');
        if (!enabled) assertEqual(JSON.stringify(settled), JSON.stringify(rows.map(settleTaxYear)), 'Aus ist bytegleich zur Einzelabrechnung');
        const input = { ...householdInput(100000, 100000), jointAssessment: enabled };
        const portfolio = initMcRunState(input).portfolio;
        const book = beginPersonalTaxYear(portfolio);
        book[0].rawAggregate = rows[0].rawAggregate;
        if (incomeA !== 0) book[1].rawAggregate = rows[1].rawAggregate;
        const action = {};
        const result = settlePersonalTaxYear({ portfolio, book, personalInterest: { items: incomeA === 0
            ? [{ profileId: 'b', cashInterest: 5000 }] : [] }, actionResult: action, inputs: input,
            plannedActionFlow: null, regularSaleScale: 0, forcedTaxReserved: 0, spendingNewState: {}, didForcedSale: false });
        assertClose(result.totalTaxesThisYear, (enabled ? expectedBase : 4000) * rate, 1e-9, 'Simulator bucht die gemeinsame Jahressteuer');
        assertEqual(portfolio.personAccounts[0].taxState.lossCarry, enabled || incomeA === 0 ? 0 : 2000, 'Nur Restverlust wird vorgetragen');
    }
    assertEqual(JSON.stringify(rows), bytes, 'Reine Steuerfunktion verändert keine Eingaben');
}
assertEqual(JSON.stringify(settleHouseholdTaxYear([taxRow(5000)], true)), JSON.stringify([settleTaxYear(taxRow(5000))]), 'FR-24: allein kein Partnerpauschbetrag');
const excessLoss = settleHouseholdTaxYear([taxRow(-10000), taxRow(5000)], true);
assertEqual(excessLoss[0].taxStateNext.lossCarry, 5000, 'Restverlust bleibt beim Verursacher');
assertEqual(excessLoss[1].taxDue, 0, 'Partnergewinn vollständig verrechnet');
const carried = settleHouseholdTaxYear([taxRow(0, 2000), taxRow(5000)], true);
assertClose(carried[1].taxDue, 1000 * rate, 1e-9, 'Auch vorhandener Verlustvortrag wird genutzt');
{
    const input = householdInput(0, 0), portfolio = initMcRunState(input).portfolio;
    // Nur B verkauft eine reine Gewinntranche; A stellt den ungenutzten Pauschbetrag.
    const profiles = personalProfiles(portfolio, input);
    profiles[0].tranches = []; profiles[0].inputs = { sparerPauschbetrag: 1000 };
    profiles[1].tranches[0].costBasis = 0; profiles.forEach(profile => { profile.hasExplicitTrancheOverride = true; });
    const action = { type: 'TRANSACTION', verwendungen: { liquiditaet: 5000 }, quellen: [{
        sourceProfileId: 'b', trancheId: 'b:equity', kind: 'aktien_neu', category: 'equity',
        brutto: 5000, netto: 5000, steuer: 0, tqf: 0, realizedGainSigned: 5000, taxableAfterTqfSigned: 5000 }] };
    for (const jointAssessment of [false, true]) {
        const result = attributeHouseholdAction({ householdAction: action, profiles, jointAssessment });
        const gross = result.finalAction.bruttoVerkaufGesamt;
        assertClose(result.finalAction.steuer, (gross - (jointAssessment ? 2000 : 1000)) * rate, 1e-7, 'Balance plant mit derselben gemeinsamen Steuer');
        assertClose(gross - result.finalAction.steuer, 5000, 1e-7, 'Gemeinsamer Steuervorteil verändert die nötige Bruttoquelle');
    }
}
const oldPlan = structuredClone(PLAN_DEFAULTS); delete oldPlan.jointAssessment;
assertPlanValues(oldPlan);
assertEqual(JSON.stringify(projectPlanToBalance(oldPlan)), JSON.stringify(projectPlanToBalance({ ...oldPlan, jointAssessment: false })), 'Altplan ohne Feld rechnet bytegleich wie Aus');
assert(!householdPlanFieldVisible('jointAssessment', { householdPersonCount: 1 }), 'Einzelperson sieht keinen Schalter');
assert(householdPlanFieldVisible('jointAssessment', { householdPersonCount: 2, householdMarried: true }), 'Verheiratetes Paar sieht Schalter');
assert(!householdPlanFieldVisible('jointAssessment', { householdPersonCount: 2, householdMarried: false }), 'Unverheiratetes Paar sieht keinen Schalter');
for (const quote of [.01, .024, .025, .035]) {
    let flexRate = 50;
    const rates = [];
    for (let year = 0; year < 3; year++) {
        flexRate = calculateFlexRate({ flexRate, keyParams: {} }, { active: false }, {
            inflatedBedarf: { floor: 30000, flex: 20000 }, depotwertGesamt: 1000000,
            lastState: { lastEntnahmeReal: quote * 1000000, cumulativeInflationFactor: 1 },
            market: { sKey: 'side_long' }, runwayMonate: 120, input: { liquidityRunwayYears: 5 }
        }, () => {}).geglätteteFlexRate;
        rates.push(flexRate);
    }
    assertClose(rates[0], quote <= .025 ? 70 : 54.5, 1e-9, 'FR-29: bis 2,5 % maximal 20 pp, darüber bisherige Regimegrenze');
    if (quote <= .024) assert(rates[2] > 94, '40–50 pp Rückstand nach drei Jahren weitgehend aufgeholt');
}
const unchanged = unchangedFFD({ engine: EngineAPI, initMcRunState, simulateOneYear });
const base = unchanged.engines[0].input;
{
    const input = { ...base, depotwertAlt: 2000000, tagesgeld: 120000, minimumFlexAnnual: 0, maxSkimPctOfEq: 10 };
    let state = { initialized: true, flexRate: 50, flexRateSmoothingReference: 50,
        lastEntnahmeReal: 20000, cumulativeInflationFactor: 1, lastTotalBudget: 18000 };
    for (const expectedRate of [70, 90, 100]) {
        const result = EngineAPI.simulateSingleYear(input, state);
        assertClose(result.newState.flexRate, expectedRate, 1e-9, 'FR-29 erreicht auch durch finale Glättung in drei Jahren 100 %');
        assertEqual(result.ui.zielLiquiditaet, 120000, 'FR-30 hält fünf Jahre Wunschbedarf trotz Kürzung bereit');
        assertEqual(result.ui.action.verwendungen?.aktien || 0, 0, 'Kein Aktienkauf aus einer Senkung des Liquiditätsziels');
        state = result.newState;
    }
}

for (const age of [79, 80, 81]) {
    const result = EngineAPI.simulateSingleYear({ ...base, dynamicFlex: true, goGoActive: true, goGoMultiplier: 1.2,
        aktuellesAlter: age, capeRatio: 25, marketCapeRatio: 25, horizonYears: 20, flexBedarf: 60000, minimumFlexAnnual: 0 });
    assertEqual(result.ui.vpw.goGoActive, age <= 80, 'FR-31: Go-Go bis einschließlich 80');
}
const partnerOld = EngineAPI.simulateSingleYear({ ...base, dynamicFlex: true, goGoActive: true,
    aktuellesAlter: 70, partnerAlter: 81, capeRatio: 25, horizonYears: 20 });
assertEqual(partnerOld.ui.vpw.goGoActive, false, 'Ältere Partnerperson begrenzt Go-Go');
for (const [wish, paid, cut] of [[10000, 12000, false], [0, 0, false], [10000, 5000, true]]) {
    const row = { flex_wunsch_haushalt_nominal: wish, flex_haushalt_erfuellt: paid,
        flex_haushalt_kuerzung_pct: 80, entscheidung: { kuerzungProzent: wish > 0 ? Math.max(0, 100 - paid / wish * 100) : 100 } };
    assertEqual(protocolRowFlags(row).cut, cut, 'FR-6: Nur echte Kürzung bei positivem Wunsch zählt');
    assertEqual(protocolRowFlags({ row, entscheidung: row.entscheidung }, 'backtest').cut, cut, 'Backtest zählt denselben Fall');
}
for (const [key, expected] of Object.entries({
    engines: 'b67d8f07fcffa09faf1cf7a83652a266364263ffa132bd7285cf4d27f00bb343',
    households: 'b36aa608d5c0451332c75efad00f8a1c6cb6d7f5a1cd5be66097494e1e0e545d',
    singles: 'c836f6a70bd12b327acff8ff09dea88a0963ea8624dfe7c0190cf258dba9b697'
})) assertEqual(createHash('sha256').update(JSON.stringify(unchanged[key])).digest('hex'), readGL1References(readAN1Hash(readJB2Hash(expected))),
    `Vollständige ${key}-Ergebnisse mit FR-20/33/34-Diagnosen`);

{
    const input = { ...householdInput(100000, 100000), dynamicFlex: true, goGoActive: true,
        goGoMultiplier: 1.2, startAlter: 70, partner: { aktiv: true, startAlter: 81, monatsrente: 0 }, horizonYears: 20 };
    const result = simulateOneYear(initMcRunState(input), input, marketYear, 0, null, 0, null, 1, EngineAPI);
    assertEqual(result.ui.vpw.goGoActive, false, 'Simulator übergibt das höhere Partneralter an die Engine');
    const profiles = personalProfiles(initMcRunState(input).portfolio);
    profiles[0].inputs.aktuellesAlter = 70; profiles[1].inputs.aktuellesAlter = 81;
    const balance = evaluateStoredAnnualHousehold({ ...base, depotwertAlt: 0, depotwertNeu: 2000000,
        dynamicFlex: true, goGoActive: true, horizonYears: 20, aktuellesAlter: 70, capeRatio: 25 }, profiles, null,
        { engineApi: EngineAPI, withdrawalMode: 'tax_optimized' });
    assertEqual(balance.householdResult.ui.vpw.goGoActive, false, 'Balance übergibt unabhängig von der geöffneten Person das höhere Alter');
}

for (const [id, hash] of Object.entries({
    'max-erika': '6cf24735d89c2a86ca2a70b785f440df7090a71beae753ff20984bdb2dc36037',
    'jan-lena': '5c3416aa74fc28c443199488083b7a177e6faed19180f1aa99f44b27aeaa15a6'
})) {
    const raw = createMusterHaushaltRecords('2026-01-01', id).household_plan_v1;
    assertEqual(createHash('sha256').update(raw).digest('hex'), readMU1Hash(readGL1References(readAN1Hash(hash))), `${id}: vollständige Planbytes nach FF-E und MU-1`);
    assert(!Object.values(JSON.parse(raw).entries)[0].values.jointAssessment, `${id}: Zusammenveranlagung bleibt aus`);
}
assertEqual(Object.values(JSON.parse(createMusterHaushaltRecords('2026-01-01', 'renate').household_plan_v1).entries)[0].values.decumulation.mode,
    '3_bucket_jilge', 'FR-58: Renate nutzt wegen ihrer Anleihen 3 Töpfe');
assertEqual(Object.values(JSON.parse(createMusterHaushaltRecords('2026-01-01', 'helga-werner').household_plan_v1).entries)[0].values.jointAssessment,
    true, 'Helga und Werner haben Zusammenveranlagung eingeschaltet');
