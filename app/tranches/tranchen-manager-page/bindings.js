// @ts-check
import { bindAssetStrategyWarnings } from '../../shared/asset-strategy-warnings.js';
import { processingIsBlocked } from './controls.js';
import { flushManagerHouseholdPlan, managerInputSignature, byId, readStoredValue } from './helpers.js';
import { state, PROFILE_INPUT_IDS, RECONCILIATION_INPUT_IDS } from './state.js';
import { saveProfileValues } from './profile-values.js';
import { readProfileAssetValuesFromDom, applyProfileAssetValuesToDom, loadProfileAssetValues } from '../../profile/profile-asset-values.js';
import { enableAssetStrategy } from '../../profile/asset-strategy.js';
import { renderPersistenceState } from './persistence-status.js';
import { render } from './rendering.js';
import { bindManagerPersonCards } from '../tranchen-manager-person-cards.js';
import { bindDecimalInputDisplay } from '../tranchen-manager-decimal-input.js';
import { bindInfoPopovers } from '../../shared/designsystem-info-popover.js';
import { setManagerModalWriteStateReader, bindTrancheModalLifecycle, bindCashPostingModalLifecycle, closeTrancheModal } from '../tranchen-manager-modal.js';
import { bindManagerProfileSwitch, bindManagerProfileControls, bindManagerPeopleDialog } from '../tranchen-manager-profiles.js';
import { selectManagerView, openManagerOverviewTarget } from './views.js';
import { bindManagerCareValues } from '../tranchen-manager-care-values.js';
import { bindHistoryRecoveryUI } from '../tranchen-history-ui.js';
import { repairManagerHistory, reloadManagerPrices } from './history.js';
import { addTranche, saveTranche, editTranche, deleteTranche } from './tranches.js';
import { bindManagerSaleDialog } from '../tranchen-manager-sale-dialog.js';
import { createReconciliationPreview, clearReconciliationPreview, confirmReconciliation } from './reconciliation.js';
import { manageManagerPerson } from './people.js';
import { renderReconciliationState, syncInitialCashStatusControls } from './reconciliation-view.js';
import { getProfileMeta } from '../../profile/profile-storage.js';
import { PROFILE_STORAGE_KEYS } from '../../profile/profile-state.js';
import { generateTrancheId } from '../tranchen-manager-state.js';
import { updatePrices } from './quotes.js';
import { revealCorruptPayload, copyCorruptPayload, resetCorruptPayload, retryLoad, retryPendingCommit } from './recovery.js';
import { submitCashPosting, openCashStatusWorkflow } from './cash-posting.js';
import { getPageNavigationGuard } from '../../shared/navigation-guard-dialog.js';
import { PersistenceFacade } from '../../shared/persistence-facade.js';

export function bindManagerStrategyWarnings() {
    bindAssetStrategyWarnings({ doc: document, blocked: processingIsBlocked,
        enable: async warning => {
            if (!await flushManagerHouseholdPlan()) throw new Error('Bitte zuerst die Planwerte prüfen.');
            if (state.profileSaveTimer !== null) clearTimeout(state.profileSaveTimer);
            state.profileSaveTimer = null;
            if (state.pendingProfileValues || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline) {
                if (!await saveProfileValues(state.pendingProfileValues || readProfileAssetValuesFromDom())) throw new Error('Bitte zuerst die Personenwerte prüfen.');
            }
            try {
                await state.navigationLifecycle.run({}, navigationOperation => enableAssetStrategy({ ...warning, navigationOperation }));
                applyProfileAssetValuesToDom(loadProfileAssetValues());
                state.profileBaseline = managerInputSignature(PROFILE_INPUT_IDS);
                state.householdPlan?.refresh();
            } finally { renderPersistenceState(); }
        }, refresh: () => { render(); bindManagerPersonCards(document, () => state.profileId).sync(); } });
}

export function bindControls() {
    bindManagerStrategyWarnings();
    bindDecimalInputDisplay(document);
    bindInfoPopovers(document);
    setManagerModalWriteStateReader(() => state.commitInFlight || state.profileCommitInFlight || state.cashPostingInFlight);
    bindTrancheModalLifecycle();
    bindCashPostingModalLifecycle();
    bindManagerProfileSwitch(document, (profileId, opener) => selectManagerView({ kind: opener?.dataset.managerView || (profileId ? 'person' : 'plan'), profileId: profileId || state.profileId, ...(opener?.dataset.managerView === 'history' ? { historyScope: opener.dataset.managerHistoryScope || 'household' } : {}) }, { opener }));
    bindManagerProfileControls(document);
    // PFA-10: Bereich Pflege; „Zur Personenkarte“ springt über das vorhandene Sprungziel zum heutigen Pflegegrad.
    bindManagerCareValues(document, { blocked: processingIsBlocked, openPerson: profileId => openManagerOverviewTarget(
        { hash: '#profileCareGradeToday', search: `?person=${encodeURIComponent(profileId)}` }, { ready: state.loadStatus !== 'unavailable' }) });
    // UR-1: „Haushaltswerte im Reiter Pflege →“ im Pflegeband der Personenkarte nutzt dasselbe Sprungziel wie der Simulator.
    byId('profileCareHouseholdLink')?.addEventListener('click', event => {
        event.preventDefault();
        void openManagerOverviewTarget({ hash: '#pflege', search: '' }, { ready: state.loadStatus !== 'unavailable' });
    });
    bindHistoryRecoveryUI(document, { execute: repairManagerHistory, blocked: processingIsBlocked });
    for (const id of ['depotAddTrancheBtn']) byId(id)?.addEventListener('click', addTranche);
    const saleDialog = bindManagerSaleDialog(document, {
        preview: createReconciliationPreview,
        discard: () => { state.pendingReconciliation = null; clearReconciliationPreview({ resetForm: true }); renderPersistenceState(); }, blocked: processingIsBlocked
    });
    bindManagerPeopleDialog(document, { execute: manageManagerPerson, activeId: () => state.profileId, blocked: processingIsBlocked });
    for (const openerId of ['depotOpenSaleEntryBtn']) byId(openerId)?.addEventListener('click', event => {
        if (processingIsBlocked()) return;
        renderReconciliationState();
        const name = byId('saleProfileName');
        if (name) name.textContent = getProfileMeta(state.profileId)?.name || state.profileId;
        const id = byId('reconcileActionId');
        if (saleDialog && id && !id.value) {
            const registryRaw = readStoredValue(PROFILE_STORAGE_KEYS.registry) || '';
            const baseId = `sale-${generateTrancheId()}`;
            let suffix = 1; id.value = baseId;
            while (registryRaw.includes(JSON.stringify(id.value))) id.value = `${baseId}-${suffix++}`;
            state.reconciliationBaseline = managerInputSignature(RECONCILIATION_INPUT_IDS);
        }
        saleDialog?.open(event.currentTarget || byId(openerId));
    });
    byId('updatePricesBtn')?.addEventListener('click', () => updatePrices());
    byId('closeTrancheModalBtn')?.addEventListener('click', () => closeTrancheModal());
    byId('trancheForm')?.addEventListener('submit', event => saveTranche(event));
    byId('revealCorruptPayloadBtn')?.addEventListener('click', revealCorruptPayload);
    byId('copyCorruptPayloadBtn')?.addEventListener('click', () => copyCorruptPayload());
    byId('resetCorruptPayloadBtn')?.addEventListener('click', () => resetCorruptPayload());
    byId('retryTrancheLoadBtn')?.addEventListener('click', retryLoad);
    byId('retryTrancheSaveBtn')?.addEventListener('click', () => retryPendingCommit());
    byId('retryTrancheDialogSaveBtn')?.addEventListener('click', () => retryPendingCommit());
    byId('retryCashPostingSaveBtn')?.addEventListener('click', () => retryPendingCommit());
    if (!saleDialog) byId('reconciliationForm')?.addEventListener('submit', createReconciliationPreview);
    byId('reconciliationConfirmBtn')?.addEventListener('click', () => confirmReconciliation());
    if (!saleDialog) byId('reconciliationCancelBtn')?.addEventListener('click', () => clearReconciliationPreview());
    byId('retrySaleSaveBtn')?.addEventListener('click', () => retryPendingCommit());
    byId('cashPostingForm')?.addEventListener('submit', event => submitCashPosting(event));
    byId('reconciliationCashStatuses')?.addEventListener('click', event => {
        const target = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest?.('[data-cash-action]'));
        if (!target) return;
        openCashStatusWorkflow(target.dataset.targetActionId, target.dataset.cashAction, target);
    });
    byId('reconcileCashStatus')?.addEventListener('change', syncInitialCashStatusControls);
    RECONCILIATION_INPUT_IDS.forEach(id => {
        for (const event of ['input', 'change']) byId(id)?.addEventListener(event, () => {
            state.navigationRegistration?.notify();
            if (!state.reconciliationPreview || state.commitInFlight) return;
            state.reconciliationPreview = null;
            state.reconciliationStatus = '';
            state.reconciliationError = 'Eingaben wurden nach der Vorschau geändert. Bitte eine neue Vorschau erstellen.';
            renderReconciliationState();
        });
    });
    byId('tranchenTable')?.addEventListener('click', event => {
        if (processingIsBlocked()) return;
        const target = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest('[data-action]'));
        if (!target) return;
        const index = state.tranchen.findIndex(tranche => tranche.trancheId === target.dataset.trancheId);
        if (index < 0) return;
        if (target.dataset.action === 'edit-tranche') editTranche(index, target);
        if (target.dataset.action === 'delete-tranche') void deleteTranche(index);
        if (target.dataset.action === 'reload-prices') void reloadManagerPrices(state.tranchen[index], target);
    });

    if (typeof document.addEventListener === 'function') {
        let wasHidden = false;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                wasHidden = true;
                return;
            }
            if (wasHidden && document.visibilityState === 'visible') {
                wasHidden = false;
                void getPageNavigationGuard(document).reload({
                    flush: () => PersistenceFacade.flush(), reload: () => window?.location?.reload?.()
                }).catch(() => {
                    state.persistenceError = 'Der Profilrefresh konnte nicht sicher abgeschlossen werden. Bitte erneut versuchen.';
                    renderPersistenceState();
                });
            }
        });
    }
}
