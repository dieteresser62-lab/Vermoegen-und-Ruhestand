// @ts-check
/** @import {SweepRequest,SweepFingerprint,SweepFingerprintTrace,HistoricalYear} from '../../../typcheck/rechenkern' */
import { SWEEP_SAMPLING_FINGERPRINT_VERSION } from './provenance.js';
import { annualData } from '../simulator-data.js';

const MAX_FINGERPRINT_TRACE_RUNS = 3;

const MAX_FINGERPRINT_TRACE_YEARS = 64;

const FINGERPRINT_RUN_SEPARATOR = 0xFFFFFFFD;

const FINGERPRINT_UNKNOWN_YEAR = 0xFFFFFFFE;

const ANNUAL_DATA_INDEX_BY_YEAR = new Map(
    annualData.map((entry, index) => [Number(entry?.jahr), index])
);

/**
* @param {number} hash
* @param {unknown} value
*/
function updateFingerprintHash(hash, value) {
    const normalized = Number.isSafeInteger(value) ? value >>> 0 : 0xFFFFFFFE;
    return Math.imul((hash ^ normalized) >>> 0, 0x01000193) >>> 0;
}

/** @param {SweepRequest} request
 * @param {number} combinationIndex
 * @returns {SweepFingerprint} */
export function createSweepSamplingFingerprint(request, combinationIndex) {
    return {
        hash: 0x811C9DC5,
        publicValue: {
            schemaVersion: SWEEP_SAMPLING_FINGERPRINT_VERSION,
            hashAlgorithm: 'fnv1a32_run_and_historical_index_sequence',
            hash: null,
            combinationIndex,
            requestedSamplingMethod: /** @type {string} */ (request.requestedSamplingMethod),
            appliedSamplingMethod: request.appliedSamplingMethod,
            tracedRuns: [],
            truncated: false
        }
    };
}

/** @param {SweepFingerprint} fingerprint
 * @param {number} runIndex
 * @returns {SweepFingerprintTrace|null} */
export function beginSweepFingerprintRun(fingerprint, runIndex) {
    fingerprint.hash = updateFingerprintHash(fingerprint.hash, FINGERPRINT_RUN_SEPARATOR);
    fingerprint.hash = updateFingerprintHash(fingerprint.hash, runIndex);
    if (fingerprint.publicValue.tracedRuns.length >= MAX_FINGERPRINT_TRACE_RUNS) {
        fingerprint.publicValue.truncated = true;
        return null;
    }
    const trace = { runIndex, historicalYearIndices: [] };
    fingerprint.publicValue.tracedRuns.push(trace);
    return trace;
}

/** @param {SweepFingerprint} fingerprint
 * @param {SweepFingerprintTrace|null} trace
 * @param {HistoricalYear} yearData */
export function recordSweepFingerprintYear(fingerprint, trace, yearData) {
    const historicalIndex = ANNUAL_DATA_INDEX_BY_YEAR.get(Number(yearData?.jahr));
    const normalizedIndex = Number.isInteger(historicalIndex)
        ? historicalIndex
        : FINGERPRINT_UNKNOWN_YEAR;
    fingerprint.hash = updateFingerprintHash(fingerprint.hash, normalizedIndex);
    if (!trace) return;
    if (trace.historicalYearIndices.length >= MAX_FINGERPRINT_TRACE_YEARS) {
        fingerprint.publicValue.truncated = true;
        return;
    }
    trace.historicalYearIndices.push(normalizedIndex);
}

/** @param {SweepFingerprint} fingerprint */
export function finalizeSweepSamplingFingerprint(fingerprint) {
    fingerprint.publicValue.hash = fingerprint.hash.toString(16).padStart(8, '0');
    return fingerprint.publicValue;
}
