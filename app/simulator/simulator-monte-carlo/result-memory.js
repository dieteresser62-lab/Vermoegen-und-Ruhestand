import { areaSessionStorage, getStorageArea } from '../../shared/persistence-area-storage.js';

// TD-2: Das letzte Monte-Carlo-Ergebnis bleibt für die Sitzung erhalten, solange die Eingaben gleich bleiben.
// Nur sessionStorage im aktiven Speicherbereich; nie Persistenz, Sicherung oder Export.
export const MONTE_CARLO_MEMORY_KEY = 'rs_simulator_mc_result_v1';
// Chromium erlaubt etwa 5 Mio. Zeichen je Ursprung; der Eintrag bleibt mit Abstand darunter.
export const MONTE_CARLO_MEMORY_LIMIT = 3000000;

function session() {
    try { return areaSessionStorage(globalThis.window?.sessionStorage) || null; } catch { return null; }
}
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
        .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
    return value;
}
// cyrb53: kurzer, stabiler Textschlüssel; kein Sicherheitsmerkmal.
function hash(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Fingerabdruck über alles, was ein Lauf benutzt, samt Speicherbereich.
 * @param {{inputs: object, monteCarloParams: object, widowOptions: object, useCapeSampling: boolean, dataVersion?: unknown, personDataContext?: unknown}} run
 * @returns {string}
 */
export function monteCarloFingerprint({ inputs, monteCarloParams, widowOptions, useCapeSampling, dataVersion = null, personDataContext = null }) {
    return hash(JSON.stringify(canonical({ area: getStorageArea() || 'echt', inputs, monteCarloParams, widowOptions,
        useCapeSampling: useCapeSampling === true, dataVersion, personDataContext })));
}

// JSON kennt weder NaN, Infinity und -0 noch typisierte Arrays, Map oder Set; die Anzeige braucht sie unverändert.
const TYPED = { Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array, Uint8ClampedArray };
const encode = (key, value) => typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))
    ? { $mcNumber: Object.is(value, -0) ? '-0' : String(value) }
    : ArrayBuffer.isView(value) && TYPED[value.constructor.name] ? { $mcTyped: value.constructor.name, values: Array.from(/** @type {ArrayLike<number>} */ (/** @type {unknown} */ (value))) }
        : value instanceof Map ? { $mcMap: [...value] } : value instanceof Set ? { $mcSet: [...value] } : value;
const decode = (key, value) => !value || typeof value !== 'object' || Array.isArray(value) ? value
    : '$mcNumber' in value ? Number(value.$mcNumber) : '$mcTyped' in value ? new TYPED[value.$mcTyped](value.values)
        : '$mcMap' in value ? new Map(value.$mcMap) : '$mcSet' in value ? new Set(value.$mcSet) : value;

const runIndex = scenario => scenario?.sourceIdentity?.absoluteRunIndex;
// Gemerkt wird nur die Zeilenzahl; Platzhalter ohne Zeilen (z. B. kein Pflegefall) bleiben ohne Zeilen.
const withoutRows = run => run && typeof run === 'object'
    ? { ...run, logDataRows: undefined, logRowCount: Array.isArray(run.logDataRows) ? run.logDataRows.length : undefined } : run;
const hasRows = item => item?.logRowCount > 0;

/**
 * Protokollzeilen fallen weg; sie werden beim Wiederherstellen aus der Laufnummer nachgerechnet.
 * @param display Argumente der Ergebnisanzeige.
 * @returns {number[]} Laufnummern, deren Zeilen nachzurechnen sind.
 */
export function monteCarloRowIndices(display) {
    const indices = new Set();
    for (const group of ['characteristic', 'random']) for (const scenario of display.scenarioLogs?.[group] || []) {
        if (hasRows(scenario) && Number.isInteger(runIndex(scenario))) indices.add(runIndex(scenario));
    }
    for (const run of [display.worstRun, display.worstRunCare]) if (hasRows(run) && Number.isInteger(run.runIdx)) indices.add(run.runIdx);
    return [...indices].sort((a, b) => a - b);
}

/**
 * @param entry Ergebnis mit Fingerabdruck, Zeitpunkt, Anzeigeargumenten und Export.
 * @returns {boolean} true, wenn das Ergebnis gemerkt ist.
 */
export function rememberMonteCarloResult(entry) {
    const storage = session();
    if (!storage) return false;
    const { display } = entry;
    // Der Export ist eingerückt; kompakt gespeichert ergibt die Rückformatierung dieselben Bytes.
    const compact = download => download?.content ? { ...download, content: JSON.stringify(JSON.parse(download.content)) } : download;
    const scenarioLogs = display.scenarioLogs && Object.fromEntries(Object.entries(display.scenarioLogs)
        .map(([group, list]) => [group, (list || []).map(withoutRows)]));
    let raw;
    try {
        raw = JSON.stringify({ version: 1, ...entry, exportDownload: compact(entry.exportDownload), display: { ...display, scenarioLogs,
            worstRun: withoutRows(display.worstRun), worstRunCare: withoutRows(display.worstRunCare) } }, encode);
    } catch (error) { console.warn('[MC] Ergebnis nicht gemerkt.', error); raw = null; }
    try {
        if (!raw || raw.length > MONTE_CARLO_MEMORY_LIMIT) { storage.removeItem(MONTE_CARLO_MEMORY_KEY); return false; }
        storage.setItem(MONTE_CARLO_MEMORY_KEY, raw);
        return true;
    } catch (error) {
        // QuotaExceededError oder gesperrter Speicher: nichts merken, die alte Warnung bleibt.
        console.warn('[MC] Ergebnis nicht gemerkt.', error);
        try { storage.removeItem(MONTE_CARLO_MEMORY_KEY); } catch { /* bleibt leer */ }
        return false;
    }
}

/**
 * Merkt einen veröffentlichten Lauf; der Legacy-Stream kann einzelne Läufe nicht nachrechnen, dort bleibt die Warnung.
 * @param entry Laufmodus, Fingerabdruck, Startzeit, Anzeigeargumente und Export.
 * @returns {boolean}
 */
export function rememberPublishedMonteCarloRun({ rngMode, registration, doc, ...entry }) {
    const remembered = rngMode !== 'legacy-stream' && rememberMonteCarloResult({ ...entry, savedAt: new Date().toISOString() });
    if (!remembered) forgetMonteCarloResult();
    if (registration) registration.resultRemembered = remembered;
    if (remembered) watchMonteCarloEdits(doc, registration);
    return remembered;
}

const edits = new WeakMap();
/**
 * Nach einer Eingabe passt das gemerkte Ergebnis womöglich nicht mehr: Quellzeile weg, der Wächter fragt wieder.
 * Bedienung in den Ergebnissen (Reiter, Euro-Wahl, Szenarioliste) zählt nicht als Eingabe.
 * @param doc Simulatordokument.
 * @param registration Navigationsregistrierung des Monte-Carlo-Ergebnisses.
 * @returns {void}
 */
export function watchMonteCarloEdits(doc, registration) {
    if (typeof doc?.addEventListener !== 'function') return;
    const previous = edits.get(doc);
    if (previous) for (const type of ['input', 'change']) doc.removeEventListener(type, previous, true);
    const edited = event => {
        if (event?.target?.closest?.('.mc-view-panel, #mcEuroControl')) return;
        for (const type of ['input', 'change']) doc.removeEventListener(type, edited, true);
        edits.delete(doc);
        showMonteCarloMemorySource(doc, '');
        if (registration) { registration.resultRemembered = false; registration.notify?.(); }
    };
    edits.set(doc, edited);
    for (const type of ['input', 'change']) doc.addEventListener(type, edited, true);
}

/**
 * @param doc Simulatordokument.
 * @param {string} text Quellzeile; leer blendet sie aus.
 * @returns {void}
 */
export function showMonteCarloMemorySource(doc, text) {
    const host = doc?.getElementById?.('mcResultMemory');
    if (!host) return;
    host.textContent = text;
    host.hidden = !text;
}

/** @returns {any} gemerktes Ergebnis oder null */
export function readRememberedMonteCarloResult() {
    try {
        const value = JSON.parse(session()?.getItem(MONTE_CARLO_MEMORY_KEY) || 'null', decode);
        return value?.version === 1 && typeof value.fingerprint === 'string' && value.display ? value : null;
    } catch { return null; }
}

/**
 * @param download Kompakt gespeicherter Export.
 * @returns Export mit derselben Einrückung wie nach der Rechnung.
 */
export function expandMonteCarloExport(download) {
    return download?.content ? { ...download, content: JSON.stringify(JSON.parse(download.content), null, 2) } : download;
}

/** @returns {void} */
export function forgetMonteCarloResult() {
    try { session()?.removeItem(MONTE_CARLO_MEMORY_KEY); } catch { /* nichts gemerkt */ }
}

/**
 * Setzt nachgerechnete Protokollzeilen wieder ein.
 * @param display Gemerkte Anzeigeargumente.
 * @param {Map<number, object[]>} logsByIndex
 * @returns Anzeigeargumente mit Zeilen.
 */
export function restoreMonteCarloRows(display, logsByIndex) {
    const withRows = (item, index) => {
        if (!item || typeof item !== 'object') return item;
        const { logRowCount, ...rest } = item;
        return { ...rest, logDataRows: logRowCount > 0 ? logsByIndex.get(index) : logRowCount === 0 ? [] : undefined };
    };
    const scenarioLogs = display.scenarioLogs && Object.fromEntries(Object.entries(display.scenarioLogs)
        .map(([group, list]) => [group, (list || []).map(scenario => withRows(scenario, runIndex(scenario)))]));
    return { ...display, scenarioLogs, worstRun: withRows(display.worstRun, display.worstRun?.runIdx),
        worstRunCare: withRows(display.worstRunCare, display.worstRunCare?.runIdx) };
}
