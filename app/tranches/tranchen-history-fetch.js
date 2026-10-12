import { marketPriceAdapter, isSyntheticPriceMode } from '../shared/market-price-adapter.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { shouldHandleAppNavigation } from '../profile/profile-navigation.js';
import { PROFILE_STORAGE_KEYS, PROFILE_TRANCHES_KEY } from '../profile/profile-state.js';
import { PROFILE_WEALTH_LOTS_KEY, assertWealthLots, captureWealthLots } from '../profile/profile-wealth-history.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { LOCAL_YAHOO_PROXY } from './tranchen-price-service.js';
import { WEALTH_HISTORY_START_KEY, DAILY_PRICES_KEY, assertHistoryStart, assertDailyPrices, requireHistoryRecord,
    historyDay, historyDate, localHistoryDate, normalizeHistorySymbol, mergeHistoryIntervals, historyGaps,
    commitHistoryRecords, commitDailyPriceResult } from './tranchen-history-store.js';

export const HISTORY_FETCH_BUDGET_MS = 20000;
export const HISTORY_FETCH_SESSION_KEY = 'rs_history_fetch_session_v1';
const bindings = new WeakMap();
function boundaryError(code) { const error = new Error(code); error.code = code; if (code === 'HISTORY_ABORTED') error.name = 'AbortError'; return error; }
function assertRequestAlive({ signal, deadline, now, valid }) {
    if (signal?.aborted || !valid()) throw boundaryError('HISTORY_ABORTED');
    if (now() >= deadline) throw boundaryError('HISTORY_BUDGET_ENDED');
}
export function historyChartUrl(symbol, interval, proxyBase = LOCAL_YAHOO_PROXY) {
    interval.forEach(historyDate);
    if (interval[0] > interval[1]) throw new Error('Umgekehrter HTTP-Zeitraum.');
    return `${proxyBase.replace(/\/$/, '')}/chart?symbol=${encodeURIComponent(normalizeHistorySymbol(symbol))}&period1=${interval[0] * 86400}&period2=${(interval[1] + 1) * 86400}&interval=1d`;
}
export function parseHistoryChart(data, symbol, interval) {
    symbol = normalizeHistorySymbol(symbol);
    if (data?.chart?.error) throw boundaryError(`HISTORY_PROVIDER_ERROR: ${data.chart.error.code || 'unknown'}: ${data.chart.error.description || 'Keine Kursdaten'}`);
    const results = data?.chart?.result;
    if (!Array.isArray(results) || results.length !== 1) throw boundaryError('HISTORY_INVALID_RESPONSE');
    const result = results[0], meta = result?.meta;
    if (normalizeHistorySymbol(meta?.symbol) !== symbol) throw boundaryError('HISTORY_SYMBOL_MISMATCH');
    if (!/^[A-Z]{3}$/.test(meta?.currency || '') || typeof meta.exchangeTimezoneName !== 'string') throw boundaryError('HISTORY_INVALID_RESPONSE');
    let formatter;
    try { formatter = new Intl.DateTimeFormat('en-US', { timeZone: meta.exchangeTimezoneName, year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch { throw boundaryError('HISTORY_INVALID_TIMEZONE'); }
    const timestamps = result.timestamp === undefined ? [] : result.timestamp;
    if (!Array.isArray(result.indicators?.quote) || result.indicators.quote.length !== 1 || !result.indicators.quote[0] || typeof result.indicators.quote[0] !== 'object') throw boundaryError('HISTORY_INVALID_RESPONSE');
    const closes = result.indicators.quote[0].close ?? (Array.isArray(timestamps) && timestamps.length === 0 ? [] : null);
    if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length) throw boundaryError('HISTORY_INVALID_RESPONSE');
    const points = new Map();
    timestamps.forEach((stamp, index) => {
        if (!Number.isSafeInteger(stamp) || !Number.isFinite(new Date(stamp * 1000).getTime())) throw boundaryError('HISTORY_INVALID_RESPONSE');
        const parts = Object.fromEntries(formatter.formatToParts(new Date(stamp * 1000)).map(part => [part.type, part.value]));
        const day = historyDay(`${parts.year}-${parts.month}-${parts.day}`);
        const close = closes[index];
        if (close === null) return;
        if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) throw boundaryError('HISTORY_INVALID_RESPONSE');
        if (day >= interval[0] && day <= interval[1]) points.set(day, close);
    });
    const days = [...points.keys()].sort((a, b) => a - b);
    return { currency: meta.currency, days, closes: days.map(day => points.get(day)), interval: [...interval] };
}
/** Race umfasst Headers, Body und Prüfung; späte Providerfortsetzungen haben keinen Writer. */
export async function fetchHistoryChart(symbol, interval, { fetchImpl = globalThis.fetch, proxyBase = LOCAL_YAHOO_PROXY,
    signal, deadline, now = () => performance.now(), valid = () => true, schedule = setTimeout, unschedule = clearTimeout } = {}) {
    const context = { signal, deadline, now, valid };
    assertRequestAlive(context);
    if (isSyntheticPriceMode()) {
        const result = await marketPriceAdapter('chart', { symbol, interval }, () => { throw new Error('Unerwarteter Kursnetzpfad.'); });
        assertRequestAlive(context);
        if (!result.interval) throw boundaryError('HISTORY_ABORTED');
        return result;
    }
    const controller = new AbortController();
    let rejectBoundary;
    const boundary = new Promise((_, reject) => { rejectBoundary = reject; });
    const abort = () => { controller.abort(); rejectBoundary(boundaryError('HISTORY_ABORTED')); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = schedule(() => { controller.abort(); rejectBoundary(boundaryError('HISTORY_BUDGET_ENDED')); }, deadline - now());
    const request = async () => {
        try {
            const response = await fetchImpl(historyChartUrl(symbol, interval, proxyBase), { signal: controller.signal, cache: 'no-store' });
            assertRequestAlive(context);
            if (!response.ok) throw boundaryError(`HISTORY_HTTP_${response.status}`);
            let data;
            try { data = await response.json(); }
            catch { assertRequestAlive(context); throw boundaryError('HISTORY_INVALID_RESPONSE'); }
            assertRequestAlive(context);
            const parsed = parseHistoryChart(data, symbol, interval);
            assertRequestAlive(context);
            return parsed;
        } catch (error) {
            assertRequestAlive(context);
            if (error.code) throw error;
            if (error.name === 'AbortError') throw boundaryError('HISTORY_ABORTED');
            throw boundaryError(`HISTORY_SERVICE_UNREACHABLE: ${error.message || 'Unbekannter Dienstfehler'}`);
        }
    };
    try { return await Promise.race([boundary, request()]); }
    finally { unschedule(timer); signal?.removeEventListener('abort', abort); }
}
export function collectHistoryQueue(registry, startDate, today, prices = { version: 1, symbols: {} }) {
    assertDailyPrices(prices);
    const start = historyDay(startDate), end = historyDay(today) - (isSyntheticPriceMode() ? 0 : 1);
    const wanted = new Map(), issues = [];
    for (const [profileId, profile] of Object.entries(registry.profiles)) {
        const tranches = normalizeTrancheCollection(JSON.parse(profile.data[PROFILE_TRANCHES_KEY] || '[]'), { mode: 'persisted' });
        const saved = requireHistoryRecord(profile.data[PROFILE_WEALTH_LOTS_KEY], assertWealthLots, { version: 1, lots: {} });
        const lots = new Map(Object.entries(saved.lots).map(([id, lot]) => [id, lot.tranche]));
        for (const lot of tranches) lots.set(lot.trancheId, lot);
        for (const [trancheId, lot] of lots) {
            if (!lot.ticker) { issues.push({ profileId, trancheId, reason: 'Kein Kursverlauf ohne Ticker' }); continue; }
            let symbol;
            try { symbol = normalizeHistorySymbol(lot.ticker); } catch { issues.push({ profileId, trancheId, reason: 'Ungültiger Ticker' }); continue; }
            if (!lot.purchaseDate) { issues.push({ profileId, trancheId, reason: 'Kaufdatum fehlt' }); continue; }
            const from = Math.max(start, historyDay(lot.purchaseDate));
            if (from > end) continue;
            if (!wanted.has(symbol)) wanted.set(symbol, []);
            wanted.get(symbol).push([from, end]);
        }
    }
    const queue = [];
    for (const [symbol, intervals] of wanted) for (const [from, to] of mergeHistoryIntervals(intervals)) {
        const queried = prices.symbols[symbol]?.queried || [];
        const gaps = isSyntheticPriceMode() ? syntheticHistoryGaps(from, to, queried) : historyGaps(from, to, queried);
        for (const interval of gaps) queue.push({ symbol, interval });
    }
    queue.sort((a, b) => a.interval[0] - b.interval[0] || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
    return { queue, issues, wanted: [...wanted].map(([symbol, intervals]) => ({ symbol, intervals: mergeHistoryIntervals(intervals) })) };
}
/** Im Testmodus auch reine oder nachlaufende Wochenenden dauerhaft als abgefragt bestätigen. */
function syntheticHistoryGaps(from, to, queried) {
    const gaps = [];
    let cursor = from;
    for (const [start, end] of mergeHistoryIntervals(queried)) {
        if (end < cursor) continue;
        if (start > to) break;
        if (start > cursor) gaps.push([cursor, start - 1]);
        cursor = Math.max(cursor, end + 1);
    }
    if (cursor <= to) gaps.push([cursor, to]);
    return gaps;
}
export function historyFailureHints(prices) {
    return Object.entries(prices.symbols).filter(([, record]) => record.failures >= 3)
        .map(([symbol, record]) => `${symbol}: Drei aufeinanderfolgende Kursabrufe fehlgeschlagen (${record.lastError}). Der Zeitraum bleibt offen.`);
}
/** Initialisierung aus bestätigtem Bestand; Beginn ist unabhängig vom späteren Kalenderjahr. */
export async function initializeHistoryData(firstPlanningYear, { storage = persistenceStorage, today = localHistoryDate(), ...options } = {}) {
    const start = requireHistoryRecord(storage.getItem(WEALTH_HISTORY_START_KEY), assertHistoryStart)
        || assertHistoryStart({ version: 1, startDate: `${firstPlanningYear}-01-01` });
    if (start.startDate > today) throw new Error('Verlaufsbeginn liegt in der Zukunft.');
    const registryRaw = storage.getItem(PROFILE_STORAGE_KEYS.registry);
    const registry = JSON.parse(registryRaw);
    const active = storage.getItem(PROFILE_STORAGE_KEYS.active);
    if (!registry?.profiles?.[active] || active !== storage.getItem(PROFILE_STORAGE_KEYS.current)) throw new Error('HISTORY_PROFILE_CONTEXT_CHANGED');
    const liveRaw = storage.getItem(PROFILE_TRANCHES_KEY);
    const records = [];
    if (storage.getItem(WEALTH_HISTORY_START_KEY) === null) records.push([WEALTH_HISTORY_START_KEY, JSON.stringify(start)]);
    for (const [id, profile] of Object.entries(registry.profiles)) {
        const raw = id === active ? liveRaw : profile.data[PROFILE_TRANCHES_KEY];
        const previous = id === active ? storage.getItem(PROFILE_WEALTH_LOTS_KEY) : profile.data[PROFILE_WEALTH_LOTS_KEY];
        const tranches = normalizeTrancheCollection(JSON.parse(raw || '[]'), { mode: 'persisted' });
        if (id === active) {
            if (liveRaw === null) delete profile.data[PROFILE_TRANCHES_KEY];
            else profile.data[PROFILE_TRANCHES_KEY] = liveRaw;
        }
        if (!tranches.length && previous == null) continue;
        const next = JSON.stringify(captureWealthLots(previous, tranches, today));
        if (id === active && next !== previous) records.push([PROFILE_WEALTH_LOTS_KEY, next]);
        profile.data[PROFILE_WEALTH_LOTS_KEY] = next;
    }
    const nextRegistryRaw = JSON.stringify(registry);
    // JSON-Reformatierung allein ist kein Anlass für eine neue Speicherung.
    if (JSON.stringify(JSON.parse(registryRaw)) !== nextRegistryRaw) records.push([PROFILE_STORAGE_KEYS.registry, nextRegistryRaw]);
    if (records.length) await commitHistoryRecords(records, { ...options, storage, valid: () => (options.valid?.() ?? true)
        && storage.getItem(PROFILE_STORAGE_KEYS.registry) === registryRaw && storage.getItem(PROFILE_TRANCHES_KEY) === liveRaw
        && storage.getItem(PROFILE_STORAGE_KEYS.active) === active && storage.getItem(PROFILE_STORAGE_KEYS.current) === active });
    return { start, registry };
}
export async function runHistoryFetch({ firstPlanningYear, storage = persistenceStorage, today = localHistoryDate(), now = () => performance.now(),
    valid = () => true, signal, withOperation = execute => execute(null), flush = () => PersistenceFacade.flush(), ...fetchOptions } = {}) {
    const deadline = now() + HISTORY_FETCH_BUDGET_MS;
    const externalValid = valid;
    const identity = [PROFILE_STORAGE_KEYS.active, PROFILE_STORAGE_KEYS.current, PROFILE_TRANCHES_KEY].map(key => [key, storage.getItem(key)]);
    let source = null;
    const sourceKeys = [PROFILE_STORAGE_KEYS.registry, PROFILE_STORAGE_KEYS.active, PROFILE_STORAGE_KEYS.current,
        PROFILE_TRANCHES_KEY, PROFILE_WEALTH_LOTS_KEY, WEALTH_HISTORY_START_KEY];
    valid = () => externalValid() && identity.every(([key, raw]) => storage.getItem(key) === raw) && (!source || source.every(([key, raw]) => storage.getItem(key) === raw));
    const alive = operation => !signal?.aborted && !operation?.controller.signal.aborted && valid() && now() < deadline;
    if (!alive()) return { status: 'cancelled', completed: 0 };
    const initialized = await withOperation(operation => initializeHistoryData(firstPlanningYear, { storage, today, flush, operation, valid: () => alive(operation) }));
    source = sourceKeys.map(key => [key, storage.getItem(key)]);
    if (!valid() || JSON.stringify(JSON.parse(storage.getItem(PROFILE_STORAGE_KEYS.registry))) !== JSON.stringify(initialized.registry)) {
        return { status: 'cancelled', completed: 0 };
    }
    const prices = requireHistoryRecord(storage.getItem(DAILY_PRICES_KEY), assertDailyPrices, { version: 1, symbols: {} });
    const { queue, issues } = collectHistoryQueue(initialized.registry, initialized.start.startDate, today, prices);
    let completed = 0, status = 'complete';
    const failed = new Set();
    for (const job of queue) {
        if (!alive()) { status = signal?.aborted || !valid() ? 'cancelled' : 'budget-ended'; break; }
        if (failed.has(job.symbol)) continue;
        try {
            await withOperation(async operation => {
                const jobSignal = operation?.controller.signal || signal;
                let result;
                try { result = await fetchHistoryChart(job.symbol, job.interval, { ...fetchOptions, signal: jobSignal, deadline, now, valid }); }
                catch (error) {
                    if (error.code === 'HISTORY_ABORTED') { status = 'cancelled'; return; }
                    if (error.code === 'HISTORY_BUDGET_ENDED') { status = 'budget-ended'; return; }
                    failed.add(job.symbol);
                    result = { error: error.message };
                }
                if (!alive(operation)) throw boundaryError(signal?.aborted || operation?.controller.signal.aborted || !valid() ? 'HISTORY_ABORTED' : 'HISTORY_BUDGET_ENDED');
                await commitDailyPriceResult(job.symbol, result, { storage, flush, operation, valid: () => alive(operation) });
                if (!result.error) completed++;
            });
            if (status !== 'complete') break;
        } catch (error) {
            status = error.name === 'AbortError' ? 'cancelled' : error.code === 'HISTORY_BUDGET_ENDED' ? 'budget-ended' : error.code === 'HISTORY_ABORTED' || signal?.aborted || !valid() ? 'cancelled' : 'storage-error';
            break;
        }
    }
    const confirmed = requireHistoryRecord(storage.getItem(DAILY_PRICES_KEY), assertDailyPrices, { version: 1, symbols: {} });
    if (status === 'complete' && failed.size) status = completed ? 'partial' : 'offline';
    return { status, completed, issues, hints: historyFailureHints(confirmed) };
}
export function renderHistoryHints(doc, hints) {
    const host = doc.getElementById('startupPriceStatus');
    if (!host || !hints.length) return;
    const hint = doc.createElement('p');
    hint.className = 'history-price-status';
    hint.textContent = hints.join(' ');
    host.appendChild(hint);
}
/** Eigene Sitzungssperre und eigenes Budget, erst NACH dem bestehenden Quotejob. */
export function bindHistoryFetch({ doc = globalThis.document, win = globalThis.window, afterStartup, firstPlanningYear,
    guard = getPageNavigationGuard(doc, win), coordinator = runHistoryFetch, session, storage = persistenceStorage, onReport } = {}) {
    if (bindings.has(doc)) return bindings.get(doc);
    let valid = true, operation = null, documentValid = true;
    const controller = new AbortController();
    const lifecycle = createNavigationOperationLifecycle({ guard, message: 'Kursverlauf wird dauerhaft gespeichert – bitte warten.' });
    const cancel = () => { valid = false; controller.abort(); if (operation?.phase !== 'commit') operation?.controller.abort(); };
    const pagehide = () => { documentValid = false; cancel(); };
    const management = event => {
        const link = event.type === 'click' && event.target?.closest?.('a[href]');
        const navigation = link && shouldHandleAppNavigation(link, win) && !(event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey);
        const target = navigation ? link : event.target?.closest?.('#profileSelect, #profileCreateBtn, #profileRenameBtn, #profileDeleteBtn, #fullBackupImportBtn, #fullBackupImportFile');
        if (!target || (event.type === 'click' && target.id === 'profileSelect')) return;
        cancel();
        if (!operation) return;
        event.preventDefault(); event.stopImmediatePropagation();
        task.finally(() => {
            if (!documentValid || target.isConnected === false) return;
            if (event.type === 'click') target.click();
            else target.dispatchEvent(new (win.Event || Event)(event.type, { bubbles: true, cancelable: true }));
        }).catch(() => {});
    };
    doc.addEventListener('click', management, true); doc.addEventListener('change', management, true);
    win?.addEventListener?.('pagehide', pagehide);
    const task = (async () => {
        try {
            await afterStartup;
            if (!valid || win?.__profileRecoveryBlocker || PersistenceFacade.getPersistenceStatus().migrationWarning) return;
            session ||= win?.sessionStorage;
            if (!session || session.getItem(HISTORY_FETCH_SESSION_KEY)) return;
            session.setItem(HISTORY_FETCH_SESSION_KEY, 'started');
            const report = await coordinator({ storage, firstPlanningYear: typeof firstPlanningYear === 'function' ? firstPlanningYear() : firstPlanningYear,
                valid: () => valid && !guard.isBusy(), signal: controller.signal,
                withOperation: execute => lifecycle.run({}, async owner => {
                    operation = owner;
                    try { return await execute(owner); } finally { operation = null; }
                }) });
            if (valid) renderHistoryHints(doc, report?.hints || []);
            onReport?.(report);
            return report;
        } catch (error) { return { status: 'unavailable', reason: error.message }; }
        finally {
            doc.removeEventListener?.('click', management, true); doc.removeEventListener?.('change', management, true);
            win?.removeEventListener?.('pagehide', pagehide);
        }
    })();
    bindings.set(doc, task);
    return task;
}
