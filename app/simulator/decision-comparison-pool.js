/** @import * as AnalysisTypes from '../../typcheck/simulator-analysis.js' */
/** @import * as CoreTypes from '../../typcheck/rechenkern.js' */
/** @import * as CoreIntegrationTypes from '../../typcheck/rechenkern-integration.js' */
import { WorkerPool } from '../../workers/worker-pool.js';
import { resolveMonteCarloWorkerCountV1 } from './monte-carlo-parameters.js';
import { createMonteCarloChunkAccumulatorV1, mergeMonteCarloChunkResultV1,
    finalizeMonteCarloChunkAccumulatorV1 } from './monte-carlo-chunk-result.js';
import { runDecisionComparisonRange } from './decision-comparison-runner.js';

let nextGeneration = 1;

/** Ein Pool für alle Pläne einer Sitzung; Aufzeichnungen bleiben beim Aufrufer.
 *
 * @param options - Optionen des Aufrufers.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createDecisionComparisonPool({ workerConfig = {}, engine, signal, check }) {
    let pool, workerFailed = false, disposed = false;
    const dispose = () => {
        disposed = true;
        signal?.removeEventListener('abort', dispose);
        pool?.dispose();
    };
    signal?.addEventListener('abort', dispose, { once: true });
    /** @param {Omit<CoreIntegrationTypes.DecisionComparisonRequest, 'params' | 'runRange'> & {params: CoreTypes.MonteCarloParameters; runRange?: {start: number; count: number}}} request @param {{onProgress?: AnalysisTypes.ComparisonProgress}} [options] */
    const run = async (request, { onProgress = () => {} } = {}) => {
        check();
        if (disposed) throw new Error('Vergleichssitzung bereits beendet.');
        const totalRuns = request.params.anzahl;
        const serial = () => runDecisionComparisonRange({ ...request, runRange: { start: 0, count: totalRuns } },
            { engine, signal, onProgress: pct => { check(); onProgress(pct,
                { completedRuns: Math.floor(pct / 90 * totalRuns), totalRuns }); } });
        let parts;
        if (!workerFailed && typeof Worker !== 'undefined' && request.params.rngMode !== 'legacy-stream') {
            const generationId = `decision-comparison-${nextGeneration++}`;
            let progressError;
            try {
                const workerCount = resolveMonteCarloWorkerCountV1(workerConfig);
                const completed = new Map();
                const report = (start, count, pct) => {
                    try {
                        check();
                        completed.set(start, count * pct / 90);
                        onProgress([...completed.values()].reduce((a, b) => a + b, 0) / totalRuns * 90,
                            { completedRuns: Math.floor([...completed.values()].reduce((a, b) => a + b, 0)), totalRuns });
                    } catch (error) {
                        progressError = error;
                        pool.cancelGeneration(generationId, error);
                    }
                };
                if (!pool) {
                    // Erst zuweisen, dann erweitern: Auch ein teilweise gescheiterter Start wird aufgeräumt.
                    pool = new WorkerPool({ workerUrl: new URL('../../workers/decision-comparison-worker.js', import.meta.url),
                        size: 1, telemetryName: 'DecisionComparisonPool' });
                    pool.size = workerCount;
                }
                pool.onProgress = message => report(message.runRange.start, message.runRange.count, message.pct);
                check();
                const jobs = [];
                const size = Math.ceil(totalRuns / workerCount);
                for (let start = 0; start < totalRuns; start += size) {
                    const count = Math.min(size, totalRuns - start);
                    /** @param {[number, unknown]} entry */
                    const inRange = ([index]) => index >= start && index < start + count;
                    jobs.push(pool.runJob({ ...request, runRange: { start, count },
                        tapes: new Map([...request.tapes].filter(inRange)),
                        continuationYears: new Map([...request.continuationYears].filter(inRange)) }, [], { generationId })
                        .then(result => { report(start, count, 90); return result; }));
                }
                parts = await Promise.all(jobs);
                if (progressError) throw progressError;
            } catch (error) {
                workerFailed = true;
                pool?.dispose();
                check();
                if (progressError) throw progressError;
                // Wie bei Monte Carlo: fehlende/gescheiterte Worker rechnen seriell weiter.
                parts = [await serial()];
            }
        } else parts = [await serial()];
        check();
        const accumulator = createMonteCarloChunkAccumulatorV1(totalRuns);
        const budgets = [], diagnostics = [], tapes = new Map(), continuationYears = new Map();
        for (const part of parts.sort((a, b) => a.chunk.runRange.start - b.chunk.runRange.start)) {
            mergeMonteCarloChunkResultV1(accumulator, part.chunk);
            budgets.push(...part.budgets);
            diagnostics.push(...part.diagnostics);
            for (const [index, tape] of part.tapes) tapes.set(index, tape);
            for (const [index, years] of part.continuationYears) continuationYears.set(index, years);
        }
        const chunk = /** @type {ReturnType<typeof finalizeMonteCarloChunkAccumulatorV1> & {financialMetricsValid?: boolean}} */ (finalizeMonteCarloChunkAccumulatorV1(accumulator));
        // Die Vergleichsaggregate behalten die originalen Runner-Listen (etwa
        // Pflegejahre einschließlich Nachkommastellen) statt Integer-Projektionen.
        chunk.lists = Object.fromEntries(Object.keys(parts[0].chunk.lists).map(key =>
            [key, parts.flatMap(part => part.chunk.lists[key])]));
        chunk.financialMetricsValid = chunk.technicalInventory.technicalError === 0;
        return { chunk, budgets, diagnostics, tapes, continuationYears };
    };
    return { run, dispose };
}
