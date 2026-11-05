import { EngineAPI } from '../engine/index.mjs';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { runDecisionComparisonRange } from '../app/simulator/decision-comparison-runner.js';

self.onmessage = async (/** @type {MessageEvent<import('../typcheck/rechenkern-integration').DecisionComparisonRequest & import('../typcheck/rechenkern').WorkerCommand>} */ { data: { jobId, generationId, ...request } }) => {
    try {
        prepareHistoricalDataOnce();
        const result = await /** @type {import('../typcheck/rechenkern-integration').RunDecisionComparisonRange} */ (runDecisionComparisonRange)(request, { engine: EngineAPI,
            onProgress: pct => self.postMessage({ type: 'progress', jobId, generationId, pct,
                runRange: request.runRange }) });
        self.postMessage({ type: 'result', jobId, generationId, ...result });
    } catch (error) {
        self.postMessage({ type: 'error', jobId, generationId, message: /** @type {Error} */ (error).message, stack: /** @type {Error} */ (error).stack });
    }
};
