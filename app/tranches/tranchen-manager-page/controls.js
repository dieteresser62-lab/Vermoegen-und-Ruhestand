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
        || Boolean(state.pendingCashPosting)
        || byId('managerProfileRecovery')?.hidden === false
        || state.loadStatus === 'corrupt'
        || state.loadStatus === 'unavailable';
}

/** VN-3 (Gemini Befund 5, Codex F02): Sperrt nur das automatische Speichern eines Formulars (Personendaten, Haushalt & Plan, Geplante
 * Ausgaben, Partnerschaft und Todesfall) die Seite, bleiben die Eingabefelder aller Formulare bedienbar – das Feld in Bearbeitung und
 * das Ziel eines Tab-Wechsels. Ihre Änderungen warten, bis das Speichern endet. Knöpfe bleiben gesperrt. */
export function onlyAutosaveBlocks() {
    const autosave = state.profileCommitInFlight || state.profileEditingField !== null || state.householdPlan?.read().writing
        || state.plannedExpenses?.read().writing || state.partnership?.read().writing;
    return Boolean(autosave) && !(state.personManagementPending || window?.__personMigrationDeferred || state.commitInFlight || state.cashPostingInFlight
        || PersistenceFacade.hasSyncWriteBlocks?.() || state.pendingCommit || state.pendingCashPosting || byId('managerProfileRecovery')?.hidden === false
        || state.loadStatus === 'corrupt' || state.loadStatus === 'unavailable');
}
/** Sperre für Eingabefelder (nicht Knöpfe): wie {@link processingIsBlocked}, außer während eines Autosaves. */
export const managerFieldsBlocked = () => processingIsBlocked() && !onlyAutosaveBlocks();

export function setManagerControlsBlocked(blocked) {
    const fieldsBlocked = blocked && !onlyAutosaveBlocks();
    state.partnership?.syncBlocked(blocked, fieldsBlocked);
    // DS-1 Punkt 11: Das gerade bearbeitete Feld behält Fokus und Text während einer kurzen Sperre.
    /** @type {NodeListOf<HTMLInputElement | HTMLButtonElement>} */ (byId('tranchenTable')?.querySelectorAll?.('.pv-home-table input, .pv-home-table button'))?.forEach?.(element => { element.disabled = blocked && !(element.tagName === 'INPUT' && (document.activeElement === element || !fieldsBlocked)); });
    state.householdPlan?.syncBlocked(fieldsBlocked);
    state.plannedExpenses?.syncBlocked(fieldsBlocked);
    if (state.navigationLifecycle?.isBlocked()) { state.householdPlan?.pause(); state.plannedExpenses?.pause(); }
    else {
        state.householdPlan?.resume(); state.plannedExpenses?.resume();
        // VN-3: Änderungen, die während eines anderen Speicherns eingingen, speichern jetzt (Partnerschaft erst nach dem Verlassen des Felds).
        if (!blocked) { state.partnership?.resume?.(); state.resumeProfileSave?.(); }
    }
    const retryBlocked = Boolean(state.navigationLifecycle?.isBlocked()
        || state.commitInFlight || state.profileCommitInFlight || state.cashPostingInFlight
        || byId('managerProfileRecovery')?.hidden === false);
    for (const id of ['retryTrancheSaveBtn', 'retryTrancheDialogSaveBtn', 'retryCashPostingSaveBtn']) {
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
        'depotAddHomeBtn',
        'managePeopleBtn',
        'managerPersonName',
        'managerPersonCreateBtn',
        'managerPersonRenameBtn',
        'managerPersonRenameCancelBtn',
        'updatePricesBtn',
        'cashPostingSubmitBtn',
        ...RECONCILIATION_INPUT_IDS,
        ...PROFILE_INPUT_IDS
    ].forEach(id => {
        const element = /** @type {HTMLInputElement | HTMLSelectElement | HTMLButtonElement} */ (byId(id));
        if (element) {
            // Das gerade bearbeitete Profilfeld behält Fokus und Text während
            // seines Autosaves. Weitere Eingaben laufen über die vorhandene Queue.
            // VN-3 (Gemini Befund 5): gilt für Text-, Datums- und Auswahlfelder ebenso; während eines Autosaves bleiben alle Felder bedienbar.
            const editingProfileField = PROFILE_INPUT_IDS.includes(id) && document.activeElement === element
                && (state.profileEditingField === element || isEditableDecimalInput(element) || id === 'profileGeburtsdatum');
            const field = element.tagName !== 'BUTTON' && (PROFILE_INPUT_IDS.includes(id) || RECONCILIATION_INPUT_IDS.includes(id));
            element.disabled = blocked && !editingProfileField && !(field && !fieldsBlocked);
        }
    });
    /** @type {NodeListOf<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>} */ (byId('managerIncome')?.querySelectorAll?.('input, select, button'))?.forEach?.(element => {
        // VN-3: Das fokussierte Element wird nie gesperrt (sonst fällt der Fokus auf BODY); Wahlknöpfe wie „wie Inflation“ zählen als Feld.
        const field = element.tagName !== 'BUTTON' || element.hasAttribute('data-person-segment-field');
        element.disabled = element.hasAttribute('data-editor-locked') || blocked && document.activeElement !== element && !(field && !fieldsBlocked);
    });
    /** @type {NodeListOf<HTMLButtonElement>} */ (byId('reconciliationCashStatuses')?.querySelectorAll?.('[data-cash-action]'))?.forEach?.(element => {
        element.disabled = blocked;
    });
    /** @type {NodeListOf<HTMLButtonElement>} */ (byId('tranchenTable')?.querySelectorAll?.('[data-history-toggle], [data-action="reload-prices"]'))?.forEach?.(element => { element.disabled = blocked; });
    /** @type {NodeListOf<HTMLButtonElement>} */ (byId('managerHousehold')?.querySelectorAll?.('[data-manager-people]'))?.forEach?.(element => { element.disabled = blocked; });
    /** @type {NodeListOf<HTMLButtonElement>} */ (byId('managerHousehold')?.querySelectorAll?.('[data-history-recovery]'))?.forEach?.(element => {
        // Belegbedingte Sperren bleiben nach Freigabe erhalten.
        element.disabled = blocked || element.dataset.historyRecoveryBlocked === 'true';
    });
    for (const host of ['managerSectionNav', 'managerHousehold']) /** @type {NodeListOf<HTMLButtonElement>} */ (byId(host)?.querySelectorAll?.('[data-manager-profile], [data-manager-view]'))?.forEach?.(button => { button.disabled = managerSelectionIsBlocked(); });
    syncManagerPeopleControls(document, blocked);
    syncManagerProfileControls(document);
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
