import { formatCurrency } from '../shared/shared-formatting.js';
import { computeSpent } from './balance-expenses-metrics.js';
import { parseCategoryCsv } from './balance-expenses-csv.js';
import { loadExpensesStore, saveExpensesStore, getExpensesYearData, getExpensesMonthData, EXPENSES_STORAGE_KEY } from './balance-expenses-storage.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { appNow } from '../shared/app-clock.js';
import { getProbelaufController, PROBELAUF_STATE_KEY } from '../shared/probelauf-state.js';
import { assertExampleExpensesAllowed, EXAMPLE_SOURCE } from '../demo/beispielausgaben.js';

export const EXPENSES_WAIT_MS = 10000;
export function expensesImportHint(code, message) { return Object.assign(new Error(message), { code }); }
export const isExpensesImportHint = error => ['EXPENSES_CONTEXT', 'EXPENSES_ABORTED', 'EXPENSES_BUSY', 'EXPENSES_NOT_ALLOWED', 'PROBELAUF_COMMIT_BUSY', 'PROBELAUF_OTHER_PAGE'].includes(error?.code);
let importTail = Promise.resolve(), pendingImports = 0;
/** Eine Warteschlange für beide Oberflächen und Quellen, ein Parser und ein Saver. */
export function importExpenses({ targets, confirm, storage = persistenceStorage, flush = null,
    controller = getProbelaufController(globalThis.document), guard = null, isCurrent = () => true, signal,
    now = appNow, onSuccess = null, onFollowupError = null, onProgress = () => {},
    clock = Date.now, wait = null, timeoutMs = EXPENSES_WAIT_MS,
    win = globalThis.window }) {
    targets = targets.map(target => ({ ...target }));
    const session = controller?.state ? JSON.stringify(controller.state) : null;
    const date = appNow().toDateString();
    const examples = targets.some(target => target.source === EXAMPLE_SOURCE);
    const requestAbort = new AbortController();
    const abortExternal = () => requestAbort.abort(expensesImportHint('EXPENSES_ABORTED', 'Import abgebrochen. Bitte erneut starten.'));
    signal?.addEventListener('abort', abortExternal, { once: true });
    win?.addEventListener?.('pagehide', abortExternal);
    if (signal?.aborted) abortExternal();
    const pause = wait || (ms => new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(requestAbort.signal.reason); };
        const timer = setTimeout(() => { requestAbort.signal.removeEventListener('abort', abort); resolve(); }, ms);
        requestAbort.signal.addEventListener('abort', abort, { once: true });
        if (requestAbort.signal.aborted) abort();
    }));
    const owner = Symbol('expenses-import');
    const queued = pendingImports++ > 0, queueDeadline = queued ? clock() + timeoutMs : null;
    let phase = 'running', finish, monitor, queueTimer, started = false, ended = false;
    const finished = new Promise(resolve => { finish = resolve; });
    const lease = guard?.register(owner, {
        read: () => ({ phase, message: 'Ausgabenimport läuft.' }),
        cancel: async () => { if (phase === 'commit') return false; abortExternal(); await finished; return true; }
    });
    const cleanup = () => {
        if (ended) return;
        ended = true; pendingImports--;
        clearTimeout(monitor); clearTimeout(queueTimer);
        requestAbort.signal.removeEventListener('abort', cancelQueued);
        requestAbort.abort();
        signal?.removeEventListener('abort', abortExternal); win?.removeEventListener?.('pagehide', abortExternal);
        phase = 'idle'; lease?.notify(); lease?.unregister(); finish();
    };
    let rejectQueued;
    const cancelledQueued = new Promise((resolve, reject) => { rejectQueued = reject; });
    const cancelQueued = () => { if (!started) { rejectQueued(requestAbort.signal.reason); cleanup(); } };
    requestAbort.signal.addEventListener('abort', cancelQueued);
    if (queued) {
        queueTimer = setTimeout(() => {
            if (!started) requestAbort.abort(expensesImportHint('EXPENSES_BUSY', 'Gerade wird noch gespeichert. Bitte in ein paar Sekunden erneut versuchen.'));
        }, timeoutMs);
        try { onProgress('Speichert noch …'); } catch (error) { requestAbort.abort(error); }
    }
    const check = () => {
        if (requestAbort.signal.aborted) throw requestAbort.signal.reason;
        if (!isCurrent() || appNow().toDateString() !== date
            || (controller?.state ? JSON.stringify(controller.state) : null) !== session || controller?.blocked) {
            throw expensesImportHint('EXPENSES_CONTEXT', 'Import abgebrochen: Der Kontext (Profil, Haushalt oder Testdatum) hat sich geändert. Bitte erneut starten.');
        }
    };
    const occupied = () => controller?.busy || guard?.isBusy()
        || guard?.reasons().some(reason => reason.phase === 'commit' && reason.owner !== owner);
    const bound = async action => {
        check();
        let abort;
        const cancelled = new Promise((resolve, reject) => {
            abort = () => reject(requestAbort.signal.reason);
            requestAbort.signal.addEventListener('abort', abort, { once: true });
        });
        try { const value = await Promise.race([Promise.resolve().then(() => { check(); return action(); }), cancelled]); check(); return value; }
        finally { requestAbort.signal.removeEventListener('abort', abort); }
    };
    const checkPersisted = async () => {
        check();
        if (controller) {
            const persisted = await PersistenceFacade.readPersistedRecords(key => key === PROBELAUF_STATE_KEY);
            if ((persisted[PROBELAUF_STATE_KEY] ?? null) !== session) throw expensesImportHint('EXPENSES_CONTEXT', 'Import abgebrochen: Probelauf geändert. Bitte neu laden.');
        }
        check();
    };
    const ready = async (deadline = clock() + timeoutMs) => {
        await bound(checkPersisted);
        while (occupied()) {
            if (clock() >= deadline) throw expensesImportHint('EXPENSES_BUSY', 'Gerade wird noch gespeichert. Bitte in ein paar Sekunden erneut versuchen.');
            onProgress('Speichert noch …');
            await bound(() => pause(Math.min(50, deadline - clock())));
            if (clock() >= deadline) throw expensesImportHint('EXPENSES_BUSY', 'Gerade wird noch gespeichert. Bitte in ein paar Sekunden erneut versuchen.');
            await bound(checkPersisted);
        }
        return deadline;
    };
    const operation = async (execute, deadline) => {
        const occupiedDuringAcquire = Symbol('occupied');
        for (;;) {
            await ready(deadline);
            const result = await PersistenceFacade.withProbelaufOperation(async ownedFlush => {
                await checkPersisted();
                if (occupied()) return occupiedDuringAcquire;
                return execute(ownedFlush);
            }, win, { check, signal: requestAbort.signal, onWait: onProgress, clock, wait: pause, timeoutMs: Math.max(0, deadline - clock()) });
            if (result !== occupiedDuringAcquire) return result;
            // Ein neuer Startwriter zwischen Freigabe und Lockversuch gehört
            // weiterhin zur selben Warteepisode, nicht zu einem Kontextwechsel.
        }
    };
    const allowed = () => { if (examples) { try { assertExampleExpensesAllowed(controller); }
        catch (error) { throw expensesImportHint('EXPENSES_NOT_ALLOWED', error.message); } } };
    const watch = async () => {
        try { await checkPersisted(); }
        catch (error) { requestAbort.abort(error); return; }
        if (!requestAbort.signal.aborted) monitor = setTimeout(watch, 50);
    };
    const run = async () => {
        started = true; clearTimeout(queueTimer);
        try {
            check();
            if (queueDeadline !== null && clock() >= queueDeadline) throw expensesImportHint('EXPENSES_BUSY', 'Gerade wird noch gespeichert. Bitte in ein paar Sekunden erneut versuchen.');
            monitor = setTimeout(watch, 50);
            const deadline = await ready(queueDeadline ?? clock() + timeoutMs);
            await bound(() => operation(() => { check(); }, deadline));
            allowed(); onProgress('');
            const initial = loadExpensesStore(storage), prepared = [], seen = new Set();
            for (const target of targets) {
                const { year, month, profileId } = target;
                const key = JSON.stringify([year, month, profileId]);
                if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12
                    || typeof profileId !== 'string' || !profileId || seen.has(key)) throw new Error('Ungültiges oder doppeltes Importziel.');
                seen.add(key);
                const text = await bound(() => target.text());
                await bound(checkPersisted);
                const categories = parseCategoryCsv(text);
                prepared.push({ ...target, categories, total: computeSpent(categories).spent,
                    replacing: Boolean(initial.years?.[year]?.months?.[month]?.profiles?.[profileId]) });
            }
            if (!prepared.length) throw new Error('Keine Importziele vorhanden.');
            const accepted = await bound(() => confirm(prepared, { signal: requestAbort.signal }));
            await bound(checkPersisted);
            if (!accepted) return { status: 'cancelled', results: [] };
            const results = [];
            for (const target of prepared) {
                try {
                    // Keine eigene Commitlease während fremder Arbeit oder Lockwartens.
                    phase = 'running'; lease?.notify();
                    const deadline = await ready();
                    const result = await operation(async ownedFlush => {
                        check(); allowed();
                        const previous = loadExpensesStore(storage), store = structuredClone(previous);
                        const monthData = getExpensesMonthData(getExpensesYearData(store, target.year), target.month);
                        monthData.profiles[target.profileId] = { categories: target.categories, updatedAt: now().toISOString(),
                            ...(target.source === EXAMPLE_SOURCE ? { source: EXAMPLE_SOURCE } : {}) };
                        let candidate;
                        const saveFlush = () => flush ? flush(ownedFlush) : ownedFlush();
                        phase = 'commit'; lease?.notify(); onProgress('');
                        try {
                            check(); saveExpensesStore(store, storage); candidate = storage.getItem(EXPENSES_STORAGE_KEY);
                            if (await saveFlush() === false) throw new Error('Ausgaben konnten nicht dauerhaft bestätigt werden.');
                            return { profileId: target.profileId, ok: true };
                        } catch (error) {
                            // Nur den eigenen unbestätigten Kandidaten zurücknehmen.
                            try { check(); if (candidate && storage.getItem(EXPENSES_STORAGE_KEY) === candidate) { saveExpensesStore(previous, storage); await saveFlush(); } } catch { /* Fremde Writes bleiben erhalten. */ }
                            return { profileId: target.profileId, ok: false, error };
                        } finally { phase = 'running'; lease?.notify(); }
                    }, deadline);
                    results.push(result);
                    if (result.ok) {
                        phase = 'idle'; lease?.notify();
                        try { await onSuccess?.(target); } catch (error) { try { onFollowupError?.(error); } catch { /* Folgefehler ändert den bestätigten Import nicht. */ } }
                    }
                } catch (error) {
                    if (!results.length) throw error;
                    for (const remaining of prepared.slice(results.length)) results.push({ profileId: remaining.profileId, ok: false, error });
                    break;
                }
            }
            return { status: results.every(result => result.ok) ? 'saved' : 'partial', results };
        } finally { cleanup(); }
    };
    const job = importTail.then(run, run);
    importTail = job.catch(() => {});
    if (requestAbort.signal.aborted) cancelQueued();
    return Promise.race([job, cancelledQueued]);
}

/** Gemeinsame Vorschau für Datei-, Einzel- und Sammelimport. textContent schützt CSV-Inhalte. */
export function requestExpensesPreview(targets, { doc = globalThis.document, signal, opener = doc?.activeElement } = {}) {
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
        const dialog = doc.createElement('dialog'); dialog.id = 'expensesImportPreview'; dialog.className = 'page-choice-dialog ds-plan-card';
        dialog.setAttribute('aria-labelledby', 'expensesImportPreviewTitle');
        const title = doc.createElement('h2'); title.id = 'expensesImportPreviewTitle'; title.textContent = 'Ausgabenimport prüfen'; dialog.appendChild(title);
        for (const target of targets) {
            const section = doc.createElement('section'); section.dataset.expensesPreviewTarget = '';
            const heading = doc.createElement('h3'); heading.dataset.expensesPreviewPerson = ''; heading.textContent = `${target.name || target.profileId} · ${target.month}/${target.year}`; section.appendChild(heading);
            const origin = doc.createElement('p'); origin.dataset.expensesPreviewOrigin = ''; origin.textContent = (target.source === EXAMPLE_SOURCE ? 'Beispieldaten (Probelauf)' : 'CSV-Datei')
                + (target.replacing ? ' · Vorhandene Monatsdaten werden ersetzt.' : ' · Neuer Monatsimport.'); section.appendChild(origin);
            for (const [name, value] of Object.entries(target.categories)) { const row = doc.createElement('p'); row.dataset.expensesPreviewCategory = ''; row.textContent = `${name}: ${formatCurrency(Math.abs(value))}`; section.appendChild(row); }
            const sum = doc.createElement('p'); sum.dataset.expensesPreviewSum = ''; sum.textContent = `Summe: ${formatCurrency(target.total)}`; section.appendChild(sum); dialog.appendChild(section);
        }
        const total = doc.createElement('p'); total.dataset.expensesPreviewTotal = ''; total.textContent = `Gesamt: ${formatCurrency(targets.reduce((sum, target) => sum + target.total, 0))}`; dialog.appendChild(total);
        const accept = doc.createElement('button'); accept.type = 'button'; accept.dataset.expensesPreviewAccept = ''; accept.textContent = 'Import bestätigen'; accept.className = 'ds-button ds-button-primary';
        const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.dataset.expensesPreviewCancel = ''; cancel.textContent = 'Abbrechen'; cancel.className = 'ds-button ds-button-secondary';
        let done = false;
        const end = value => { if (done) return; done = true; signal?.removeEventListener('abort', abort); dialog.close(); dialog.remove(); opener?.focus?.(); resolve(value); };
        const abort = () => end(false);
        accept.addEventListener('click', () => end(true)); cancel.addEventListener('click', abort);
        dialog.addEventListener('cancel', event => { event.preventDefault(); end(false); }); dialog.addEventListener('close', abort);
        signal?.addEventListener('abort', abort, { once: true });
        dialog.append(accept, cancel); doc.body.appendChild(dialog);
        try { dialog.showModal(); cancel.focus(); } catch { end(false); }
    });
}
