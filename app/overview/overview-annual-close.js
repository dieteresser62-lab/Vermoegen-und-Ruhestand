import { projectAnnualCloseResult } from '../shared/annual-close-result.js';
import { annualCloseArchiveReader } from '../shared/annual-close-evidence.js';
import { projectAnnualCloseRecovery } from '../shared/annual-close-recovery.js';
import { SnapshotArchive } from '../shared/snapshot-archive.js';
import { createAnnualCoordinator, createAnnualNavigationLifecycle, consumeAnnualRetry, validateAnnualRetry } from '../shared/annual-coordinator.js';
import { createAnnualOperationLock } from '../shared/annual-operation-lock.js';
import { createAnnualCloseSession, createAnnualMonthSession, finalizeAnnualMonth, confirmAnnualMonthSummary } from '../shared/annual-close-session.js';
import { createAnnualCloseDialog } from '../shared/annual-close-dialog.js';
import { evaluateAnnualPlanPreview } from '../shared/annual-plan-editor.js';
import { createAnnualMarketDataReaders, createManualAnnualQuote } from '../shared/annual-marketdata.js';
import { annualEngineLoader } from '../shared/annual-engine-loader.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { requestPageInput, requestPageConfirmation } from '../shared/page-dialog.js';
import { restoreSnapshotById } from '../shared/snapshot-restore.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { captureCashPeople } from '../profile/profile-cash-update.js';
import { readBalancePersonStatus } from '../shared/person-data-status.js';
import { loadExpensesStoreResult } from '../balance/balance-expenses-storage.js';
import { CONFIG } from '../balance/balance-config.js';
import { projectAnnualClosePreparation } from './overview-model.js';
import { readOverviewSummary, OVERVIEW_SUMMARY_KEY } from './overview-storage.js';
import { projectAnnualPreview } from '../balance/balance-annual-preview.js';
import { appNow } from '../shared/app-clock.js';
import { isSyntheticPriceMode } from '../shared/market-price-adapter.js';

const bound = new WeakMap();
/** Bereits gebundener Seitenweg; erzeugt weder Binder noch Ersatzabhängigkeiten. */
export function getOverviewAnnualClose(doc) { return bound.get(doc); }

/** Tatsächlicher Startseitenbinder; keine Balanceinitialisierung oder Formularattrappen. */
export function bindOverviewAnnualClose({ doc, win, getModel, refresh, getImports = () => null, priceActions,
    storage = persistenceStorage, persistence = PersistenceFacade, now = appNow,
    guard = getPageNavigationGuard(doc, win), operationLock = createAnnualOperationLock(),
    readers = createAnnualMarketDataReaders({ storage, now }), engineLoader = annualEngineLoader,
    evaluatePlan = options => evaluateAnnualPlanPreview({ ...options, storage, engineLoader, now }),
    coordinatorOptions = {}, createMonthSession = createAnnualMonthSession } = {}) {
    if (bound.has(doc)) return bound.get(doc);
    let pending = false, last = null, retrying = false;
    const readState = () => JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY) || '{}');
    const model = () => projectAnnualClosePreparation(getImports()?.projectModel(getModel()) || getModel(), {
        store: loadExpensesStoreResult(storage).store,
        annualBudgetSummary: readOverviewSummary(storage.getItem(OVERVIEW_SUMMARY_KEY), getModel()?.occasion?.closingYear, getModel()?.scope) });
    const context = () => {
        const next = model();
        return { activeId: storage.getItem('rs_current_profile'), active: storage.getItem('rs_active_profile'),
            scope: next.scope?.key, date: now().toDateString(), synthetic: isSyntheticPriceMode(),
            people: readBalancePersonStatus({ storage, referenceYear: now().getFullYear() }).entries?.map(entry => ({ id: entry.profileId,
                values: Object.fromEntries(Object.entries(entry.data).filter(([key]) => key.startsWith('profile_') && key !== 'profile_tagesgeld')) })),
            cash: captureCashPeople({ storage, ids: next.scope?.ids || [], activeId: next.activeId }),
            inputs: readState().inputs, lastState: readState().lastState, cape: readState().capeMeta,
            metadata: readState().annualPeriodMetadata, marketMeta: readState().annualMarketDataMeta, plan: storage.getItem('household_plan_v1') };
    };
    const status = text => { const node = doc.getElementById('overviewAnnualStatus'); if (node) node.textContent = text; };
    const openRecovery = snapshotId => {
        const link = doc.createElement('a'); link.setAttribute('href', 'Daten-Sicherung.html' + (snapshotId ? '?punkt=' + encodeURIComponent(snapshotId) : '') + '#wiederherstellung');
        link.setAttribute('data-profile-handoff', ''); link.setAttribute('data-profile-handoff-export', 'false');
        link.hidden = true; doc.body.append(link); link.click(); link.remove();
    };
    const dialog = createAnnualCloseDialog({ document: doc, getModel: model, getLastUpdateResults: () => last,
        evaluatePlan, priceActions,
        projectPreview: options => projectAnnualPreview({ ...options, storage }),
        isCommitActive: () => guard.reasons().some(reason => reason.phase === 'commit'),
        onError: error => status(error.message), onClearError: () => status(''), onNotice: status });
    const preparation = createAnnualCloseSession({ readContext: context, getImports, guard, showPreparation: dialog.showAnnualPreparation,
        fetchers: { inflation: readers.prepareInflation, etf: readers.prepareETF, cape: readers.prepareCape } });
    const coordinator = createAnnualCoordinator({ storage, persistence, now, engineLoader, operationLock,
        navigationLifecycle: createAnnualNavigationLifecycle({ guard, flush: () => persistence.flush() }),
        getPlanningStatus: model, confirmAnnual: async () => null,
        getLegacyDecision: (targetYear, options) => requestPageInput({ ...options, doc, title: 'Jahresperiode klären',
            description: `Ist das Jahr ${targetYear} bereits abgeschlossen?`, label: 'Stand der Jahresperiode', value: 'cancel',
            options: [{ value: 'cancel', label: 'Abbrechen' }, { value: 'not_committed', label: 'Noch nicht abgeschlossen' }, { value: 'already_committed', label: 'Bereits abgeschlossen' }] }),
        projectAnnualState: () => refresh(), reportError: error => dialog.reportError(error), clearError: dialog.clearError,
        showPlanningStart: dialog.showPlanningStart, sessionStore: () => win.sessionStorage, reload: () => win.location.reload(),
        confirmRestore: (id, options) => requestPageConfirmation({ ...options, doc, title: 'Jahresstand wiederherstellen',
            description: `Wiederherstellungspunkt ${id} laden und dieselbe Jahresperiode einmalig mit dem Handkurs fortsetzen?`, confirmLabel: 'Wiederherstellen' }),
        restoreSnapshot: (id, options) => restoreSnapshotById(id, { ...options, guard, document: doc }),
        ...coordinatorOptions });
    const blocked = () => pending || retrying || persistence.hasSyncWriteBlocks?.() || win.__profileRecoveryBlocker
        || getProbelaufController(doc)?.busy || getProbelaufController(doc)?.blocked
        || guard.isBusy() || guard.reasons().some(reason => ['commit', 'preparing', 'running', 'cancelling'].includes(reason.phase));
    const controls = {
        projectModel: next => next,
        syncButtons() {
            doc.querySelectorAll('[data-overview-annual]').forEach(button => { button.disabled = Boolean(blocked()); });
            preparation.refresh();
        },
        async start(options = {}) {
            if (blocked()) return { status: 'in_flight' };
            pending = true; controls.syncButtons();
            let annualLease;
            try {
                annualLease = await operationLock.acquire();
                if (!annualLease) throw new Error('Eine andere Seite hält den Jahresbesitz.');
                let before = model(); const targetYear = now().getFullYear() - 1;
                if (before.recovery || readState().annualPeriodMetadata?.pendingCommit) { openRecovery(readState().annualPeriodMetadata?.pendingCommit?.snapshotId); return { status: 'cancelled' }; }
                if (!options.resume) {
                    await annualCloseArchiveReader.refresh({ targetYear, activeId: before.activeId, scope: before.scope });
                    refresh(); before = model();
                    const period = await coordinator.reconcilePeriod({ annualLease, clarify: true, opener: options.opener });
                    refresh(); before = model();
                    if (period.status === 'cancelled') return period;
                    if (period.status === 'legacy_confirmation_required') { status(period.errors.map(entry => entry.message).join(' ')); return period; }
                }
                let confirmedPreparation;
                if (options.resume) {
                    if (!await validateAnnualRetry(options.resume, { storage, now: Date.now(), getReferenceDate: now })) return { status: 'cancelled' };
                    dialog.showAnnualContinuation({ targetYear, opener: options.opener });
                    const controller = new AbortController(); let reading;
                    const lease = guard.register(Symbol('overview-annual-resume'), {
                        read: () => ({ phase: 'running', message: 'Wiederaufnahme liest Jahresdaten.' }),
                        cancel: async () => { controller.abort(); await reading.catch(() => {}); dialog.abortContinuation(); return true; }
                    });
                    const fingerprint = preparation.contextFingerprint();
                    try {
                        reading = Promise.all([readers.prepareInflation({ targetYear, signal: controller.signal }), readers.prepareCape({ targetYear, signal: controller.signal })]);
                        const [inflation, cape] = await reading; controller.signal.throwIfAborted();
                        if (fingerprint !== preparation.contextFingerprint()) throw new Error('Der Wiederaufnahmekontext wurde geändert.');
                        const people = captureCashPeople({ storage, ids: before.scope.ids, activeId: before.activeId });
                        confirmedPreparation = { manualPrice: options.resume.price, preparedMarketData: { inflation, cape },
                            adoptedPlanPatch: options.resume.adoptedPlanPatch,
                            cash: options.resume.cash ?? { people, values: Object.fromEntries(people.map(person => [person.id, person.value])) } };
                    } finally { lease.unregister(); }
                } else if (before.occasion?.annualState === 'open' || before.occasion?.annualState === 'unclear' && before.occasion.annualReason === 'missing_commit') {
                    confirmedPreparation = await preparation.prepare({ targetYear, model: before, getModel: model,
                        people: captureCashPeople({ storage, ids: before.scope.ids, activeId: before.activeId }), opener: options.opener,
                        validatePrice: value => ({ manualPrice: createManualAnnualQuote(value, `calendar-year:${targetYear}`).price }) });
                    if (!confirmedPreparation) return { status: 'cancelled' };
                }
                const result = await coordinator.close({ ...options, annualLease, confirmedPreparation, onProgress: dialog.setProgress });
                const recovery = await projectAnnualCloseRecovery(result, { archive: SnapshotArchive, metadata: readState().annualPeriodMetadata });
                if (result.results || recovery) {
                    last = { ...result.results, recovery, targetYear, confirmed: result.status === 'already_committed',
                        errors: result.error && !result.results?.errors?.length ? [{ step: 'Abschluss', error: result.error.message }] : result.results?.errors,
                        openRecovery: () => openRecovery(recovery?.snapshotId || result.retryContext?.snapshotId),
                        displayPreview: confirmedPreparation?.displayPreview };
                    if (last.confirmed && confirmedPreparation?.cash) {
                        const month = await finalizeAnnualMonth({ createSession: createMonthSession, options: { targetYear, annualSnapshotId: result.snapshotId,
                            cash: confirmedPreparation.cash, readModel: model, annualLease, guard,
                            readPending: () => readState().annualPeriodMetadata?.pendingCommit || persistence.hasSyncWriteBlocks(),
                            readContext: preparation.contextFingerprint,
                            confirmSummary: () => confirmAnnualMonthSummary({ targetYear, scope: model().scope,
                                expectedProfileId: model().activeId, persistence }) } });
                        last.monthSession = month.session; last.monthError = month.error?.message;
                        last.retryMonth = async () => { const receipt = await month.retry(); last.monthSession = month.session; refresh();
                            last.actionResult = projectAnnualCloseResult({ ...last, model: month.session?.model }); return receipt; };
                        refresh();
                    }
                    if (result.retryContext) {
                        last.validatePrice = value => ({ manualPrice: createManualAnnualQuote(value, result.retryContext.periodId).price });
                        last.retry = async ({ manualPrice }) => {
                            if (pending || retrying) return { status: 'in_flight' };
                            retrying = true;
                            try { return await coordinator.retryAnnualWithManualPrice(result.retryContext, manualPrice,
                                { annualLease: annualLease.released ? undefined : annualLease }); }
                            finally { retrying = false; }
                        };
                    }
                    last.actionResult = projectAnnualCloseResult({ ...last, model: last.monthSession?.model });
                    dialog.showUpdateResultModal(last);
                    const logButton = doc.getElementById('overviewAnnualLog'); if (logButton) logButton.hidden = false;
                } else {
                    dialog.finishPreflight();
                    if (result.status === 'already_committed') status(`Die Jahresperiode ${result.periodId.slice('calendar-year:'.length)} wurde bereits abgeschlossen.`);
                }
                refresh(); return result;
            } catch (error) {
                if (error.name !== 'AbortError') dialog.reportError(error);
                dialog.finishPreflight(); return { status: error.name === 'AbortError' ? 'cancelled' : 'invalid', error };
            } finally {
                // Auch ein bestätigter Vorabpunkt ohne Metadatenstart muss auf
                // dieser Seite bekannt sein, bevor spätere Kurswrites rendern.
                try {
                    const next = model();
                    await annualCloseArchiveReader.refresh({ targetYear: now().getFullYear() - 1, activeId: next.activeId, scope: next.scope });
                    refresh();
                } catch {
                    // Die lesende Projektion ersetzt weder Ergebnis noch Ausnahme.
                    // Readerfehler bleiben als gesperrte Archivevidenz erhalten.
                }
                pending = false;
                const root = doc.getElementById('balanceAnnualClose');
                if (root?.open) root.addEventListener('close', () => { annualLease?.release(); refresh(); }, { once: true });
                else await annualLease?.release();
                controls.syncButtons();
            }
        },
        showAction() {
            const next = model();
            const targetYear = last?.targetYear ?? next.year - 1;
            const confirmed = last?.confirmed ?? next.occasion?.annualState === 'done';
            dialog.showUpdateResultModal({ ...last, confirmed, targetYear,
                actionResult: projectAnnualCloseResult({ ...last, confirmed, targetYear, model: last?.monthSession?.model || next }) });
        },
        showLog: () => dialog.handleShowUpdateLog(),
        async resume(request) { if (!request || resumed.has(request)) return { status: 'cancelled' }; resumed.add(request); return controls.start({ resume: request }); },
        consumeRetry: () => consumeAnnualRetry(win.sessionStorage),
        dispose: () => preparation.dispose()
    };
    const resumed = new WeakSet();
    doc.getElementById('overviewFocus')?.addEventListener('click', event => {
        const button = event.target.closest('[data-overview-annual]');
        if (button && !button.disabled) void controls.start({ opener: button });
    });
    doc.getElementById('overviewAnnualLog')?.addEventListener('click', controls.showLog);
    bound.set(doc, controls);
    return controls;
}
