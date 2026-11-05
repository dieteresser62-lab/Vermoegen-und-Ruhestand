import { formatCurrency } from '../shared/shared-formatting.js';
import { computeSpent } from './balance-expenses-metrics.js';
import { parseCategoryCsv, EXPENSE_CSV_CATEGORY_NEEDS } from './balance-expenses-csv.js';
import { loadExpensesStore, saveExpensesStore, getExpensesYearData, getExpensesMonthData, EXPENSES_STORAGE_KEY } from './balance-expenses-storage.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { appNow } from '../shared/app-clock.js';
import { getProbelaufController, PROBELAUF_STATE_KEY } from '../shared/probelauf-state.js';
import { assertExampleExpensesAllowed, EXAMPLE_SOURCE } from '../demo/beispielausgaben.js';
import { readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { PLANNED_EXPENSES_KEY } from '../profile/household-planned-expenses.js';
import { plannedExpenseImportChoices, selectedExpensePayments, expensePaymentKey } from './balance-planned-posts.js';

export const EXPENSES_WAIT_MS = 10000;
/**
 * @param code Eingabe für die bestehende Projektion.
 * @param message Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function expensesImportHint(code, message) { return Object.assign(new Error(message), { code }); }
/** @param {{code?: string}} error @returns {boolean} */
export const isExpensesImportHint = error => ['EXPENSES_CONTEXT', 'EXPENSES_ABORTED', 'EXPENSES_BUSY', 'EXPENSES_NOT_ALLOWED', 'PROBELAUF_COMMIT_BUSY', 'PROBELAUF_OTHER_PAGE'].includes(error?.code);
/** @type {Promise<unknown>} */
let importTail = Promise.resolve(), pendingImports = 0;
/** Eine Warteschlange für beide Oberflächen und Quellen, ein Parser und ein Saver. */
/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function importExpenses({ targets, confirm, storage = persistenceStorage, flush = null,
    controller = getProbelaufController(globalThis.document), guard = null, isCurrent = () => true, signal,
    now = appNow, onSuccess = null, onFollowupError = null, onProgress = /** @type {(text: string)=>void} */ (() => {}),
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
            if ((persisted[PROBELAUF_STATE_KEY] ?? null) !== session) throw expensesImportHint('EXPENSES_CONTEXT', 'Import abgebrochen: Spielbereich geändert. Bitte neu laden.');
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
            const planSource = storage.getItem(PLANNED_EXPENSES_KEY);
            const scope = readBalanceHouseholdPlan({ storage }).scope;
            for (const target of targets) {
                const { year, month, profileId } = target;
                const key = JSON.stringify([year, month, profileId]);
                if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12
                    || typeof profileId !== 'string' || !profileId || seen.has(key)) throw new Error('Ungültiges oder doppeltes Importziel.');
                seen.add(key);
                const text = await bound(() => target.text());
                await bound(checkPersisted);
                const categories = parseCategoryCsv(text);
                prepared.push({ ...target, categories, categoryNeeds: categories[EXPENSE_CSV_CATEGORY_NEEDS], total: computeSpent(categories).spent,
                    plannedExpenseChoices: plannedExpenseImportChoices({ storage, scope, year, month, profileId, store: initial }),
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
                        const previousRaw = storage.getItem(EXPENSES_STORAGE_KEY);
                        const previous = loadExpensesStore(storage), store = structuredClone(previous);
                        if (storage.getItem(PLANNED_EXPENSES_KEY) !== planSource || readBalanceHouseholdPlan({ storage }).scope?.key !== scope?.key)
                            throw expensesImportHint('EXPENSES_CONTEXT', 'Der Ausgabenplan wurde geändert. Bitte den Import erneut prüfen.');
                        const payments = selectedExpensePayments(target);
                        const available = plannedExpenseImportChoices({ storage, scope, year: target.year, month: target.month, profileId: target.profileId, store: previous });
                        const keys = payments.map(expensePaymentKey);
                        if (new Set(keys).size !== keys.length || payments.some(item => !available.some(choice => expensePaymentKey(choice) === expensePaymentKey(item))))
                            throw new Error('Diese geplante Ausgabe wurde bereits einem anderen Import zugeordnet. Bitte erneut prüfen.');
                        const monthData = getExpensesMonthData(getExpensesYearData(store, target.year), target.month);
                        monthData.profiles[target.profileId] = { categories: target.categories, updatedAt: now().toISOString(),
                            ...(target.categoryNeeds ? { categoryNeeds: target.categoryNeeds } : {}),
                            ...(payments.length ? { plannedExpenses: payments } : {}),
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
                            try {
                                check();
                                if (candidate && storage.getItem(EXPENSES_STORAGE_KEY) === candidate) {
                                    if (previousRaw == null) storage.removeItem(EXPENSES_STORAGE_KEY);
                                    else storage.setItem(EXPENSES_STORAGE_KEY, previousRaw);
                                    if (await saveFlush() === false) throw new Error('Die Rücknahme konnte nicht dauerhaft bestätigt werden.');
                                }
                            } catch (rollbackError) { error.rollbackError = rollbackError; }
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
/**
 * @param targets Eingabe für die bestehende Projektion.
 * @param options2 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param targets Vorbereitete Importziele. @param {{doc?: Document, signal?: AbortSignal, opener?: HTMLElement}} [options] @returns {Promise<boolean>} */
export function requestExpensesPreview(targets, { doc = globalThis.document, signal, opener = /** @type {HTMLElement} */ (doc?.activeElement) } = {}) {
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
        const dialog = doc.createElement('dialog'); dialog.id = 'expensesImportPreview'; dialog.className = 'page-choice-dialog ds-plan-card';
        dialog.setAttribute('aria-labelledby', 'expensesImportPreviewTitle');
        const title = doc.createElement('h2'); title.id = 'expensesImportPreviewTitle'; title.textContent = 'Ausgabenimport prüfen'; dialog.appendChild(title);
        const checks = [];
        for (const target of targets) {
            const section = doc.createElement('section'); section.dataset.expensesPreviewTarget = '';
            const heading = doc.createElement('h3'); heading.dataset.expensesPreviewPerson = ''; heading.textContent = `${target.name || target.profileId} · ${target.month}/${target.year}`; section.appendChild(heading);
            const origin = doc.createElement('p'); origin.dataset.expensesPreviewOrigin = ''; origin.textContent = (target.source === EXAMPLE_SOURCE ? 'Beispieldaten (Spielbereich)' : 'CSV-Datei')
                + (target.replacing ? ' · Vorhandene Monatsdaten werden ersetzt.' : ' · Neuer Monatsimport.'); section.appendChild(origin);
            const needsHint = doc.createElement('p'); needsHint.className = 'ds-help';
            needsHint.textContent = target.categoryNeeds ? 'Spalte ‚Bedarf‘ erkannt. Floor und Flex werden je Kategorie getrennt gespeichert.' : 'ohne Aufteilung – zählt nur im Gesamt';
            section.appendChild(needsHint);
            if (target.categoryNeeds) {
                const scroll = doc.createElement('div'); scroll.className = 'ds-table-scroll';
                const table = doc.createElement('table'); table.className = 'ds-table';
                const head = doc.createElement('thead'), header = doc.createElement('tr');
                for (const label of ['Kategorie', 'Floor', 'Flex', 'Summe']) {
                    const cell = doc.createElement('th'); cell.textContent = label; cell.scope = 'col'; header.appendChild(cell);
                }
                head.appendChild(header); table.appendChild(head);
                const body = doc.createElement('tbody');
                const direction = computeSpent(target.categories).sum < 0 ? -1 : 1;
                let floor = 0, flex = 0;
                const appendRow = (parent, name, values, total = false) => {
                    const row = doc.createElement('tr'); row.dataset[total ? 'expensesPreviewSum' : 'expensesPreviewCategory'] = '';
                    const label = doc.createElement('th'); label.scope = 'row'; label.textContent = name; row.appendChild(label);
                    values.forEach((value, index) => { const cell = doc.createElement('td'); cell.className = 'num'; cell.textContent = index < 2 && value === 0 ? '—' : formatCurrency(value); row.appendChild(cell); });
                    parent.appendChild(row);
                };
                for (const [name, value] of Object.entries(target.categories)) {
                    const pair = target.categoryNeeds[name]; floor += direction * pair.floor; flex += direction * pair.flex;
                    appendRow(body, name, [direction * pair.floor, direction * pair.flex, direction * value]);
                }
                table.appendChild(body);
                const foot = doc.createElement('tfoot'); appendRow(foot, 'Summe', [floor, flex, target.total], true); table.appendChild(foot);
                scroll.appendChild(table); section.appendChild(scroll);
            } else {
                for (const [name, value] of Object.entries(target.categories)) { const row = doc.createElement('p'); row.dataset.expensesPreviewCategory = ''; row.textContent = `${name}: ${formatCurrency(Math.abs(value))}`; section.appendChild(row); }
                const sum = doc.createElement('p'); sum.dataset.expensesPreviewSum = ''; sum.textContent = `Summe: ${formatCurrency(target.total)}`; section.appendChild(sum);
            }
            dialog.appendChild(section);
            if (target.plannedExpenseChoices?.length) {
                const caption = doc.createElement('h4'); caption.textContent = 'Geplante Ausgaben zuordnen'; section.appendChild(caption);
                const hint = doc.createElement('p'); hint.className = 'ds-help'; hint.textContent = 'Welche geplanten Ausgaben sind vollständig bezahlt und in diesem Import enthalten? Prüfe den bezahlten Betrag; Dezimalstellen mit Komma. Bestätigte Zahlungen zählen außerhalb des Monatsbudgets.'; section.appendChild(hint);
                for (const choice of target.plannedExpenseChoices) {
                    const row = doc.createElement('div'); row.className = 'expenses-planned-assignment';
                    const check = doc.createElement('input'); check.type = 'checkbox'; check.className = 'ds-checkbox'; check.checked = choice.selected;
                    check.id = `planned-payment-${checks.length}`;
                    const label = doc.createElement('label'); label.htmlFor = check.id; label.textContent = `${choice.label || 'Geplante Ausgabe'} · ${choice.month.slice(5)}.${choice.month.slice(0, 4)}`;
                    const amount = doc.createElement('input'); amount.type = 'text'; amount.className = 'ds-input'; amount.setAttribute('inputmode', 'decimal');
                    const display = value => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 20 }).format(value);
                    const read = () => {
                        // Eindeutiger deutscher Dezimalvertrag auch bei drei Nachkommastellen.
                        const text = amount.value.trim();
                        return /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(text)
                            ? Number(text.replaceAll('.', '').replace(',', '.')) : NaN;
                    };
                    amount.value = display(choice.amount);
                    amount.addEventListener('focus', () => { const value = read(); if (Number.isFinite(value)) amount.value = String(value).replace('.', ','); amount.select?.(); });
                    amount.addEventListener('blur', () => { const value = read(); if (Number.isFinite(value)) amount.value = display(value); });
                    const frame = doc.createElement('div'); frame.className = 'ds-unit-frame';
                    const euro = doc.createElement('span'); euro.textContent = '€'; frame.append(amount, euro);
                    amount.setAttribute('aria-label', `Bezahlter Betrag ${choice.label || 'Geplante Ausgabe'} in Euro`);
                    checks.push({ choice, check, amount, read }); row.append(check, label, frame); section.appendChild(row);
                }
            }
        }
        const total = doc.createElement('p'); total.dataset.expensesPreviewTotal = ''; total.textContent = `Gesamt: ${formatCurrency(targets.reduce((sum, target) => sum + target.total, 0))}`; dialog.appendChild(total);
        const accept = doc.createElement('button'); accept.type = 'button'; accept.dataset.expensesPreviewAccept = ''; accept.textContent = 'Import bestätigen'; accept.className = 'ds-button ds-button-primary';
        const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.dataset.expensesPreviewCancel = ''; cancel.textContent = 'Abbrechen'; cancel.className = 'ds-button ds-button-secondary';
        let done = false;
        const end = value => { if (done) return; done = true; signal?.removeEventListener('abort', abort); dialog.close(); dialog.remove(); opener?.focus?.(); resolve(value); };
        const abort = () => end(false);
        const error = doc.createElement('p'); error.setAttribute('role', 'alert'); dialog.appendChild(error);
        accept.addEventListener('click', () => {
            try {
                for (const { choice, check, read } of checks) { choice.selected = check.checked; choice.amount = read(); }
                targets.forEach(selectedExpensePayments); end(true);
            } catch (failure) { error.textContent = failure.message; }
        }); cancel.addEventListener('click', abort);
        dialog.addEventListener('cancel', event => { event.preventDefault(); end(false); }); dialog.addEventListener('close', abort);
        signal?.addEventListener('abort', abort, { once: true });
        dialog.append(accept, cancel); doc.body.appendChild(dialog);
        try { dialog.showModal(); cancel.focus(); } catch { end(false); }
    });
}
