// @ts-check
/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
"use strict";

import HISTORICAL_DATENSTAND from '../historical-datenstand.js';
import { staticEntry, unresolved, resolved, notApplicable } from './entry-builders.js';

export const capital_income_tax_parameters = staticEntry({
        id: 'capital_income_tax_parameters',
        category: 'tax',
        label: 'Parameterized capital-income tax approximation',
        evidenceClass: 'model_assumption',
        implementationLocations: [
            'engine/tax-settlement.mjs',
            'engine/transactions/sale-engine.mjs',
            'types/tranche-contract.js',
            'app/simulator/simulator-portfolio-init.js',
            'app/simulator/simulator-portfolio-tranches.js',
            'app/simulator/simulator-tax-recompute.js'
        ],
        unit: 'tax_rate_ratio',
        rawDataHash: unresolved(),
        embeddedValueHash: resolved('9315d68a04f35d2dd577349b07d88677311c45b3bbac119cea462a87d9f6be2a'),
        source: unresolved(),
        seriesIdentifier: notApplicable(),
        yearConvention: resolved('current_parameterization_applied_to_all_simulated_years'),
        transformation: resolved('Current tax parameters apply to every simulated year; positive cash interest and realized gains share one annual settlement; negative interest only reduces cash and never tax or loss carry; tranche TQF and taxExempt remain independent explicit inputs.'),
        license: notApplicable(),
        retrievedAt: unresolved(),
        contractValue: {
            capitalGainsTaxRate: 0.25,
            solidaritySurchargeRate: 0.055,
            defaultEquityTqf: 0,
            defaultTaxExempt: false,
            goldTaxExemptFromExplicitInput: true
        },
        externalValidationStatus: 'not_validated'
    });

export const pension_user_defaults = staticEntry({
        id: 'pension_user_defaults',
        category: 'pension_social',
        label: 'Pension, church-tax and adjustment user defaults',
        evidenceClass: 'user_input',
        implementationLocations: [
            'app/simulator/simulator-ui-rente.js:initRente2ConfigWithLocalStorage',
            'app/simulator/simulator-input-pension.js'
        ],
        unit: 'mixed_user_input_contract',
        embeddedValueHash: resolved('52e817148c42d8ad34667d993b10c241e5e80e71c6f8501f4219705f7fd4d3f0'),
        contractValue: {
            p1ChurchTaxPercent: 9,
            p2ChurchTaxPercent: 0,
            rentAdjustmentMode: 'wage'
        },
        externalValidationStatus: 'not_applicable'
    });

export const social_insurance_parameters = staticEntry({
        id: 'social_insurance_parameters',
        category: 'pension_social',
        label: 'Automatic social-insurance parameter table',
        evidenceClass: 'missing',
        implementationLocations: [
            'docs/reference/ARCHITEKTUR_UND_FACHKONZEPT.md:MS-07'
        ],
        unit: 'not_implemented',
        embeddedValueHash: notApplicable(),
        externalValidationStatus: 'not_applicable',
        contractValue: { implemented: false }
    });

export const stress_presets = staticEntry({
        id: 'stress_presets',
        category: 'stress_regime',
        label: 'Historical-filter and parametric stress presets',
        evidenceClass: 'stress_parameter',
        implementationLocations: [
            'app/simulator/simulator-data.js:STRESS_PRESETS',
            'app/simulator/simulator-portfolio-stress.js:buildStressContext'
        ],
        unit: 'mixed_stress_parameter_contract',
        embeddedValueHash: resolved('ee5081aeb94b48208056188ced1cf18b13ebb1c816539f4264ae0e8a4c7a57da'),
        contractValue: {
            evidenceKinds: ['none', 'historical_filter', 'reconstructed_window', 'hybrid_synthetic', 'synthetic_shock'],
            sourceEvidenceKinds: ['not_applicable', 'mixed_observation_proxy_and_reconstruction', 'research_proxy_reconstruction', 'mixed_observation_proxy_and_reconstruction_plus_synthetic_shift'],
            unknownPresetPolicy: 'reject',
            emptyHistoricalPoolPolicy: 'reject',
            missingOptionalPresetDefault: 'NONE'
        },
        externalValidationStatus: 'not_applicable'
    });

/**
 * Einträge, deren Inhalt oder Hash vom Datenumfang abhängt: Regimeschwellen mit geprüfter Regimezählung,
 * Regimeübergänge und Monte-Carlo-Grenzen („Startjahr ab“ reicht bis zum Endjahr). Zählung und Hashes stehen im Datenstand.
 *
 * @param {typeof HISTORICAL_DATENSTAND} [stand] Datenstand; ohne Angabe der eingebettete.
 */
export function historicalPolicyEntries(stand = HISTORICAL_DATENSTAND) {
    const { regimeDistribution, policyHashes } = stand;
    const regime_classification_thresholds = staticEntry({
        id: 'regime_classification_thresholds',
        category: 'stress_regime',
        label: 'Historical regime-classification thresholds',
        evidenceClass: 'model_assumption',
        implementationLocations: [
            'app/simulator/simulator-data.js:REGIME_CLASSIFICATION_THRESHOLDS',
            'app/simulator/simulator-data.js:classifyHistoricalRegime'
        ],
        unit: 'mixed_percent_and_ratio_thresholds',
        embeddedValueHash: resolved(policyHashes.regime_classification_thresholds),
        contractValue: {
            schemaVersion: 'HistoricalRegimeClassificationV1',
            sourceSeries: 'global_equity_research_annual_returns',
            inflationHighPct: 5,
            equityPoorRatio: 0,
            equityCrashRatio: -0.15,
            equityBoomRatio: 0.15,
            labels: ['BULL', 'BEAR', 'SIDEWAYS', 'STAGFLATION'],
            calibrationStatus: 'retained_after_total_return_distribution_review',
            reviewedDistribution1925To2025: {
                observationCount: regimeDistribution.observationCount,
                BULL: regimeDistribution.BULL,
                BEAR: regimeDistribution.BEAR,
                SIDEWAYS: regimeDistribution.SIDEWAYS,
                STAGFLATION: regimeDistribution.STAGFLATION
            }
        },
        externalValidationStatus: 'not_validated'
    });

    const regime_transition_matrix = staticEntry({
        id: 'regime_transition_matrix',
        category: 'stress_regime',
        label: 'Derived historical regime transition counts',
        evidenceClass: 'derived',
        implementationLocations: ['app/simulator/simulator-data.js:REGIME_TRANSITIONS'],
        unit: 'transition_count',
        embeddedValueHash: resolved(policyHashes.regime_transition_matrix),
        source: resolved('ruhestandsapp-historical-data-v1 plus REGIME_CLASSIFICATION_THRESHOLDS'),
        seriesIdentifier: resolved('REGIME_TRANSITIONS'),
        transformation: resolved('Count consecutive canonical annual regime labels; missing regime pools or outgoing transitions reject initialization.'),
        externalValidationStatus: 'not_validated'
    });

    const monte_carlo_defaults = staticEntry({
        id: 'monte_carlo_defaults',
        category: 'defaults_fallbacks',
        label: 'Monte Carlo parameter limits, defaults and method vocabulary',
        evidenceClass: 'model_assumption',
        implementationLocations: [
            'app/simulator/monte-carlo-parameters.js:MONTE_CARLO_PARAMETER_LIMITS',
            'app/simulator/monte-carlo-parameters.js:MONTE_CARLO_SAMPLING_METHODS'
        ],
        unit: 'mixed_simulation_parameter_contract',
        // FR-75: legacyStoredDefault (alte Vorgabe 35 gilt beim Lesen als automatisch).
        embeddedValueHash: resolved(policyHashes.monte_carlo_defaults),
        externalValidationStatus: 'not_validated'
    });

    return { regime_classification_thresholds, regime_transition_matrix, monte_carlo_defaults };
}

const HISTORICAL_POLICY_ENTRIES = historicalPolicyEntries();
export const regime_classification_thresholds = HISTORICAL_POLICY_ENTRIES.regime_classification_thresholds;
export const regime_transition_matrix = HISTORICAL_POLICY_ENTRIES.regime_transition_matrix;
export const monte_carlo_defaults = HISTORICAL_POLICY_ENTRIES.monte_carlo_defaults;

export const engine_policy_defaults = staticEntry({
        id: 'engine_policy_defaults',
        category: 'defaults_fallbacks',
        label: 'Engine policy, threshold and fallback registry',
        evidenceClass: 'model_assumption',
        implementationLocations: ['engine/config.mjs:CONFIG'],
        unit: 'mixed_engine_policy_contract',
        // Unbenutztes CAUTION.inflationCap entfernt; wirksame Parameter unverändert.
        embeddedValueHash: resolved('f8ed19ec58efa139c8f806ffd77d53959393a20669ea1648c31a029ae2991d85'),
        externalValidationStatus: 'not_validated'
    });

export const longevity_defaults = staticEntry({
        id: 'longevity_defaults',
        category: 'defaults_fallbacks',
        label: 'Dynamic-flex longevity defaults, limits and smoothing',
        evidenceClass: 'model_assumption',
        implementationLocations: [
            'app/simulator/dynamic-flex-longevity-contract.js:LONGEVITY_DEFAULTS',
            'app/simulator/dynamic-flex-longevity-contract.js:LONGEVITY_LIMITS',
            'app/simulator/dynamic-flex-longevity-contract.js:LONGEVITY_TRANSITION_SMOOTHING'
        ],
        unit: 'mixed_longevity_parameter_contract',
        embeddedValueHash: resolved('def2533e3ec5c563c2694214f377525ff5d9c7d47111f99c6d7ee2750bc36758'),
        externalValidationStatus: 'not_validated'
    });

export const tail_risk_defaults = staticEntry({
        id: 'tail_risk_defaults',
        category: 'defaults_fallbacks',
        label: 'Tail-risk defaults, bounds and crisis labels',
        evidenceClass: 'stress_parameter',
        implementationLocations: [
            'app/simulator/tail-risk-contract.js:TAIL_RISK_DEFAULT_CONFIG',
            'app/simulator/tail-risk-contract.js:TAIL_RISK_LIMITS',
            'app/simulator/tail-risk-contract.js:TAIL_RISK_HISTORICAL_CRISIS_REGIMES'
        ],
        unit: 'mixed_stress_parameter_contract',
        embeddedValueHash: resolved('26d61df7b34cb51a9e974fdb2b0eb1cbd6f2891706f0150415d0ea00b59b4500'),
        externalValidationStatus: 'not_applicable'
    });

export const health_bucket_defaults = staticEntry({
        id: 'health_bucket_defaults',
        category: 'defaults_fallbacks',
        label: 'Profile health-bucket defaults',
        evidenceClass: 'model_assumption',
        implementationLocations: ['app/profile/profile-state.js:DEFAULT_PROFILE_HEALTH_BUCKET'],
        unit: 'mixed_health_bucket_contract',
        currency: resolved('EUR'),
        embeddedValueHash: resolved('8befa56ac6ab997b946de96ecd0b2625a074d3104fb51296b86a30adb911bb1b'),
        externalValidationStatus: 'not_validated'
    });
