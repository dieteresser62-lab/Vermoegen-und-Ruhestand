import { initExpensesTab, refreshExpensesView, selectExpensesYear, getExpensesViewYear } from '../balance/balance-expenses.js';
import { loadExpensesStoreResult } from '../balance/balance-expenses-storage.js';
import { refreshBalanceExpensesHistory } from '../balance/balance-expenses-history-renderer.js';
import { projectExpenses, readExpensesBudget, expensesDueMonth, hasExpenseImport } from './expenses-model.js';
import { collectExpensesDom, createExpensesMessages, renderExpensesPage } from './expenses-renderer.js';
import { bindExpensesClose } from './expenses-close.js';
import { createOverviewExpensesWealthCapture } from '../overview/overview-example-expenses.js';
import { loadProfileRegistry, getCurrentProfileId } from '../profile/profile-registry.js';
import { overviewScope } from '../overview/overview-storage.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { appNow } from '../shared/app-clock.js';

/** Ein Controller je Dokument; Auswahl ist lokal, bestätigte Aktionen nutzen die Suite-Dienste. */
export function createExpensesController({ doc, win, storage = persistenceStorage, now = appNow, actions = {}, closeOptions = {} }) {
    const refs = collectExpensesDom(doc), messages = createExpensesMessages(doc);
    const importJobs = new Set();
    let personId = null, close, view, initializing = true;
    const registry = () => {
        const result = loadProfileRegistry(storage);
        if (!result.value) throw new Error('Personendaten nicht verfügbar. Bitte Daten & Sicherung öffnen.');
        return result.value;
    };
    const people = () => {
        const profiles = registry().profiles;
        const members = Object.entries(profiles).filter(([, person]) => person.meta.belongsToHousehold !== false);
        const selected = members.length ? members : Object.entries(profiles).filter(([id]) => id === getCurrentProfileId(storage));
        return selected.map(([id, person]) => ({ id, profileId: id, name: person.meta.name }));
    };
    const visible = () => people().filter(person => !personId || person.id === personId);
    const history = { chart: doc.getElementById('expensesHistoryChart'), table: doc.getElementById('expensesHistoryTable'),
        hint: doc.getElementById('expensesHistoryHint'), scrollHint: doc.getElementById('expensesHistoryScrollHint'), isVisible: () => true };
    const render = () => {
        if (initializing) return;
        const model = close?.read();
        const year = getExpensesViewYear(), persons = people();
        const ids = visible().map(person => person.id);
        const scope = overviewScope(personId || persons.length === 1 ? 'single' : 'household', ids);
        const loaded = registry();
        const receiptScope = overviewScope(personId || !persons.some(person => loaded.profiles[person.id].meta.belongsToHousehold !== false) ? 'single' : 'household', ids);
        const budget = readExpensesBudget({ year, scope, receiptScope, registry: loaded, activeId: getCurrentProfileId(storage), storage });
        const result = loadExpensesStoreResult(storage);
        view = projectExpenses({ store: result.store, year, people: persons, personId, budget, now: now(), firstPlanningYear: model?.firstPlanningYear });
        renderExpensesPage(doc, view, { corrupt: result.status === 'corrupt', occasion: model?.occasion });
        refreshBalanceExpensesHistory(history, { storage, now });
        if (result.status === 'corrupt') history.hint.textContent = 'Jahresausgaben nicht lesbar. Bitte die Recovery unter Monate verwenden.';
        // Matrix und Kacheln lesen dieselbe Budgetquelle; kein Engine-/Planwrite.
        const monthly = budget.monthly;
        for (const month of view.months) {
            const budgetCell = refs.expenses.table.querySelector(`[data-month="${month.month}"][data-role="budget"]`);
            const delta = refs.expenses.table.querySelector(`[data-month="${month.month}"][data-role="delta"]`);
            if (budgetCell) budgetCell.textContent = monthly === null ? '—' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(monthly);
            if (delta) delta.textContent = monthly === null || !month.complete ? '—' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(month.total - monthly);
        }
        close?.sync();
    };
    const capture = createOverviewExpensesWealthCapture({ doc, win, storage, refresh: () => refresh(), report: text => messages.toast(text) });
    // Auch der gemeinsame Probelauf-Observer kann die Matrix ersetzen.
    // Identität vor dem Entfernen merken; Nutzerfokus außerhalb beendet den Auftrag.
    let matrixFocus = null, arrivalFocus = null, matrixUpdates = 0;
    const identityOf = node => refs.expenses.table.contains(node) && node?.dataset?.action
        ? { ...node.dataset, year: getExpensesViewYear() } : null;
    doc.addEventListener('focusin', event => {
        matrixFocus = identityOf(event.target);
        arrivalFocus = null;
    });
    doc.addEventListener('focusout', event => {
        // Ein Blur auf eine nicht fokussierbare Fläche erzeugt kein focusin.
        // Entfernung oder Sperre dürfen den Wiederherstellungsauftrag behalten.
        if (matrixUpdates || !event.target?.isConnected || event.target.disabled) return;
        if (identityOf(event.target) || event.target === arrivalFocus?.baseline) {
            matrixFocus = null; arrivalFocus = null;
        }
    });
    const restoreMatrixFocus = () => {
        // Die native Fragmentnavigation kann einen vor load gesetzten Fokus
        // wieder auf body verschieben. Den Ankunftsauftrag erst danach ausführen.
        if (arrivalFocus && ['loading', 'interactive'].includes(doc.readyState)) return;
        const active = doc.activeElement;
        const current = identityOf(active);
        if (current && !arrivalFocus) { matrixFocus = current; return; }
        if (active && active !== doc.body && active !== doc.documentElement && active !== arrivalFocus?.baseline) {
            matrixFocus = null; arrivalFocus = null; return;
        }
        const identity = arrivalFocus || matrixFocus;
        if (!identity || identity.year !== getExpensesViewYear()) return;
        const buttons = [...refs.expenses.table.querySelectorAll('button[data-month][data-profile]')];
        const matches = action => buttons.find(button => button.dataset.action === action
            && button.dataset.month === String(identity.month) && button.dataset.profile === identity.profile && !button.disabled);
        const replacement = matches(identity.action) || (identity.action === 'details' && matches('import'));
        if (replacement) {
            if (arrivalFocus) replacement.scrollIntoView?.({ block: 'center' });
            arrivalFocus = null;
            replacement.focus({ preventScroll: true });
            matrixFocus = identityOf(replacement);
        }
    };
    const preserveMatrixFocus = update => {
        const active = doc.activeElement;
        matrixFocus = identityOf(active) || matrixFocus;
        matrixUpdates++;
        try { return update(); }
        finally {
            matrixUpdates--;
            if (!matrixUpdates) restoreMatrixFocus();
        }
    };
    const refresh = () => preserveMatrixFocus(() => { refreshExpensesView(); render(); });
    const guard = getPageNavigationGuard(doc, win);
    const pageImports = {
        get pending() { return importJobs.size > 0; },
        wait: () => Promise.allSettled([...importJobs]),
        abort: () => refreshExpensesView({ invalidateContext: true }),
        syncButtons() {
            const loaded = loadExpensesStoreResult(storage);
            const probelauf = getProbelaufController(doc);
            const blocked = importJobs.size > 0 || close?.imports.pending || loaded.status === 'corrupt'
                || close?.read()?.recovery || PersistenceFacade.hasSyncWriteBlocks() || win.__profileRecoveryBlocker
                || probelauf?.busy || probelauf?.blocked || guard.isBusy()
                || guard.reasons().some(reason => ['commit', 'preparing', 'running', 'cancelling'].includes(reason.phase));
            refs.expenses.table.querySelectorAll('button[data-month][data-profile]').forEach(button => {
                const record = loaded.store?.years?.[getExpensesViewYear()]?.months?.[button.dataset.month]?.profiles?.[button.dataset.profile];
                const needsRecord = ['details', 'delete'].includes(button.dataset.action);
                button.disabled = Boolean(blocked || needsRecord && !hasExpenseImport(record));
            });
            if (importJobs.size) {
                doc.getElementById('expensesClose').disabled = true;
            }
            restoreMatrixFocus();
        }
    };
    const trackImport = job => {
        importJobs.add(job); close?.sync();
        const done = () => {
            importJobs.delete(job);
            try { refresh(); } catch { messages.handleError(new Error('Die Ansicht konnte nicht aktualisiert werden. Bitte neu laden.')); }
        };
        job.then(done, done);
    };
    initExpensesTab(refs, { ...actions, storage, now, messages, initialYear: now().getFullYear(), readOnlySelection: true, transactionalActions: true, deleteInDetails: true,
        getProfiles: visible, renderSummary: () => render(), preserveMatrixFocus, missingLabel: 'fehlt',
        dueMonth: year => expensesDueMonth(year, now(), close?.read()?.firstPlanningYear),
        onChange: render, onImportOperation: trackImport, onImportSuccess: () => capture.afterImport() });
    close = bindExpensesClose({ doc, win, storage, refresh, wealthCapture: capture, pageImports, options: closeOptions });
    const segments = doc.getElementById('expensesPersonSegments');
    for (const choice of [{ id: null, name: 'Haushalt' }, ...people()]) {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'ds-button ds-button-secondary';
        button.textContent = choice.name; button.dataset.expensesPerson = choice.id || ''; button.setAttribute('aria-pressed', String(choice.id === personId));
        button.addEventListener('click', () => {
            personId = choice.id;
            segments.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node === button)));
            refreshExpensesView({ invalidateContext: true }); render();
        }); segments.appendChild(button);
    }
    doc.getElementById('expensesDueImport').addEventListener('click', () => {
        const due = view?.due; if (!due?.missing.length) return;
        personId = due.missing[0].id;
        segments.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.expensesPerson === personId)));
        refreshExpensesView({ invalidateContext: true }); selectExpensesYear(due.year); render();
        const button = refs.expenses.table.querySelector(`button[data-action="import"][data-month="${due.month}"]`);
        button?.focus();
    });
    const band = doc.getElementById('probelaufBand');
    if (win.MutationObserver && band) new win.MutationObserver(refresh).observe(band, { subtree: true, childList: true, attributes: true });
    if (win.MutationObserver) new win.MutationObserver(restoreMatrixFocus).observe(refs.expenses.table,
        { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
    guard.subscribe(() => { if (!initializing) pageImports.syncButtons(); });
    initializing = false; refresh();
    const applyTarget = request => {
        matrixFocus = null; arrivalFocus = null;
        if (request.year !== null) selectExpensesYear(request.year);
        if (request.month === null) {
            const host = doc.getElementById('expensesYearSegments'); host.scrollIntoView?.({ block: 'center' }); host.focus?.();
            return true;
        }
        const profile = visible()[0]?.id;
        if (!profile) return true;
        const action = request.target === 'ausgaben-import' ? 'import' : 'details';
        const buttons = [...refs.expenses.table.querySelectorAll('button[data-month][data-profile]')];
        const target = buttons.find(button => button.dataset.action === action && button.dataset.month === String(request.month)
            && button.dataset.profile === profile && !button.disabled)
            || buttons.find(button => button.dataset.action === 'import' && button.dataset.month === String(request.month)
                && button.dataset.profile === profile && !button.disabled);
        if (target && !['loading', 'interactive'].includes(doc.readyState)) {
            target.scrollIntoView?.({ block: 'center' }); target.focus(); matrixFocus = identityOf(target);
        } else {
            arrivalFocus = { action, month: request.month, profile, year: getExpensesViewYear(), baseline: doc.activeElement };
            if (['loading', 'interactive'].includes(doc.readyState)) win.addEventListener('load', restoreMatrixFocus, { once: true });
        }
        return true;
    };
    return { refresh, applyTarget, cancelTarget: () => { arrivalFocus = null; },
        selectYear: year => preserveMatrixFocus(() => selectExpensesYear(year)), get view() { return view; }, close, capture };
}
