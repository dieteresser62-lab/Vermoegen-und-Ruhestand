import { computeAnnualPlanUpdate } from './balance-annual-storage.js';
import { requestPageConfirmation, requestPageInput } from '../shared/page-dialog.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { projectOverview } from '../overview/overview-model.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { createAnnualModalHandlers } from './balance-annual-modal.js';
import { appNow } from '../shared/app-clock.js';
/**
 * Module: Balance Binder Snapshots
 * Purpose: Manages Snapshot UI actions (Create, Restore, Delete).
 *          It interfaces with the StorageManager to persist/retrieve specific application states.
 * Usage: Used by balance-binder.js to handle snapshot list interactions.
 * Dependencies: balance-config.js, balance-renderer.js, balance-storage.js
 */
import { CONFIG, StorageError } from './balance-config.js';
import { UIRenderer } from './balance-renderer.js';
import { StorageManager } from './balance-storage.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from '../shared/snapshot-archive.js';
import { createBalanceWealthHistoryService } from './balance-wealth-history.js';
import { createAnnualNavigationLifecycle } from './balance-annual-orchestrator.js';
import {
    ANNUAL_PERIOD_STATUS,
    LEGACY_PERIOD_DECISION,
    deriveCompletedCalendarYear,
} from './balance-annual-period.js';

import { getActiveProfileId, getCurrentProfileId } from '../profile/profile-storage.js';

export { ANNUAL_RETRY_SESSION_KEY, consumeAnnualRetry, validateAnnualRetry } from '../shared/annual-coordinator.js';
import { createAnnualCoordinator } from '../shared/annual-coordinator.js';
export const ANNUAL_PERIOD_METADATA_KEY = 'annualPeriodMetadata';
const activeProfile = () => getActiveProfileId() || getCurrentProfileId();

async function chooseLegacyDecision(targetYear, options = {}) {
    return await requestPageInput({ ...options, title: 'Jahresperiode klären',
        description: `Für den Jahresprozess ${targetYear} fehlen Periodenmetadaten. Wähle, ob Du diese Jahresperiode bereits abgeschlossen hast.`,
        label: 'Stand der Jahresperiode', value: LEGACY_PERIOD_DECISION.CANCEL,
        options: [ { value: LEGACY_PERIOD_DECISION.CANCEL, label: 'Abbrechen' },
            { value: LEGACY_PERIOD_DECISION.NOT_COMMITTED, label: 'Noch nicht abgeschlossen' },
            { value: LEGACY_PERIOD_DECISION.ALREADY_COMMITTED, label: 'Bereits abgeschlossen' } ],
        confirmLabel: 'Jahresstand übernehmen', cancelLabel: 'Abbrechen'
    }) ?? LEGACY_PERIOD_DECISION.CANCEL;
}

const restoreDescription = 'Standard-Restore setzt das zugeordnete Profil und die Balance-Daten auf den Snapshot-Stand. Andere Profile, Tageskurse, technische Einstellungen und die Snapshot-Historie bleiben erhalten. Vollständige Recovery setzt ihren größeren Umfang zurück. Vorher entsteht ein bestätigter Punkt „vor Zurückholen“. Die genaue Vorschau findest du unter Daten & Sicherung.';

export function createSnapshotHandlers({
    dom,
    appState,
    debouncedUpdate,
    applyAnnualInflation,
    runAnnualUpdate = async () => ({ ok: true }),
    validateLiveState = () => ({ ok: true }),
    wealthHistory = createBalanceWealthHistoryService(),
    onAnnualWealthSaved = () => {},
    getReferenceDate = appNow,
    getPlanningStatus = now => projectOverview({ registry: loadProfileRegistry().value,
        activeId: getProfileId(), now, balanceSingleFallback: true,
        liveData: Object.fromEntries(Array.from({ length: persistenceStorage.length }, (_, i) => persistenceStorage.key(i)).map(key => [key, persistenceStorage.getItem(key)])) }),
    showPlanningStart = options => createAnnualModalHandlers({ getLastUpdateResults: () => null }).showPlanningStart(options),
    getTargetYear = () => deriveCompletedCalendarYear(getReferenceDate()),
    getLegacyDecision = chooseLegacyDecision,
    showContinuation = () => {},
    reportAnnualError = (error, action) => UIRenderer.handleActionError(error, 'annual', action),
    clearAnnualError = () => UIRenderer.clearActionError('annual'),
    openRecovery = () => {},
    openExpensesYear = () => {},
    getProfileId = activeProfile,
    sessionStore = () => globalThis.sessionStorage,
    reload = () => globalThis.location.reload(),
    decide = requestPageConfirmation,
    confirmAnnual = async ({ targetYear, label, plan, signal }) => await requestPageConfirmation({
        title: 'Jahresperiode abschließen', signal,
        description: `Soll die Jahresperiode ${targetYear} ${label ? `für "${label}" ` : ''}jetzt abgeschlossen werden?\n\nDabei werden das aus dem Profil abgeleitete Alter, Inflation und Marktdaten aktualisiert und der Ausgaben-Check auf ${plan.expenses.nextYear} umgestellt. Vor der ersten Änderung wird ein Wiederherstellungspunkt erstellt.`,
        confirmLabel: 'Jahr abschließen', cancelLabel: 'Abbrechen'
    }) ? {} : null,
    flushLiveState = async ({ sync = false } = {}) => {
        if (sync && typeof debouncedUpdate === 'function') debouncedUpdate();
        if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    },
    navigationLifecycle = createAnnualNavigationLifecycle({ flush: async () => {} }),
    prepareAnnualDraft = computeAnnualPlanUpdate,
    createAnnualSnapshot,
    operationLock, engineLoader,
    projectAnnualState = () => {},
    commitLiveState = async () => {
        throw new Error('Der periodengebundene Balance-Commit ist nicht konfiguriert.');
    }
}) {
    let snapshotActionInFlight = false;
    const dialogLifecycle = createNavigationOperationLifecycle({
        guard: globalThis.document ? getPageNavigationGuard() : null
    });
    const captureDialogContext = () => {
        const identity = JSON.stringify([getProfileId(), getTargetYear(), appState.snapshotHandle,
            persistenceStorage.getItem('rs_current_profile'), persistenceStorage.getItem('rs_active_profile'),
            StorageManager.loadState()[ANNUAL_PERIOD_METADATA_KEY]]);
        return () => identity === JSON.stringify([getProfileId(), getTargetYear(), appState.snapshotHandle,
            persistenceStorage.getItem('rs_current_profile'), persistenceStorage.getItem('rs_active_profile'),
            StorageManager.loadState()[ANNUAL_PERIOD_METADATA_KEY]]);
    };
    const askSnapshot = async (key, options, signal) => dialogLifecycle.run({}, async operation => {
        const isCurrent = captureDialogContext();
        const snapshot = JSON.stringify(await SnapshotArchive.readSnapshot(key));
        operation.check();
        if (signal?.aborted || !isCurrent()) return false;
        const dialogSignal = signal ? AbortSignal.any([signal, operation.controller.signal]) : operation.controller.signal;
        const confirmed = await decide({ ...options, signal: dialogSignal });
        operation.check();
        if (!confirmed || signal?.aborted || !isCurrent()) return false;
        const unchanged = snapshot === JSON.stringify(await SnapshotArchive.readSnapshot(key));
        operation.check();
        return unchanged && !signal?.aborted && isCurrent();
    });

    const annual = createAnnualCoordinator({ storage: persistenceStorage, persistence: PersistenceFacade,
        archive: SnapshotArchive, now: getReferenceDate, getProfileId, getPlanningStatus, getLegacyDecision,
        confirmAnnual, flushLiveState, validateLiveState, navigationLifecycle: {
            ...navigationLifecycle,
            run: (options, execute) => navigationLifecycle.run(options, operation =>
                wealthHistory.runAnnual(() => execute(operation), { navigationOperation: operation }))
        },
        ...(operationLock ? { operationLock } : {}), ...(engineLoader ? { engineLoader } : {}),
        ...(createAnnualSnapshot ? { createSnapshot: createAnnualSnapshot } : {}),
        prepareAnnualDraft, prepareMarketData: runAnnualUpdate,
        commit: commitLiveState, projectAnnualState: committed => {
            projectAnnualState(committed);
            UIRenderer.toast(`Ausgaben-Check auf ${committed.nextYear} umgestellt.${committed.nextYear > 2026 ? ' Vermögensstand gesichert.' : ''}`);
            if (committed.nextYear > 2026) onAnnualWealthSaved();
        },
        clearError: clearAnnualError,
        reportError: error => reportAnnualError(error, StorageManager.loadState()?.annualPeriodMetadata?.pendingCommit ? {
            label: 'Daten & Sicherung → Wiederherstellungspunkte',
            onActivate: () => openRecovery(StorageManager.loadState()?.annualPeriodMetadata?.pendingCommit?.snapshotId)
        } : undefined), showPlanningStart, sessionStore, reload,
        confirmRestore: (id, options) => askSnapshot(id, { title: 'Snapshot wiederherstellen',
            description: `Snapshot "${id}" wiederherstellen?\n\n${restoreDescription} Anschließend wird dieselbe Jahresperiode mit diesem Handkurs einmalig abgeschlossen.`,
            confirmLabel: 'Wiederherstellen', cancelLabel: 'Abbrechen', opener: options.opener }, options.signal),
        restoreSnapshot: (id, options) => StorageManager.restoreSnapshot(id, appState.snapshotHandle, options)
    });
    return {
        handleJahresabschluss(options = {}) {
            if (snapshotActionInFlight) return Promise.resolve({ status: 'in_flight' });
            return annual.close(options);
        },
        reconcileAnnualPeriod: options => annual.reconcilePeriod(options),
        retryAnnualWithManualPrice: (context, price, options) => annual.retryAnnualWithManualPrice(context, price, options),

        async handleSnapshotActions(e) {
            // Ein persistenter pendingCommit ohne Handler ist keine Laufzeitsperre.
            if (snapshotActionInFlight || navigationLifecycle.isBlocked()) return { status: 'in_flight' };
            const restoreBtn = e.target.closest('.restore-snapshot');
            const deleteBtn = e.target.closest('.delete-snapshot');
            if (!restoreBtn && !deleteBtn) return;
            snapshotActionInFlight = true;
            const button = restoreBtn || deleteBtn;
            button.disabled = true;
            try {
                if (restoreBtn) {
                    const key = restoreBtn.dataset.key;
                    const snapshotName = key.replace('.json', '');
                    if (await askSnapshot(key, { title: 'Snapshot wiederherstellen',
                        description: `Snapshot "${snapshotName}" wiederherstellen?\n\n${restoreDescription}`,
                        confirmLabel: 'Wiederherstellen', cancelLabel: 'Abbrechen', opener: restoreBtn
                    }, e.signal)) {
                        UIRenderer.clearActionError('snapshots');
                        // Erst die ausdrückliche Restorebestätigung darf die Monatsfehler-
                        // sperre für den vorhandenen geschützten Snapshotrestore lösen.
                        const recovery = globalThis.window?.__balanceMonthRecovery;
                        if (recovery) {
                            if (!recovery.snapshotId || recovery.snapshotId !== key) throw new Error('Bitte den Wiederherstellungspunkt des fehlgeschlagenen Monatsabschlusses wählen.');
                            const result = await recovery.restore({ opener: restoreBtn });
                            if (result?.status === 'restored') delete globalThis.window.__balanceMonthRecovery;
                            else UIRenderer.handleActionError(new Error('Monatsstand wiederhergestellt; bitte die Seite neu laden. Eingaben bleiben gesperrt.'), 'snapshots');
                            return result;
                        }
                        const result = await StorageManager.restoreSnapshot(key, appState.snapshotHandle, { opener: restoreBtn });
                        if (result?.status === 'reload_required') {
                            UIRenderer.handleActionError(new Error(result.message), 'snapshots');
                        }
                        return result;
                    }
                }
                if (deleteBtn) {
                    const key = deleteBtn.dataset.key;
                    if (await askSnapshot(key, { title: 'Snapshot löschen',
                        description: `Snapshot "${key.replace('.json', '')}" endgültig löschen? Dieser Wiederherstellungspunkt wird aus der Snapshot-Historie entfernt.`,
                        confirmLabel: 'Snapshot löschen', cancelLabel: 'Abbrechen', danger: true, opener: deleteBtn
                    }, e.signal)) {
                        UIRenderer.clearActionError('snapshots');
                        await StorageManager.deleteSnapshot(key, appState.snapshotHandle);
                    }
                }
            } catch (err) {
                if (err?.name === 'AbortError') return { status: 'cancelled' };
                UIRenderer.handleActionError(new StorageError("Snapshot-Aktion fehlgeschlagen.", { originalError: err }), 'snapshots');
            } finally {
                snapshotActionInFlight = false;
                button.disabled = false;
            }
        }
    };
}
