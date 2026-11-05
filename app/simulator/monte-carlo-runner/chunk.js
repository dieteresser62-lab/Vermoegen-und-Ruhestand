// @ts-check

import { throwIfMonteCarloAborted, createMonteCarloHouseholdLifeContractV2, createDemographyCareSurvivorDiagnosticsV1, createMonteCarloTechnicalInventory } from './batch.js';
import { normalizeMonteCarloParametersV1 } from '../monte-carlo-parameters.js';
import { annualData } from '../simulator-data.js';
import { validatePlannedInflows } from '../simulator-input-validation.js';
import { assertSimulatorHorizonAgeContract } from '../mc-life-events.js';
import { createMonteCarloRunContext } from '../mc-run-context.js';
import { buildYearSamplingConfig, buildStartYearCdf, resolveMinStartYearIndex, resolveMonteCarloSamplingContractV1, createMonteCarloSamplingDiagnosticsV1, finalizeMonteCarloSamplingDiagnosticsV1 } from '../mc-year-sampling.js';
import { getDataVersion } from '../simulator-engine-wrapper.js';
import { createMonteCarloPathSummaryV1 } from '../monte-carlo-chunk-result.js';
import { createMonteCarloRunMetrics, finalizeMonteCarloRunMetrics } from '../mc-run-metrics.js';
import { MC_HEATMAP_BINS } from '../monte-carlo-runner-utils.js';
import { createWealthFan } from '../wealth-fan-aggregation.js';
import { createHomeWealthFan } from '../wealth-home-fan.js';
import { STRESS_REPLAY_CAPTURE_VERSION } from '../stress-replay-path-materializer.js';
import { prepareGuardrailPlanInputs } from '../../shared/guardrail-history.js';
import { runMonteCarloPath } from './path-state.js';
import { createMonteCarloChunkResultV1 } from '../monte-carlo-chunk-result.js';
/** @typedef {ReturnType<typeof prepareChunk>} ChunkContext */
/** @param {import('../../../typcheck/rechenkern').MonteCarloChunkOptions} options */
export function prepareChunk({
    inputs,
    monteCarloParams,
    widowOptions,
    useCapeSampling,
    runRange = null,
    onProgress = () => { },
    logIndices = null,
    stressReplayCapture = null,
    signal = null,
    engine = null,
    collectWealthFan = false,
    comparisonPairing = null
}) {
    throwIfMonteCarloAborted(signal);
    onProgress(0);

    const normalizedParameters = normalizeMonteCarloParametersV1(monteCarloParams, {
        inputs,
        historicalRecordCount: annualData.length || null
    });
    validatePlannedInflows(inputs, normalizedParameters.maxDauer);
    assertSimulatorHorizonAgeContract(inputs, normalizedParameters.maxDauer);

    const context = createMonteCarloRunContext({
        inputs,
        monteCarloParams: normalizedParameters,
        runRange,
        logIndices,
        buildYearSamplingConfig,
        buildStartYearCdf,
        resolveMinStartYearIndex
    });
    const {
        maxDauer,
        blockSize,
        seed,
        methode,
        startYearMode,
        startYearFilter,
        startYearHalfLife,
        excludeEstimatedHistory,
        runStart,
        runCount,
        resolvedRngMode,
        legacyRand,
        stressCtxMaster,
        buffers,
        progressUpdateInterval,
        logIndexSet,
        yearSamplingConfig,
        startYearCdf,
        minStartYearIndex
    } = context;
    const samplingResolution = resolveMonteCarloSamplingContractV1({
        method: methode,
        inputs,
        annualData,
        useCapeSampling,
        startYearMode,
        startYearFilter,
        startYearHalfLife,
        blockSize,
        excludeEstimatedHistory,
        yearSamplingConfig
    });
    const samplingDiagnostics = createMonteCarloSamplingDiagnosticsV1({
        contract: samplingResolution.contract,
        dataVersion: getDataVersion()
    });
    samplingDiagnostics.modelContracts = {
        householdLife: createMonteCarloHouseholdLifeContractV2(),
        demographyCareSurvivor: createDemographyCareSurvivorDiagnosticsV1()
    };
    const { pathSummaries, pathMissingness } = createMonteCarloPathSummaryV1(runCount, {
        buffers,
        attachTransferBuffers: true,
        withDisplayHomes: !!inputs.home?.length
    });
    const {
        finalOutcomes,
        taxOutcomes,
        kpiLebensdauer,
        kpiKuerzungsjahre,
        kpiMaxKuerzung,
        volatilities,
        maxDrawdowns,
        realMaxDrawdowns,
        realMaxDrawdownObservationCount,
        realMaxDrawdownMissingness,
        depotErschoepft,
        alterBeiErschoepfung,
        alterBeiErschoepfungMissingness,
        anteilJahreOhneFlex,
        stress_maxDrawdowns,
        stress_timeQuoteAbove45,
        stress_cutYears,
        stress_CaR_P10_Real,
        stress_realWithdrawalObservationCount,
        stress_realWithdrawalP10Missingness,
        stress_recoveryYears
    } = buffers;

    // Realistischer Schwellenwert für Depot-Erschöpfung: 100 € (vorher 0,000001 €)
    const DEPOT_DEPLETION_THRESHOLD = 100;

    const runMetrics = createMonteCarloRunMetrics(runCount);
    const technicalInventory = createMonteCarloTechnicalInventory(runCount);
    const outcomeCounts = {
        ruin: 0,
        all_dead: 0,
        horizon_exhausted: 0
    };
    const heatmap = Array(10).fill(0).map(() => new Uint32Array(MC_HEATMAP_BINS.length - 1));
    // Nur der MC-Ergebnispfad optiert ein; Sweep/Optimize und Lognachrechnung nicht.
    const wealthFan = collectWealthFan ? createWealthFan(maxDauer) : null;
    const displayHomeValueFan = wealthFan && inputs.home?.length ? createHomeWealthFan(maxDauer) : undefined;
    if (stressReplayCapture !== null
        && (stressReplayCapture?.schemaVersion !== STRESS_REPLAY_CAPTURE_VERSION
            || !Array.isArray(stressReplayCapture.runIndices))) {
        const error = /** @type {Error & {code:string}} */ (new Error('Stress replay capture request is invalid.'));
        error.code = 'STRESS_REPLAY_CAPTURE_REQUEST_INVALID';
        throw error;
    }
    const replayCaptureIndexSet = stressReplayCapture === null
        ? null
        : new Set(stressReplayCapture.runIndices);
    if (replayCaptureIndexSet && resolvedRngMode !== 'per-run-seed') {
        const error = /** @type {Error & {code:string}} */ (new Error('Stress replay capture requires per-run-seed RNG mode.'));
        error.code = 'STRESS_REPLAY_SOURCE_UNSUPPORTED';
        throw error;
    }
    const replayCapturesByIndex = new Map();
    let lastProgressPct = -1;

    // PE-1/MP-1: Planfelder sind im Paket konstant. Ohne vorgegebenen
    // Planhorizont gilt dagegen weiter der jährlich abgeleitete Horizont.
    const chunkGuardrailPlanInputs = inputs.horizonYears == null ? null
        : prepareGuardrailPlanInputs({ ...inputs, guardrailPlanHorizonYears: inputs.horizonYears });
    return {
        inputs, monteCarloParams, widowOptions, useCapeSampling, runRange, onProgress, logIndices, stressReplayCapture,
        signal, engine, collectWealthFan, comparisonPairing, normalizedParameters, context, maxDauer, blockSize, seed,
        methode, startYearMode, startYearFilter, startYearHalfLife, excludeEstimatedHistory, runStart, runCount,
        resolvedRngMode, legacyRand, stressCtxMaster, buffers, progressUpdateInterval, logIndexSet, yearSamplingConfig,
        startYearCdf, minStartYearIndex, samplingResolution, samplingDiagnostics, pathSummaries, pathMissingness,
        finalOutcomes, taxOutcomes, kpiLebensdauer, kpiKuerzungsjahre, kpiMaxKuerzung, volatilities, maxDrawdowns,
        realMaxDrawdowns, realMaxDrawdownObservationCount, realMaxDrawdownMissingness, depotErschoepft,
        alterBeiErschoepfung, alterBeiErschoepfungMissingness, anteilJahreOhneFlex, stress_maxDrawdowns,
        stress_timeQuoteAbove45, stress_cutYears, stress_CaR_P10_Real, stress_realWithdrawalObservationCount,
        stress_realWithdrawalP10Missingness, stress_recoveryYears, DEPOT_DEPLETION_THRESHOLD, runMetrics,
        technicalInventory, outcomeCounts, heatmap, wealthFan, displayHomeValueFan, replayCaptureIndexSet,
        replayCapturesByIndex, lastProgressPct, chunkGuardrailPlanInputs
    };
}

/** @param {import('../../../typcheck/rechenkern').MonteCarloChunkOptions} options
 * @returns {Promise<import('../../../typcheck/rechenkern').MonteCarloChunkResult>} */
export async function runMonteCarloChunk({
    inputs,
    monteCarloParams,
    widowOptions,
    useCapeSampling,
    runRange = null,
    onProgress = () => { },
    logIndices = null,
    stressReplayCapture = null,
    signal = null,
    engine = null,
    collectWealthFan = false,
    comparisonPairing = null
}) {
    const context = prepareChunk({ inputs, monteCarloParams, widowOptions, useCapeSampling, runRange, onProgress, logIndices, stressReplayCapture, signal, engine, collectWealthFan, comparisonPairing });
    for (let i = 0; i < context.runCount; i++) {
        throwIfMonteCarloAborted(context.signal);
        if (i % context.progressUpdateInterval === 0) {
            const pct = Math.floor((i / context.runCount) * 90);
            if (pct > context.lastProgressPct) {
                context.lastProgressPct = pct;
                onProgress(pct, { phase: 'simulating', completedRuns: i, totalRuns: context.runCount });
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        runMonteCarloPath(context, i);
    }

    const finalizedMetrics = /** @type {ReturnType<typeof finalizeMonteCarloRunMetrics> & {totals:Record<string,number>}} */ (finalizeMonteCarloRunMetrics(context.runMetrics));
    for (const meta of finalizedMetrics.runMeta) {
        if (context.replayCapturesByIndex.has(meta.index)) {
            meta.stressReplayCapture = context.replayCapturesByIndex.get(meta.index);
        }
    }
    finalizedMetrics.totals.outcomeRuinCount = context.outcomeCounts.ruin;
    finalizedMetrics.totals.outcomeAllDeadCount = context.outcomeCounts.all_dead;
    finalizedMetrics.totals.outcomeHorizonExhaustedCount = context.outcomeCounts.horizon_exhausted;
    finalizeMonteCarloSamplingDiagnosticsV1(context.samplingDiagnostics, finalizedMetrics.totals);

    onProgress(90, { phase: 'simulating', completedRuns: context.runCount, totalRuns: context.runCount });
    return createMonteCarloChunkResultV1({
        runRange: { start: context.runStart, count: context.runCount },
        buffers: context.buffers,
        pathSummaries: context.pathSummaries,
        pathMissingness: context.pathMissingness,
        heatmap: context.heatmap,
        bins: MC_HEATMAP_BINS,
        totals: finalizedMetrics.totals,
        lists: finalizedMetrics.lists,
        allRealWithdrawalsSample: finalizedMetrics.allRealWithdrawalsSample,
        worstRun: finalizedMetrics.worstRun,
        worstRunCare: finalizedMetrics.worstRunCare,
        runMeta: finalizedMetrics.runMeta,
        batchStatus: context.technicalInventory.technicalError > 0 ? 'technical_error' : 'completed',
        financialMetricsValid: context.technicalInventory.technicalError === 0,
        technicalInventory: context.technicalInventory,
        samplingDiagnostics: context.samplingDiagnostics,
        wealthFan: context.wealthFan,
        ...(context.displayHomeValueFan ? { displayHomeValueFan: context.displayHomeValueFan } : {})
    });

}
