// @ts-check
/** @import {SweepChunkOptions,SweepChunkResult} from '../../../typcheck/rechenkern' */
import { validateSweepCombination, buildSweepInputs } from './inputs.js';
import { COMMON_RANDOM_NUMBER_COMBINATION_COORDINATE, buildSweepMetricAggregationOptions, buildSweepResultProvenance, makeInvalidSweepMetrics } from './provenance.js';
import { createSweepSamplingFingerprint, finalizeSweepSamplingFingerprint } from './fingerprint.js';
import { createSweepHouseholdRiskDiagnostics } from './household-risk.js';
import { runSweepSimulation } from './simulation.js';
import { validatePlannedInflows } from '../simulator-input-validation.js';
import { rng, makeRunSeed, RUNIDX_COMBO_SETUP } from '../simulator-utils.js';
import { buildStressContext } from '../simulator-portfolio.js';
import { annualData } from '../simulator-data.js';
import { assertSimulatorHorizonAgeContract } from '../mc-life-events.js';
import { getDataVersion } from '../simulator-engine-wrapper.js';
import { aggregateSweepMetrics } from '../simulator-results.js';
import { normalizeSweepRequestV1 } from '../monte-carlo-parameters.js';
import { buildYearSamplingConfig, createMonteCarloSamplingDiagnosticsV1, finalizeMonteCarloSamplingDiagnosticsV1, resolveMonteCarloSamplingContractV1 } from '../mc-year-sampling.js';
import { extractP2Invariants, areP2InvariantsEqual, normalizeWidowOptions } from '../simulator-sweep-utils.js';

/** @param {SweepChunkOptions} options
 * @returns {Generator<number,SweepChunkResult,unknown>} */
export function* iterateSweepChunk({
    baseInputs,
    paramCombinations,
    comboRange,
    sweepRequest = null,
    sweepConfig = null,
    refP2Invariants = null,
    engine = null
}) {
    const normalizedRequest = normalizeSweepRequestV1(sweepRequest ?? sweepConfig, {
        inputs: baseInputs,
        historicalRecordCount: annualData.length || null
    });
    const {
        anzahl: anzahlRuns,
        maxDauer,
        blockSize,
        seed: baseSeed,
        methode,
        rngMode,
        startYearMode,
        startYearFilter,
        startYearHalfLife,
        excludeEstimatedHistory
    } = normalizedRequest.monteCarloParameters;
    validatePlannedInflows(baseInputs, maxDauer);
    assertSimulatorHorizonAgeContract(baseInputs, maxDauer);
    const { useCapeSampling } = normalizedRequest;
    const yearSamplingConfig = buildYearSamplingConfig(startYearMode, annualData, {
        startYearFilter,
        startYearHalfLife,
        blockSize,
        excludeEstimatedHistory
    });
    const samplingResolution = resolveMonteCarloSamplingContractV1({
        method: methode,
        inputs: baseInputs,
        annualData,
        useCapeSampling,
        startYearMode,
        startYearFilter,
        startYearHalfLife,
        blockSize,
        excludeEstimatedHistory,
        yearSamplingConfig
    });
    const start = comboRange?.start ?? 0;
    const count = comboRange?.count ?? paramCombinations.length;

    const results = [];
    let p2VarianceCount = 0;
    let resolvedRef = refP2Invariants;

    // D-07: Alle Kombinationen verwenden je Run-Index dieselben Zufallspfade.
    for (let offset = 0; offset < count; offset++) {
        const comboIdx = start + offset;
        const params = paramCombinations[comboIdx];
        const validation = validateSweepCombination(baseInputs, params);
        if (!validation.valid) {
            results.push({
                comboIdx,
                params,
                metrics: makeInvalidSweepMetrics(validation.reason),
                provenance: buildSweepResultProvenance(normalizedRequest, comboIdx, null, null)
            });
            yield offset + 1;
            continue;
        }
        const inputs = buildSweepInputs(baseInputs, params);
        const widowOptions = /** @type {import('../../../typcheck/rechenkern-integration').NormalizeWidowOptions} */ (normalizeWidowOptions)(inputs.widowOptions);
        const samplingDiagnostics = createMonteCarloSamplingDiagnosticsV1({
            contract: samplingResolution.contract,
            dataVersion: getDataVersion()
        });
        const samplingFingerprint = createSweepSamplingFingerprint(normalizedRequest, comboIdx);
        const householdRiskDiagnostics = createSweepHouseholdRiskDiagnostics();

        const p2Invariants = extractP2Invariants(inputs);
        if (!resolvedRef) {
            resolvedRef = p2Invariants;
        }
        const p2VarianceWarning = resolvedRef ? !areP2InvariantsEqual(p2Invariants, resolvedRef) : false;
        if (p2VarianceWarning) {
            p2VarianceCount++;
        }

        // Sweep-Vergleiche loesen auch angeforderten Legacy-Stream auf
        // isolierte Run-Index-Seeds auf. Andernfalls verschiebt ein frueher
        // Abbruch den Stream aller nachfolgenden Runs nur in dieser Kombination.
        const comboRand = rng(makeRunSeed(
            baseSeed,
            COMMON_RANDOM_NUMBER_COMBINATION_COORDINATE,
            RUNIDX_COMBO_SETUP
        ));
        const stressCtxMaster = buildStressContext(inputs.stressPreset, comboRand);

        /** @type {Parameters<typeof aggregateSweepMetrics>[0]} */
        const runOutcomes = [];
        let invalidComboReason = '';

        for (let i = 0; i < anzahlRuns; i++) {
            invalidComboReason = runSweepSimulation({
                baseSeed, i, inputs, maxDauer, useCapeSampling, excludeEstimatedHistory,
                yearSamplingConfig, samplingResolution, samplingDiagnostics, methode, blockSize,
                samplingFingerprint, householdRiskDiagnostics, stressCtxMaster, comboIdx, engine,
                widowOptions, runOutcomes, invalidComboReason
            });

            // A completed simulation is a stable unit of work, even when the
            // combination later proves invalid. No result data leaves this runner.
            if ((i + 1) % Math.max(1, Math.floor(anzahlRuns / 100)) === 0
                || i + 1 === anzahlRuns || invalidComboReason) {
                yield offset + (i + 1) / anzahlRuns;
            }

            if (invalidComboReason) {
                break;
            }
        }

        finalizeMonteCarloSamplingDiagnosticsV1(samplingDiagnostics);
        const resultProvenance = buildSweepResultProvenance(
            normalizedRequest,
            comboIdx,
            samplingDiagnostics,
            finalizeSweepSamplingFingerprint(samplingFingerprint),
            householdRiskDiagnostics
        );
        if (invalidComboReason) {
            results.push({
                comboIdx,
                params,
                metrics: makeInvalidSweepMetrics(`Engine Validation: ${invalidComboReason}`),
                provenance: resultProvenance
            });
            yield offset + 1;
            continue;
        }

        // Aggregate P50/P10/etc per combo to feed the heatmap.
        const metrics = /** @type {import('../../../typcheck/rechenkern').SweepMetrics} */ (aggregateSweepMetrics(
            runOutcomes,
            buildSweepMetricAggregationOptions()
        ));
        metrics.warningR2Varies = p2VarianceWarning;
        results.push({ comboIdx, params, metrics, provenance: resultProvenance });
        yield offset + 1;
    }

    return { results, p2VarianceCount, sweepRequest: normalizedRequest };
}
