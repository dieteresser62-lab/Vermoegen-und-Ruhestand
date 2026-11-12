// @ts-check
import { calculateTrancheDerivedValues, loadTranchesFromStorage } from '../tranchen-manager-state.js';
import { PERSON_FORM_IDS } from '../../profile/profile-asset-values.js';
import { PROFILE_CASH_HISTORY_KEY } from '../../profile/profile-wealth-history.js';
import { PROFILE_VALUE_KEYS, PROFILE_HEALTH_BUCKET_KEY } from '../../profile/profile-state.js';

import { projectReconciliationCashStatuses } from '../tranche-reconciliation.js';

export const state = {
    personManagementPending: false,
    managerViewRequests: new WeakMap(),
    managerTargetBindings: new WeakSet(),
    /** @type {typeof import('./startup.js').initTranchenManagerPage} */
    initializePage: null,
    householdPlan: null,
    partnership: null,
    immobilien: null,
    plannedExpenses: null,
    historyUI: null,
    historyStartDraft: null,
    historyRecoveryMessage: '',
    /** @type {ReadonlyArray<ReturnType<typeof calculateTrancheDerivedValues>>} */
    tranchen: [],
    /** @type {ReadonlyArray<ReturnType<typeof calculateTrancheDerivedValues>>} */
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
    persistenceMessageTimer: null,
    persistenceMessageRevision: 0,
    persistenceError: '',
    taxMigrationWarning: '',
    rawRevealed: false,
    reconciliationPreview: null,
    pendingReconciliation: null,
    reconciliationStatus: '',
    reconciliationError: '',
    /** @type {ReadonlyArray<ReturnType<typeof projectReconciliationCashStatuses>[number]>} */
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

export const PROFILE_SAVE_DEBOUNCE_MS = 300;

export const QUOTE_BATCH_CONCURRENCY = 3;

export const QUOTE_BATCH_TIMEOUT_MS = 12000;

export const RECONCILIATION_INPUT_IDS = [
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

export const PROFILE_INPUT_IDS = [
    'profileImmobilien',
    'profileCareGradeToday', 'profileCareFormToday', 'profileCareResidentialSince', 'profileCareHomeCostsMonthly', 'profileCareProgression',
    'profileEinkuenfte',
    'profileTagesgeld',
    ...Object.values(PERSON_FORM_IDS),
    'profileRenteMonatlich',
    'profileRenteBezeichnung',
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

export const PROFILE_ASSET_STORAGE_KEYS = [
    PROFILE_CASH_HISTORY_KEY,
    ...Object.values(PROFILE_VALUE_KEYS),
    PROFILE_HEALTH_BUCKET_KEY
];

export const PROFILE_ERROR_DOM_IDS = Object.freeze({
    'careToday.grade': 'profileCareGradeToday',
    'careToday.form': 'profileCareFormToday',
    'careToday.residentialSince': 'profileCareResidentialSince',
    'careToday.homeCostsMonthly': 'profileCareHomeCostsMonthly',
    'careToday.progression': 'profileCareProgression',
    tagesgeld: 'profileTagesgeld',
    renteMonatlich: 'profileRenteMonatlich',
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
