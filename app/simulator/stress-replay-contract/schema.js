// @ts-check
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
"use strict";

export const STRESS_REPLAY_SCHEMA_VERSIONS = Object.freeze({
    path: 'StressReplayPathV1',
    sourceIdentity: 'StressReplaySourceIdentityV2',
    variant: 'StressReplayVariantV1',
    variantResult: 'StressReplayVariantResultV1',
    comparison: 'StressReplayComparisonV1',
    comparisonExport: 'StressReplayComparisonExportV1',
    workspace: 'StressReplayWorkspaceV1'
});

export const STRESS_REPLAY_SOURCE_IDENTITY_SCHEMA_VERSION_V1 = 'StressReplaySourceIdentityV1';

export const STRESS_REPLAY_SOURCE_IDENTITY_SCHEMA_VERSION_V2 = 'StressReplaySourceIdentityV2';

export const STRESS_REPLAY_CONTRACT_VERSION = 'stress-replay-contract-v1';

export const STRESS_REPLAY_VARIANT_WHITELIST_VERSION_V1 = 'StressReplayVariantWhitelistV1';

export const STRESS_REPLAY_VARIANT_WHITELIST_VERSION_V2 = 'StressReplayVariantWhitelistV2';

export const STRESS_REPLAY_VARIANT_WHITELIST_VERSION = STRESS_REPLAY_VARIANT_WHITELIST_VERSION_V2;

export const STRESS_REPLAY_VARIANT_CONTRACT_KEYS_V1 = Object.freeze([
    'schemaVersion',
    'contractVersion',
    'whitelistVersion',
    'id',
    'role',
    'label',
    'baselineScenarioFingerprint',
    'patch',
    'normalizedInputFingerprint',
    'materialChangeGroups',
    'warnings',
    'variantFingerprint'
]);

export const STRESS_REPLAY_FINGERPRINT_ALGORITHM = 'sha256-canonical-json-v1';

export const STRESS_REPLAY_SCOPE = 'single-materialized-monte-carlo-path';

export const STRESS_REPLAY_LIMITS = Object.freeze({
    maximumPathBytes: 1024 * 1024,
    maximumEnvelopeBytes: 2 * 1024 * 1024,
    maximumAlternatives: 3,
    maximumVariants: 4,
    maximumSourceIdentityRows: 60
});

export const STRESS_REPLAY_COMPARISON_KPIS_V1 = Object.freeze([
    Object.freeze({ field: 'finalValueNominalEur', unit: 'nominal_eur' }),
    Object.freeze({ field: 'finalValueRealEur', unit: 'real_eur' }),
    Object.freeze({ field: 'maximumDrawdownNominalPct', unit: 'percentage_points' }),
    Object.freeze({ field: 'maximumDrawdownRealPct', unit: 'percentage_points' }),
    Object.freeze({ field: 'totalWithdrawalsEur', unit: 'nominal_eur' }),
    Object.freeze({ field: 'totalFlexFulfilledEur', unit: 'nominal_eur' }),
    Object.freeze({ field: 'totalMinimumFlexShortfallEur', unit: 'nominal_eur' }),
    Object.freeze({ field: 'totalTaxesEur', unit: 'nominal_eur' }),
    Object.freeze({ field: 'totalHealthBucketUsedEur', unit: 'nominal_eur' }),
    Object.freeze({ field: 'financiallyEvaluatedYears', unit: 'years' }),
    Object.freeze({ field: 'ruinYear', unit: 'zero_based_year_index' })
]);

export const STRESS_REPLAY_UNITS_V1 = Object.freeze({
    equityReturnPct: 'percent_per_year',
    goldReturnPct: 'percent_per_year',
    cashReturnPct: 'percent_per_year',
    inflationPct: 'percent_per_year',
    wageGrowthPct: 'percent_per_year',
    capeRatio: 'ratio',
    monetaryValues: 'nominal_eur'
});

export const THREE_BUCKET_MODE = '3_bucket_jilge';

export const STANDARD_MODE = 'standard';

export const HORIZON_METHODS = new Set(['mean', 'survival_quantile']);

export const TERMINAL_STATUSES = new Set(['horizon_exhausted', 'all_dead', 'ruin']);

export const RESULT_TERMINAL_STATUSES = new Set([...TERMINAL_STATUSES, 'technical_error']);

export const RECORD_TYPES = new Set(['financial_year', 'terminal_ruin', 'terminal_death']);

export const YEAR_RESULT_STATUSES = new Set(['financial_year', 'ruin', 'terminal_death']);

export const SOURCE_TIE_BREAK = 'smallest_absolute_run_index';

export const SOURCE_RECONCILIATION_FIELDS = Object.freeze([
    'recordType', 'jahr', 'histJahr',
    ...['wertAktien', 'wertGold', 'liquiditaet', 'floor_brutto', 'rente1', 'rente2',
        'renteSum', 'flex_erfuellt_nominal', 'jahresentnahme_real', 'health_bucket_end', 'portfolio_total_end'],
    ...['inflation', 'FlexRatePct', 'QuoteEndPct', 'RealReturnEquityPct', 'RealReturnGoldPct'],
    'entscheidung'
]);

export const SOURCE_IDENTITY_FIELD_SET = new Set([
    'recordType', 'jahr', 'histJahr', 'reconciliationFingerprint'
]);

export const SOURCE_IDENTITY_V2_FIELD_SET = new Set([
    't', 'y', 'h', 'r'
]);

export const SOURCE_IDENTITY_V2_RECONCILIATION_FIELDS = Object.freeze([
    Object.freeze(['a', 'wertAktien']),
    Object.freeze(['b', 'wertGold']),
    Object.freeze(['c', 'liquiditaet']),
    Object.freeze(['d', 'floor_brutto']),
    Object.freeze(['e', 'rente1']),
    Object.freeze(['f', 'rente2']),
    Object.freeze(['g', 'renteSum']),
    Object.freeze(['h', 'flex_erfuellt_nominal']),
    Object.freeze(['i', 'jahresentnahme_real']),
    Object.freeze(['j', 'inflation']),
    Object.freeze(['k', 'FlexRatePct']),
    Object.freeze(['l', 'QuoteEndPct']),
    Object.freeze(['m', 'RealReturnEquityPct']),
    Object.freeze(['n', 'RealReturnGoldPct']),
    Object.freeze(['o', 'entscheidung']),
    Object.freeze(['p', 'health_bucket_end']),
    Object.freeze(['q', 'portfolio_total_end'])
]);

export const FINGERPRINT_EXCLUDED_KEYS = new Set([
    'createdAtUtc',
    'updatedAtUtc',
    'exportedAtUtc',
    'displayName',
    'displayLabel',
    'label'
]);
