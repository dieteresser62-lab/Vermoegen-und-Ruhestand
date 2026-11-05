// @ts-check
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
"use strict";

import { FINGERPRINT_EXCLUDED_KEYS, STRESS_REPLAY_FINGERPRINT_ALGORITHM } from './schema.js';
import { canonicalizeHistoricalContractValue, sha256Hex } from '../historical-backtest-contract.js';

export function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    return Object.freeze(value);
}

export function cloneValue(value, seen = new WeakMap()) {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) {
        throw new StressReplayContractError(
            'STRESS_REPLAY_CONTRACT_CYCLE',
            'Stress replay contract values must not contain cycles'
        );
    }
    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    for (const [key, child] of Object.entries(value)) copy[key] = cloneValue(child, seen);
    seen.delete(value);
    return copy;
}

export class StressReplayContractError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'StressReplayContractError';
        this.code = code;
        this.details = details && typeof details === 'object' ? details : {};
    }
}

export function fail(code, message, details = {}) {
    throw new StressReplayContractError(code, message, details);
}

export function requirePlainObject(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', `${path} must be an object`, { path });
    }
    return value;
}

export function requireString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        fail('STRESS_REPLAY_CONTRACT_INVALID', `${path} must be a non-empty string`, { path });
    }
    return value;
}

export function requireInteger(value, path, minimum = Number.MIN_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', `${path} must be an integer >= ${minimum}`, { path, value });
    }
    return value;
}

export function requireFinite(value, path, { minimum = -Infinity, maximum = Infinity, integer = false } = {}) {
    if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', `${path} is outside its finite numeric domain`, {
            path,
            value,
            minimum,
            maximum,
            integer
        });
    }
    return value;
}

/**
 * @param value - Zu prüfender oder darzustellender Wert.
 * @param {string} [path] - Feldpfad innerhalb des Dokuments.
 * @param {WeakSet<object>} [seen] - Bereits besuchte Objekte.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function assertStressReplayFinite(value, path = 'value', seen = new WeakSet()) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        fail('STRESS_REPLAY_NON_FINITE', `${path} must be finite`, { path, value: String(value) });
    }
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) fail('STRESS_REPLAY_CONTRACT_CYCLE', `${path} contains a cycle`, { path });
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
        assertStressReplayFinite(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, seen);
    }
    seen.delete(value);
    return value;
}

function projectFingerprintValue(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) fail('STRESS_REPLAY_CONTRACT_CYCLE', 'Fingerprint input contains a cycle');
    seen.add(value);
    const projected = Array.isArray(value) ? [] : {};
    for (const [key, child] of Object.entries(value)) {
        if (!FINGERPRINT_EXCLUDED_KEYS.has(key)) projected[key] = projectFingerprintValue(child, seen);
    }
    seen.delete(value);
    return projected;
}

/**
 * @param value - Zu prüfender oder darzustellender Wert.
 * @returns Ergebnis der Operation.
 */
export function canonicalizeStressReplayValue(value) {
    assertStressReplayFinite(value);
    return canonicalizeHistoricalContractValue(value);
}

/**
 * @param value - Zu prüfender oder darzustellender Wert.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createStressReplayFingerprint(value) {
    assertStressReplayFinite(value);
    const projected = projectFingerprintValue(value);
    return deepFreeze({
        algorithm: STRESS_REPLAY_FINGERPRINT_ALGORITHM,
        value: sha256Hex(canonicalizeHistoricalContractValue(projected))
    });
}

/**
 * @param value - Zu prüfender oder darzustellender Wert.
 * @param maximumBytes - Größenlimit in Bytes.
 * @param {string} [subject] - Kontext für subject.
 * @returns {number}
 */
export function assertStressReplaySize(value, maximumBytes, subject = 'value') {
    requireFinite(maximumBytes, 'maximumBytes', { minimum: 1, integer: true });
    assertStressReplayFinite(value, subject);
    const bytes = new TextEncoder().encode(canonicalizeHistoricalContractValue(value)).byteLength;
    if (bytes > maximumBytes) {
        fail('STRESS_REPLAY_PERSISTENCE_SIZE_LIMIT', `${subject} exceeds its size limit`, {
            subject,
            bytes,
            maximumBytes
        });
    }
    return bytes;
}

export function validateFingerprint(value, path) {
    if (value?.algorithm !== STRESS_REPLAY_FINGERPRINT_ALGORITHM
        || typeof value?.value !== 'string'
        || !/^[a-f0-9]{64}$/.test(value.value)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', `${path} must be a canonical SHA-256 fingerprint`, { path });
    }
}
