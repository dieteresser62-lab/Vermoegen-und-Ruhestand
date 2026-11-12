// FR-73 Paket 7: Heimjahr im Dezemberfenster (Gutachten FR73F, Befunde 1–3). Jahresabschluss 2026 am 1.12.2026 oder
// 2.1.2027, Plan 2027, 2 % Inflation, 5 % Kostenanstieg. Rechnungstag nach P7: „seit“ zählt ab dem echten Tagesdatum,
// der Anker ohne „seit“ nach dem Planjahr. Balance und ein ausgeführtes Simulatorjahr 2027 rechnen dasselbe Heimjahr.
// Alter Stand eba8f650 rot.
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { annualTestMarketData } from './helpers/balance-storage-fixtures.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { personReferenceYear } from '../app/profile/profile-person-data.js';
import { CARE_VALUE_KEYS } from '../app/profile/profile-care.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { fixedCareTodayForYear } from '../app/simulator/simulator-care-today.js';
import { makeDefaultCareMeta } from '../app/simulator/simulator-engine-helpers.js';
import { updateResidentialCareState } from '../app/simulator/simulator-residential-care.js';
import { careReference, initialResidentialYear } from '../app/shared/care-needs.js';

const today = (grade, form, residentialSince) => ({ grade, form, ...(residentialSince ? { residentialSince } : {}) });
const close = (a, b, label, tolerance = 1e-6) => assert(Math.abs(a - b) < tolerance, `${label}: ${a} = ${b}`);
const metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };

/** Jahresabschluss 2026 am Abschlusstag (Tagesdatum und Abschlusszeit gleich), Grundbedarf 2027 36.720 €. */
function closedOn(day, since) {
    setAppTestDate(day);
    const { records, scope } = pfa2Records({ care: [null, today(4, 'residential', since)], testDate: '2026-10-23' });
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]); state.annualPeriodMetadata = metadata;
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state); records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) { const own = JSON.parse(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]); own.annualPeriodMetadata = metadata; registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(own); }
    records.rs_profiles_v1 = JSON.stringify(registry);
    const now = () => new Date(`${day}T12:00:00Z`);
    const marketData = { ...annualTestMarketData, inflation: { ...annualTestMarketData.inflation, rate: 2 } };
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, scope, storage: annualRecordStorage(records), now });
    return { records: prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, adoptedPlanPatch: { floorBedarf: 36720 }, now }).records, scope };
}

/** Ein ausgeführtes Simulatorjahr 1 aus denselben Records; Bezugsjahr wie im Simulator aus den Abschlussmetadaten. */
function simulatorYearOne(records) {
    const storage = { getItem: key => records[key] ?? null };
    const referenceYear = personReferenceYear(JSON.parse(records[CONFIG.STORAGE.LS_KEY]).annualPeriodMetadata);
    const registry = JSON.parse(records.rs_profiles_v1), plan = readBalanceHouseholdPlan({ storage });
    const entries = IDS.map(profileId => ({ profileId, name: registry.profiles[profileId].meta.name, data: registry.profiles[profileId].data,
        inputs: buildSimulatorInputsFromProfileData(registry.profiles[profileId].data, { storage, referenceYear, planValues: plan.entry.values, profileId }) }));
    const inputs = combineSimulatorProfiles(entries, IDS[0], { planValues: plan.entry.values }).combined;
    const state = initMcRunState(inputs), fixed = fixedCareTodayForYear(inputs, state, 0);
    let captured;
    const engine = { simulateSingleYear(input, last) { captured = EngineAPI.simulateSingleYear(input, last); return captured; } };
    const result = simulateOneYear(state, inputs, { jahr: 2027, inflation: 2, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 }, 0,
        fixed.pflegeMeta, fixed.careFloorAddition, fixed.householdContext, .75, engine);
    assertEqual(result.kind, 'success', 'Simulatorjahr auswertbar');
    return { referenceYear, heimJahr: fixed.householdContext.care.p2.heimJahr, floor: captured.input.floorBedarf,
        nextFloor: captured.input.careLiquidityProjection.floor };
}

/** Balance und Simulator am Lesetag; Lesen schreibt nie. */
function readOn(day, { records, scope }) {
    setAppTestDate(day);
    const { storage, counts } = countingStorage(records);
    const balance = buildBalanceEngineInputFromStorage({ storage, scope });
    assertEqual(counts.setItem + counts.removeItem, 0, `Lesen am ${day} schreibt nie`);
    return { balance: { heimJahr: balance.careNeeds.persons[1].heimJahr, floor: balance.inputData.floorBedarf,
        nextFloor: balance.inputData.careLiquidityProjection.floor }, simulator: simulatorYearOne(records) };
}

// Sollwerte von Hand (Gutachten FR73F): Bestandteile 2027 2.236/1.144/558 €, Grundbedarf zu Hause 0,75 × 36.720 = 27.540 €,
// eigene Ausgaben 510 × 12 = 6.120 €. Heimjahr 2: 3.267 × 12 = 39.204 → 72.864 €; Heimjahr 3: 2.820 × 12 = 33.840 → 67.500 €;
// ab Heimjahr 4: 2.261 × 12 = 27.132 → 60.792 €.
const FLOOR = { 2: 72864, 3: 67500, 4: 60792, 5: 60792 };
const CASES = [
    { label: 'Anker 2026 ohne „seit“', since: null, years: { '2026-12-01': 2, '2027-01-02': 2, '2027-10-01': 2 } },
    { label: '„seit“ 10/2025', since: '2025-10', years: { '2026-12-01': 2, '2027-01-02': 2, '2027-10-01': 3 } },
    { label: '„seit“ 01/2023', since: '2023-01', years: { '2026-12-01': 4, '2027-01-02': 5, '2027-10-01': 5 } }
];
const results = {};

// Befund 1 und 3: Parität Balance = ausgeführtes Simulatorjahr 2027 für zwei Abschlusstage und drei Lesetage.
for (const closing of ['2026-12-01', '2027-01-02']) {
    for (const { label, since, years } of CASES) {
        const closed = closedOn(closing, since);
        const anchor = JSON.parse(closed.records.rs_profiles_v1).profiles[IDS[1]].data[CARE_VALUE_KEYS.residentialFirstYear];
        assertEqual(anchor, since ? undefined : '2026', `${label}, Abschluss ${closing}: Anker nur ohne „seit“`);
        for (const [day, heimJahr] of Object.entries(years)) {
            if (day < closing) continue;
            const { balance, simulator } = readOn(day, closed);
            const where = `${label}, Abschluss ${closing}, gelesen ${day}`;
            assertEqual(simulator.referenceYear, 2027, `${where}: Simulator rechnet Jahr 1 als 2027`);
            assertEqual(balance.heimJahr, heimJahr, `${where}: Balance Heimjahr ${heimJahr}`);
            assertEqual(simulator.heimJahr, heimJahr, `${where}: Simulator Heimjahr ${heimJahr}`);
            close(balance.floor, FLOOR[heimJahr], `${where}: Balance-Floor`);
            close(simulator.floor, balance.floor, `${where}: Simulator-Floor gleich Balance`);
            close(simulator.nextFloor, balance.nextFloor, `${where}: Folgejahr (Heimjahr + 1) gleich`);
            results[`${since}|${closing}|${day}`] = balance;
        }
    }
}

// Befund 2: Innerhalb des Planjahrs 2027 springt das Heimjahr aus „seit“ nicht vor; es wächst erst mit dem echten Datum.
{
    const december = results['2025-10|2026-12-01|2026-12-01'], january = results['2025-10|2026-12-01|2027-01-02'], october = results['2025-10|2026-12-01|2027-10-01'];
    assertEqual(december.floor, 72864, 'B2 „seit“ 10/2025 am 1.12.2026: 14 Monate → Heimjahr 2 → 72.864 € (nicht 67.500)');
    assertEqual(january.floor, december.floor, 'B2 am 2.1.2027 unverändert 72.864 €');
    assertEqual(october.floor, 67500, 'B2 erst ab 1.10.2027 Heimjahr 3 → 67.500 €');
    // Folgejahr: Grundbedarf und eigene Ausgaben mit 2 % Inflation, Heimjahr 3 mit Inflation und 5 % Kostenanstieg.
    close(december.nextFloor, 27540 * 1.02 + 33840 * 1.02 * 1.05 + 6120 * 1.02, 'B2 Liquiditätsziel im Dezember mit Folgejahr Heimjahr 3 (70.575,84 €, nicht 63.391,57 €)');
}
// Gemeinsame Funktion: Stichtag bleibt das echte Datum, das Planjahr gilt nur für den Anker; alte Eingaben ohne Planjahr wie bisher.
{
    const reference = careReference('2026-12-01', 2027);
    assertEqual(JSON.stringify(reference), JSON.stringify({ careReferenceDate: '2026-12-01', careReferenceYear: 2027 }), 'Rechnungstag 1.12.2026, Planjahr 2027');
    assertEqual(careReference('2027-01-02', 2026).careReferenceYear, 2027, 'Planjahr nie vor dem Kalenderjahr');
    assertEqual(initialResidentialYear(null, '2026-12-01', '2026', 2027), 2, 'Anker 2026 im Planjahr 2027: Heimjahr 2');
    assertEqual(initialResidentialYear('2025-10', '2026-12-01', null, 2027), 2, '„seit“ zählt ab dem echten Datum, nicht ab dem Planjahr');
    assertEqual(initialResidentialYear(null, '2026-12-01', '2026'), 1, 'Alte Eingaben ohne Planjahr zählen ab dem Jahr des Stichtags');
    // Backtest und Monte Carlo: Anfangszustand und Heimfortschreibung lesen dasselbe Planjahr aus den Eingaben.
    const careToday = { grade: 4, form: 'residential', residentialFirstYear: '2026' };
    const inputs = { careToday, ...reference, partner: { aktiv: false }, pflegeGradeConfigs: { 4: { careForm: 'residential' } } };
    assertEqual(makeDefaultCareMeta(false, 'w', careToday, 80, inputs).heimStartJahr, -1, 'Anfangszustand: Heimjahr 2 → heimStartJahr −1');
    const meta = { ...makeDefaultCareMeta(false, 'w', careToday, 80, inputs) };
    delete meta.heimStartJahr;
    updateResidentialCareState(meta, inputs, 0, { p1Alive: true, care: { p1: meta } }, 0);
    assertEqual(meta.heimJahr, 2, 'Heimfortschreibung ohne gespeicherten Beginn: Heimjahr 2 im Jahr 1');
}
setAppTestDate(null);
