// @ts-check
/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
"use strict";

export const SIMULATION_DATA_INVENTORY_SCHEMA_VERSION = 'SimulationDataInventoryV1';

export const SIMULATION_DATA_INVENTORY_REVISION = '2026-08-03.1';

export const SIMULATION_DATA_EVIDENCE_CLASSES = Object.freeze([
    'official',
    'derived',
    'backtested',
    'proxy',
    'estimated',
    'model_assumption',
    'user_input',
    'stress_parameter',
    'missing',
    'unresolved'
]);

export const SIMULATION_DATA_EXTERNAL_VALIDATION_STATUSES = Object.freeze([
    'externally_validated',
    'not_validated',
    'not_applicable',
    'unresolved'
]);

export const RESOLUTION_STATUSES = new Set(['known', 'unresolved', 'not_applicable']);

export const EVIDENCE_CLASSES = new Set(SIMULATION_DATA_EVIDENCE_CLASSES);

export const EXTERNAL_VALIDATION_STATUSES = new Set(SIMULATION_DATA_EXTERNAL_VALIDATION_STATUSES);

export const REQUIRED_HISTORICAL_SERIES = Object.freeze([
    'global_equity_research_index',
    'inflation_de',
    'zinssatz_de',
    'lohn_de',
    'gold_eur_perf',
    'cape'
]);

export const REQUIRED_STATIC_CATEGORIES = Object.freeze([
    'demography',
    'care',
    'survivor',
    'tax',
    'pension_social',
    'stress_regime',
    'defaults_fallbacks'
]);

export const REQUIRED_RESOLUTION_FIELDS = Object.freeze([
    'source',
    'seriesIdentifier',
    'currency',
    'yearConvention',
    'transformation',
    'license',
    'retrievedAt',
    'rawDataHash',
    'embeddedValueHash'
]);

export const EXTERNAL_GATE_FIELDS = Object.freeze([
    'source',
    'seriesIdentifier',
    'license',
    'retrievedAt'
]);
