"use strict";

import { deepFreeze } from './values.js';

export const HISTORICAL_YEAR_RECORD_SCHEMA_VERSION = 'HistoricalYearRecordV1';

export const HISTORICAL_DATA_MANIFEST_SCHEMA_VERSION = 'HistoricalDataManifestV1';

export const HISTORICAL_TEMPORAL_CONVENTION_ID = 'realized_t_decision_t_minus_1_v1';

export const REQUIRED_SERIES_IDS = Object.freeze([
    'global_equity_research_index',
    'inflation_de',
    'zinssatz_de',
    'lohn_de',
    'gold_eur_perf',
    'cape'
]);

export const RESOLUTION_STATUSES = new Set(['known', 'unresolved', 'not_applicable']);

export const QUALITY_STATUSES = new Set(['present', 'estimated', 'unresolved', 'fallback_zero', 'missing']);

export const HISTORICAL_ASSIGNMENT_INVENTORY_V1 = deepFreeze({
    legacyBacktest: {
        equityReturn: 'index_level_t / index_level_t_minus_1 - 1',
        goldReturn: 't_minus_1',
        cashBondReturn: 't_minus_1',
        inflation: 't_minus_1',
        wagePensionAdjustment: 't_via_series_offset',
        capeRatio: 't_minus_1'
    },
    activeMonteCarloAnnualData: {
        equityReturn: 'index_level_t / index_level_t_minus_1 - 1',
        goldReturn: 't',
        cashBondReturn: 't',
        inflation: 't',
        wagePensionAdjustment: 't',
        capeRatio: 't'
    },
    alternativePrepareHistoricalData: {
        equityReturn: 'index_level_t / index_level_t_minus_1 - 1',
        goldReturn: 't_minus_1',
        cashBondReturn: 't_minus_1',
        inflation: 't_minus_1',
        wagePensionAdjustment: 't_minus_1',
        capeRatio: 'not_mapped'
    },
    canonicalHistoricalYearRecordV1: {
        equityReturn: 'index_level_t / index_level_t_minus_1 - 1',
        goldReturn: 't',
        cashBondReturn: 't',
        inflation: 't',
        wagePensionAdjustment: 't',
        capeRatio: 't_minus_1_decision_as_of'
    }
});
