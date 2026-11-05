// @ts-check
import { byId, localIsoDate, managerInputSignature, readStoredValue, formatReconciliationNumber } from './helpers.js';
import { readDecimalInput } from '../tranchen-manager-decimal-input.js';
import { state, RECONCILIATION_INPUT_IDS } from './state.js';
import { renderReconciliationState } from './reconciliation-view.js';
import { processingIsBlocked } from './controls.js';
import { appNow } from '../../shared/app-clock.js';
import { previewTrancheReconciliation, TrancheReconciliationError, commitTrancheReconciliation } from '../tranche-reconciliation.js';
import { PROFILE_STORAGE_KEYS } from '../../profile/profile-state.js';
import { runManagerOperation, requestManagerDecision } from './history.js';
import { renderPersistenceState } from './persistence-status.js';
import { closeManagerAuxiliaryDialog } from '../tranchen-manager-modal.js';
import { render } from './rendering.js';

export function readOptionalNumber(id) {
    const raw = byId(id)?.value;
    return raw === '' || raw === null || raw === undefined ? null : readDecimalInput(raw, byId(id));
}

export function readReconciliationActionFromDom(now = () => new Date()) {
    const recommendedShares = readOptionalNumber('reconcileRecommendedShares');
    const recommendedGross = readOptionalNumber('reconcileRecommendedGross');
    const cashStatus = byId('reconcileCashStatus')?.value || 'pending_manual_posting';
    return {
        actionId: byId('reconcileActionId')?.value || '',
        profileId: state.profileId || '',
        trancheId: byId('reconcileTrancheId')?.value || '',
        executedAt: byId('reconcileExecutedAt')?.value || '',
        sharesSold: readOptionalNumber('reconcileSharesSold'),
        grossProceeds: readOptionalNumber('reconcileGrossProceeds'),
        fees: readOptionalNumber('reconcileFees') ?? 0,
        cashStatus,
        ...(cashStatus === 'confirmed_already_reflected'
            ? {
                cashBalanceAfterPostingEur: readOptionalNumber('reconcileInitialCashBalance'),
                cashConfirmedAt: now().toISOString()
            }
            : {}),
        recommendation: recommendedShares === null && recommendedGross === null
            ? null
            : {
                ...(recommendedShares !== null ? { sharesSold: recommendedShares } : {}),
                ...(recommendedGross !== null ? { grossProceeds: recommendedGross } : {})
            }
    };
}

/** @param {{resetForm?: boolean, navigationOperation?: import('../../../typcheck/runtime-contracts.js').NavigationOperation}} [options] */
export function clearReconciliationPreview({ resetForm = false, navigationOperation } = {}) {
    if (!navigationOperation && state.navigationLifecycle?.isBlocked()) return false;
    state.reconciliationPreview = null;
    state.reconciliationError = '';
    if (resetForm) {
        byId('reconciliationForm')?.reset?.();
        const dateInput = byId('reconcileExecutedAt');
        if (dateInput) dateInput.value = localIsoDate();
    }
    renderReconciliationState();
    if (resetForm) state.reconciliationBaseline = managerInputSignature(RECONCILIATION_INPUT_IDS);
    state.navigationRegistration?.notify();
}

export function createReconciliationPreview(event) {
    event?.preventDefault?.();
    if (processingIsBlocked()) return false;
    state.reconciliationStatus = '';
    state.reconciliationError = '';
    try {
        const action = readReconciliationActionFromDom(appNow);
        const preview = previewTrancheReconciliation({
            profileId: state.profileId,
            tranches: state.confirmedTranches,
            action,
            registry: readStoredValue(PROFILE_STORAGE_KEYS.registry)
        });
        state.reconciliationPreview = {
            profileId: state.profileId,
            action,
            expectedTranchesRaw: state.confirmedRaw,
            preview
        };
        state.reconciliationStatus = preview.status === 'duplicate'
            ? 'Action-ID bereits identisch verarbeitet; der Bestand bleibt unverändert.'
            : 'Vorschau erstellt. Prüfen Sie Profil-ID, Tranche-ID und tatsächliche Brokerdaten vor der dauerhaften Bestätigung.';
        renderReconciliationState();
        return true;
    } catch (error) {
        state.reconciliationPreview = null;
        state.reconciliationError = error instanceof TrancheReconciliationError
            ? error.message
            : 'Die Reconcile-Vorschau konnte nicht erstellt werden.';
        renderReconciliationState();
        return false;
    }
}

/** @param pending
 * @param {{requireConfirmation?: boolean, navigationOperation?: import('../../../typcheck/runtime-contracts.js').NavigationOperation}} [options] */
export async function executeReconciliation(pending, { requireConfirmation = true, navigationOperation } = {}) {
    if (!pending || state.commitInFlight || state.cashPostingInFlight || state.profileCommitInFlight) return false;
    if (!navigationOperation) return runManagerOperation(operation => executeReconciliation(pending, { requireConfirmation, navigationOperation: operation }));
    if (requireConfirmation) {
        const cashLine = pending.action.cashStatus === 'confirmed_already_reflected'
            ? `Cashstatus: bereits enthalten; bestätigter Cashstand ${formatReconciliationNumber(pending.action.cashBalanceAfterPostingEur, { currency: true })}.`
            : `Cashstatus: offen; Nettoerlös ${formatReconciliationNumber(pending.preview?.execution?.netProceeds, { currency: true })} muss anschließend manuell nachgeführt werden.`;
        const confirmed = await requestManagerDecision({ title: 'Ausführung anwenden', confirmLabel: 'Ausführung anwenden', opener: document.activeElement,
            description: `Tatsächliche Ausführung ${pending.action.actionId} für Profil ${pending.profileId} und Tranche ${pending.action.trancheId} dauerhaft anwenden? Der reale Bestand wird dabei geändert. ${cashLine} Es erfolgt keine automatische Cashbuchung.`
        }, navigationOperation);
        if (!confirmed) return false;
    }

    const previousRegistryRaw = readStoredValue(PROFILE_STORAGE_KEYS.registry);
    let succeeded = false;
    state.commitInFlight = true;
    state.persistenceMessage = '';
    state.persistenceError = '';
    state.reconciliationError = '';
    state.reconciliationStatus = '';
    renderPersistenceState();
    renderReconciliationState();
    try {
        const result = await commitTrancheReconciliation({
            profileId: pending.profileId,
            action: pending.action,
            expectedTranchesRaw: pending.expectedTranchesRaw
        }, { navigationOperation });
        state.pendingReconciliation = null;
        state.registryDisplayRaw = undefined;
        if (result.status === 'duplicate') {
            state.reconciliationStatus = 'Action-ID war bereits identisch verarbeitet. Es wurde nichts erneut verändert.';
            state.persistenceMessage = 'Keine Bestandsänderung: Ausführung war bereits bestätigt.';
            state.reconciliationPreview = { ...pending, preview: result.preview };
            return true;
        }
        state.tranchen = result.tranches;
        state.confirmedTranches = result.tranches;
        state.confirmedRaw = JSON.stringify(result.tranches);
        state.loadStatus = result.tranches.length > 0 ? 'valid' : 'empty';
        state.reconciliationPreview = null;
        state.reconciliationStatus = pending.action.cashStatus === 'confirmed_already_reflected'
            ? 'Tatsächliche Ausführung und bereits berücksichtigter Cashstand dauerhaft dokumentiert; Realbestand aktualisiert.'
            : 'Tatsächliche Ausführung dauerhaft dokumentiert und Realbestand aktualisiert. Cashbuchung bleibt manuell offen.';
        state.persistenceMessage = 'Reconcile-Commit dauerhaft gespeichert.';
        clearReconciliationPreview({ resetForm: true, navigationOperation });
        succeeded = true;
        return true;
    } catch (error) {
        state.tranchen = state.confirmedTranches;
        state.pendingReconciliation = pending;
        if (error?.code === 'RECONCILIATION_PERSISTENCE_FAILED') state.registryDisplayRaw = previousRegistryRaw;
        state.reconciliationError = error instanceof TrancheReconciliationError
            ? `${error.message}${error.retryable ? ' Retry ist möglich.' : ''}`
            : 'Die Ausführung konnte nicht dauerhaft gespeichert werden. Retry ist möglich.';
        state.persistenceError = 'Reconcile wurde nicht dauerhaft bestätigt. Der letzte bestätigte Bestand bleibt sichtbar.';
        return false;
    } finally {
        state.commitInFlight = false;
        if (succeeded) closeManagerAuxiliaryDialog('sale', document, { confirmed: true, navigationOperation });
        render();
        renderPersistenceState();
    }
}

export function confirmReconciliation() {
    const pending = state.reconciliationPreview;
    if (!pending || pending.preview?.status !== 'ready') return Promise.resolve(false);
    return executeReconciliation(pending);
}
