// @ts-check
import { byId } from './helpers.js';
import { state } from './state.js';
import { notifyManagerModalState, isManagerModalSubmissionCurrent } from '../tranchen-manager-modal.js';
import { setManagerControlsBlocked, processingIsBlocked } from './controls.js';

export function setPersistenceStatus(message, kind = '', { hidePanel = false } = {}) {
    const target = byId('tranchePersistenceStatus');
    if (!target) return;
    target.textContent = message;
    target.dataset.kind = kind;
    const panel = /** @type {HTMLElement} */ (target.closest?.('.persistence-panel'));
    if (panel) panel.hidden = hidePanel;
}

export function clearRawPreview() {
    state.rawRevealed = false;
    const preview = byId('corruptPayloadPreview');
    const copyButton = byId('copyCorruptPayloadBtn');
    if (preview) {
        preview.textContent = '';
        preview.hidden = true;
    }
    if (copyButton) copyButton.hidden = true;
}

export function renderPersistenceState() {
    state.navigationRegistration?.notify();
    notifyManagerModalState();
    const saleRetry = byId('retrySaleSaveBtn');
    if (saleRetry) saleRetry.hidden = !state.pendingReconciliation;
    const recovery = byId('trancheRecoveryActions');
    const retryLoad = byId('retryTrancheLoadBtn');
    const retrySave = byId('retryTrancheSaveBtn');
    for (const [id, kind, submission, hostId, message] of [
        ['retryTrancheDialogSaveBtn', 'tranche', state.pendingCommit?.modalSubmission, 'trancheFormError', state.persistenceError],
        ['retryCashPostingSaveBtn', 'cash', state.pendingCashPosting?.modalSubmission, 'cashPostingFormError', state.reconciliationError || state.persistenceError]
    ]) {
        const pending = isManagerModalSubmissionCurrent(kind, submission);
        const button = /** @type {HTMLButtonElement} */ (byId(id));
        if (button) button.hidden = !pending;
        if (pending && message) {
            const host = byId(hostId);
            if (host) { host.textContent = message; host.hidden = false; }
        }
    }
    const isCorrupt = state.loadStatus === 'corrupt';
    const isUnavailable = state.loadStatus === 'unavailable';

    if (recovery) recovery.hidden = !isCorrupt;
    if (retryLoad) retryLoad.hidden = !isUnavailable;
    if (retrySave) retrySave.hidden = !state.pendingCommit
        && !state.pendingProfileValues
        && !state.pendingReconciliation
        && !state.pendingCashPosting;
    setManagerControlsBlocked(processingIsBlocked());

    if (state.commitInFlight || state.profileCommitInFlight || state.cashPostingInFlight) {
        setPersistenceStatus('Änderung wird dauerhaft gespeichert …', 'pending');
        return;
    }
    if (state.persistenceError) {
        setPersistenceStatus(state.persistenceError, 'error');
        return;
    }
    if (state.profileSaveTimer !== null) {
        setPersistenceStatus('Profiländerung wartet auf automatisches Speichern …', 'pending');
        return;
    }
    if (state.taxMigrationWarning) {
        setPersistenceStatus(state.taxMigrationWarning, 'pending');
        return;
    }
    if (state.persistenceMessage) {
        setPersistenceStatus(state.persistenceMessage, 'ok');
        return;
    }
    if (isCorrupt) {
        setPersistenceStatus(
            'Die gespeicherten Tranchen sind beschädigt. Der Rohbestand bleibt unverändert; Bearbeitung ist bis zur bewussten Wiederherstellung blockiert.',
            'error'
        );
        return;
    }
    if (isUnavailable) {
        setPersistenceStatus(
            'Der Speicher ist momentan nicht erreichbar. Der letzte bestätigte Stand bleibt sichtbar; bitte erneut versuchen.',
            'error'
        );
        return;
    }
    setPersistenceStatus(
        state.loadStatus === 'valid'
            ? 'Tranchenbestand dauerhaft geladen.'
            : 'Für dieses Profil sind keine Tranchen gespeichert.',
        'ok',
        { hidePanel: true }
    );
}
