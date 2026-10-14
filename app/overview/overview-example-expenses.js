import { closeImportProgress } from '../shared/close-dialog.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { canGenerateExampleExpenses, assertExampleExpensesAllowed, generateExampleExpensesCsv, resolveExampleExpensesBasis, EXAMPLE_SOURCE } from '../demo/beispielausgaben.js';
import { importExpenses, requestExpensesPreview } from '../balance/balance-expenses-import.js';
import { createBalanceWealthHistoryPreview } from '../balance/balance-wealth-history-preview.js';

/** Kompatible Anbindung der Import-Nacherfassung an die gemeinsame Vorschau. */
export function createOverviewExpensesWealthCapture(options = {}) {
    return createBalanceWealthHistoryPreview(options);
}

export function requestExampleExpensePerson({ doc, people, signal }) {
    if (signal.aborted) return Promise.resolve(null);
    return new Promise(resolve => {
        const dialog = doc.createElement('dialog'); dialog.id = 'overviewExamplePerson'; dialog.className = 'page-choice-dialog ds-plan-card';
        dialog.setAttribute('aria-labelledby', 'overviewExamplePersonTitle');
        const title = doc.createElement('h2'); title.id = 'overviewExamplePersonTitle'; title.textContent = 'Person für Beispielausgaben wählen'; dialog.appendChild(title);
        let finished = false;
        const done = id => { if (finished) return; finished = true; signal.removeEventListener('abort', abort); dialog.close(); dialog.remove(); resolve(id); };
        const abort = () => done(null);
        for (const person of people) {
            const button = doc.createElement('button'); button.type = 'button'; button.dataset.overviewExamplePerson = person.id;
            button.className = 'ds-button ds-button-secondary'; button.textContent = person.name || person.id;
            button.addEventListener('click', () => done(person.id)); dialog.appendChild(button);
        }
        const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.dataset.overviewExampleCancel = '';
        cancel.className = 'ds-button ds-button-secondary'; cancel.textContent = 'Abbrechen'; cancel.addEventListener('click', abort); dialog.appendChild(cancel);
        dialog.addEventListener('cancel', event => { event.preventDefault(); abort(); }); dialog.addEventListener('close', abort);
        signal.addEventListener('abort', abort, { once: true }); doc.body.appendChild(dialog);
        try { dialog.showModal(); cancel.focus(); } catch { abort(); }
    });
}

/** Dialogwurzel und Startseitenkarte teilen denselben Importbesitzer. */
const boundImports = new WeakMap();
export function bindOverviewExampleExpenses({ doc, win, getModel, refresh,
    controller = getProbelaufController(doc), choose = requestExampleExpensePerson,
    importOptions = {}, wealthCapture = null,
    confirm = (targets, context) => requestExpensesPreview(targets, { doc, ...context }) }) {
    if (boundImports.has(doc)) return boundImports.get(doc);
    const guard = getPageNavigationGuard(doc, win);
    let pending = false, abort = null, request = null, message = '', wealthMessage = '', job = Promise.resolve();
    const roots = new Map();
    const key = model => JSON.stringify([model?.activeId, model?.scope?.key, model?.expenses?.year, model?.expenses?.month, model?.now?.toDateString()]);
    const allowed = model => !model?.recovery && model?.scope?.ids?.length && !model.expenses?.beforePlanning
        && ['monthly', 'annual'].includes(model.occasion?.kind) && !['unavailable', 'recovery', 'unclear'].includes(model.occasion?.annualState);
    const examples = model => allowed(model) && canGenerateExampleExpenses(controller, { allowBusy: true });
    const controls = {
        projectModel(model) {
            if (abort && (key(model) !== request || !allowed(model))) abort.abort();
            return { ...model, exampleExpensesAllowed: Boolean(examples(model)) };
        },
        syncButtons() {
            doc.querySelectorAll('[data-overview-example], [data-overview-expenses-file], [data-overview-expenses-choose]').forEach(button => {
                button.disabled = pending || button.closest?.('[data-close-dialog-host]')?.getAttribute?.('aria-busy') === 'true';
            });
            for (const { dialog } of roots.values()) {
                dialog?.setImportActive(pending); dialog?.syncReady();
            }
            const node = doc.getElementById('overviewExampleExpensesStatus');
            if (node) {
                const progress = closeImportProgress(getModel());
                node.textContent = [message, message.includes('importiert.') ? progress.notice : ''].filter(Boolean).join(' ');
                node.setAttribute('role', 'status');
            }
            const wealth = doc.getElementById('overviewExpensesWealthStatus'); if (wealth) wealth.textContent = wealthMessage;
        },
        reportWealth(text) { wealthMessage = text; controls.syncButtons(); },
        get pending() { return pending; },
        wait: () => job,
        abort: () => abort?.abort(),
        bindRoot(root, signal, dialog) {
            if (!root || roots.has(root)) return;
            const click = event => {
                const choose = event.target.closest?.('[data-overview-expenses-choose]');
                if (choose) {
                    if (choose.disabled || pending) return;
                    const file = root.querySelector(`[data-overview-expenses-file="${choose.dataset.overviewExpensesChoose}"]`);
                    if (file && !file.disabled) file.click();
                    return;
                }
                const button = event.target.closest?.('[data-overview-example]');
                if (button) return start(button);
            };
            const change = event => {
                const field = event.target.closest?.('[data-overview-expenses-file]');
                const file = field?.files?.[0];
                if (!file) return;
                const filename = root.querySelector(`[data-overview-expenses-filename="${field.dataset.overviewExpensesFile}"]`);
                if (filename) { filename.textContent = file.name || 'CSV ausgewählt'; filename.title = file.name || ''; }
                field.value = ''; // Auch dieselbe Dateiauswahl löst erneut change aus.
                return start(field, file);
            };
            root.addEventListener('click', click); root.addEventListener('change', change);
            const remove = () => { root.removeEventListener('click', click); root.removeEventListener('change', change); roots.delete(root); signal?.removeEventListener('abort', remove); controls.abort(); };
            roots.set(root, { remove, dialog }); signal?.addEventListener('abort', remove, { once: true });
        }
    };
    function start(button, file = null) {
        if (pending) return job;
        const model = getModel();
        if (!allowed(model) || !file && !examples(model)) return Promise.resolve();
        pending = true; request = key(model); abort = new AbortController();
        const localAbort = abort, opener = file ? button.parentElement?.querySelector('[data-overview-expenses-choose]')
            || button.parent?.querySelector('[data-overview-expenses-choose]') || button : button;
        message = ''; controls.syncButtons();
        job = (async () => {
            let choiceLease;
            try {
                const ids = [...model.scope.ids], { year, month } = model.expenses;
                const isCurrent = () => !localAbort.signal.aborted && request === key(getModel()) && allowed(getModel())
                    && (file || canGenerateExampleExpenses(controller, { allowBusy: true }));
                let selection = ids;
                const explicit = file ? button.dataset.overviewExpensesFile : button.dataset.overviewExampleTarget;
                if (explicit) { if (!ids.includes(explicit)) return; selection = [explicit]; }
                else if (button.dataset.overviewExample !== 'all') {
                    choiceLease = guard.register(Symbol('example-person-choice'), {
                        read: () => ({ phase: 'running', message: 'Personenwahl für Ausgaben läuft.' }), cancel: () => { localAbort.abort(); return true; }
                    });
                    const id = await choose({ doc, people: ids.map(id => ({ id, name: model.members.find(person => person.id === id)?.name || id })), signal: localAbort.signal });
                    choiceLease.unregister(); choiceLease = null;
                    if (!id || !ids.includes(id) || !isCurrent()) return;
                    selection = [id];
                }
                const targets = selection.map(profileId => ({ profileId,
                    name: model.members.find(person => person.id === profileId)?.name, year, month,
                    ...(file ? {} : { source: EXAMPLE_SOURCE }),
                    text: file ? () => file.text() : async () => generateExampleExpensesCsv({ controller, ids, profileId, year, month,
                        basis: resolveExampleExpensesBasis({ year, ids, budget: model.expenseBudget }) }) }));
                const result = await importExpenses({ ...importOptions, targets, controller, guard, signal: localAbort.signal, isCurrent,
                    confirm: (targets, context) => confirm(targets, { ...context, opener }), win,
                    onSuccess: async target => {
                        // Erfolgskontext vor einem UI-Refresh fixieren; Beispiele erfassen niemals Vermögen.
                        if (target.source !== EXAMPLE_SOURCE) await wealthCapture?.afterImport();
                        await importOptions.onSuccess?.(target);
                    },
                    onFollowupError: error => controls.reportWealth(`Ausgaben importiert; Vermögensstand nicht bestätigt: ${error.message || error}`),
                    onProgress: text => { message = text; controls.syncButtons(); } });
                if (!isCurrent()) return;
                message = result.status === 'cancelled' ? 'Import abgebrochen.' : result.results.map(item =>
                    `${model.members.find(person => person.id === item.profileId)?.name || item.profileId}: ${item.ok ? (file ? 'Ausgaben importiert.' : 'Beispielausgaben importiert.') : 'Nicht bestätigt: ' + (item.error?.message || 'Speicherfehler')}`).join(' ');
            } catch (error) { message = error.message || 'Ausgaben konnten nicht importiert werden.'; }
            finally {
                choiceLease?.unregister(); abort = null; pending = false; refresh(); controls.syncButtons();
                if (!localAbort.signal.aborted) {
                    const target = file ? doc.querySelector(`[data-overview-expenses-choose="${button.dataset.overviewExpensesFile}"]`)
                        : doc.querySelector(button.dataset.overviewExampleTarget
                            ? `[data-overview-example-target="${button.dataset.overviewExampleTarget}"]` : `[data-overview-example="${button.dataset.overviewExample}"]`);
                    // Nach einem erledigten Schritt kann der neue Importauslöser eingeklappt sein.
                    // Dann gehört der Rückfokus zum weiterhin sichtbaren Titel desselben Schritts.
                    let hidden = false;
                    let replacementSummary;
                    for (let node = target; node; node = node.parentElement || node.parent) {
                        hidden ||= Boolean(node.hidden);
                        if (Object.hasOwn(node.dataset || {}, 'closeExpensesReplace') && !node.open) replacementSummary = node.querySelector('summary');
                    }
                    const focusTarget = hidden ? target.closest?.('[data-close-dialog-step]')?.querySelector?.('[data-close-dialog-activate]') : replacementSummary || target;
                    (focusTarget || opener)?.focus?.();
                }
            }
        })();
        return job;
    }
    controls.bindRoot(doc.getElementById('overviewFocus')); boundImports.set(doc, controls);
    return controls;
}
