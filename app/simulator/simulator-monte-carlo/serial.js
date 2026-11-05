import { createStressReplayCaptureRequest } from '../stress-replay-path-materializer.js';
import { throwIfRunCancelled } from './helpers.js';
import { runMonteCarloChunk, attachMonteCarloBatchOutcome, buildMonteCarloAggregates } from '../monte-carlo-runner.js';
import { normalizeMonteCarloParametersV1 } from '../monte-carlo-parameters.js';
import { annualData } from '../simulator-data.js';
import { ScenarioAnalyzer } from '../scenario-analyzer.js';

async function runMonteCarloSerialRerunForIndices({
    inputs,
    widowOptions,
    monteCarloParams,
    useCapeSampling,
    runIndices,
    generationId,
    signal = null,
    captureStressReplay = false
}) {
    const logsByIndex = new Map();
    const capturesByIndex = new Map();
    if (!Array.isArray(runIndices) || runIndices.length === 0) return { logsByIndex, capturesByIndex };
    const captureRequest = captureStressReplay ? createStressReplayCaptureRequest(runIndices) : null;
    for (const runIdx of runIndices) {
        throwIfRunCancelled(signal, generationId);
        // Re-run a single index with logging enabled to get full log rows.
        const chunk = await runMonteCarloChunk({
            inputs,
            widowOptions,
            monteCarloParams,
            useCapeSampling,
            runRange: { start: runIdx, count: 1 },
            logIndices: [runIdx],
            stressReplayCapture: captureRequest,
            signal
        });
        throwIfRunCancelled(signal, generationId);
        const meta = chunk.runMeta?.[0];
        if (meta && meta.logDataRows && meta.logDataRows.length) {
            logsByIndex.set(meta.index, meta.logDataRows);
        }
        if (meta?.stressReplayCapture) capturesByIndex.set(meta.index, meta.stressReplayCapture);
    }
    return { logsByIndex, capturesByIndex };
}

/**
 * @param {object} options
 * @returns Ergebnis der Operation.
 */
export async function runMonteCarloLogsForIndices(options) {
    const { logsByIndex } = await runMonteCarloSerialRerunForIndices(options);
    return logsByIndex;
}

/**
 * @param {object} options
 * @returns Ergebnis der Operation.
 */
export async function runMonteCarloReplayCaptureForIndices(options) {
    return runMonteCarloSerialRerunForIndices({ ...options, captureStressReplay: true });
}

/**
 * @param {object} options
 * @param options.inputs
 * @param options.monteCarloParams
 * @param options.widowOptions
 * @param options.useCapeSampling
 * @param [options.onProgress]
 * @param [options.scenarioAnalyzer]
 * @param [options.signal]
 * @returns Ergebnis der Operation.
 */
export async function runMonteCarloSerial({ inputs, monteCarloParams, widowOptions,
    useCapeSampling, onProgress = /** @type {(pct: number, counts?: {phase: string; completedRuns: number; totalRuns: number}) => void} */ (() => {}), scenarioAnalyzer = null, signal = null }) {
    const parameters = normalizeMonteCarloParametersV1(monteCarloParams, {
        inputs, historicalRecordCount: annualData.length || null
    });
    const analyzer = scenarioAnalyzer || new ScenarioAnalyzer(parameters.anzahl);
    const chunk = await runMonteCarloChunk({
        inputs, monteCarloParams: parameters, widowOptions, useCapeSampling,
        onProgress, signal, runRange: { start: 0, count: parameters.anzahl }, collectWealthFan: true
    });
    throwIfRunCancelled(signal);
    for (const meta of chunk.runMeta || []) {
        meta.isRandomSample = analyzer.shouldCaptureRandomSample(meta.index);
        analyzer.addRun(meta);
    }
    onProgress(95, { phase: 'evaluating', completedRuns: parameters.anzahl, totalRuns: parameters.anzahl });
    await new Promise(resolve => setTimeout(resolve, 0));
    throwIfRunCancelled(signal);
    const aggregatedResults = attachMonteCarloBatchOutcome(buildMonteCarloAggregates({
        inputs, totalRuns: parameters.anzahl, buffers: chunk.buffers,
        heatmap: chunk.heatmap, bins: chunk.bins, totals: chunk.totals,
        lists: chunk.lists, pathSummaries: chunk.pathSummaries, pathMissingness: chunk.pathMissingness,
        allRealWithdrawalsSample: chunk.allRealWithdrawalsSample, wealthFan: chunk.wealthFan, displayHomeValueFan: chunk.displayHomeValueFan
    }), chunk.technicalInventory);
    onProgress(100, { phase: 'evaluating', completedRuns: parameters.anzahl, totalRuns: parameters.anzahl });
    return {
        aggregatedResults, failCount: chunk.totals.failCount,
        worstRun: chunk.worstRun, worstRunCare: chunk.worstRunCare,
        pflegeTriggeredCount: chunk.totals.pflegeTriggeredCount,
        batchStatus: aggregatedResults.batchStatus,
        financialMetricsValid: aggregatedResults.financialMetricsValid,
        technicalInventory: chunk.technicalInventory,
        samplingDiagnostics: chunk.samplingDiagnostics
    };
}
