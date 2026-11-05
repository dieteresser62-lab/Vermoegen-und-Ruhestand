// @ts-check
/** @import {Fingerprint,Portable,ContractClone} from '../../../typcheck/rechenkern' */
/** @import {Json} from '../../../typcheck/datenvertraege' */
import { MONTE_CARLO_RUN_REQUEST_VERSION, MONTE_CARLO_FINGERPRINT_ALGORITHM } from './schema.js';
import { contractError } from './validation-primitives.js';
import { canonicalizeHistoricalContractValue, sha256Hex } from '../historical-backtest-contract.js';

const OMIT = Symbol('omit');

const FORBIDDEN_PRIVATE_KEYS = /^(?:password|passphrase|secret|token|api[_-]?token|api[_-]?key|access[_-]?key|private[_-]?key|local[_-]?path|file[_-]?path)$/i;

const WINDOWS_ABSOLUTE_PATH = /(?:^|[\s"'])(?:[a-zA-Z]:\\|\\\\)[^\s"']+/;

const POSIX_PRIVATE_PATH = /(?:^|[\s"'])(?:\/Users\/|\/home\/)[^\s"']+/;

/** @template T
 * @param {T} value
 * @param {WeakSet<object>} [seen]
 * @returns {T} */
export function deepFreezeMonteCarloContract(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) deepFreezeMonteCarloContract(child, seen);
    return Object.freeze(value);
}

/** @param {unknown} value */
export function redactLocalPaths(value) {
    return String(value ?? '')
        .replace(/(?:[a-zA-Z]:\\|\\\\)[^\s"']+/g, '[lokaler Pfad entfernt]')
        .replace(/(?:\/Users\/|\/home\/)[^\s"']+/g, '[lokaler Pfad entfernt]');
}

/** @template T
 * @overload
 * @param {T} value
 * @param {{rejectPrivateData?:boolean;path?:string}} [options]
 * @param {WeakSet<object>} [seen]
 * @returns {Portable<T>}
 * */
/** @param {unknown} value
 * @param {{rejectPrivateData?:boolean;path?:string}} [options]
 * @param {WeakSet<object>} [seen]
 * @returns {Json|typeof OMIT} */
export function normalizeMonteCarloJsonValue(value, {
    rejectPrivateData = true,
    path = '$'
} = {}, seen = new WeakSet()) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        if (rejectPrivateData && typeof value === 'string'
            && (WINDOWS_ABSOLUTE_PATH.test(value) || POSIX_PRIVATE_PATH.test(value))) {
            throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_EXPORT_LOCAL_PATH_FORBIDDEN', `${path} contains a local filesystem path.`);
        }
        return /** @type {null|boolean|string} */ (value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_EXPORT_NON_FINITE_NUMBER', `${path} must be a finite JSON number.`);
        }
        return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return OMIT;
    if (typeof value === 'bigint') {
        throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_EXPORT_BIGINT_UNSUPPORTED', `${path} must not contain bigint values.`);
    }
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) {
            throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_EXPORT_DATE_INVALID', `${path} contains an invalid date.`);
        }
        return value.toISOString();
    }
    if (seen.has(value)) {
        throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_EXPORT_CYCLE_UNSUPPORTED', `${path} must not contain cycles.`);
    }
    seen.add(value);
    if (Array.isArray(value)) {
        const normalized = value.map((child, index) => {
            const item = normalizeMonteCarloJsonValue(child, {
                rejectPrivateData,
                path: `${path}[${index}]`
            }, seen);
            return item === OMIT ? null : item;
        });
        seen.delete(value);
        return /** @type {Json[]} */ (normalized);
    }
    const normalized = /** @type {Record<string,Json>} */ ({});
    for (const key of Object.keys(value)) {
        if (rejectPrivateData && FORBIDDEN_PRIVATE_KEYS.test(key)) {
            throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_EXPORT_PRIVATE_KEY_FORBIDDEN', `${path}.${key} is not part of the portable run contract.`);
        }
        const child = normalizeMonteCarloJsonValue(/** @type {Record<string,unknown>} */ (value)[key], {
            rejectPrivateData,
            path: `${path}.${key}`
        }, seen);
        if (child !== OMIT) normalized[key] = /** @type {Json} */ (child);
    }
    seen.delete(value);
    return normalized;
}

/** @param {unknown} value
 * @returns {Fingerprint} */
export function fingerprintMonteCarloValue(value) {
    return Object.freeze({
        algorithm: MONTE_CARLO_FINGERPRINT_ALGORITHM,
        value: sha256Hex(canonicalizeHistoricalContractValue(value))
    });
}

/** @template T
 * @param {T} value
 * @param {string} path
 * @returns {ContractClone<T>} */
export function cloneContractValue(value, path) {
    const normalized = normalizeMonteCarloJsonValue(value, { path });
    return /** @type {ContractClone<T>} */ (normalized === OMIT ? null : normalized);
}
