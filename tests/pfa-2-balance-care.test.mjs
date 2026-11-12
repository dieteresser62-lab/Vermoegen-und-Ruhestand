// FR-73 Paket 2: Balance rechnet heutige Pflege wie der Simulator im ersten Jahr (Sollfälle A–D, H, L, P, Q, R, U; Testdatum 23.10.2026).
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState, simulateOneYear, calcCareCost } from '../app/simulator/simulator-engine-wrapper.js';
import { fixedCareTodayForYear } from '../app/simulator/simulator-care-today.js';
import { composeYearNeed } from '../app/simulator/simulator-survivor.js';
import { calculateFixedIncomeForYear } from '../app/simulator/simulator-fixed-income.js';
import { calculateHouseholdWithdrawalNeed, calculateWithdrawalDistribution } from '../app/profile/profilverbund-balance.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { householdPlanFieldSpec } from '../app/shared/household-plan-fields.js';
import { readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { annualTestMarketData, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
setAppTestDate('2026-10-23');

const today = (grade, form, residentialSince) => ({ grade, form, ...(residentialSince ? { residentialSince } : {}) });
const close = (a, b, label, tolerance = 1e-6) => assert(Math.abs(a - b) < tolerance, `${label}: ${a} = ${b}`);
/** Balance-Eingangsweg aus dem gespeicherten Haushalt; Lesen schreibt nie. */
function balance(options, referenceYear = 2026) {
    const { records, scope } = pfa2Records(options);
    const { storage, counts } = countingStorage(records);
    const calculation = buildBalanceEngineInputFromStorage({ storage, scope, referenceYear });
    assertEqual(counts.setItem + counts.removeItem, 0, 'P8 Balance liest Pflege ohne setItem/removeItem');
    const engine = EngineAPI.simulateSingleYear(calculation.engineInput, calculation.engineLastState);
    assert(!engine.error, 'Balance-Engine rechnet den Pflegehaushalt');
    return { records, scope, calculation, engine, input: calculation.inputData, care: calculation.careNeeds };
}
/** Simulator Jahr 1 aus denselben Records: echte Profilkombination, feste heutige Pflege. */
function simulatorYearOne(records, referenceYear = 2026) {
    const registry = JSON.parse(records.rs_profiles_v1), plan = readBalanceHouseholdPlan({ storage: { getItem: key => records[key] ?? null } });
    const entries = IDS.filter(id => registry.profiles[id]).map(profileId => ({ profileId, name: registry.profiles[profileId].meta.name,
        inputs: buildSimulatorInputsFromProfileData(registry.profiles[profileId].data, { storage: { getItem: key => records[key] ?? null }, referenceYear, planValues: plan.entry.values }) }));
    const inputs = combineSimulatorProfiles(entries, IDS[0], { planValues: plan.entry.values }).combined;
    const state = initMcRunState(inputs);
    const fixed = fixedCareTodayForYear(inputs, state, 0);
    const need = composeYearNeed({ inputs, baseFloor: state.baseFloor, household: fixed.householdContext, deathThisYear: false, careFloorAddition: fixed.careFloorAddition });
    const income = calculateFixedIncomeForYear({ inputs, state, household: fixed.householdContext, care: fixed.householdContext.care, yearIndex: 0, inflationFactor: 1, deathThisYear: false });
    return { inputs, state, fixed, need, allowance: income?.pflegegeld ?? 0, care: fixed.householdContext.care };
}

// A–D, H: Haushaltsbedarf und Monatsbudget wie in FR-73.
const A = balance({ care: [null, today(3, 'home-support')] });
assertEqual(A.input.floorBedarf, 54000, 'A Balance-Floor 36.000 + 18.000');
assertEqual(A.engine.ui.spending.monatlicheEntnahme, 4500, 'A Balance 4.500 €/Monat');
assertEqual(A.input.renteMonatlich, 0, 'A kein Pflegegeld bei externer Unterstützung');
const B = balance({ care: [null, today(2, 'family')] });
assertEqual(B.input.floorBedarf, 42000, 'B Balance-Floor 36.000 + 6.000');
assertEqual(B.input.renteMonatlich * 12, 4164, 'B Pflegegeld 4.164 €/Jahr als Einkunft');
const C = balance({ care: [null, today(4, 'residential')] });
assertEqual(C.input.floorBedarf, 73368, 'C Heimjahr 1: 27.000 + 40.368 + 6.000');
assertEqual(C.engine.ui.spending.monatlicheEntnahme, 6114, 'C Balance 6.114 €/Monat');
assertEqual(C.care.persons[1].heimJahr, 1, 'C ohne „seit“ Heimjahr 1');
const D = balance({ care: [null, today(4, 'residential', '2023-01')] });
assertEqual(D.input.floorBedarf, 58332, 'D Heimjahr 4: 27.000 + 25.332 + 6.000');
assertEqual(D.engine.ui.spending.monatlicheEntnahme, 4861, 'D Balance 4.861 €/Monat');
assertEqual(D.care.persons[1].heimJahr, 4, 'D 45 Monate seit 01/2023 ergeben Heimjahr 4');
close(D.care.next.total, 60790.572, 'D Folgejahr: Heimjahr 5, Folgejahrespreise 2 % × 5 % (V, P9)');
close(D.input.careLiquidityProjection.floor, 60790.572, 'D Liquiditätsziel erhält den vollen Folgejahresbedarf');
assertEqual(D.input.careLiquidityProjection.priceFactor, 1.02, 'D Folgejahrespreise mit Balance-Inflation');
const H = balance({ care: [today(4, 'residential')], single: true, plan: { floorBedarf: 24000 } });
assertEqual(H.input.floorBedarf, 46368, 'H allein im Heim: Grundbedarf zu Hause 0');
assertEqual(H.care.current.homeFloor, 0, 'H kein Grundbedarf zu Hause');

// L: Parität je Person und Bestandteil gegen den Simulator aus denselben Records.
for (const [label, result] of [['A', A], ['B', B], ['C', C], ['D', D], ['H', H]]) {
    const sim = simulatorYearOne(result.records);
    close(sim.need.total, result.input.floorBedarf, `L ${label} Floor-Summe Balance = Simulator Jahr 1`);
    close(sim.need.homeFloor, result.care.current.homeFloor, `L ${label} Grundbedarf zu Hause`);
    close(sim.need.homeCareAddition, result.care.current.homeCareAddition, `L ${label} Pflegezusatz zu Hause`);
    close(sim.need.residentialCosts, result.care.current.residentialCosts, `L ${label} Heimkosten`);
    close(sim.need.residentialOwnExpenses, result.care.current.residentialOwnExpenses, `L ${label} eigene Ausgaben im Heim`);
    close(sim.fixed.temporaryFlexFactor, result.care.current.flexFactor, `L ${label} Flex-Faktor`);
    close(sim.allowance, result.input.renteMonatlich * 12, `L ${label} Pflegegeld (Einkommensparität)`);
    for (const [index, key] of ['p1', 'p2'].entries()) {
        const meta = sim.care[key], person = result.care.persons[index];
        if (!meta?.active) continue;
        close((meta.heimKosten || 0), person.residentialCosts, `L ${label} ${person.name} Heimkosten je Person`);
        close(calcCareCost(meta).zusatzFloor, person.homeCareAddition, `L ${label} ${person.name} Pflegezusatz je Person`);
        assertEqual(meta.heimJahr || 0, person.heimJahr, `L ${label} ${person.name} Heimjahr`);
    }
}

// P/Q: Wunsch-, Mindest- und Dynamic Flex mit absolutem Pflege-Level und Haushaltsverknüpfung.
for (const [p1, p2, wish, minimum] of [[null, today(3, 'home-support'), 10500, 5250], [null, today(4, 'residential'), 9000, 4500],
    [today(4, 'residential'), today(4, 'residential'), 0, 0]]) {
    const result = balance({ care: [p1, p2], plan: { flexBedarf: 12000, minimumFlexAnnual: 6000, dynamicFlex: true } });
    close(result.input.flexBedarf, wish, 'P Wunsch-Flex in der Engine-Eingabe');
    close(result.input.minimumFlexAnnual, minimum, 'P Mindest-Flex in der Engine-Eingabe');
    close(2 * result.input.flexBedarf, 2 * wish, 'Q Dynamic-Flex-Obergrenze aus dem wirksamen Wunsch-Flex');
}

// R: Angehörigenausfall gilt schon heute; Alleinstehende behalten das Pflegegeld.
const R = balance({ care: [today(3, 'home-support'), today(2, 'family')] });
assertEqual(R.input.floorBedarf, 60000, 'R Bruttobedarf 36.000 + 6.000 + 18.000');
assertEqual(R.input.renteMonatlich, 0, 'R kein Pflegegeld nach Angehörigenausfall (Balance-Altfehler behoben)');
assertEqual(R.care.persons[1].form, 'home-support', 'R wirksame Form der gepflegten Person wechselt zu externer Unterstützung');
const alone = balance({ care: [today(2, 'family')], single: true });
assertEqual(alone.input.renteMonatlich * 12, 4164, 'R alleinstehend behält 4.164 € Pflegegeld');

// U: Unverheiratet, Vermögensanteile 60/40 ohne Einkünfte; persönliche Heimkosten bleiben bei der Person.
const U = balance({ care: [null, today(4, 'residential')], unmarried: true, cash: [600000, 400000], clearTranches: true });
const need = calculateHouseholdWithdrawalNeed(U.calculation.profiles, { floorBedarf: U.input.floorBedarf, flexBedarf: U.input.flexBedarf });
assertEqual(JSON.stringify(need.personalNeeds), JSON.stringify({ [IDS[1]]: 46368 }), 'U persönliche Pflegekosten der Person im Heim');
const split = calculateWithdrawalDistribution(U.calculation.profiles, { ...need, netWithdrawal: 73368 }, 'proportional');
close(split.items.find(item => item.profileId === IDS[0]).withdrawalAmount, 16200, 'U Anteil der Person zu Hause 60 % × 27.000', .01);
close(split.items.find(item => item.profileId === IDS[1]).withdrawalAmount, 57168, 'U Anteil der Person im Heim 40 % × 27.000 + 46.368', .01);
const married = balance({ care: [null, today(4, 'residential')], cash: [600000, 400000], clearTranches: true });
assert(married.calculation.profiles.every(entry => !entry.personalCareNeed), 'U Verheiratete behalten die gemeinsame Verteilung');

// Monatsbudget: Grundbedarf zu Hause und je Person „Pflege“ bzw. „Heim“ mit Heimjahr aus „seit“ im ⓘ.
{
    const previous = globalThis.document, doc = createPresentationTestDocument();
    globalThis.document = doc;
    try {
        const outputs = Object.fromEntries(['balanceMonthlyBudget', 'balanceNeedRows', 'balanceNeedTotal', 'balanceFloorCoverage'].map(key => [key, doc.createElement('div')]));
        const renderer = new SummaryRenderer({ outputs }, { loadState: () => ({}) });
        const rows = () => outputs.balanceNeedRows.children.flatMap(group => group.className === 'household-plan-group' ? group.children.slice(1) : [group]);
        const row = label => rows().find(line => line.children[0].textContent.startsWith(label));
        const amount = line => line.children[1].children.length ? line.children[1].children.map(node => node.textContent).join('') : line.children[1].textContent;
        for (const [result, label, expected, floor] of [[D, 'Heim Werner', '2.611 € / Monat', '2.250 € / Monat'], [A, 'Pflege Werner', '1.500 € / Monat', '3.000 € / Monat']]) {
            renderer.renderPlanCards({ ...result.engine.ui, input: result.input, careNeeds: result.care });
            assertEqual(amount(row(label)), expected, `Monatsbudget zeigt „${label}“`);
            assertEqual(amount(row(householdPlanFieldSpec('floorBedarf').label)), floor, `Monatsbudget zeigt den Grundbedarf zu Hause (${label})`);
            assert(!row('Pflege Helga') && !row('Heim Helga'), 'Keine Zeile für Personen ohne Pflegegrad');
        }
        renderer.renderPlanCards({ ...D.engine.ui, input: D.input, careNeeds: D.care });
        const info = row('Heim Werner').children[0].children[0];
        assert(info?.children?.[1]?.textContent.includes('Heimjahr 4 (seit 01/2023)'), 'Heimjahr aus „seit“ steht im ⓘ der Heimzeile');
        assert(outputs.balanceFloorCoverage.textContent.includes('Grundbedarf zu'), 'Floor-Deckung bezieht sich auf den vollen nicht kürzbaren Bedarf');
    } finally { globalThis.document = previous; }
}

// Ohne Pflegegrad heute bleibt die Balance-Eingabe unverändert.
{
    const plain = balance({});
    assertEqual(plain.care, null, 'Ohne heutigen Grad keine Pflegeprojektion');
    assertEqual(plain.input.floorBedarf, 36000, 'Ohne heutigen Grad gilt der Plan-Grundbedarf');
    assert(!('careLiquidityProjection' in plain.input), 'Ohne heutigen Grad keine Liquiditätsprojektion in der Engine-Eingabe');
}

// Parität über den Jahresabschluss (P9, PFA-7): Balance im Planjahr 2027 gleich einem ausgeführten Simulatorjahr 2027 aus
// denselben Records, Lesetag 2.1.2027. Seit PFA-7 statt fester Vergleichszahlen.
setAppTestDate('2027-01-02');
for (const [since, heimJahr, label] of [['2026-10', 1, 'C „seit“ 10/2026: 3 Monate, Heimjahr 1'], ['2023-01', 5, 'D „seit“ 01/2023: 48 Monate, Heimjahr 5']]) {
    const { records, scope } = pfa2Records({ care: [null, today(4, 'residential', since)] });
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
    state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state); records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) { const own = JSON.parse(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]); own.annualPeriodMetadata = state.annualPeriodMetadata; registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(own); }
    records.rs_profiles_v1 = JSON.stringify(registry);
    const marketData = { ...annualTestMarketData, inflation: { ...annualTestMarketData.inflation, rate: 2 } };
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, scope, storage: annualRecordStorage(records), now: annualTestNow });
    const prepared = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, adoptedPlanPatch: { floorBedarf: 36720 }, now: annualTestNow });
    const after = buildBalanceEngineInputFromStorage({ storage: annualRecordStorage(prepared.records), scope, referenceYear: 2027 });
    const sim = simulatorYearOne(prepared.records, 2027);
    let captured;
    const engine = { simulateSingleYear(input, last) { captured = EngineAPI.simulateSingleYear(input, last); return captured; } };
    const year = simulateOneYear(sim.state, sim.inputs, { jahr: 2027, inflation: 2, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 }, 0,
        sim.fixed.pflegeMeta, sim.fixed.careFloorAddition, sim.fixed.householdContext, .75, engine);
    assertEqual(year.kind, 'success', `${label}: Simulatorjahr 2027 auswertbar`);
    assertEqual(after.careNeeds.persons[1].heimJahr, heimJahr, `${label}: Balance`);
    assertEqual(sim.care.p2.heimJahr, heimJahr, `${label}: Simulator`);
    close(captured.input.floorBedarf, after.inputData.floorBedarf, `${label}: Floor Balance = ausgeführtes Simulatorjahr 2027`);
    close(captured.input.careLiquidityProjection.floor, after.inputData.careLiquidityProjection.floor, `${label}: Folgejahr Balance = Simulator`);
}
setAppTestDate(null);
