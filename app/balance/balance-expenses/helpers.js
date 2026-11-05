import { requestPageConfirmation } from '../../shared/page-dialog.js';
import { appNow } from '../../shared/app-clock.js';
import { UIUtils } from '../balance-utils.js';
import { UIRenderer } from '../balance-renderer.js';
import { loadProfilverbundProfiles } from '../../profile/profilverbund-balance.js';
import { downloadJsonFile } from '../../shared/persistence-backup.js';
import { PersistenceFacade, persistenceStorage } from '../../shared/persistence-facade.js';
import { requestExpensesPreview } from '../balance-expenses-import.js';
import { getPageNavigationGuard } from '../../shared/navigation-guard-dialog.js';
import { loadProfileRegistry } from '../../profile/profile-registry.js';
import { EXPENSES_STORE_STATUS, loadExpensesStoreResult } from '../balance-expenses-storage.js';
import { context, state } from './context.js';

export function mutationBlocked() {
    const guard = getPageNavigationGuard(globalThis.document);
    return guard.isBusy() || guard.reasons().some(reason => ['commit', 'running', 'preparing', 'cancelling'].includes(reason.phase));
}

export async function trackMutation(action) {
    if (!context.adapters.transactionalActions) return action();
    const guard = getPageNavigationGuard(globalThis.document);
    if (mutationBlocked()) return;
    const lease = guard.register(Symbol('expenses-mutation'), { read: () => ({ phase: 'commit', message: 'Ausgabenaktion läuft – bitte warten.' }) });
    try { return await action(); } finally { lease.unregister(); }
}

export function reportImportOperation(job) {
    try { context.adapters.onImportOperation?.(job); } catch { /* Anzeige besitzt die Speicherung nicht. */ }
    return job;
}

export function messages() { return context.adapters.messages || UIRenderer; }

export function notifyExpensesChange() {
    // Die lesende Darstellung darf erfolgreiche Speicheraktionen nicht rückgängig machen.
    try { (0, context.onChange)?.(); } catch { /* Der Ausgaben-Check bleibt bedienbar. */ }
}

export function createDefaultRecoveryOptions(options = {}) {
    return {
        storage: options.storage || persistenceStorage,
        getPersistenceStatus: options.getPersistenceStatus
            || (() => PersistenceFacade.getPersistenceStatus()),
        confirmReset: options.confirmReset
            || ((message, context) => requestPageConfirmation({ ...context, title: 'Ausgaben-Check zurücksetzen', description: message, confirmLabel: 'Ausgaben zurücksetzen', cancelLabel: 'Abbrechen', danger: true })),
        confirmDelete: options.confirmDelete || requestPageConfirmation,
        downloadRecovery: options.downloadRecovery
            || ((document, filename) => downloadJsonFile(document, filename, globalThis.document)),
        flush: options.flush || (ownedFlush => ownedFlush ? ownedFlush() : PersistenceFacade.flush()),
        now: options.now || appNow,
        importWait: options.importWait || {},
        confirmImport: options.confirmImport || ((targets, context) => requestExpensesPreview(targets, { ...context, doc: globalThis.document }))
    };
}

export function getBackendLabel() {
    try {
        return String(context.recoveryOptions?.getPersistenceStatus?.()?.backend || 'unknown');
    } catch {
        return 'unknown';
    }
}

export function createRecoveryFilename(date = new Date()) {
    return `balance-ausgaben-recovery-${date.toISOString().replace(/[:.]/g, '-')}.json`;
}

export function readExpensesStoreForUi() {
    const result = loadExpensesStoreResult(context.recoveryOptions?.storage);
    if (result.status === EXPENSES_STORE_STATUS.CORRUPT) {
        const isSameCorruption = state.corruption?.raw === result.raw
            && state.corruption?.error?.code === result.error?.code;
        state.corruption = result;
        if (!isSameCorruption) {
            state.recoveryExported = false;
            state.recoveryCancelled = false;
        }
        return null;
    }
    state.corruption = null;
    state.recoveryExported = false;
    state.recoveryCancelled = false;
    return result.store;
}

export function formatCurrency(value) {
    return UIUtils.formatBalanceCurrency(Math.abs(value || 0));
}

export function getProfiles() {
    if (context.adapters.getProfiles) return context.adapters.getProfiles();
    const profiles = loadProfilverbundProfiles();
    if (profiles.length > 0) return profiles;
    const registry = loadProfileRegistry().value;
    const id = persistenceStorage.getItem('rs_current_profile') || persistenceStorage.getItem('rs_active_profile');
    const single = registry?.profiles?.[id];
    return [{ profileId: single?.meta?.id || id || 'default', name: single?.meta?.name || 'Profil', inputs: {} }];
}

export function renderProfileRecoveryBlocker(error) {
    state.profileIds = [];
    messages().handleError(new Error(
        `Profil-Recovery erforderlich: ${error?.message || 'Profildaten konnten nicht sicher geladen werden.'}`
    ));
    return {
        status: 'profile_recovery',
        error
    };
}
