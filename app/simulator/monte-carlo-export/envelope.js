/** @import {ExportBuildOptions,ExportV1,ExportV2,ExportReadOptions,ScenarioSourceRow,ScenarioExportRow,ScenarioMeasurements,ScenarioLogDocument,PersonDataContext} from '../../../typcheck/rechenkern' */
import { MONTE_CARLO_EXPORT_V1_VERSION, MONTE_CARLO_EXPORT_V2_VERSION } from './schema.js';
import { deepFreezeMonteCarloContract, MONTE_CARLO_FINGERPRINT_ALGORITHM } from '../monte-carlo-contracts.js';
import { sha256Hex, canonicalizeHistoricalContractValue } from '../historical-backtest-contract.js';

/** @param {string} code
 * @param {string} message
 * @param {string} version */
export function exportError(code, message, version = MONTE_CARLO_EXPORT_V1_VERSION) {
    const error = /** @type {TypeError & {code:string}} */ (new TypeError(`${version}: ${message}`));
    error.code = code;
    return error;
}

/** @param {Date|string|number} value
 * @param {string} version */
export function normalizeExportedAt(value, version = MONTE_CARLO_EXPORT_V1_VERSION) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw exportError('MC_EXPORT_TIMESTAMP_INVALID', 'exportedAtUtc must be a valid UTC timestamp.', version);
    }
    return date.toISOString();
}

/** @param {Pick<ExportV1|ExportV2,'schemaId'|'schemaVersion'|'app'|'engine'|'snapshotPolicy'|'request'|'result'|'personDataContext'>} document */
export function fingerprintBasis(document) {
    return {
        ...(document.personDataContext ? { personDataContext: document.personDataContext } : {}),
        schemaId: document.schemaId,
        schemaVersion: document.schemaVersion,
        app: document.app,
        engine: document.engine,
        snapshotPolicy: document.snapshotPolicy,
        request: document.request,
        result: document.result
    };
}

/** @param {unknown} value
 * @param {ReadonlySet<string>} known
 * @param {string} prefix */
export function unknownFields(value, known, prefix) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.keys(value)
        .filter(key => !known.has(key))
        .map(key => `${prefix}.${key}`);
}

/** @template T
 * @param {T} value
 * @param {string} field
 * @param {string} [version]
 * @returns {T & Record<string,unknown>} */
export function requireObject(value, field, version = MONTE_CARLO_EXPORT_V1_VERSION) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw exportError('MC_EXPORT_REQUIRED_OBJECT', `${field} must be an object.`, version);
    }
    return /** @type {T & Record<string,unknown>} */ (value);
}

/** @param {unknown} value
 * @param {string} field
 * @param {string} version */
export function requireString(value, field, version = MONTE_CARLO_EXPORT_V1_VERSION) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw exportError('MC_EXPORT_REQUIRED_STRING', `${field} must be a non-empty string.`, version);
    }
    return value;
}

/** @param {Partial<Pick<typeof import('../../../engine/index.mjs').EngineAPI,'getVersion'|'getConfig'>>|null|undefined} engineApi */
export function captureMonteCarloEngineProvenance(engineApi) {
    let version = null;
    let config = null;
    try {
        version = typeof engineApi?.getVersion === 'function' ? engineApi.getVersion() : null;
        config = typeof engineApi?.getConfig === 'function' ? engineApi.getConfig() : null;
    } catch {
        version = null;
        config = null;
    }
    return deepFreezeMonteCarloContract({
        apiVersion: typeof version?.api === 'string' ? version.api : null,
        buildId: typeof version?.build === 'string' ? version.build : null,
        configFingerprint: config == null
            ? null
            : {
                algorithm: MONTE_CARLO_FINGERPRINT_ALGORITHM,
                value: sha256Hex(canonicalizeHistoricalContractValue(config))
            }
    });
}

/** @template T
 * @param {T|string} source
 * @param {string} [code]
 * @param {string} [version]
 * @returns {T} */
export function normalizeSource(source, code = 'MC_EXPORT_JSON_INVALID', version = MONTE_CARLO_EXPORT_V2_VERSION) {
    try {
        return typeof source === 'string' ? JSON.parse(source) : source;
    } catch {
        throw exportError(code, 'input is not valid JSON.', version);
    }
}
