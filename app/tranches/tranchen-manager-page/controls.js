// @ts-check
import { state, RECONCILIATION_INPUT_IDS, PROFILE_INPUT_IDS } from './state.js';
import { PersistenceFacade } from '../../shared/persistence-facade.js';
import { byId } from './helpers.js';
import { isEditableDecimalInput } from '../tranchen-manager-decimal-input.js';
import { syncManagerPeopleControls, syncManagerProfileControls } from '../tranchen-manager-profiles.js';
import { isCashPostingEditorCompleted, isCashPostingSourceInvalid } from '../tranchen-manager-modal.js';
import { getPageNavigationGuard } from '../../shared/navigation-guard-dialog.js';

export function processingIsBlocked() {
    return state.personManagementPending || Boolean(window?.__personMigrationDeferred) || state.navigationLifecycle?.isBlocked()
        || state.commitInFlight
        || state.cashPostingInFlight
        || state.profileCommitInFlight
        || state.householdPlan?.read().writing || state.plannedExpenses?.read().writing || state.partnership?.read().writing
        || PersistenceFacade.hasSyncWriteBlocks?.()
        || Boolean(state.quoteBatchPromise)
        || Boolean(state.pendingCommit)
        || Boolean(state.pendingReconciliation)
        || Boolean(state.pendingCashPosting)
        || byId('managerProfileRecovery')?.hidden === false
        || state.loadStatus === 'corrupt'
        || state.loadStatus === 'unavailable';
}

export function setManagerControlsBlocked(blocked) {
    state.partnership?.syncBlocked(blocked);
    /** @type {NodeListOf<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>} */ (byId('managerImmobilien')?.querySelectorAll?.('input, button'))?.forEach?.(element => { element.disabled = blocked; });
    state.householdPlan?.syncBlocked(blocked);
    state.plannedExpenses?.syncBlocked(blocked);
    if (state.navigationLifecycle?.isBlocked()) { state.householdPlan?.pause(); state.plannedExpenses?.pause(); }
    else { state.householdPlan?.resume(); state.plannedExpenses?.resume(); }
    const retryBlocked = Boolean(state.navigationLifecycle?.isBlocked()
        || state.commitInFlight || state.profileCommitInFlight || state.cashPostingInFlight
        || byId('managerProfileRecovery')?.hidden === false);
    for (const id of ['retryTrancheSaveBtn', 'retryTrancheDialogSaveBtn', 'retryCashPostingSaveBtn', 'retrySaleSaveBtn']) {
        const button = /** @type {HTMLButtonElement} */ (byId(id));
        if (button) button.disabled = retryBlocked;
    }
    [
        'managerBirthApply',
        'managerHistoryStart',
        'managerHistoryStartConfirm',
        'managerCashEdit',
        'managerCashValue',
        'depotAddTrancheBtn',
        'depotOpenSaleEntryBtn',
        'managePeopleBtn',
        'managerPersonName',
        'managerPersonCreateBtn',
        'managerPersonRenameBtn',
        'managerPersonRenameCancelBtn',
        'saleNextBtn',
        'saleBackBtn',
        'updatePricesBtn',
        'reconciliationPreviewBtn',
        'reconciliationConfirmBtn',
        'reconciliationCancelBtn',
        'cashPostingSubmitBtn',
        ...RECONCILIATION_INPUT_IDS,
        ...PROFILE_INPUT_IDS
    ].forEach(id => {
        const element = /** @type {HTMLInputElement | HTMLSelectElement | HTMLButtonElement} */ (byId(id));
        if (element) {
            // Das gerade bearbeitete Profilfeld behält Fokus und Text während
            // seines Autosaves. Weitere Eingaben laufen über die vorhandene Queue.
            const editingProfileDecimal = state.profileEditingField === element && PROFILE_INPUT_IDS.includes(id)
                && document.activeElement === element && (isEditableDecimalInput(element) || id === 'profileGeburtsdatum');
            element.disabled = blocked && !editingProfileDecimal;
        }
    });
    /** @type {NodeListOf<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>} */ (byId('managerIncome')?.querySelectorAll?.('input, select, button'))?.forEach?.(element => {
        element.disabled = element.hasAttribute('data-editor-locked') || blocked && !(element === state.profileEditingField && document.activeElement === element);
    });
    /** @type {NodeListOf<HTMLButtonElement>} */ (byId('reconciliationCashStatuses')?.querySelectorAll?.('[data-cash-action]'))?.forEach?.(element => {
        element.disabled = blocked;
    });
    /** @type {NodeListOf<HTMLButtonElement>} */ (byId('tranchenTable')?.querySelectorAll?.('[data-history-toggle]'))?.forEach?.(element => { element.disabled = blocked; });
    /** @type {NodeListOf<HTMLButtonElement>} */ (byId('managerHousehold')?.querySelectorAll?.('[data-manager-people]'))?.forEach?.(element => { element.disabled = blocked; });
    /** @type {NodeListOf<HTMLButtonElement>} */ (byId('managerHousehold')?.querySelectorAll?.('[data-history-recovery]'))?.forEach?.(element => {
        // Belegbedingte Sperren bleiben nach Freigabe erhalten.
        element.disabled = blocked || element.dataset.historyRecoveryBlocked === 'true';
    });
    for (const host of ['managerSectionNav', 'managerHousehold']) /** @type {NodeListOf<HTMLButtonElement>} */ (byId(host)?.querySelectorAll?.('[data-manager-profile], [data-manager-view]'))?.forEach?.(button => { button.disabled = managerSelectionIsBlocked(); });
    syncManagerPeopleControls(document, blocked);
    syncManagerProfileControls(document);
    const preview = byId('reconciliationPreviewBtn');
    if (preview) preview.disabled = blocked || state.tranchen.length === 0;
    const confirmButton = byId('reconciliationConfirmBtn');
    if (confirmButton) confirmButton.disabled = blocked || state.reconciliationPreview?.preview?.status !== 'ready';
    const cashCancel = /** @type {HTMLButtonElement} */ (byId('cashPostingCancelBtn'));
    if (cashCancel) cashCancel.disabled = state.cashPostingInFlight;
    const cashSubmit = /** @type {HTMLButtonElement} */ (byId('cashPostingSubmitBtn'));
    if (cashSubmit) cashSubmit.disabled = blocked || isCashPostingEditorCompleted() || isCashPostingSourceInvalid();
}

export function managerSelectionIsBlocked() {
    return state.personManagementPending || Boolean(window?.__personMigrationDeferred)
        || state.commitInFlight || state.cashPostingInFlight || state.profileCommitInFlight
        || state.householdPlan?.read().writing || state.plannedExpenses?.read().writing || state.partnership?.read().writing || PersistenceFacade.hasSyncWriteBlocks?.()
        || byId('managerProfileRecovery')?.hidden === false
        || state.loadStatus === 'corrupt' || state.loadStatus === 'unavailable'
        || getPageNavigationGuard(document).isBusy();
}
