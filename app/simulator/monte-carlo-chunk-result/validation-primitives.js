// @ts-check
/** @import {NumericBuffers} from '../../../typcheck/rechenkern' */
import { MONTE_CARLO_CHUNK_RESULT_VERSION, MONTE_CARLO_BUFFER_FIELDS, PATH_TRANSFER_PREFIX, MISSINGNESS_TRANSFER_PREFIX } from './schema.js';
import { assertMonteCarloSamplingDiagnosticsV1 } from '../mc-year-sampling.js';
/** @param {string} message */
export function contractError(message) {
    return new TypeError(`[${MONTE_CARLO_CHUNK_RESULT_VERSION}] ${message}`);
}

/** @param {unknown} value
 * @param {string} label
 * @returns {asserts value is number} */
export function assertNonNegativeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw contractError(`${label} must be a non-negative safe integer.`);
    }
}

/** @param {NumericBuffers} container
 * @param {Record<string,new(length:number)=>import('../../../typcheck/rechenkern').TypedNumbers>} registry
 * @param {number} count
 * @param {string} label */
export function assertTypedFields(container, registry, count, label) {
    if (!container || typeof container !== 'object') {
        throw contractError(`${label} must be an object.`);
    }
    const expectedFields = Object.keys(registry);
    const actualFields = Object.keys(container);
    for (const field of expectedFields) {
        const Constructor = registry[field];
        const values = container[field];
        if (field.startsWith('displayHomeValue') && values === undefined) continue;
        if (!(values instanceof Constructor)) {
            throw contractError(`${label}.${field} must be ${Constructor.name}.`);
        }
        if (values.length !== count) {
            throw contractError(`${label}.${field} length ${values.length} does not match runRange.count ${count}.`);
        }
        if (Constructor === Float32Array || Constructor === Float64Array) {
            for (let index = 0; index < values.length; index++) {
                if (!Number.isFinite(values[index])) {
                    throw contractError(`${label}.${field} contains a non-finite value.`);
                }
            }
        }
    }
    const unknown = actualFields.filter(field => !expectedFields.includes(field));
    if (unknown.length > 0) {
        throw contractError(`${label} contains unregistered fields: ${unknown.join(', ')}.`);
    }
}

/** @param {NumericBuffers} buffers
 * @param {number} count */
export function assertBuffers(buffers, count) {
    if (!buffers || typeof buffers !== 'object') {
        throw contractError('buffers must be an object.');
    }
    for (const [field, Constructor] of Object.entries(MONTE_CARLO_BUFFER_FIELDS)) {
        const values = buffers[field];
        if (!(values instanceof Constructor)) {
            throw contractError(`buffers.${field} must be ${Constructor.name}.`);
        }
        if (values.length !== count) {
            throw contractError(`buffers.${field} length ${values.length} does not match runRange.count ${count}.`);
        }
        if (Constructor === Float32Array || Constructor === Float64Array) {
            for (let index = 0; index < values.length; index++) {
                if (!Number.isFinite(values[index])) {
                    throw contractError(`buffers.${field} contains a non-finite value.`);
                }
            }
        }
    }
    const unknown = Object.keys(buffers).filter(field => (
        !(field in MONTE_CARLO_BUFFER_FIELDS)
        && !field.startsWith(PATH_TRANSFER_PREFIX)
        && !field.startsWith(MISSINGNESS_TRANSFER_PREFIX)
    ));
    if (unknown.length > 0) {
        throw contractError(`buffers contains unregistered fields: ${unknown.join(', ')}.`);
    }
}

/** @param {unknown} values
 * @param {string} label */
export function assertFiniteNumberList(values, label) {
    if (!Array.isArray(values)) throw contractError(`${label} must be an array.`);
    for (const value of values) {
        if (!Number.isFinite(value)) throw contractError(`${label} contains a non-finite value.`);
    }
}

/** @param {import('../../../typcheck/rechenkern').MonteCarloChunkResult} result
 * @param {number} count */
export function assertDiagnostics(result, count) {
    if (!Array.isArray(result.bins) || result.bins.length < 2) {
        throw contractError('bins must contain at least two boundaries.');
    }
    for (let index = 0; index < result.bins.length; index++) {
        const value = result.bins[index];
        if (typeof value !== 'number' || Number.isNaN(value)) {
            throw contractError('bins must contain numeric boundaries.');
        }
        if (index > 0 && value <= result.bins[index - 1]) {
            throw contractError('bins must be strictly increasing.');
        }
    }
    if (!Array.isArray(result.heatmap)) throw contractError('heatmap must be an array.');
    for (const row of result.heatmap) {
        if (!(row instanceof Uint32Array) || row.length !== result.bins.length - 1) {
            throw contractError('heatmap rows must be Uint32Array values matching bins.');
        }
    }
    if (!result.technicalInventory || typeof result.technicalInventory !== 'object') {
        throw contractError('technicalInventory must be an object.');
    }
    for (const field of ['requested', 'financiallyEvaluable', 'technicalError']) {
        assertNonNegativeInteger(result.technicalInventory[/** @type {'requested'|'financiallyEvaluable'|'technicalError'} */ (field)], `technicalInventory.${field}`);
    }
    if (result.technicalInventory.requested !== count) {
        throw contractError('technicalInventory.requested must equal runRange.count.');
    }
    if (result.technicalInventory.financiallyEvaluable + result.technicalInventory.technicalError !== count) {
        throw contractError('technical inventory must classify every chunk run exactly once.');
    }
    if (!Array.isArray(result.technicalInventory.errors)) {
        throw contractError('technicalInventory.errors must be an array.');
    }
    if (!Array.isArray(result.runMeta)) throw contractError('runMeta must be an array.');
    if (result.runMeta.length !== result.technicalInventory.financiallyEvaluable) {
        throw contractError('runMeta length must equal financially evaluable runs.');
    }
    try {
        assertMonteCarloSamplingDiagnosticsV1(result.samplingDiagnostics, { expectedRuns: count });
    } catch (error) {
        throw contractError(`samplingDiagnostics are invalid: ${/** @type {Error} */ (error)?.message || String(error)}`);
    }
}
