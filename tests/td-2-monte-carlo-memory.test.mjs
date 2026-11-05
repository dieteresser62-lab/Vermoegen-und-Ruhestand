import { EngineAPI } from '../engine/index.mjs';
import { runMonteCarlo, restoreMonteCarloResult } from '../app/simulator/simulator-monte-carlo.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { displayMonteCarloResults } from '../app/simulator/simulator-results.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { setStorageArea } from '../app/shared/persistence-area-storage.js';

// Werte aus result-memory.js / result-restore.js; Grenze und Sonderwerte prüft simulator-monte-carlo-contract.test.mjs.
const MONTE_CARLO_MEMORY_KEY = 'rs_simulator_mc_result_v1', MONTE_CARLO_MEMORY_LIMIT = 3000000;
const MONTE_CARLO_MEMORY_STALE = 'Letztes Ergebnis passt nicht mehr zu den Eingaben – bitte neu rechnen.';
// TD-2: Ein Monte-Carlo-Ergebnis bleibt für die Sitzung erhalten, solange die Eingaben gleich bleiben.
const saved = { document: globalThis.document, window: globalThis.window };
class MockElement {
    constructor(id) { this.id = id; this.value = ''; this.textContent = ''; this.innerHTML = ''; this.hidden = false; this.dataset = {}; this.style = {};
        this.attributes = new Map(); this.classList = { add() {}, remove() {}, toggle() {} }; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    get options() { return []; }
    focus() {}
    addEventListener() {}
    removeEventListener() {}
}
const hostIds = ['monteCarloResults', 'monteCarloSummary', 'monteCarloAnswers', 'monteCarloPersonNotice', 'unifiedKpiDashboard', 'scenarioLogContainer',
    'scenarioSelector', 'scenarioList', 'scenarioLogOutput', 'scenarioExportButtons', 'mcResultMemory'];
const page = () => {
    const elements = new Map(hostIds.map(id => [id, new MockElement(id)]));
    elements.get('mcResultMemory').hidden = true;
    return { elements, addEventListener() {}, removeEventListener() {}, getElementById: id => elements.get(id) || null, querySelector: () => null, querySelectorAll: () => [] };
};
const sessionMap = new Map();
let quotaFull = false;
const sessionStorage = { getItem: key => sessionMap.get(key) ?? null, removeItem: key => sessionMap.delete(key),
    setItem: (key, value) => { if (quotaFull) { const error = new Error('voll'); error.name = 'QuotaExceededError'; throw error; } sessionMap.set(key, String(value)); },
    key: i => [...sessionMap.keys()][i] ?? null, get length() { return sessionMap.size; } };
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
const parameters = () => ({ anzahl: 30, maxDauer: 6, blockSize: 1, seed: 42, methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' });
const exports = [], errors = [];
const ui = { bindCancel() {}, beginRun() {}, disableStart() {}, hideError() {}, clearRunExport() {}, readUseCapeSampling: () => false,
    readWorkerConfig: () => ({}), requireLargeRunConfirmation() {}, showProgress() {}, hideCompareResults() {}, readCompareMode: () => false,
    updateProgress() {}, publishRunExport: download => exports.push(download), showCompleted() {}, showError: error => errors.push(String(error)),
    showCancelled() {}, beginCancelling() {}, finishProgress: async () => {}, unbindCancel() {}, finishRun() {}, enableStart() {} };
let displayed = [];
const mc = { createUI: () => ui, prepareHistoricalData: async () => prepareHistoricalDataOnce(), getInputs: () => inputs, validateInputs: value => value,
    resolveSamplingContract: () => {}, readParameters: parameters, runWorkers: async () => null, beginOverviewRun: () => undefined,
    displayResults: (...args) => { displayed.push(args); return displayMonteCarloResults(...args); },
    beginSimulationSummary: () => null, completeSimulationSummary: async () => {} };
const summaryCalls = [];
const restoreDependencies = (overrides = {}) => ({ beginSimulationSummary: kind => { summaryCalls.push(kind); return null; }, getInputs: () => inputs, validateInputs: value => value, readParameters: parameters,
    readUseCapeSampling: () => false, createUI: () => ui, prepareHistoricalData: async () => prepareHistoricalDataOnce(),
    displayResults: mc.displayResults, beginOverviewRun: () => undefined, ...overrides });
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const same = (a, b) => {
    if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b);
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return a === b;
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (a instanceof Map || a instanceof Set) return same([...a], [...b]);
    const keys = Object.keys(a).filter(key => a[key] !== undefined);
    return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length && keys.every(key => same(a[key], b[key]));
};
const reason = doc => getPageNavigationGuard(doc, {}).reasons().find(item => item.owner === 'simulator-monte-carlo');
// Laufende Info-Nummern zählen im selben Modul weiter; ein echtes Neuladen beginnt wieder bei eins.
const visible = doc => ['monteCarloSummary', 'monteCarloAnswers'].map(id => doc.getElementById(id).innerHTML.replace(/(mc[A-Za-z]*Info)\d+/g, '$1N')).join('|');
const originalWarn = console.warn, originalError = console.error;
try {
    console.warn = () => {}; console.error = () => {};
    setStorageArea('echt');
    globalThis.window = { EngineAPI, sessionStorage };
    const first = page();
    globalThis.document = first;
    await runMonteCarlo(mc);
    assertEqual(errors.length, 0, 'Erster Lauf ohne Fehler: ' + errors.join('; '));
    const stored = sessionMap.get(MONTE_CARLO_MEMORY_KEY);
    assert(stored && stored.length < MONTE_CARLO_MEMORY_LIMIT, 'Ergebnis liegt im Sitzungsspeicher und unter der Grenze');
    assert(!stored.includes('"logDataRows":['), 'Protokollzeilen werden nicht gespeichert, sondern nachgerechnet');
    assertEqual(reason(first), undefined, 'Nach dem Merken meldet der Wächter keinen Ergebnisverlust');
    const firstVisible = visible(first), firstArgs = displayed.at(-1), firstExport = exports.at(-1);
    assert(firstVisible.length > 100, 'Erster Lauf zeigt Kennzahlen');

    // Neu laden: anderes Dokument, gleicher Sitzungsspeicher, gleiche Eingaben.
    const second = page();
    globalThis.document = second;
    displayed = [];
    assertEqual(await restoreMonteCarloResult({ doc: second, dependencies: restoreDependencies() }), 'restored', 'Gleiche Eingaben stellen das Ergebnis wieder her');
    assertEqual(visible(second), firstVisible, 'Wiederhergestellte Anzeige zeigt dieselben Kennzahlen');
    const restoredArgs = displayed.at(-1);
    assertEqual(JSON.stringify(sorted(restoredArgs[9])), JSON.stringify(sorted(firstArgs[9])), 'Nachgerechnete Szenario-Protokolle sind identisch');
    assertEqual(JSON.stringify(sorted(restoredArgs[3])), JSON.stringify(sorted(firstArgs[3])), 'Schlechtester Lauf samt Zeilen ist identisch');
    assert(same(restoredArgs[0], firstArgs[0]), 'Gesamtergebnis ist wertgleich, auch Infinity und typisierte Arrays');
    assertEqual(JSON.stringify(sorted(restoredArgs[8])), JSON.stringify(sorted(firstArgs[8])), 'Pflege-Platzhalter ohne Pflegefall bleibt ohne Zeilen');
    assert(same(restoredArgs[0], firstArgs[0]) && JSON.stringify(firstArgs[0]).includes('null') === JSON.stringify(restoredArgs[0]).includes('null'), 'Keine Sonderwerte werden zu null');
    assertEqual(exports.at(-1).content, firstExport.content, 'Export bleibt derselbe Lauf');
    const source = second.getElementById('mcResultMemory');
    assert(!source.hidden && /^Ergebnis von \d\d:\d\d · Eingaben unverändert$/.test(source.textContent), 'Quellzeile nennt Uhrzeit und unveränderte Eingaben: ' + source.textContent);
    assertEqual(reason(second), undefined, 'Wiederhergestelltes Ergebnis erzeugt keinen Verlustgrund');
    assertEqual(summaryCalls.join(','), 'montecarlo', 'Wiederherstellen bindet die Werkstatt-Herkunft wie ein Laufbeginn');

    // Ergebnis von einem anderen Tag nennt das Datum.
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    sessionMap.set(MONTE_CARLO_MEMORY_KEY, sessionMap.get(MONTE_CARLO_MEMORY_KEY).replace(/"savedAt":"[^"]+"/, `"savedAt":"${yesterday}"`));
    const nextDay = page();
    globalThis.document = nextDay;
    assertEqual(await restoreMonteCarloResult({ doc: nextDay, dependencies: restoreDependencies() }), 'restored', 'Ergebnis vom Vortag wird wiederhergestellt');
    assert(/^Ergebnis vom \d\d\.\d\d\. \d\d:\d\d · Eingaben unverändert$/.test(nextDay.getElementById('mcResultMemory').textContent),
        'Quellzeile nennt bei anderem Tag das Datum: ' + nextDay.getElementById('mcResultMemory').textContent);

    // Ein Laufstart während des Wiederherstellens hat Vorrang, auch wenn er sofort scheitert.
    const raced = page();
    globalThis.document = raced;
    const failingStart = async () => { await runMonteCarlo({ ...mc, validateInputs: () => { throw new Error('Eingabe ungültig'); } }); return new Map(); };
    assertEqual(await restoreMonteCarloResult({ doc: raced, dependencies: restoreDependencies({ runLogsForIndices: failingStart }) }), 'none',
        'Gescheiterter Start während des Wiederherstellens wird nicht überschrieben');
    assertEqual(raced.getElementById('monteCarloSummary').innerHTML, '', 'Kein altes Ergebnis über dem gescheiterten Start');
    errors.length = 0;

    // Spielbereich sieht das Ergebnis der echten Daten nicht.
    setStorageArea('spiel');
    const play = page();
    globalThis.document = play;
    assertEqual(await restoreMonteCarloResult({ doc: play, dependencies: restoreDependencies() }), 'none', 'Spielbereich zeigt kein Ergebnis aus echten Daten');
    assert(play.getElementById('mcResultMemory').hidden, 'Spielbereich zeigt keine Quellzeile');
    setStorageArea('echt');
    assert(sessionMap.has(MONTE_CARLO_MEMORY_KEY), 'Echter Eintrag bleibt nach dem Blick aus dem Spielbereich erhalten');

    // Geänderte Eingabe: Hinweis statt Ergebnis, Eintrag gelöscht.
    const changed = page();
    globalThis.document = changed;
    const otherInputs = { ...inputs, startFlexBedarf: 7000 };
    assertEqual(await restoreMonteCarloResult({ doc: changed, dependencies: restoreDependencies({ getInputs: () => otherInputs }) }), 'stale', 'Geänderte Eingabe passt nicht mehr');
    assertEqual(changed.getElementById('mcResultMemory').textContent, MONTE_CARLO_MEMORY_STALE, 'Hinweiszeile bei geänderten Eingaben');
    assertEqual(changed.getElementById('monteCarloSummary').innerHTML, '', 'Bei Abweichung wird nichts angezeigt');
    assert(!sessionMap.has(MONTE_CARLO_MEMORY_KEY), 'Abweichender Eintrag ist gelöscht');

    // Speicher voll: nichts merken, die bisherige Warnung bleibt.
    quotaFull = true;
    const full = page();
    globalThis.document = full;
    await runMonteCarlo(mc);
    quotaFull = false;
    assert(!sessionMap.has(MONTE_CARLO_MEMORY_KEY), 'Voller Speicher: nichts gemerkt');
    assertEqual(reason(full)?.result, true, 'Ohne Merken bleibt der Ergebnisverlust-Hinweis');

    // Laufende Rechnung fragt weiter, auch wenn das letzte Ergebnis gemerkt ist.
    const running = page();
    globalThis.document = running;
    await runMonteCarlo(mc);
    assertEqual(reason(running), undefined, 'Gemerktes Ergebnis vor dem nächsten Lauf');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const next = runMonteCarlo({ ...mc, prepareHistoricalData: async () => { await gate; prepareHistoricalDataOnce(); } });
    await Promise.resolve(); await Promise.resolve();
    const busy = reason(running);
    assert(busy && busy.phase !== 'idle', 'Laufende Rechnung ist ein Wächtergrund');
    assertEqual(busy.message, 'Laufende Rechnung wird abgebrochen – trotzdem wechseln?', 'Laufende Rechnung fragt ohne Ergebnisverlust-Zeile');
    assertEqual(busy.result, false, 'Gemerktes Ergebnis zählt nicht als Verlust');
    release(); await next;
} finally {
    console.warn = originalWarn; console.error = originalError;
    setStorageArea(null);
    globalThis.document = saved.document; globalThis.window = saved.window;
}
