// @ts-check
import { getActiveProfileId, getCurrentProfileId, getProfileRecoveryFromError, getLastProfileBootstrapResult } from '../../profile/profile-storage.js';
import { state, RECONCILIATION_INPUT_IDS, PROFILE_INPUT_IDS } from './state.js';
import { loadTranchesFromStorage } from '../tranchen-manager-state.js';
import { clearReconciliationPreview } from './reconciliation.js';
import { byId, managerInputSignature, flushManagerHouseholdPlan } from './helpers.js';
import { applyLoadResult } from './recovery.js';
import { applyProfileAssetValuesToDom, loadProfileAssetValues, readProfileAssetValuesFromDom } from '../../profile/profile-asset-values.js';
import { updateActiveProfileLabel, renderDepotHistory, render } from './rendering.js';
import { getPageNavigationGuard } from '../../shared/navigation-guard-dialog.js';
import { createNavigationOperationLifecycle } from '../../shared/navigation-guard.js';
import { setManagerControlsBlocked, processingIsBlocked, managerSelectionIsBlocked } from './controls.js';
import { flushManagerCashInput, saveProfileValues, bindProfileValueInputs } from './profile-values.js';
import { bindManagerHistoryStartUI, bindTrancheHistoryUI } from '../tranchen-history-ui.js';
import { saveManagerHistoryStart } from './history.js';
import { bindManagerWealthCapture } from '../tranchen-history-wealth-capture.js';
import { refreshManagerProfiles } from '../tranchen-manager-profiles.js';
import { bindControls } from './bindings.js';
import { createManagerHouseholdPlan } from '../tranchen-manager-household-plan.js';
import { renderPersistenceState } from './persistence-status.js';
import { createManagerPlannedExpenses } from '../tranchen-manager-planned-expenses.js';
import { bindManagerPersonCards } from '../tranchen-manager-person-cards.js';
import { observeSelectionText } from '../../shared/designsystem-selection-text.js';
import { initializeProfilePage } from '../../profile/profile-navigation.js';
import { showManagerProfileRecovery } from './people.js';
import { showPersonDataStatus, readHouseholdPersonStatus } from '../../shared/person-data-status.js';
import { initializeHouseholdPlanPage } from '../../profile/household-plan-dialog.js';
import { resolveManagerTarget, openManagerOverviewTarget, selectManagerView } from './views.js';
import { loadProfileRegistry } from '../../profile/profile-registry.js';
import { renderManagerView } from '../tranchen-manager-renderer.js';

export function resolveActiveProfileId(explicitProfileId) {
    if (explicitProfileId !== undefined) return explicitProfileId || null;
    try {
        return getActiveProfileId() || getCurrentProfileId() || null;
    } catch {
        return state.profileId;
    }
}

export function resetRuntimeState(profileId) {
    if (state.profileSaveTimer !== null) clearTimeout(state.profileSaveTimer);
    state.quoteBatchController?.abort();
    state.quoteBatchId += 1;
    state.historyStartDraft = null;
    state.tranchen = [];
    state.confirmedTranches = [];
    state.confirmedRaw = null;
    state.corruptRaw = null;
    state.loadStatus = 'empty';
    state.editingIndex = -1;
    state.commitInFlight = false;
    state.pendingCommit = null;
    state.profileCommitInFlight = false;
    state.profileEditingField = null;
    state.pendingProfileValues = null;
    state.profileSaveTimer = null;
    state.quoteBatchController = null;
    state.quoteBatchPromise = null;
    state.persistenceMessage = '';
    state.persistenceError = '';
    state.taxMigrationWarning = '';
    state.rawRevealed = false;
    state.reconciliationPreview = null;
    state.pendingReconciliation = null;
    state.pendingCashPosting = null;
    state.reconciliationStatus = '';
    state.reconciliationError = '';
    state.reconciliationCashStatuses = [];
    state.cashStatusError = '';
    state.cashPostingInFlight = false;
    state.profileId = profileId;
}

export function initTranchenManagerPage(options = {}) {
    const profileId = resolveActiveProfileId(options.profileId);
    const documentChanged = state.boundDocument !== document;
    const profileChanged = state.profileId !== profileId;
    state.loader = options.loader || loadTranchesFromStorage;

    if (documentChanged || profileChanged) {
        state.historyRecoveryMessage = '';
        if (documentChanged) state.historyUI = null;
        resetRuntimeState(profileId);
        if (profileChanged) clearReconciliationPreview({ resetForm: true });
        const quoteStatus = byId('priceUpdateStatus');
        if (quoteStatus) quoteStatus.textContent = '';
    }

    if (profileChanged) state.immobilien?.discard();
    const result = state.loader();
    applyLoadResult(result);

    if (result?.status !== 'unavailable') {
        try {
            applyProfileAssetValuesToDom(loadProfileAssetValues());
            if (byId('profileGeschlecht')) delete byId('profileGeschlecht').dataset.genderConfirmed;
        } catch {
            state.persistenceError = 'Profilwerte konnten nicht aus dem Speicher gelesen werden.';
        }
    }
    updateActiveProfileLabel(profileId);

    state.reconciliationBaseline = managerInputSignature(RECONCILIATION_INPUT_IDS);
    state.profileBaseline = managerInputSignature(PROFILE_INPUT_IDS);
    if (documentChanged) {
        state.householdPlan?.dispose(); state.householdPlan = null;
        state.plannedExpenses?.dispose(); state.plannedExpenses = null;
        state.navigationRegistration?.unregister();
        state.navigationControlSubscription?.();
        state.cashBeforeLeaveSubscription?.();
        const guard = getPageNavigationGuard(document);
        state.navigationLifecycle = createNavigationOperationLifecycle({ guard, message: 'Manager schreibt – bitte warten.' });
        state.navigationControlSubscription = guard.subscribe(() => setManagerControlsBlocked(processingIsBlocked()));
        state.cashBeforeLeaveSubscription = guard.registerBeforeLeave(flushManagerCashInput);
        let lastInputs = null, revision = 0;
        state.navigationRegistration = guard.register('manager-retry-inputs', { read: () => {
            const inputs = JSON.stringify([managerInputSignature(RECONCILIATION_INPUT_IDS), managerInputSignature(PROFILE_INPUT_IDS),
                state.pendingCommit?.tranches, state.pendingReconciliation?.action, state.pendingCashPosting?.request,
                state.pendingProfileValues, state.reconciliationPreview?.action, state.profileSaveTimer !== null, state.historyStartDraft, state.immobilien?.read?.(), state.partnership?.read(), state.householdPlan?.read(), state.plannedExpenses?.read()]);
            if (inputs !== lastInputs) { lastInputs = inputs; revision++; }
            return {
                revision,
                dirty: Boolean(state.pendingCommit || state.pendingReconciliation || state.pendingCashPosting || state.pendingProfileValues || state.profileSaveTimer !== null
                    || state.immobilien?.read?.().dirty || state.partnership?.read().dirty || state.householdPlan?.read().dirty || state.plannedExpenses?.read().dirty
                    || state.reconciliationPreview
                    || state.historyStartDraft !== null
                    || managerInputSignature(RECONCILIATION_INPUT_IDS) !== state.reconciliationBaseline
                    || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline),
                message: 'Noch nicht bestätigte Manager-Eingaben und Wiederholungsaufträge gehen verloren – trotzdem wechseln?'
            };
        } });
        bindManagerHistoryStartUI(document, { save: () => saveManagerHistoryStart(), change: value => {
            state.historyStartDraft = value;
            state.navigationRegistration?.notify();
        } });
        if (byId('managerCaptureWealthBtn')) bindManagerWealthCapture(document, { refresh: () => refreshManagerProfiles(document, state.profileId),
            blocked: () => processingIsBlocked() || managerSelectionIsBlocked(),
            beforeCapture: async () => {
                if (!await flushManagerHouseholdPlan()) return false;
                const values = readProfileAssetValuesFromDom();
                if (state.profileSaveTimer !== null) clearTimeout(state.profileSaveTimer);
                state.profileSaveTimer = null;
                if (state.pendingProfileValues || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline) {
                    if (!await saveProfileValues(state.pendingProfileValues || values)) return false;
                }
                return true;
            } });
        bindProfileValueInputs();
        bindControls();
        state.historyUI = bindTrancheHistoryUI(document, { render: renderDepotHistory, blocked: processingIsBlocked });
        state.boundDocument = document;
    }

    if (byId('managerHouseholdPlan')) {
        if (!state.householdPlan) state.householdPlan = createManagerHouseholdPlan({ doc: document,
            getProfileId: () => state.profileId, blocked: processingIsBlocked,
            notify: () => { state.navigationRegistration?.notify(); state.plannedExpenses?.refresh(); renderDepotHistory(); },
            runOperation: async execute => {
                try { return await state.navigationLifecycle.run({}, execute); }
                finally { renderPersistenceState(); }
            } });
        else if (profileChanged) { state.householdPlan.discard(); state.householdPlan.refresh(); }
        else state.householdPlan.refresh();
    }
    if (byId('managerPlannedExpenses')) {
        if (!state.plannedExpenses) state.plannedExpenses = createManagerPlannedExpenses({ doc: document,
            getProfileId: () => state.profileId, blocked: processingIsBlocked,
            notify: () => state.navigationRegistration?.notify(),
            runOperation: async execute => {
                try { return await state.navigationLifecycle.run({}, execute); }
                finally { renderPersistenceState(); }
            } });
        else if (profileChanged) { state.plannedExpenses.discard(); state.plannedExpenses.refresh(); }
        else state.plannedExpenses.refresh();
    }
    render();
    renderPersistenceState();
    bindManagerPersonCards(document, () => state.profileId).sync();
    observeSelectionText(document.body);
    return result;
}

/** Recovery wird vor jeder erfolgreichen Identitätsbereitschaft angeschlossen. */
export async function startTranchenManagerPage() {
    let initialized;
    try { initialized = await initializeProfilePage(); }
    catch (error) {
        showManagerProfileRecovery(getProfileRecoveryFromError(error) || { status: 'unavailable', canReset: false, message: 'Profilstart technisch fehlgeschlagen.' });
        return false;
    }
    if (window.__personMigrationDeferred) { showPersonDataStatus(readHouseholdPersonStatus()); setManagerControlsBlocked(true); return { status: 'deferred' }; }
    const bootstrap = getLastProfileBootstrapResult();
    if (bootstrap?.action === 'recovery') {
        showManagerProfileRecovery(bootstrap.recovery);
        return false;
    }
    if (!initialized) {
        showManagerProfileRecovery({ status: 'unavailable', canReset: false, message: 'Profilstart technisch fehlgeschlagen.' });
        return false;
    }
    try {
        await initializeHouseholdPlanPage();
        const result = initTranchenManagerPage();
        const ready = result?.status !== 'unavailable';
        const target = resolveManagerTarget(window.location);
        if (target) await openManagerOverviewTarget(window.location, { ready });
        else {
            const profiles = Object.entries(loadProfileRegistry().value?.profiles || {});
            const first = profiles.find(([, profile]) => profile.meta.belongsToHousehold !== false) || profiles[0];
            if (ready && first) {
                if (first[0] === state.profileId) {
                    renderManagerView(document, { kind: 'person', profileId: first[0] });
                    refreshManagerProfiles(document, state.profileId);
                } else await selectManagerView({ kind: 'person', profileId: first[0] });
            }
        }
        if (!state.managerTargetBindings.has(document)) {
            const doc = document;
            window.addEventListener('hashchange', () => {
                if (document === doc && state.boundDocument === doc) void openManagerOverviewTarget(window.location, { ready: state.loadStatus !== 'unavailable' });
            });
            state.managerTargetBindings.add(doc);
        }
        return result;
    }
    catch (error) {
        showManagerProfileRecovery(getProfileRecoveryFromError(error) || {
            status: 'unavailable', canReset: false, message: 'Profildaten konnten nicht geladen werden.'
        });
        return false;
    }
}

// Einmaliger Rückruf für den In-place-Neustart nach Personenaktionen; kein Importkreis.
state.initializePage = initTranchenManagerPage;

export { flushManagerHouseholdPlan, getManagerCashPostingDiagnostics } from './helpers.js';
export { repairManagerHistory, saveManagerHistoryStart } from './history.js';
export { applyManagerBirthDate } from './profile-values.js';
export { describeLegacyTaxMigration } from './recovery.js';
export { manageManagerPerson, switchManagerProfile } from './people.js';
export { selectManagerView, resolveManagerTarget, openManagerOverviewTarget } from './views.js';
