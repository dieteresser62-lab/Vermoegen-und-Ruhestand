// @ts-check

import { MC_HEATMAP_BINS, createMonteCarloBuffers } from '../monte-carlo-runner-utils.js';
import { assertNonNegativeInteger, contractError } from './validation-primitives.js';
import { createMonteCarloPathSummaryV1 } from './path-buffers.js';
import { MONTE_CARLO_CHUNK_RESULT_VERSION, MONTE_CARLO_BUFFER_FIELDS, MONTE_CARLO_PATH_SUMMARY_FIELDS, MONTE_CARLO_PATH_MISSINGNESS_FIELDS } from './schema.js';
import { assertMonteCarloChunkResultV1 } from './assert-result.js';
import { mergeHomeWealthFan } from '../wealth-home-fan.js';
import { assertWealthFan, createWealthFan, mergeWealthFan } from '../wealth-fan-aggregation.js';
/** @param {number} totalRuns
 * @param {{bins?:number[];heatmapRows?:number;retainRunMeta?:boolean}} options
 * @returns {import('../../../typcheck/rechenkern').ChunkAccumulator} */
export function createMonteCarloChunkAccumulatorV1(totalRuns, {
    bins = MC_HEATMAP_BINS,
    heatmapRows = 10,
    retainRunMeta = true
} = {}) {
    assertNonNegativeInteger(totalRuns, 'totalRuns');
    assertNonNegativeInteger(heatmapRows, 'heatmapRows');
    if (!Array.isArray(bins) || bins.length < 2) throw contractError('Accumulator bins are invalid.');
    const buffers = createMonteCarloBuffers(totalRuns);
    const { pathSummaries, pathMissingness } = createMonteCarloPathSummaryV1(totalRuns, { buffers });
    return {
        schemaVersion: MONTE_CARLO_CHUNK_RESULT_VERSION,
        totalRuns,
        bins: [...bins],
        heatmapRows,
        buffers,
        pathSummaries,
        pathMissingness,
        mergedRuns: new Uint8Array(totalRuns),
        retainRunMeta: retainRunMeta === true,
        runMetaByIndex: retainRunMeta === true ? new Array(totalRuns) : null,
        samplingDiagnostics: null,
        wealthFan: null,
        wealthFanMissing: false,
        contributions: new Map()
    };
}

/** @param {import('../../../typcheck/rechenkern').ChunkAccumulator} accumulator
 * @param {import('../../../typcheck/rechenkern').MonteCarloChunkResult} result */
export function assertCompatibleBins(accumulator, result) {
    if (result.heatmap.length !== accumulator.heatmapRows || result.bins.length !== accumulator.bins.length) {
        throw contractError('Chunk heatmap dimensions do not match the accumulator.');
    }
    for (let index = 0; index < accumulator.bins.length; index++) {
        if (!Object.is(accumulator.bins[index], result.bins[index])) {
            throw contractError(`Chunk bin ${index} does not match the accumulator.`);
        }
    }
}

/** @param {import('../../../typcheck/rechenkern').ChunkAccumulator} accumulator
 * @param {import('../../../typcheck/rechenkern').MonteCarloChunkResult} result
 * @param {{expectedStart?:number|null;expectedCount?:number|null;releaseWealthFan?:boolean;allowWealthFanFailure?:boolean}} options */
export function mergeMonteCarloChunkResultV1(accumulator, result, {
    expectedStart = null,
    expectedCount = null,
    releaseWealthFan = false,
    allowWealthFanFailure = false
} = {}) {
    if (!accumulator || accumulator.schemaVersion !== MONTE_CARLO_CHUNK_RESULT_VERSION) {
        throw contractError('Accumulator is missing or incompatible.');
    }
    // Der kanonische Consumer darf ausschließlich den Zusatz verwerfen. Sämtliche
    // bisherigen Finanz-/Bereichsverträge bleiben davor vollständig geprüft.
    assertMonteCarloChunkResultV1(allowWealthFanFailure ? { ...result, wealthFan: null } : result, { expectedStart, expectedCount });
    assertCompatibleBins(accumulator, result);
    const { start, count } = result.runRange;
    if (start + count > accumulator.totalRuns) {
        throw contractError('Chunk range exceeds the accumulator run count.');
    }
    if (accumulator.contributions.has(start)) throw contractError(`Chunk starting at ${start} was merged twice.`);
    for (let localIndex = 0; localIndex < count; localIndex++) {
        if (accumulator.mergedRuns[start + localIndex] !== 0) {
            throw contractError(`Chunk range overlaps global run ${start + localIndex}.`);
        }
    }

    // Höchstens eine Gesamtmatrix. contributions behalten keine Fächermatrizen.
    if (result.displayHomeValueFan) accumulator.displayHomeValueFan = mergeHomeWealthFan(accumulator.displayHomeValueFan, result.displayHomeValueFan);
    if (result.wealthFan && !accumulator.wealthFanMissing) {
        try {
            if (allowWealthFanFailure) {
                /** @type {import('../../../typcheck/rechenkern-integration').AssertWealthFan} */ (assertWealthFan)(result.wealthFan, count);
                if (result.wealthFan.validRuns !== result.technicalInventory.financiallyEvaluable
                    || result.wealthFan.technicalErrors !== result.technicalInventory.technicalError) {
                    throw contractError('wealthFan population differs from the technical inventory.');
                }
            }
            const fan = accumulator.wealthFan || createWealthFan(result.wealthFan.horizonYears);
            mergeWealthFan(fan, result.wealthFan);
            accumulator.wealthFan = fan;
        } catch (error) {
            if (!allowWealthFanFailure) throw contractError(`wealthFan: ${/** @type {Error} */ (error).message}`);
            accumulator.wealthFanMissing = true;
            accumulator.wealthFan = null;
        }
    } else if (!result.wealthFan) {
        accumulator.wealthFanMissing = true;
        accumulator.wealthFan = null;
    }

    for (const field of Object.keys(MONTE_CARLO_BUFFER_FIELDS)) {
        accumulator.buffers[field].set(result.buffers[field], start);
    }
    for (const field of Object.keys(MONTE_CARLO_PATH_SUMMARY_FIELDS)) {
        if (field.startsWith('displayHomeValue') && !result.pathSummaries[field]) continue;
        if (!accumulator.pathSummaries[field]) accumulator.pathSummaries[field] = new Float64Array(accumulator.totalRuns);
        accumulator.pathSummaries[field].set(result.pathSummaries[field], start);
    }
    for (const field of Object.keys(MONTE_CARLO_PATH_MISSINGNESS_FIELDS)) {
        accumulator.pathMissingness[field].set(result.pathMissingness[field], start);
    }
    accumulator.mergedRuns.fill(1, start, start + count);
    if (accumulator.runMetaByIndex) {
        for (const meta of result.runMeta) accumulator.runMetaByIndex[meta.index] = meta;
    }
    accumulator.contributions.set(start, {
        runRange: { ...result.runRange },
        totals: { ...result.totals },
        heatmap: result.heatmap.map(row => new Uint32Array(row)),
        allRealWithdrawalsSample: [...result.allRealWithdrawalsSample],
        technicalInventory: {
            ...result.technicalInventory,
            errors: [...result.technicalInventory.errors]
        },
        samplingDiagnostics: JSON.parse(JSON.stringify(result.samplingDiagnostics)),
        worstRun: result.worstRun,
        worstRunCare: result.worstRunCare
    });
    // Aufgelöste Race-/Poolpromises können den Chunkcontainer noch halten.
    // Der Workerconsumer gibt deshalb nach erfolgreicher Kopie seine Matrix frei.
    if (releaseWealthFan) {
        result.wealthFan = null;
        if (result.displayHomeValueFan) result.displayHomeValueFan = null;
    }
    return accumulator;
}
