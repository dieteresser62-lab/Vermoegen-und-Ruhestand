import * as facade from '../app/simulator/simulator-monte-carlo.js';
import * as helpers from '../app/simulator/simulator-monte-carlo/helpers.js';
import * as state from '../app/simulator/simulator-monte-carlo/state.js';
import * as serial from '../app/simulator/simulator-monte-carlo/serial.js';
import * as entry from '../app/simulator/simulator-monte-carlo/entry.js';
import * as executionDependencies from '../app/simulator/simulator-monte-carlo/execution-dependencies.js';
import * as restore from '../app/simulator/simulator-monte-carlo/result-restore.js';
import * as memory from '../app/simulator/simulator-monte-carlo/result-memory.js';
import { setStorageArea } from '../app/shared/persistence-area-storage.js';

const expected = {
    mergeHeatmap: helpers.mergeHeatmap,
    appendArray: helpers.appendArray,
    cancelMonteCarlo: state.cancelMonteCarlo,
    runMonteCarloLogsForIndices: serial.runMonteCarloLogsForIndices,
    runMonteCarloSerial: serial.runMonteCarloSerial,
    runMonteCarlo: entry.runMonteCarlo,
    restoreMonteCarloResult: restore.restoreMonteCarloResult
};
assertEqual(JSON.stringify(Object.keys(facade).sort()), JSON.stringify(Object.keys(expected).sort()),
    'Fassade erhält die sechs öffentlichen Laufnamen und das Wiederherstellen (TD-2); interner Laufzustand bleibt privat');
for (const [name, value] of Object.entries(expected)) {
    assert(facade[name] === value, `${name}: Fassade und Definitionsmodul teilen dieselbe Bindung`);
}
const previous = state.activeMonteCarloRun;
try {
    const run = { generationId: 'facade-binding-probe' };
    state.setActiveMonteCarloRun(run);
    assert(state.activeMonteCarloRun === run, 'Schreibzugang aktualisiert die originale Laufbindung');
    assert(executionDependencies.activeMonteCarloRun === run, 'Ablauf erhält dieselbe live weitergereichte Laufbindung');
    state.setActiveMonteCarloRun(null);
    assert(executionDependencies.activeMonteCarloRun === null, 'Freigabe erreicht auch den Ablauf ohne Zustandsschatten');
    assert(executionDependencies.cancelMonteCarlo === facade.cancelMonteCarlo, 'UI-Abbruch und öffentlicher Abbruch teilen dieselbe Funktion');
} finally {
    state.setActiveMonteCarloRun(previous);
}

// TD-2: Grenze und Sonderwerte des gemerkten Ergebnisses.
{
    const saved = globalThis.window, map = new Map();
    globalThis.window = { sessionStorage: { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) } };
    setStorageArea('echt');
    try {
        const aggregatedResults = { infinite: Infinity, missing: NaN, negativeZero: -0, typed: new Float64Array([1.5, NaN]), map: new Map([['a', 1]]), set: new Set([2]) };
        assert(memory.rememberMonteCarloResult({ fingerprint: 'f', savedAt: '2026-11-03T10:00:00.000Z', display: { aggregatedResults }, exportDownload: { content: '{\n  "a": 1\n}' } }), 'Sonderwerte lassen sich merken');
        const read = memory.readRememberedMonteCarloResult();
        const back = read.display.aggregatedResults;
        assert(back.infinite === Infinity && Number.isNaN(back.missing) && Object.is(back.negativeZero, -0), 'Infinity, NaN und -0 bleiben erhalten');
        assert(back.typed instanceof Float64Array && back.typed[0] === 1.5 && Number.isNaN(back.typed[1]), 'Typisierte Arrays bleiben typisiert');
        assert(back.map instanceof Map && back.map.get('a') === 1 && back.set instanceof Set && back.set.has(2), 'Map und Set bleiben erhalten');
        assertEqual(memory.expandMonteCarloExport(read.exportDownload).content, '{\n  "a": 1\n}', 'Kompakt gemerkter Export kommt mit gleicher Einrückung zurück');
        assertEqual(memory.rememberMonteCarloResult({ fingerprint: 'f', savedAt: 'x', display: { blob: 'x'.repeat(memory.MONTE_CARLO_MEMORY_LIMIT) }, exportDownload: {} }), false, 'Zu großer Eintrag wird nicht gemerkt');
        assertEqual(memory.readRememberedMonteCarloResult(), null, 'Zu großer Eintrag löscht auch den alten Eintrag');
        assertEqual(memory.rememberPublishedMonteCarloRun({ rngMode: 'legacy-stream', fingerprint: 'f', display: {}, exportDownload: {} }), false, 'Legacy-Stream wird nicht gemerkt');
        // HP-4: Fächerklassen werden dünn besetzt gemerkt, ohne Nullfelder; -0 und NaN bleiben erhalten.
        const counts = new Uint32Array(100000); counts[3] = 7; counts[99999] = 1;
        const sums = new Float64Array(100000); sums[5] = 1234.5678; sums[6] = -0; sums[7] = NaN;
        assert(memory.rememberMonteCarloResult({ fingerprint: 'f', savedAt: 'x', display: { aggregatedResults: { counts, sums } }, exportDownload: {} }), 'HP-4: Dünn besetzte Klassen lassen sich merken');
        assert(map.get(memory.MONTE_CARLO_MEMORY_KEY).length < 2000, `HP-4: Nullfelder werden nicht gespeichert (${map.get(memory.MONTE_CARLO_MEMORY_KEY).length} Zeichen)`);
        const sparse = memory.readRememberedMonteCarloResult().display.aggregatedResults;
        assert(sparse.counts instanceof Uint32Array && sparse.counts.length === 100000 && sparse.counts[3] === 7 && sparse.counts[99999] === 1
            && sparse.counts.reduce((sum, value) => sum + value, 0) === 8, 'HP-4: Klassenzähler kommen vollständig zurück');
        assert(sparse.sums instanceof Float64Array && sparse.sums[5] === 1234.5678 && Object.is(sparse.sums[6], -0) && Number.isNaN(sparse.sums[7])
            && Object.is(sparse.sums[8], 0), 'HP-4: Summen kommen mit -0 und NaN zurück');
        // HP-4: Gleiche Zahlenreihen stehen nur einmal im Eintrag; nach dem Lesen sind es wieder getrennte, gleiche Reihen.
        const list = Array.from({ length: 500 }, (_, i) => i * 1.5 + .1), withNaN = [...list.slice(1), NaN];
        assert(memory.rememberMonteCarloResult({ fingerprint: 'f', savedAt: 'x', display: { aggregatedResults: { a: list, b: [...list], c: withNaN, d: [...list.slice(1), null] } },
            exportDownload: { content: JSON.stringify({ kpi: list }, null, 2) } }), 'HP-4: Gleiche Reihen lassen sich merken');
        assert(map.get(memory.MONTE_CARLO_MEMORY_KEY).length < JSON.stringify(list).length * 3.5, 'HP-4: Gleiche Reihen werden einmal gespeichert');
        const shared = memory.readRememberedMonteCarloResult();
        const back2 = shared.display.aggregatedResults;
        assert(JSON.stringify(back2.a) === JSON.stringify(list) && JSON.stringify(back2.b) === JSON.stringify(list) && back2.a !== back2.b, 'HP-4: Verweise ergeben getrennte gleiche Reihen');
        assert(Number.isNaN(back2.c.at(-1)) && back2.d.at(-1) === null, 'HP-4: NaN und null bleiben verschieden');
        assertEqual(memory.expandMonteCarloExport(shared.exportDownload).content, JSON.stringify({ kpi: list }, null, 2), 'HP-4: Export kommt mit gleichen Bytes zurück');
        // HP-4: Ein zu großes Ergebnis wird nicht still verworfen; der Hinweis steht in der Quellzeile bis zur nächsten Eingabe.
        const listeners = new Map(), source = { textContent: '', hidden: true };
        const doc = { getElementById: id => id === 'mcResultMemory' ? source : null,
            addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
        const tooLarge = { rngMode: 'per-run-seed', doc, registration: { notify() {} }, fingerprint: 'f', display: { blob: 'x'.repeat(memory.MONTE_CARLO_MEMORY_LIMIT) }, exportDownload: {} };
        assertEqual(memory.rememberPublishedMonteCarloRun(tooLarge), false, 'HP-4: Zu großes Ergebnis wird nicht gemerkt');
        assert(!source.hidden && source.textContent === 'Ergebnis zu groß zum Merken – nach einem Seitenwechsel neu rechnen.', `HP-4: Hinweis bei Übergröße (${source.textContent})`);
        listeners.get('input')?.({ target: { closest: () => null } });
        assert(source.hidden && source.textContent === '', 'HP-4: Eine Eingabe blendet den Hinweis aus');
        memory.rememberPublishedMonteCarloRun({ ...tooLarge, rngMode: 'legacy-stream' });
        assert(source.hidden, 'HP-4: Legacy-Stream bleibt ohne Hinweis, er wird ohnehin nicht gemerkt');
        // HP-4b: Ohne Sitzungsspeicher ein neutraler Hinweis ohne „zu groß“.
        const withStorage = globalThis.window;
        globalThis.window = {};
        try { assertEqual(memory.rememberPublishedMonteCarloRun({ ...tooLarge, display: {} }), false, 'HP-4b: Ohne Sitzungsspeicher nichts gemerkt'); }
        finally { globalThis.window = withStorage; }
        assert(!source.hidden && source.textContent === 'Ergebnis konnte nicht gemerkt werden – nach einem Seitenwechsel neu rechnen.', `HP-4b: neutraler Hinweis (${source.textContent})`);
    } finally { setStorageArea(null); globalThis.window = saved; }
}

// TD-2: Eine Eingabe nach dem Merken macht den Ergebnisverlust wieder zum Wächtergrund.
{
    const listeners = new Map(), source = { textContent: 'Ergebnis von 10:00 · Eingaben unverändert', hidden: false };
    const doc = { getElementById: id => id === 'mcResultMemory' ? source : null,
        addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
    let notified = 0;
    const registration = { resultRemembered: true, notify: () => notified++ };
    memory.watchMonteCarloEdits(doc, registration);
    listeners.get('change')({ target: { closest: selector => selector.includes('.mc-view-panel') ? {} : null } });
    assert(registration.resultRemembered && notified === 0 && !source.hidden, 'Bedienung in den Ergebnissen lässt das gemerkte Ergebnis stehen');
    listeners.get('input')({ target: { closest: () => null } });
    assert(!registration.resultRemembered && notified === 1 && source.hidden, 'Eine Eingabe meldet den Verlust wieder und blendet die Quellzeile aus');
    assertEqual(listeners.size, 0, 'Der Beobachter meldet sich nach der ersten Eingabe ab');
}
