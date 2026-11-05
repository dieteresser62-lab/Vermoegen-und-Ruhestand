// @ts-check
/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
"use strict";

import { global_equity_research_index, gold_eur_perf, cape } from './historical-markets.js';
import { inflation_de, zinssatz_de, lohn_de } from './historical-german-economy.js';
import { mortality_table, care_grade_taxonomy, care_observed_prevalence, care_incidence_probabilities, care_progression_probabilities, care_cost_presets, widow_benefit_parameters } from './household-data.js';
import { capital_income_tax_parameters, pension_user_defaults, social_insurance_parameters, stress_presets, regime_classification_thresholds, regime_transition_matrix, engine_policy_defaults, monte_carlo_defaults, longevity_defaults, tail_risk_defaults, health_bucket_defaults } from './policy-data.js';
import { deepFreeze } from './entry-builders.js';
import { SIMULATION_DATA_INVENTORY_SCHEMA_VERSION, SIMULATION_DATA_INVENTORY_REVISION, SIMULATION_DATA_EVIDENCE_CLASSES, EXTERNAL_GATE_FIELDS } from './schema.js';

const HISTORICAL_SERIES = {
    global_equity_research_index,
    inflation_de,
    zinssatz_de,
    lohn_de,
    gold_eur_perf,
    cape
};

const STATIC_DATA = {
    mortality_table,
    care_grade_taxonomy,
    care_observed_prevalence,
    care_incidence_probabilities,
    care_progression_probabilities,
    care_cost_presets,
    widow_benefit_parameters,
    capital_income_tax_parameters,
    pension_user_defaults,
    social_insurance_parameters,
    stress_presets,
    regime_classification_thresholds,
    regime_transition_matrix,
    engine_policy_defaults,
    monte_carlo_defaults,
    longevity_defaults,
    tail_risk_defaults,
    health_bucket_defaults
};

export const SIMULATION_DATA_INVENTORY = deepFreeze({
    schemaVersion: SIMULATION_DATA_INVENTORY_SCHEMA_VERSION,
    inventoryId: 'ruhestandsapp-simulation-data-inventory-v1',
    revision: SIMULATION_DATA_INVENTORY_REVISION,
    documentation: 'docs/reference/DATA_SOURCES.md',
    evidenceClasses: SIMULATION_DATA_EVIDENCE_CLASSES,
    historicalSeries: HISTORICAL_SERIES,
    staticData: STATIC_DATA,
    gates: {
        externallyValidatedRequires: EXTERNAL_GATE_FIELDS,
        unresolvedMayRunReproducibly: true,
        unresolvedMayClaimExternalValidation: false,
        unresolvedMayReplacePackagedData: false
    }
});
