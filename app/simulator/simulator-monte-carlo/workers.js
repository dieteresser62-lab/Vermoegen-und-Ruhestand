/** @import {WorkerJobConstructor} from '../../../typcheck/simulator-ui.js' */
import { WorkerPool } from '../../../workers/worker-pool.js';
import { throwIfRunCancelled } from './helpers.js';
import { resolveMonteCarloWorkerCountV1 } from '../monte-carlo-parameters.js';
import { compileScenario, getDataVersion } from '../simulator-engine-helpers.js';
import { createMonteCarloChunkAccumulatorV1, mergeMonteCarloChunkResultV1, finalizeMonteCarloChunkAccumulatorV1 } from '../monte-carlo-chunk-result.js';
import { WorkerJobRunner, WorkerRunCancelledError } from '../worker-job-runner.js';
import { attachMonteCarloBatchOutcome, buildMonteCarloAggregates } from '../monte-carlo-runner.js';

let globalMonteCarloPool = null;

let globalMonteCarloPoolSize = 0;

function getMonteCarloPool(workerCount) {
    if (!globalMonteCarloPool
        || globalMonteCarloPoolSize !== workerCount
        || globalMonteCarloPool.disposed
        || globalMonteCarloPool.poolDisabled) {
        if (globalMonteCarloPool) {
            globalMonteCarloPool.dispose();
        }
        globalMonteCarloPool = new WorkerPool({
            workerUrl: new URL('../../../workers/mc-worker.js', import.meta.url),
            size: workerCount,
            type: 'module',
            telemetryName: 'MonteCarloPool',
            onError: error => console.error('[MC WorkerPool] Error:', error)
        });
        globalMonteCarloPoolSize = workerCount;
    }
    return globalMonteCarloPool;
}

export async function runMonteCarloWithWorkers({
    inputs,
    widowOptions,
    monteCarloParams,
    useCapeSampling,
    scenarioAnalyzer,
    onProgress,
    workerConfig = null,
    generationId,
    signal = null
}) {
    throwIfRunCancelled(signal, generationId);
    const {
        anzahl,
        maxDauer,
        blockSize,
        seed,
        methode,
        rngMode = 'per-run-seed',
        startYearMode,
        startYearFilter,
        startYearHalfLife,
        excludeEstimatedHistory = false
    } = monteCarloParams;
    const desiredWorkers = workerConfig?.workerCount ?? 0;
    const workerCount = resolveMonteCarloWorkerCountV1({
        workerCount: desiredWorkers,
        timeBudgetMs: workerConfig?.timeBudgetMs
    });
    const pool = getMonteCarloPool(workerCount);
    pool.ensureCapacity();
    pool.onError = error => console.error('[MC WorkerPool] Error:', error);

    const { scenarioKey, compiledScenario } = compileScenario(inputs, widowOptions, methode, useCapeSampling, inputs.stressPreset);
    const dataVersion = getDataVersion();
    // Random sample indices are logged by workers to build scenario highlights.
    const logIndices = scenarioAnalyzer?.getRandomSampleIndices?.() || null;

    const chunkAccumulator = createMonteCarloChunkAccumulatorV1(anzahl);
    const timeBudgetMs = workerConfig?.timeBudgetMs ?? 200;
    const chunkConfiguration = {
        strategy: 'adaptive-time-budget-v1',
        minChunkRuns: 10,
        baseTimeoutMs: 5000,
        stallTimeoutMs: 20000
    };
    const runner = new /** @type {WorkerJobConstructor} */ (WorkerJobRunner)({
        pool,
        totalItems: anzahl,
        workerCount,
        timeBudgetMs,
        minChunk: chunkConfiguration.minChunkRuns,
        baseTimeoutMs: chunkConfiguration.baseTimeoutMs,
        stallTimeoutMs: chunkConfiguration.stallTimeoutMs,
        onProgress: (pct, counts) => onProgress(pct * 0.9, { phase: 'simulating', completedRuns: counts.completedItems, totalRuns: counts.totalItems }),
        buildPayload: (start, count) => ({
            type: 'job',
            collectWealthFan: true,
            scenarioKey,
            runRange: { start, count },
            monteCarloParams: {
                anzahl: count,
                maxDauer,
                blockSize,
                seed,
                methode,
                rngMode,
                startYearMode,
                startYearFilter,
                startYearHalfLife,
                excludeEstimatedHistory
            },
            useCapeSampling,
            logIndices,
            dataVersion
        }),
        mergeResult: (result, start, count) => {
            mergeMonteCarloChunkResultV1(chunkAccumulator, result, {
                expectedStart: start,
                expectedCount: count,
                releaseWealthFan: true,
                allowWealthFanFailure: true
            });
        },
        generationId,
        signal
    });

    let cancellationCleanup = null;
    const abortGeneration = () => {
        cancellationCleanup = pool.cancelGeneration(
            generationId,
            new WorkerRunCancelledError(generationId, signal?.reason)
        );
    };
    signal?.addEventListener?.('abort', abortGeneration, { once: true });
    try {
        await pool.broadcast({
            type: 'init',
            scenarioKey,
            compiledScenario,
            dataVersion
        }, [], { generationId });

        throwIfRunCancelled(signal, generationId);
        await runner.run();
    } finally {
        signal?.removeEventListener?.('abort', abortGeneration);
        if (cancellationCleanup) await cancellationCleanup;
        // keep pool alive for reuse across runs
    }

    throwIfRunCancelled(signal, generationId);
    const finalized = finalizeMonteCarloChunkAccumulatorV1(chunkAccumulator);
    if (scenarioAnalyzer) {
        for (const meta of finalized.runMeta) {
            // Track samples in global run order, independent of worker completion order.
            meta.isRandomSample = scenarioAnalyzer.shouldCaptureRandomSample(meta.index);
            scenarioAnalyzer.addRun(meta);
        }
    }

    let worstRun = finalized.worstRun;
    let worstRunCare = finalized.worstRunCare;
    if (!worstRun) {
        worstRun = { finalVermoegen: Infinity, logDataRows: [], failed: false, comboIdx: 0, runIdx: 0 };
    }
    if (!worstRunCare) {
        worstRunCare = { finalVermoegen: Infinity, logDataRows: [], failed: false, hasCare: false, comboIdx: 0, runIdx: 0 };
    }

    onProgress(95, { phase: 'evaluating', completedRuns: anzahl, totalRuns: anzahl });
    await new Promise(resolve => setTimeout(resolve, 0));
    throwIfRunCancelled(signal, generationId);

    const aggregatedResults = attachMonteCarloBatchOutcome(buildMonteCarloAggregates({
        inputs,
        totalRuns: anzahl,
        buffers: finalized.buffers,
        heatmap: finalized.heatmap,
        bins: finalized.bins,
        totals: finalized.totals,
        lists: finalized.lists,
        pathSummaries: finalized.pathSummaries,
        pathMissingness: finalized.pathMissingness,
        allRealWithdrawalsSample: finalized.allRealWithdrawalsSample, wealthFan: finalized.wealthFan, displayHomeValueFan: finalized.displayHomeValueFan
    }), finalized.technicalInventory);

    onProgress(100, { phase: 'evaluating', completedRuns: anzahl, totalRuns: anzahl });

    return {
        aggregatedResults,
        failCount: finalized.totals.failCount,
        worstRun,
        worstRunCare,
        pflegeTriggeredCount: finalized.totals.pflegeTriggeredCount,
        batchStatus: aggregatedResults.batchStatus,
        financialMetricsValid: aggregatedResults.financialMetricsValid,
        technicalInventory: finalized.technicalInventory,
        samplingDiagnostics: finalized.samplingDiagnostics,
        executionDiagnostics: {
            mode: 'worker',
            workerCount,
            timeBudgetMs,
            chunkConfiguration
        }
    };
}
