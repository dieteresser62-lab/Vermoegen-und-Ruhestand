import { bindPlanTrialContext } from '../app/simulator/simulator-plan-trial.js';
import { runBacktest, runBacktestWithRuntimeProvenance, cancelBacktestPreparation } from '../app/simulator/simulator-backtest.js';
import { runMonteCarlo, runMonteCarloSerial, cancelMonteCarlo } from '../app/simulator/simulator-monte-carlo.js';
import { simulatorRunAssumptions } from '../app/simulator/simulator-run-assumptions.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { EngineAPI } from '../engine/index.mjs';
import { displayMonteCarloResults } from '../app/simulator/simulator-results.js';
import { beginSimulationSummary, completeSimulationSummary } from '../app/simulator/simulator-overview-summary.js';
import { OVERVIEW_SIMULATION_KEY, readSimulationRecord, projectSimulationSummaries } from '../app/overview/overview-simulation-summary.js';
import { overviewScope } from '../app/overview/overview-storage.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { getTestExecutionPolicy } from './run-tests.mjs';

// protocol-renderer.test.mjs initialisiert denselben dokumentlokalen Singleton.
// Dieser echte Anzeigeweg benötigt ein eigenes Dokument mit eigenen Abhängigkeiten.
assertEqual(getTestExecutionPolicy('simulator-overview-summary-integration.test.mjs').mode, 'isolated',
    'Echter MC-Anzeigeweg erhält im Suite-Lauf ein eigenes Dokument');
const savedGlobals = { document: globalThis.document, window: globalThis.window };
class MockElement {
    constructor(id) {
        this.id = id;
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.hidden = false;
        this.dataset = {};
        this.attributes = new Map();
        this.focusCalls = 0;
        this.style = {};
        this.classList = { add() {}, remove() {} };
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    querySelectorAll() { return []; }
    get options() { return []; }
    focus() {
        this.focusCalls++;
    }

    addEventListener(type, handler) {
        this.listeners ||= new Map();
        this.listeners.set(type, handler);
    }

    removeEventListener(type) { this.listeners?.delete(type); }
}

class MockDocument {
    addEventListener() {}
    constructor(ids) {
        this.elements = new Map(ids.map(id => [id, new MockElement(id)]));
    }

    getElementById(id) {
        return this.elements.get(id) || null;
    }
}

const inputs = {
    startAlter: 65, accumulationPhase: { enabled: false }, transitionYear: 0,
    startVermoegen: 500000, depotwertAlt: 500000, einstandAlt: 400000,
    tagesgeld: 20000, geldmarktEtf: 0, zielLiquiditaet: 20000,
    startFloorBedarf: 24000, startFlexBedarf: 6000, minimumFlexAnnual: 0,
    flexBudgetAnnual: 0, flexBudgetRecharge: 0, renteMonatlich: 0,
    renteStartOffsetJahre: 0, rentAdjPct: 0, goldAktiv: false,
    goldZielProzent: 0, goldFloorProzent: 0, goldSteuerfrei: false,
    risikoprofil: 'sicherheits-dynamisch', rebalancingBand: 20,
    runwayTargetMonths: 36, runwayMinMonths: 24, targetEq: 60,
    maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5, marketCapeRatio: 20, capeRatio: 20,
    kirchensteuerSatz: 0, startSPB: 1000, dynamicFlex: false,
    horizonMethod: 'survival_quantile', horizonYears: 30, survivalQuantile: .85,
    goGoActive: false, goGoMultiplier: 1, pflegefallLogikAktivieren: false,
    geschlecht: 'm', partner: { aktiv: false }, stressPreset: 'NONE'
};
const data = { profile_tagesgeld: '20000', depot_tranchen: '[]', [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { floorBedarf: 24000, flexBedarf: 6000 } }) };
const map = new Map([['rs_profiles_v1', JSON.stringify({ version: 1, profiles: { a: { meta: { name: 'Synthetisch', belongsToHousehold: true }, data } } })], ['rs_current_profile', 'a'], ['rs_active_profile', 'a'], ...Object.entries(data)]);
const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), key: i => [...map.keys()][i] ?? null, get length() { return map.size; } };
const pending = [];
const begin = (kind, values, settings, dependencies) => beginSimulationSummary(kind, values, settings, { ...dependencies, storage });
const complete = (context, result, options, dependencies) => { const promise = completeSimulationSummary(context, result, options, { ...dependencies, storage, guard: null, flush: async () => true, isBlocked: () => false }); pending.push(promise); return promise; };
const settle = async () => { await Promise.all(pending.splice(0)); };
const entry = kind => Object.values(readSimulationRecord(map.get(OVERVIEW_SIMULATION_KEY)).entries).find(item => item.kind === kind);
const doc = new MockDocument(['btButton', 'simulationSummary', 'simulationLog', 'simulationResults', 'exportBacktestJson', 'exportBacktestCsv', 'simStartJahr', 'simEndJahr']);
for (const element of doc.elements.values()) element.style = {};
doc.querySelectorAll = () => [];
doc.getElementById('simStartJahr').value = '2000'; doc.getElementById('simEndJahr').value = '2001';
globalThis.document = doc; globalThis.window = { EngineAPI };
const oldError = console.error, errors = []; console.error = (...args) => errors.push(args);
try {
    // Die fachlichen Erzeuger bleiben echt; nur DOM und dauerhafter Speicher sind synthetisch.
    prepareHistoricalDataOnce();
    for (const ruin of [false, true]) {
        storage.removeItem(OVERVIEW_SIMULATION_KEY);
        const result = runBacktest({ getInputs: () => ruin ? { ...inputs, startVermoegen: 100,
            depotwertAlt: 100, einstandAlt: 100, tagesgeld: 0, startFloorBedarf: 1000000 } : inputs,
            validateInputs: value => value, beginSimulationSummary: begin, completeSimulationSummary: complete });
        await settle();
        assert(result?.schemaVersion === 'BacktestRunResultV1', 'Echte Engine liefert den Backtestvertrag');
        assertEqual(result.outcome.kind, ruin ? 'ruin' : 'completed', 'Synthetischer Bestand erzeugt echten Abschluss beziehungsweise Ruin');
        const stored = entry('backtest');
        assert(stored, 'Echter Backtest persistiert einen neuen Eintrag');
        assertEqual(stored.metrics.startYear, 2000, 'Echter Backtest speichert angeforderten Beginn');
        assertEqual(stored.metrics.endYear, 2001, 'Echter Backtest speichert angefordertes Ende auch bei Ruin');
        assert(Number.isFinite(result.metrics.values.wealth_end_real_eur), 'Echter Backtest liefert kanonisches reales Endvermögen');
        assertEqual(stored.metrics.endWealthReal, result.metrics.values.wealth_end_real_eur, 'Ablage übernimmt das echte kanonische Endvermögen');
        assertEqual(stored.metrics.failureYear, ruin ? result.ruinYear : null, 'Ablage übernimmt das echte Ruinjahr');
        if (ruin) assertEqual(stored.metrics.failureYear, 2000, 'Echter Ruin im ersten historischen Jahr');
    }

    for (const ending of ['return', 'adopt', 'absent']) {
        if (ending === 'absent') storage.removeItem(OVERVIEW_SIMULATION_KEY);
        const trialInputs = bindPlanTrialContext({ ...inputs, startFlexBedarf: 33000 }, { deviationApplied: true });
        const before = map.get(OVERVIEW_SIMULATION_KEY);
        runBacktest({ getInputs: () => trialInputs, validateInputs: value => value, beginSimulationSummary: begin,
            completeSimulationSummary: (context, result, options, dependencies) => {
                bindPlanTrialContext(trialInputs, { deviationApplied: false });
                return complete(context, result, options, dependencies);
            } });
        await settle();
        assertEqual(map.get(OVERVIEW_SIMULATION_KEY), before, 'Echter Versuch-Backtest erhält vorhandene Summary trotz späterem Rückweg: ' + ending);
    }
    const unchangedInputs = bindPlanTrialContext({ ...inputs }, { deviationApplied: false });
    const unchangedContext = begin('backtest', unchangedInputs, {});
    assert(unchangedContext && !unchangedContext.planDeviationApplied, 'Geöffneter Versuch ohne Änderungen bleibt ein Planlauf');
    runBacktest({ getInputs: () => unchangedInputs, validateInputs: value => value, beginSimulationSummary: begin, completeSimulationSummary: complete });
    await settle();
    assert(entry('backtest'), 'Geöffneter, unveränderter Versuch schreibt weiterhin einen Backtest-Planabschluss');

    const btResult = kind => ({ schemaVersion: 'BacktestRunResultV1', request: { startYear: 2000, endYear: 2001 }, outcome: { kind }, rows: [], requestedYears: 2, completedYears: kind === 'ruin' ? 1 : 2,
        ruinYear: kind === 'ruin' ? 2000 : null, metrics: { values: { wealth_end_real_eur: kind === 'ruin' ? 0 : 123.45 } } });
    const bt = { getInputs: () => inputs, validateInputs: value => value, beginSimulationSummary: begin, completeSimulationSummary: complete };
    // Schreibsperre, Flushfehler und Profilwechsel verhindern jede Ablage und erhalten den letzten Erfolg.
    let flushCount = 0;
    for (const dependencies of [{ isBlocked: () => true }, { flush: async () => false }, { flush: async () => ++flushCount !== 2 }]) {
        const errorCount = errors.length;
        const before = storage.getItem(OVERVIEW_SIMULATION_KEY);
        const context = begin('backtest', inputs, {});
        assertEqual(await completeSimulationSummary(context, btResult('completed'), {}, { storage, guard: null,
            flush: async () => true, isBlocked: () => false, ...dependencies }), false, 'Schreibsperre/Flushfehler verhindern Abschluss');
        assertEqual(storage.getItem(OVERVIEW_SIMULATION_KEY), before, 'Gescheiterte Ablage erhält letzten Erfolg');
        assertEqual(errors.length - errorCount, dependencies.isBlocked ? 0 : 1,
            'Echte Flushfehler werden genau einmal als Fehler gemeldet; Schreibsperre bleibt ruhig');
    }
    {
        const registryBefore = storage.getItem('rs_profiles_v1');
        storage.setItem('rs_profiles_v1', JSON.stringify({ version: 1, profiles: { ...JSON.parse(registryBefore).profiles,
            b: { meta: { name: 'Zweite synthetische Person' }, data } } }));
        const before = storage.getItem(OVERVIEW_SIMULATION_KEY);
        const switchedContext = begin('backtest', inputs, {});
        storage.setItem('rs_current_profile', 'b');
        assertEqual(await complete(switchedContext, btResult('completed')), false, 'Profilwechsel vor Ablage verhindert Abschluss'); await settle();
        assertEqual(storage.getItem(OVERVIEW_SIMULATION_KEY), before, 'Profilwechsel erhält den letzten Erfolg');
        storage.setItem('rs_current_profile', 'a');
        storage.setItem('rs_profiles_v1', registryBefore);
    }
    // Echter Store wartet am zweiten Flush; Haushaltswechsel erzwingt transaktionale Rücknahme.
    for (const mode of ['household', 'newer', 'generation']) {
        const preserveNewer = mode === 'newer';
        const originalRegistry = storage.getItem('rs_profiles_v1'), originalLive = storage.getItem(OVERVIEW_SIMULATION_KEY);
        const household = JSON.parse(originalRegistry);
        household.profiles.b = { meta: { name: 'Haushaltspartner', belongsToHousehold: true }, data: {} };
        storage.setItem('rs_profiles_v1', JSON.stringify(household));
        const context = begin('backtest', inputs, {});
        storage.removeItem(OVERVIEW_SIMULATION_KEY);
        let releaseFlush, flushes = 0;
        const deferred = new Promise(resolve => { releaseFlush = resolve; });
        const errorCount = errors.length, result = btResult('completed'), beforeResult = JSON.stringify(result);
        const completion = completeSimulationSummary(context, result, {}, { storage, guard: null, isBlocked: () => false,
            flush: () => ++flushes === 2 ? deferred : Promise.resolve(true) });
        for (let i = 0; i < 12 && flushes < 2; i++) await Promise.resolve();
        assertEqual(flushes, 2, 'Echte Ablage wartet nach ihren Writes am Abschlussflush');
        const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
        if (mode === 'generation') begin('backtest', inputs, {});
        else registry.profiles.c = { meta: { name: 'Dritte synthetische Person' }, data: {} };
        registry.profiles.a.data.unrelated = 'fremde Daten';
        let newerRaw = null;
        if (preserveNewer) {
            const newer = JSON.parse(storage.getItem(OVERVIEW_SIMULATION_KEY));
            for (const item of Object.values(newer.entries)) item.metrics.endWealthReal = 999;
            newerRaw = JSON.stringify(newer);
            storage.setItem(OVERVIEW_SIMULATION_KEY, newerRaw);
            registry.profiles.a.data[OVERVIEW_SIMULATION_KEY] = newerRaw;
        }
        storage.setItem('rs_profiles_v1', JSON.stringify(registry)); releaseFlush(true);
        assertEqual(await completion, false, 'Haushalts-/Generationswechsel während Ablage verwirft veraltete Summary');
        assertEqual(errors.length, errorCount, 'OVERVIEW_CONTEXT_CHANGED nach verzögertem Haushaltswechsel bleibt ohne console.error');
        assertEqual(storage.getItem(OVERVIEW_SIMULATION_KEY), newerRaw, 'Rücknahme erhält neueren Eintrag oder entfernt eigenen veralteten Eintrag');
        const after = JSON.parse(storage.getItem('rs_profiles_v1'));
        assert(after.profiles.b && after.profiles.a.data.unrelated === 'fremde Daten', 'Rücknahme erhält fremde Registrydaten');
        assertEqual(after.profiles.a.data[OVERVIEW_SIMULATION_KEY] ?? null, newerRaw ?? household.profiles.a.data[OVERVIEW_SIMULATION_KEY] ?? null, 'Registry-Rücknahme erhält neuere Summary oder den vorherigen Eintrag');
        assertEqual(JSON.stringify(result), beforeResult, 'Ablageabbruch verändert kein Fachresultat');
        storage.setItem('rs_profiles_v1', originalRegistry);
        if (originalLive === null) storage.removeItem(OVERVIEW_SIMULATION_KEY); else storage.setItem(OVERVIEW_SIMULATION_KEY, originalLive);
    }
    for (const asynchronous of [false, true]) for (const message of ['OVERVIEW_CONTEXT_CHANGED', 'SYNTHETIC_QUOTA_FAILURE', 'prefix OVERVIEW_CONTEXT_CHANGED']) {
        const context = begin('backtest', inputs, {}), error = new Error(message), errorCount = errors.length;
        assertEqual(await completeSimulationSummary(context, btResult('completed'), {}, {
            store: () => { if (asynchronous) return Promise.reject(error); throw error; }
        }), false, 'Synchrone und asynchrone Ablagefehler liefern false');
        assertEqual(errors.length - errorCount, message === 'OVERVIEW_CONTEXT_CHANGED' ? 0 : 1,
            'Nur der exakte Kontextsentinel bleibt ruhig; echte Speicherfehler bleiben console.error');
        if (message !== 'OVERVIEW_CONTEXT_CHANGED') assert(errors.at(-1)[1] === error, 'Fehlerprotokoll behält die originale Fehlerinstanz');
    }
    {
        const context = begin('backtest', inputs, {}), errorCount = errors.length;
        let rejectStore;
        const completion = completeSimulationSummary(context, btResult('completed'), {}, {
            store: () => new Promise((_resolve, reject) => { rejectStore = reject; })
        });
        begin('backtest', inputs, {});
        rejectStore(new Error('SYNTHETIC_STORAGE_FAILURE_AFTER_CONTEXT_CHANGE'));
        assertEqual(await completion, false, 'Echter Speicherfehler nach Generationswechsel liefert false');
        assertEqual(errors.length - errorCount, 1, 'Generationswechsel unterdrückt keinen echten Speicherfehler');
    }
    const obsoleteContext = begin('backtest', inputs, {}), errorCount = errors.length;
    begin('backtest', inputs, {});
    assertEqual(await completeSimulationSummary(obsoleteContext, btResult('completed'), {}, {
        store: () => { throw new Error('OBSOLETE_GENERATION_MUST_NOT_STORE'); }
    }), false, 'Überholte Generation wird vor Ablage verworfen');
    assertEqual(errors.length, errorCount, 'Überholte Generation bleibt ruhig');

    for (const outcome of ['completed', 'ruin']) {
        const expected = btResult(outcome);
        assertEqual(runBacktest({ ...bt, runSinglePath: () => expected }), expected, outcome + ': wirklicher Backtestabschluss behält Fachresultat');
        await settle(); assertEqual(entry('backtest').statement, outcome, outcome + ': wirklicher Abschlussweg speichert Summary');
        assertEqual(entry('backtest').metrics.endWealthReal, outcome === 'ruin' ? 0 : 123.45, 'Kanonische reale Kennzahl unverändert');
    }
    const { deriveMinimumFlexPath, buildMinimumFlexRestriction } = await import('../app/simulator/minimum-flex-metrics.js');
    const minimumPath = deriveMinimumFlexPath([40000, 28000, 35000].map(paid => ({
        minimumFlexAnnual: 30000, flex_wunsch_haushalt_nominal: 45000, flex_haushalt_erfuellt: paid
    })));
    const enrichedResult = btResult('completed');
    enrichedResult.metrics.minimumFlexRestriction = { ...buildMinimumFlexRestriction([minimumPath], 30000), path: minimumPath };
    runBacktest({ ...bt, runSinglePath: () => enrichedResult }); await settle();
    assertEqual(entry('backtest').metrics.minimumFlexAffectedYearCount, 1, 'Wirklicher Abschlussweg speichert neue Pfadkennzahl');
    assertEqual(entry('backtest').metrics.minimumFlexObservationCount, 3, 'Wirklicher Abschlussweg speichert neuen Nenner');
    assertEqual(entry('backtest').metrics.flexPaidMedianNominalEur, 35000, 'Wirklicher Abschlussweg speichert nominalen Betrag');
    const previous = map.get(OVERVIEW_SIMULATION_KEY);
    for (const runSinglePath of [() => btResult('incomplete'), () => { throw new Error('SYNTHETIC_RUN_FAILURE'); }, () => { simulatorRunAssumptions.begin('backtest', {}, {}); return btResult('completed'); }]) {
        runBacktest({ ...bt, runSinglePath }); await settle();
        assertEqual(map.get(OVERVIEW_SIMULATION_KEY), previous, 'Incomplete/technischer Fehler/überholter Token ersetzen keinen gespeicherten Erfolg');
    }
    doc.getElementById('simStartJahr').value = '';
    runBacktest({ ...bt, runSinglePath: () => { throw new Error('INVALID_MUST_NOT_RUN'); } }); await settle();
    assertEqual(map.get(OVERVIEW_SIMULATION_KEY), previous, 'Validierungsfehler schreibt keine Summary');
    doc.getElementById('simStartJahr').value = '2000';
    await runBacktestWithRuntimeProvenance({ ...bt, automatic: true, loadRuntimeBuildProvenance: async () => null, runSinglePath: () => btResult('completed') }); await settle();
    assertEqual(entry('backtest').statement, 'completed', 'Automatischer Backtest nutzt denselben Erfolgsanschluss');
    const beforeAbort = map.get(OVERVIEW_SIMULATION_KEY);
    let release; const wait = new Promise(resolve => { release = resolve; });
    const preparing = runBacktestWithRuntimeProvenance({ ...bt, loadRuntimeBuildProvenance: () => wait, runSinglePath: () => { throw new Error('ABORTED_MUST_NOT_RUN'); } });
    await Promise.resolve(); const cancellation = cancelBacktestPreparation(); release(null); await cancellation; await preparing; await settle();
    assertEqual(map.get(OVERVIEW_SIMULATION_KEY), beforeAbort, 'Abgebrochener Vorlauf schreibt keine Summary');

    prepareHistoricalDataOnce();
    const progress = [], mcErrors = [];
    const ui = { bindCancel() {}, beginRun() {}, disableStart() {}, hideError() {}, clearRunExport() {}, readUseCapeSampling: () => false,
        readWorkerConfig: () => ({}), requireLargeRunConfirmation() {}, showProgress() {}, hideCompareResults() {}, readCompareMode: () => false,
        updateProgress() {}, publishRunExport() {}, showCompleted() {}, showError: error => mcErrors.push(String(error)), showCancelled() {}, beginCancelling() {},
        finishProgress: async status => progress.push(status.completed), unbindCancel() {}, finishRun() {}, enableStart() {} };
    const mc = { createUI: () => ui, prepareHistoricalData: async () => {}, getInputs: () => inputs, validateInputs: value => value,
        resolveSamplingContract: () => {}, readParameters: () => ({ anzahl: 2, maxDauer: 2, blockSize: 1, seed: 42, methode: 'block', rngMode: 'legacy-stream', startYearMode: 'UNIFORM' }),
        displayResults() {}, beginSimulationSummary: begin, completeSimulationSummary: complete };
    await runMonteCarlo(mc); await settle();
    assert(entry('montecarlo') && entry('montecarlo').metrics.runs === 2, 'Wirklicher kleiner serieller MC speichert nach vollständigem Abschluss');
    assertEqual(progress.at(-1), true, 'Erfolg wird erst mit finanziellem Abschluss an finishProgress übergeben');
    for (const ending of ['return', 'adopt', 'absent']) {
        if (ending === 'absent') storage.removeItem(OVERVIEW_SIMULATION_KEY);
        const trialInputs = bindPlanTrialContext({ ...inputs, startFlexBedarf: 33000 }, { deviationApplied: true });
        const before = map.get(OVERVIEW_SIMULATION_KEY);
        await runMonteCarlo({ ...mc, getInputs: () => trialInputs,
            completeSimulationSummary: (context, result, options, dependencies) => {
                bindPlanTrialContext(trialInputs, { deviationApplied: false });
                return complete(context, result, options, dependencies);
            } });
        await settle();
        assertEqual(map.get(OVERVIEW_SIMULATION_KEY), before, 'Echter Versuch-MC erhält gespeicherte Summary trotz späterem Rückweg: ' + ending);
    }
    const emptyTrialInputs = bindPlanTrialContext({ ...inputs }, { deviationApplied: false });
    storage.removeItem(OVERVIEW_SIMULATION_KEY);
    await runMonteCarlo({ ...mc, getInputs: () => emptyTrialInputs }); await settle();
    assert(entry('montecarlo'), 'Geöffneter, unveränderter Versuch schreibt weiterhin einen MC-Planabschluss');

    // Regulärer MC-Start → echte Ergebnisanzeige.
    const displayHostIds = ['scenarioLogContainer', 'scenarioSelector', 'scenarioList', 'scenarioLogOutput', 'scenarioExportButtons', 'monteCarloResults'];
    for (const id of displayHostIds) doc.elements.set(id, new MockElement(id));
    const inputsBeforeDisplay = JSON.stringify(inputs);
    await runMonteCarlo({ ...mc, readParameters: () => ({ ...mc.readParameters(), rngMode: 'per-run-seed' }),
        displayResults: displayMonteCarloResults });
    await settle();
    assertEqual(progress.at(-1), true, `Echter MC-Anzeigeweg schließt erfolgreich ab: ${mcErrors.join('; ')}`);
    assertEqual(mcErrors.length, 0, 'Echter MC-Anzeigeweg meldet keinen unterdrückten UI-Fehler');
    assertEqual(doc.getElementById('monteCarloResults').style.display, 'block', 'Echter MC-Anzeigeweg veröffentlicht den Ergebnisinhalt');
    assertEqual(JSON.stringify(inputs), inputsBeforeDisplay, 'Ergebnisanzeige verändert die Laufeingaben nicht');
    for (const id of displayHostIds) doc.elements.delete(id);
    const mcBefore = map.get(OVERVIEW_SIMULATION_KEY);
    for (const mode of ['prepare', 'technical', 'display', 'finish', 'abort', 'obsolete', 'afterlogs']) {
        const changes = mode === 'prepare' ? { prepareHistoricalData: () => { throw new Error('SYNTHETIC_PREPARE_FAILURE'); } }
            : mode === 'technical' ? { runSerial: async () => { throw new Error('SYNTHETIC_BATCH_FAILURE'); } }
            : mode === 'display' ? { displayResults: () => { throw new Error('SYNTHETIC_POSTPROCESS_FAILURE'); } }
            : mode === 'finish' ? { createUI: () => ({ ...ui, finishProgress: () => { throw new Error('SYNTHETIC_FINISH_FAILURE'); } }) }
            : mode === 'obsolete' ? { runSerial: async args => { const result = await runMonteCarloSerial(args); simulatorRunAssumptions.begin('montecarlo', {}, {}); return result; } }
            : mode === 'afterlogs' ? { readParameters: () => ({ ...mc.readParameters(), rngMode: 'per-run-seed' }), runWorkers: args => runMonteCarloSerial(args), runLogsForIndices: () => { throw new Error('SYNTHETIC_LOG_FAILURE'); } }
            : { runSerial: async args => { const result = await runMonteCarloSerial(args); void cancelMonteCarlo(); return result; } };
        try { await runMonteCarlo({ ...mc, ...changes }); } catch (error) { assertEqual(mode, 'finish', 'Nur finishProgress-Fehler verlässt den vorhandenen Cleanupweg'); }
        await settle(); assertEqual(map.get(OVERVIEW_SIMULATION_KEY), mcBefore, mode + ': tatsächlicher MC-Fehler-/Abbruchweg schreibt keinen Erfolg');
        if (['prepare', 'technical', 'display', 'afterlogs'].includes(mode)) assertEqual(progress.at(-1), false, mode + ': finishProgress bildet kein falsches Erfolgsgate');
    }
    await runMonteCarlo({ ...mc, runSerial: async args => { const result = await runMonteCarloSerial(args); storage.setItem('profile_tagesgeld', '20001'); return result; } }); await settle();
    const liveData = Object.fromEntries(map);
    const currentScope = { kind: 'single', ids: ['a'], key: JSON.stringify(['single', ['a']]) };
    assertEqual(projectSimulationSummaries({ registry: JSON.parse(map.get('rs_profiles_v1')), activeId: 'a', liveData, scope: currentScope }).montecarlo.stale, true, 'Änderung während tatsächlichem MC-Lauf wird nicht als aktuelle Ausgangsbasis umetikettiert');
    const { bindPersonDataContext } = await import('../app/simulator/simulator-person-overrides.js');
    const alternative = bindPersonDataContext({ ...inputs, startAlter: 70 }, { schemaVersion: 1, referenceYear: 2026, ageRule: 'january-1-completed-years', deviationApplied: true, persons: [{ profileId: 'a', role: 'primary', changes: [{ field: 'profile_geburtsdatum', profileValue: '1960-03-14', effectiveValue: '1955-03-14' }] }] });
    const sourceBefore = storage.getItem(CONFIG.STORAGE.LS_KEY);
    await runMonteCarlo({ ...mc, getInputs: () => alternative, beginOverviewRun: () => undefined }); await settle();
    assertEqual(entry('montecarlo').deviationApplied, true, 'Dokumentlokale Personenalternative wird Was-wäre-wenn markiert');
    assertEqual(storage.getItem(CONFIG.STORAGE.LS_KEY), sourceBefore, 'Personenalternative schreibt keine Profil-/Balancewerte mit');

} finally { console.error = oldError; globalThis.document = savedGlobals.document; globalThis.window = savedGlobals.window; }
