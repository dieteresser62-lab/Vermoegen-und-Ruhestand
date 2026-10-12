import { readHouseholdPersonStatus } from '../shared/person-data-status.js';
import { simulatorRunAssumptions } from './simulator-run-assumptions.js';
import { beginSimulationSummary, completeSimulationSummary } from './simulator-overview-summary.js';
import { personDataContextFor, readDocumentPersonInputs } from './simulator-person-overrides.js';
import { createProtocolPersonContext } from './protocol-columns.js';
"use strict";

import { getCommonInputs } from './simulator-portfolio.js';
import { compileScenario, getDataVersion, prepareHistoricalDataOnce } from './simulator-engine-helpers.js';
import { displayMonteCarloResults } from './simulator-results.js';
import { normalizeWidowOptions } from './simulator-sweep-utils.js';
import { readMonteCarloParameters, createMonteCarloUI, setMonteCarloRunBusy } from './monte-carlo-ui.js';
import { ScenarioAnalyzer } from './scenario-analyzer.js';
import {
    attachMonteCarloBatchOutcome,
    buildMonteCarloAggregates,
    runMonteCarloChunk
} from './monte-carlo-runner.js';
import {
    createMonteCarloChunkAccumulatorV1,
    finalizeMonteCarloChunkAccumulatorV1,
    mergeMonteCarloChunkResultV1
} from './monte-carlo-chunk-result.js';
import {
    WorkerJobRunner,
    WorkerRunCancelledError,
    isWorkerRunCancelledError
} from './worker-job-runner.js';
import { featureFlags } from '../shared/feature-flags.js';
import { WorkerPool } from '../../workers/worker-pool.js';
import { formatSimulatorValidationError, validateSimulatorInputs } from './simulator-input-validation.js';
import { EngineAPI } from '../../engine/index.mjs';
import {
    createMonteCarloRunRequestV1,
    createMonteCarloRunResultV1
} from './monte-carlo-contracts.js';
import {
    captureMonteCarloEngineProvenance,
    createMonteCarloExportDownload
} from './monte-carlo-export.js';
import { normalizeMonteCarloParametersV1, resolveMonteCarloWorkerCountV1 } from './monte-carlo-parameters.js';
import { resolveMonteCarloSamplingContractV1 } from './mc-year-sampling.js';
import { annualData } from './simulator-data.js';
import { createStressReplayCaptureRequest } from './stress-replay-path-materializer.js';
import { recordMonteCarloHintMeasurement, monteCarloHintComparableKey } from './monte-carlo-run-hint.js';

import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { beginOverviewRun, completeOverviewRun, failOverviewRun, projectMonteCarloOverview, readOverviewAssumptions, setOverviewRunPhase } from './simulator-result-overview.js';

const formatMs = (value, digits = 0) => `${Number(value).toFixed(digits)} ms`;
const formatSpeedup = (value, digits = 2) => `${Number(value).toFixed(digits)}x`;

function mergeHeatmap(target, source) {
    // Sum bin counts per year; used for worker chunk merges.
    for (let year = 0; year < target.length; year++) {
        const targetRow = target[year];
        const sourceRow = source[year];
        if (!sourceRow) continue;
        for (let i = 0; i < targetRow.length; i++) {
            targetRow[i] += sourceRow[i] || 0;
        }
    }
}

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

export async function runMonteCarloLogsForIndices(options) {
    const { logsByIndex } = await runMonteCarloSerialRerunForIndices(options);
    return logsByIndex;
}

export async function runMonteCarloReplayCaptureForIndices(options) {
    return runMonteCarloSerialRerunForIndices({ ...options, captureStressReplay: true });
}

function appendArray(target, source) {
    if (!source || source.length === 0) return;
    for (let i = 0; i < source.length; i++) {
        target.push(source[i]);
    }
}

export { mergeHeatmap, appendArray };

let globalMonteCarloPool = null;
let globalMonteCarloPoolSize = 0;
let activeMonteCarloRun = null;
let nextMonteCarloGeneration = 1;

const monteCarloRegistrations = new WeakMap();

function monteCarloNavigationRegistration() {
    const doc = globalThis.document;
    if (!doc || typeof doc !== 'object') return null;
    if (!monteCarloRegistrations.has(doc)) {
        const guard = getPageNavigationGuard(doc);
        // Ergebnis und Revision gehören zum Dokument, auch bei BFCache-Rückkehr.
        // Der globale Singleflight-Controller ist dagegen nur dessen aktiver Lauf.
        const state = { guard, resultAvailable: false, revision: 0 };
        const registration = guard.register('simulator-monte-carlo', {
            read: () => {
                const run = activeMonteCarloRun?.registration === state ? activeMonteCarloRun : null;
                return {
                    phase: run?.status || 'idle',
                    operationId: run?.generationId || null,
                    revision: state.revision,
                    result: state.resultAvailable,
                    message: run
                        ? 'Laufende Rechnung wird abgebrochen – trotzdem wechseln?'
                            + (state.resultAvailable ? '\nErgebnis geht verloren – trotzdem wechseln?' : '')
                        : undefined
                };
            },
            cancel: () => cancelMonteCarlo().then(() => true)
        });
        Object.assign(state, registration);
        monteCarloRegistrations.set(doc, state);
    }
    return monteCarloRegistrations.get(doc);
}

// Derselbe einzelne Chunk und dieselbe Aggregation wie im bisherigen seriellen
// Runner, hier mit Signal bis in die bereits abbrechbare Chunk-Ausführung.
export async function runMonteCarloSerial({ inputs, monteCarloParams, widowOptions,
    useCapeSampling, onProgress = () => {}, scenarioAnalyzer = null, signal = null }) {
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
        allRealWithdrawalsSample: chunk.allRealWithdrawalsSample, wealthFan: chunk.wealthFan
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

function createMonteCarloGenerationId() {
    return `monte-carlo-${nextMonteCarloGeneration++}`;
}

function throwIfRunCancelled(signal, generationId) {
    if (signal?.aborted) {
        throw new WorkerRunCancelledError(generationId, signal.reason);
    }
}

function getMonteCarloPool(workerCount) {
    if (!globalMonteCarloPool
        || globalMonteCarloPoolSize !== workerCount
        || globalMonteCarloPool.disposed
        || globalMonteCarloPool.poolDisabled) {
        if (globalMonteCarloPool) {
            globalMonteCarloPool.dispose();
        }
        globalMonteCarloPool = new WorkerPool({
            workerUrl: new URL('../../workers/mc-worker.js', import.meta.url),
            size: workerCount,
            type: 'module',
            telemetryName: 'MonteCarloPool',
            onError: error => console.error('[MC WorkerPool] Error:', error)
        });
        globalMonteCarloPoolSize = workerCount;
    }
    return globalMonteCarloPool;
}

async function runMonteCarloWithWorkers({
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
    const runner = new WorkerJobRunner({
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
        allRealWithdrawalsSample: finalized.allRealWithdrawalsSample, wealthFan: finalized.wealthFan
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

/**
 * Koordiniert die Monte-Carlo-Simulation (UI-Orchestrator)
 *
 * Diese Funktion ist der zentrale Einstiegspunkt für Monte-Carlo-Simulationen.
 * Sie orchestriert:
 * - UI-Vorbereitung (Fortschrittsbalken, Button-States)
 * - Eingabedaten-Sammlung (Portfolio, Renten, Pflege, MC-Parameter)
 * - Aufruf der DOM-freien Simulation (monte-carlo-runner.js)
 * - Szenario-Analyse und Auswahl charakteristischer Runs
 * - Ergebnis-Darstellung (Perzentile, KPIs, Worst-Run, Pflegefall-Statistik)
 *
 * Die eigentliche Simulationslogik ist DOM-frei; UI-spezifische Aufgaben
 * (Fortschrittsanzeige, Benutzereingaben, Ergebnisdarstellung) werden hier gebündelt.
 *
 * @async
 * @returns {Promise<void>} Promise, das nach Abschluss der Simulation aufgelöst wird
 * @throws {Error} Bei Validierungs- oder Berechnungsfehlern
 */
export function runMonteCarlo(dependencies = {}) {
    // Auch direkte Modulaufrufe sind gesperrt, bevor UI/Navigation/Worker anlaufen.
    if (globalThis.window?.__profileRecoveryBlocker || globalThis.window?.__personDataBlocker
        || !readHouseholdPersonStatus().ready) return false;
    if (activeMonteCarloRun) return activeMonteCarloRun.promise;

    const registration = monteCarloNavigationRegistration();
    if (registration?.guard.isBusy()) return Promise.resolve();
    const runState = {
        generationId: createMonteCarloGenerationId(),
        controller: new AbortController(),
        status: 'preparing',
        registration,
        documentRef: globalThis.document,
        ui: null,
        promise: null,
        cancelPromise: null,
        dependencies: dependencies && typeof dependencies === 'object' ? dependencies : {}
    };
    activeMonteCarloRun = runState;
    setMonteCarloRunBusy(runState.documentRef, true);
    if (registration) registration.revision++;
    runState.promise = Promise.resolve().then(() => executeMonteCarloRun(runState)).finally(() => {
        if (activeMonteCarloRun === runState) activeMonteCarloRun = null;
        setMonteCarloRunBusy(runState.documentRef, false);
        registration?.notify();
    });
    registration?.notify();
    return runState.promise;
}

export function cancelMonteCarlo() {
    const runState = activeMonteCarloRun;
    if (!runState) return Promise.resolve(false);
    if (runState.cancelPromise) return runState.cancelPromise;

    runState.status = 'cancelling';
    runState.registration?.notify();
    runState.ui?.beginCancelling?.();
    runState.controller.abort(new WorkerRunCancelledError(runState.generationId));
    runState.cancelPromise = runState.promise.then(() => true);
    return runState.cancelPromise;
}

async function executeMonteCarloRun(runState) {
    const { generationId, controller } = runState;
    const { signal } = controller;
    const dependencies = runState.dependencies || {};
    const ui = (dependencies.createUI || createMonteCarloUI)();
    runState.ui = ui;
    ui.bindCancel?.(() => cancelMonteCarlo());
    ui.beginRun?.({ preparing: true });
    ui.disableStart();
    ui.hideError(); // Reset error state
    ui.clearRunExport();
    setOverviewRunPhase('montecarlo', 'preparing');
    let overviewToken = null;
    let summaryContext = null, successfulSummary = null, completed = false;
    const updateProgress = (percent, detail) => {
        if (!signal.aborted && activeMonteCarloRun === runState) {
            ui.updateProgress(percent, detail);
        }
    };

    try {
        throwIfRunCancelled(signal, generationId);
        await (dependencies.prepareHistoricalData || prepareHistoricalDataOnce)();
        throwIfRunCancelled(signal, generationId);
        const inputs = (dependencies.validateInputs || validateSimulatorInputs)(
            (dependencies.getInputs || getCommonInputs)()
        );
        const personDataContext = personDataContextFor(inputs);
        const personEntries = readDocumentPersonInputs()?.entries || [];
        const personDisplayContext = createProtocolPersonContext(inputs, (personDataContext?.persons || []).map(person =>
            personEntries.find(entry => entry.profileId === person.profileId)));
        const widowOptions = normalizeWidowOptions(inputs.widowOptions);
        const {
            anzahl,
            maxDauer,
            blockSize,
            seed,
            methode,
            rngMode,
            startYearMode,
            startYearFilter,
            startYearHalfLife,
            excludeEstimatedHistory
        } = (dependencies.readParameters || readMonteCarloParameters)(inputs);
        const monteCarloParams = {
            anzahl,
            maxDauer,
            blockSize,
            seed,
            methode,
            rngMode,
            startYearMode,
            startYearFilter,
            startYearHalfLife,
            excludeEstimatedHistory
        };
        const useCapeSampling = ui.readUseCapeSampling();
        const effectiveAnnualData = dependencies.annualData || annualData;
        (dependencies.resolveSamplingContract || resolveMonteCarloSamplingContractV1)({
            method: methode,
            inputs,
            annualData: effectiveAnnualData,
            useCapeSampling,
            startYearMode,
            startYearFilter,
            startYearHalfLife,
            blockSize,
            excludeEstimatedHistory
        });
        const workerConfig = ui.readWorkerConfig();
        ui.requireLargeRunConfirmation(monteCarloParams);
        throwIfRunCancelled(signal, generationId);
        runState.status = 'running';
        overviewToken = (dependencies.beginOverviewRun || beginOverviewRun)('montecarlo', readOverviewAssumptions('montecarlo', inputs, {
            ...monteCarloParams, useCapeSampling
        }), { startedAt: new Date().toISOString(), generationId });
        summaryContext = (dependencies.beginSimulationSummary || beginSimulationSummary)('montecarlo', inputs, { ...monteCarloParams, useCapeSampling });
        runState.registration?.notify();
        ui.showProgress();
        updateProgress(0, { phase: 'simulating', completedRuns: 0, totalRuns: anzahl });
        ui.hideCompareResults();

        const scenarioAnalyzer = new ScenarioAnalyzer(anzahl);
        const useWorkers = rngMode !== 'legacy-stream';
        const compareMode = ui.readCompareMode();
        const measurementStartedAt = performance.now();
        let results = null;
        let usedWorkers = false;

        if (compareMode) {
            const serialStart = performance.now();
            const serialResults = await (dependencies.runSerial || runMonteCarloSerial)({
                inputs,
                widowOptions,
                monteCarloParams,
                useCapeSampling,
                onProgress: (pct, detail) => updateProgress(pct * 0.5, { ...detail, comparison: 'Vergleich seriell' }),
                scenarioAnalyzer: null,
                signal
            });
            throwIfRunCancelled(signal, generationId);
            const serialElapsed = performance.now() - serialStart;

            if (!useWorkers) {
                ui.showCompareResults(`Seriell: ${formatMs(serialElapsed)} (Worker nicht verfuegbar im Legacy-Stream).`);
                results = serialResults;
            } else {
                const workerStart = performance.now();
                try {
                    results = await (dependencies.runWorkers || runMonteCarloWithWorkers)({
                        inputs,
                        widowOptions,
                        monteCarloParams,
                        useCapeSampling,
                        onProgress: (pct, detail) => updateProgress(50 + pct * 0.5, { ...detail, comparison: 'Vergleich Worker' }),
                        scenarioAnalyzer,
                        workerConfig,
                        generationId,
                        signal
                    });
                    throwIfRunCancelled(signal, generationId);
                    usedWorkers = true;
                    const workerElapsed = performance.now() - workerStart;
                    const speedup = serialElapsed > 0 ? (serialElapsed / workerElapsed) : 0;
                    ui.showCompareResults(`Seriell: ${formatMs(serialElapsed)} · Worker: ${formatMs(workerElapsed)} · Speedup: ${formatSpeedup(speedup, 2)}`);
                } catch (error) {
                    if (isWorkerRunCancelledError(error) || signal.aborted) throw error;
                    console.error('[MC] Worker execution failed, falling back to serial.', error);
                    results = serialResults;
                    ui.showCompareResults(`Seriell: ${formatMs(serialElapsed)} · Worker fehlgeschlagen (Fallback auf seriell).`);
                }
            }
        } else if (useWorkers) {
            try {
                results = await (dependencies.runWorkers || runMonteCarloWithWorkers)({
                    inputs,
                    widowOptions,
                    monteCarloParams,
                    useCapeSampling,
                    onProgress: updateProgress,
                    scenarioAnalyzer,
                    workerConfig,
                    generationId,
                    signal
                });
                usedWorkers = true;
            } catch (error) {
                if (isWorkerRunCancelledError(error) || signal.aborted) throw error;
                console.error('[MC] Worker execution failed, falling back to serial.', error);
                results = null;
            }
        }

        if (!results) {
            throwIfRunCancelled(signal, generationId);
            results = await (dependencies.runSerial || runMonteCarloSerial)({
                inputs,
                widowOptions,
                monteCarloParams,
                useCapeSampling,
                onProgress: updateProgress,
                scenarioAnalyzer,
                signal
                // engine parameter removed - wrapper selects correct engine based on feature flag mode
            });
        }
        throwIfRunCancelled(signal, generationId);

        const {
            aggregatedResults,
            failCount,
            worstRun,
            worstRunCare,
            pflegeTriggeredCount,
            batchStatus,
            technicalInventory
        } = results;

        const effectiveExecutionDiagnostics = results.executionDiagnostics || {
            mode: 'serial',
            workerCount: 0,
            timeBudgetMs: null,
            chunkConfiguration: {
                strategy: 'single-chunk-v1',
                minChunkRuns: null,
                baseTimeoutMs: null,
                stallTimeoutMs: null
            }
        };
        const { scenarioKey } = compileScenario(
            inputs,
            widowOptions,
            methode,
            useCapeSampling,
            inputs.stressPreset
        );
        const runRequest = createMonteCarloRunRequestV1({
            inputs,
            widowOptions,
            monteCarloParams,
            useCapeSampling,
            samplingDiagnostics: results.samplingDiagnostics,
            dataVersion: results.samplingDiagnostics?.dataVersion || getDataVersion(),
            execution: {
                ...effectiveExecutionDiagnostics,
                compareModeRequested: compareMode
            },
            scenarioKey
        });
        const runResult = createMonteCarloRunResultV1({
            aggregatedResults,
            samplingDiagnostics: results.samplingDiagnostics,
            executionDiagnostics: runRequest.execution,
            requestedRuns: anzahl
        });
        const exportDownload = createMonteCarloExportDownload({
            personDataContext,
            request: runRequest,
            result: runResult,
            engine: captureMonteCarloEngineProvenance(EngineAPI)
        });

        if (batchStatus === 'technical_error') {
            throwIfRunCancelled(signal, generationId);
            ui.publishRunExport(exportDownload);
            const firstError = technicalInventory?.errors?.[0];
            failOverviewRun('montecarlo', 'technical_error');
            ui.showError(firstError?.message || 'Die Monte-Carlo-Simulation wurde wegen eines technischen Fehlers beendet.');
            return;
        }

        if (usedWorkers && scenarioAnalyzer) {
            // Re-run selected indices in serial to capture full log rows.
            const targetIndices = scenarioAnalyzer.getCharacteristicIndices();
            const logsByIndex = await (dependencies.runLogsForIndices || runMonteCarloLogsForIndices)({
                inputs,
                widowOptions,
                monteCarloParams,
                useCapeSampling,
                runIndices: targetIndices,
                generationId,
                signal
            });
            throwIfRunCancelled(signal, generationId);
            scenarioAnalyzer.updateRunLogs(logsByIndex);
            if (logsByIndex.has(worstRun?.runIdx)) {
                worstRun.logDataRows = logsByIndex.get(worstRun.runIdx);
            }
            if (logsByIndex.has(worstRunCare?.runIdx)) {
                worstRunCare.logDataRows = logsByIndex.get(worstRunCare.runIdx);
            }
        }

        const scenarioLogs = scenarioAnalyzer.buildScenarioLogs();
        throwIfRunCancelled(signal, generationId);
        ui.publishRunExport(exportDownload);
        throwIfRunCancelled(signal, generationId);
        const startedAt = overviewToken?.metadata?.startedAt;
        const startYear = startedAt ? new Date(startedAt).getFullYear() : undefined;
        (dependencies.displayResults || displayMonteCarloResults)(aggregatedResults, anzahl, failCount, worstRun, {}, {}, pflegeTriggeredCount, inputs, worstRunCare, scenarioLogs, {
            personDataContext,
            personDisplayContext,
            startYear: personDataContext?.referenceYear ?? (Number.isFinite(startYear) ? startYear : undefined)
        });
        if (runState.registration) {
            runState.registration.resultAvailable = true;
            runState.registration.revision++;
        }
        runState.registration?.notify();
        ui.showCompleted?.();
        // Nur erfolgreich veröffentlichte, vergleichbare Läufe liefern eine Grundlage.
        // Compare/Fallback mischt Ausführungsarten und liefert keine Dauerschätzung.
        if (!compareMode && (usedWorkers || rngMode === 'legacy-stream')) {
            recordMonteCarloHintMeasurement(runState.documentRef, { completed: true,
                runs: anzahl, years: maxDauer, elapsedMs: performance.now() - measurementStartedAt,
                comparableKey: monteCarloHintComparableKey(inputs, monteCarloParams, workerConfig, useCapeSampling),
                successRatio: aggregatedResults?.outcomeInventory?.floorCoverageEstimate?.estimateRatio ?? null });
        }
        throwIfRunCancelled(signal, generationId);
        if (activeMonteCarloRun === runState) {
            if (overviewToken) completeOverviewRun('montecarlo', overviewToken, projectMonteCarloOverview(aggregatedResults, anzahl, failCount));
            if (!overviewToken || simulatorRunAssumptions.read('montecarlo').last?.metadata === overviewToken.metadata) {
                successfulSummary = { result: aggregatedResults, requestedRuns: anzahl };
                completed = true;
            }
        }
    } catch (e) {
        if (isWorkerRunCancelledError(e) || signal.aborted) {
            runState.cancelled = true;
            failOverviewRun('montecarlo', 'cancelled');
            ui.showCancelled?.();
            return;
        }
        console.error("Monte-Carlo Simulation Failed:", e);
        failOverviewRun('montecarlo', 'error');
        ui.showError(formatSimulatorValidationError(e), e);
    } finally {
        try {
            await ui.finishProgress({ completed });
            if (completed && !signal.aborted && activeMonteCarloRun === runState) {
                await (dependencies.completeSimulationSummary || completeSimulationSummary)(summaryContext, successfulSummary.result,
                    { requestedRuns: successfulSummary.requestedRuns }, { isCurrent: () => !signal.aborted && activeMonteCarloRun === runState });
            }
        } finally {
            ui.unbindCancel?.();
            ui.finishRun?.();
            ui.enableStart();
        }
    }
}
