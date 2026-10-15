import { selectGuardrailPlanInputs, shouldResetGuardrailState, applyGuardrailPlanChange } from '../app/shared/guardrail-history.js';
import { PLAN_DEFAULTS, PLAN_FIELD_PATHS, buildPlanRecord, HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { prepareEngineLastState, projectBalancePlanHistory, persistBalanceUpdate, BALANCE_UPDATE_MODE } from '../app/balance/balance-update-pipeline.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { computeAnnualPlanUpdate, annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { evaluateAnnualDraft, prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { readyAnnualFixture, annualTestMarketData, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { EngineAPI } from '../engine/index.mjs';
import { runFixture, records, source } from './extended/parity-replay-fixture.mjs';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { createParityReplayCollector } from '../app/simulator/parity-replay-collector.js';
import { validateParityReplayLog } from '../app/simulator/parity-replay-contract.js';

const json = JSON.stringify, copy = structuredClone, key = CONFIG.STORAGE.LS_KEY;
const plan = copy(PLAN_DEFAULTS);
const history = { initialized: true, flexRate: 60, peakRealVermoegen: 900000,
    cumulativeInflationFactor: 1.1, vpwSafetyStage: 2, taxState: { lossCarry: 1234 } };
const beforeBytes = json({ plan, history });
for (const path of PLAN_FIELD_PATHS.filter(path => !path.startsWith('cape.'))) {
    const changed = copy(plan), parts = path.split('.'), field = parts.pop();
    const target = parts.reduce((value, part) => value[part], changed), old = target[field];
    target[field] = typeof old === 'boolean' ? !old : typeof old === 'string' ? `${old}_changed` : old === null ? 1 : old + 0.01;
    assert(shouldResetGuardrailState(plan, changed), `Bewusster Planwert setzt Historie auch bei kleiner Änderung zurück: ${path}`);
    assertEqual(json(applyGuardrailPlanChange(history, plan, changed)), '{"taxState":{"lossCarry":1234}}', `${path}: Steuerstand bleibt erhalten`);
}
assert(!shouldResetGuardrailState(plan, copy(plan)), 'No-op und reine Darstellung erhalten die Historie');
assert(!shouldResetGuardrailState({}, plan), 'Fehlende Altbelege erfinden keine bewusste Planänderung');
assert(!shouldResetGuardrailState(null, plan), 'Altbestand ohne Planbeleg bleibt lesbar');
assert(!shouldResetGuardrailState(plan, { ...plan, cape: { value: 40, asOf: '2027-01-01', source: 'synthetic' },
    endeVJ: 50, endeVJ_1: 100, ath: 120, jahreSeitAth: 5, inflation: 25, aktuellesAlter: 80,
    tagesgeld: 100000, geldmarktEtf: 0, depotwertAlt: 200000, depotwertNeu: 0, goldWert: 20000,
    renteAktiv: true, renteMonatlich: 4000 }), 'Jahr, Markt, Inflation, Vermögen und Einkommen sind keine Planentscheidung');
assertEqual(json(selectGuardrailPlanInputs({ ...plan, floorBedarf: undefined, flexBedarf: undefined,
    startFloorBedarf: plan.floorBedarf, startFlexBedarf: plan.flexBedarf })), json(selectGuardrailPlanInputs(plan)), 'Simulatornamen und Balanceplan verwenden denselben Vertrag');
assert(!shouldResetGuardrailState({ ...plan, horizonYears: 30 }, { ...plan, horizonYears: 29, guardrailPlanHorizonYears: 30 }), 'Automatisch abgeleitete Restdauer ändert die Planentscheidung nicht');
const isolated = prepareEngineLastState({ inputs: plan, lastState: history }, plan);
isolated.taxState.lossCarry = 0;
assertEqual(json({ plan, history }), beforeBytes, 'Vorschau und Steuerkopie verändern keinen gespeicherten Zustand');

// Echte Speicherleser, Indexierung und FR-3-Rechnung für drei Auswahlkontexte.
for (const kind of ['Einzelprofil', 'Muster-Haushalt', 'aktive Außenperson']) {
    const sample = readyAnnualFixture(kind), { scope, values } = sample;
    const initial = buildBalanceEngineInputFromStorage({ storage: annualRecordStorage(sample.records), referenceYear: 2026 });
    const lastState = { ...EngineAPI.simulateSingleYear(initial.engineInput, null).newState, marker: 'alte Historie', taxState: { lossCarry: 1234 } };
    const registry = JSON.parse(sample.records.rs_profiles_v1);
    for (const profile of Object.values(registry.profiles)) {
        const state = JSON.parse(profile.data[key]);
        state.lastState = copy(lastState);
        state.profilverbundHouseholdLastState = copy(lastState);
        profile.data[key] = json(state);
    }
    sample.records.rs_profiles_v1 = json(registry);
    sample.records[key] = registry.profiles[sample.records.rs_current_profile].data[key];
    const root = JSON.parse(sample.records[key]);
    root.balanceStateLifecycle = { planInputEvidence: { [scope.key]: selectGuardrailPlanInputs(values) } };
    root.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'synthetic-before', phase: 'writes_started' };
    sample.records[key] = json(root);
    if (kind === 'aktive Außenperson') {
        const outside = copy(root);
        delete outside.balanceStateLifecycle;
        outside.inputs.floorBedarf = 12000;
        const legacy = buildBalanceEngineInputFromStorage({ storage: annualRecordStorage({ ...sample.records, [key]: json(outside) }), referenceYear: 2026 });
        assertEqual(legacy.engineLastState.marker, 'alte Historie', 'Außenpersonenplan wird ohne Altbeleg nicht zur Haushaltsresetevidenz');
    }
    const bytes = json(sample.records), storage = annualRecordStorage(sample.records);
    const marketData = { ...annualTestMarketData, inflation: { ...annualTestMarketData.inflation, rate: 25 } };
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, scope, storage, marketData, now: annualTestNow });
    const recommended = evaluateAnnualDraft(draft, { engineApi: EngineAPI });
    assertEqual(recommended.calculation.engineLastState.marker, 'alte Historie', `${kind}: auch 25 Prozent automatische Inflation erhält die Historie`);
    const adjusted = evaluateAnnualDraft(draft, { engineApi: EngineAPI, adoptedPlanPatch: { floorBedarf: draft.values.floorBedarf + 1 } });
    assertEqual(json(adjusted.calculation.engineLastState), '{"taxState":{"lossCarry":1234}}', `${kind}: FR-3 setzt bei einem Euro bewusster Bedarfsänderung zurück`);
    assertEqual(evaluateAnnualDraft(draft, { engineApi: EngineAPI }).calculation.engineLastState.marker, 'alte Historie', `${kind}: Verwerfen stellt dieselbe historische Basis wieder her`);
    const cape = evaluateAnnualDraft(draft, { engineApi: EngineAPI, adoptedPlanPatch: { cape: { value: 10 } } });
    assertEqual(cape.calculation.engineLastState.marker, 'alte Historie', `${kind}: CAPE-Patch ist eine Marktänderung`);
    const reserve = evaluateAnnualDraft(draft, { engineApi: EngineAPI, adoptedPlanPatch: { liquidityRunwayYears: 7 } });
    assertEqual(json(reserve.calculation.engineLastState), '{"taxState":{"lossCarry":1234}}', `${kind}: bewusste Reserveplanung setzt dieselben Felder zurück`);
    const committed = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now: annualTestNow,
        adoptedPlanPatch: { floorBedarf: draft.values.floorBedarf + 1 } });
    assertEqual(json(committed.receipt.adjustedFields), '["floorBedarf"]', `${kind}: FR-3 belegt genau das bewusst geänderte Feld`);
    const loaded = buildBalanceEngineInputFromStorage({ storage: annualRecordStorage({ ...sample.records, ...committed.records }), referenceYear: 2027 });
    assertEqual(json(loaded.engineLastState), json({ ...committed.result.modelResult.newState,
        ...(loaded.profiles.length > 1 ? { taxState: { lossCarry: 0 } } : {}) }), `${kind}: bestätigter Beschluss wird beim Neuladen nicht erneut zurückgesetzt`);
    assertEqual(json(sample.records), bytes, `${kind}: Vorschau, Verwerfen und Commitvorbereitung lassen Quellrecords unverändert`);

    // Bewusste unterjährige Änderung darf durch den kommenden Inflationsschritt nicht verschwinden.
    const patched = { ...values, floorBedarf: values.floorBedarf + 1 };
    storage.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(storage.getItem(HOUSEHOLD_PLAN_KEY), [{ scope, values: patched }], { now: annualTestNow }).raw);
    const pendingDraft = computeAnnualPlanUpdate({ targetYear: 2026, scope, storage, marketData, now: annualTestNow });
    assertEqual(json(evaluateAnnualDraft(pendingDraft, { engineApi: EngineAPI }).calculation.engineLastState), '{"taxState":{"lossCarry":1234}}', `${kind}: Inflation erhält eine bereits bewusste Planänderung als Resetgrund`);
}

// Eingabebestätigung ist kein Jahrescommit. Die Resetevidenz bleibt bis dahin alt.
{
    const { records: initialRecords, scope, values } = readyAnnualFixture('Einzelprofil');
    let persistentState = { inputs: values, lastState: history };
    const changedValues = { ...values, minimumFlexAnnual: values.minimumFlexAnnual + 1 };
    const householdPlan = { status: 'valid', scope, entry: { values: changedValues } };
    persistBalanceUpdate({ mode: BALANCE_UPDATE_MODE.PERSIST_INPUTS, householdPlan, persistentState,
        inputData: changedValues, storageManager: { loadState: () => persistentState, saveState: state => { persistentState = state; } } });
    const reloaded = JSON.parse(json(persistentState));
    const projected = projectBalancePlanHistory(reloaded, [], householdPlan);
    assertEqual(json(prepareEngineLastState(projected.persistentState, changedValues)), '{"taxState":{"lossCarry":1234}}', 'Eingabebestätigung und Neuladen verlieren den ausstehenden Reset nicht');
    assertEqual(reloaded.lastState.flexRate, 60, 'Eingabebestätigung schreibt keine historische Flexrate fort');
    assert(initialRecords[HOUSEHOLD_PLAN_KEY], 'Bestandsplan bleibt ohne Schemamigration lesbar');
}

// Simulator: normaler Mehrjahrespfad, bewusster Reservepatch, unverändertes Folgejahr.
for (const changePlan of [false, true]) {
    const boundaries = [], collector = createParityReplayCollector({ initialRecords: records, source });
    runFixture({ collector, simulate(state, inputs, yearData, index) {
        const raw = copy(state);
        const actualInputs = changePlan && index > 0 ? { ...inputs, liquidityRunwayYears: 7 } : inputs;
        const result = simulateOneYear(state, actualInputs, yearData, index, null, 0, null, 1,
            { ...EngineAPI, simulateSingleYear(input, lastState) {
                boundaries.push({ lastState: copy(lastState), before: raw.lastState });
                return EngineAPI.simulateSingleYear(input, lastState);
            } }, collector);
        return result;
    } });
    assertEqual(boundaries.length, 3, 'Drei echte Simulatorjahre laufen durch die gemeinsame Regel');
    if (changePlan) assertEqual(json(boundaries[1].lastState), json({ taxState: boundaries[1].before.taxState }), 'Simulator setzt bei bewusster Planänderung denselben Steuerrest ein wie Balance');
    else assertEqual(boundaries[1].lastState.flexRate, boundaries[1].before.flexRate, 'Simulator erhält die Vorjahres-Flexrate bei Markt- und Inflationswechsel');
    assertEqual(boundaries[2].lastState.flexRate, boundaries[2].before.flexRate, 'Unverändertes Folgejahr setzt die neue Historie fort');
    const log = JSON.parse(json(collector.toLog()));
    assertEqual(log.years[1].resetEvidence.simulatorResetApplied, changePlan, 'Collector belegt die wirkliche Resetentscheidung');
    assert(validateParityReplayLog(log).valid, 'Altes Replayformat liest auch bewusste Planresets');
    assert(!validateParityReplayLog(log).issues.some(issue => issue.question === 5), 'FR-12 ist keine offene Fachfrage mehr');
}
