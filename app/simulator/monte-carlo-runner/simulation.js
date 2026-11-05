// @ts-check

import { normalizeMonteCarloParametersV1 } from '../monte-carlo-parameters.js';
import { annualData } from '../simulator-data.js';
import { ScenarioAnalyzer } from '../scenario-analyzer.js';
import { runMonteCarloChunk } from './chunk.js';
import { attachMonteCarloBatchOutcome } from './batch.js';
import { buildMonteCarloAggregates } from '../monte-carlo-aggregates.js';
/** * Reine Monte-Carlo-Simulation ohne DOM-Abhängigkeiten.
 * Erwartet alle UI-Daten als Parameter und liefert Aggregationen sowie Szenario-Metadaten zurück.
 * Fortschritts-Updates und Szenario-Logging werden über Callbacks injiziert, um maximale Trennung zu erreichen. */
/** @param {import('../../../typcheck/rechenkern').MonteCarloChunkOptions & {scenarioAnalyzer?:ScenarioAnalyzer|null}} options */
export async function runMonteCarloSimulation({ inputs, monteCarloParams, widowOptions, useCapeSampling, onProgress = () => { }, scenarioAnalyzer = null, engine = null }) {
    const normalizedParameters = normalizeMonteCarloParametersV1(monteCarloParams, {
        inputs,
        historicalRecordCount: annualData.length || null
    });
    const { anzahl } = normalizedParameters;
    const analyzer = scenarioAnalyzer || new ScenarioAnalyzer(anzahl);

    const chunk = await runMonteCarloChunk({
        inputs,
        monteCarloParams: normalizedParameters,
        widowOptions,
        useCapeSampling,
        onProgress,
        engine,
        collectWealthFan: true,
        runRange: { start: 0, count: anzahl }
    });

    if (analyzer && chunk.runMeta) {
        for (const meta of chunk.runMeta) {
            meta.isRandomSample = analyzer.shouldCaptureRandomSample(meta.index);
            analyzer.addRun(meta);
        }
    }

    onProgress(95);
    await new Promise(resolve => setTimeout(resolve, 0));

    const aggregatedResults = attachMonteCarloBatchOutcome(buildMonteCarloAggregates({
        inputs,
        totalRuns: anzahl,
        buffers: chunk.buffers,
        heatmap: chunk.heatmap,
        bins: chunk.bins,
        totals: chunk.totals,
        lists: chunk.lists,
        allRealWithdrawalsSample: chunk.allRealWithdrawalsSample,
        wealthFan: chunk.wealthFan, displayHomeValueFan: chunk.displayHomeValueFan,
        pathSummaries: chunk.pathSummaries,
        pathMissingness: chunk.pathMissingness
    }), chunk.technicalInventory);

    onProgress(100);

    return {
        aggregatedResults,
        failCount: chunk.totals.failCount,
        worstRun: chunk.worstRun,
        worstRunCare: chunk.worstRunCare,
        pflegeTriggeredCount: chunk.totals.pflegeTriggeredCount,
        batchStatus: aggregatedResults.batchStatus,
        financialMetricsValid: aggregatedResults.financialMetricsValid,
        technicalInventory: chunk.technicalInventory,
        samplingDiagnostics: chunk.samplingDiagnostics
    };
}
