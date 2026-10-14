import { bindManagerWealthCapture } from './tranchen-history-wealth-capture.js';
import { requestPageConfirmation, showPageAlert } from '../shared/page-dialog.js';
import { initializeHouseholdPlanPage } from '../profile/household-plan-dialog.js';
import { createManagerHouseholdPlan } from './tranchen-manager-household-plan.js';

let personManagementPending = false;

import { appNow } from '../shared/app-clock.js';
import { captureCashPeople } from '../profile/profile-cash-update.js';
import { showPersonDataStatus, readHouseholdPersonStatus } from '../shared/person-data-status.js';
import { bindManagerPersonCards } from './tranchen-manager-person-cards.js';
import { personDateInputToIso, validateIsoDate, personAge, personReferenceYear } from '../profile/profile-person-data.js';
import { PERSON_FORM_IDS } from '../profile/profile-asset-values.js';
import { bindHistoryRecoveryUI, bindTrancheHistoryUI, bindManagerHistoryStartUI, readManagerHistoryContext, confirmManagerHistoryStart } from './tranchen-history-ui.js';
import { prepareHistoryRecovery, commitHistoryRecovery } from './tranchen-history-recovery.js';
import { assertHistoryStart } from './tranchen-history-store.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { PROFILE_CASH_HISTORY_KEY, PROFILE_WEALTH_LOTS_KEY, captureWealthLots } from '../profile/profile-wealth-history.js';
import { readDecimalInput, canonicalDecimalInput, bindDecimalInputDisplay, isEditableDecimalInput } from './tranchen-manager-decimal-input.js';
import { parseOverviewTarget } from '../overview/overview-model.js';
import { getManagerView, renderManagerView } from './tranchen-manager-renderer.js';
import { bindInfoPopovers } from '../shared/designsystem-info-popover.js';
// @ts-check
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { syncSelectionText, observeSelectionText } from '../shared/designsystem-selection-text.js';
import { initializeProfilePage } from '../profile/profile-navigation.js';
import { renderSuiteProfile } from '../shared/suite-frame.js';
import { renderProfileRecovery } from '../profile/profile-recovery-ui.js';
import { bindManagerSaleDialog } from './tranchen-manager-sale-dialog.js';
import { applyProfileManagementAction, validateProfileName, confirmProfileDeletion } from '../profile/profile-manager-bindings.js';
import { captureProfileData } from '../profile/profile-live-storage.js';
import { listProfileScopedKeys } from '../profile/profile-key-policy.js';
import { bindManagerProfileSwitch, refreshManagerProfiles, bindManagerPeopleDialog, renderManagerPeople, bindManagerProfileControls, syncManagerProfileControls } from './tranchen-manager-profiles.js';

import {
    getActiveProfileId,
    getCurrentProfileId,
    getProfileMeta,
    saveCurrentProfileFromLocalStorage,
    switchProfile,
    getLastProfileBootstrapResult,
    getProfileRecoveryFromError
} from '../profile/profile-storage.js';
import {
    loadStoredBalanceStateFromData,
    PROFILE_HEALTH_BUCKET_KEY,
    PROFILE_STORAGE_KEYS,
    PROFILE_TRANCHES_KEY,
    PROFILE_VALUE_KEYS
} from '../profile/profile-state.js';
import {
    applyProfileAssetValuesToDom,
    applyProfileRenteStatusToDom,
    loadProfileAssetValues,
    ProfileAssetValuesValidationError,
    readProfileAssetValuesFromDom,
    saveProfileAssetValues,
    validateProfileAssetValues
} from '../profile/profile-asset-values.js';
import {
    generateTrancheId,
    calculateTrancheDerivedValues,
    loadReconciliationRegistryFromStorage,
    loadTranchesFromStorage,
    normalizeTranches,
    saveTranchesToStorage
} from './tranchen-manager-state.js';
import {
    ensureReconciliationCashControls,
    renderReconciliationCashStatuses,
    renderManagerQuoteContext,
    renderTranchenStats,
    renderTranchenTable
} from './tranchen-manager-renderer.js';
import { checkProxyHealth, createBatchQuoteFetcher, resolveTrancheQuote, quoteErrorDetails } from './tranchen-price-service.js';
import {
    closeManagerAuxiliaryDialog,
    confirmManagerModalBaseline,
    setManagerModalWriteStateReader,
    notifyManagerModalState,
    captureManagerModalSubmission,
    isManagerModalSubmissionCurrent,
    finishManagerModalSubmission,
    isCashPostingEditorCompleted,
    isCashPostingSourceInvalid,
    bindTrancheModalLifecycle,
    bindCashPostingModalLifecycle,
    clearTrancheFormError,
    closeTrancheModal,
    closeCashPostingModal,
    formatTrancheValidationError,
    openCreateTrancheModal,
    openEditTrancheModal,
    openCashPostingModal,
    readCashPostingForm,
    readTrancheFromForm,
    showCashPostingFormError,
    showTrancheFormError
} from './tranchen-manager-modal.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import {
    commitCashPostingConfirmation,
    commitCashPostingCorrection,
    commitTrancheReconciliation,
    deriveCashConfirmationActionId,
    deriveCashCorrectionActionId,
    previewCashPostingConfirmation,
    previewCashPostingCorrection,
    previewTrancheReconciliation,
    projectReconciliationCashStatuses,
    TrancheReconciliationError
} from './tranche-reconciliation.js';

const state = {
    householdPlan: null,
    historyUI: null,
    historyStartDraft: null,
    historyRecoveryMessage: '',
    tranchen: [],
    confirmedTranches: [],
    confirmedRaw: null,
    corruptRaw: null,
    loadStatus: 'empty',
    editingIndex: -1,
    commitInFlight: false,
    pendingCommit: null,
    profileCommitInFlight: false,
    profileEditingField: null,
    pendingProfileValues: null,
    profileSaveTimer: null,
    quoteBatchId: 0,
    quoteBatchController: null,
    quoteBatchPromise: null,
    persistenceMessage: '',
    persistenceError: '',
    taxMigrationWarning: '',
    rawRevealed: false,
    reconciliationPreview: null,
    pendingReconciliation: null,
    reconciliationStatus: '',
    reconciliationError: '',
    reconciliationCashStatuses: [],
    cashStatusError: '',
    registryDisplayRaw: undefined,
    cashPostingInFlight: false,
    pendingCashPosting: null,
    profileId: null,
    boundDocument: null,
    navigationLifecycle: null,
    navigationRegistration: null,
    navigationControlSubscription: null,
    cashBeforeLeaveSubscription: null,
    reconciliationBaseline: null,
    profileBaseline: null,
    loader: loadTranchesFromStorage
};

const PROFILE_SAVE_DEBOUNCE_MS = 300;
const QUOTE_BATCH_CONCURRENCY = 3;
const QUOTE_BATCH_TIMEOUT_MS = 12000;

export function getManagerCashPostingDiagnostics() {
    return Object.freeze({ pendingCashPosting: state.pendingCashPosting === null ? null : 'pending' });
}

const RECONCILIATION_INPUT_IDS = [
    'reconcileActionId',
    'reconcileTrancheId',
    'reconcileExecutedAt',
    'reconcileSharesSold',
    'reconcileGrossProceeds',
    'reconcileFees',
    'reconcileRecommendedShares',
    'reconcileRecommendedGross',
    'reconcileCashStatus',
    'reconcileInitialCashBalance'
];

const PROFILE_INPUT_IDS = [
    'profileTagesgeld',
    ...Object.values(PERSON_FORM_IDS),
    'profileRenteMonatlich',
    'profileSonstigeEinkuenfte',
    'profileGoldAktiv',
    'profileGoldZiel',
    'profileGoldFloor',
    'profileGoldBand',
    'profileGoldSteuerfrei',
    'profileHealthBucketEnabled',
    'profileHealthBucketInitialAmount',
    'profileHealthBucketAssetSource',
    'profileHealthBucketTriggerMinGrade',
    'profileHealthBucketTriggerMode',
    'profileHealthBucketCoverageMode',
    'profileHealthBucketReturnMode',
    'profileHealthBucketTargetMode'
];

const PROFILE_ASSET_STORAGE_KEYS = [
    PROFILE_CASH_HISTORY_KEY,
    ...Object.values(PROFILE_VALUE_KEYS),
    PROFILE_HEALTH_BUCKET_KEY
];

const PROFILE_ERROR_DOM_IDS = Object.freeze({
    tagesgeld: 'profileTagesgeld',
    renteMonatlich: 'profileRenteMonatlich',
    sonstigeEinkuenfte: 'profileSonstigeEinkuenfte',
    ...PERSON_FORM_IDS,
    goldAktiv: 'profileGoldAktiv',
    goldZiel: 'profileGoldZiel',
    goldFloor: 'profileGoldFloor',
    goldBand: 'profileGoldBand',
    goldSteuerfrei: 'profileGoldSteuerfrei',
    'healthBucket.enabled': 'profileHealthBucketEnabled',
    'healthBucket.initialAmount': 'profileHealthBucketInitialAmount',
    'healthBucket.assetSource': 'profileHealthBucketAssetSource',
    'healthBucket.triggerMinGrade': 'profileHealthBucketTriggerMinGrade',
    'healthBucket.triggerMode': 'profileHealthBucketTriggerMode',
    'healthBucket.coverageMode': 'profileHealthBucketCoverageMode',
    'healthBucket.returnMode': 'profileHealthBucketReturnMode',
    'healthBucket.targetMode': 'profileHealthBucketTargetMode'
});

function byId(id) {
    return document.getElementById(id);
}

function syncGlobalState() {
    window.tranchen = state.tranchen;
}

function render() {
    const startFocused = document.activeElement?.id === 'managerHistoryStart';
    const count = byId('managerDepotCount');
    if (count) count.textContent = `${state.tranchen.length} Tranchen · sortiert nach Anlageform und Kaufdatum`;
    renderManagerQuoteContext(document, state.tranchen);
    refreshReconciliationCashStatuses();
    renderTranchenStats(byId('stats'), state.tranchen);
    renderDepotHistory();
    renderReconciliationState();
    syncGlobalState();
    refreshManagerProfiles(document, state.profileId);
    bindManagerPersonCards(document, () => state.profileId).sync();
    if (byId('managerHistoryRecoveryStatus')) byId('managerHistoryRecoveryStatus').textContent = state.historyRecoveryMessage;
    if (state.historyStartDraft !== null && byId('managerHistoryStart')) byId('managerHistoryStart').value = state.historyStartDraft;
    if (startFocused) byId('managerHistoryStart')?.focus();
}


/** Entscheidung gehört zum ursprünglichen Dokument, Profil und unveränderten Bestand. */
async function requestManagerDecision(options, operation, decide) {
    const doc = document, profileId = state.profileId, tranches = state.tranchen, loadStatus = state.loadStatus;
    const keys = [...Object.values(PROFILE_STORAGE_KEYS), 'depot_tranchen', PROFILE_WEALTH_LOTS_KEY, PROFILE_CASH_HISTORY_KEY];
    const source = new Map(keys.map(key => [key, persistenceStorage.getItem(key)]));
    const confirmed = await (decide ? decide(options.description) : requestPageConfirmation({
        ...options, doc, signal: operation.controller.signal,
        returnFocus: () => { const opener = options.opener; (opener?.isConnected ? opener : byId('depotAddTrancheBtn') || byId('tranchePersistenceStatus'))?.focus?.(); }
    }));
    operation.check();
    return confirmed === true && document === doc && state.boundDocument === doc && state.profileId === profileId
        && state.tranchen === tranches && state.loadStatus === loadStatus
        && [...source].every(([key, raw]) => persistenceStorage.getItem(key) === raw);
}

export async function repairManagerHistory({ trancheId, kind }, { confirmCorrection } = {}) {
    if (processingIsBlocked()) return false;
    const doc = document, origin = state.profileId;
    const valid = () => document === doc && state.boundDocument === doc && state.profileId === origin;
    state.historyRecoveryMessage = '';
    state.persistenceError = '';
    const result = await runManagerOperation(async operation => {
        const prepared = prepareHistoryRecovery({ profileId: origin, trancheId, kind });
        if (!prepared) return false;
        const message = kind === 'correct'
            ? `Für „${prepared.candidate.name}“ bestätigen: Kaufdatum, Typ, ISIN und Stückzahl sind rückwirkend gültige Stammdaten. Dies ist kein späterer Nachkauf; dafür eine neue Tranche anlegen. Die Rekonstruktion bleibt vorläufig. Fortfahren?`
            : `„${prepared.candidate.name}“ als nie gültige Fehleingabe aus dem Verlauf verwerfen? Nur die Verlaufskopie wird entfernt. Dies erfasst keinen Verkauf und keine Entnahme und ändert weder Depotbestand noch Tagesgeld.`;
        const confirmed = await requestManagerDecision({ title: kind === 'correct' ? 'Verlauf korrigieren' : 'Verlauf verwerfen', description: message, confirmLabel: kind === 'correct' ? 'Verlauf korrigieren' : 'Verlauf verwerfen', danger: kind !== 'correct', opener: document.activeElement }, operation, confirmCorrection);
        if (!confirmed) return false;
        await commitHistoryRecovery(prepared, { confirmed: true, operation, valid });
        if (!valid()) return false;
        state.historyRecoveryMessage = kind === 'correct' ? 'Korrigierter Verlauf bestätigt · vorläufige Rekonstruktion.' : 'Fehleingabe aus dem Verlauf verworfen.';
        return true;
    });
    if (!valid()) return false;
    if (result !== true && state.persistenceError) state.historyRecoveryMessage = `Verlauf nicht repariert: ${state.persistenceError} Erneut bestätigen, um zu wiederholen.`;
    render();
    const replacement = Array.from(byId('managerHousehold')?.querySelectorAll?.('[data-history-recovery]') || [])
        .find(button => button.dataset.historyRecovery === trancheId);
    (replacement || byId('managerHistoryRecoveryStatus'))?.focus?.();
    return result === true;
}

function renderDepotHistory() {
    const registry = loadProfileRegistry();
    const context = registry.value ? readManagerHistoryContext(registry.value) : { status: 'missing' };
    const focusId = state.historyUI?.beforeRender(state.profileId, state.tranchen);
    renderTranchenTable(byId('tranchenTable'), state.tranchen, { context, profileId: state.profileId, expandedId: state.historyUI?.expandedId });
    state.historyUI?.afterRender(focusId);
}

/** Ein Beginnwrite besitzt denselben kurzen Commit wie die übrige Managerbedienung. */
export async function saveManagerHistoryStart(startDate = byId('managerHistoryStart')?.value) {
    if (processingIsBlocked()) return false;
    const status = byId('managerHistoryStartStatus');
    const origin = state.profileId;
    const doc = document;
    try {
        // Vor Besitzaufnahme validieren: ungültige Eingaben erzeugen keinen Write.
        const next = assertHistoryStart({ version: 1, startDate });
        const result = await runManagerOperation(async operation => {
            await confirmManagerHistoryStart(next.startDate, { operation,
                valid: () => document === doc && state.profileId === origin });
            state.historyStartDraft = null;
            render();
            const currentStatus = byId('managerHistoryStartStatus');
            if (currentStatus) currentStatus.textContent = 'Verlaufsbeginn bestätigt. Fehlende Kurse werden beim nächsten Start nachgeladen.';
            byId('managerHistoryStartConfirm')?.focus();
            return true;
        });
        if (result !== true && status) status.textContent = `Beginn nicht bestätigt. ${state.persistenceError || 'Die Aktion wurde abgebrochen.'}`;
        return result === true;
    } catch (error) {
        if (status) status.textContent = `Beginn nicht bestätigt. ${error.message}`;
        return false;
    }
}

function readStoredValue(key, fallback = null) {
    try {
        return persistenceStorage.getItem(key);
    } catch {
        return fallback;
    }
}

async function restoreManagerRecords(records) {
    let failed = false;
    for (const [key, value] of records) {
        try {
            if (value === null || value === undefined) persistenceStorage.removeItem(key);
            else persistenceStorage.setItem(key, value);
        } catch { failed = true; }
    }
    try { await flushManagerRecords(); } catch { failed = true; }
    return !failed;
}

async function flushManagerRecords() {
    if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
}

async function runManagerOperation(execute) {
    if (byId('managerProfileRecovery')?.hidden === false) return false;
    try { return await state.navigationLifecycle.run({}, execute); }
    catch (error) {
        if (error?.name !== 'AbortError') {
            state.persistenceError = error.message || 'Die Aktion konnte nicht abgeschlossen werden.';
            renderPersistenceState();
        }
        return false;
    } finally {
        renderPersistenceState();
    }
}

function setPersistenceStatus(message, kind = '', { hidePanel = false } = {}) {
    const target = byId('tranchePersistenceStatus');
    if (!target) return;
    target.textContent = message;
    target.dataset.kind = kind;
    const panel = target.closest?.('.persistence-panel');
    if (panel) panel.hidden = hidePanel;
}

export function describeLegacyTaxMigration(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return '';
    let records;
    try {
        records = JSON.parse(raw);
    } catch {
        return '';
    }
    if (!Array.isArray(records)) return '';
    const legacy = records.filter(record => {
        const version = record?.schemaVersion;
        return version === undefined || version === null || version === 0 || version === 1;
    });
    if (legacy.length === 0) return '';
    const goldExemptions = legacy.filter(record => (
        (record?.category === 'gold' || record?.type === 'gold' || record?.kind === 'gold')
        && Number(record?.tqf) === 1
        && typeof record?.taxExempt !== 'boolean'
    )).length;
    const resetNonEquityTqf = legacy.filter(record => (
        record?.category !== 'equity'
        && Number(record?.tqf) > 0
        && !((record?.category === 'gold' || record?.type === 'gold' || record?.kind === 'gold') && Number(record?.tqf) === 1)
    )).length;
    return `${legacy.length} Legacy-Tranche(n) wurden nur fuer die Anzeige auf den heutigen Steuervertrag migriert: `
        + `Steuerfreiheit standardmaessig nein, ${goldExemptions} alte Gold-TQF-1-Kodierung(en) als explizit steuerfrei, `
        + `${resetNonEquityTqf} unbelegte Nicht-Aktien-TQF auf 0. Bis Sie jede Tranche fachlich pruefen und speichern, `
        + 'rechnet die Simulation mit diesen konservativen Annahmen.';
}

function clearProfileValidationStatus() {
    const status = byId('profileValidationStatus');
    if (status) {
        status.textContent = '';
        status.hidden = true;
    }
    Object.values(PROFILE_ERROR_DOM_IDS).forEach(id => byId(id)?.removeAttribute?.('aria-invalid'));
}

function showProfileValidationStatus(error) {
    clearProfileValidationStatus();
    const first = error?.errors?.[0];
    const status = byId('profileValidationStatus');
    const message = first?.message || 'Die Profilwerte sind unvollständig oder ungültig.';
    if (status) {
        status.textContent = `Profilwerte nicht gespeichert: ${message}`;
        status.hidden = false;
    }
    const field = first ? byId(PROFILE_ERROR_DOM_IDS[first.field]) : null;
    field?.setAttribute?.('aria-invalid', 'true');
    return message;
}

function processingIsBlocked() {
    return personManagementPending || Boolean(window?.__personMigrationDeferred) || state.navigationLifecycle?.isBlocked()
        || state.commitInFlight
        || state.cashPostingInFlight
        || state.profileCommitInFlight
        || state.householdPlan?.read().writing
        || PersistenceFacade.hasSyncWriteBlocks?.()
        || Boolean(state.quoteBatchPromise)
        || Boolean(state.pendingCommit)
        || Boolean(state.pendingReconciliation)
        || Boolean(state.pendingCashPosting)
        || byId('managerProfileRecovery')?.hidden === false
        || state.loadStatus === 'corrupt'
        || state.loadStatus === 'unavailable';
}

function setManagerControlsBlocked(blocked) {
    state.householdPlan?.syncBlocked(blocked);
    if (state.navigationLifecycle?.isBlocked()) state.householdPlan?.pause();
    else state.householdPlan?.resume();
    const retryBlocked = Boolean(state.navigationLifecycle?.isBlocked()
        || state.commitInFlight || state.profileCommitInFlight || state.cashPostingInFlight
        || byId('managerProfileRecovery')?.hidden === false);
    for (const id of ['retryTrancheSaveBtn', 'retryTrancheDialogSaveBtn', 'retryCashPostingSaveBtn', 'retrySaleSaveBtn']) {
        const button = byId(id);
        if (button) button.disabled = retryBlocked;
    }
    [
        'managerBirthApply',
        'managerHistoryStart',
        'managerHistoryStartConfirm',
        'depotAddTrancheBtn',
        'depotOpenSaleEntryBtn',
        'profileManagePeopleBtn',
        'managePeopleBtn',
        'managerPersonName',
        'managerPersonCreateBtn',
        'managerPersonRenameBtn',
        'managerPersonRenameCancelBtn',
        'saleNextBtn',
        'saleBackBtn',
        'updatePricesBtn',
        'proxyHealthBtn',
        'clearTranchesBtn',
        'reconciliationPreviewBtn',
        'reconciliationConfirmBtn',
        'reconciliationCancelBtn',
        'cashPostingSubmitBtn',
        ...RECONCILIATION_INPUT_IDS,
        ...PROFILE_INPUT_IDS
    ].forEach(id => {
        const element = byId(id);
        if (element) {
            // Das gerade bearbeitete Profilfeld behält Fokus und Text während
            // seines Autosaves. Weitere Eingaben laufen über die vorhandene Queue.
            const editingProfileDecimal = state.profileEditingField === element && PROFILE_INPUT_IDS.includes(id)
                && document.activeElement === element && (isEditableDecimalInput(element) || id === 'profileGeburtsdatum');
            element.disabled = blocked && !editingProfileDecimal;
        }
    });
    byId('reconciliationCashStatuses')?.querySelectorAll?.('[data-cash-action]')?.forEach?.(element => {
        element.disabled = blocked;
    });
    byId('tranchenTable')?.querySelectorAll?.('[data-history-toggle]')?.forEach?.(element => { element.disabled = blocked; });
    byId('managerHousehold')?.querySelectorAll?.('[data-manager-people]')?.forEach?.(element => { element.disabled = blocked; });
    byId('managerHousehold')?.querySelectorAll?.('[data-history-recovery]')?.forEach?.(element => {
        // Belegbedingte Sperren bleiben nach Freigabe erhalten.
        element.disabled = blocked || element.dataset.historyRecoveryBlocked === 'true';
    });
    for (const host of ['managerSectionNav', 'managerHousehold']) byId(host)?.querySelectorAll?.('[data-manager-profile], [data-manager-view]')?.forEach?.(button => { button.disabled = managerSelectionIsBlocked(); });
    byId('managerPeopleList')?.querySelectorAll?.('button, input')?.forEach?.(element => { element.disabled = blocked; });
    syncManagerProfileControls(document);
    const preview = byId('reconciliationPreviewBtn');
    if (preview) preview.disabled = blocked || state.tranchen.length === 0;
    const confirmButton = byId('reconciliationConfirmBtn');
    if (confirmButton) confirmButton.disabled = blocked || state.reconciliationPreview?.preview?.status !== 'ready';
    const cashCancel = byId('cashPostingCancelBtn');
    if (cashCancel) cashCancel.disabled = state.cashPostingInFlight;
    const cashSubmit = byId('cashPostingSubmitBtn');
    if (cashSubmit) cashSubmit.disabled = blocked || isCashPostingEditorCompleted() || isCashPostingSourceInvalid();
}

function clearRawPreview() {
    state.rawRevealed = false;
    const preview = byId('corruptPayloadPreview');
    const copyButton = byId('copyCorruptPayloadBtn');
    if (preview) {
        preview.textContent = '';
        preview.hidden = true;
    }
    if (copyButton) copyButton.hidden = true;
}

function renderPersistenceState() {
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
        const button = byId(id);
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

function formatReconciliationNumber(value, options = {}) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
    const { currency = false, maximumFractionDigits = currency ? 2 : 6 } = options;
    return new Intl.NumberFormat('de-DE', {
        ...(currency ? { style: 'currency', currency: 'EUR' } : {}),
        maximumFractionDigits
    }).format(Number(value));
}

function localIsoDate(date = appNow()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function setReconciliationStatus(message = '', kind = '') {
    const saleStatus = byId('saleStatus');
    if (saleStatus) { saleStatus.textContent = message; saleStatus.dataset.kind = kind; }
    const target = byId('reconciliationStatus');
    if (!target) return;
    target.textContent = message;
    target.dataset.kind = kind;
}

function refreshReconciliationCashStatuses() {
    const loaded = loadReconciliationRegistryFromStorage(state.registryDisplayRaw === undefined ? persistenceStorage : {
        getItem: () => state.registryDisplayRaw
    });
    if (loaded.status === 'empty') {
        state.reconciliationCashStatuses = [];
        state.cashStatusError = '';
        return;
    }
    if (loaded.status !== 'valid') {
        state.reconciliationCashStatuses = [];
        state.cashStatusError = 'Cashstatus-Audit ist nicht lesbar. Bestätigung und Korrektur bleiben blockiert.';
        return;
    }
    try {
        state.reconciliationCashStatuses = projectReconciliationCashStatuses(loaded.registry, state.profileId);
        state.cashStatusError = '';
    } catch (error) {
        state.reconciliationCashStatuses = [];
        state.cashStatusError = error instanceof TrancheReconciliationError
            ? `Cashstatus-Audit blockiert: ${error.message}`
            : 'Cashstatus-Audit ist beschädigt oder nicht unterstützt.';
    }
}

function syncInitialCashStatusControls() {
    const status = byId('reconcileCashStatus')?.value || 'pending_manual_posting';
    const group = byId('reconcileInitialCashBalanceGroup');
    const input = byId('reconcileInitialCashBalance');
    const confirmed = status === 'confirmed_already_reflected';
    if (group) group.hidden = !confirmed;
    if (input) input.required = confirmed;
}

function renderReconciliationOptions() {
    const select = byId('reconcileTrancheId');
    if (!select || typeof document.createElement !== 'function') return;
    const previousValue = select.value;
    select.replaceChildren?.();
    if (!select.replaceChildren) select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.tranchen.length > 0
        ? 'Tranche nach Namen auswählen'
        : 'Keine Tranche verfügbar';
    select.appendChild(placeholder);
    state.tranchen.forEach(tranche => {
        const option = document.createElement('option');
        option.value = tranche.trancheId;
        option.textContent = `${tranche.name || 'Tranche'} — ${tranche.trancheId}`;
        select.appendChild(option);
    });
    select.value = state.tranchen.some(tranche => tranche.trancheId === previousValue)
        ? previousValue
        : '';
    syncSelectionText(select);
}

function renderReconciliationPreview() {
    const container = byId('reconciliationPreview');
    const content = byId('reconciliationPreviewContent');
    const confirmButton = byId('reconciliationConfirmBtn');
    const cancelButton = byId('reconciliationCancelBtn');
    const preview = state.reconciliationPreview?.preview || null;
    if (container) container.hidden = !preview;
    if (confirmButton) {
        confirmButton.hidden = !preview;
        confirmButton.disabled = processingIsBlocked() || preview?.status !== 'ready';
    }
    if (cancelButton) {
        cancelButton.hidden = !preview;
        cancelButton.disabled = state.commitInFlight;
    }
    if (!content) return;
    if (!preview) {
        content.textContent = '';
        return;
    }

    const action = preview.action;
    const after = preview.after;
    const lines = [
        `Profil-ID: ${action.profileId}`,
        `Tranche-ID: ${action.trancheId}`,
        `Action-ID: ${action.actionId}`,
        `Ausführungstag: ${action.executedAt}`,
        '',
        `Ist-Bestand vorher: ${formatReconciliationNumber(preview.before?.shares)} Stück · ${formatReconciliationNumber(preview.before?.marketValue, { currency: true })} Marktwert · ${formatReconciliationNumber(preview.before?.costBasis, { currency: true })} Einstandskosten`,
        `Tatsächliche Ausführung: ${formatReconciliationNumber(preview.execution?.sharesSold)} Stück · ${formatReconciliationNumber(preview.execution?.grossProceeds, { currency: true })} Brutto · ${formatReconciliationNumber(preview.execution?.fees, { currency: true })} Kosten · ${formatReconciliationNumber(preview.execution?.netProceeds, { currency: true })} Netto`,
        action.cashStatus === 'confirmed_already_reflected'
            ? `Cashstatus: bereits berücksichtigt · bestätigter Cashstand ${formatReconciliationNumber(action.cashBalanceAfterPostingEur, { currency: true })} · Nachweiszeitpunkt ${action.cashConfirmedAt}`
            : 'Cashstatus: offen – Nettoerlös nach dem Lot-Commit manuell in der freien Liquidität nachführen und anschließend bestätigen.',
        'Es erfolgt keine automatische Cashbuchung der freien Liquidität.',
        after
            ? `Resultierender Bestand: ${formatReconciliationNumber(after.shares)} Stück · ${formatReconciliationNumber(after.marketValue, { currency: true })} Marktwert · ${formatReconciliationNumber(after.costBasis, { currency: true })} Einstandskosten`
            : 'Resultierender Bestand: Tranche vollständig verkauft und entfernt.'
    ];
    if (preview.deviation) {
        const deviations = [];
        if (Object.prototype.hasOwnProperty.call(preview.deviation, 'sharesSold')) {
            deviations.push(`${formatReconciliationNumber(preview.deviation.sharesSold)} Stück`);
        }
        if (Object.prototype.hasOwnProperty.call(preview.deviation, 'grossProceeds')) {
            deviations.push(formatReconciliationNumber(preview.deviation.grossProceeds, { currency: true }));
        }
        lines.push(`Abweichung zur optional erfassten Empfehlung: ${deviations.join(' · ')}`);
    } else {
        lines.push('Empfehlungsvergleich: keine Referenz erfasst; tatsächliche Ausführung bleibt maßgeblich.');
    }
    if (preview.status === 'duplicate') {
        lines.push('', 'Diese Action-ID wurde mit denselben Ausführungsdaten bereits angewendet. Es erfolgt keine weitere Bestandsänderung.');
    }
    content.textContent = lines.join('\n');
}

function renderReconciliationState() {
    const form = byId('reconciliationForm');
    if (!form) return;
    const cashContainer = ensureReconciliationCashControls(document);
    syncInitialCashStatusControls();
    renderReconciliationOptions();
    const dateInput = byId('reconcileExecutedAt');
    if (dateInput && !dateInput.value) dateInput.value = localIsoDate();
    const previewButton = byId('reconciliationPreviewBtn');
    if (previewButton) previewButton.disabled = processingIsBlocked() || state.tranchen.length === 0;
    renderReconciliationPreview();
    renderReconciliationCashStatuses(cashContainer, state.reconciliationCashStatuses, {
        errorMessage: state.cashStatusError
    });
    if (state.cashStatusError) {
        setReconciliationStatus(state.cashStatusError, 'error');
    } else if (state.reconciliationError) {
        setReconciliationStatus(state.reconciliationError, 'error');
    } else if (state.reconciliationStatus) {
        setReconciliationStatus(state.reconciliationStatus, 'ok');
    } else {
        setReconciliationStatus(
            'Empfehlungen aus Balance und Simulator sind schreibfrei. Nur diese separat bestätigte tatsächliche Ausführung verändert den Realbestand.',
            ''
        );
    }
}

function readOptionalNumber(id) {
    const raw = byId(id)?.value;
    return raw === '' || raw === null || raw === undefined ? null : readDecimalInput(raw, byId(id));
}

function readReconciliationActionFromDom(now = () => new Date()) {
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

function clearReconciliationPreview({ resetForm = false, navigationOperation } = {}) {
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

function createReconciliationPreview(event) {
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

async function executeReconciliation(pending, { requireConfirmation = true, navigationOperation } = {}) {
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

function confirmReconciliation() {
    const pending = state.reconciliationPreview;
    if (!pending || pending.preview?.status !== 'ready') return Promise.resolve(false);
    return executeReconciliation(pending);
}

function openCashStatusWorkflow(targetActionId, mode, opener = null) {
    if (processingIsBlocked()) return false;
    const status = state.reconciliationCashStatuses.find(item => item.targetActionId === targetActionId);
    if (!status) {
        state.reconciliationError = `Cashstatus für Zielverkauf ${targetActionId} ist nicht mehr verfügbar.`;
        renderReconciliationState();
        return false;
    }
    const correctionMode = mode === 'correct';
    if ((correctionMode && !status.canCorrect) || (!correctionMode && !status.canConfirm)) {
        state.reconciliationError = 'Der Cashstatus hat sich geändert. Bitte aktuellen Stand neu laden.';
        renderReconciliationState();
        return false;
    }
    const nextRevision = correctionMode ? status.correctionRevision + 1 : null;
    const cashSource = captureCashPeople({ ids: [state.profileId], activeId: state.profileId })[0];
    return openCashPostingModal({
        mode: correctionMode ? 'correct' : 'confirm',
        targetActionId: status.targetActionId,
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

async function executeCashPosting(pending, { navigationOperation } = {}) {
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
            ? 'Ein inhaltlich gleicher Cashnachweis war bereits gespeichert; es wurde nichts angehängt und der erste Nachweiszeitpunkt bleibt erhalten.'
            : result.cashRecordsChanged
                ? pending.mode === 'correct'
                    ? 'Neuer Tagesgeld-Stand übernommen und Korrektur-Auditnachweis append-only gespeichert; Verkauf und frühere Nachweise blieben unverändert.'
                    : 'Neuer Tagesgeld-Stand übernommen und Abschluss-Auditnachweis append-only gespeichert.'
                : pending.mode === 'correct'
                    ? 'Nur der Korrektur-Auditnachweis wurde append-only gespeichert; Verkauf und frühere Nachweise blieben unverändert.'
                    : 'Nur der Abschluss-Auditnachweis wurde append-only gespeichert.';
        state.persistenceMessage = result.status === 'duplicate'
            ? 'Keine Auditänderung: Ein inhaltlich gleicher Cashnachweis war bereits vorhanden.'
            : result.cashRecordsChanged
                ? 'Neuer Tagesgeld-Stand übernommen und Auditnachweis gemeinsam dauerhaft gespeichert.'
                : 'Nur der Auditnachweis wurde dauerhaft ergänzt.';
        refreshReconciliationCashStatuses();
        succeeded = true;
        return true;
    } catch (error) {
        state.pendingCashPosting = error?.code === 'RECONCILIATION_PERSISTENCE_FAILED' && error.retryable ? pending : null;
        if (error?.code === 'RECONCILIATION_PERSISTENCE_FAILED') state.registryDisplayRaw = previousRegistryRaw;
        state.reconciliationError = error instanceof TrancheReconciliationError
            ? `${error.message}${error.retryable ? ' Retry ist möglich.' : ''}`
            : 'Der Cashstatus konnte nicht geprüft oder dauerhaft gespeichert werden. Bitte den Dialog neu öffnen.';
        state.persistenceError = error?.code === 'RECONCILIATION_CASH_SOURCE_INVALID'
            ? '' : 'Cashstatus wurde nicht dauerhaft bestätigt. Der letzte Auditstand bleibt sichtbar.';
        showCashPostingFormError(state.reconciliationError, 'cashPostingBalance');
        return false;
    } finally {
        state.cashPostingInFlight = false;
        render();
        renderPersistenceState();
        if (succeeded) finishManagerDecimalSubmission('cash', pending.modalSubmission, navigationOperation);
    }
}

async function submitCashPosting(event) {
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
                : 'Cashstatus konnte nicht geprüft werden.',
            field
        );
        return false;
    }
}

function updateActiveProfileLabel(profileId = state.profileId) {
    const label = byId('suiteProfileContext');
    if (!label) return;
    let meta = null;
    try {
        meta = profileId ? getProfileMeta(profileId) : null;
    } catch {
        meta = null;
    }
    const id = profileId || '-';
    label.textContent = '';
    label.hidden = true;
    label.dataset.profileName = meta?.name || 'Profil';
    label.dataset.profileId = id;
    const depotProfile = byId('managerDepotProfileName');
    if (depotProfile) depotProfile.textContent = meta?.name || id;
    const personProfile = byId('managerPersonProfileName');
    if (personProfile) personProfile.textContent = meta?.name || 'Profil';
    const technicalProfile = byId('managerTechnicalProfile');
    if (technicalProfile) technicalProfile.textContent = `Profil-Kennung: ${id}`;
    const backLink = byId('managerBackLink');
    if (backLink) {
        backLink.dataset.profileId = id;
        backLink.setAttribute?.('aria-label', `Zurück zur Profilübersicht für ${meta?.name || id} (${id})`);
    }
}

async function saveProfileValues(values = readProfileAssetValuesFromDom(), navigationOperation = null) {
    let validatedValues;
    try {
        validatedValues = validateProfileAssetValues(values);
        clearProfileValidationStatus();
    } catch (error) {
        if (error instanceof ProfileAssetValuesValidationError) showProfileValidationStatus(error);
        return false;
    }
    if (state.profileCommitInFlight) {
        state.pendingProfileValues = validatedValues;
        return false;
    }
    if (state.commitInFlight || state.cashPostingInFlight || state.loadStatus === 'corrupt' || state.loadStatus === 'unavailable') return false;
    if (!navigationOperation) {
        if (state.navigationLifecycle?.isBlocked()) return runManagerOperation(operation => saveProfileValues(validatedValues, operation));
        state.profileEditingField = document.activeElement;
        try { return await runManagerOperation(operation => saveProfileValues(validatedValues, operation)); }
        finally { state.profileEditingField = null; }
    }

    state.profileCommitInFlight = true;
    state.persistenceMessage = '';
    state.persistenceError = '';
    try {
        // Alle erfolgreichen Fortsetzungen behalten Flag und Besitzer ohne Lücke.
        while (validatedValues) {
            state.pendingProfileValues = null;
            const previousValues = new Map(PROFILE_ASSET_STORAGE_KEYS.map(key => [key, readStoredValue(key)]));
            const previousRegistryRaw = readStoredValue(PROFILE_STORAGE_KEYS.registry);
            const committingSignature = managerInputSignature(PROFILE_INPUT_IDS, { profileTagesgeld: validatedValues.tagesgeld });
            renderPersistenceState();
            try {
                navigationOperation.commit();
                saveProfileAssetValues(validatedValues, persistenceStorage, { recordCashChange: true, confirmGender: validatedValues.genderConfirmed === true });
                if (!saveCurrentProfileFromLocalStorage()) throw new Error('PROFILE_SAVE_FAILED');
                await flushManagerRecords();
                // Nach Retry zeigt das Formular noch den zurückgeschriebenen Altstand.
                // Nur unveränderte Eingaben auf den jetzt bestätigten Satz projizieren.
                if (managerInputSignature(PROFILE_INPUT_IDS) === committingSignature) {
                    applyProfileAssetValuesToDom(validatedValues, document, { preserveActiveDecimalInput: true });
                    state.profileBaseline = managerInputSignature(PROFILE_INPUT_IDS);
                } else {
                    applyProfileRenteStatusToDom(validatedValues);
                    state.profileBaseline = committingSignature;
                }
                if (validatedValues.genderConfirmed && byId('profileGeschlecht')) delete byId('profileGeschlecht').dataset.genderConfirmed;
                state.registryDisplayRaw = undefined;
                state.persistenceMessage = 'Profilwerte dauerhaft gespeichert.';
                refreshManagerProfiles(document, state.profileId);
                bindManagerPersonCards(document, () => state.profileId).sync();
            } catch {
                const restored = await restoreManagerRecords([...previousValues, [PROFILE_STORAGE_KEYS.registry, previousRegistryRaw]]);
                state.pendingProfileValues = state.pendingProfileValues || validatedValues;
                state.registryDisplayRaw = previousRegistryRaw;
                state.persistenceMessage = '';
                state.persistenceError = restored
                    ? 'Profilwerte konnten nicht dauerhaft gespeichert werden. Der bestätigte Stand wurde wiederhergestellt; Retry ist möglich.'
                    : 'Profilwerte und dauerhaftes Rückschreiben konnten nicht bestätigt werden. Der letzte bestätigte Stand bleibt sichtbar; Retry ist möglich.';
                try { applyProfileAssetValuesToDom(loadProfileAssetValues({
                    getItem: key => previousValues.has(key) ? previousValues.get(key) : readStoredValue(key)
                })); } catch { /* Fehlerstatus bleibt erhalten. */ }
                state.profileBaseline = managerInputSignature(PROFILE_INPUT_IDS);
                return false;
            }
            validatedValues = state.pendingProfileValues;
        }
        return true;
    } finally {
        state.profileCommitInFlight = false;
        renderPersistenceState();
    }
}

function scheduleProfileValuesSave({ resumePaused = false, cashChange = false, immediate = false } = {}) {
    if (byId('managerProfileRecovery')?.hidden === false) return false;
    state.persistenceMessage = '';
    if (state.profileSaveTimer !== null) {
        clearTimeout(state.profileSaveTimer);
        state.profileSaveTimer = null;
    }

    let values;
    try {
        values = readProfileAssetValuesFromDom();
        // Andere Profilfelder dürfen einen offenen Tagesgeldentwurf nicht
        // nebenbei übernehmen; dessen change/Enter besitzt die Bestätigung.
        if (!cashChange) values.tagesgeld = loadProfileAssetValues().tagesgeld;
        clearProfileValidationStatus();
    } catch (error) {
        if (error instanceof ProfileAssetValuesValidationError) {
            showProfileValidationStatus(error);
            state.pendingProfileValues = null;
            renderPersistenceState();
        }
        return false;
    }

    if (state.profileCommitInFlight) {
        state.pendingProfileValues = values;
        return true;
    }
    // Ein durch Navigation abgebrochener Dialog gibt seinen Besitzer zuerst frei.
    // Der fortgesetzte Timer darf schon geplant werden; saveProfileValues prüft vor jedem Write erneut den Lifecycle.
    if ((!resumePaused && state.navigationLifecycle?.isBlocked()) || state.cashPostingInFlight || state.commitInFlight) return false;
    if (immediate) return saveProfileValues(values);
    state.profileSaveTimer = setTimeout(() => {
        state.profileSaveTimer = null;
        state.pendingProfileValues = values;
        void saveProfileValues(values);
    }, PROFILE_SAVE_DEBOUNCE_MS);
    setPersistenceStatus('Profiländerung wartet auf automatisches Speichern …', 'pending');
    return true;
}

export async function applyManagerBirthDate() {
    const doc = document, origin = state.profileId;
    const input = byId('managerBirthDate'), errorHost = byId('managerBirthError');
    if (!input || processingIsBlocked() || byId('managerBirthSupplement')?.hidden !== false) return false;
    const report = text => { if (errorHost) errorHost.textContent = text; };
    const birth = validateIsoDate(personDateInputToIso(input.value) ?? input.value);
    const registry = loadProfileRegistry().value;
    const data = registry?.profiles[origin]?.data || {};
    const balance = loadStoredBalanceStateFromData(data);
    const year = personReferenceYear(balance.value?.annualPeriodMetadata);
    if (birth.status !== 'valid' || personAge({ ...data, profile_geburtsdatum: birth.value }, year).status !== 'valid') {
        report('Bitte ein vollständiges gültiges Geburtsdatum (TT.MM.JJJJ) vor dem Januarstichtag eingeben.');
        input.setAttribute('aria-invalid', 'true'); input.focus(); return false;
    }
    input.removeAttribute('aria-invalid');
    try { readProfileAssetValuesFromDom(); }
    catch (error) { showProfileValidationStatus(error); input.focus(); return false; }
    if (state.profileSaveTimer !== null || state.pendingProfileValues || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline) {
        report('Bitte zuerst die übrigen Profiländerungen dauerhaft speichern oder erneut versuchen.'); input.focus(); return false;
    }
    const draft = birth.value;
    input.focus();
    report('Geburtsdatum wird gespeichert …');
    const ok = await runManagerOperation(async operation => {
        if (document !== doc || state.profileId !== origin || getCurrentProfileId() !== origin) return false;
        state.profileCommitInFlight = true;
        input.readOnly = true;
        const previousDate = readStoredValue(PROFILE_VALUE_KEYS.geburtsdatum);
        const previousRegistry = readStoredValue(PROFILE_STORAGE_KEYS.registry);
        try {
            renderPersistenceState();
            operation.commit();
            // Die Ergänzung schreibt ausschließlich das Datum und den Profilcapture.
            persistenceStorage.setItem(PROFILE_VALUE_KEYS.geburtsdatum, draft);
            if (!saveCurrentProfileFromLocalStorage()) throw new Error('PROFILE_SAVE_FAILED');
            await flushManagerRecords();
            if (document !== doc || state.profileId !== origin) return false;
            byId('profileGeburtsdatum').value = draft;
            state.profileBaseline = managerInputSignature(PROFILE_INPUT_IDS);
            state.persistenceError = ''; state.persistenceMessage = 'Geburtsdatum dauerhaft gespeichert.';
            refreshManagerProfiles(doc, origin);
            return true;
        } catch {
            const restored = await restoreManagerRecords([[PROFILE_VALUE_KEYS.geburtsdatum, previousDate], [PROFILE_STORAGE_KEYS.registry, previousRegistry]]);
            state.persistenceError = restored ? 'Geburtsdatum konnte nicht dauerhaft gespeichert werden; Retry ist möglich.' : 'Geburtsdatum und Rückschreiben konnten nicht bestätigt werden.';
            return false;
        } finally {
            input.readOnly = false;
            state.profileCommitInFlight = false;
            renderPersistenceState();
        }
    });
    if (document !== doc || state.profileId !== origin) return false;
    if (!ok) {
        report('Geburtsdatum konnte nicht dauerhaft gespeichert werden. Der Entwurf bleibt erhalten; erneut Übernehmen versuchen.');
        input.focus();
    } else {
        const cards = bindManagerPersonCards(doc, () => state.profileId);
        cards.sync(); cards.openPerson();
        byId('profileGeburtsdatum')?.focus();
    }
    return ok;
}

function bindProfileValueInputs() {
    byId('managerBirthApply')?.addEventListener('click', applyManagerBirthDate);
    PROFILE_INPUT_IDS.forEach(id => {
        const el = byId(id);
        if (!el) return;
        const isCash = id === 'profileTagesgeld';
        const eventName = isCash || el.tagName.toLowerCase() === 'select' ? 'change' : 'input';
        el.addEventListener(eventName, () => {
            if (isCash && readDecimalInput(el.value, el) === loadProfileAssetValues().tagesgeld) return;
            if (id === 'profileGeschlecht') el.dataset.genderConfirmed = 'true';
            const scheduled = scheduleProfileValuesSave({ cashChange: isCash, immediate: isCash });
            syncManagerProfileControls(document);
            state.navigationRegistration?.notify();
            renderTranchenStats(byId('stats'), state.tranchen);
            return scheduled;
        });
        if (isCash) {
            el.addEventListener('input', () => state.navigationRegistration?.notify());
            el.addEventListener('keydown', event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
        }
    });
}

function flushManagerCashInput() {
    const field = byId('profileTagesgeld');
    if (readDecimalInput(field?.value, field) === loadProfileAssetValues().tagesgeld) return true;
    if (state.profileCommitInFlight || state.pendingProfileValues) return false;
    return scheduleProfileValuesSave({ cashChange: true, immediate: true });
}

function addTranche(event) {
    if (processingIsBlocked()) return;
    state.editingIndex = -1;
    openCreateTrancheModal(document, event?.currentTarget || event?.target || null);
}

function editTranche(index, opener = null) {
    if (processingIsBlocked()) return;
    state.editingIndex = index;
    const tranche = state.tranchen[index];
    if (!tranche) return;
    openEditTrancheModal(tranche, document, opener);
}

async function persistTranchen(nextTranches, options = {}) {
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
        const lots = captureWealthLots(JSON.stringify(captureWealthLots(previousLotsRaw, state.confirmedTranches)), normalized);
        persistenceStorage.setItem(PROFILE_WEALTH_LOTS_KEY, JSON.stringify(lots));
        const persisted = saveTranchesToStorage(normalized);
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
            [PROFILE_STORAGE_KEYS.registry, previousRegistryRaw]
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

async function deleteTranche(index) {
    if (processingIsBlocked()) return false;
    const tranche = state.tranchen[index];
    if (!tranche) return false;
    return runManagerOperation(async operation => {
        if (!await requestManagerDecision({ title: 'Tranche löschen', confirmLabel: 'Tranche löschen', danger: true,
            opener: document.activeElement, description: `Tranche „${tranche.name || tranche.trancheId}“ wirklich dauerhaft löschen?` }, operation)) return false;
        const nextTranches = state.tranchen.filter(item => item.trancheId !== tranche.trancheId);
        return persistTranchen(nextTranches, { navigationOperation: operation, successMessage: 'Tranche dauerhaft gelöscht.', onSuccess: () => byId('depotAddTrancheBtn')?.focus?.() });
    });
}

async function saveTranche(event) {
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

async function clearAll() {
    if (processingIsBlocked()) return false;
    return runManagerOperation(async operation => {
        if (!await requestManagerDecision({ title: 'Alle Tranchen löschen', confirmLabel: 'Alle Tranchen löschen', danger: true,
            opener: document.activeElement, description: 'Alle Tranchen löschen? Diese Aktion kann nicht rückgängig gemacht werden.' }, operation)) return false;
        return persistTranchen([], { navigationOperation: operation, successMessage: 'Alle Tranchen wurden dauerhaft gelöscht.' });
    });
}

function formatQuoteIssue(result) {
    const label = result.name || result.trancheId || 'Unbenannte Tranche';
    const message = result.status === 'skipped'
        ? 'Ticker oder ISIN fehlt'
        : String(result.message || 'Kursabruf fehlgeschlagen').trim().replace(/[.\s]+$/, '');
    return `${label}: ${message}.`;
}

function formatBatchStatus(results, options = {}) {
    const updated = results.filter(result => result.status === 'updated').length;
    if (options.persistenceFailed) {
        return 'Kurse konnten nicht aktualisiert werden: Das Speichern ist fehlgeschlagen. Der bisherige Stand bleibt erhalten.';
    }
    if (updated === results.length) return 'Kurse erfolgreich aktualisiert.';

    const headline = updated > 0
        ? `Kurse teilweise aktualisiert (${updated} von ${results.length}).`
        : 'Kurse konnten nicht aktualisiert werden.';
    const issues = results
        .filter(result => result.status !== 'updated')
        .map(formatQuoteIssue)
        .join(' ');
    return `${headline} ${issues}`.trim();
}

async function executePriceBatch(batchId, controller, navigationOperation) {
    const statusEl = byId('priceUpdateStatus');
    const nextTranches = state.tranchen.map(tranche => ({ ...tranche }));
    const results = new Array(nextTranches.length);
    const fetcher = createBatchQuoteFetcher(controller.signal);
    let nextIndex = 0;
    let completed = 0;
    let timedOut = false;
    const batchTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, QUOTE_BATCH_TIMEOUT_MS);

    statusEl.textContent = `Kurse werden aktualisiert... (0/${nextTranches.length})`;
    const worker = async () => {
        while (nextIndex < nextTranches.length && !controller.signal.aborted) {
            const index = nextIndex;
            nextIndex += 1;
            const tranche = nextTranches[index];
            let result;
            try {
                result = await resolveTrancheQuote(tranche, fetcher);
                if (result.status === 'updated') {
                    const quote = result.quote;
                    Object.assign(tranche, calculateTrancheDerivedValues({
                        ...tranche,
                        ticker: quote.symbol,
                        currentPrice: quote.price,
                        asOf: quote.asOf
                    }));
                }
            } catch (error) {
                result = {
                    status: 'failed',
                    ...quoteErrorDetails(error, tranche.ticker || tranche.isin)
                };
            }
            results[index] = {
                trancheId: tranche.trancheId,
                name: tranche.name,
                ...result
            };
            completed += 1;
            if (state.quoteBatchId === batchId) {
                statusEl.textContent = `Kurse werden aktualisiert... (${completed}/${nextTranches.length})`;
            }
        }
    };

    try {
        const workerCount = Math.min(QUOTE_BATCH_CONCURRENCY, nextTranches.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
    } finally {
        clearTimeout(batchTimer);
    }

    if (timedOut) {
        results.forEach((result, index) => {
            if (result?.status !== 'failed' || result.code !== 'REQUEST_ABORTED') return;
            results[index] = {
                ...result,
                code: 'BATCH_TIMEOUT',
                message: `Batch-Gesamtdauer von ${QUOTE_BATCH_TIMEOUT_MS / 1000} Sekunden ueberschritten.`
            };
        });
    }

    for (let index = 0; index < results.length; index += 1) {
        if (results[index]) continue;
        const tranche = nextTranches[index];
        results[index] = {
            trancheId: tranche.trancheId,
            name: tranche.name,
            status: 'failed',
            code: timedOut ? 'BATCH_TIMEOUT' : 'REQUEST_ABORTED',
            message: timedOut
                ? `Batch-Gesamtdauer von ${QUOTE_BATCH_TIMEOUT_MS / 1000} Sekunden ueberschritten.`
                : 'Kursbatch wurde abgebrochen.',
            symbol: tranche.ticker || tranche.isin || 'unbekannt'
        };
    }

    if (navigationOperation.controller.signal.aborted || state.quoteBatchId !== batchId || controller.signal.aborted && !timedOut) return false;
    const updated = results.filter(result => result.status === 'updated').length;
    if (updated === 0) {
        statusEl.textContent = formatBatchStatus(results);
        return false;
    }

    const committed = await persistTranchen(nextTranches, {
        successMessage: 'Kursänderungen dauerhaft gespeichert.',
        navigationOperation
    });
    if (state.quoteBatchId !== batchId) return false;
    statusEl.textContent = formatBatchStatus(results, { persistenceFailed: !committed });
    return committed;
}

function updatePrices() {
    if (state.quoteBatchPromise) return state.quoteBatchPromise;
    if (processingIsBlocked()) return Promise.resolve(false);
    if (!state.tranchen.length) {
        void showPageAlert({ title: 'Keine Tranchen vorhanden', description: 'Lege zuerst eine Tranche an. Danach kannst Du die Kurse aktualisieren.' }).catch(error => { state.persistenceError = error.message; renderPersistenceState(); });
        return Promise.resolve(false);
    }

    const batchId = state.quoteBatchId + 1;
    state.quoteBatchId = batchId;
    const batchPromise = runManagerOperation(async navigationOperation => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        navigationOperation.controller.signal.addEventListener('abort', abort, { once: true });
        state.quoteBatchController = controller;
        try { return await executePriceBatch(batchId, controller, navigationOperation); }
        finally {
            navigationOperation.controller.signal.removeEventListener('abort', abort);
            if (state.quoteBatchId === batchId) {
                state.quoteBatchController = null;
                state.quoteBatchPromise = null;
                renderPersistenceState();
            }
        }
    });
    state.quoteBatchPromise = batchPromise;
    renderPersistenceState();
    return batchPromise;
}

function revealCorruptPayload() {
    if (state.loadStatus !== 'corrupt' || typeof state.corruptRaw !== 'string') return;
    const preview = byId('corruptPayloadPreview');
    const copyButton = byId('copyCorruptPayloadBtn');
    state.rawRevealed = true;
    if (preview) {
        preview.textContent = state.corruptRaw;
        preview.hidden = false;
    }
    if (copyButton) copyButton.hidden = false;
}

async function copyCorruptPayload() {
    if (!state.rawRevealed || typeof state.corruptRaw !== 'string') return;
    try {
        if (!globalThis.navigator?.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
        await globalThis.navigator.clipboard.writeText(state.corruptRaw);
        state.persistenceMessage = 'Rohdaten wurden bewusst in die Zwischenablage kopiert.';
        state.persistenceError = '';
    } catch {
        state.persistenceError = 'Automatisches Kopieren ist nicht verfügbar. Die eingeblendeten Rohdaten können manuell markiert werden.';
    }
    renderPersistenceState();
}

async function resetCorruptPayload() {
    if (state.navigationLifecycle?.isBlocked() || state.loadStatus !== 'corrupt') return false;
    return runManagerOperation(async operation => {
        if (!await requestManagerDecision({ title: 'Bestand zurücksetzen', confirmLabel: 'Bestand zurücksetzen', danger: true,
            opener: document.activeElement, description: 'Beschädigte Tranchen wirklich dauerhaft durch einen leeren Bestand ersetzen?\n\nDie Originaldaten gehen dabei verloren. Prüfe vorher Dein Backup oder die Rohdatenkopie.' }, operation)) return false;
        return persistTranchen([], { navigationOperation: operation,
            successMessage: 'Beschädigte Tranchen wurden bestätigt zurückgesetzt.', allowRecovery: true, onSuccess: () => byId('depotAddTrancheBtn')?.focus?.() });
    });
}

function applyLoadResult(result) {
    state.registryDisplayRaw = undefined;
    state.persistenceMessage = '';
    state.persistenceError = '';
    state.taxMigrationWarning = '';
    state.pendingCommit = null;
    state.pendingReconciliation = null;
    state.pendingCashPosting = null;
    state.reconciliationPreview = null;
    state.reconciliationStatus = '';
    state.reconciliationError = '';
    clearRawPreview();

    if (result?.status === 'valid' || result?.status === 'empty') {
        const loaded = normalizeTranches(result.tranches || []);
        state.tranchen = loaded;
        state.confirmedTranches = loaded;
        state.confirmedRaw = result.raw;
        state.corruptRaw = null;
        state.loadStatus = result.status;
        state.taxMigrationWarning = describeLegacyTaxMigration(result.raw);
    } else if (result?.status === 'corrupt') {
        state.loadStatus = 'corrupt';
        state.corruptRaw = result.raw;
    } else {
        state.loadStatus = 'unavailable';
    }

    render();
    renderPersistenceState();
}

function retryLoad() {
    if (state.navigationLifecycle?.isBlocked()) return;
    applyLoadResult(state.loader());
}

async function retryPendingCommit() {
    if (state.navigationLifecycle?.isBlocked()) return;
    if (state.pendingCashPosting) {
        await executeCashPosting(state.pendingCashPosting);
        return;
    }
    if (state.pendingReconciliation) {
        await executeReconciliation(state.pendingReconciliation, { requireConfirmation: false });
        return;
    }
    if (state.pendingCommit) {
        const pending = state.pendingCommit;
        await persistTranchen(pending.tranches, pending);
        return;
    }
    if (state.pendingProfileValues) {
        await saveProfileValues(state.pendingProfileValues);
    }
}

function managerDecimalSignatureValue(id, value) {
    const raw = String(value ?? '');
    const canonical = byId(id)?.getAttribute?.('inputmode') === 'decimal' ? canonicalDecimalInput(raw, byId(id)) : 'NaN';
    return canonical === 'NaN' ? raw : canonical;
}

// Ein Retry darf einen reinen Kommawechsel nicht als neue Dialogeingabe
// behandeln. Öffnungsidentität und echte Text-/Wertänderungen bleiben geschützt.
function finishManagerDecimalSubmission(kind, submission, navigationOperation) {
    if (submission && isManagerModalSubmissionCurrent(kind, submission)) {
        const current = captureManagerModalSubmission(kind);
        const canonicalSignature = signature => JSON.stringify(JSON.parse(signature).map(([id, value, checked]) =>
            [id, managerDecimalSignatureValue(id, value), checked]));
        if (canonicalSignature(current.signature) === canonicalSignature(submission.signature)) {
            submission = { ...submission, signature: current.signature };
        }
    }
    return finishManagerModalSubmission(kind, submission, navigationOperation);
}

function managerInputSignature(ids, values = {}) {
    return JSON.stringify(ids.map(id => {
        const element = byId(id);
        // Äquivalente Anzeigeformate ausgleichen; ungültige Texte
        // bleiben unterscheidbar und echte Änderungen während Flush sichtbar.
        return [id, managerDecimalSignatureValue(id, Object.hasOwn(values, id) ? values[id] : element?.value), element?.checked === true];
    }));
}

function bindControls() {
    bindDecimalInputDisplay(document);
    bindInfoPopovers(document);
    setManagerModalWriteStateReader(() => state.commitInFlight || state.profileCommitInFlight || state.cashPostingInFlight);
    bindTrancheModalLifecycle();
    bindCashPostingModalLifecycle();
    bindManagerProfileSwitch(document, (profileId, opener) => selectManagerView({ kind: opener?.dataset.managerView || (profileId ? 'person' : 'plan'), profileId: profileId || state.profileId, ...(opener?.dataset.managerView === 'history' ? { historyScope: opener.dataset.managerHistoryScope || 'household' } : {}) }, { opener }));
    bindManagerProfileControls(document);
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
    if (byId('proxyHealthBtn')?.tagName !== 'A') byId('proxyHealthBtn')?.addEventListener('click', () => checkProxyHealth(byId('priceUpdateStatus')));
    byId('clearTranchesBtn')?.addEventListener('click', () => clearAll());
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
        const target = event.target.closest?.('[data-cash-action]');
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
        const target = event.target.closest('[data-action]');
        if (!target) return;
        const index = state.tranchen.findIndex(tranche => tranche.trancheId === target.dataset.trancheId);
        if (index < 0) return;
        if (target.dataset.action === 'edit-tranche') editTranche(index, target);
        if (target.dataset.action === 'delete-tranche') void deleteTranche(index);
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

function resolveActiveProfileId(explicitProfileId) {
    if (explicitProfileId !== undefined) return explicitProfileId || null;
    try {
        return getActiveProfileId() || getCurrentProfileId() || null;
    } catch {
        return state.profileId;
    }
}

function resetRuntimeState(profileId) {
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

function showManagerProfileRecovery(recovery) {
    const statusEl = byId('managerProfileRecovery');
    if (!statusEl) return;
    statusEl.hidden = false;
    renderProfileRecovery({ statusEl, recovery, controls: PROFILE_INPUT_IDS.map(byId) });
    setManagerControlsBlocked(true);
}

/** Verwaltung schreibt erst nach abgeschlossenem Autosave und Verwerfentscheidung. */
export async function manageManagerPerson(request) {
    if (processingIsBlocked()) return false;
    if (!await flushManagerHouseholdPlan()) return false;
    personManagementPending = true;
    try { return await executeManagerPerson({ ...request }); }
    finally { personManagementPending = false; renderPersistenceState(); }
}

async function executeManagerPerson(request) {
    const originDocument = document, originProfile = state.profileId;
    const status = byId('managerPeopleStatus');
    const message = (text, kind = '') => { if (status) { status.textContent = text; status.dataset.kind = kind; } };
    try {
        if (['create', 'rename'].includes(request.kind)) request = { ...request, name: validateProfileName(request.name) };
        if (request.kind === 'delete') {
            const autosavePaused = state.profileSaveTimer !== null;
            if (autosavePaused) clearTimeout(state.profileSaveTimer);
            state.profileSaveTimer = null;
            const origin = state.profileId, doc = document;
            let confirmed = false;
            try {
                confirmed = await runManagerOperation(operation => confirmProfileDeletion(request.profileId, undefined,
                    { doc, signal: operation.controller.signal, opener: doc.activeElement }));
                if (!confirmed || state.profileId !== origin || document !== doc || state.boundDocument !== doc) return false;
            } finally {
                // Abgelehnte Löschung verwirft keine bereits eingegebenen Profilwerte.
                // Nach einem Kontextwechsel darf der alte Entwurf kein fremdes Profil speichern.
                if (!confirmed && autosavePaused && state.profileId === origin && document === doc && state.boundDocument === doc) {
                    scheduleProfileValuesSave({ resumePaused: true });
                }
            }
        }
        const values = readProfileAssetValuesFromDom();
        if (state.profileSaveTimer !== null) clearTimeout(state.profileSaveTimer);
        state.profileSaveTimer = null;
        if (state.pendingProfileValues || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline) {
            if (!await saveProfileValues(state.pendingProfileValues || values)) {
                message('Aktive Profilwerte konnten nicht gespeichert werden.', 'error'); return false;
            }
        }
    } catch (error) {
        message(error.message, 'error');
        if (error instanceof ProfileAssetValuesValidationError) showProfileValidationStatus(error);
        return false;
    }
    const guard = getPageNavigationGuard(document);
    if (guard.isBusy()) return false;
    setManagerControlsBlocked(true);
    let attempt;
    try {
        // Der Name gehört zum Verwaltungsauftrag, nicht zu den zu verwerfenden Finanzentwürfen.
        const owners = guard.reasons().map(reason => reason.owner).filter(owner => owner !== 'manager-dialog-people');
        attempt = await guard.prepare({ owners, opener: document.activeElement, intent: 'discard' });
        if (!attempt || !guard.validate(attempt)) return false;
        guard.end(attempt); attempt = null;
        return await runManagerOperation(async operation => {
            operation.check();
            if (document !== originDocument || state.profileId !== originProfile) return false;
            operation.commit();
            const origin = state.profileId;
            const previous = new Map(Object.entries(captureProfileData()));
            for (const key of Object.values(PROFILE_STORAGE_KEYS)) previous.set(key, persistenceStorage.getItem(key));
            let confirmed = false;
            try {
                const result = applyProfileManagementAction(request);
                if (!result) throw new Error('Profilverwaltung konnte nicht angewendet werden.');
                await flushManagerRecords(); confirmed = true;
                closeTrancheModal(document, { confirmed: true, navigationOperation: operation });
                closeCashPostingModal(document, { confirmed: true, navigationOperation: operation });
                closeManagerAuxiliaryDialog('sale', document, { confirmed: true, navigationOperation: operation });
                clearReconciliationPreview({ resetForm: true, navigationOperation: operation });
                initTranchenManagerPage({ profileId: getCurrentProfileId() });
                renderManagerView(document, { ...getManagerView(document), kind: request.kind === 'create' ? 'person' : getManagerView(document)?.kind || 'person', profileId: state.profileId });
                refreshManagerProfiles(document, state.profileId);
                renderSuiteProfile(document);
                renderManagerPeople(document, state.profileId);
                confirmManagerModalBaseline('people', document);
                message('Personenverwaltung dauerhaft gespeichert.', 'ok');
                return true;
            } catch (error) {
                if (!confirmed) {
                    for (const key of listProfileScopedKeys()) if (!previous.has(key)) previous.set(key, null);
                    const restored = await restoreManagerRecords(previous);
                    updateActiveProfileLabel(origin);
                    renderSuiteProfile(document);
                    if (!restored) showManagerProfileRecovery({ status: 'unavailable', canReset: false,
                        message: 'Personenverwaltung und Rückschreiben konnten nicht dauerhaft bestätigt werden.' });
                } else showManagerProfileRecovery({ status: 'unavailable', canReset: false,
                    message: 'Personenverwaltung gespeichert; die Ansicht konnte nicht erneuert werden. Bitte neu laden.' });
                const recovery = getProfileRecoveryFromError(error);
                if (recovery) showManagerProfileRecovery(recovery);
                message(`Personenverwaltung fehlgeschlagen. ${error.message}`, 'error');
                return false;
            }
        });
    } finally {
        if (attempt) guard.end(attempt);
        renderPersistenceState();
    }
}

/** Vor der Verlustentscheidung steht der bestätigte Abschluss des Profilautosaves. */
export async function switchManagerProfile(profileId, opener) {
    if (!profileId || profileId === state.profileId) return false;
    if (byId('managerProfileRecovery')?.hidden === false) return false;
    const guard = getPageNavigationGuard(document);
    if (guard.isBusy() || guard.reasons().some(reason => reason.phase === 'commit')) return false;
    if (!await flushManagerHouseholdPlan()) return false;
    let values;
    try { values = readProfileAssetValuesFromDom(); }
    catch (error) { showProfileValidationStatus(error); return false; }
    if (state.profileSaveTimer !== null) clearTimeout(state.profileSaveTimer);
    state.profileSaveTimer = null;
    // Während Kursvorbereitung sind Profilfelder gesperrt. Ein unveränderter
    // Profilstand braucht keinen konkurrierenden Saver; guard beendet den Kursjob.
    if (state.pendingProfileValues || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline) {
        if (!await saveProfileValues(state.pendingProfileValues || values)) return false;
    }
    const origin = state.profileId;
    let previous = null;
    let confirmed = false;
    let loaded = false;
    try {
        setManagerControlsBlocked(true);
        const outcome = await guard.reload({ opener, returnResult: true,
            mutate: () => {
                previous = new Map(Object.entries(captureProfileData()));
                for (const key of Object.values(PROFILE_STORAGE_KEYS)) previous.set(key, persistenceStorage.getItem(key));
                if (!switchProfile(profileId)) throw new Error('PROFILE_SWITCH_FAILED');
            },
            flush: async () => { await flushManagerRecords(); confirmed = true; },
            reload: () => {
                // In-place-Wechsel: die Navigationsreservierung endet synchron
                // nach Flush, bevor neue Baselines und Dialogprovider entstehen.
                guard.revokeNative();
                closeTrancheModal(document, { confirmed: true });
                closeCashPostingModal(document, { confirmed: true });
                closeManagerAuxiliaryDialog('sale', document, { confirmed: true });
                closeManagerAuxiliaryDialog('people', document, { confirmed: true });
                clearReconciliationPreview({ resetForm: true });
                initTranchenManagerPage({ profileId });
                renderSuiteProfile(document);
                loaded = true;

            }
        });
        if (outcome.error) throw outcome.error;
        if (outcome.status === 'reload_required' && confirmed) {
            showManagerProfileRecovery({ status: 'unavailable', canReset: false,
                message: 'Profilwechsel gespeichert; die Ansicht konnte nicht erneuert werden. Bitte neu laden.' });
        }
        if (outcome.status === 'reloaded') {
            renderManagerView(document, { kind: 'person', profileId });
            refreshManagerProfiles(document, profileId);
            byId('managerSectionNav')?.querySelector?.('[aria-selected="true"]')?.focus?.();
        }
        return outcome.status === 'reloaded';
    } catch (error) {
        // switchProfile schreibt zunächst den Cache. Ohne bestätigten Flush
        // stellen wir auch Kennungen und alle profilbezogenen Keys zurück.
        if (previous && !confirmed) {
            for (const key of listProfileScopedKeys()) if (!previous.has(key)) previous.set(key, null);
            const restored = await restoreManagerRecords(previous);
            state.persistenceError = restored
                ? 'Person konnte nicht dauerhaft gewechselt werden. Das Ursprungsprofil bleibt geöffnet.'
                : 'Profilwechsel und dauerhaftes Rückschreiben konnten nicht bestätigt werden. Bitte erneut versuchen.';
            if (!restored) showManagerProfileRecovery({ status: 'unavailable', canReset: false, message: state.persistenceError });
            updateActiveProfileLabel(origin);
            renderSuiteProfile(document);
        } else state.persistenceError = 'Person konnte nicht geladen werden. Bitte erneut versuchen.';
        const recovery = getProfileRecoveryFromError(error);
        if (recovery) showManagerProfileRecovery(recovery);
        return false;
    } finally {
        renderPersistenceState();
        if (byId('managerProfileRecovery')?.hidden === false) setManagerControlsBlocked(true);
        else if (!loaded) {
            const targets = byId('managerSectionNav')?.querySelectorAll?.('[data-manager-profile]') || [];
            Array.from(targets).find(button => button.dataset.managerProfile === profileId)?.focus();
        }
    }
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
        if (!managerTargetBindings.has(document)) {
            const doc = document;
            window.addEventListener('hashchange', () => {
                if (document === doc && state.boundDocument === doc) void openManagerOverviewTarget(window.location, { ready: state.loadStatus !== 'unavailable' });
            });
            managerTargetBindings.add(doc);
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

function managerSelectionIsBlocked() {
    return personManagementPending || Boolean(window?.__personMigrationDeferred)
        || state.commitInFlight || state.cashPostingInFlight || state.profileCommitInFlight
        || state.householdPlan?.read().writing || PersistenceFacade.hasSyncWriteBlocks?.()
        || byId('managerProfileRecovery')?.hidden === false
        || state.loadStatus === 'corrupt' || state.loadStatus === 'unavailable'
        || getPageNavigationGuard(document).isBusy();
}
const managerViewRequests = new WeakMap();
const managerTargetBindings = new WeakSet();

/** Auswahl wird erst nach bestätigter Sicherung und Verlustentscheidung veröffentlicht. */
export function selectManagerView(view, { opener = document.activeElement, doc = document } = {}) {
    if (managerViewRequests.has(doc)) return Promise.resolve(false);
    if (doc !== document || managerSelectionIsBlocked()) return Promise.resolve(false);
    const registry = loadProfileRegistry().value;
    if (!registry?.profiles[view.profileId] || !['person', 'plan', 'history'].includes(view.kind)) return Promise.resolve(false);
    const pending = Promise.resolve().then(async () => {
        if (view.profileId !== state.profileId) {
            if (!await switchManagerProfile(view.profileId, opener)) return false;
        } else {
            if (!await flushManagerHouseholdPlan()) return false;
            let values;
            try { values = readProfileAssetValuesFromDom(); }
            catch (error) { showProfileValidationStatus(error); return false; }
            if (state.profileSaveTimer !== null) clearTimeout(state.profileSaveTimer);
            state.profileSaveTimer = null;
            if (state.pendingProfileValues || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline) {
                if (!await saveProfileValues(state.pendingProfileValues || values)) return false;
            }
            const guard = getPageNavigationGuard(doc);
            let attempt;
            try {
                attempt = await guard.prepare({ opener });
                if (!attempt || !guard.validate(attempt)) return false;
                guard.end(attempt); attempt = null;
                closeTrancheModal(doc, { confirmed: true });
                closeCashPostingModal(doc, { confirmed: true });
                closeManagerAuxiliaryDialog('sale', doc, { confirmed: true });
                closeManagerAuxiliaryDialog('people', doc, { confirmed: true });
                clearReconciliationPreview({ resetForm: true });
                state.historyStartDraft = null;
            } finally { if (attempt) guard.end(attempt); }
        }
        if (doc !== document || state.boundDocument !== doc) return false;
        renderManagerView(doc, view);
        refreshManagerProfiles(doc, state.profileId);
        // Rerender kann den ursprünglichen Button ersetzt haben.
        const tab = byId('managerSectionNav')?.querySelector?.('[aria-selected="true"]');
        tab?.focus?.();
        return true;
    }).catch(() => false).finally(() => {
        managerViewRequests.delete(doc);
        renderPersistenceState();
    });
    managerViewRequests.set(doc, pending);
    return pending;
}

// Ausschließlich bekannte DOM-Ziele; URL-Daten werden nie als Selektoren verwendet.
const managerTargets = {
    verlauf: { kind: 'history', historyScope: 'person', focus: 'managerWealthHistory' },
    managerWealthHistory: { kind: 'history', historyScope: 'person', focus: 'managerWealthHistory' },
    managerWealthTitle: { kind: 'history', historyScope: 'person', focus: 'managerWealthTitle' },
    'haushalt-plan': { kind: 'plan', focus: 'haushalt-plan' },
    managerHouseholdPlan: { kind: 'plan', focus: 'haushalt-plan' },
    managerPlanComparisonCard: { kind: 'plan', focus: 'managerPlanComparisonTitle' },
    personen: { kind: 'person', focus: 'managePeopleBtn', people: true },
    personendaten: { kind: 'person', card: 'Person', focus: 'profileGeburtsdatum' },
    managerProfileValues: { kind: 'person', card: 'Person', focus: 'managerPersonToggle' },
    profileTagesgeld: { kind: 'person', focus: 'profileTagesgeld' },
    profileGoldZiel: { kind: 'person', card: 'Assets', focus: 'profileGoldZiel' },
    managerAssetsBody: { kind: 'person', card: 'Assets', focus: 'managerAssetsToggle' },
    managerCareBody: { kind: 'person', card: 'Care', focus: 'managerCareToggle' },
    managerDepotTitle: { kind: 'person', focus: 'managerDepotTitle' },
    stats: { kind: 'person', focus: 'managerDepotTitle' },
    reconciliationTitle: { kind: 'person', focus: 'reconciliationTitle' },
    reconciliationCashStatuses: { kind: 'person', focus: 'reconciliationTitle' },
    managerTechnical: { kind: 'person', technical: true, focus: 'managerTechnical' }
};

export function resolveManagerTarget(location) {
    const target = (location?.hash || '').slice(1);
    if (!Object.hasOwn(managerTargets, target)) return null;
    const params = new URLSearchParams(location?.search || '');
    if ([...params.keys()].some(key => key !== 'person') || params.getAll('person').length > 1 || params.get('person') === '') return null;
    // Die bestehende Übersichtszielvalidierung bleibt für ihre Ziele verbindlich.
    if (['haushalt-plan', 'profileTagesgeld'].includes(target) && !parseOverviewTarget('manager', location)) return null;
    const person = params.get('person');
    if (person && !Object.hasOwn(loadProfileRegistry().value?.profiles || {}, person)) return null;
    return { ...managerTargets[target], target, profileId: person || state.profileId };
}

export async function openManagerOverviewTarget(location, { ready = false, blocked = processingIsBlocked(), doc = document } = {}) {
    const target = resolveManagerTarget(location);
    if (!ready || blocked || !target || !await selectManagerView({ kind: target.kind, profileId: target.profileId, ...(target.historyScope ? { historyScope: target.historyScope } : {}) }, { doc })) return false;
    if (target.card) {
        const toggle = doc.getElementById(`manager${target.card}Toggle`);
        if (doc.getElementById(`manager${target.card}Body`)?.hidden) toggle?.click();
    }
    if (target.technical) { const details = doc.getElementById('managerTechnical'); if (details) details.open = true; }
    if (target.people) {
        const button = doc.getElementById('managePeopleBtn');
        if (!button || button.disabled) return false;
        button.click(); return true;
    }
    const focusId = target.target === 'personendaten' && doc.getElementById('managerBirthSupplement')?.hidden === false
        ? 'managerBirthDate' : target.focus;
    const element = doc.getElementById(focusId);
    if (!element || element.disabled) return false;
    if (!['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(element.tagName)) element.setAttribute?.('tabindex', '-1');
    element.scrollIntoView?.({ block: 'start' }); element.focus?.();
    return true;
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
                state.pendingProfileValues, state.reconciliationPreview?.action, state.profileSaveTimer !== null, state.historyStartDraft, state.householdPlan?.read()]);
            if (inputs !== lastInputs) { lastInputs = inputs; revision++; }
            return {
                revision,
                dirty: Boolean(state.pendingCommit || state.pendingReconciliation || state.pendingCashPosting || state.pendingProfileValues || state.profileSaveTimer !== null
                    || state.householdPlan?.read().dirty
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
            notify: () => state.navigationRegistration?.notify(),
            runOperation: async execute => {
                try { return await state.navigationLifecycle.run({}, execute); }
                finally { renderPersistenceState(); }
            } });
        else if (profileChanged) { state.householdPlan.discard(); state.householdPlan.refresh(); }
        else state.householdPlan.refresh();
    }
    render();
    renderPersistenceState();
    bindManagerPersonCards(document, () => state.profileId).sync();
    observeSelectionText(document.body);
    return result;
}

export function flushManagerHouseholdPlan() {
    return state.householdPlan?.flush() || Promise.resolve(true);
}
