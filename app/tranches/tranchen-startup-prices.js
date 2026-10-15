import { areaSessionStorage } from '../shared/persistence-area-storage.js';
import { appNow, getAppTestDate } from '../shared/app-clock.js';
// @ts-check
import { initializeProfilePage, whenProfileDisplayReady, shouldHandleAppNavigation } from '../profile/profile-navigation.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { saveCurrentProfileFromLocalStorage, patchInactiveProfileQuotes } from '../profile/profile-storage.js';
import { PROFILE_STORAGE_KEYS, PROFILE_TRANCHES_KEY } from '../profile/profile-state.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { normalizeTranches, saveTranchesToStorage } from './tranchen-manager-state.js';
import { createBatchQuoteFetcher, resolveTrancheQuote } from './tranchen-price-service.js';

export const STARTUP_PRICE_TIMEOUT_MS = 15000;
const STARTUP_COMMIT_RESERVE_MS = 1000;
export const STARTUP_PRICE_SESSION_KEY = 'rs_startup_prices_session_v1';
const bindings = new WeakMap();
const sessionRuns = new WeakMap();
const affectedKeys = [PROFILE_TRANCHES_KEY, PROFILE_STORAGE_KEYS.registry];

export function captureStartupPriceSource() {
    const loaded = loadProfileRegistry();
    if (!loaded.value) throw new Error('PROFILE_REGISTRY_UNAVAILABLE');
    const identity = [PROFILE_STORAGE_KEYS.current, PROFILE_STORAGE_KEYS.active].map(key => persistenceStorage.getItem(key));
    const activeId = identity[0];
    if (!activeId || identity[1] !== activeId || !loaded.value.profiles[activeId]) throw new Error('PROFILE_CONTEXT_UNAVAILABLE');
    return { registryRaw: loaded.raw, registry: JSON.parse(loaded.raw), identity, activeId,
        liveRaw: persistenceStorage.getItem(PROFILE_TRANCHES_KEY) };
}

function sourceUnchanged(source) {
    return persistenceStorage.getItem(PROFILE_STORAGE_KEYS.registry) === source.registryRaw
        && persistenceStorage.getItem(PROFILE_TRANCHES_KEY) === source.liveRaw
        && [PROFILE_STORAGE_KEYS.current, PROFILE_STORAGE_KEYS.active].every((key, index) => persistenceStorage.getItem(key) === source.identity[index]);
}

/** Ein bestätigter Erfolgsflush; Fehler verwenden das bestehende kompensierende Rückschreiben. */
export async function commitStartupPriceResults(source, results, operation, { valid = () => true, flush = () => PersistenceFacade.flush() } = {}) {
    operation.check();
    if (!valid() || !sourceUnchanged(source)) throw new Error('QUOTE_SOURCE_CHANGED');
    const updated = results.filter(result => result.status === 'updated');
    if (!updated.length) return;
    const patches = new Map();
    for (const result of updated) {
        if (!patches.has(result.profileId)) patches.set(result.profileId, { profileId: result.profileId, raw: result.raw, updates: [] });
        patches.get(result.profileId).updates.push({ index: result.index, trancheId: result.trancheId, quote: result.quote });
    }
    if (!valid()) throw new Error('QUOTE_SOURCE_CHANGED');
    operation.commit();
    const previous = [source.liveRaw, source.registryRaw];
    try {
        const active = patches.get(source.activeId);
        if (active) {
            const records = normalizeTranches(JSON.parse(active.raw));
            for (const update of active.updates) {
                if (records[update.index]?.trancheId !== update.trancheId) throw new Error('QUOTE_PATCH_INVALID');
                records[update.index] = { ...records[update.index], currentPrice: update.quote.price,
                    asOf: update.quote.asOf, ticker: update.quote.symbol };
            }
            saveTranchesToStorage(records);
            if (!saveCurrentProfileFromLocalStorage()) throw new Error('PROFILE_SAVE_FAILED');
        }
        patchInactiveProfileQuotes([...patches.values()].filter(patch => patch.profileId !== source.activeId), source.activeId, source.registry);
        if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    } catch (error) {
        let restored = true;
        affectedKeys.forEach((key, index) => {
            try {
                if (previous[index] == null) persistenceStorage.removeItem(key);
                else persistenceStorage.setItem(key, previous[index]);
            } catch { restored = false; }
        });
        try { if (await flush() === false) restored = false; } catch { restored = false; }
        error.restored = restored;
        throw error;
    }
}

function collectJobs(source) {
    const jobs = [], issues = [];
    for (const [profileId, profile] of Object.entries(source.registry.profiles)) {
        const profileName = displayName(profile.meta.name);
        const raw = profileId === source.activeId ? source.liveRaw : profile.data[PROFILE_TRANCHES_KEY];
        if (raw == null || raw === '') continue;
        try {
            const originals = JSON.parse(raw);
            const records = normalizeTranches(originals);
            records.forEach((tranche, index) => {
                const identity = String(originals[index]?.trancheId || originals[index]?.id || '').trim();
                const item = { profileId, profileName, trancheId: tranche.trancheId,
                    trancheName: displayName(tranche.name), index, raw, tranche };
                if (!identity || identity !== tranche.trancheId) issues.push({ ...item, status: 'skipped', code: 'TRANCHE_ID_UNMAPPABLE' });
                else jobs.push(item);
            });
        } catch { issues.push({ profileId, profileName, trancheName: 'Bestand', status: 'failed', code: 'TRANCHE_STORAGE_CORRUPT' }); }
    }
    return { jobs, issues };
}

/** DOM-frei: Deadline umfasst Suche, Wiederholung und Warteschlange.
 * Abbruch ignorierende Promises bleiben ausschließlich lesend und dürfen keine Ergebnisse mehr liefern.
 */
export async function runStartupPriceRefresh({ source = captureStartupPriceSource(), operation,
    now = Date.now, schedule = setTimeout, unschedule = clearTimeout, valid = () => true,
    commit = commitStartupPriceResults, progress = () => {} } = {}) {
    const { jobs, issues } = collectJobs(source);
    const controller = new AbortController();
    const startedAt = now(), deadline = startedAt + STARTUP_PRICE_TIMEOUT_MS;
    const fetcher = createBatchQuoteFetcher(controller.signal, { deduplicateSearchNames: true, deadline, now, schedule, unschedule });
    let open = true, timedOut = false, cancelled = false, fallback = false, fallbackClosed = false, reserveTimer, wake;
    const boundary = new Promise(resolve => { wake = resolve; });
    const closeReaders = () => {
        open = false;
        unschedule(reserveTimer);
        controller.abort();
        wake();
    };
    const cancel = () => { cancelled = true; closeReaders(); };
    operation.controller.signal.addEventListener('abort', cancel, { once: true });
    const timer = schedule(() => { timedOut = true; closeReaders(); }, STARTUP_PRICE_TIMEOUT_MS);
    const grouped = new Map();
    for (const job of jobs) {
        const key = [job.tranche.ticker, job.tranche.isin].map(value => String(value || '').trim().toUpperCase()).join('|');
        if (!grouped.has(key)) grouped.set(key, { jobs: [], fetcher: fetcher.forGroup(), result: null });
        grouped.get(key).jobs.push(job);
    }
    const groups = [...grouped.values()];
    const canRead = () => open && now() < deadline;
    const reserve = () => {
        // Die direkte Runde bleibt unverkürzt. Auch der erste Fallbackerfolg aktiviert die Reserve.
        if (!fallback || !canRead() || !groups.some(group => group.result?.status === 'updated')) return;
        const remaining = deadline - STARTUP_COMMIT_RESERVE_MS - now();
        const closeFallback = () => { fallbackClosed = true; closeReaders(); };
        if (remaining <= 0) closeFallback();
        else if (reserveTimer === undefined) reserveTimer = schedule(closeFallback, remaining);
    };
    const round = async (requests, resolve) => {
        let next = 0;
        const worker = async () => {
            while (canRead() && next < requests.length) {
                const group = requests[next++];
                group.pending = true;
                let result;
                try { result = await resolve(group); }
                catch (error) { result = { status: 'failed', code: error.code || 'QUOTE_FAILED' }; }
                if (!canRead()) return;
                group.pending = false;
                group.result = result;
                if (fallback) group.fallbackComplete = true;
                progress({ status: 'running', completed: issues.length + groups.filter(item => item.result).reduce((sum, item) => sum + item.jobs.length, 0),
                    total: jobs.length + issues.length });
                reserve();
            }
        };
        await Promise.all(Array.from({ length: Math.min(3, requests.length) }, worker));
    };
    const collect = () => [...issues, ...groups.flatMap(group => group.jobs.map(job => ({ ...job,
        ...(fallbackClosed && group.result?.status !== 'updated' && !group.fallbackComplete
            ? { status: 'failed', code: 'STARTUP_FALLBACK_TIMEOUT' }
            : group.pending ? { status: 'failed', code: 'STARTUP_TIMEOUT' }
                : group.result || { status: 'failed', code: 'STARTUP_TIMEOUT' }), requestDurationMs: group.fetcher.duration() })))];
    try {
        if (operation.controller.signal.aborted) cancel();
        const read = async () => {
            // Runde 1 ausschließlich gespeicherter Ticker. Erst nach ALLEN direkten Gruppen suchen.
            await round(groups.filter(group => String(group.jobs[0].tranche.ticker || '').trim()), async group => {
                const quote = await group.fetcher.quote(group.jobs[0].tranche.ticker);
                group.fetcher.check();
                return { status: 'updated', quote };
            });
            if (!canRead()) return;
            fallback = true;
            reserve();
            // Der Batchcache bewahrt auch Fehlschläge: resolveTrancheQuote quotiert keinen Ticker erneut.
            await round(groups.filter(group => group.result?.status !== 'updated'),
                group => resolveTrancheQuote(group.jobs[0].tranche, group.fetcher));
        };
        await Promise.race([read(), boundary]);
        closeReaders();
        let results = collect();
        timedOut ||= now() >= deadline;
        unschedule(timer);
        if (cancelled || !valid() || operation.controller.signal.aborted) return { status: 'cancelled', updated: 0, results: [] };
        if (timedOut) {
            // Ohne rechtzeitig begonnenen Commit ist kein Erfolg dauerhaft bestätigt.
            results = results.map(result => result.status === 'updated' ? { ...result, status: 'failed', code: 'STARTUP_TIMEOUT' } : result);
            return { status: 'timeout', updated: 0, retrievedAt: getAppTestDate() ? appNow().getTime() : now(), results };
        }
        const updated = results.filter(result => result.status === 'updated').length;
        try {
            if (updated) await commit(source, results, operation, { valid: () => valid() && now() < deadline });
            return { status: updated ? 'complete' : 'offline', updated, retrievedAt: getAppTestDate() ? appNow().getTime() : now(), results };
        } catch (error) {
            if (operation.controller.signal.aborted || !valid()) return { status: 'cancelled', updated: 0, results: [] };
            const expired = now() >= deadline && operation.phase !== 'commit';
            return { status: expired ? 'timeout'
                : error.message === 'QUOTE_SOURCE_CHANGED' ? 'changed' : 'storage-failed', updated: 0,
                retrievedAt: getAppTestDate() ? appNow().getTime() : now(), restored: error.restored, results: results.map(result => result.status === 'updated'
                    ? { ...result, status: 'failed', code: expired ? 'STARTUP_TIMEOUT' : 'NOT_STORED' } : result) };
        }
    } finally {
        closeReaders(); unschedule(timer);
        operation.controller.signal.removeEventListener('abort', cancel);
    }
}

function displayName(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function sessionReport(report) {
    const { status, updated, retrievedAt, restored } = report;
    return { status, updated, retrievedAt, restored,
        results: (report.results || []).map(({ profileId, trancheId, profileName, trancheName, status, code, message, quote }) => ({
            profileId, trancheId, profileName, trancheName, status, code, message, asOf: quote?.asOf
        })) };
}

/** Dialogabrufe warten auf den einmaligen Sitzungsabruf, ohne seinen Merker zurückzusetzen. */
export function waitStartupPriceRefresh(doc) { return bindings.get(doc) || Promise.resolve(); }
export function publishStartupPriceReport(report, session = areaSessionStorage()) {
    if (!session) return;
    const saved = sessionReport(report);
    sessionRuns.set(session, saved);
    try { session.setItem(STARTUP_PRICE_SESSION_KEY, JSON.stringify(saved)); } catch { /* Speicherbericht bleibt im Dokument verfügbar. */ }
}

/** Unterseiten lesen den bestehenden Sitzungsbefund, ohne einen Quotejob zu starten. */
export function readStartupPriceReport(session = areaSessionStorage()) {
    try {
        const report = sessionRuns.get(session) || JSON.parse(session?.getItem(STARTUP_PRICE_SESSION_KEY) || 'null');
        return report && typeof report === 'object' && Array.isArray(report.results) ? report : null;
    } catch { return null; }
}

/** Altmerker nur lesend ergänzen: keine Normalisierung mit erzeugten IDs, keine Writes. */
function restoreReportNames(report, readSource) {
    if (!report.results?.some(result => result.status !== 'updated' || !displayName(result.profileName) || !displayName(result.trancheName))) return report;
    try {
        const source = readSource();
        return { ...report, results: report.results.map(result => {
            const profile = source?.registry?.profiles?.[result.profileId];
            let trancheName = displayName(result.trancheName);
            let storedAsOf;
            if (profile && result.trancheId) {
                try {
                    const raw = result.profileId === source.activeId ? source.liveRaw : profile.data[PROFILE_TRANCHES_KEY];
                    const records = JSON.parse(raw);
                    const matches = records.filter(record => String(record?.trancheId || record?.id || '').trim() === result.trancheId);
                    if (matches.length === 1) {
                        trancheName ||= displayName(matches[0].name);
                        storedAsOf = matches[0].asOf;
                    }
                } catch { /* Fehlender oder beschädigter Bestand behält den Ersatztext. */ }
            }
            return { ...result, profileName: displayName(result.profileName) || displayName(profile?.meta?.name), trancheName, storedAsOf };
        }) };
    } catch { /* Unlesbare Quelle darf die Statusanzeige nicht verhindern. */ return report; }
}

export function quoteIssueReason(result) {
    const reasons = {
        STARTUP_TIMEOUT: 'globales Zeitlimit erreicht', TRANCHE_STORAGE_CORRUPT: 'Tranchenbestand nicht lesbar',
        STARTUP_FALLBACK_TIMEOUT: 'Zeitlimit für Instrumentauflösung erreicht',
        TRANCHE_ID_UNMAPPABLE: 'Originalrecord nicht eindeutig zuordenbar', NOT_STORED: 'Speicherung nicht bestätigt',
        MISSING_IDENTIFIER: 'Ticker oder ISIN fehlt', PROXY_UNREACHABLE: 'Kursdienst nicht erreichbar',
        REQUEST_TIMEOUT: 'Kursdienst antwortet nicht rechtzeitig', REQUEST_ABORTED: 'Abruf abgebrochen',
        PROVIDER_TIMEOUT: 'Kursanbieter antwortet nicht rechtzeitig',
        PROVIDER_UNAVAILABLE: 'Kursanbieter vorübergehend nicht verfügbar',
        PROVIDER_RATE_LIMITED: 'Zu viele Anfragen beim Kursanbieter',
        SYMBOL_NOT_FOUND: 'Instrument beim Kursdienst nicht gefunden', QUOTE_INVALID: 'Kursantwort nicht verwertbar',
        INVALID_RESPONSE: 'Kursantwort nicht lesbar', INVALID_PRICE: 'Kurswert nicht verwertbar',
        CURRENCY_MISSING: 'Kurswährung fehlt', UNSUPPORTED_CURRENCY: 'Kurs nicht in Euro',
        AS_OF_MISSING: 'Kurszeitpunkt fehlt', INVALID_AS_OF: 'Kurszeitpunkt nicht verwertbar',
        QUOTE_FROM_FUTURE: 'Kurszeitpunkt liegt in der Zukunft', QUOTE_STALE: 'Gelieferter Kurs zu alt',
        SYMBOL_MISMATCH: 'Kursantwort gehört zu einem anderen Instrument'
    };
    return reasons[result.code || 'MISSING_IDENTIFIER'] || 'Kurs konnte nicht abgerufen werden';
}

function localQuoteTime(seconds) {
    if (!Number.isInteger(seconds) || seconds <= 0 || !Number.isFinite(new Date(seconds * 1000).getTime())) return 'Kursdatum unbekannt';
    return `Kurs vom ${new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(seconds * 1000))}`;
}

function retrievalTime(milliseconds) {
    if (!Number.isFinite(milliseconds)) return '';
    const date = new Date(milliseconds);
    if (!Number.isFinite(date.getTime())) return '';
    const today = appNow();
    const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    return new Intl.DateTimeFormat('de-DE', {
        ...(sameDay ? {} : { day: '2-digit', month: '2-digit', year: 'numeric' }), hour: '2-digit', minute: '2-digit'
    }).format(date).replace(/^/, sameDay ? 'heute ' : '');
}

export function renderStartupPriceStatus(host, report, { readSource = captureStartupPriceSource } = {}) {
    if (!host) return;
    report = restoreReportNames(report, readSource);
    const messages = {
        waiting: 'Kursabruf wartet auf Profil und Speicher.', running: 'Kurse werden abgerufen',
        cancelled: 'Kursabruf wegen Seiten- oder Profilwechsel verworfen. Bisherige Kurse bleiben erhalten.',
        unavailable: 'Sitzungsspeicher nicht verfügbar. Automatischer Kursabruf bleibt aus.',
        recovery: 'Kein Kursabruf: Profil oder Speicher benötigt Wiederherstellung.',
        changed: 'Bestand wurde zwischenzeitlich geändert. Keine Kurse gespeichert.',
        'storage-failed': 'Kurse konnten nicht dauerhaft gespeichert werden. Kein Erfolg bestätigt.',
        timeout: 'Zeitlimit von 15 Sekunden erreicht.', complete: 'Keine Kurse vorhanden.',
        offline: 'Keine Kurse vorhanden.'
    };
    const results = report.results || [];
    const failures = results.filter(result => result.status !== 'updated');
    const stored = ['complete', 'timeout', 'offline'].includes(report.status);
    let text = messages[report.status] || 'Kursabruf bereits in dieser Sitzung gestartet.';
    if (stored && results.length) {
        const updated = report.updated || 0;
        if (!failures.length && updated === results.length) text = `Kurse aktualisiert · ${updated} von ${results.length}`;
        else if (updated > 0) text = `${updated} von ${results.length} Kursen aktualisiert · ${failures.length} nicht aktualisiert`;
        else if (report.status === 'timeout') text = 'Zeitlimit von 15 Sekunden erreicht · es gelten die gespeicherten Kurse';
        else if (failures.every(result => result.code === 'PROXY_UNREACHABLE')) {
            text = 'Kursdienst nicht erreichbar · es gelten die gespeicherten Kurse';
        } else if (failures.every(result => ['REQUEST_TIMEOUT', 'PROVIDER_TIMEOUT'].includes(result.code))) {
            text = 'Kursantwort nicht rechtzeitig erhalten · es gelten die gespeicherten Kurse';
        } else if (failures.every(result => result.code === 'PROVIDER_UNAVAILABLE')) {
            text = 'Kursanbieter vorübergehend nicht verfügbar · es gelten die gespeicherten Kurse';
        } else if (failures.every(result => result.code === 'PROVIDER_RATE_LIMITED')) {
            text = 'Zu viele Anfragen beim Kursanbieter · es gelten die gespeicherten Kurse';
        } else text = 'Keine Kurse aktualisiert · es gelten die gespeicherten Kurse';
    }
    if (report.status === 'timeout' && report.updated > 0) text += ' · Zeitlimit von 15 Sekunden erreicht';
    if (report.status === 'running') text += ` (${report.completed || 0} von ${report.total || 0}).`;
    if (report.status === 'storage-failed' && report.restored === false) text += ' Rückschreiben nicht bestätigt; Speicherwiederherstellung erforderlich.';
    const time = retrievalTime(report.retrievedAt);
    if (stored && results.length && time) text += ` · ${time}`;
    host.replaceChildren();
    const doc = host.ownerDocument;
    const summary = doc.createElement('p'); summary.textContent = text; host.appendChild(summary);
    if (failures.length) {
        const list = doc.createElement('ul');
        for (const result of failures) {
            const row = doc.createElement('li');
            const profileName = displayName(result.profileName) || 'Unbenannte Person';
            const trancheName = displayName(result.trancheName) || (result.trancheId ? 'Unbenannte Tranche' : 'Bestand');
            row.textContent = `${profileName} / ${trancheName}: ${quoteIssueReason(result)} – bisherigen Kurs beibehalten · ${localQuoteTime(result.storedAsOf)} `;
            const link = doc.createElement('a'); link.textContent = 'Im Manager prüfen';
            link.href = 'depot-tranchen-manager.html'; link.className = 'startup-price-manager-link';
            link.setAttribute?.('data-profile-handoff', '');
            row.appendChild(link); list.appendChild(row);
        }
        host.appendChild(list);
    }
    // Zusätzliche Diagnose im bestehenden Kursdetailhost; normale Fehlerliste bleibt unverändert.
    if (results.length) {
        const details = doc.createElement('details');
        details.className = 'startup-price-technical';
        const label = doc.createElement('summary'); label.textContent = 'Technik · letzte Anfragedauer'; details.appendChild(label);
        for (const result of results) {
            const row = doc.createElement('div');
            const duration = Number.isFinite(result.requestDurationMs) && result.requestDurationMs >= 0
                ? `${Math.round(result.requestDurationMs)} ms` : 'unbekannt';
            row.textContent = `${displayName(result.profileName) || 'Unbenannte Person'} / ${displayName(result.trancheName) || 'Unbenannte Tranche'}: letzte Anfragedauer ${duration}`;
            details.appendChild(row);
        }
        host.appendChild(details);
    }
}

/** Nur index.html. Bootstrap wird geteilt; Unterseiten starten keinen Sitzungsabruf. */
export function bindStartupPrices({ doc = globalThis.document, win = globalThis.window,
    initialize = () => initializeProfilePage({ doc, win, kind: 'index' }),
    ready = () => whenProfileDisplayReady(doc), guard = getPageNavigationGuard(doc, win),
    session, coordinator = runStartupPriceRefresh, source = captureStartupPriceSource, onReport } = {}) {
    if (bindings.has(doc)) return bindings.get(doc);
    const host = doc.getElementById('startupPriceStatus');
    const render = report => {
        renderStartupPriceStatus(host, report, { readSource: source });
        try { onReport?.(report); } catch (error) { console.error('Kursanzeige fehlgeschlagen:', error); }
    };
    let valid = true, documentValid = true, operation = null;
    const lifecycle = createNavigationOperationLifecycle({ guard, message: 'Kurse werden dauerhaft gespeichert – bitte warten.' });
    const disabledControls = new Map();
    const unwatch = guard.subscribe(() => {
        const committing = operation?.phase === 'commit';
        for (const id of ['profileSelect', 'profileCreateBtn', 'profileRenameBtn', 'profileDeleteBtn']) {
            const control = doc.getElementById(id);
            if (!control) continue;
            if (committing && !disabledControls.has(control)) {
                disabledControls.set(control, control.disabled); control.disabled = true;
            } else if (!committing && disabledControls.has(control)) {
                control.disabled = disabledControls.get(control); disabledControls.delete(control);
            }
        }
    });
    const cancel = () => {
        valid = false;
        if (operation?.phase !== 'commit') operation?.controller.abort();
    };
    const leaveDocument = () => { documentValid = false; cancel(); };
    win?.addEventListener?.('pagehide', leaveDocument);
    win?.addEventListener?.('unload', leaveDocument);
    // Startseitenverwaltung hat eigene Writebesitzer. Vor deren Handler endet
    // der abbrechbare Abruf; während Commit darf kein Profilwechsel beginnen.
    const management = event => {
        const link = event.type === 'click' && event.target?.closest?.('a[href]');
        const navigation = link && shouldHandleAppNavigation(link, win)
            && !(event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey);
        const target = navigation ? link : event.target?.closest?.('#profileSelect, #profileCreateBtn, #profileRenameBtn, #profileDeleteBtn');
        if (!target || !operation || (event.type === 'click' && target.id === 'profileSelect')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (operation.phase === 'commit') return;
        cancel();
        task.finally(() => {
            if (!documentValid || target.isConnected === false) return;
            if (event.type === 'click') target.click();
            else target.dispatchEvent(new (win.Event || Event)(event.type, { bubbles: true, cancelable: true }));
        });
    };
    doc.addEventListener('change', management, true);
    doc.addEventListener('click', management, true);
    render({ status: 'waiting' });
    const task = (async () => {
        try {
            if (!await initialize() || !await ready()) { render({ status: 'recovery' }); return; }
            if (!valid) return;
            try { session ||= areaSessionStorage(win.sessionStorage); } catch { render({ status: 'unavailable' }); return; }
            if (!session) { render({ status: 'unavailable' }); return; }
            if (sessionRuns.has(session)) { render(sessionRuns.get(session)); return; }
            let prior;
            try {
                prior = session.getItem(STARTUP_PRICE_SESSION_KEY);
                if (prior) { render(JSON.parse(prior)); return; }
                session.setItem(STARTUP_PRICE_SESSION_KEY, JSON.stringify({ status: 'started' }));
            } catch { render({ status: 'unavailable' }); return; }
            sessionRuns.set(session, { status: 'started' });
            const report = await lifecycle.run({}, async owner => {
                operation = owner;
                try { return await coordinator({ source: source(), operation: owner, valid: () => valid && !guard.isBusy(),
                    progress: render }); }
                finally { operation = null; }
            });
            const saved = sessionReport(report);
            const visible = { ...saved, results: saved.results.map((result, index) => ({ ...result,
                requestDurationMs: report.results[index]?.requestDurationMs })) };
            sessionRuns.set(session, visible);
            try { session.setItem(STARTUP_PRICE_SESSION_KEY, JSON.stringify(saved)); } catch { /* In-Memory-Sperre bleibt. */ }
            if (documentValid) render(visible);
        } catch { if (documentValid) render({ status: 'recovery' }); }
        finally { unwatch(); }
    })();
    bindings.set(doc, task);
    return task;
}
