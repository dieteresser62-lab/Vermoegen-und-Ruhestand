// @ts-check
import { processingIsBlocked } from './controls.js';
import { state } from './state.js';
import { openCreateTrancheModal, openEditTrancheModal, formatTrancheValidationError, showTrancheFormError, clearTrancheFormError, readTrancheFromForm, captureManagerModalSubmission, isManagerModalSubmissionCurrent } from '../tranchen-manager-modal.js';
import { runManagerOperation, requestManagerDecision } from './history.js';
import { normalizeTranches } from '../tranchen-manager-state.js';
import { byId, readStoredValue, flushManagerRecords, restoreManagerRecords, finishManagerDecimalSubmission } from './helpers.js';
import { renderPersistenceState, clearRawPreview } from './persistence-status.js';
import { PROFILE_STORAGE_KEYS, PROFILE_TRANCHES_KEY } from '../../profile/profile-state.js';
import { PROFILE_LIVE_BASE_KEY, saveCurrentProfileFromLocalStorage } from '../../profile/profile-storage.js';
import { PROFILE_WEALTH_LOTS_KEY } from '../../profile/profile-wealth-history.js';
import { recordTrancheCollection } from '../tranchen-recording.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { render } from './rendering.js';

export function addTranche(event) {
    if (processingIsBlocked()) return;
    state.editingIndex = -1;
    openCreateTrancheModal(document, event?.currentTarget || event?.target || null);
}

export function editTranche(index, opener = null) {
    if (processingIsBlocked()) return;
    state.editingIndex = index;
    const tranche = state.tranchen[index];
    if (!tranche) return;
    openEditTrancheModal(tranche, document, opener);
}

export async function persistTranchen(nextTranches, options = {}) {
    const {
        successMessage = 'Änderung dauerhaft gespeichert.',
        onSuccess = null,
        allowRecovery = false
    } = options;

    if (state.commitInFlight || state.cashPostingInFlight || state.profileCommitInFlight) return false;
    if (!options.navigationOperation) return runManagerOperation(operation => persistTranchen(nextTranches, { ...options, navigationOperation: operation }));
    if (!allowRecovery && (state.loadStatus === 'corrupt' || state.loadStatus === 'unavailable')) return false;

    let normalized;
    try {
        normalized = normalizeTranches(nextTranches);
    } catch (error) {
        const detail = formatTrancheValidationError(error);
        state.persistenceError = `Die Änderung verletzt den Tranchenvertrag und wurde nicht gespeichert. ${detail}`;
        if (byId('trancheModal')?.classList?.contains?.('active')) showTrancheFormError(error);
        renderPersistenceState();
        return false;
    }

    const previousLiveRaw = state.loadStatus === 'corrupt'
        ? state.corruptRaw
        : state.confirmedRaw;
    const previousRegistryRaw = readStoredValue(PROFILE_STORAGE_KEYS.registry);
    const previousLiveBase = readStoredValue(PROFILE_LIVE_BASE_KEY);
    const previousLotsRaw = readStoredValue(PROFILE_WEALTH_LOTS_KEY);
    const previousLoadStatus = state.loadStatus;
    const previousCorruptRaw = state.corruptRaw;

    let committed = false;
    state.commitInFlight = true;
    state.persistenceMessage = '';
    state.persistenceError = '';
    renderPersistenceState();

    try {
        options.navigationOperation.commit();
        const persisted = recordTrancheCollection(normalized, persistenceStorage, { previousTranches: state.confirmedTranches });
        if (!saveCurrentProfileFromLocalStorage()) {
            throw new Error('PROFILE_SAVE_FAILED');
        }
        await flushManagerRecords();

        state.tranchen = persisted;
        state.confirmedTranches = persisted;
        state.confirmedRaw = JSON.stringify(persisted);
        state.corruptRaw = null;
        state.loadStatus = persisted.length > 0 ? 'valid' : 'empty';
        state.pendingCommit = null;
        state.registryDisplayRaw = undefined;
        state.taxMigrationWarning = '';
        state.persistenceMessage = successMessage;
        clearRawPreview();
        committed = true;
        return true;
    } catch {
        const restored = await restoreManagerRecords([
            [PROFILE_TRANCHES_KEY, previousLiveRaw],
            [PROFILE_WEALTH_LOTS_KEY, previousLotsRaw],
            [PROFILE_STORAGE_KEYS.registry, previousRegistryRaw],
            [PROFILE_LIVE_BASE_KEY, previousLiveBase]
        ]);
        state.tranchen = state.confirmedTranches;
        state.loadStatus = previousLoadStatus;
        state.corruptRaw = previousCorruptRaw;
        state.pendingCommit = { tranches: normalized, successMessage, onSuccess, allowRecovery, modalSubmission: options.modalSubmission };
        state.registryDisplayRaw = previousRegistryRaw;
        state.persistenceError = restored
            ? 'Speichern wurde nicht dauerhaft bestätigt. Der letzte bestätigte Stand bleibt sichtbar; Retry ist möglich.'
            : 'Speichern und dauerhaftes Rückschreiben konnten nicht bestätigt werden. Der letzte bestätigte Stand bleibt sichtbar; Retry ist möglich.';
        return false;
    } finally {
        state.commitInFlight = false;
        render();
        renderPersistenceState();
        if (committed && typeof onSuccess === 'function') onSuccess(options.navigationOperation);
    }
}

export async function deleteTranche(index) {
    if (processingIsBlocked()) return false;
    const tranche = state.tranchen[index];
    if (!tranche) return false;
    const deleted = await runManagerOperation(async operation => {
        if (!await requestManagerDecision({ title: 'Tranche löschen', confirmLabel: 'Tranche löschen', danger: true,
            opener: document.activeElement, description: `Tranche „${tranche.name || tranche.trancheId}“ wirklich dauerhaft löschen?` }, operation)) return false;
        const nextTranches = state.tranchen.filter(item => item.trancheId !== tranche.trancheId);
        return persistTranchen(nextTranches, { navigationOperation: operation, successMessage: 'Tranche dauerhaft gelöscht.' });
    });
    if (deleted === true) byId('depotAddTrancheBtn')?.focus?.();
    return deleted;
}

export async function saveTranche(event) {
    event.preventDefault();
    if (processingIsBlocked()) return;
    clearTrancheFormError();

    const existingId = (state.editingIndex >= 0 && state.tranchen[state.editingIndex])
        ? state.tranchen[state.editingIndex].trancheId
        : null;
    let tranche;
    try {
        tranche = readTrancheFromForm(existingId, document, {
            existingIds: state.tranchen.map(item => item.trancheId),
            existingTranche: state.tranchen[state.editingIndex]
        });
    } catch (error) {
        showTrancheFormError(error);
        state.persistenceError = `Tranche nicht gespeichert. ${formatTrancheValidationError(error)}`;
        renderPersistenceState();
        return false;
    }
    const nextTranches = [...state.tranchen];

    if (state.editingIndex >= 0) {
        nextTranches[state.editingIndex] = tranche;
    } else {
        nextTranches.push(tranche);
    }

    const modalSubmission = captureManagerModalSubmission('tranche');
    return persistTranchen(nextTranches, {
        modalSubmission,
        successMessage: existingId ? 'Tranche dauerhaft aktualisiert.' : 'Tranche dauerhaft angelegt.',
        onSuccess: navigationOperation => {
            if (isManagerModalSubmissionCurrent('tranche', modalSubmission)) {
                state.editingIndex = state.tranchen.findIndex(item => item.trancheId === tranche.trancheId);
            }
            finishManagerDecimalSubmission('tranche', modalSubmission, navigationOperation);
        }
    });
}
