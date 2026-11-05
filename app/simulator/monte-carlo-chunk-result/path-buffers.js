// @ts-check
/** @import {NumericBuffers} from '../../../typcheck/rechenkern' */
import { PATH_TRANSFER_PREFIX, MISSINGNESS_TRANSFER_PREFIX, MONTE_CARLO_MISSINGNESS_CODE, MONTE_CARLO_PATH_SUMMARY_FIELDS, MONTE_CARLO_PATH_MISSINGNESS_FIELDS } from './schema.js';
import { contractError, assertNonNegativeInteger } from './validation-primitives.js';
/** @param {Record<string,new(length:number)=>import('../../../typcheck/rechenkern').TypedNumbers>} registry
 * @param {number} length
 * @returns {NumericBuffers} */
export function createTypedFields(registry, length) {
    return Object.fromEntries(Object.entries(registry).map(([field, Constructor]) => (
        [field, new Constructor(length)]
    )));
}

/** @param {NumericBuffers} buffers
 * @param {NumericBuffers} pathSummaries
 * @param {NumericBuffers} pathMissingness */
export function attachPathTransferBuffers(buffers, pathSummaries, pathMissingness) {
    const existingViews = new Set(Object.values(buffers));
    for (const [field, values] of Object.entries(pathSummaries)) {
        if (existingViews.has(values)) continue;
        buffers[`${PATH_TRANSFER_PREFIX}${field}`] = values;
        existingViews.add(values);
    }
    for (const [field, values] of Object.entries(pathMissingness)) {
        if (existingViews.has(values)) continue;
        buffers[`${MISSINGNESS_TRANSFER_PREFIX}${field}`] = values;
        existingViews.add(values);
    }
}

/** @param {NumericBuffers} buffers
 * @param {number} runCount */
export function ensureWithdrawalBuffers(buffers, runCount) {
    const required = {
        realMaxDrawdowns: Float32Array,
        realMaxDrawdownObservationCount: Uint32Array,
        realMaxDrawdownMissingness: Uint8Array,
        realWithdrawalP10RealEur: Float64Array,
        realWithdrawalObservationCount: Uint32Array,
        realWithdrawalP10Missingness: Uint8Array,
        meanWithdrawalRateRatio: Float64Array,
        withdrawalRateObservationCount: Uint32Array,
        meanWithdrawalRateMissingness: Uint8Array,
        stress_realWithdrawalObservationCount: Uint32Array,
        stress_realWithdrawalP10Missingness: Uint8Array
    };
    for (const [field, Constructor] of Object.entries(required)) {
        if (buffers[field] === undefined) {
            buffers[field] = new Constructor(runCount);
            if (field === 'stress_realWithdrawalP10Missingness') {
                buffers[field].fill(MONTE_CARLO_MISSINGNESS_CODE.NOT_APPLICABLE);
            }
        }
        if (!(buffers[field] instanceof Constructor) || buffers[field].length !== runCount) {
            throw contractError(`buffers.${field} must be ${Constructor.name} with length ${runCount}.`);
        }
    }
}

/** @param {number} runCount
 * @param {{buffers?:NumericBuffers|null;attachTransferBuffers?:boolean;withDisplayHomes?:boolean}} options */
export function createMonteCarloPathSummaryV1(runCount, {
    buffers = null,
    attachTransferBuffers = false,
    withDisplayHomes = false
} = {}) {
    assertNonNegativeInteger(runCount, 'runCount');
    const pathSummaries = createTypedFields(Object.fromEntries(Object.entries(MONTE_CARLO_PATH_SUMMARY_FIELDS).filter(([key]) => withDisplayHomes || !key.startsWith('displayHomeValue'))), runCount);
    if (buffers) {
        ensureWithdrawalBuffers(buffers, runCount);
        pathSummaries.finalValueNominalEur = buffers.finalOutcomes;
        pathSummaries.volatilityPct = buffers.volatilities;
        pathSummaries.maxDrawdownPct = buffers.maxDrawdowns;
        pathSummaries.maxDrawdownRealPct = buffers.realMaxDrawdowns;
        pathSummaries.maxDrawdownRealObservationCount = buffers.realMaxDrawdownObservationCount;
        pathSummaries.cutYearShareRatio = buffers.cutYearShareRatio;
        pathSummaries.realWithdrawalP10RealEur = buffers.realWithdrawalP10RealEur;
        pathSummaries.realWithdrawalObservationCount = buffers.realWithdrawalObservationCount;
        pathSummaries.meanWithdrawalRateRatio = buffers.meanWithdrawalRateRatio;
        pathSummaries.withdrawalRateObservationCount = buffers.withdrawalRateObservationCount;
    }
    const pathMissingness = createTypedFields(MONTE_CARLO_PATH_MISSINGNESS_FIELDS, runCount);
    if (buffers) {
        pathMissingness.maxDrawdownRealPct = buffers.realMaxDrawdownMissingness;
        pathMissingness.cutYearShareRatio = buffers.cutYearShareMissingness;
        pathMissingness.realWithdrawalP10RealEur = buffers.realWithdrawalP10Missingness;
        pathMissingness.meanWithdrawalRateRatio = buffers.meanWithdrawalRateMissingness;
        pathMissingness.stressRealWithdrawalP10RealEur = buffers.stress_realWithdrawalP10Missingness;
    }
    if (buffers && attachTransferBuffers) {
        attachPathTransferBuffers(buffers, pathSummaries, pathMissingness);
    }
    return { pathSummaries, pathMissingness };
}
