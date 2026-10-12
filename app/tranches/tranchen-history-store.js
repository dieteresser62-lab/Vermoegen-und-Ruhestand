import { appNow } from '../shared/app-clock.js';
// Globale, versionierte Schlusskurse; UTC-Tagesnummern ohne Preisrundung.
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';

export const WEALTH_HISTORY_START_KEY = 'rs_wealth_history_start_v1';
export const DAILY_PRICES_KEY = 'rs_daily_prices_v1';
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const pending = new WeakMap();
export function assertHistoryObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Verlaufsrecord ist kein Objekt.');
    for (const key of Object.keys(value)) if (forbidden.has(key)) throw new Error('Unsichere Verlaufskennung.');
    return value;
}
export function assertHistoryId(value) {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\u0000-\u001f]/.test(value) || value.length > 200 || forbidden.has(value)) throw new Error('Ungültige Verlaufskennung.');
    return value;
}
export function normalizeHistorySymbol(value) {
    assertHistoryId(value);
    const symbol = value.trim().toUpperCase();
    if (!/^[A-Z0-9^][A-Z0-9.^=_-]{0,79}$/.test(symbol)) throw new Error('Ungültiges Kurssymbol.');
    return symbol;
}
export function historyDay(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1000-01-01') throw new Error('Ungültiges Verlaufsdatum.');
    const ms = Date.parse(date + 'T00:00:00Z');
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new Error('Ungültiges Kalenderdatum.');
    return ms / 86400000;
}
export function historyDate(day) {
    if (!Number.isInteger(day) || day < historyDay('1000-01-01') || day > historyDay('9999-12-31')) throw new Error('Ungültiger Verlaufstag.');
    return new Date(day * 86400000).toISOString().slice(0, 10);
}
export function localHistoryDate(now = appNow()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function assertHistoryStart(value) {
    assertHistoryObject(value);
    if (value.version !== 1) throw new Error('Unbekannte Beginnversion.');
    historyDay(value.startDate);
    return value;
}
export function mergeHistoryIntervals(intervals) {
    const sorted = intervals.map(interval => {
        if (!Array.isArray(interval) || interval.length !== 2) throw new Error('Ungültiges Kursintervall.');
        interval.forEach(historyDate);
        if (interval[0] > interval[1]) throw new Error('Umgekehrtes Kursintervall.');
        return [...interval];
    }).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of sorted) {
        const last = merged.at(-1);
        if (last && interval[0] <= last[1] + 1) last[1] = Math.max(last[1], interval[1]);
        else merged.push(interval);
    }
    return merged;
}
export function assertDailyPrices(value) {
    assertHistoryObject(value);
    if (value.version !== 1) throw new Error('Unbekannte Kursversion.');
    assertHistoryObject(value.symbols);
    for (const [symbol, record] of Object.entries(value.symbols)) {
        if (normalizeHistorySymbol(symbol) !== symbol) throw new Error('Nicht normalisiertes Kurssymbol.');
        assertHistoryObject(record);
        if (record.currency !== null && (typeof record.currency !== 'string' || !/^[A-Z]{3}$/.test(record.currency))) throw new Error('Ungültige Kurswährung.');
        if (!Array.isArray(record.days) || !Array.isArray(record.closes) || record.days.length !== record.closes.length || !Array.isArray(record.queried)) throw new Error('Ungültige Kursspalten.');
        record.days.forEach((day, index) => {
            historyDate(day);
            if (index && day <= record.days[index - 1]) throw new Error('Kursdaten sind nicht eindeutig sortiert.');
            if (typeof record.closes[index] !== 'number' || !Number.isFinite(record.closes[index]) || record.closes[index] <= 0) throw new Error('Ungültiger Schlusskurs.');
        });
        if (record.days.length && record.currency === null) throw new Error('Kurswährung fehlt.');
        const canonical = mergeHistoryIntervals(record.queried);
        if (JSON.stringify(canonical) !== JSON.stringify(record.queried)) throw new Error('Kursintervalle sind nicht kanonisch.');
        if (!Number.isSafeInteger(record.failures) || record.failures < 0 || (record.lastError !== null && (typeof record.lastError !== 'string' || !record.lastError.trim()))
            || (record.failures === 0) !== (record.lastError === null)) throw new Error('Ungültiger Kursfehlerstatus.');
    }
    return value;
}
export function loadHistoryRecord(raw, validator) {
    if (raw === null || raw === undefined) return { status: 'missing', value: null, raw: raw ?? null };
    try {
        if (typeof raw !== 'string') throw new Error('Verlaufsrecord muss als String vorliegen.');
        return { status: 'valid', value: validator(JSON.parse(raw)), raw };
    } catch (error) { return { status: 'corrupt', value: null, raw, error }; }
}
export function requireHistoryRecord(raw, validator, fallback = null) {
    const loaded = loadHistoryRecord(raw, validator);
    if (loaded.status === 'corrupt') throw loaded.error;
    return loaded.value ?? fallback;
}
export function readDailyPrices(storage = persistenceStorage) {
    // Ein vorbereiteter Cachewrite ist noch keine bestätigte Abdeckung.
    const raw = pending.get(storage)?.get(DAILY_PRICES_KEY);
    return loadHistoryRecord(raw !== undefined ? raw : storage.getItem(DAILY_PRICES_KEY), assertDailyPrices);
}
export function emptyHistorySymbol() {
    return { currency: null, days: [], closes: [], queried: [], failures: 0, lastError: null };
}
export function mergeDailyPriceResult(current, symbol, result) {
    assertDailyPrices(current);
    symbol = normalizeHistorySymbol(symbol);
    const next = structuredClone(current);
    const old = next.symbols[symbol] || emptyHistorySymbol();
    if (result.error) {
        next.symbols[symbol] = { ...old, failures: old.failures + 1, lastError: result.error };
    } else {
        if (old.currency && old.currency !== result.currency) throw new Error('Kurswährung hat sich geändert.');
        const points = new Map(old.days.map((day, index) => [day, old.closes[index]]));
        result.days.forEach((day, index) => points.set(day, result.closes[index]));
        const days = [...points.keys()].sort((a, b) => a - b);
        next.symbols[symbol] = { currency: result.currency, days, closes: days.map(day => points.get(day)),
            queried: mergeHistoryIntervals([...old.queried, result.interval]), failures: 0, lastError: null };
    }
    return assertDailyPrices(next);
}
/** Synchrone Aufnahme, dann Flush oder kompensierendes Rückschreiben unter demselben Besitzer. */
export async function commitHistoryRecords(records, { storage = persistenceStorage, flush = () => PersistenceFacade.flush(), operation, valid = () => true } = {}) {
    operation?.check();
    if (!valid()) throw new Error('HISTORY_CONTEXT_CHANGED');
    if (pending.has(storage)) throw new Error('HISTORY_COMMIT_CONFLICT');
    const previous = new Map(records.map(([key]) => [key, storage.getItem(key)]));
    operation?.commit();
    pending.set(storage, previous);
    try {
        for (const [key, raw] of records) storage.setItem(key, raw);
        if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        if (records.some(([key, raw]) => storage.getItem(key) !== raw)) throw new Error('HISTORY_COMMIT_CONFLICT');
    } catch (error) {
        let restored = true;
        for (const [key, raw] of previous) {
            // Andere Fenster niemals mit einer alten Kopie überschreiben.
            const candidate = records.find(([name]) => name === key)[1];
            try {
                if (storage.getItem(key) !== candidate && storage.getItem(key) !== raw) { restored = false; continue; }
                if (raw === null) storage.removeItem(key); else storage.setItem(key, raw);
            } catch { restored = false; }
        }
        try { if (await flush() === false) restored = false; } catch { restored = false; }
        error.rollbackConfirmed = restored;
        throw error;
    } finally { pending.delete(storage); }
}
export async function initializeHistoryStart(firstPlanningYear, { today = localHistoryDate(), storage = persistenceStorage, ...options } = {}) {
    const current = requireHistoryRecord(storage.getItem(WEALTH_HISTORY_START_KEY), assertHistoryStart);
    if (current) return current;
    const value = assertHistoryStart({ version: 1, startDate: `${firstPlanningYear}-01-01` });
    if (value.startDate > today) throw new Error('Verlaufsbeginn liegt in der Zukunft.');
    await commitHistoryRecords([[WEALTH_HISTORY_START_KEY, JSON.stringify(value)]], { ...options, storage });
    return value;
}
export async function commitDailyPriceResult(symbol, result, options = {}) {
    const storage = options.storage || persistenceStorage;
    // Erneut lesen unmittelbar vor Writeaufnahme; Antworten basieren nie auf einer alten Gesamtkopie.
    const current = requireHistoryRecord(storage.getItem(DAILY_PRICES_KEY), assertDailyPrices, { version: 1, symbols: {} });
    const next = mergeDailyPriceResult(current, symbol, result);
    await commitHistoryRecords([[DAILY_PRICES_KEY, JSON.stringify(next)]], { ...options, storage });
    return next;
}
export function historyGaps(start, end, queried = []) {
    historyDate(start); historyDate(end);
    const intervals = mergeHistoryIntervals(queried);
    const gaps = [];
    let first = null, last = null;
    for (let day = start; day <= end; day++) {
        if (intervals.some(([a, b]) => day >= a && day <= b)) {
            if (first !== null) gaps.push([first, last]);
            first = last = null;
        } else {
            const weekday = new Date(day * 86400000).getUTCDay();
            if (weekday !== 0 && weekday !== 6) { first ??= day; last = day; }
        }
    }
    if (first !== null) gaps.push([first, last]);
    return gaps;
}
