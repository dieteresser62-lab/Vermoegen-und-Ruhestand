import {
    createMonteCarloUI, readMonteCarloParameters, cancelMonteCarlo, activeMonteCarloRun, setOverviewRunPhase, beginOverviewRun, readOverviewAssumptions, failOverviewRun, completeOverviewRun, projectMonteCarloOverview, throwIfRunCancelled, formatMs, formatSpeedup, prepareHistoricalDataOnce, compileScenario, getDataVersion, validateSimulatorInputs, formatSimulatorValidationError, getCommonInputs, personDataContextFor, readDocumentPersonInputs, createProtocolPersonContext, normalizeWidowOptions, annualData, resolveMonteCarloSamplingContractV1, beginSimulationSummary, completeSimulationSummary, ScenarioAnalyzer, runMonteCarloSerial, runMonteCarloLogsForIndices, runMonteCarloWithWorkers, isWorkerRunCancelledError, createMonteCarloRunRequestV1, createMonteCarloRunResultV1, createMonteCarloExportDownload, captureMonteCarloEngineProvenance, EngineAPI, displayMonteCarloResults, recordMonteCarloHintMeasurement, monteCarloHintComparableKey, simulatorRunAssumptions
} from './execution-dependencies.js';
import { rememberPublishedMonteCarloRun, monteCarloFingerprint, showMonteCarloMemorySource } from './result-memory.js';

export async function executeMonteCarloRun(runState) {
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
    showMonteCarloMemorySource(runState.documentRef, '');
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
        validateSimulatorInputs(inputs, { horizonYears: maxDauer });
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
        const runFingerprint = monteCarloFingerprint({ inputs, monteCarloParams, widowOptions, useCapeSampling, dataVersion: getDataVersion(), personDataContext }); // vor der Rechnung
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
        const displayContext = { personDataContext, personDisplayContext,
            startYear: personDataContext?.referenceYear ?? (Number.isFinite(startYear) ? startYear : undefined) };
        (dependencies.displayResults || displayMonteCarloResults)(aggregatedResults, anzahl, failCount, worstRun, {}, {}, pflegeTriggeredCount, inputs, worstRunCare, scenarioLogs, displayContext);
        if (runState.registration) {
            runState.registration.resultAvailable = true;
            rememberPublishedMonteCarloRun({ rngMode, registration: runState.registration, doc: runState.documentRef, fingerprint: runFingerprint, startedAt: startedAt || null,
                display: { aggregatedResults, anzahl, failCount, worstRun, pflegeTriggeredCount, worstRunCare, scenarioLogs, displayContext }, exportDownload: { ...exportDownload } });
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
            if (overviewToken) completeOverviewRun('montecarlo', overviewToken, projectMonteCarloOverview(aggregatedResults, anzahl, failCount, inputs));
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
