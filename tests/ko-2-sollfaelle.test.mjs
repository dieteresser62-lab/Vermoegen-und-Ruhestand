// KO-2 (Ergänzung FR-76, Nutzer 12.11.2026): Fondskosten als Planwert, auch in der erwarteten Rendite des Dynamic Flex.
// Von Hand hergeleitete Sollfälle als dauerhafte Node-Tests. Nur synthetische Daten: Beispielhaushalte.
import { netEquityReturn, readYearReturnRates } from '../app/simulator/simulator-year-portfolio.js';
import { deriveVpwExpectedRealReturn } from '../engine/planners/vpw-return-policy.mjs';
import { CONFIG } from '../engine/config.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';
import { annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { evaluateBalanceFileInputs } from '../app/balance/balance-file-service.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { createBalanceDisplayEngineApi } from '../app/balance/balance-update-pipeline.js';
import { projectBalanceBudget } from '../app/balance/balance-budget.js';
import { readHouseholdPlan, projectPlanToSimulator, projectPlanToBalance, planScope, HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { analyzeHouseholdPlanMigration } from '../app/profile/household-plan-migration.js';
import { sourceFingerprint } from '../app/overview/overview-simulation-summary.js';
import { overviewScope } from '../app/overview/overview-storage.js';
import { simulatorDocument } from './simulator-page-fixture.mjs';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initDynamicFlexControls } from '../app/simulator/simulator-main-dynamic-flex.js';
import { initSimulatorProfileSelection } from '../app/simulator/simulator-main-profiles.js';
import { initSimulatorPlanTrial } from '../app/simulator/simulator-plan-trial.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio.js';

const DATE = '2026-10-23';

/** Beispielhaushalt mit geändertem Plan; `undefined` bei k lässt das Feld weg wie in alten Ständen. */
function records(id, { preset = null, k } = {}) {
    const data = createMusterHaushaltRecords(DATE, id), plan = JSON.parse(data[HOUSEHOLD_PLAN_KEY]);
    for (const entry of Object.values(plan.entries)) {
        if (preset) Object.assign(entry.values, dynamicFlexPresetPatch(preset));
        if (k !== undefined) entry.values.equityCostPct = k;
    }
    data[HOUSEHOLD_PLAN_KEY] = JSON.stringify(plan);
    return data;
}
async function memoryArea(data) {
    P.resetPersistenceForTests({ name: 'ko-2-synthetic', loadAll: async () => ({ ...data }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete data[key]); batch.upserts.forEach(([key, value]) => { data[key] = value; }); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
/** Balance-Jahresbudget 2026 wie die Seite: Haushalt aus dem Speicher, Engine, Monatsbudget × 12. */
async function balanceBudget(data) {
    await memoryArea(data);
    setAppTestDate(DATE);
    try {
        const storage = annualRecordStorage(data), api = createBalanceDisplayEngineApi(EngineAPI);
        const calculation = buildBalanceEngineInputFromStorage({ storage }), plan = calculation.householdPlan;
        const evaluation = evaluateBalanceFileInputs({ inputData: calculation.inputData, persistentState: calculation.history.persistentState,
            profiles: calculation.history.profiles, profileId: data.rs_current_profile, engineApi: api, publish: false,
            planInputs: plan.entry.values, marketPreviewContext: { calculation, storage },
            profilverbundHandlers: { runProfilverbundProfileSimulations: (input, profiles, state) => evaluateStoredAnnualHousehold(input, profiles, state,
                { engineApi: api, publish: false, withdrawalMode: plan.entry.values.householdWithdrawalMode }) } });
        const { budget } = projectBalanceBudget({ ...evaluation.modelResult.ui, input: evaluation.previewInputData || calculation.inputData });
        return { annual: budget * 12, engineInput: calculation.engineInput, result: evaluation.modelResult };
    } finally { P.resetPersistenceForTests(); setAppTestDate(null); }
}

// S1: erwartete Rendite e = 5 %, k = 0,5 % → 4,475 %; k = 0 unverändert.
assertClose(netEquityReturn(0.05, 0.5), 0.04475, 1e-12, 'S1: 5 % nach 0,5 % Fondskosten = 4,475 %');
assert(Object.is(netEquityReturn(0.05, 0), 0.05), 'S1: k = 0 lässt die erwartete Rendite unverändert');
{
    // Beide Methoden der erwarteten Rendite: CAPE 32,5 liegt auf dem Stützpunkt 5 % nominal (legacy_step).
    const base = { capeRatio: 32.5, equityWeightPct: 100, goldAktiv: false };
    const inflation = CONFIG.SPENDING_MODEL.DYNAMIC_FLEX.LONG_TERM_INFLATION;
    const legacy = k => deriveVpwExpectedRealReturn({ ...base, returnPolicy: 'legacy_step', equityCostPct: k });
    assertClose(legacy(undefined).equityContribution + inflation, 0.05, 1e-12, 'S1: legacy_step ohne Kosten rechnet mit e = 5 %');
    assertClose(legacy(0.5).equityContribution + inflation, 0.04475, 1e-12, 'S1: legacy_step mindert e auf 4,475 %');
    assertClose(legacy(0.5).expectedRealReturnRaw, 0.04475 - inflation, 1e-12, 'S1: legacy_step reale Erwartung = 4,475 % − Inflation');
    assertEqual(JSON.stringify(legacy(0)), JSON.stringify(legacy(undefined)), 'S1: legacy_step mit k = 0 bytegleich zu ohne Wert');
    const continuous = k => deriveVpwExpectedRealReturn({ ...base, returnPolicy: 'cape_continuous', equityCostPct: k });
    const e = continuous(undefined).equityRealReturn;
    assertClose(continuous(0.5).equityContribution, (1 + e) * (1 - 0.005) - 1, 1e-12, 'S1: cape_continuous mindert die erwartete Aktienrendite ebenso');
    assertEqual(continuous(0.5).equityRealReturn, e, 'S1: cape_continuous meldet die Marktannahme weiter ohne Kosten');
    assertEqual(JSON.stringify(continuous(0)), JSON.stringify(continuous(undefined)), 'S1: cape_continuous mit k = 0 bytegleich zu ohne Wert');
}

// S2: Max und Erika am 23.10.2026, Jahresbudget 2026.
{
    const plain = await balanceBudget(records('max-erika'));
    assertEqual(plain.annual, 60000, 'S2: Max und Erika ohne Dynamic Flex 60.000 €');
    assert(!Object.hasOwn(plain.engineInput, 'equityCostPct'), 'S2: Ohne Dynamic Flex bekommt die Engine keine Fondskosten (bytegleich)');
    const dynamic = await balanceBudget(records('max-erika', { preset: 'ausgewogen' }));
    // Mit LE-1 (FR-75) rechnet Dynamic Flex mit dem Horizont der Kohortentafel: 33 statt 31 Jahre. Ohne LE-1 waren es 68.400 € statt 70.800 €.
    assertEqual(dynamic.engineInput.horizonYears, 33, 'S2: Horizont nach FR-75 (Kohortentafel) 33 Jahre');
    assertEqual(dynamic.annual, 67200, 'S2: Max und Erika mit Dynamic Flex „Ausgewogen“ 67.200 € statt 69.600 € (mit Horizont nach FR-75)');
    assertEqual(dynamic.engineInput.equityCostPct, 0.5, 'S2: Balance gibt mit Dynamic Flex die Vorgabe 0,5 % an die Engine');
    const withoutCost = await balanceBudget(records('max-erika', { preset: 'ausgewogen', k: 0 }));
    assertEqual(withoutCost.annual, 69600, 'S2: Mit Planwert 0 % bleibt es beim Wert ohne Fondskosten, 69.600 € (mit Horizont nach FR-75)');
    assert(!Object.hasOwn(withoutCost.engineInput, 'equityCostPct'), 'S3: Mit 0 % bleibt die Balance-Eingabe wie ohne Fondskosten');
}

// S3: Planrecord ohne Fondskosten → 0,5; Wert 0 → kein Abzug, weder in der Erwartung noch in der Jahresrendite.
{
    const data = records('max-erika'), raw = data[HOUSEHOLD_PLAN_KEY];
    assert(!raw.includes('equityCostPct'), 'S3: Beispielplan speichert keine Fondskosten');
    const registry = JSON.parse(data.rs_profiles_v1), scope = planScope('household', Object.keys(registry.profiles));
    const plan = readHouseholdPlan({ scope, storage: { getItem: key => data[key] ?? null } });
    assertEqual(plan.entry.values.equityCostPct, 0.5, 'S3: Fehlendes Feld liest sich als 0,5');
    assertEqual(plan.raw, raw, 'S3: Lesen schreibt nichts');
    assertEqual(projectPlanToSimulator(plan.entry.values).equityCostPct, 0.5, 'S3: Simulator übernimmt die Vorgabe aus dem Plan');
    assert(!Object.hasOwn(projectPlanToBalance(plan.entry.values), 'equityCostPct'), 'S3: Balance ohne Dynamic Flex ohne Fondskosten');
    const zero = { ...plan.entry.values, equityCostPct: 0 };
    assertEqual(projectPlanToSimulator(zero).equityCostPct, 0, 'S3: Planwert 0 erreicht den Simulator');
    assert(Object.is(readYearReturnRates({ rendite: 0.1 }, 0).rA, 0.1), 'S3: Mit 0 % bleibt die Jahresrendite unverändert');
    assertClose(readYearReturnRates({ rendite: 0.1 }, 0.5).rA, 0.0945, 1e-12, 'S3: Mit 0,5 % sinkt die Jahresrendite einmal auf 9,45 %');
}
{
    // Der Simulator liest den Planwert; der frühere Schlüssel sim_equityCostPct wird weder gelesen noch geschrieben.
    const data = records('max-erika', { k: 0.2 });
    const registry = JSON.parse(data.rs_profiles_v1);
    for (const profile of Object.values(registry.profiles)) profile.data.sim_equityCostPct = '0';
    data.rs_profiles_v1 = JSON.stringify(registry); data.sim_equityCostPct = '0';
    const before = data[HOUSEHOLD_PLAN_KEY];
    await memoryArea(data);
    setAppTestDate(DATE);
    const saved = { document: globalThis.document, window: globalThis.window };
    try {
        globalThis.document = simulatorDocument();
        globalThis.window = { EngineAPI, addEventListener() {}, removeEventListener() {} };
        initInputPersistence(); initDynamicFlexControls({ enableLocalPersistence: false });
        initSimulatorProfileSelection(); initSimulatorPlanTrial();
        assertEqual(getCommonInputs().equityCostPct, 0.2, 'S3: Simulator rechnet mit dem Planwert 0,2 %, nicht mit dem alten Schlüssel');
        assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), before, 'S3: Start des Simulators schreibt den Plan nicht');
        assertEqual(persistenceStorage.getItem('sim_equityCostPct'), '0', 'S3: Der alte Schlüssel bleibt unberührt');
    } finally { Object.assign(globalThis, saved); P.resetPersistenceForTests(); setAppTestDate(null); }
    const legacy = createMusterHaushaltRecords(DATE, 'renate');
    delete legacy[HOUSEHOLD_PLAN_KEY];
    legacy.sim_equityCostPct = '0';
    const reg = JSON.parse(legacy.rs_profiles_v1);
    for (const profile of Object.values(reg.profiles)) profile.data.sim_equityCostPct = '0';
    legacy.rs_profiles_v1 = JSON.stringify(reg);
    const analysis = analyzeHouseholdPlanMigration(legacy).analyses[0];
    assertEqual(analysis.values.equityCostPct, 0.5, 'S3: Planumstellung übernimmt den alten Simulator-Schlüssel nicht');
}

// S4: Der Fingerprint der Übersicht folgt dem Planwert.
{
    const fingerprint = (data, kind) => {
        const registry = JSON.parse(data.rs_profiles_v1);
        return sourceFingerprint({ registry, activeId: data.rs_current_profile, liveData: data,
            scope: overviewScope('household', Object.keys(registry.profiles)), kind });
    };
    for (const kind of ['montecarlo', 'backtest']) {
        const missing = fingerprint(records('max-erika'), kind);
        assert(typeof missing === 'string', `S4: ${kind}-Fingerprint lesbar`);
        assertEqual(fingerprint(records('max-erika', { k: 0.5 }), kind), missing, `S4: ${kind} fehlend = 0,5 %`);
        assert(fingerprint(records('max-erika', { k: 0.3 }), kind) !== missing, `S4: ${kind} ändert sich mit dem Planwert`);
    }
    const balance = fingerprint(records('max-erika'), 'balance');
    assertEqual(fingerprint(records('max-erika', { k: 0.3 }), 'balance'), balance, 'S4: Balance ohne Dynamic Flex unabhängig von den Fondskosten');
    const dynamic = fingerprint(records('max-erika', { preset: 'ausgewogen' }), 'balance');
    assert(fingerprint(records('max-erika', { preset: 'ausgewogen', k: 0.3 }), 'balance') !== dynamic, 'S4: Balance mit Dynamic Flex ändert sich mit dem Planwert');
}
