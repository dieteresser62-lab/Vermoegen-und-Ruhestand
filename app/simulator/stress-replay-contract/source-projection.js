// @ts-check
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
"use strict";

import { createStressReplayFingerprint, requirePlainObject, fail, requireFinite } from './values.js';
import { SOURCE_RECONCILIATION_FIELDS, SOURCE_IDENTITY_V2_RECONCILIATION_FIELDS } from './schema.js';

export function sourceDescriptorFingerprint(path) {
    return createStressReplayFingerprint({
        requestFingerprint: path.source.requestFingerprint,
        seed: path.source.seed,
        rngMode: path.source.rngMode,
        absoluteRunIndex: path.source.absoluteRunIndex,
        displayRunNumber: path.source.displayRunNumber,
        scenarioKey: path.source.scenarioKey,
        selectionMetric: path.source.selectionMetric,
        tieBreak: path.source.tieBreak,
        ...(path.source.startYearIndex !== undefined ? { startYearIndex: path.source.startYearIndex } : {})
    });
}

function projectSourceReconciliationRow(row, index, path = 'sourceRows') {
    requirePlainObject(row, `${path}[${index}]`);
    const projected = {};
    for (const fieldName of SOURCE_RECONCILIATION_FIELDS) {
        if (!Object.hasOwn(row, fieldName) || row[fieldName] === undefined) continue;
        if (fieldName === 'entscheidung') {
            const decision = requirePlainObject(row.entscheidung, `${path}[${index}].entscheidung`);
            if (Object.hasOwn(decision, 'jahresEntnahme') && decision.jahresEntnahme !== undefined) {
                projected.entscheidung = { jahresEntnahme: decision.jahresEntnahme };
            }
        } else {
            projected[fieldName] = row[fieldName];
        }
    }
    return projected;
}

export function projectSourceIdentityRowV1(row, index) {
    const projected = projectSourceReconciliationRow(row, index);
    return {
        recordType: projected.recordType,
        jahr: projected.jahr,
        histJahr: projected.histJahr,
        reconciliationFingerprint: createStressReplayFingerprint(projected)
    };
}

export function projectSourceIdentityRowV2(row, index) {
    const projected = projectSourceReconciliationRow(row, index);
    let presence = '';
    const values = [];
    for (const [compactField, sourceField] of SOURCE_IDENTITY_V2_RECONCILIATION_FIELDS) {
        if (!Object.hasOwn(projected, sourceField)) continue;
        presence += compactField;
        values.push(sourceField === 'entscheidung'
            ? projected.entscheidung.jahresEntnahme
            : projected[sourceField]);
    }
    const { recordType, jahr, histJahr } = projected;
    return {
        t: recordType,
        y: jahr,
        h: histJahr,
        r: JSON.stringify({ p: presence, v: values })
    };
}

export function parseSourceIdentityV2ReconciliationValues(value, path) {
    if (typeof value !== 'string') {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity reconciliation projection must be compact JSON');
    }
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity reconciliation projection is malformed');
    }
    requirePlainObject(parsed, path);
    const projectionKeys = Object.keys(parsed);
    if (projectionKeys.length !== 2 || projectionKeys[0] !== 'p' || projectionKeys[1] !== 'v'
        || typeof parsed.p !== 'string' || !Array.isArray(parsed.v)) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity reconciliation projection has an invalid shape');
    }
    const canonical = {};
    let canonicalPresence = '';
    let valueIndex = 0;
    for (const [compactField] of SOURCE_IDENTITY_V2_RECONCILIATION_FIELDS) {
        if (!parsed.p.includes(compactField)) continue;
        canonicalPresence += compactField;
        requireFinite(parsed.v[valueIndex], `${path}.${compactField}`);
        canonical[compactField] = parsed.v[valueIndex];
        valueIndex += 1;
    }
    if (canonicalPresence !== parsed.p || valueIndex !== parsed.v.length
        || JSON.stringify({ p: canonicalPresence, v: parsed.v }) !== value) {
        fail('STRESS_REPLAY_SOURCE_IDENTITY_INVALID', 'Source identity reconciliation projection is not canonical');
    }
    return canonical;
}

/**
 * @param row - Jahreszeile.
 * @returns Ergebnis der Operation.
 */
export function expandStressReplaySourceIdentityV2Row(row) {
    requirePlainObject(row, 'sourceIdentityRow');
    const reconciliationValues = parseSourceIdentityV2ReconciliationValues(
        row.r,
        'sourceIdentityRow.reconciliationValues'
    );
    const expanded = {
        recordType: row.t,
        jahr: row.y,
        histJahr: row.h
    };
    for (const [compactField, sourceField] of SOURCE_IDENTITY_V2_RECONCILIATION_FIELDS) {
        if (!Object.hasOwn(reconciliationValues, compactField)) continue;
        expanded[sourceField] = sourceField === 'entscheidung'
            ? { jahresEntnahme: reconciliationValues[compactField] }
            : reconciliationValues[compactField];
    }
    return expanded;
}

/**
 * @param row - Jahreszeile.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createStressReplaySourceIdentityRowFingerprint(row) {
    requirePlainObject(row, 'sourceRow');
    const projected = {};
    for (const fieldName of SOURCE_RECONCILIATION_FIELDS) {
        if (!Object.hasOwn(row, fieldName) || row[fieldName] === undefined) continue;
        if (fieldName === 'entscheidung') {
            if (row.entscheidung && Object.hasOwn(row.entscheidung, 'jahresEntnahme')
                && row.entscheidung.jahresEntnahme !== undefined) {
                projected.entscheidung = { jahresEntnahme: row.entscheidung.jahresEntnahme };
            }
        } else {
            projected[fieldName] = row[fieldName];
        }
    }
    return createStressReplayFingerprint(projected);
}

function sourceIdentityFingerprintBasis(identity) {
    const { identityFingerprint: _identityFingerprint, ...basis } = identity;
    return basis;
}

/**
 * @param identity - Kontext für identity.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createStressReplaySourceIdentityFingerprint(identity) {
    requirePlainObject(identity, 'sourceIdentity');
    return createStressReplayFingerprint(sourceIdentityFingerprintBasis(identity));
}
