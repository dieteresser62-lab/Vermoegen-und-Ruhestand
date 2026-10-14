import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { createSelectionDocument, addField, simulatorSelectOptions, functionSource } from './designsystem-selection-dom.mjs';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { PLAN_DEFAULTS, HOUSEHOLD_PLAN_KEY, planScope, buildPlanRecord, readBalanceHouseholdPlan,
    projectPlanToBalance, stripBalancePlanInputs, stageBalancePlanPatch } from '../app/profile/household-plan.js';
import { getBalancePlanTrial, initBalancePlanTrial, renderBalancePlanTrial, BALANCE_PLAN_FIELD_MAP } from '../app/balance/balance-plan-trial.js';
import { getSimulatorPlanTrial, initSimulatorPlanTrial, renderSimulatorPlanTrial } from '../app/simulator/simulator-plan-trial.js';
import { SIMULATOR_PLAN_FIELD_MAP } from '../app/profile/household-plan.js';
import { readBoundHouseholdPlanField } from '../app/shared/household-plan-fields.js';
import { initDynamicFlexControls, refreshDynamicFlexControls } from '../app/simulator/simulator-main-dynamic-flex.js';
import { UIReader, initUIReader } from '../app/balance/balance-reader.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { renderBalanceInflationSource } from '../app/balance/balance-inflation-source.js';
import { StorageManager, initStorageManager } from '../app/balance/balance-storage.js';
import { UIBinder, initUIBinder, preserveUIBinderStateForTests } from '../app/balance/balance-binder.js';
import { createProfilverbundHandlers } from '../app/balance/balance-main-profilverbund.js';
import { createProfileSyncHandlers } from '../app/balance/balance-main-profile-sync.js';
import { PROFILE_VALUE_KEYS } from '../app/profile/profile-state.js';
import { readBalancePersonStatus, showPersonDataStatus } from '../app/shared/person-data-status.js';
import { evaluateBalanceFileInputs } from '../app/balance/balance-file-service.js';
import { postprocessBalanceAction } from '../app/balance/balance-action-postprocessor.js';
import { buildBalanceOverviewSummary } from '../app/overview/overview-model.js';
import { storeOverviewSummary, overviewScope } from '../app/overview/overview-storage.js';
import { UIUtils } from '../app/balance/balance-utils.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { EngineAPI } from '../engine/index.mjs';
import * as pipeline from '../app/balance/balance-update-pipeline.js';
import { setAppTestDate, getAppTestDate } from '../app/shared/app-clock.js';

const original = { document: globalThis.document, window: globalThis.window, date: getAppTestDate() };
const restoreBinder = preserveUIBinderStateForTests();
const values = { ...structuredClone(PLAN_DEFAULTS), floorBedarf: 18000, flexBedarf: 18000,
    cape: { value: 25, asOf: null, source: null }, dynamicFlex: true };
const bytes = () => JSON.stringify(P.exportAllSync().records);
const numeric = field => readBoundHouseholdPlanField(field) ?? Number(field.value);
function makeDoc(map, prefix) {
    const doc = createSelectionDocument();
    doc.addEventListener = () => {}; doc.dispatchEvent = () => {}; doc.createDocumentFragment = () => doc.createElement('div');
    const selects = { ...Object.fromEntries(['entnahmeStrategie', 'horizonMethod', 'longevityMode', 'dynamicFlexPreset'].map(id => [id, simulatorSelectOptions(id)])),
        'profilverbund-withdrawal-mode': [['tax_optimized', 'Steueroptimiert'], ['proportional', 'Anteilig'], ['runway_first', 'Nacheinander']] };
    for (const id of [...Object.keys(map), 'dynamicFlexPreset', 'dynamicFlexShowAdvanced', 'rebalancingBand', 'inflation']) {
        const field = addField(doc, id, '', selects[id]);
        if (['dynamicFlex', 'goGoActive', 'dynamicFlexShowAdvanced'].includes(id)) field.type = 'checkbox';
        field.setCustomValidity = value => field.validationMessage = value;
    }
    for (const suffix of ['Start', 'Band', 'Differences', 'Message', 'Status', 'Back', 'Adopt', 'Result']) {
        const node = addField(doc, prefix + suffix); node.click = () => node.dispatchEvent({ type: 'click', target: node, currentTarget: node });
    }
    const second = addField(doc, 'secondTrialHead'); second.click = () => second.dispatchEvent({ type: 'click', target: second, currentTarget: second }); second.dataset.planTrialToggle = '';
    const query = doc.querySelectorAll.bind(doc);
    doc.querySelectorAll = selector => selector === '[data-plan-trial-toggle]' ? [second] : query(selector);
    doc.getElementById('rebalancingBand').value = '25';
    return doc;
}
async function install(count) {
    const records = createMusterHaushaltRecords('2026-10-09');
    const registry = JSON.parse(records.rs_profiles_v1);
    if (count === 1) delete registry.profiles.muster_b;
    records.rs_profiles_v1 = JSON.stringify(registry);
    const scope = planScope('household', Object.keys(registry.profiles));
    records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope, values }]).raw;
    records.overview_balance_summary_v1 = JSON.stringify({ version: 1, entries: {} });
    const data = new Map(Object.entries(records));
    const backend = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
        removeItem: key => data.delete(key), key: i => [...data.keys()][i] ?? null, get length() { return data.size; } };
    P.resetPersistenceForTests(createLocalStorageAdapter(backend)); await P.init({ installLifecycleHooks: false });
    return { scope, backend };
}
try {
    setAppTestDate('2026-10-09');
    for (const [page, map, prefix, get, init, render] of [
        ['Balance', BALANCE_PLAN_FIELD_MAP, 'balancePlanTrial', getBalancePlanTrial, initBalancePlanTrial, renderBalancePlanTrial],
        ['Simulator', SIMULATOR_PLAN_FIELD_MAP, 'simPlanTrial', getSimulatorPlanTrial, initSimulatorPlanTrial, renderSimulatorPlanTrial]
    ]) {
        await install(2); const doc = makeDoc(map, prefix); globalThis.document = doc;
        globalThis.window = { EngineAPI, addEventListener() {} };
        let chosenRows = [];
        init({ doc, refresh() {}, requestChoice: async options => { chosenRows = options.rows; return Object.fromEntries(options.rows.map(row => [row.id, row.id === 'flexBedarf' ? 'adopt' : 'keep'])); } }); render(doc, { project: true });
        const id = page === 'Balance' ? 'flexBedarf' : 'startFlexBedarf';
        const trial = get(doc), before = bytes();
        assert(Object.keys(map).every(id => doc.getElementById(id).disabled), page + ': sämtliche Planfelder einschließlich Details zunächst lesend');
        doc.getElementById(prefix + 'Start').click();
        assert(trial.read().active && !doc.getElementById(id).disabled, page + ': erster Kopf öffnet beide Bereiche');
        trial.update({ flexBedarf: 24000, minimumFlexAnnual: 5000 }); render(doc, { project: true });
        assertEqual(numeric(doc.getElementById(id)), 24000, page + ': gleiche Versuchsprojektion');
        trial.updateLocal({ rebalancingBand: 18 });
        await P.flush(); assertEqual(bytes(), before, page + ': Entwurf und lokale Goldwerte schreiben nichts');
        const cancelled = await trial.adopt(() => null);
        assert(cancelled.status === 'cancelled' && trial.read().active, page + ': Abbruch behält den lokalen Versuch');
        const adoptButton = doc.getElementById(prefix + 'Adopt');
        await adoptButton.listeners.click[0]({ currentTarget: adoptButton }); await P.flush(); render(doc, { project: true });
        assert(chosenRows.some(row => row.id === 'flexBedarf') && !chosenRows.some(row => row.id === 'rebalancingBand'), page + ': echter Übernahmehandler bietet nur Planfelder zur Auswahl');
        assertEqual(readBalanceHouseholdPlan().entry.values.flexBedarf, 24000, page + ': nur gewählter Bedarf übernommen');
        assertEqual(readBalanceHouseholdPlan().entry.values.minimumFlexAnnual, values.minimumFlexAnnual, page + ': nicht gewähltes Feld bleibt Plan');
        assertEqual(Number(doc.getElementById('rebalancingBand').value), 25, page + ': Gold bleibt lokal und kehrt zurück');
        doc.getElementById('secondTrialHead').click(); assert(trial.read().active, page + ': zweiter Kopf startet denselben Besitzer');
        trial.update({ flexBedarf: 27000 });
        doc.getElementById(prefix + 'Start').click();
        assert(!trial.read().active && numeric(doc.getElementById(id)) === 24000, page + ': erster Kopf kehrt zum aktuellen Plan zurück');
        trial.start(); trial.update({ minimumFlexAnnual: 30000 }, { validate: false });
        let rejected = false; try { await trial.adopt(() => ['minimumFlexAnnual']); } catch { rejected = true; }
        assert(rejected, page + ': ungültige Auswahl wird nicht gespeichert'); trial.reset();
        initDynamicFlexControls({ enableLocalPersistence: page !== 'Balance' });
        doc.getElementById('dynamicFlexPreset').value = 'offensiv'; doc.getElementById('dynamicFlexPreset').dispatchEvent({ type: 'change' });
        refreshDynamicFlexControls(); assert(doc.getElementById('horizonYears').disabled, page + ': Dynamik hebt Lesesperre nicht auf');
        assertEqual(readBalanceHouseholdPlan().entry.values.dynamicFlex, values.dynamicFlex, page + ': programmatisches Preset schreibt keinen Plan');
        trial.start(); doc.getElementById('dynamicFlexPreset').value = 'offensiv'; doc.getElementById('dynamicFlexPreset').dispatchEvent({ type: 'change' });
        assertEqual(trial.values().horizonYears, 25, page + ': Preset wirkt auf lokalen Versuch');
        const reload = makeDoc(map, prefix); assert(!get(reload).read().active, page + ': Reload verliert den Entwurf');
    }
    // Produktiver Update-Funktionskörper + echte Reader-, Binder-, Speicher- und Enginepfade.
    for (const count of [1, 2]) {
        const { backend, scope } = await install(count); const doc = makeDoc(BALANCE_PLAN_FIELD_MAP, 'balancePlanTrial');
        globalThis.document = doc; const seen = [], errors = [];
        const engine = { ...EngineAPI, simulateSingleYear(input, state) { seen.push(structuredClone(input)); return EngineAPI.simulateSingleYear(input, state); } };
        globalThis.window = { EngineAPI: engine, addEventListener() {} };
        const state = { engineHandshake: pipeline.createEngineHandshake(engine, ''), pendingInputMetadata: {} };
        const dom = { inputs: Object.fromEntries(doc.querySelectorAll('input, select').filter(field => field.id).map(field => [field.id, field])),
            controls: {}, outputs: {}, containers: {}, diagnosis: {} };
        // Auch die vorhandenen Vermögens-/Marktdatenbrücken stehen dem Reader zur Verfügung.
        const stored = JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY));
        for (const [id, value] of Object.entries({ ...stored.inputs, ...projectPlanToBalance(values), aktuellesAlter: 67 })) {
            if (value && typeof value === 'object') continue;
            let field = doc.getElementById(id); if (!field) field = addField(doc, id);
            field.value = value ?? ''; field.checked = value === true; if (typeof value === 'boolean') field.type = 'checkbox'; dom.inputs[id] = field;
        }
        initUIReader(dom); initStorageManager(dom, state, { toast() {} }); StorageManager.loadState();
        const trial = getBalancePlanTrial(doc); renderBalancePlanTrial(doc, { project: true });
        const handlers = createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
        const deps = { ...pipeline, dom, appState: state, getBalancePlanTrial, renderBalanceInflationSource, UIReader, StorageManager, UIUtils,
            buildBalanceEngineInputFromStorage, readBalanceHouseholdPlan, stripBalancePlanInputs, stageBalancePlanPatch,
            readBalancePersonStatus, showPersonDataStatus, getCurrentProfileId: () => storage.getItem('rs_current_profile'),
            profileSyncHandlers: createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS }), profilverbundHandlers: handlers,
            persistenceStorage: storage, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' }, evaluateBalanceFileInputs,
            refreshBalanceWealthHistory() {}, postprocessBalanceAction, withGuardrailCardValues: value => value,
            ANNUAL_MARKET_DATA_META_KEY: 'annualMarketDataMeta', overviewScope, buildBalanceOverviewSummary, storeOverviewSummary,
            UIRenderer: { clearError() {}, renderContext() {}, renderBedarfAnpassungUI() {}, render() {}, renderDiagnosis() {},
                formatDiagnosisPayload() { return null; }, handleError(error) { errors.push(error); } } };
        const update = new Function(...Object.keys(deps), functionSource('app/balance/balance-main.js', 'update') + '\nreturn update;')(...Object.values(deps));
        const debounce = new Function('appState', 'update', 'BALANCE_UPDATE_MODE', 'BALANCE_UPDATE_DEBOUNCE_MS',
            functionSource('app/balance/balance-main.js', 'debouncedUpdate') + '\nreturn debouncedUpdate;')(state, update, pipeline.BALANCE_UPDATE_MODE, 10);
        initUIBinder(dom, state, update, debounce);
        const planResult = update({ mode: 'preview' }); assert(planResult.ok, count + ': Planrechnung erfolgreich'); await planResult.overviewPersistence; await P.flush();
        const quantile = doc.getElementById('survivalQuantile');
        assert(quantile.disabled && quantile.value === '85', count + ': erster Update zeigt gesperrtes Prozentfeld mit separater Einheit');
        assertEqual(seen.at(-1).survivalQuantile, .85, count + ': erster Update rechnet den echten Planwert');
        // Der bestehende Browser-Smoke verwendete noch die alte Bruchdarstellung.
        // Seit Slice 3 erwartet das gebundene Feld Prozent, die Engine weiterhin einen Bruch.
        trial.start(); renderBalancePlanTrial(doc, { project: true });
        quantile.dispatchEvent({ type: 'focus' }); quantile.value = '0.8';
        let quantileError;
        try { trial.capture(); } catch (error) { quantileError = error; }
        assertEqual(quantileError?.message, 'survivalQuantile: ungültiger Zahlenbereich.', count + ': alter Smoke-Wert stellt Browserfehler nach');
        quantile.value = '80'; trial.capture();
        const quantileResult = update({ mode: 'preview' });
        assert(quantileResult.ok && errors.length === 0, count + ': Prozent-Eingabe rechnet ohne Updatefehler');
        assertEqual(seen.at(-1).survivalQuantile, .8, count + ': 80 Prozent kommen als 0.8 bei der Engine an');
        quantile.dispatchEvent({ type: 'blur' });
        assertEqual(quantile.value, '80', count + ': Blur zeigt den gerechneten Prozentwert ohne doppelte Einheit');
        trial.reset(); renderBalancePlanTrial(doc, { project: true });
        const annualState = StorageManager.loadState();
        annualState.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2025', pendingCommit: null };
        annualState.inputs.inflation = 1.25; StorageManager.saveState(annualState);
        const outcome = { monthlyWithdrawal: 1000, monthlyBudget: 2000, liquidityBefore: 100, liquidityAfter: 90,
            flexRate: 100, marketPhase: 'Höchststand', action: { type: 'NONE', title: 'Kein Handlungsbedarf' } };
        const annualEntry = (entryScope, periodId, rate) => ({ year: 2026, periodId, scope: entryScope,
            committedAt: '2026-01-02T12:00:00Z', adjusted: false, adjustedFields: [], recommended: outcome,
            adopted: { ...outcome, snapshot: { plan: values, inflation: rate,
                ageByPerson: Object.fromEntries(entryScope.ids.map(id => [id, 65])) } } });
        const outside = planScope('single', ['outside']);
        storage.setItem('annual_plan_record_v1', JSON.stringify({ version: 1, entries: {
            [JSON.stringify([2026, scope.key])]: annualEntry(scope, 'calendar-year:2025', 2.75),
            [JSON.stringify([2026, outside.key])]: annualEntry(outside, 'calendar-year:2025', 8.5)
        } }));
        addField(doc, 'balanceInflationSource'); doc.getElementById('inflation').value = '99';
        assertEqual(UIReader.readAllInputs().inflation, 2.75, count + ': DOM-Reader ignoriert manipulierte Inflation');
        assertEqual(buildBalanceEngineInputFromStorage({ storage }).inputData.inflation, 2.75, count + ': Rohrecordadapter nutzt denselben Bereich und Beleg');
        const inflation = renderBalanceInflationSource(doc, { scope });
        assertEqual(inflation.year, 2025, count + ': Inflationsjahr stammt aus Periode statt Belegjahr oder Datum');
        assert(doc.getElementById('inflation').disabled && doc.getElementById('balanceInflationSource').textContent.includes('2025'), count + ': Anzeige und Rechnung nennen denselben Jahreswert');
        const manualState = { ...annualState, inputs: { ...annualState.inputs, inflation: 3.4 } };
        const manualStorage = { getItem: key => key === CONFIG.STORAGE.LS_KEY ? JSON.stringify(manualState) : storage.getItem(key) };
        assertEqual(buildBalanceEngineInputFromStorage({ storage: manualStorage, referenceYear: 2027 }).inputData.inflation, 3.4,
            count + ': neue Jahresrechnung erhält manuelle Ersatzrate statt älterem Beleg');
        await P.flush();
        const before = bytes(), aggregates = JSON.stringify([window.__profilverbundActionResults, window.__profilverbundDistribution]);
        trial.start(); renderBalancePlanTrial(doc, { project: true });
        doc.getElementById('flexBedarf').value = '24.000';
        UIBinder.handleFormInput({ target: doc.getElementById('flexBedarf') });
        await new Promise(resolve => setTimeout(resolve, 30)); await P.flush();
        assertEqual(errors.length, 0, count + ': entprellter produktiver Versuch ohne Rechenfehler');
        assertEqual(seen.at(-1).flexBedarf, 24000, count + ': Engine rechnet Versuchswert');
        assertEqual(bytes(), before, count + ': sämtliche Speicherbytes nach entprellter Rechnung und Flush unverändert');
        assertEqual(JSON.stringify([window.__profilverbundActionResults, window.__profilverbundDistribution]), aggregates, count + ': keine Versuchsaggregate veröffentlicht');
        assert(!doc.getElementById('balancePlanTrialResult').hidden, count + ': Ergebnis als Abweichung gekennzeichnet');
        await UIBinder.prepareExpensesNavigation(); assertEqual(bytes(), before, count + ': Navigationsvorbereitung speichert keinen Versuch');
        const accidental = update({ mode: 'persist_inputs' }); assert(accidental.ok && !accidental.persistence?.persisted, count + ': versehentlicher Eingabewrite bleibt Vorschau');
        assertEqual(bytes(), before, count + ': auch expliziter Eingabewrite erhält alle Bytes');
        await trial.adopt(() => ['flexBedarf']); renderBalancePlanTrial(doc, { project: true });
        const adopted = update({ mode: 'preview' }); await adopted.overviewPersistence; await P.flush();
        assertEqual(seen.at(-1).flexBedarf, 24000, count + ': übernommener Bedarf in regulärer Planrechnung');
        assert(bytes() !== before && !trial.read().active, count + ': nur bewusste Übernahme aktualisiert Plan und Summary');
        trial.start(); trial.update({ flexBedarf: 29000 }); renderBalancePlanTrial(doc, { project: true });
        const pendingState = StorageManager.loadState();
        pendingState.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-recovery', phase: 'writes_started' } };
        StorageManager.saveState(pendingState);
        const commit = update({ mode: 'commit_period', periodId: 'calendar-year:2026' });
        assert(commit.ok && !trial.read().active, count + ': Abschluss verwirft Versuch');
        assertEqual(seen.at(-1).flexBedarf, 24000, count + ': Abschluss rechnet bestätigten Plan');
        await commit.overviewPersistence; await P.flush();
        assertEqual(backend.getItem(HOUSEHOLD_PLAN_KEY), storage.getItem(HOUSEHOLD_PLAN_KEY), count + ': bestätigter Plan zurückgelesen');
    }
} finally {
    restoreBinder(); P.resetPersistenceRuntimeForTests(); globalThis.document = original.document; globalThis.window = original.window; setAppTestDate(original.date);
}
