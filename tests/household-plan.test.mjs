import { PLAN_FIELDS, PLAN_FIELD_PATHS, PLAN_DEFAULTS, HOUSEHOLD_PLAN_KEY, planScope, assertPlanValues,
    assertHouseholdPlanRecord, readHouseholdPlan, buildPlanRecord, patchHouseholdPlan, projectPlanToBalance } from '../app/profile/household-plan.js';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';

const expected = 'floorBedarf flexBedarf minimumFlexAnnual flexBudgetAnnual flexBudgetYears flexBudgetRecharge liquidityRunwayYears minCashBufferMonths maxSkimPctOfEq maxBearRefillPctOfEq decumulation dynamicFlex horizonMethod horizonYears survivalQuantile goGoActive goGoMultiplier longevityMode longevityQuantileShift longevityRelativePct longevityBufferYears householdWithdrawalMode cape';
assertEqual(PLAN_FIELDS.join(' '), expected, 'Vollständige abgegrenzte Feldliste ohne Personen-/Vermögenswerte');
const scope = planScope('household', ['z', 'a']), outsider = planScope('single', ['outside']);
assertEqual(scope.key, '["household",["a","z"]]', 'Bereich sortiert und dedupliziert');
assert(PLAN_FIELD_PATHS.includes('cape.source') && PLAN_FIELD_PATHS.includes('decumulation.mode'), 'Kanonische verschachtelte Feldpfade');
const values = { ...structuredClone(PLAN_DEFAULTS), dynamicFlex: true, cape: { value: 0, asOf: null, source: null } };
assertPlanValues(values);
assertEqual(projectPlanToBalance(values).dynamicFlex, true, 'Nutzerentscheidung bleibt bei CAPE 0 erhalten');
assertEqual(projectPlanToBalance(values).floorBedarf, 12000, 'Bedarf bleibt jährliche Euro');
assertEqual(projectPlanToBalance(values).liquidityRunwayYears, 5, 'Reichweite bleibt Jahre');
const first = buildPlanRecord(null, [{ scope, values }, { scope: outsider, values: structuredClone(PLAN_DEFAULTS) }], { now: () => new Date('2026-10-09T12:00:00Z') });
const reversed = Object.fromEntries(Object.entries(values).reverse());
const same = buildPlanRecord(first.raw, [{ scope, values: reversed }], { now: () => new Date('2027-01-01') });
assertEqual(same.raw, first.raw, 'Identischer Inhalt erhält Rohrecord und Zeitstempel');
for (const invalid of [{ minimumFlexAnnual: 24001 }, { minCashBufferMonths: 1.5 }, { liquidityRunwayYears: 3.1 }, { dynamicFlex: 'true' }, { unknown: 1 }, { longevityMode: 'future' }]) {
    let failed = false; try { assertPlanValues({ ...values, ...invalid }); } catch { failed = true; }
    assert(failed, 'Ungültige Werte werden zurückgewiesen: ' + Object.keys(invalid)[0]);
}
for (const raw of ['{', '{"version":2,"entries":{}}', '{"version":1,"entries":{"x":{}}}']) {
    const status = readHouseholdPlan({ scope, storage: { getItem: () => raw } });
    assertEqual(status.status, 'invalid', 'Beschädigte/zukünftige Records unterscheiden sich von fehlend');
}
const map = new Map([[HOUSEHOLD_PLAN_KEY, first.raw]]);
const backend = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key), key: i => [...map.keys()][i] ?? null, get length() { return map.size; } };
try {
    P.resetPersistenceForTests(createLocalStorageAdapter(backend)); await P.init({ installLifecycleHooks: false });
    const previous = P.getItemSync(HOUSEHOLD_PLAN_KEY);
    await patchHouseholdPlan({ scope, patch: { dynamicFlex: true }, storage: persistenceStorage });
    assertEqual(P.getItemSync(HOUSEHOLD_PLAN_KEY), previous, 'Idempotenter produktiver Patch schreibt keine Bytes');
    await patchHouseholdPlan({ scope, patch: { flexBedarf: 25000 }, storage: persistenceStorage, now: () => new Date('2026-10-10') });
    const patched = assertHouseholdPlanRecord(P.getItemSync(HOUSEHOLD_PLAN_KEY));
    assertEqual(patched.entries[scope.key].values.flexBedarf, 25000, 'Bestätigter Patch im gewählten Bereich');
    assertEqual(JSON.stringify(patched.entries[outsider.key]), JSON.stringify(first.record.entries[outsider.key]), 'Außenperson bleibt bytegleich isoliert');
    let rejected = false;
    try { await patchHouseholdPlan({ scope, patch: { minimumFlexAnnual: 26000 }, storage: persistenceStorage }); } catch { rejected = true; }
    assert(rejected && assertHouseholdPlanRecord(P.getItemSync(HOUSEHOLD_PLAN_KEY)).entries[scope.key].values.minimumFlexAnnual === 0, 'Mindest-Flex wird ohne Write oder Clamping abgewiesen');
} finally { P.resetPersistenceRuntimeForTests(); }
