// @ts-check
/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
"use strict";

import HISTORICAL_DATENSTAND from '../historical-datenstand.js';
import { historicalMarketSeries } from './historical-markets.js';
import { historicalGermanEconomySeries } from './historical-german-economy.js';
import { mortality_table, cohort_life_table, care_grade_taxonomy, care_observed_prevalence, care_incidence_probabilities, care_progression_probabilities, care_cost_presets, widow_benefit_parameters } from './household-data.js';
import { capital_income_tax_parameters, pension_user_defaults, social_insurance_parameters, stress_presets, historicalPolicyEntries, engine_policy_defaults, longevity_defaults, tail_risk_defaults, health_bucket_defaults } from './policy-data.js';
import { deepFreeze } from './entry-builders.js';
import { SIMULATION_DATA_INVENTORY_SCHEMA_VERSION, SIMULATION_DATA_INVENTORY_REVISION, SIMULATION_DATA_EVIDENCE_CLASSES, EXTERNAL_GATE_FIELDS } from './schema.js';

/**
 * Inventar aller Simulationsdaten zu einem Datenstand. Historische Reihen und die vom Datenumfang
 * abhängigen Einträge folgen dem Datenstand, alle übrigen Einträge sind fest.
 *
 * @param {typeof HISTORICAL_DATENSTAND} [stand] Datenstand; ohne Angabe der eingebettete.
 */
export function buildSimulationDataInventory(stand = HISTORICAL_DATENSTAND) {
    const { global_equity_research_index, gold_eur_perf, cape } = historicalMarketSeries(stand);
    const { inflation_de, zinssatz_de, lohn_de } = historicalGermanEconomySeries(stand);
    const { regime_classification_thresholds, regime_transition_matrix, monte_carlo_defaults } = historicalPolicyEntries(stand);
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
        cohort_life_table,
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

    return deepFreeze({
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
}

export const SIMULATION_DATA_INVENTORY = buildSimulationDataInventory();
