/** @import * as H from "../../typcheck/tranches-history.js" */
// TH-2 (Nutzer 09.11.2026): Tageskurse eines Wertpapiers auf Wunsch neu laden, z. B. nach einem Split.
// Der Kursdienst liefert die Historie bereits umgerechnet; die App erkennt und rechnet nichts selbst.
// Erst wird alles frisch abgerufen und geprüft, dann ersetzt ein einziger Commit nur dieses Symbol.
import { persistenceStorage } from '../shared/persistence-facade.js';
import { PROFILE_STORAGE_KEYS, PROFILE_TRANCHES_KEY } from '../profile/profile-state.js';
import { PROFILE_WEALTH_LOTS_KEY } from '../profile/profile-wealth-history.js';
import { HISTORY_FETCH_BUDGET_MS, collectHistoryQueue, fetchHistoryChart } from './tranchen-history-fetch.js';
import { WEALTH_HISTORY_START_KEY, DAILY_PRICES_KEY, assertHistoryStart, assertDailyPrices, requireHistoryRecord,
    normalizeHistorySymbol, mergeHistoryIntervals, localHistoryDate, commitHistoryRecords } from './tranchen-history-store.js';

const SOURCE_KEYS = [PROFILE_STORAGE_KEYS.registry, PROFILE_STORAGE_KEYS.active, PROFILE_STORAGE_KEYS.current,
    PROFILE_TRANCHES_KEY, PROFILE_WEALTH_LOTS_KEY, WEALTH_HISTORY_START_KEY];
const REASONS = {
    HISTORY_RELOAD_NO_RANGE: 'Für dieses Wertpapier gibt es keinen Zeitraum zum Abrufen.',
    HISTORY_RELOAD_GAP: 'Der Kursdienst hat nicht alle Handelstage geliefert.',
    HISTORY_RELOAD_EMPTY: 'Der Kursdienst hat keine Tageskurse geliefert.',
    HISTORY_RELOAD_CURRENCY: 'Der Kursdienst nennt eine andere Währung als bisher.',
    HISTORY_BUDGET_ENDED: 'Der Abruf hat zu lange gedauert.',
    HISTORY_ABORTED: 'Der Abruf wurde abgebrochen.',
    HISTORY_CONTEXT_CHANGED: 'Die Daten haben sich während des Abrufs geändert.'
};
function reloadError(code) { const error = /** @type {import("../../typcheck/runtime-contracts.js").AppError} */ (new Error(code)); error.code = code; return error; }

/** Verständlicher Grund ohne Kurswerte; unbekannte Fehler nennen den Kursdienst.
 * @param {{code?: string, message?: string}} error
 * @returns {string} */
export function historyReloadReason(error) {
    const code = String(error?.code || error?.message || '');
    return REASONS[code] || (/^HISTORY_(SERVICE_UNREACHABLE|HTTP_|PROVIDER_ERROR|INVALID|SYMBOL_MISMATCH)/.test(code)
        ? 'Der Kursdienst ist nicht erreichbar oder hat ungültig geantwortet.' : 'Die Kurse konnten nicht sicher gespeichert werden.');
}

/** Zeiträume wie beim Start: ab Verlaufsbeginn bzw. Kauf bis gestern, über alle Profile, verkaufte Tranchen eingeschlossen.
 * Der Livebestand des aktiven Profils wird nur in einer Kopie eingesetzt; Lesen schreibt nie.
 * @param {string} symbol
 * @param {{storage?: import("../../typcheck/datenvertraege.js").RecordReader, today?: string}} [options]
 * @returns {number[][]} */
export function historyReloadIntervals(symbol, { storage = persistenceStorage, today = localHistoryDate() } = {}) {
    symbol = normalizeHistorySymbol(symbol);
    const start = requireHistoryRecord(storage.getItem(WEALTH_HISTORY_START_KEY), assertHistoryStart);
    const registry = JSON.parse(storage.getItem(PROFILE_STORAGE_KEYS.registry) || 'null');
    const active = storage.getItem(PROFILE_STORAGE_KEYS.active);
    if (!start || !registry?.profiles?.[active] || active !== storage.getItem(PROFILE_STORAGE_KEYS.current)) throw reloadError('HISTORY_RELOAD_NO_RANGE');
    for (const key of [PROFILE_TRANCHES_KEY, PROFILE_WEALTH_LOTS_KEY]) {
        const live = storage.getItem(key);
        if (live !== null) registry.profiles[active].data[key] = live;
    }
    const wanted = collectHistoryQueue(registry, start.startDate, today).wanted.find(entry => entry.symbol === symbol);
    if (!wanted?.intervals.length) throw reloadError('HISTORY_RELOAD_NO_RANGE');
    return wanted.intervals;
}

/** Ruft die ganze Historie eines Symbols ab und ersetzt Schlusskurse samt Abfrageabdeckung in einem Commit.
 * Fehler, Lücken oder Kontextwechsel lassen alle Records bytegleich.
 * @param {string} ticker
 * @param {H.FetchOptions & H.CommitOptions & {today?: string}} [options]
 * @returns {Promise<{symbol: string, days: number}>} */
export async function reloadSymbolHistory(ticker, { storage = persistenceStorage, today = localHistoryDate(), now = () => performance.now(),
    valid = () => true, signal, operation, flush, ...fetchOptions } = {}) {
    const symbol = normalizeHistorySymbol(ticker);
    const source = SOURCE_KEYS.map(key => [key, storage.getItem(key)]);
    const readRecord = () => requireHistoryRecord(storage.getItem(DAILY_PRICES_KEY), assertDailyPrices, { version: 1, symbols: {} }).symbols[symbol] || null;
    const old = readRecord(), oldRaw = JSON.stringify(old);
    const unchanged = () => valid() && source.every(([key, raw]) => storage.getItem(key) === raw) && JSON.stringify(readRecord()) === oldRaw;
    const intervals = historyReloadIntervals(symbol, { storage, today });
    const deadline = now() + HISTORY_FETCH_BUDGET_MS;
    const results = [];
    for (const interval of intervals) {
        if (!unchanged()) throw reloadError('HISTORY_CONTEXT_CHANGED');
        try { results.push(await fetchHistoryChart(symbol, interval, { ...fetchOptions, signal: signal || operation?.controller.signal, deadline, now, valid: unchanged })); }
        catch (error) { throw error.code === 'HISTORY_ABORTED' && !unchanged() ? reloadError('HISTORY_CONTEXT_CHANGED') : error; }
    }
    const inRange = day => intervals.some(([a, b]) => day >= a && day <= b);
    // Gespeicherte Kurse außerhalb des Abrufzeitraums bleiben; innerhalb ersetzt die Antwort.
    const points = new Map();
    old?.days.forEach((day, index) => { if (!inRange(day)) points.set(day, old.closes[index]); });
    const delivered = new Set();
    for (const result of results) {
        if (result.currency !== results[0].currency || old?.days.length && old.currency !== result.currency) throw reloadError('HISTORY_RELOAD_CURRENCY');
        result.days.forEach((day, index) => { points.set(day, result.closes[index]); delivered.add(day); });
    }
    if (!delivered.size) throw reloadError('HISTORY_RELOAD_EMPTY');
    // TH-2b: Vollständig heißt, jeder Werktag im Abrufzeitraum ist geliefert oder als Handelspause belegt,
    // also schon früher ohne Kurs abgefragt (z. B. Feiertag). Sonst bleibt alles unverändert.
    const pauses = old?.queried || [];
    for (const [a, b] of intervals) for (let day = a; day <= b; day++) {
        if (delivered.has(day) || [0, 6].includes(new Date(day * 86400000).getUTCDay())) continue;
        if (old?.days.includes(day) || !pauses.some(([from, to]) => day >= from && day <= to)) throw reloadError('HISTORY_RELOAD_GAP');
    }
    const days = [...points.keys()].sort((a, b) => a - b);
    const record = { currency: results[0].currency, days, closes: days.map(day => points.get(day)),
        queried: mergeHistoryIntervals([...pauses, ...intervals]), failures: 0, lastError: null };
    if (!unchanged()) throw reloadError('HISTORY_CONTEXT_CHANGED');
    // Unmittelbar vor dem Write neu lesen: andere Symbole bleiben, wie sie gerade gespeichert sind.
    const next = requireHistoryRecord(storage.getItem(DAILY_PRICES_KEY), assertDailyPrices, { version: 1, symbols: {} });
    next.symbols[symbol] = record;
    assertDailyPrices(next);
    await commitHistoryRecords([[DAILY_PRICES_KEY, JSON.stringify(next)]], { storage, flush, operation, valid: unchanged });
    return { symbol, days: days.length };
}
