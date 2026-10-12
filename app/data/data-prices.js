import { appNow } from '../shared/app-clock.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { PROFILE_STORAGE_KEYS, PROFILE_TRANCHES_KEY } from '../profile/profile-state.js';
import { PROFILE_WEALTH_LOTS_KEY, assertWealthLots } from '../profile/profile-wealth-history.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { collectHistoryQueue, runHistoryFetch } from '../tranches/tranchen-history-fetch.js';
import { DAILY_PRICES_KEY, WEALTH_HISTORY_START_KEY, assertDailyPrices, assertHistoryStart,
    requireHistoryRecord, normalizeHistorySymbol, historyDate, localHistoryDate } from '../tranches/tranchen-history-store.js';
import { normalizeQuote, probeProxyHealth } from '../tranches/tranchen-price-service.js';
import { readStartupPriceReport } from '../tranches/tranchen-startup-prices.js';

/** Aktive Livefelder sind maßgeblich, auch wenn sie entfernt wurden. */
export function priceRegistry(records) {
    const registry = JSON.parse(records[PROFILE_STORAGE_KEYS.registry] || '{"profiles":{}}');
    const active = records[PROFILE_STORAGE_KEYS.active];
    if (registry.profiles[active]) for (const key of [PROFILE_TRANCHES_KEY, PROFILE_WEALTH_LOTS_KEY]) {
        delete registry.profiles[active].data[key];
        if (Object.hasOwn(records, key)) registry.profiles[active].data[key] = records[key];
    }
    return registry;
}
export function projectDataPrices(records, { now = appNow(), startupReport = null, serviceReport = null } = {}) {
    try {
        const registry = priceRegistry(records);
        const prices = requireHistoryRecord(records[DAILY_PRICES_KEY], assertDailyPrices, { version: 1, symbols: {} });
        const start = requireHistoryRecord(records[WEALTH_HISTORY_START_KEY], assertHistoryStart);
        const inventory = new Map(), issues = [], quotes = [];
        for (const [profileId, profile] of Object.entries(registry.profiles)) {
            const tranches = normalizeTrancheCollection(JSON.parse(profile.data[PROFILE_TRANCHES_KEY] || '[]'), { mode: 'persisted' });
            const lots = requireHistoryRecord(profile.data[PROFILE_WEALTH_LOTS_KEY], assertWealthLots, { version: 1, lots: {} });
            const all = new Map(Object.entries(lots.lots).map(([id, lot]) => [id, lot.tranche]));
            for (const lot of tranches) all.set(lot.trancheId, lot);
            for (const lot of all.values()) {
                let symbol;
                try { symbol = normalizeHistorySymbol(lot.ticker); }
                catch { issues.push(`${profileId} / ${lot.name || lot.trancheId}: Ticker fehlt oder ist ungültig.`); continue; }
                if (!inventory.has(symbol)) inventory.set(symbol, new Set());
                inventory.get(symbol).add(lot.name || symbol);
            }
            for (const lot of tranches) {
                let fresh = false;
                try {
                    normalizeQuote({ symbol: lot.ticker, price: lot.currentPrice, asOf: lot.asOf, currency: 'EUR', source: 'stored' }, lot.ticker, { nowSeconds: now.getTime() / 1000 });
                    fresh = true;
                } catch { /* Alte oder undatierte Kurse sind kein aktueller Erfolg. */ }
                const result = startupReport?.results?.find(result => result.profileId === profileId && result.trancheId === lot.trancheId);
                quotes.push({ fresh, updated: fresh && result?.status === 'updated' && result.asOf === lot.asOf, asOf: lot.asOf });
            }
        }
        const coverage = start ? collectHistoryQueue(registry, start.startDate, localHistoryDate(now), prices) : null;
        const rows = [...new Set([...inventory.keys(), ...Object.keys(prices.symbols)])].sort().map(symbol => {
            const record = prices.symbols[symbol];
            return { symbol, names: [...(inventory.get(symbol) || [symbol])].join(', '), count: record?.days.length || 0,
                first: record?.days.length ? historyDate(record.days[0]) : null,
                requested: coverage?.wanted.find(item => item.symbol === symbol)?.intervals.map(([a, b]) => [historyDate(a), historyDate(b)]) || [],
                gaps: coverage ? coverage.queue.filter(job => job.symbol === symbol).map(job => job.interval.map(historyDate)) : null,
                confirmed: Boolean(record?.queried.length), error: record?.lastError || null };
        });
        const updated = quotes.filter(quote => quote.updated).length;
        let state = updated === quotes.length && quotes.length ? 'current' : updated ? 'partial' : 'unknown';
        if (state === 'current' && rows.some(row => row.error)) state = 'partial';
        if (serviceReport?.status === 'offline' || (startupReport?.status === 'offline' && !updated && serviceReport?.status !== 'available')) state = 'offline';
        const times = quotes.map(quote => quote.asOf).filter(time => Number.isInteger(time) && time > 0);
        return { state, rows, issues: [...issues, ...(coverage?.issues || []).map(issue => `${issue.profileId}: ${issue.reason}`)],
            startDate: start?.startDate || null, openIntervals: coverage?.queue.length ?? null,
            attemptedAt: serviceReport?.attemptedAt || startupReport?.retrievedAt || null,
            quoteAt: times.length ? Math.min(...times) * 1000 : null, serviceReport,
            total: rows.reduce((sum, row) => sum + row.count, 0), quoteCount: quotes.length, updatedCount: updated };
    } catch (error) { return { state: 'unknown', rows: [], issues: [error.message], openIntervals: null, total: null }; }
}

/** Ein eigener manueller Besitzer, ohne Änderung der automatischen Sitzungsmarker. */
export function bindDataPrices(doc, { win = doc.defaultView, storage = persistenceStorage, persistence = PersistenceFacade,
    guard = getPageNavigationGuard(doc, win), coordinator = runHistoryFetch, probe = probeProxyHealth,
    refresh = async () => {}, readModel, now = appNow } = {}) {
    const lifecycle = createNavigationOperationLifecycle({ guard, message: 'Tageskurse werden gespeichert – bitte warten.' });
    let active = null, controller = null, documentValid = true, serviceReport = null;
    const status = doc.getElementById('dataPriceActionStatus');
    const fetchButton = doc.getElementById('dataPriceFetch'), checkButton = doc.getElementById('dataPriceCheck');
    const reportOptions = () => {
        let startupReport = null;
        try { startupReport = readStartupPriceReport(win?.sessionStorage); } catch { /* unbekannter Sitzungsbefund */ }
        return { startupReport, serviceReport };
    };
    const cancel = () => { controller?.abort(); if (active?.phase !== 'commit') active?.controller.abort(); };
    win?.addEventListener?.('pagehide', () => { documentValid = false; cancel(); });
    doc.getElementById('dataPriceCancel')?.addEventListener('click', cancel);
    const execute = async kind => {
        if (controller || lifecycle.isBlocked() || win?.__profileRecoveryBlocker || persistence.getPersistenceStatus().migrationWarning) return;
        fetchButton.disabled = checkButton.disabled = true;
        doc.getElementById('dataPriceCancel').hidden = false;
        status.textContent = kind === 'history' ? 'Offene Abrufzeiträume werden nachgeladen …' : 'Kursdienst wird geprüft …';
        controller = new AbortController();
        const owned = fn => lifecycle.run({}, async operation => {
            active = operation;
            try { return await fn(operation); } finally { active = null; }
        });
        try {
            const attemptedAt = now().getTime();
            if (kind === 'health') await owned(async operation => {
                const identity = [PROFILE_STORAGE_KEYS.registry, PROFILE_STORAGE_KEYS.active, PROFILE_STORAGE_KEYS.current].map(key => [key, storage.getItem(key)]);
                const result = await probe({ signal: operation.controller.signal, deadline: Date.now() + 15000 });
                if (documentValid && !controller.signal.aborted && !operation.controller.signal.aborted && identity.every(([key, raw]) => storage.getItem(key) === raw)) {
                    serviceReport = { ...result, attemptedAt };
                    const detail = doc.getElementById('dataPriceTechnical'); if (detail) detail.textContent = result.error || '';
                    status.textContent = result.status === 'available' ? 'Kursdienst erreichbar. Dies bestätigt keine neuen Kurse.' : 'Kursdienst nicht erreichbar. Bitte versuche es später erneut.';
                } else if (documentValid) status.textContent = 'Dienstprüfung abgebrochen.';
            });
            else {
                const keys = [PROFILE_STORAGE_KEYS.registry, PROFILE_STORAGE_KEYS.active, PROFILE_STORAGE_KEYS.current, PROFILE_TRANCHES_KEY, PROFILE_WEALTH_LOTS_KEY, WEALTH_HISTORY_START_KEY];
                const source = keys.map(key => [key, storage.getItem(key)]);
                const model = await readModel();
                if (!documentValid || controller.signal.aborted || source.some(([key, raw]) => storage.getItem(key) !== raw)) {
                    status.textContent = 'Nachladen wegen Kontextwechsel abgebrochen.'; return;
                }
                if (!model.priceCoverage?.startDate || model.priceCoverage.openIntervals === null) throw new Error('Verlaufsbeginn oder Bestand nicht verlässlich lesbar.');
                if (model.priceCoverage.openIntervals === 0) { status.textContent = 'Alle angeforderten Zeiträume sind bestätigt. Kein Abruf nötig.'; return; }
                const result = await coordinator({ firstPlanningYear: Number(model.priceCoverage.startDate.slice(0, 4)), storage,
                    today: localHistoryDate(now()), signal: controller.signal,
                    valid: () => documentValid && !controller.signal.aborted,
                    withOperation: owned });
                if (documentValid) {
                    const labels = { complete: 'abgeschlossen', cancelled: 'abgebrochen', 'budget-ended': 'Zeitlimit erreicht', 'storage-error': 'Speicherung fehlgeschlagen', partial: 'teilweise bestätigt', offline: 'Kursdienst nicht erreichbar' };
                    status.textContent = `Nachladen: ${labels[result.status] || 'nicht abgeschlossen'} · ${result.completed} ${result.completed === 1 ? 'Zeitraum' : 'Zeiträume'} bestätigt.`;
                    const detail = doc.getElementById('dataPriceTechnical'); if (detail) detail.textContent = result.error?.message || '';
                    serviceReport = { status: result.status === 'offline' ? 'offline' : 'unknown', attemptedAt };
                }
            }
        } catch (error) { if (documentValid) {
            status.textContent = 'Die Kursprüfung konnte nicht abgeschlossen werden. Weitere Hinweise findest du unter „Technische Details“.';
            const detail = doc.getElementById('dataPriceTechnical'); if (detail) detail.textContent = error.message;
        } }
        finally {
            active = null; controller = null;
            if (documentValid) {
                checkButton.disabled = false;
                doc.getElementById('dataPriceCancel').hidden = true;
                await refresh();
            }
        }
    };
    fetchButton?.addEventListener('click', () => void execute('history'));
    checkButton?.addEventListener('click', () => void execute('health'));
    return { reportOptions, execute, cancel, isRunning: () => Boolean(controller) };
}
