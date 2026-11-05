/** @import {ExportBuildOptions,ExportV1,ExportV2,ExportReadOptions,ScenarioSourceRow,ScenarioExportRow,ScenarioMeasurements,ScenarioLogDocument,PersonDataContext} from '../../../typcheck/rechenkern' */
import {
    validateMonteCarloRunRequestV1,
    MONTE_CARLO_RUN_RESULT_VERSION,
    projectMonteCarloRunResultV2,
    validateMonteCarloRunResultV2,
    normalizeMonteCarloJsonValue,
    MONTE_CARLO_SNAPSHOT_POLICY,
    fingerprintMonteCarloValue,
    deepFreezeMonteCarloContract,
    MONTE_CARLO_FINGERPRINT_ALGORITHM
} from '../monte-carlo-contracts.js';
import {
    MONTE_CARLO_EXPORT_SCHEMA_ID,
    MONTE_CARLO_EXPORT_V2_VERSION,
    MONTE_CARLO_APP_VERSION,
    MONTE_CARLO_EXPORT_V1_VERSION
} from './schema.js';
import { normalizeExportedAt, fingerprintBasis, requireObject, exportError, requireString, normalizeSource } from './envelope.js';
import { freezePersonDataContext, validatePersonDataContext } from '../simulator-person-overrides.js';
import { readMonteCarloExportV1 } from './export-v1.js';
import { canonicalizeHistoricalContractValue } from '../historical-backtest-contract.js';

/** @param {ExportBuildOptions & {app:NonNullable<ExportBuildOptions['app']>;exportedAt:NonNullable<ExportBuildOptions['exportedAt']>}} options */
function buildExportEnvelopeV2({ request, result, engine, app, exportedAt }) {
    validateMonteCarloRunRequestV1(request);
    const resultV2 = /** @type {import('../../../typcheck/rechenkern').RunResultV2} */ (result?.schemaVersion === MONTE_CARLO_RUN_RESULT_VERSION
        ? projectMonteCarloRunResultV2(/** @type {import('../../../typcheck/rechenkern').RunResultV1} */ (result))
        : result);
    validateMonteCarloRunResultV2(resultV2);
    return {
        schemaId: MONTE_CARLO_EXPORT_SCHEMA_ID,
        schemaVersion: /** @type {'MonteCarloExportV2'} */ (MONTE_CARLO_EXPORT_V2_VERSION),
        exportedAtUtc: normalizeExportedAt(exportedAt),
        app: normalizeMonteCarloJsonValue(app, { path: '$.app' }),
        engine: normalizeMonteCarloJsonValue(engine || {}, { path: '$.engine' }),
        snapshotPolicy: { ...MONTE_CARLO_SNAPSHOT_POLICY },
        request,
        result: resultV2
    };
}

/** @param {ExportBuildOptions} options
 * @returns {ExportV2} */
export function buildMonteCarloExportV2({
    request,
    result,
    engine = null,
    app = MONTE_CARLO_APP_VERSION,
    exportedAt = new Date(),
    personDataContext = null
} = /** @type {NonNullable<Parameters<typeof buildMonteCarloExportV2>[0]>} */ ({})) {
    const base = { ...buildExportEnvelopeV2({ request, result, engine, app, exportedAt }),
        ...(personDataContext ? { personDataContext: freezePersonDataContext(validatePersonDataContext(personDataContext)) } : {}) };
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
            forwardPolicy: 'ignore-unknown-fields-after-v2-required-field-validation',
            unknownSchemaVersions: 'reject',
            readablePredecessors: [MONTE_CARLO_EXPORT_V1_VERSION],
            newExportsWriteDeprecatedAliases: false
        },
        privacy: {
            scope: 'only-the-normalized-scenario-used-by-this-run',
            excludes: ['local-filesystem-paths', 'secrets-and-credentials', 'unrelated-storage-records'],
            notice: 'Der Export enthaelt die vom Nutzer eingegebenen Annahmen dieses Simulationsszenarios und wird nur durch eine explizite Nutzeraktion heruntergeladen.'
        }
    };
    validateMonteCarloExportV2(document);
    return deepFreezeMonteCarloContract(document);
}

/** @param {ExportV2} document
 * @param {ExportReadOptions} options */
export function validateMonteCarloExportV2(document, { verifyFingerprint = true } = {}) {
    requireObject(document, 'document', MONTE_CARLO_EXPORT_V2_VERSION);
    if (document.schemaId !== MONTE_CARLO_EXPORT_SCHEMA_ID) {
        throw exportError('MC_EXPORT_SCHEMA_ID_UNSUPPORTED', `Unsupported schemaId ${String(document.schemaId)}.`, MONTE_CARLO_EXPORT_V2_VERSION);
    }
    if (document.schemaVersion !== MONTE_CARLO_EXPORT_V2_VERSION) {
        throw exportError('MC_EXPORT_VERSION_UNSUPPORTED', `Unsupported schemaVersion ${String(document.schemaVersion)}.`, MONTE_CARLO_EXPORT_V2_VERSION);
    }
    normalizeExportedAt(document.exportedAtUtc, MONTE_CARLO_EXPORT_V2_VERSION);
    const identifiers = requireObject(document.identifiers, 'identifiers', MONTE_CARLO_EXPORT_V2_VERSION);
    requireString(identifiers.requestId, 'identifiers.requestId', MONTE_CARLO_EXPORT_V2_VERSION);
    requireString(identifiers.runId, 'identifiers.runId', MONTE_CARLO_EXPORT_V2_VERSION);
    requireObject(document.app, 'app', MONTE_CARLO_EXPORT_V2_VERSION);
    requireString(document.app.applicationId, 'app.applicationId', MONTE_CARLO_EXPORT_V2_VERSION);
    requireString(document.app.packageVersion, 'app.packageVersion', MONTE_CARLO_EXPORT_V2_VERSION);
    requireObject(document.engine, 'engine', MONTE_CARLO_EXPORT_V2_VERSION);
    if (document.snapshotPolicy?.schemaVersion !== MONTE_CARLO_SNAPSHOT_POLICY.schemaVersion) {
        throw exportError('MC_EXPORT_SNAPSHOT_POLICY_UNSUPPORTED', 'snapshotPolicy is missing or incompatible.', MONTE_CARLO_EXPORT_V2_VERSION);
    }
    validateMonteCarloRunRequestV1(document.request);
    validateMonteCarloRunResultV2(document.result);
    validatePersonDataContext(document.personDataContext);
    const fingerprint = requireObject(document.fingerprint, 'fingerprint', MONTE_CARLO_EXPORT_V2_VERSION);
    if (fingerprint.algorithm !== MONTE_CARLO_FINGERPRINT_ALGORITHM) {
        throw exportError('MC_EXPORT_FINGERPRINT_ALGORITHM_UNSUPPORTED', 'fingerprint.algorithm is unsupported.', MONTE_CARLO_EXPORT_V2_VERSION);
    }
    if (verifyFingerprint) {
        const expected = fingerprintMonteCarloValue(fingerprintBasis(document)).value;
        if (fingerprint.value !== expected) {
            throw exportError('MC_EXPORT_FINGERPRINT_MISMATCH', 'fingerprint does not match request and result.', MONTE_CARLO_EXPORT_V2_VERSION);
        }
        if (identifiers.runId !== `mcrun_${expected}`
            || identifiers.requestId !== `mcrq_${fingerprintMonteCarloValue(document.personDataContext ? { request: document.request, personDataContext: document.personDataContext } : document.request).value}`) {
            throw exportError('MC_EXPORT_IDENTIFIER_MISMATCH', 'identifiers do not match their canonical fingerprints.', MONTE_CARLO_EXPORT_V2_VERSION);
        }
    }
    if (document.compatibility?.forwardPolicy !== 'ignore-unknown-fields-after-v2-required-field-validation'
        || document.compatibility?.newExportsWriteDeprecatedAliases !== false) {
        throw exportError('MC_EXPORT_FORWARD_POLICY_INVALID', 'compatibility policy is missing or incompatible.', MONTE_CARLO_EXPORT_V2_VERSION);
    }
    requireObject(document.privacy, 'privacy', MONTE_CARLO_EXPORT_V2_VERSION);
    normalizeMonteCarloJsonValue(document, { path: '$' });
    return document;
}

/** @param {string|ExportV2} source
 * @param {ExportReadOptions} options */
export function readMonteCarloExportV2(source, { verifyFingerprint = true } = {}) {
    const parsed = normalizeSource(source);
    validateMonteCarloExportV2(parsed, { verifyFingerprint });
    return deepFreezeMonteCarloContract({
        document: parsed,
        compatibility: { unknownFields: [], deprecatedAliases: [] },
        compatibilityWarnings: []
    });
}

/** @param {string|ExportV1|ExportV2} source
 * @param {ExportReadOptions} options */
export function readMonteCarloExport(source, options = {}) {
    const parsed = normalizeSource(source);
    if (parsed?.schemaVersion === MONTE_CARLO_EXPORT_V1_VERSION) {
        const read = readMonteCarloExportV1(/** @type {ExportV1} */ (parsed), options);
        return deepFreezeMonteCarloContract({
            ...read,
            compatibilityWarnings: [{
                code: 'monte_carlo_v1_legacy_bin_and_unit_semantics',
                message: 'V1 beschreibt Heatmap-Intervalle, Ratio-/Prozentwerte und reale Drawdowns nicht mit dem V2-Messvertrag.'
            }]
        });
    }
    if (parsed?.schemaVersion === MONTE_CARLO_EXPORT_V2_VERSION) {
        return readMonteCarloExportV2(/** @type {ExportV2} */ (parsed), options);
    }
    throw exportError('MC_EXPORT_VERSION_UNSUPPORTED', `Unsupported schemaVersion ${String(/** @type {{schemaVersion?:unknown}} */ (parsed)?.schemaVersion)}.`, MONTE_CARLO_EXPORT_V2_VERSION);
}

/** @param {ExportV2} document */
export function serializeMonteCarloExportV2(document) {
    validateMonteCarloExportV2(document);
    return JSON.stringify(JSON.parse(canonicalizeHistoricalContractValue(document)), null, 2);
}

/** @param {ExportBuildOptions} options */
export function createMonteCarloExportDownload({
    request,
    result,
    engine = null,
    app = MONTE_CARLO_APP_VERSION,
    exportedAt = new Date(),
    personDataContext = null
} = /** @type {NonNullable<Parameters<typeof createMonteCarloExportDownload>[0]>} */ ({})) {
    const document = buildMonteCarloExportV2({ request, result, engine, app, exportedAt, personDataContext });
    const safeTimestamp = document.exportedAtUtc.replace(/[:.]/g, '-');
    const fingerprint = document.fingerprint.value.slice(0, 12);
    return deepFreezeMonteCarloContract({
        filename: `monte-carlo-${fingerprint}-${safeTimestamp}.json`,
        mimeType: 'application/json',
        content: serializeMonteCarloExportV2(document),
        fingerprint: document.fingerprint,
        runId: document.identifiers.runId
    });
}
