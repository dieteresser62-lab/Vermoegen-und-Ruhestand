// @ts-check

import { MONTE_CARLO_COUNTER_FIELDS, MONTE_CARLO_FLOAT_AGGREGATE_FIELDS, MONTE_CARLO_LIST_FIELDS, MONTE_CARLO_MISSINGNESS_CODE, MAX_TECHNICAL_ERROR_SAMPLES, MONTE_CARLO_CHUNK_RESULT_VERSION } from './schema.js';
import { contractError } from './validation-primitives.js';
import { mergeMonteCarloSamplingDiagnosticsV1 } from '../mc-year-sampling.js';
import { pickWorstRun } from '../monte-carlo-runner-utils.js';
/** @returns {Record<string,number>} */
export function createEmptyTotals() {
    return Object.fromEntries([
        ...MONTE_CARLO_COUNTER_FIELDS,
        ...MONTE_CARLO_FLOAT_AGGREGATE_FIELDS
    ].map(field => [field, 0]));
}

/** @returns {Record<string,number[]>} */
export function createEmptyLists() {
    return Object.fromEntries(MONTE_CARLO_LIST_FIELDS.map(field => [field, []]));
}

/** @param {import('../../../typcheck/rechenkern').ChunkAccumulator} accumulator */
export function buildListsFromPathSummaries(accumulator) {
    const lists = createEmptyLists();
    const summary = accumulator.pathSummaries;
    const missing = accumulator.pathMissingness;
    for (let index = 0; index < accumulator.totalRuns; index++) {
        if (missing.path[index] !== MONTE_CARLO_MISSINGNESS_CODE.OBSERVED) continue;
        const p1Triggered = missing.p1CareEntryAge[index] === MONTE_CARLO_MISSINGNESS_CODE.OBSERVED;
        const p2Triggered = missing.p2CareEntryAge[index] === MONTE_CARLO_MISSINGNESS_CODE.OBSERVED;
        if (p1Triggered) {
            lists.entryAges.push(summary.p1CareEntryAge[index]);
            lists.p1CareYearsTriggered.push(summary.p1CareYears[index]);
            lists.p1CareAdditionalNeedRealEur.push(summary.p1CareAdditionalNeedRealEur[index]);
        }
        if (p2Triggered) {
            lists.entryAgesP2.push(summary.p2CareEntryAge[index]);
            lists.p2CareYearsTriggered.push(summary.p2CareYears[index]);
            lists.p2CareAdditionalNeedRealEur.push(summary.p2CareAdditionalNeedRealEur[index]);
        }
        if (summary.careEverActive[index] === 1) {
            lists.totalCareAdditionalNeedRealEur.push(summary.totalCareAdditionalNeedRealEur[index]);
            lists.endWealthWithCareRealEur.push(summary.finalValueRealEur[index]);
            lists.bothCareYearsOverlapTriggered.push(summary.bothCareYears[index]);
            lists.maxAnnualCareAdditionalNeedRealEur.push(summary.maxAnnualCareAdditionalNeedRealEur[index]);
        } else {
            lists.endWealthNoCareRealEur.push(summary.finalValueRealEur[index]);
        }

        if (summary.healthBucketEnabled[index] === 1) {
            lists.healthBucketEndAmounts.push(summary.healthBucketEndEur[index]);
            lists.healthBucketTargetGaps.push(summary.healthBucketTargetGapEur[index]);
            lists.healthBucketInterestAmounts.push(summary.healthBucketInterestEur[index]);
            if (missing.healthBucketCoveragePct[index] === MONTE_CARLO_MISSINGNESS_CODE.OBSERVED) {
                lists.healthBucketCoveragePct.push(summary.healthBucketCoveragePct[index]);
            }
        }
        if (summary.healthBucketUsedEur[index] > 0) {
            lists.healthBucketUsedAmounts.push(summary.healthBucketUsedEur[index]);
        }
    }
    return lists;
}

/** @param {number} totalRuns
 * @param {import('../../../typcheck/rechenkern').ChunkContribution[]} chunks
 * @returns {import('../../../typcheck/rechenkern').TechnicalInventory} */
export function buildTechnicalInventory(totalRuns, chunks) {
    /** @type {import('../../../typcheck/rechenkern').TechnicalInventory} */
    const inventory = {
        requested: totalRuns,
        financiallyEvaluable: 0,
        technicalError: 0,
        errors: []
    };
    for (const chunk of chunks) {
        inventory.financiallyEvaluable += chunk.technicalInventory.financiallyEvaluable;
        inventory.technicalError += chunk.technicalInventory.technicalError;
        for (const error of chunk.technicalInventory.errors) {
            if (inventory.errors.length >= MAX_TECHNICAL_ERROR_SAMPLES) break;
            inventory.errors.push(error);
        }
    }
    return inventory;
}

/** @param {import('../../../typcheck/rechenkern').ChunkAccumulator} accumulator */
export function finalizeMonteCarloChunkAccumulatorV1(accumulator) {
    if (!accumulator || accumulator.schemaVersion !== MONTE_CARLO_CHUNK_RESULT_VERSION) {
        throw contractError('Accumulator is missing or incompatible.');
    }
    for (let index = 0; index < accumulator.totalRuns; index++) {
        if (accumulator.mergedRuns[index] !== 1) {
            throw contractError(`Cannot finalize: global run ${index} is missing.`);
        }
    }
    const chunks = [...accumulator.contributions.values()].sort((left, right) => (
        left.runRange.start - right.runRange.start
    ));
    const totals = createEmptyTotals();
    const heatmap = Array.from(
        { length: accumulator.heatmapRows },
        () => new Uint32Array(accumulator.bins.length - 1)
    );
    const allRealWithdrawalsSample = [];
    const runMeta = accumulator.runMetaByIndex
        ? accumulator.runMetaByIndex.filter(Boolean)
        : [];
    let worstRun = null;
    let worstRunCare = null;
    let samplingDiagnostics = null;

    for (const chunk of chunks) {
        for (const field of MONTE_CARLO_COUNTER_FIELDS) totals[field] += chunk.totals[field];
        for (let row = 0; row < heatmap.length; row++) {
            for (let column = 0; column < heatmap[row].length; column++) {
                heatmap[row][column] += chunk.heatmap[row][column];
            }
        }
        allRealWithdrawalsSample.push(...chunk.allRealWithdrawalsSample);
        if (!samplingDiagnostics) {
            samplingDiagnostics = JSON.parse(JSON.stringify(chunk.samplingDiagnostics));
        } else {
            try {
                mergeMonteCarloSamplingDiagnosticsV1(samplingDiagnostics, chunk.samplingDiagnostics);
            } catch (error) {
                throw contractError(`sampling diagnostics cannot be merged: ${/** @type {Error} */ (error)?.message || String(error)}`);
            }
        }
        worstRun = pickWorstRun(worstRun, chunk.worstRun);
        worstRunCare = pickWorstRun(worstRunCare, chunk.worstRunCare);
    }

    for (let index = 0; index < accumulator.totalRuns; index++) {
        if (accumulator.pathMissingness.path[index] !== MONTE_CARLO_MISSINGNESS_CODE.OBSERVED) continue;
        totals.totalTaxSavedByLossCarry += accumulator.pathSummaries.taxSavedByLossCarryEur[index];
        totals.totalHealthBucketUsed += accumulator.pathSummaries.healthBucketUsedEur[index];
    }
    return {
        schemaVersion: MONTE_CARLO_CHUNK_RESULT_VERSION,
        totalRuns: accumulator.totalRuns,
        completedRuns: accumulator.totalRuns,
        wealthFan: accumulator.wealthFanMissing ? null : accumulator.wealthFan,
        ...(accumulator.displayHomeValueFan ? { displayHomeValueFan: accumulator.displayHomeValueFan } : {}),
        buffers: accumulator.buffers,
        pathSummaries: accumulator.pathSummaries,
        pathMissingness: accumulator.pathMissingness,
        heatmap,
        bins: [...accumulator.bins],
        totals,
        lists: buildListsFromPathSummaries(accumulator),
        allRealWithdrawalsSample,
        technicalInventory: buildTechnicalInventory(accumulator.totalRuns, chunks),
        samplingDiagnostics,
        worstRun,
        worstRunCare,
        runMeta
    };
}
