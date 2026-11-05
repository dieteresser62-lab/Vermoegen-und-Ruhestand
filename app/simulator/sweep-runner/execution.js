// @ts-check
/** @import {SweepChunkOptions,SweepChunkResult} from '../../../typcheck/rechenkern' */
import { iterateSweepChunk } from './chunk.js';

/** @param {SweepChunkOptions} options
 * @returns {SweepChunkResult} */
export function runSweepChunk(options) {
    const iterator = iterateSweepChunk(options);
    for (let step = iterator.next(); ; step = iterator.next()) {
        if (step.done) return step.value;
        options.onProgress?.(/** @type {number} */ (step.value));
    }
}

/** @param {SweepChunkOptions} options
 * @returns {Promise<SweepChunkResult>} */
export async function runSweepChunkAsync(options) {
    const iterator = iterateSweepChunk(options);
    const now = options.now ?? (() => performance.now());
    const yieldToEventLoop = options.yieldToEventLoop
        ?? (() => new Promise(resolve => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => setTimeout(resolve, 0));
            } else {
                setTimeout(resolve, 0);
            }
        }));
    let lastYieldAt = now();
    let yielded = false;
    while (true) {
        if (options.signal?.aborted) throw new DOMException('Sweep abgebrochen.', 'AbortError');
        const step = iterator.next();
        if (step.done) return step.value;
        options.onProgress?.(/** @type {number} */ (step.value));
        // Give the first visible update a paint opportunity. Subsequent timer
        // tasks are limited by elapsed time, even for many short simulations.
        if (!yielded || now() - lastYieldAt >= 16) {
            await yieldToEventLoop();
            if (options.signal?.aborted) throw new DOMException('Sweep abgebrochen.', 'AbortError');
            yielded = true;
            lastYieldAt = now();
        }
    }
}
