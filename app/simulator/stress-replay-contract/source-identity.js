// @ts-check
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
"use strict";

import { requirePlainObject, fail, requireInteger, validateFingerprint, requireFinite, assertStressReplayFinite, cloneValue, deepFreeze, assertStressReplaySize } from './values.js';
import { validateStressReplayPathV1 } from './path.js';
import { STRESS_REPLAY_SOURCE_IDENTITY_SCHEMA_VERSION_V1, STRESS_REPLAY_CONTRACT_VERSION, STRESS_REPLAY_LIMITS, SOURCE_IDENTITY_FIELD_SET, RECORD_TYPES, STRESS_REPLAY_SOURCE_IDENTITY_SCHEMA_VERSION_V2, SOURCE_IDENTITY_V2_FIELD_SET } from './schema.js';
import { sourceDescriptorFingerprint, createStressReplaySourceIdentityFingerprint, projectSourceIdentityRowV1, parseSourceIdentityV2ReconciliationValues, projectSourceIdentityRowV2 } from './source-projection.js';

/**
 * @param identity - Kontext für identity.
 * @param path - Fixierter Replaypfad.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function validateStressReplaySourceIdentityV1(identity, path) {
    requirePlainObject(identity, 'sourceIdentity');
    const validatedPath = validateStressReplayPathV1(path);
    const allowedKeys = new Set([
        'schemaVersion', 'contractVersion', 'sourcePrefixLength',
        'sourceDescriptorFingerprint', 'rows', 'identityFingerprint'
    ]);
    const unknownKeys = Object.keys(identity).filter(key => !allowedKeys.has(key)).sort();
    if (unknownKeys.length > 0) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity contains unknown fields', { fields: unknownKeys });
    }
    if (identity.schemaVersion !== STRESS_REPLAY_SOURCE_IDENTITY_SCHEMA_VERSION_V1
        || identity.contractVersion !== STRESS_REPLAY_CONTRACT_VERSION) {
        fail('STRESS_REPLAY_VERSION_UNSUPPORTED', 'Unsupported stress replay source identity contract');
    }
    const expectedPrefixLength = validatedPath.reconciliation.sourcePrefixLength
        ?? validatedPath.years.length;
    requireInteger(identity.sourcePrefixLength, 'sourceIdentity.sourcePrefixLength', 1);
    if (identity.sourcePrefixLength !== expectedPrefixLength
        || identity.sourcePrefixLength > STRESS_REPLAY_LIMITS.maximumSourceIdentityRows
        || !Array.isArray(identity.rows)
        || identity.rows.length !== identity.sourcePrefixLength) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity length does not match the fixed source prefix', {
            expectedPrefixLength,
            actualPrefixLength: identity.sourcePrefixLength,
            rowCount: Array.isArray(identity.rows) ? identity.rows.length : null
        });
    }
    validateFingerprint(identity.sourceDescriptorFingerprint, 'sourceIdentity.sourceDescriptorFingerprint');
    if (identity.sourceDescriptorFingerprint.value !== sourceDescriptorFingerprint(validatedPath).value) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_MISMATCH', 'Source identity does not belong to the fixed source run');
    }
    const rows = identity.rows.map((row, index) => {
        requirePlainObject(row, `sourceIdentity.rows[${index}]`);
        const rowUnknownKeys = Object.keys(row).filter(key => !SOURCE_IDENTITY_FIELD_SET.has(key)).sort();
        if (rowUnknownKeys.length > 0) {
            fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity row contains unknown fields', {
                index,
                fields: rowUnknownKeys
            });
        }
        if (!RECORD_TYPES.has(row.recordType)) {
            fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity row record type is invalid', { index });
        }
        requireInteger(row.jahr, `sourceIdentity.rows[${index}].jahr`, 1);
        if (row.jahr !== index + 1) {
            fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity rows must retain their original order', { index });
        }
        if (row.histJahr !== null) requireFinite(row.histJahr, `sourceIdentity.rows[${index}].histJahr`, { integer: true });
        const pathRow = validatedPath.years[index];
        if (row.recordType !== pathRow.recordType
            || row.histJahr !== (pathRow.historicalYear ?? null)) {
            fail('STRESS_REPLAY_SOURCE_IDENTITY_MISMATCH', 'Source identity prefix does not match the fixed path structure', {
                index
            });
        }
        validateFingerprint(row.reconciliationFingerprint, `sourceIdentity.rows[${index}].reconciliationFingerprint`);
        assertStressReplayFinite(row, `sourceIdentity.rows[${index}]`);
        return cloneValue(row);
    });
    validateFingerprint(identity.identityFingerprint, 'sourceIdentity.identityFingerprint');
    const normalized = { ...identity, rows };
    if (identity.identityFingerprint.value !== createStressReplaySourceIdentityFingerprint(normalized).value) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_FINGERPRINT_MISMATCH', 'Source identity fingerprint does not match its rows');
    }
    return deepFreeze(cloneValue(normalized));
}

/** @param {{path?: RuntimeTypes.JsonRecord; sourceRows?: object[]}} [options] @returns {RuntimeTypes.JsonRecord} */
export function createStressReplaySourceIdentityV1({ path, sourceRows } = {}) {
    const validatedPath = validateStressReplayPathV1(path);
    if (!Array.isArray(sourceRows)) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Original source scenario rows are required');
    }
    const sourcePrefixLength = validatedPath.reconciliation.sourcePrefixLength
        ?? validatedPath.years.length;
    if (sourceRows.length < sourcePrefixLength) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Original source scenario prefix is incomplete');
    }
    const identityWithoutFingerprint = {
        schemaVersion: STRESS_REPLAY_SOURCE_IDENTITY_SCHEMA_VERSION_V1,
        contractVersion: STRESS_REPLAY_CONTRACT_VERSION,
        sourcePrefixLength,
        sourceDescriptorFingerprint: sourceDescriptorFingerprint(validatedPath),
        rows: sourceRows.slice(0, sourcePrefixLength).map(projectSourceIdentityRowV1)
    };
    return validateStressReplaySourceIdentityV1({
        ...identityWithoutFingerprint,
        identityFingerprint: createStressReplaySourceIdentityFingerprint(identityWithoutFingerprint)
    }, validatedPath);
}

/**
 * @param identity - Kontext für identity.
 * @param path - Fixierter Replaypfad.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function validateStressReplaySourceIdentityV2(identity, path) {
    requirePlainObject(identity, 'sourceIdentity');
    const validatedPath = validateStressReplayPathV1(path);
    const allowedKeys = new Set([
        'schemaVersion', 'contractVersion', 'sourcePrefixLength',
        'sourceDescriptorFingerprint', 'rows', 'identityFingerprint'
    ]);
    const unknownKeys = Object.keys(identity).filter(key => !allowedKeys.has(key)).sort();
    if (unknownKeys.length > 0) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity contains unknown fields', { fields: unknownKeys });
    }
    if (identity.schemaVersion !== STRESS_REPLAY_SOURCE_IDENTITY_SCHEMA_VERSION_V2
        || identity.contractVersion !== STRESS_REPLAY_CONTRACT_VERSION) {
        fail('STRESS_REPLAY_VERSION_UNSUPPORTED', 'Unsupported stress replay source identity contract');
    }
    const expectedPrefixLength = validatedPath.reconciliation.sourcePrefixLength
        ?? validatedPath.years.length;
    requireInteger(identity.sourcePrefixLength, 'sourceIdentity.sourcePrefixLength', 1);
    if (identity.sourcePrefixLength !== expectedPrefixLength
        || identity.sourcePrefixLength > STRESS_REPLAY_LIMITS.maximumSourceIdentityRows
        || !Array.isArray(identity.rows)
        || identity.rows.length !== identity.sourcePrefixLength) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity length does not match the fixed source prefix', {
            expectedPrefixLength,
            actualPrefixLength: identity.sourcePrefixLength,
            rowCount: Array.isArray(identity.rows) ? identity.rows.length : null
        });
    }
    validateFingerprint(identity.sourceDescriptorFingerprint, 'sourceIdentity.sourceDescriptorFingerprint');
    if (identity.sourceDescriptorFingerprint.value !== sourceDescriptorFingerprint(validatedPath).value) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_MISMATCH', 'Source identity does not belong to the fixed source run');
    }
    const rows = identity.rows.map((row, index) => {
        requirePlainObject(row, `sourceIdentity.rows[${index}]`);
        const rowUnknownKeys = Object.keys(row).filter(key => !SOURCE_IDENTITY_V2_FIELD_SET.has(key)).sort();
        if (rowUnknownKeys.length > 0) {
            fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity row contains unknown fields', {
                index,
                fields: rowUnknownKeys
            });
        }
        if (!RECORD_TYPES.has(row.t)) {
            fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity row record type is invalid', { index });
        }
        requireInteger(row.y, `sourceIdentity.rows[${index}].jahr`, 1);
        if (row.y !== index + 1) {
            fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity rows must retain their original order', { index });
        }
        if (row.h !== null) requireFinite(row.h, `sourceIdentity.rows[${index}].histJahr`, { integer: true });
        const pathRow = validatedPath.years[index];
        if (row.t !== pathRow.recordType
            || row.h !== (pathRow.historicalYear ?? null)) {
            fail('STRESS_REPLAY_SOURCE_IDENTITY_MISMATCH', 'Source identity prefix does not match the fixed path structure', {
                index
            });
        }
        parseSourceIdentityV2ReconciliationValues(
            row.r,
            `sourceIdentity.rows[${index}].reconciliationValues`
        );
        assertStressReplayFinite(row, `sourceIdentity.rows[${index}]`);
        return cloneValue(row);
    });
    validateFingerprint(identity.identityFingerprint, 'sourceIdentity.identityFingerprint');
    const normalized = { ...identity, rows };
    if (identity.identityFingerprint.value !== createStressReplaySourceIdentityFingerprint(normalized).value) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_FINGERPRINT_MISMATCH', 'Source identity fingerprint does not match its rows');
    }
    assertStressReplaySize(normalized, STRESS_REPLAY_LIMITS.maximumEnvelopeBytes, 'sourceIdentity');
    return deepFreeze(cloneValue(normalized));
}

/**
 * @param identity - Kontext für identity.
 * @param path - Fixierter Replaypfad.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function validateStressReplaySourceIdentity(identity, path) {
    if (identity?.schemaVersion === STRESS_REPLAY_SOURCE_IDENTITY_SCHEMA_VERSION_V1) {
        return validateStressReplaySourceIdentityV1(identity, path);
    }
    if (identity?.schemaVersion === STRESS_REPLAY_SOURCE_IDENTITY_SCHEMA_VERSION_V2) {
        return validateStressReplaySourceIdentityV2(identity, path);
    }
    fail('STRESS_REPLAY_VERSION_UNSUPPORTED', 'Unsupported stress replay source identity contract', {
        schemaVersion: identity?.schemaVersion ?? null
    });
}

/** @param {{path?: RuntimeTypes.JsonRecord; sourceRows?: object[]}} [options] @returns {RuntimeTypes.JsonRecord} */
export function createStressReplaySourceIdentityV2({ path, sourceRows } = {}) {
    const validatedPath = validateStressReplayPathV1(path);
    if (!Array.isArray(sourceRows)) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Original source scenario rows are required');
    }
    const sourcePrefixLength = validatedPath.reconciliation.sourcePrefixLength
        ?? validatedPath.years.length;
    if (sourceRows.length < sourcePrefixLength) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Original source scenario prefix is incomplete');
    }
    const identityWithoutFingerprint = {
        schemaVersion: STRESS_REPLAY_SOURCE_IDENTITY_SCHEMA_VERSION_V2,
        contractVersion: STRESS_REPLAY_CONTRACT_VERSION,
        sourcePrefixLength,
        sourceDescriptorFingerprint: sourceDescriptorFingerprint(validatedPath),
        rows: sourceRows.slice(0, sourcePrefixLength).map(projectSourceIdentityRowV2)
    };
    return validateStressReplaySourceIdentityV2({
        ...identityWithoutFingerprint,
        identityFingerprint: createStressReplaySourceIdentityFingerprint(identityWithoutFingerprint)
    }, validatedPath);
}
