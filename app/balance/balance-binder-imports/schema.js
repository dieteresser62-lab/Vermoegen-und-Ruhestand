// @ts-check
import { LIQUIDITY_RUNWAY_CONTRACT_V1 } from '../../../types/liquidity-runway-contract.js';

export const BALANCE_EXPORT_APP_ID = 'ruhe-stand-suite.balance';

export const BALANCE_EXPORT_SCHEMA = 'balance-state';

export const BALANCE_EXPORT_SCHEMA_VERSION = 2;

export const BALANCE_IMPORT_INPUT_SCHEMA_VERSION = 2;

export const MANUAL_WINDOW_HIGH_ENGINE_POLICY = 'window_high_as_conservative_ath_lower_bound';
export const ANNUAL_MARKET_READINGS = Object.freeze(['year_end', 'year_high']);

const numberField = (options = {}) => Object.freeze({
    type: 'number',
    required: false,
    integer: false,
    min: null,
    max: null,
    ...options
});

const booleanField = (options = {}) => Object.freeze({
    type: 'boolean',
    required: false,
    ...options
});

const stringField = (options = {}) => Object.freeze({
    type: 'string',
    required: false,
    maxLength: 200,
    ...options
});

/**
 * Versioniertes Inventar aller Top-Level-Felder, die der Balance-Reader
 * persistiert und ein Balance-JSON-Import wieder in den Live-Inputpfad
 * uebernehmen darf. Komplexe Felder besitzen benannte Spezialvalidatoren.
 */
export const BALANCE_IMPORT_INPUT_SCHEMA_V2 = Object.freeze({
    aktuellesAlter: numberField({ integer: true, min: 0, max: 130 }),
    floorBedarf: numberField({ required: true, min: 0 }),
    flexBedarf: numberField({ required: true, min: 0 }),
    minimumFlexAnnual: numberField({ min: 0 }),
    flexBudgetAnnual: numberField({ min: 0 }),
    flexBudgetYears: numberField({ min: 0, max: 10 }),
    flexBudgetRecharge: numberField({ min: 0 }),
    inflation: numberField({ min: -10, max: 50 }),
    tagesgeld: numberField({ min: 0 }),
    geldmarktEtf: numberField({ min: 0 }),
    depotwertAlt: numberField({ min: 0 }),
    depotwertNeu: numberField({ min: 0 }),
    goldWert: numberField({ min: 0 }),
    endeVJ: numberField({ min: 0 }),
    endeVJ_1: numberField({ min: 0 }),
    endeVJ_2: numberField({ min: 0 }),
    endeVJ_3: numberField({ min: 0 }),
    ath: numberField({ min: 0 }),
    jahreSeitAth: numberField({ min: 0 }),
    renteAktiv: booleanField(),
    renteMonatlich: numberField({ min: 0 }),
    sonstigeEinkuenfte: numberField({ min: 0 }),
    risikoprofil: stringField({ enum: Object.freeze(['sicherheits-dynamisch']) }),
    goldAktiv: booleanField(),
    goldZielProzent: numberField({ min: 0, max: 50 }),
    goldFloorProzent: numberField({ min: 0, max: 20 }),
    goldSteuerfrei: booleanField(),
    rebalancingBand: numberField({ min: 0, max: 100 }),
    goldBasisVermoegen: numberField({ min: 0 }),
    goldZielBetrag: numberField({ min: 0 }),
    goldFloorBetrag: numberField({ min: 0 }),
    goldStrategyDiagnostics: Object.freeze({ type: 'goldStrategyDiagnostics', required: false }),
    costBasisAlt: numberField({ min: 0 }),
    costBasisNeu: numberField({ min: 0 }),
    tqfAlt: numberField({ min: 0, max: 1 }),
    tqfNeu: numberField({ min: 0, max: 1 }),
    goldCost: numberField({ min: 0 }),
    kirchensteuerSatz: numberField({ min: 0, max: 0.09, enum: Object.freeze([0, 0.08, 0.09]) }),
    sparerPauschbetrag: numberField({ min: 0 }),
    liquidityRunwayYears: numberField({
        min: LIQUIDITY_RUNWAY_CONTRACT_V1.minimumYears,
        max: LIQUIDITY_RUNWAY_CONTRACT_V1.maximumYears,
        step: LIQUIDITY_RUNWAY_CONTRACT_V1.stepYears
    }),
    liquidityCashMonths: numberField({ integer: true, min: 0, max: 120 }),
    minCashBufferMonths: numberField({ integer: true, min: 0, max: 12 }),
    maxSkimPctOfEq: numberField({ min: 0, max: 50 }),
    maxBearRefillPctOfEq: numberField({ min: 0, max: 70 }),
    marketCapeRatio: numberField({ min: 0, max: 100 }),
    capeRatio: numberField({ min: 0, max: 100 }),
    dynamicFlex: booleanField(),
    horizonMethod: stringField({ enum: Object.freeze(['mean', 'survival_quantile']) }),
    horizonYears: numberField({ integer: true, min: 1, max: 60 }),
    survivalQuantile: numberField({ min: 0.5, max: 0.99 }),
    goGoActive: booleanField(),
    goGoMultiplier: numberField({ min: 1, max: 1.5 }),
    longevityMode: stringField({
        enum: Object.freeze(['none', 'quantile_shift', 'relative_horizon_buffer', 'buffer_years'])
    }),
    longevityQuantileShift: numberField({ min: 0, max: 0.1 }),
    longevityRelativePct: numberField({ min: 0, max: 0.2 }),
    longevityBufferYears: numberField({ integer: true, min: 0, max: 10 }),
    healthBucketEnabled: booleanField(),
    healthBucketInitialAmount: numberField({ min: 0 }),
    healthBucketAssetSource: stringField({
        enum: Object.freeze(['money_market_first_then_cash'])
    }),
    healthBucketTriggerMinGrade: numberField({ integer: true, min: 1, max: 5 }),
    healthBucketTriggerMode: stringField({ enum: Object.freeze(['OR', 'AND']) }),
    healthBucketCoverageMode: stringField({
        enum: Object.freeze(['care_additional_floor_only', 'floor_when_care_active'])
    }),
    healthBucketReturnMode: stringField({ enum: Object.freeze(['cash_return']) }),
    healthBucketTargetMode: stringField({
        enum: Object.freeze(['inflation_indexed_diagnostic', 'nominal_fixed'])
    }),
    profilName: stringField({ maxLength: 200 }),
    depotLastUpdate: numberField({ integer: true, min: 0 }),
    decumulation: Object.freeze({ type: 'decumulation', required: false }),
    healthBucket: Object.freeze({ type: 'healthBucket', required: false }),
    detailledTranches: Object.freeze({ type: 'tranchesOrNull', required: false })
});

export const LEGACY_BOOLEAN_INPUT_FIELDS = Object.freeze([
    'renteAktiv',
    'goldAktiv',
    'goldSteuerfrei',
    'dynamicFlex',
    'goGoActive',
    'healthBucketEnabled'
]);

export const HEALTH_BUCKET_FIELDS = Object.freeze({
    enabled: booleanField(),
    initialAmount: numberField({ min: 0 }),
    assetSource: stringField({ enum: Object.freeze(['money_market_first_then_cash']) }),
    triggerMinGrade: numberField({ integer: true, min: 1, max: 5 }),
    triggerMode: stringField({ enum: Object.freeze(['OR', 'AND']) }),
    coverageMode: stringField({
        enum: Object.freeze(['care_additional_floor_only', 'floor_when_care_active'])
    }),
    returnMode: stringField({ enum: Object.freeze(['cash_return']) }),
    targetMode: stringField({
        enum: Object.freeze(['inflation_indexed_diagnostic', 'nominal_fixed'])
    })
});

export const DECUMULATION_FIELDS = Object.freeze({
    mode: stringField({ enum: Object.freeze(['standard', '3_bucket_jilge']) }),
    bondTargetFactor: numberField({ min: 0 }),
    drawdownTrigger: numberField({ min: -100, max: 100 }),
    bondRefillThreshold: Object.freeze({ type: 'nullableNumber', min: -100, max: 100 }),
    threeBucket: Object.freeze({ type: 'decumulationNested', required: false })
});

export const GOLD_STRATEGY_DIAGNOSTIC_FIELDS = Object.freeze({
    profileId: stringField({ required: true }),
    name: stringField({ required: true }),
    assetBase: numberField({ required: true, min: 0 }),
    operativeLiquidity: numberField({ required: true, min: 0 }),
    excludedHealthBucket: numberField({ required: true, min: 0 }),
    freeAssetBase: numberField({ required: true, min: 0 }),
    goldAktiv: booleanField({ required: true }),
    goldZielProzent: numberField({ required: true, min: 0 }),
    goldFloorProzent: numberField({ required: true, min: 0 }),
    goldZielBetrag: numberField({ required: true, min: 0 }),
    goldFloorBetrag: numberField({ required: true, min: 0 }),
    rebalancingBand: numberField({ required: true, min: 0 }),
    goldSteuerfrei: booleanField({ required: true })
});

export const SUPPORTED_LEGACY_APP_VERSIONS = new Set([
    'v21.1 Refactored (Engine v31)',
    'v22.0 ES6 Modules (Engine v31)'
]);
