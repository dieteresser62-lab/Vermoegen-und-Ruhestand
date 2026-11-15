// @ts-check
import { processingIsBlocked } from './controls.js';
import { state, PROFILE_INPUT_IDS } from './state.js';
import { renderReconciliationState, refreshReconciliationCashStatuses } from './reconciliation-view.js';
import { captureCashPeople } from '../../profile/profile-cash-update.js';
import { openCashPostingModal, showCashPostingFormError, readCashPostingForm, captureManagerModalSubmission } from '../tranchen-manager-modal.js';
import { PROFILE_CASH_HISTORY_KEY } from '../../profile/profile-wealth-history.js';
import { deriveCashCorrectionActionId, deriveCashConfirmationActionId, commitCashPostingCorrection, commitCashPostingConfirmation, TrancheReconciliationError, previewCashPostingCorrection, previewCashPostingConfirmation } from '../tranche-reconciliation.js';
import { managerInputSignature, readStoredValue, finishManagerDecimalSubmission } from './helpers.js';
import { runManagerOperation } from './history.js';
import { PROFILE_STORAGE_KEYS } from '../../profile/profile-state.js';
import { renderPersistenceState } from './persistence-status.js';
import { applyProfileAssetValuesToDom, loadProfileAssetValues } from '../../profile/profile-asset-values.js';
import { render } from './rendering.js';
import { appNow } from '../../shared/app-clock.js';

export function openCashStatusWorkflow(targetActionId, mode, opener = null) {
    if (processingIsBlocked()) return false;
    const status = state.reconciliationCashStatuses.find(item => item.targetActionId === targetActionId);
    if (!status) {
        state.reconciliationError = 'Diesen Verkauf gibt es nicht mehr in der Liste. Bitte lade die Seite neu.';
        renderReconciliationState();
        return false;
    }
    const correctionMode = mode === 'correct';
    if ((correctionMode && !status.canCorrect) || (!correctionMode && !status.canConfirm)) {
        state.reconciliationError = 'Der Stand dieses Verkaufs hat sich geändert. Bitte lade die Seite neu.';
        renderReconciliationState();
        return false;
    }
    const nextRevision = correctionMode ? status.correctionRevision + 1 : null;
    const cashSource = captureCashPeople({ ids: [state.profileId], activeId: state.profileId })[0];
    return openCashPostingModal({
        mode: correctionMode ? 'correct' : 'confirm',
        targetActionId: status.targetActionId,
        executedAt: status.executedAt,
        trancheName: state.confirmedTranches.find(lot => lot.trancheId === status.trancheId)?.name || '',
        confirmedNetProceedsEur: status.confirmedNetProceedsEur,
        historicalAuditBalanceEur: status.cashBalanceAfterPostingEur,
        cashBalanceAfterPostingEur: cashSource.value,
        currentCashError: cashSource.error,
        expectedCashRecords: {
            profile_tagesgeld: cashSource.cashRaw,
            [PROFILE_CASH_HISTORY_KEY]: cashSource.historyRaw
        },
        nextRevision,
        correctsActionId: correctionMode ? status.effectiveActionId : null,
        nextActionId: correctionMode
            ? deriveCashCorrectionActionId(status.targetActionId, nextRevision)
            : deriveCashConfirmationActionId(status.targetActionId)
    }, document, opener);
}

/** @param pending
 * @param {{navigationOperation?: import('../../../typcheck/runtime-contracts.js').NavigationOperation}} [options]
 */
export async function executeCashPosting(pending, { navigationOperation } = {}) {
    if (!pending || state.cashPostingInFlight || state.commitInFlight || state.profileCommitInFlight) return false;
    if (state.profileSaveTimer !== null || state.pendingProfileValues || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline) {
        showCashPostingFormError('Bitte zuerst die übrigen Profiländerungen dauerhaft speichern oder erneut versuchen.', 'cashPostingBalance');
        return false;
    }
    if (!navigationOperation) return runManagerOperation(operation => executeCashPosting(pending, { navigationOperation: operation }));

    const previousRegistryRaw = readStoredValue(PROFILE_STORAGE_KEYS.registry);
    let succeeded = false;
    state.cashPostingInFlight = true;
    state.persistenceMessage = '';
    state.persistenceError = '';
    state.reconciliationError = '';
    state.reconciliationStatus = '';
    renderPersistenceState();
    renderReconciliationState();
    try {
        const result = pending.mode === 'correct'
            ? await commitCashPostingCorrection(pending.request, { navigationOperation })
            : await commitCashPostingConfirmation(pending.request, { navigationOperation });
        state.pendingCashPosting = null;
        applyProfileAssetValuesToDom(loadProfileAssetValues());
        state.profileBaseline = managerInputSignature(PROFILE_INPUT_IDS);
        state.registryDisplayRaw = undefined;
        state.reconciliationStatus = result.status === 'duplicate'
            ? 'Genau diese Angabe war schon gespeichert. Es hat sich nichts geändert.'
            : result.cashRecordsChanged
                ? pending.mode === 'correct'
                    ? 'Neuer Tagesgeld-Stand übernommen und Korrektur gespeichert. Verkauf und frühere Angaben bleiben unverändert.'
                    : 'Neuer Tagesgeld-Stand übernommen und Gutschrift bestätigt.'
                : pending.mode === 'correct'
                    ? 'Korrektur gespeichert, der Kontostand war schon richtig. Verkauf und frühere Angaben bleiben unverändert.'
                    : 'Gutschrift bestätigt, der Kontostand war schon richtig.';
        state.persistenceMessage = result.status === 'duplicate'
            ? 'Nichts geändert: Genau diese Angabe war schon gespeichert.'
            : result.cashRecordsChanged
                ? 'Neuer Tagesgeld-Stand und Bestätigung dauerhaft gespeichert.'
                : 'Bestätigung dauerhaft gespeichert.';
        refreshReconciliationCashStatuses();
        succeeded = true;
        return true;
    } catch (error) {
        state.pendingCashPosting = error?.code === 'RECONCILIATION_PERSISTENCE_FAILED' && error.retryable ? pending : null;
        if (error?.code === 'RECONCILIATION_PERSISTENCE_FAILED') state.registryDisplayRaw = previousRegistryRaw;
        state.reconciliationError = error instanceof TrancheReconciliationError
            ? `${error.message}${error.retryable ? ' Retry ist möglich.' : ''}`
            : 'Die Gutschrift konnte nicht geprüft oder gespeichert werden. Bitte öffne den Dialog neu.';
        state.persistenceError = error?.code === 'RECONCILIATION_CASH_SOURCE_INVALID'
            ? '' : 'Die Gutschrift ist nicht gespeichert. Der letzte bestätigte Stand bleibt sichtbar.';
        showCashPostingFormError(state.reconciliationError, 'cashPostingBalance');
        return false;
    } finally {
        state.cashPostingInFlight = false;
        render();
        renderPersistenceState();
        if (succeeded) finishManagerDecimalSubmission('cash', pending.modalSubmission, navigationOperation);
    }
}

export async function submitCashPosting(event) {
    event?.preventDefault?.();
    if (processingIsBlocked()) return false;
    const formValue = readCashPostingForm();
    if (!formValue) return false;
    const registryRaw = readStoredValue(PROFILE_STORAGE_KEYS.registry);
    try {
        const preview = formValue.mode === 'correct'
            ? previewCashPostingCorrection({
                profileId: state.profileId,
                targetActionId: formValue.targetActionId,
                cashBalanceAfterPostingEur: formValue.cashBalanceAfterPostingEur,
                correctionReason: formValue.correctionReason,
                correctionRevision: formValue.nextRevision,
                correctionActionId: formValue.nextActionId,
                actionId: formValue.nextActionId,
                correctsActionId: formValue.correctsActionId,
                correctedAt: appNow().toISOString(),
                registry: registryRaw
            })
            : previewCashPostingConfirmation({
                profileId: state.profileId,
                targetActionId: formValue.targetActionId,
                cashBalanceAfterPostingEur: formValue.cashBalanceAfterPostingEur,
                confirmedAt: appNow().toISOString(),
                registry: registryRaw
            });
        const pending = {
            modalSubmission: captureManagerModalSubmission('cash'),
            mode: formValue.mode,
            preview,
            previousCashBalance: preview.cashStatus?.cashBalanceAfterPostingEur ?? null,
            request: {
                ...preview.auditRecord,
                profileId: state.profileId,
                expectedCashRecords: formValue.expectedCashRecords,
                expectedRegistryRaw: registryRaw
            }
        };
        const accepted = await executeCashPosting(pending);
        return accepted;
    } catch (error) {
        const field = error?.field === 'correctionReason' ? 'cashPostingReason' : 'cashPostingBalance';
        showCashPostingFormError(
            error instanceof TrancheReconciliationError
                ? error.message
                : 'Die Gutschrift konnte nicht geprüft werden.',
            field
        );
        return false;
    }
}
