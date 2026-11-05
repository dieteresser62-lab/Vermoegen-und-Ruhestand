// @ts-check

import { contractError, assertNonNegativeInteger, assertBuffers, assertTypedFields, assertFiniteNumberList, assertDiagnostics } from './validation-primitives.js';
import { MONTE_CARLO_CHUNK_RESULT_VERSION, MONTE_CARLO_PATH_SUMMARY_FIELDS, MONTE_CARLO_PATH_MISSINGNESS_FIELDS, MONTE_CARLO_COUNTER_FIELDS, MONTE_CARLO_FLOAT_AGGREGATE_FIELDS, MONTE_CARLO_LIST_FIELDS, MONTE_CARLO_OUTCOME_CODE, MONTE_CARLO_MISSINGNESS_CODE, MONTE_CARLO_OUTCOME_NAME_BY_CODE } from './schema.js';
import { assertWealthFan } from '../wealth-fan-aggregation.js';
import { assertFinancialPath } from './assert-financial-path.js';
import { buildMonteCarloOutcomeInventoryV1 } from './outcomes.js';
/** @param {import('../../../typcheck/rechenkern').MonteCarloChunkResult} result
 * @param {{expectedStart?:number|null;expectedCount?:number|null}} options
 * @returns {import('../../../typcheck/rechenkern').MonteCarloChunkResult} */
export function assertMonteCarloChunkResultV1(result, {
    expectedStart = null,
    expectedCount = null
} = {}) {
    if (!result || typeof result !== 'object') throw contractError('Chunk result must be an object.');
    if (result.schemaVersion !== MONTE_CARLO_CHUNK_RESULT_VERSION) {
        throw contractError(`Unsupported schemaVersion ${String(result.schemaVersion)}.`);
    }
    const start = result.runRange?.start;
    const count = result.runRange?.count;
    assertNonNegativeInteger(start, 'runRange.start');
    assertNonNegativeInteger(count, 'runRange.count');
    if (result.wealthFan != null) {
        try { /** @type {import('../../../typcheck/rechenkern-integration').AssertWealthFan} */ (assertWealthFan)(result.wealthFan, count); }
        catch (error) { throw contractError(`wealthFan: ${/** @type {Error} */ (error).message}`); }
    }
    if (expectedStart !== null && start !== expectedStart) {
        throw contractError(`runRange.start ${start} does not match expected start ${expectedStart}.`);
    }
    if (expectedCount !== null && count !== expectedCount) {
        throw contractError(`runRange.count ${count} does not match expected count ${expectedCount}.`);
    }

    assertBuffers(result.buffers, count);
    assertTypedFields(result.pathSummaries, MONTE_CARLO_PATH_SUMMARY_FIELDS, count, 'pathSummaries');
    assertTypedFields(result.pathMissingness, MONTE_CARLO_PATH_MISSINGNESS_FIELDS, count, 'pathMissingness');

    const registeredTotalFields = new Set([
        ...MONTE_CARLO_COUNTER_FIELDS,
        ...MONTE_CARLO_FLOAT_AGGREGATE_FIELDS
    ]);
    if (!result.totals || typeof result.totals !== 'object') throw contractError('totals must be an object.');
    for (const field of registeredTotalFields) {
        const value = result.totals[field];
        if (!Number.isFinite(value) || value < 0) {
            throw contractError(`totals.${field} must be a finite non-negative number.`);
        }
        if (MONTE_CARLO_COUNTER_FIELDS.includes(field) && !Number.isSafeInteger(value)) {
            throw contractError(`totals.${field} must be an integer counter.`);
        }
    }
    const unknownTotals = Object.keys(result.totals).filter(field => !registeredTotalFields.has(field));
    if (unknownTotals.length > 0) {
        throw contractError(`totals contains unregistered fields: ${unknownTotals.join(', ')}.`);
    }

    if (!result.lists || typeof result.lists !== 'object') throw contractError('lists must be an object.');
    for (const field of MONTE_CARLO_LIST_FIELDS) {
        assertFiniteNumberList(result.lists[field], `lists.${field}`);
    }
    const unknownLists = Object.keys(result.lists).filter(field => !MONTE_CARLO_LIST_FIELDS.includes(field));
    if (unknownLists.length > 0) {
        throw contractError(`lists contains unregistered fields: ${unknownLists.join(', ')}.`);
    }
    assertFiniteNumberList(result.allRealWithdrawalsSample, 'allRealWithdrawalsSample');
    assertDiagnostics(result, count);
    if (result.wealthFan && (result.wealthFan.validRuns !== result.technicalInventory.financiallyEvaluable
        || result.wealthFan.technicalErrors !== result.technicalInventory.technicalError)) {
        throw contractError('wealthFan population differs from the technical inventory.');
    }

    let technicalPaths = 0;
    const outcomeCounts = {
        ruin: 0,
        all_dead: 0,
        horizon_exhausted: 0,
        technical_error: 0
    };
    const careCounts = { observedHouseholdCarePaths: 0, observedP1CarePaths: 0, observedP2CarePaths: 0 };
    const seenMetaIndices = new Set();
    const validOutcomeCodes = new Set(/** @type {number[]} */ (Object.values(MONTE_CARLO_OUTCOME_CODE).filter(code => code !== MONTE_CARLO_OUTCOME_CODE.UNSET)));
    const validMissingnessCodes = new Set(/** @type {number[]} */ (Object.values(MONTE_CARLO_MISSINGNESS_CODE).filter(code => code !== MONTE_CARLO_MISSINGNESS_CODE.UNSET)));
    for (let localIndex = 0; localIndex < count; localIndex++) {
        const globalIndex = start + localIndex;
        if (result.pathSummaries.globalRunIndex[localIndex] !== globalIndex) {
            throw contractError(`pathSummaries.globalRunIndex[${localIndex}] must equal ${globalIndex}.`);
        }
        const outcomeCode = result.pathSummaries.outcomeCode[localIndex];
        const pathState = result.pathMissingness.path[localIndex];
        if (!validOutcomeCodes.has(outcomeCode)) {
            throw contractError(`pathSummaries.outcomeCode[${localIndex}] is not registered.`);
        }
        outcomeCounts[MONTE_CARLO_OUTCOME_NAME_BY_CODE[/** @type {keyof typeof MONTE_CARLO_OUTCOME_NAME_BY_CODE} */ (outcomeCode)]]++;
        for (const [field, values] of Object.entries(result.pathMissingness)) {
            if (!validMissingnessCodes.has(values[localIndex])) {
                throw contractError(`pathMissingness.${field}[${localIndex}] is not registered.`);
            }
        }
        if (outcomeCode === MONTE_CARLO_OUTCOME_CODE.TECHNICAL_ERROR) {
            technicalPaths++;
            if (pathState !== MONTE_CARLO_MISSINGNESS_CODE.TECHNICAL_ERROR) {
                throw contractError(`technical path ${globalIndex} must carry technical-error missingness.`);
            }
            for (const values of Object.values(result.pathMissingness)) {
                if (values[localIndex] !== MONTE_CARLO_MISSINGNESS_CODE.TECHNICAL_ERROR) {
                    throw contractError(`technical path ${globalIndex} must fail all summary fields closed.`);
                }
            }
            if (result.buffers.stress_realWithdrawalP10Missingness[localIndex]
                !== MONTE_CARLO_MISSINGNESS_CODE.TECHNICAL_ERROR) {
                throw contractError(`technical path ${globalIndex} must fail the stress withdrawal summary closed.`);
            }
        } else if (pathState !== MONTE_CARLO_MISSINGNESS_CODE.OBSERVED) {
            throw contractError(`financial path ${globalIndex} must be observed.`);
        } else {
            assertFinancialPath(result, localIndex, globalIndex, outcomeCode, careCounts);
        }
    }
    if (technicalPaths !== result.technicalInventory.technicalError) {
        throw contractError('Path outcome codes and technical inventory disagree.');
    }
    if (outcomeCounts.ruin !== result.totals.outcomeRuinCount
        || outcomeCounts.all_dead !== result.totals.outcomeAllDeadCount
        || outcomeCounts.horizon_exhausted !== result.totals.outcomeHorizonExhaustedCount) {
        throw contractError('Path outcome codes and financial outcome counters disagree.');
    }
    if (result.totals.failCount !== result.totals.outcomeRuinCount) {
        throw contractError('failCount and outcomeRuinCount must describe the same financial paths.');
    }
    buildMonteCarloOutcomeInventoryV1({
        requestedRuns: count,
        ...outcomeCounts
    });
    if (careCounts.observedHouseholdCarePaths !== result.totals.pflegeTriggeredCount
        || careCounts.observedP1CarePaths !== result.totals.p1TriggeredCount
        || careCounts.observedP2CarePaths !== result.totals.p2TriggeredCount) {
        throw contractError('Path care observations and care counters disagree.');
    }
    for (const meta of result.runMeta) {
        const index = meta?.index;
        if (!Number.isSafeInteger(index) || index < start || index >= start + count || seenMetaIndices.has(index)) {
            throw contractError('runMeta indices must be unique and inside runRange.');
        }
        seenMetaIndices.add(index);
    }
    return result;
}

/** @param {Omit<import('../../../typcheck/rechenkern').MonteCarloChunkResult,"schemaVersion">} result */
export function createMonteCarloChunkResultV1(result) {
    const contracted = {
        ...result,
        schemaVersion: MONTE_CARLO_CHUNK_RESULT_VERSION
    };
    return assertMonteCarloChunkResultV1(contracted);
}
