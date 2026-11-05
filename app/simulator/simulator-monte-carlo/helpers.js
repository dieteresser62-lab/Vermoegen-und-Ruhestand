import { WorkerRunCancelledError } from '../worker-job-runner.js';

export const formatMs = (value, digits = 0) => `${Number(value).toFixed(digits)} ms`;

export const formatSpeedup = (value, digits = 2) => `${Number(value).toFixed(digits)}x`;

export function mergeHeatmap(target, source) {
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

export function appendArray(target, source) {
    if (!source || source.length === 0) return;
    for (let i = 0; i < source.length; i++) {
        target.push(source[i]);
    }
}

export function throwIfRunCancelled(signal, generationId) {
    if (signal?.aborted) {
        throw new WorkerRunCancelledError(generationId, signal.reason);
    }
}
