/** @import {ExportBuildOptions,ExportV1,ExportV2,ExportReadOptions,ScenarioSourceRow,ScenarioExportRow,ScenarioMeasurements,ScenarioLogDocument,PersonDataContext} from '../../../typcheck/rechenkern' */
import {
    MONTE_CARLO_APP_VERSION,
    MONTE_CARLO_EXPORT_SCHEMA_ID,
    MONTE_CARLO_EXPORT_V1_VERSION,
    MONTE_CARLO_EXPORT_V2_VERSION,
    TOP_LEVEL_FIELDS,
    REQUEST_FIELDS,
    RESULT_FIELDS
} from './schema.js';
import {
    validateMonteCarloRunRequestV1,
    validateMonteCarloRunResultV1,
    normalizeMonteCarloJsonValue,
    MONTE_CARLO_SNAPSHOT_POLICY,
    fingerprintMonteCarloValue,
    MONTE_CARLO_LEGACY_READ_ALIASES,
    deepFreezeMonteCarloContract,
    MONTE_CARLO_FINGERPRINT_ALGORITHM,
    collectMonteCarloLegacyAliasTelemetryV1
} from '../monte-carlo-contracts.js';
import { normalizeExportedAt, fingerprintBasis, requireObject, exportError, requireString, unknownFields } from './envelope.js';
import { freezePersonDataContext, validatePersonDataContext } from '../simulator-person-overrides.js';
import { canonicalizeHistoricalContractValue } from '../historical-backtest-contract.js';

/** @param {Omit<ExportBuildOptions,'result'> & {result:import('../../../typcheck/rechenkern').RunResultV1}} options
 * @returns {ExportV1} */
export function buildMonteCarloExportV1({
    request,
    result,
    engine = null,
    app = MONTE_CARLO_APP_VERSION,
    exportedAt = new Date(),
    personDataContext = null
} = /** @type {NonNullable<Parameters<typeof buildMonteCarloExportV1>[0]>} */ ({})) {
    validateMonteCarloRunRequestV1(request);
    validateMonteCarloRunResultV1(result);
    const normalizedApp = normalizeMonteCarloJsonValue(app, { path: '$.app' });
    const normalizedEngine = normalizeMonteCarloJsonValue(engine || {}, { path: '$.engine' });
    const base = {
        schemaId: MONTE_CARLO_EXPORT_SCHEMA_ID,
        schemaVersion: /** @type {'MonteCarloExportV1'} */ (MONTE_CARLO_EXPORT_V1_VERSION),
        exportedAtUtc: normalizeExportedAt(exportedAt, MONTE_CARLO_EXPORT_V2_VERSION),
        app: normalizedApp,
        engine: normalizedEngine,
        snapshotPolicy: { ...MONTE_CARLO_SNAPSHOT_POLICY },
        request,
        result,
        ...(personDataContext ? { personDataContext: freezePersonDataContext(validatePersonDataContext(personDataContext)) } : {})
    };
    const fingerprint = fingerprintMonteCarloValue(fingerprintBasis(base));
    const requestFingerprint = fingerprintMonteCarloValue(personDataContext ? { request, personDataContext } : request);
    const document = {
        ...base,
        identifiers: {
            requestId: `mcrq_${requestFingerprint.value}`,
            runId: `mcrun_${fingerprint.value}`
        },
        fingerprint: {
            ...fingerprint,
            excludes: ['exportedAtUtc', 'identifiers', 'compatibility', 'privacy']
        },
        compatibility: {
            forwardPolicy: 'ignore-unknown-fields-after-v1-required-field-validation',
            unknownSchemaVersions: 'reject',
            deprecatedReadAliases: MONTE_CARLO_LEGACY_READ_ALIASES.map(alias => ({ ...alias })),
            newExportsWriteDeprecatedAliases: false
        },
        privacy: {
            scope: 'only-the-normalized-scenario-used-by-this-run',
            excludes: ['local-filesystem-paths', 'secrets-and-credentials', 'unrelated-storage-records'],
            notice: 'Der Export enthaelt die vom Nutzer eingegebenen Annahmen dieses Simulationsszenarios und wird nur durch eine explizite Nutzeraktion heruntergeladen.'
        }
    };
    validateMonteCarloExportV1(document);
    return deepFreezeMonteCarloContract(document);
}

/** @param {ExportV1} document
 * @param {ExportReadOptions} options */
export function validateMonteCarloExportV1(document, { verifyFingerprint = true } = {}) {
    requireObject(document, 'document');
    if (document.schemaId !== MONTE_CARLO_EXPORT_SCHEMA_ID) {
        throw exportError('MC_EXPORT_SCHEMA_ID_UNSUPPORTED', `Unsupported schemaId ${String(document.schemaId)}.`);
    }
    if (document.schemaVersion !== MONTE_CARLO_EXPORT_V1_VERSION) {
        throw exportError('MC_EXPORT_VERSION_UNSUPPORTED', `Unsupported schemaVersion ${String(document.schemaVersion)}.`);
    }
    normalizeExportedAt(document.exportedAtUtc);
    const identifiers = requireObject(document.identifiers, 'identifiers');
    requireString(identifiers.requestId, 'identifiers.requestId');
    requireString(identifiers.runId, 'identifiers.runId');
    requireObject(document.app, 'app');
    requireString(document.app.applicationId, 'app.applicationId');
    requireString(document.app.packageVersion, 'app.packageVersion');
    requireObject(document.engine, 'engine');
    if (document.snapshotPolicy?.schemaVersion !== MONTE_CARLO_SNAPSHOT_POLICY.schemaVersion) {
        throw exportError('MC_EXPORT_SNAPSHOT_POLICY_UNSUPPORTED', 'snapshotPolicy is missing or incompatible.');
    }
    validateMonteCarloRunRequestV1(document.request);
    validateMonteCarloRunResultV1(document.result);
    validatePersonDataContext(document.personDataContext);
    const fingerprint = requireObject(document.fingerprint, 'fingerprint');
    if (fingerprint.algorithm !== MONTE_CARLO_FINGERPRINT_ALGORITHM) {
        throw exportError('MC_EXPORT_FINGERPRINT_ALGORITHM_UNSUPPORTED', 'fingerprint.algorithm is unsupported.');
    }
    if (verifyFingerprint) {
        const expected = fingerprintMonteCarloValue(fingerprintBasis(document)).value;
        if (fingerprint.value !== expected) {
            throw exportError('MC_EXPORT_FINGERPRINT_MISMATCH', 'fingerprint does not match request and result.');
        }
        const expectedRunId = `mcrun_${expected}`;
        const expectedRequestId = `mcrq_${fingerprintMonteCarloValue(document.personDataContext ? { request: document.request, personDataContext: document.personDataContext } : document.request).value}`;
        if (identifiers.runId !== expectedRunId || identifiers.requestId !== expectedRequestId) {
            throw exportError('MC_EXPORT_IDENTIFIER_MISMATCH', 'identifiers do not match their canonical fingerprints.');
        }
    }
    const compatibility = requireObject(document.compatibility, 'compatibility');
    if (compatibility.forwardPolicy !== 'ignore-unknown-fields-after-v1-required-field-validation'
        || compatibility.newExportsWriteDeprecatedAliases !== false) {
        throw exportError('MC_EXPORT_FORWARD_POLICY_INVALID', 'compatibility policy is missing or incompatible.');
    }
    requireObject(document.privacy, 'privacy');
    normalizeMonteCarloJsonValue(document, { path: '$' });
    return document;
}

/** @param {string|ExportV1} source
 * @param {ExportReadOptions} options */
export function readMonteCarloExportV1(source, {
    verifyFingerprint = true,
    onTelemetry = null
} = {}) {
    let parsed;
    try {
        parsed = typeof source === 'string' ? JSON.parse(source) : source;
    } catch {
        throw exportError('MC_EXPORT_JSON_INVALID', 'input is not valid JSON.');
    }
    validateMonteCarloExportV1(parsed, { verifyFingerprint });
    const unknown = [
        ...unknownFields(parsed, TOP_LEVEL_FIELDS, '$'),
        ...unknownFields(parsed.request, REQUEST_FIELDS, '$.request'),
        ...unknownFields(parsed.result, RESULT_FIELDS, '$.result')
    ];
    for (const field of unknown) {
        if (typeof onTelemetry === 'function') {
            onTelemetry({ event: 'monte_carlo_unknown_field_ignored', field });
        }
    }
    const deprecatedAliases = collectMonteCarloLegacyAliasTelemetryV1(parsed, onTelemetry);
    return deepFreezeMonteCarloContract({
        document: parsed,
        compatibility: {
            unknownFields: unknown,
            deprecatedAliases
        }
    });
}

/** @param {ExportV1} document */
export function serializeMonteCarloExportV1(document) {
    validateMonteCarloExportV1(document);
    return JSON.stringify(JSON.parse(canonicalizeHistoricalContractValue(document)), null, 2);
}
