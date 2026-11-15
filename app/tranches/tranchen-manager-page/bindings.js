// @ts-check
import { bindAssetStrategyWarnings } from '../../shared/asset-strategy-warnings.js';
import { processingIsBlocked } from './controls.js';
import { flushManagerHouseholdPlan, managerInputSignature, byId } from './helpers.js';
import { state, PROFILE_INPUT_IDS } from './state.js';
import { saveProfileValues, reloadAfterHouseholdWrite } from './profile-values.js';
import { readProfileAssetValuesFromDom, applyProfileAssetValuesToDom, loadProfileAssetValues } from '../../profile/profile-asset-values.js';
import { enableAssetStrategy } from '../../profile/asset-strategy.js';
import { renderPersistenceState } from './persistence-status.js';
import { render } from './rendering.js';
import { bindManagerPersonCards } from '../tranchen-manager-person-cards.js';
import { bindDecimalInputDisplay } from '../tranchen-manager-decimal-input.js';
import { bindInfoPopovers } from '../../shared/designsystem-info-popover.js';
import { setManagerModalWriteStateReader, bindTrancheModalLifecycle, bindCashPostingModalLifecycle, closeTrancheModal, cancelTrancheDetails } from '../tranchen-manager-modal.js';
import { bindManagerProfileSwitch, bindManagerProfileControls, bindManagerPeopleDialog } from '../tranchen-manager-profiles.js';
import { selectManagerView, openManagerOverviewTarget, openManagerSaleFlow } from './views.js';
import { bindManagerCareValues } from '../tranchen-manager-care-values.js';
import { bindHistoryRecoveryUI } from '../tranchen-history-ui.js';
import { repairManagerHistory, reloadManagerPrices } from './history.js';
import { addTranche, saveTranche, editTranche, bindTrancheDetailControls } from './tranches.js';
import { manageManagerPerson } from './people.js';
import { isSaleFlowOpen, saleFlowClosed } from '../sale-flow-dialog.js';
import { isBuyFlowOpen, buyFlowClosed } from '../buy-flow-dialog.js';
import { openPendingDebits } from '../buy-debit-dialog.js';
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
    bindManagerPeopleDialog(document, { execute: manageManagerPerson, activeId: () => state.profileId, blocked: processingIsBlocked });
    // FR-79 Punkt 8: „Verkauf eintragen“ öffnet den geführten Verkauf ohne Planbezug (Tranche in Klartext → Abrechnung → Gutschrift).
    byId('depotOpenSaleEntryBtn')?.addEventListener('click', event => {
        if (processingIsBlocked()) return;
        openManagerSaleFlow(null, /** @type {HTMLElement|null} */ (event.currentTarget));
    });
    byId('updatePricesBtn')?.addEventListener('click', () => updatePrices());
    byId('closeTrancheModalBtn')?.addEventListener('click', () => { if (!processingIsBlocked()) cancelTrancheDetails(); });
    byId('trancheForm')?.addEventListener('submit', event => saveTranche(event));
    bindTrancheDetailControls();
    byId('revealCorruptPayloadBtn')?.addEventListener('click', revealCorruptPayload);
    byId('copyCorruptPayloadBtn')?.addEventListener('click', () => copyCorruptPayload());
    byId('resetCorruptPayloadBtn')?.addEventListener('click', () => resetCorruptPayload());
    byId('retryTrancheLoadBtn')?.addEventListener('click', retryLoad);
    byId('retryTrancheSaveBtn')?.addEventListener('click', () => retryPendingCommit());
    byId('retryTrancheDialogSaveBtn')?.addEventListener('click', () => retryPendingCommit());
    byId('retryCashPostingSaveBtn')?.addEventListener('click', () => retryPendingCommit());
    byId('cashPostingForm')?.addEventListener('submit', event => submitCashPosting(event));
    byId('reconciliationCashStatuses')?.addEventListener('click', event => {
        // VK-2b P2-2: offene Abbuchung eines Kaufs (mit oder ohne Plan) bestätigen.
        const debit = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest?.('[data-buy-debit-open]'));
        if (debit && state.profileId) {
            let changed = false;
            const handle = openPendingDebits({ doc: document, ids: [state.profileId], opener: debit, onChanged: () => { changed = true; } });
            void handle?.closed.then(() => {
                if (changed) reloadAfterHouseholdWrite();
            });
            return;
        }
        const target = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest?.('[data-cash-action]'));
        if (!target) return;
        openCashStatusWorkflow(target.dataset.targetActionId, target.dataset.cashAction, target);
    });
    byId('tranchenTable')?.addEventListener('click', event => {
        if (processingIsBlocked()) return;
        const target = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest('[data-action]'));
        if (!target) return;
        const index = state.tranchen.findIndex(tranche => tranche.trancheId === target.dataset.trancheId);
        if (index < 0) return;
        if (target.dataset.action === 'edit-tranche') editTranche(index, target);
        if (target.dataset.action === 'reload-prices') void reloadManagerPrices(state.tranchen[index], target);
    });

    if (typeof document.addEventListener === 'function') {
        let wasHidden = false, deferred = false;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                wasHidden = true;
                return;
            }
            if (wasHidden && document.visibilityState === 'visible') {
                wasHidden = false;
                const refresh = () => void getPageNavigationGuard(document).reload({
                    flush: () => PersistenceFacade.flush(), reload: () => window?.location?.reload?.()
                }).catch(() => {
                    state.persistenceError = 'Der Profilrefresh konnte nicht sicher abgeschlossen werden. Bitte erneut versuchen.';
                    renderPersistenceState();
                });
                // FR-79 (VKR Abschnitt 3): kein Auto-Reload, solange der geführte Verkauf offen ist; Gutachten VK-1 P3-5: nach dem Schließen nachholen.
                if (isSaleFlowOpen(document) || isBuyFlowOpen(document)) {
                    if (!deferred) { deferred = true; void Promise.all([saleFlowClosed(document), buyFlowClosed(document)]).then(() => { deferred = false; refresh(); }); }
                    return;
                }
                refresh();
            }
        });
    }
}

