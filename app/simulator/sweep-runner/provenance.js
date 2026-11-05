// @ts-check
/** @import {SweepRequest,SweepFingerprint,SweepRiskDiagnostics,SamplingDiagnostics} from '../../../typcheck/rechenkern' */
import { makeRunSeed, RUNIDX_COMBO_SETUP } from '../simulator-utils.js';
import { aggregateSweepMetrics } from '../simulator-results.js';

export const SWEEP_RESULT_PROVENANCE_VERSION = 'SweepResultProvenanceV2';

export const SWEEP_SAMPLING_FINGERPRINT_VERSION = 'SweepSamplingFingerprintV2';

export const SWEEP_HOUSEHOLD_RISK_DIAGNOSTICS_VERSION = 'SweepHouseholdRiskDiagnosticsV1';

export const SWEEP_COMPARISON_RANDOMNESS_VERSION = 'SweepCommonRandomNumbersV2';

export const COMMON_RANDOM_NUMBER_COMBINATION_COORDINATE = 0;

/** @param {SweepRequest} request */
function buildSweepComparisonRandomness(request) {
    const { seed, rngMode } = request.monteCarloParameters;
    const requestedRngMode = rngMode === 'legacy-stream' ? 'legacy-stream' : 'per-run-seed';
    const appliedRngMode = 'per-run-seed';
    return {
        schemaVersion: SWEEP_COMPARISON_RANDOMNESS_VERSION,
        policy: 'common_random_numbers_by_run_index',
        commonSeedScheduleAcrossCombinations: true,
        commonDrawsUntilStrategyTermination: true,
        completeRawPathsCommonAcrossCombinations: false,
        pathEqualityScope: 'common_prefix_until_strategy_dependent_termination',
        baseSeed: seed,
        requestedRngMode,
        appliedRngMode,
        rngModeResolution: requestedRngMode === appliedRngMode
            ? 'requested_mode_already_run_isolated'
            : 'legacy_stream_replaced_for_crn_run_isolation',
        combinationSeedCoordinate: COMMON_RANDOM_NUMBER_COMBINATION_COORDINATE,
        setupSeed: makeRunSeed(
            seed,
            COMMON_RANDOM_NUMBER_COMBINATION_COORDINATE,
            RUNIDX_COMBO_SETUP
        ),
        runSeedDerivation: 'makeRunSeed(baseSeed, combinationSeedCoordinate=0, runIndex)'
    };
}

export function buildSweepMetricAggregationOptions() {
    return {
        commonRandomNumbers: true,
        randomPolicyVersion: SWEEP_COMPARISON_RANDOMNESS_VERSION
    };
}

/** @param {SweepRequest} request
 * @param {number} combinationIndex
 * @param {SamplingDiagnostics|null} samplingDiagnostics
 * @param {SweepFingerprint["publicValue"]|null} samplingFingerprint
 * @param {SweepRiskDiagnostics|null} householdRiskDiagnostics */
export function buildSweepResultProvenance(
    request,
    combinationIndex,
    samplingDiagnostics,
    samplingFingerprint,
    householdRiskDiagnostics = null
) {
    return {
        schemaVersion: SWEEP_RESULT_PROVENANCE_VERSION,
        requestVersion: request.schemaVersion,
        combinationIndex,
        requestedSamplingMethod: request.requestedSamplingMethod,
        appliedSamplingMethod: request.appliedSamplingMethod,
        samplingMethodResolution: request.samplingMethodResolution,
        useCapeSampling: request.useCapeSampling,
        normalizedParameters: { ...request.monteCarloParameters },
        comparisonRandomness: buildSweepComparisonRandomness(request),
        unsupportedOverlays: [],
        samplingDiagnostics: samplingDiagnostics
            ? {
                ...samplingDiagnostics,
                tailRisk: householdRiskDiagnostics?.tailRisk ?? null
            }
            : null,
        samplingFingerprint,
        householdRiskDiagnostics
    };
}

/** @param {string} reason */
export function makeInvalidSweepMetrics(reason) {
    return {
        ...aggregateSweepMetrics([], buildSweepMetricAggregationOptions()),
        invalidCombination: true,
        invalidReason: String(reason || 'ungueltige Kombination')
    };
}
