/** @import {ExportBuildOptions,ExportV1,ExportV2,ExportReadOptions,ScenarioSourceRow,ScenarioExportRow,ScenarioMeasurements,ScenarioLogDocument,PersonDataContext} from '../../../typcheck/rechenkern' */

"use strict";

export const MONTE_CARLO_EXPORT_SCHEMA_ID = 'de.ruhestandsapp.monte-carlo.run';

export const MONTE_CARLO_EXPORT_V1_VERSION = 'MonteCarloExportV1';

// Deprecated compatibility name: prior consumers used the unqualified
// constant for V1. New code must select an explicit version constant.
export const MONTE_CARLO_EXPORT_VERSION = MONTE_CARLO_EXPORT_V1_VERSION;

export const MONTE_CARLO_EXPORT_V2_VERSION = 'MonteCarloExportV2';

export const SCENARIO_LOG_EXPORT_VERSION = 'ScenarioLogExportV2';

export const SCENARIO_LOG_UNIT_CONTRACT_VERSION = 'ScenarioLogUnitContractV2';

export const MONTE_CARLO_APP_VERSION = Object.freeze({
    applicationId: 'de.ruhestandsapp.suite',
    packageVersion: '1.0.0',
    desktopBundleVersion: '0.1.0'
});

export const TOP_LEVEL_FIELDS = new Set([
    'personDataContext',
    'schemaId',
    'schemaVersion',
    'exportedAtUtc',
    'identifiers',
    'fingerprint',
    'app',
    'engine',
    'snapshotPolicy',
    'request',
    'result',
    'compatibility',
    'privacy'
]);

export const REQUEST_FIELDS = new Set([
    'schemaVersion',
    'parameters',
    'sampling',
    'stress',
    'scenario',
    'data',
    'execution',
    'snapshotPolicy'
]);

export const RESULT_FIELDS = new Set([
    'schemaVersion',
    'batchStatus',
    'financialMetricsValid',
    'sampleSize',
    'technicalErrorCount',
    'outcomeInventory',
    'kpis',
    'uncertainty',
    'missingness',
    'diagnostics',
    'warnings',
    'unitContract'
]);

export const SCENARIO_RECORD_TYPES = new Set(['financial_year', 'terminal_ruin', 'terminal_death']);

export const SCENARIO_V1_WARNING_CODES = Object.freeze([
    'scenario_log_v1_unversioned',
    'legacy_ratio_field_names',
    'legacy_withdrawal_rate_ambiguity',
    'legacy_terminal_rows_untyped',
    'legacy_minimum_flex_name_collision'
]);
