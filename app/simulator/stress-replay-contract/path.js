// @ts-check
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
"use strict";

import { fail, assertStressReplayFinite, requirePlainObject, requireInteger, requireFinite, requireString, validateFingerprint, assertStressReplaySize, deepFreeze, cloneValue, createStressReplayFingerprint } from './values.js';
import { RECORD_TYPES, STRESS_REPLAY_SCHEMA_VERSIONS, STRESS_REPLAY_CONTRACT_VERSION, STRESS_REPLAY_SCOPE, SOURCE_TIE_BREAK, STRESS_REPLAY_UNITS_V1, TERMINAL_STATUSES, STRESS_REPLAY_LIMITS } from './schema.js';

function validateInitialMarketHistory(history) {
    if (!Array.isArray(history) || history.length === 0) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'initialMarketDataHist must be a non-empty array', {
            path: 'path.initialMarketDataHist'
        });
    }
    assertStressReplayFinite(history, 'path.initialMarketDataHist');
}

function validateAnnualRecord(record, index) {
    const path = `path.years[${index}]`;
    requirePlainObject(record, path);
    requireInteger(record.yearIndex, `${path}.yearIndex`, 0);
    if (record.yearIndex !== index) {
        fail('STRESS_REPLAY_INDEX_BASIS_INVALID', `${path}.yearIndex must be zero-based and contiguous`, {
            path: `${path}.yearIndex`,
            expected: index,
            actual: record.yearIndex
        });
    }
    if (!RECORD_TYPES.has(record.recordType) || typeof record.financiallyEvaluable !== 'boolean') {
        fail('STRESS_REPLAY_CONTRACT_INVALID', `${path} has an invalid record type or evaluability marker`, { path });
    }
    const expectedFinanciallyEvaluable = record.recordType === 'financial_year';
    if (record.financiallyEvaluable !== expectedFinanciallyEvaluable) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', `${path} evaluability conflicts with recordType`, { path });
    }
    if (record.financiallyEvaluable) {
        for (const key of ['equityReturnPct', 'goldReturnPct', 'cashReturnPct', 'inflationPct', 'wageGrowthPct', 'capeRatio']) {
            requireFinite(record[key], `${path}.${key}`);
        }
        requireString(record.regime, `${path}.regime`);
    }
    for (const key of ['stressEvents', 'tailRiskEvents', 'householdEvents']) {
        if (!Array.isArray(record[key])) fail('STRESS_REPLAY_CONTRACT_INVALID', `${path}.${key} must be an array`, { path: `${path}.${key}` });
    }
    assertStressReplayFinite(record, path);
}

/**
 * @param path - Fixierter Replaypfad.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function validateStressReplayPathV1(path) {
    requirePlainObject(path, 'path');
    if (path.schemaVersion !== STRESS_REPLAY_SCHEMA_VERSIONS.path
        || path.contractVersion !== STRESS_REPLAY_CONTRACT_VERSION
        || path.scope !== STRESS_REPLAY_SCOPE) {
        fail('STRESS_REPLAY_VERSION_UNSUPPORTED', 'Unsupported stress replay path contract', {
            schemaVersion: path.schemaVersion,
            contractVersion: path.contractVersion,
            scope: path.scope
        });
    }
    const source = requirePlainObject(path.source, 'path.source');
    validateFingerprint(source.requestFingerprint, 'path.source.requestFingerprint');
    requireFinite(source.seed, 'path.source.seed', { minimum: 0, maximum: 0xFFFFFFFF, integer: true });
    if (source.rngMode !== 'per-run-seed') {
        fail('STRESS_REPLAY_SOURCE_UNSUPPORTED', 'Only per-run-seed Monte Carlo sources are replayable', { rngMode: source.rngMode });
    }
    requireInteger(source.absoluteRunIndex, 'path.source.absoluteRunIndex', 0);
    requireInteger(source.displayRunNumber, 'path.source.displayRunNumber', 1);
    if (source.displayRunNumber !== source.absoluteRunIndex + 1) {
        fail('STRESS_REPLAY_INDEX_BASIS_INVALID', 'displayRunNumber must equal absoluteRunIndex + 1', {
            absoluteRunIndex: source.absoluteRunIndex,
            displayRunNumber: source.displayRunNumber
        });
    }
    requireString(source.scenarioKey, 'path.source.scenarioKey');
    requireString(source.selectionMetric, 'path.source.selectionMetric');
    if (source.tieBreak !== SOURCE_TIE_BREAK) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'path.source.tieBreak is unsupported', {
            path: 'path.source.tieBreak',
            expected: SOURCE_TIE_BREAK,
            actual: source.tieBreak
        });
    }
    if (typeof path.breakOnRuin !== 'boolean') {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'path.breakOnRuin must be boolean', { path: 'path.breakOnRuin' });
    }
    validateFingerprint(path.dataFingerprint, 'path.dataFingerprint');
    validateFingerprint(path.engineFingerprint, 'path.engineFingerprint');
    requirePlainObject(path.units, 'path.units');
    for (const [key, unit] of Object.entries(STRESS_REPLAY_UNITS_V1)) {
        if (path.units[key] !== unit) {
            fail('STRESS_REPLAY_CONTRACT_INVALID', `path.units.${key} is unsupported`, {
                path: `path.units.${key}`,
                expected: unit,
                actual: path.units[key]
            });
        }
    }
    requireInteger(path.horizonYears, 'path.horizonYears', 1);
    requireInteger(path.effectiveLength, 'path.effectiveLength', 1);
    if (!TERMINAL_STATUSES.has(path.terminalStatus)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'path.terminalStatus is unsupported', { terminalStatus: path.terminalStatus });
    }
    validateInitialMarketHistory(path.initialMarketDataHist);
    if (!Array.isArray(path.years) || path.years.length !== path.effectiveLength || path.effectiveLength > path.horizonYears) {
        fail('STRESS_REPLAY_LENGTH_MISMATCH', 'Path lengths do not reconcile', {
            horizonYears: path.horizonYears,
            effectiveLength: path.effectiveLength,
            yearCount: Array.isArray(path.years) ? path.years.length : null
        });
    }
    path.years.forEach(validateAnnualRecord);
    requirePlainObject(path.reconciliation, 'path.reconciliation');
    if (path.reconciliation.sourcePrefixMatched !== true) {
        fail('STRESS_REPLAY_RECONCILIATION_FAILED', 'Source prefix reconciliation must pass before a path is accepted');
    }
    assertStressReplayFinite(path, 'path');
    assertStressReplaySize(path, STRESS_REPLAY_LIMITS.maximumPathBytes, 'path');
    return deepFreeze(cloneValue(path));
}

export const assertStressReplayPathV1 = validateStressReplayPathV1;

/**
 * @param path - Fixierter Replaypfad.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createStressReplayPathFingerprint(path) {
    requirePlainObject(path, 'path');
    const { pathFingerprint: _pathFingerprint, ...fingerprintBasis } = path;
    return createStressReplayFingerprint(fingerprintBasis);
}
