import { areaSessionStorage } from '../shared/persistence-area-storage.js';
import { createClosePriceActions } from '../shared/close-price-actions.js';
import { bindOverviewAnnualClose } from './overview-annual-close.js';
import { consumeAnnualRetry } from '../shared/annual-coordinator.js';
import { initializeHouseholdPlanPage } from '../profile/household-plan-dialog.js';
import { bindOverviewExampleExpenses, createOverviewExpensesWealthCapture } from './overview-example-expenses.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { readHouseholdPersonStatus, showPersonDataStatus } from '../shared/person-data-status.js';
import { bindOverviewHistory } from './overview-history.js';
import { readDailyPrices, DAILY_PRICES_KEY } from '../tranches/tranchen-history-store.js';
import { bindHistoryFetch } from '../tranches/tranchen-history-fetch.js';
import { initializeProfilePage, whenProfileDisplayReady } from '../profile/profile-navigation.js';
import { getLastProfileBootstrapResult } from '../profile/profile-storage.js';
import { loadProfileRegistry, getCurrentProfileId } from '../profile/profile-registry.js';
import { renderProfileRecovery } from '../profile/profile-recovery-ui.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { resumeTimeLapse } from '../shared/probelauf-timelapse-ui.js';
import { bindStartupPrices } from '../tranches/tranchen-startup-prices.js';
import { projectOverviewWithAnnualArchive } from './overview-model.js';
import { readLastFullBackup, storeMonthProvision } from './overview-storage.js';
import { renderOverview, renderOverviewPersistenceRecovery, bindOverviewBackupTargets, openOverviewBackupTarget } from './overview-renderer.js';
import { requestOverviewMonthConfirmation } from './overview-month-confirmation.js';

export { projectOverviewFromRecords } from './overview-model.js';

const initializedOverview = new WeakMap();
export function initOverview(doc = document, win = window) {
    if (!initializedOverview.has(doc)) initializedOverview.set(doc, initializeOverview(doc, win));
    return initializedOverview.get(doc);
}
async function initializeOverview(doc, win) {
    bindOverviewBackupTargets(doc, win);
    const ready = await initializeProfilePage({ doc, win, kind: 'index' });
    if (!ready) return false;
    const annualRetry = consumeAnnualRetry(areaSessionStorage(win.sessionStorage));
    showPersonDataStatus(readHouseholdPersonStatus({ win }), doc);
    if (win.__personMigrationDeferred) return true;
    renderOverviewPersistenceRecovery(doc, PersistenceFacade.getPersistenceStatus().migrationWarning);
    const bootstrap = getLastProfileBootstrapResult();
    if (bootstrap?.action === 'recovery' && bootstrap.recovery) renderProfileRecovery({
        statusEl: doc.getElementById('overviewProfileRecovery'), recovery: bootstrap.recovery, controls: [], doc, win
    });
    const available = await whenProfileDisplayReady(doc);
    if (available && !win.__profileRecoveryBlocker) await initializeHouseholdPlanPage({ doc, win });
    let priceReport = null;
    let model = null;
    let monthControls, historyControls, exampleControls, annualControls;
    const refresh = () => {
        // Nach einem Bereichswechsel lädt die Seite gleich neu; bis dahin nichts mehr lesen.
        if (PersistenceFacade.getPersistenceStatus().reloadRequired) return;
        const liveData = {};
        for (let index = 0; index < persistenceStorage.length; index++) {
            const key = persistenceStorage.key(index); liveData[key] = persistenceStorage.getItem(key);
        }
        const confirmedPrices = readDailyPrices(persistenceStorage);
        liveData[DAILY_PRICES_KEY] = confirmedPrices.raw;
        model = projectOverviewWithAnnualArchive({ registry: available ? loadProfileRegistry().value : null,
            activeId: available ? getCurrentProfileId() : null, liveData, historyPeriod: historyControls.period, historyReport: historyControls.report, lastBackup: readLastFullBackup(), priceReport,
            recovery: Boolean(win.__profileRecoveryBlocker || PersistenceFacade.getPersistenceStatus().migrationWarning) }, { onChange: refresh });
        model = monthControls.projectModel(model);
        model = exampleControls.projectModel(model);
        renderOverview(doc, model);
        monthControls.syncButtons();
        exampleControls.syncButtons();
        annualControls?.syncButtons();
    };
    const priceActions = createClosePriceActions({ doc, win, getModel: () => model, onReport: report => { priceReport = report; refresh(); } });
    monthControls = bindOverviewMonthClose({ doc, win, getModel: () => model, refresh, priceActions, getImports: () => exampleControls });
    historyControls = bindOverviewHistory({ doc, win, refresh, storage: persistenceStorage });
    const wealthCapture = createOverviewExpensesWealthCapture({ doc, win, refresh, report: text => exampleControls?.reportWealth(text) });
    exampleControls = bindOverviewExampleExpenses({ doc, win, getModel: () => model, refresh, wealthCapture });
    annualControls = bindOverviewAnnualClose({ doc, win, getModel: () => model, refresh, priceActions, getImports: () => exampleControls });
    if (win.MutationObserver && doc.getElementById('probelaufBand')) new win.MutationObserver(refresh).observe(doc.getElementById('probelaufBand'), { subtree: true, childList: true, attributes: true });
    refresh();
    if (annualRetry) await annualControls.resume(annualRetry);
    doc.addEventListener('overview-backup-changed', refresh);
    const startup = bindStartupPrices({ doc, win, onReport: report => { priceReport = report; refresh(); } });
    let historyTask;
    if (available && !win.__profileRecoveryBlocker) {
        historyTask = bindHistoryFetch({ doc, win, afterStartup: startup, firstPlanningYear: () => model.firstPlanningYear });
        historyControls.watch(historyTask);
    }
    void resumeTimeLapse(doc, { ready: () => Promise.all([startup, historyTask]), refresh });
    return true;
}

/** Gemeinsamer delegierter Abschlussweg; der Speichervertrag bleibt im Store. */
const boundMonths = new WeakMap();
export function bindOverviewMonthClose({ doc, win, getModel, refresh, store = storeMonthProvision,
    confirm = requestOverviewMonthConfirmation, priceActions, getImports = () => null,
    host = doc.getElementById('overviewFocus'), returnFocus = null }) {
    if (boundMonths.has(doc)) return boundMonths.get(doc);
    let pending = false, request = null, statusContext = null, writing = false, completed = false, recoveryRequired = false, dirty = false, revision = 0;
    let confirmationAbort = null, dialog = null, finished = Promise.resolve(), finish;
    const guard = getPageNavigationGuard(doc, win), owner = Symbol('overview-month-close');
    const lease = guard.register(owner, {
        read: () => ({ phase: writing ? 'commit' : 'idle', dirty, revision, message: 'Ungespeicherte Tagesgeldeingaben im Monatsdialog.' }),
        cancel: async () => { if (writing) return false; confirmationAbort?.abort(); await finished; return true; }
    });
    const sameContext = model => model?.activeId === request?.expectedProfileId
        && model?.scope?.key === request?.scope.key && model?.occasion?.month === request?.month
        && (!requestDate || model?.now?.toDateString() === requestDate);
    let requestDate = null;
    const status = text => { const node = doc.getElementById('overviewMonthStatus'); if (node) node.textContent = text; };
    const controls = {
        projectModel(model) {
            const ownCandidate = writing && sameContext(model) && model.occasion?.kind === 'play';
            if (confirmationAbort && !writing && (!sameContext(model) || !completed && !recoveryRequired && !model.recovery && model.occasion?.kind !== 'monthly')) confirmationAbort.abort();
            if (statusContext && (model.activeId !== statusContext.expectedProfileId || model.scope?.key !== statusContext.scope.key || model.occasion?.month !== statusContext.month)) {
                status(''); statusContext = null;
            }
            const projected = ownCandidate ? { ...model, occasion: { ...model.occasion, kind: 'monthly' } } : model;
            return pending && recoveryRequired ? { ...projected, recovery: true } : projected;
        },
        syncButtons() {
            doc.querySelectorAll('[data-overview-month]').forEach(button => { button.disabled = pending; });
            if (dialog && !writing && !dialog.busy) dialog.update(getModel());
            getImports()?.syncButtons();
        }
    };
    host?.addEventListener('click', async event => {
        if (event.target.closest('[data-overview-backup]')) { openOverviewBackupTarget(doc); return; }
        const button = event.target.closest('[data-overview-month]'), model = getModel();
        if (!button || pending || model?.occasion?.kind !== 'monthly' || model.recovery) return;
        if (guard.isBusy() || guard.reasons().some(reason => ['commit', 'preparing', 'running', 'cancelling'].includes(reason.phase))) return;
        request = { month: model.occasion.month, scope: { ...model.scope, ids: [...model.scope.ids] }, expectedProfileId: model.activeId };
        requestDate = model.now?.toDateString() || null;
        const closingMonth = new Date(model.occasion.previousYear, model.occasion.previousMonth - 1, 1).toLocaleDateString('de-DE', { month: 'long' });
        pending = true; completed = false; recoveryRequired = false; finished = new Promise(resolve => { finish = resolve; }); controls.syncButtons();
        const focusBack = () => returnFocus ? returnFocus() : (doc.querySelector?.('[data-overview-month-confirm]') || doc.getElementById('overviewFocusTitle'))?.focus?.();
        let callbackUsed = false;
        const save = async accepted => {
            if (writing || completed) return false;
            callbackUsed = true;
            // Der CSV-Folgejob und seine eigene Commitlease müssen vollständig beendet sein.
            if (getImports()) await getImports().wait();
            const current = getModel();
            if (!accepted || confirmationAbort?.signal.aborted || !sameContext(current) || current.occasion?.kind !== 'monthly' || !current.summary || current.recovery) return false;
            if (guard.isBusy() || guard.reasons().some(reason => reason.owner !== owner && ['commit', 'preparing', 'running', 'cancelling'].includes(reason.phase))) return false;
            if (accepted.cash) request.cash = accepted.cash;
            statusContext = request; writing = true; lease.notify(); status('Monatshaken wird gespeichert …'); refresh();
            const operationRequest = request;
            const owns = candidate => pending && writing && request === operationRequest && candidate === owner;
            const navigationOperation = { owns, controller: new AbortController(),
                check() { if (!owns(owner) || !sameContext(getModel()) || confirmationAbort?.signal.aborted) throw new Error('OVERVIEW_MONTH_OPERATION_ENDED'); },
                commit() { this.check(); lease.notify(); } };
            try {
                const ok = await store(request, { guard, navigationOperation }); refresh();
                const confirmed = ok && sameContext(getModel()) && getModel().summary && !getModel().recovery && ['monthly', 'play'].includes(getModel().occasion.kind);
                if (confirmed) { completed = true; dirty = false; revision++; }
                status(confirmed ? closingMonth + ' abgeschlossen ✓' : 'Bereitstellung nicht bestätigt. Bitte Profil und Umfang erneut prüfen.');
                return Boolean(confirmed);
            } catch (error) {
                recoveryRequired = error?.code === 'rollback_failed';
                refresh(); status(error?.code === 'rollback_failed'
                    ? 'Wiederherstellung erforderlich: Rückschreiben nicht bestätigt. Bitte den Wiederherstellungspunkt prüfen.'
                    : 'Bereitstellung nicht dauerhaft bestätigt. Bitte den Speicher prüfen und erneut versuchen.');
                throw error;
            } finally { writing = false; lease.notify(); if (!sameContext(getModel())) confirmationAbort?.abort(); refresh(); }
        };
        try {
            confirmationAbort = new AbortController();
            let accepted;
            try {
                accepted = await confirm({ doc, signal: confirmationAbort.signal, returnFocus: focusBack, people: model.cashPeople || [], model,
                    onAccept: save, priceActions, getModel,
                    isCommitActive: () => guard.reasons().some(reason => reason.phase === 'commit'),
                    onReady: handle => { dialog = handle; getImports()?.bindRoot(handle.root, confirmationAbort.signal, handle); },
                    onDirty: value => { dirty = value; revision++; lease.notify(); },
                    canClose: () => !writing && !guard.reasons().some(reason => reason.phase === 'commit'),
                    confirmDiscard: async () => {
                        dirty = dialog.dirty(); lease.notify();
                        const attempt = await guard.prepare({ owners: [owner], intent: 'discard', opener: doc.activeElement, signal: confirmationAbort.signal });
                        if (!attempt) return false;
                        // Zustimmung vor Cleanup validieren und freigeben: kein Warten auf
                        // finished aus einem Schließrückruf, der selbst auf den Guard wartet.
                        const allowed = guard.validate(attempt); guard.end(attempt); return allowed;
                    },
                    onClose: async () => {
                        if (writing || guard.reasons().some(reason => reason.phase === 'commit')) return false;
                        getImports()?.abort(); await getImports()?.wait(); return true;
                    } });
            } catch { statusContext = request; status('Monatsrückfrage konnte nicht geöffnet werden. Bitte erneut versuchen.'); return; }
            if (!callbackUsed && accepted) await save(accepted); // Injektionsvertrag der bestehenden Speicherorakel.
        } catch { /* Speicherfehler wurden bereits im Monatsstatus gemeldet. */ }
        finally {
            confirmationAbort?.abort(); confirmationAbort = null; dialog = null;
            writing = false; pending = false; dirty = false; revision++; finish?.(); lease.notify(); refresh(); focusBack();
        }
    });
    boundMonths.set(doc, controls); return controls;
}

if (globalThis.document?.documentElement?.dataset.suitePage === 'index') {
    const start = () => { void initOverview().catch(error => console.error('Übersicht konnte nicht geladen werden:', error)); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}
