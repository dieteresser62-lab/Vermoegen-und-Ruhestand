// HP-4 Teil 1 (W1, Gutachten 19.11.): Das Monte-Carlo-Ergebnis eines Haushalts mit Immobilie und 50 Jahren Laufzeit wird gemerkt
// und nach dem Neuladen gleich angezeigt, samt Gesamtvermögensfächer, Fächer ohne Immobilie und Zähler für aufgebraucht.
// Beispielhaushalt Martin und Petra „Haus + Steuer“; synthetische Werte, keine Nutzerdaten.
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { runMonteCarlo, restoreMonteCarloResult } from '../app/simulator/simulator-monte-carlo.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { displayMonteCarloResults } from '../app/simulator/simulator-results.js';
import { setStorageArea } from '../app/shared/persistence-area-storage.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { HANDBOOK_MUSTER_DATE } from '../app/demo/muster-haushalte.js';
import { homeWealthFanModel } from '../app/simulator/wealth-home-fan.js';

// Werte aus result-memory.js; Hinweis und Grenze prüft auch simulator-monte-carlo-contract.test.mjs.
const MONTE_CARLO_MEMORY_KEY = 'rs_simulator_mc_result_v1', MONTE_CARLO_MEMORY_LIMIT = 3000000;
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
    'scenarioSelector', 'scenarioList', 'scenarioLogOutput', 'scenarioExportButtons', 'mcResultMemory', 'wealthFanChart', 'wealthDistribution'];
const page = () => {
    const elements = new Map(hostIds.map(id => [id, new MockElement(id)]));
    elements.get('mcResultMemory').hidden = true;
    return { elements, addEventListener() {}, removeEventListener() {}, getElementById: id => elements.get(id) || null, querySelector: () => null, querySelectorAll: () => [] };
};
const sessionMap = new Map();
const sessionStorage = { getItem: key => sessionMap.get(key) ?? null, removeItem: key => sessionMap.delete(key), setItem: (key, value) => sessionMap.set(key, String(value)),
    key: i => [...sessionMap.keys()][i] ?? null, get length() { return sessionMap.size; } };
// 1.000 Läufe über 50 Jahre: Vor HP-4 lag das gemerkte Ergebnis hier über der Grenze und wurde still verworfen.
const parameters = () => ({ anzahl: 1000, maxDauer: 50, blockSize: 1, seed: 42, methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' });
const ui = { bindCancel() {}, beginRun() {}, disableStart() {}, hideError() {}, clearRunExport() {}, readUseCapeSampling: () => false,
    readWorkerConfig: () => ({}), requireLargeRunConfirmation() {}, showProgress() {}, hideCompareResults() {}, readCompareMode: () => false,
    updateProgress() {}, publishRunExport() {}, showCompleted() {}, showError: error => errors.push(String(error)),
    showCancelled() {}, beginCancelling() {}, finishProgress: async () => {}, unbindCancel() {}, finishRun() {}, enableStart() {} };
const errors = [];
let displayed = [];
const same = (a, b) => {
    if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b);
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return a === b;
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (ArrayBuffer.isView(a)) return a.length === b.length && Array.prototype.every.call(a, (value, index) => Object.is(value, b[index]));
    if (a instanceof Map || a instanceof Set) return same([...a], [...b]);
    const keys = Object.keys(a).filter(key => a[key] !== undefined);
    return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length && keys.every(key => same(a[key], b[key]));
};
const visible = doc => ['monteCarloSummary', 'monteCarloAnswers', 'wealthFanChart', 'wealthDistribution']
    .map(id => doc.getElementById(id).innerHTML.replace(/(mc[A-Za-z]*Info|info-popover-)\d+/g, '$1N')).join('|');
const originalWarn = console.warn, originalError = console.error;
try {
    console.warn = () => {}; console.error = () => {};
    const inputs = await measurementInputs(0, 'martin-petra', HANDBOOK_MUSTER_DATE);
    assert(inputs.home?.length > 0, 'Martin und Petra „Haus + Steuer“ haben Immobilien');
    setStorageArea('echt');
    globalThis.window = { ...globalThis.window, sessionStorage };
    const dependencies = { createUI: () => ui, prepareHistoricalData: async () => prepareHistoricalDataOnce(), getInputs: () => inputs, validateInputs: value => value,
        readParameters: parameters, readUseCapeSampling: () => false, resolveSamplingContract: () => {}, runWorkers: async () => null, beginOverviewRun: () => undefined,
        beginSimulationSummary: () => null, completeSimulationSummary: async () => {}, displayResults: (...args) => { displayed.push(args); return displayMonteCarloResults(...args); } };
    const first = page();
    globalThis.document = first;
    await runMonteCarlo(dependencies);
    assertEqual(errors.length, 0, 'Lauf ohne Fehler: ' + errors.join('; '));
    const firstArgs = displayed.at(-1), firstVisible = visible(first);
    assert(firstArgs[0].displayHomeValueFan, 'Lauf mit Immobilie hat einen Gesamtvermögensfächer');
    assert(firstArgs[0].wealthFan && Array.isArray(firstArgs[0].wealthView?.realByRun), 'Lauf hat Fächer ohne Immobilie und Endwerte je Lauf');
    const stored = sessionMap.get(MONTE_CARLO_MEMORY_KEY);
    assert(stored && stored.length < MONTE_CARLO_MEMORY_LIMIT, `Ergebnis mit Immobilie und 50 Jahren ist gemerkt und liegt unter der Grenze (${stored?.length ?? 'nicht gemerkt'})`);
    assertEqual(first.getElementById('mcResultMemory').textContent, '', 'Gemerktes Ergebnis zeigt keinen Hinweis auf Übergröße');

    // Neu laden: anderes Dokument, gleicher Sitzungsspeicher, gleiche Eingaben.
    const second = page();
    globalThis.document = second;
    displayed = [];
    assertEqual(await restoreMonteCarloResult({ doc: second, dependencies }), 'restored', 'Ergebnis mit Immobilie wird wiederhergestellt');
    const restoredArgs = displayed.at(-1);
    const withoutHomeFan = results => ({ ...results, displayHomeValueFan: undefined });
    assert(same(withoutHomeFan(restoredArgs[0]), withoutHomeFan(firstArgs[0])), 'Gesamtergebnis ist wertgleich');
    // Vom Immobilienfächer sind nur die Summen gemerkt, die die Anzeige liest; Klassen und Modell sind gleich.
    assert(same(restoredArgs[0].displayHomeValueFan.fan, firstArgs[0].displayHomeValueFan.fan), 'Klassen des Gesamtvermögensfächers sind wertgleich');
    for (const mode of ['real', 'nominal']) {
        assertEqual(JSON.stringify(homeWealthFanModel(restoredArgs[0].displayHomeValueFan, mode, restoredArgs[0].wealthFan)),
            JSON.stringify(homeWealthFanModel(firstArgs[0].displayHomeValueFan, mode, firstArgs[0].wealthFan)), `Gesamtvermögensfächer ${mode}: gleiches Anzeigemodell`);
    }
    assert(same(restoredArgs[0].wealthFan, firstArgs[0].wealthFan), 'Fächer ohne Immobilie ist nach dem Wiederherstellen da und wertgleich');
    assert(!Object.keys(restoredArgs[0]).includes('wealthFan'), 'Fächer ohne Immobilie bleibt wie nach dem Lauf ein nicht aufzählbares Feld');
    assert(same(restoredArgs[0].wealthView.realByRun, firstArgs[0].wealthView.realByRun), 'Endwerte je Lauf für die Zähler „aufgebraucht“ sind wertgleich');
    assertEqual(JSON.stringify(restoredArgs[9]), JSON.stringify(firstArgs[9]), 'Szenario-Protokolle sind identisch');
    assertEqual(visible(second), firstVisible, 'Kennzahlen, Fächer und Verteilung erscheinen wie direkt nach dem Lauf');
    assert(firstVisible.includes('wealth-fan-svg'), 'Der Vergleich umfasst den gezeichneten Fächer');
} finally {
    console.warn = originalWarn; console.error = originalError;
    setStorageArea(null); setAppTestDate(null);
    globalThis.document = saved.document; globalThis.window = saved.window;
}
