/** @import * as AnalysisTypes from '../../typcheck/simulator-analysis.js' */
/** @import * as CoreIntegrationTypes from '../../typcheck/rechenkern-integration.js' */
/** DOM-freier Vergleichsbereich; Maps und Ergebnis sind structured-clone-fähig. */
import { runMonteCarloChunk } from './monte-carlo-runner.js';
import { readMinimumFlexYear } from './minimum-flex-metrics.js';
import { normalizeWidowOptions } from './simulator-sweep-utils.js';

/** @param {CoreIntegrationTypes.DecisionComparisonRequest} request
 * @param {{engine?: typeof import('../../engine/index.mjs').EngineAPI | null; signal?: AbortSignal; onProgress?: AnalysisTypes.ComparisonProgress}} [options]
 * @returns {Promise<AnalysisTypes.DecisionRangeResult>} */
export async function runDecisionComparisonRange({ inputs, params, useCapeSampling, runRange,
    tapes = new Map(), continuationYears = new Map(), record = false, diagnosticRuns = 0,
    captureLogs = false }, { engine = null, signal, onProgress = () => {} } = {}) {
    const budgets = Array.from({ length: runRange.count }, () => []), diagnostics = [];
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: params, runRange,
        widowOptions: normalizeWidowOptions(inputs.widowOptions), useCapeSampling, engine, signal,
        logIndices: captureLogs ? null : [], onProgress,
        comparisonPairing: {
            mode: record ? 'record' : 'replay', tapes, continuationYears,
            onYear: row => { if (row.runIndex < diagnosticRuns) diagnostics.push(row); },
            onFinancialYear: (runIndex, row) => {
                const flex = readMinimumFlexYear(row), factor = row?.inflation_factor_cum;
                if (flex && !flex.missing && Number.isFinite(row.floor_brutto) && factor > 0)
                    budgets[runIndex - runRange.start].push((row.floor_brutto + flex.paid) / factor);
            }
        } });
    return { chunk, budgets, diagnostics, tapes, continuationYears };
}
