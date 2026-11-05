// @ts-check

import { EURO_PATH_FIELDS } from '../mc-euro-metrics.js';
export const MONTE_CARLO_CHUNK_RESULT_VERSION = 'MonteCarloChunkResultV1';

export const MONTE_CARLO_OUTCOME_INVENTORY_VERSION = 'MonteCarloOutcomeInventoryV1';

export const MONTE_CARLO_OUTCOME_CODE = Object.freeze({
    UNSET: 0,
    RUIN: 1,
    ALL_DEAD: 2,
    HORIZON_EXHAUSTED: 3,
    TECHNICAL_ERROR: 4
});

export const MONTE_CARLO_OUTCOME_NAME_BY_CODE = Object.freeze({
    [MONTE_CARLO_OUTCOME_CODE.RUIN]: 'ruin',
    [MONTE_CARLO_OUTCOME_CODE.ALL_DEAD]: 'all_dead',
    [MONTE_CARLO_OUTCOME_CODE.HORIZON_EXHAUSTED]: 'horizon_exhausted',
    [MONTE_CARLO_OUTCOME_CODE.TECHNICAL_ERROR]: 'technical_error'
});

export const MONTE_CARLO_MISSINGNESS_CODE = Object.freeze({
    UNSET: 0,
    OBSERVED: 1,
    NOT_APPLICABLE: 2,
    TECHNICAL_ERROR: 3,
    NO_OBSERVATIONS: 4,
    DIED_BEFORE_FIRST_OBLIGATION: 5,
    MISSING_INFLATION: 6,
    MISSING_YEAR_VALUES: 7
});

export const MONTE_CARLO_BUFFER_FIELDS = Object.freeze({
    finalOutcomes: Float64Array,
    taxOutcomes: Float64Array,
    kpiLebensdauer: Uint32Array,
    kpiKuerzungsjahre: Float32Array,
    cutYearShareRatio: Float32Array,
    cutYearShareMissingness: Uint8Array,
    kpiMaxKuerzung: Float32Array,
    volatilities: Float32Array,
    maxDrawdowns: Float32Array,
    realMaxDrawdowns: Float32Array,
    realMaxDrawdownObservationCount: Uint32Array,
    realMaxDrawdownMissingness: Uint8Array,
    depotErschoepft: Uint8Array,
    alterBeiErschoepfung: Uint32Array,
    alterBeiErschoepfungMissingness: Uint8Array,
    anteilJahreOhneFlex: Float32Array,
    stress_maxDrawdowns: Float32Array,
    stress_timeQuoteAbove45: Float32Array,
    stress_cutYears: Float32Array,
    stress_CaR_P10_Real: Float64Array,
    stress_realWithdrawalObservationCount: Uint32Array,
    stress_realWithdrawalP10Missingness: Uint8Array,
    stress_recoveryYears: Float32Array,
    realWithdrawalP10RealEur: Float64Array,
    realWithdrawalObservationCount: Uint32Array,
    realWithdrawalP10Missingness: Uint8Array,
    meanWithdrawalRateRatio: Float64Array,
    withdrawalRateObservationCount: Uint32Array,
    meanWithdrawalRateMissingness: Uint8Array
});

export const MONTE_CARLO_COUNTER_FIELDS = Object.freeze([
    'failCount',
    'outcomeRuinCount',
    'outcomeAllDeadCount',
    'outcomeHorizonExhaustedCount',
    'pflegeTriggeredCount',
    'p1TriggeredCount',
    'p2TriggeredCount',
    'totalSimulatedYears',
    'totalYearsQuoteAbove45',
    'totalYearsSafetyStage1plus',
    'totalYearsSafetyStage2',
    'shortfallWithCareCount',
    'shortfallNoCareProxyCount',
    'runsSafetyStage1Triggered',
    'runsSafetyStage2Triggered',
    'healthBucketEnabledCount',
    'healthBucketUsedCount',
    'healthBucketDepletedCount',
    'tailRiskRunsActiveCount',
    'tailRiskRunsAppliedCount',
    'tailRiskEventCount',
    'tailRiskEvaluatedYears',
    'tailRiskActiveYears',
    'tailRiskAppliedYears',
    'tailRiskSkippedHistoricalCrisisYears'
]);

export const MONTE_CARLO_FLOAT_AGGREGATE_FIELDS = Object.freeze([
    'totalTaxSavedByLossCarry',
    'totalHealthBucketUsed'
]);

export const MONTE_CARLO_LIST_FIELDS = Object.freeze([
    'entryAges',
    'entryAgesP2',
    'p1CareAdditionalNeedRealEur',
    'p2CareAdditionalNeedRealEur',
    'totalCareAdditionalNeedRealEur',
    'endWealthWithCareRealEur',
    'endWealthNoCareRealEur',
    'p1CareYearsTriggered',
    'p2CareYearsTriggered',
    'bothCareYearsOverlapTriggered',
    'maxAnnualCareAdditionalNeedRealEur',
    'healthBucketUsedAmounts',
    'healthBucketEndAmounts',
    'healthBucketCoveragePct',
    'healthBucketTargetGaps',
    'healthBucketInterestAmounts'
]);

export const MONTE_CARLO_PATH_SUMMARY_FIELDS = Object.freeze({
    ...EURO_PATH_FIELDS,
    globalRunIndex: Uint32Array,
    outcomeCode: Uint8Array,
    finalValueNominalEur: Float64Array,
    finalValueRealEur: Float64Array,
    displayHomeValueNominalEur: Float64Array,
    displayHomeValueRealEur: Float64Array,
    volatilityPct: Float32Array,
    maxDrawdownPct: Float32Array,
    maxDrawdownRealPct: Float32Array,
    maxDrawdownRealObservationCount: Uint32Array,
    cutYearsNumerator: Uint32Array,
    cutYearsDenominator: Uint32Array,
    minimumFlexCompletedYearCount: Uint32Array,
    minimumFlexObservationCount: Uint32Array,
    minimumFlexAffectedYearCount: Uint32Array,
    minimumFlexYearShareRatio: Float64Array,
    minimumFlexPaidMedianNominalEur: Float64Array,
    minimumFlexDesiredMedianNominalEur: Float64Array,
    minimumFlexPaidMinimumNominalEur: Float64Array,
    cutYearShareRatio: Float32Array,
    realWithdrawalP10RealEur: Float64Array,
    realWithdrawalObservationCount: Uint32Array,
    meanWithdrawalRateRatio: Float64Array,
    withdrawalRateObservationCount: Uint32Array,
    p1CareEntryAge: Uint16Array,
    p2CareEntryAge: Uint16Array,
    p1CareYears: Uint16Array,
    p2CareYears: Uint16Array,
    bothCareYears: Uint16Array,
    careEverActive: Uint8Array,
    hasPartner: Uint8Array,
    p1CareAdditionalNeedRealEur: Float64Array,
    p2CareAdditionalNeedRealEur: Float64Array,
    totalCareAdditionalNeedRealEur: Float64Array,
    maxAnnualCareAdditionalNeedRealEur: Float64Array,
    p1CareAdditionalNeedNominalEur: Float64Array,
    p2CareAdditionalNeedNominalEur: Float64Array,
    totalCareAdditionalNeedNominalEur: Float64Array,
    maxAnnualCareAdditionalNeedNominalEur: Float64Array,
    healthBucketEnabled: Uint8Array,
    healthBucketUsedEur: Float64Array,
    healthBucketEndEur: Float64Array,
    healthBucketCoveragePct: Float64Array,
    healthBucketTargetGapEur: Float64Array,
    healthBucketInterestEur: Float64Array,
    taxSavedByLossCarryEur: Float64Array
});

export const MONTE_CARLO_PATH_MISSINGNESS_FIELDS = Object.freeze({
    euroMetrics: Uint8Array,
    euroRealAmounts: Uint8Array,
    path: Uint8Array,
    minimumFlexRestriction: Uint8Array,
    maxDrawdownRealPct: Uint8Array,
    cutYearShareRatio: Uint8Array,
    realWithdrawalP10RealEur: Uint8Array,
    meanWithdrawalRateRatio: Uint8Array,
    stressRealWithdrawalP10RealEur: Uint8Array,
    p1CareEntryAge: Uint8Array,
    p2CareEntryAge: Uint8Array,
    p1CareAdditionalNeedRealEur: Uint8Array,
    p2CareAdditionalNeedRealEur: Uint8Array,
    totalCareAdditionalNeedRealEur: Uint8Array,
    maxAnnualCareAdditionalNeedRealEur: Uint8Array,
    p1CareAdditionalNeedNominalEur: Uint8Array,
    p2CareAdditionalNeedNominalEur: Uint8Array,
    totalCareAdditionalNeedNominalEur: Uint8Array,
    maxAnnualCareAdditionalNeedNominalEur: Uint8Array,
    healthBucketCoveragePct: Uint8Array
});

export const PATH_TRANSFER_PREFIX = '__mcChunkV1Path_';

export const MISSINGNESS_TRANSFER_PREFIX = '__mcChunkV1Missing_';

export const MAX_TECHNICAL_ERROR_SAMPLES = 20;
