/** @import {BoundFieldValue, SimulatorControl} from '../../typcheck/simulator-ui.js'
 *
 * Module: Simulator Input DOM
 * Purpose: Small defensive DOM readers used by simulator input modules.
 */
"use strict";

import { readBoundHouseholdPlanField } from '../shared/household-plan-fields.js';

import { parseDisplayNumber } from './simulator-portfolio-format.js';

const STRICT_DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parses a DOM numeric value without accepting partial strings.
 * A single decimal comma is supported for programmatic/legacy DOM fixtures;
 * thousands separators belong to the explicit display-number reader.
 */
/** @param {unknown} rawValue @param {number} [fallback] @returns {number} */
export function parseFiniteInputNumber(rawValue, fallback = 0) {
    if (typeof rawValue === 'number') {
        return Number.isFinite(rawValue) ? rawValue : fallback;
    }
    if (rawValue === null || rawValue === undefined) return fallback;
    const raw = String(rawValue).trim();
    if (!raw) return fallback;
    if (raw.includes('.') && raw.includes(',')) return fallback;
    const normalized = raw.includes(',') ? raw.replace(',', '.') : raw;
    if (!STRICT_DECIMAL_PATTERN.test(normalized)) return fallback;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : fallback;
}

/** @param {string} id @param {Document} [doc] @returns {SimulatorControl | null} */
export function getInputElement(id, doc = globalThis.document) {
    if (!doc || typeof doc.getElementById !== 'function') return null;
    return /** @type {SimulatorControl} */ (doc.getElementById(id));
}

/** @template {string} K
 * @param {K} id @param {string | null} [fallback] @param {Document} [doc]
 * @returns {BoundFieldValue<K> | null} */
export function readValue(id, fallback = '', doc = globalThis.document) {
    const el = getInputElement(id, doc);
    const bound = readBoundHouseholdPlanField(el);
    if (bound !== undefined) return bound;
    const value = el?.value;
    return /** @type {BoundFieldValue<K> | null} */ (value === undefined || value === null ? fallback : value);
}

/** @param {string} id @param {boolean} [fallback] @param {Document} [doc] @returns {boolean} */
export function readChecked(id, fallback = false, doc = globalThis.document) {
    const el = getInputElement(id, doc);
    return typeof el?.checked === 'boolean' ? el.checked : fallback;
}

/** @param {string} id @param {number} [fallback] @param {Document} [doc] @returns {number} */
export function readNumber(id, fallback = 0, doc = globalThis.document) {
    const bound = readBoundHouseholdPlanField(getInputElement(id, doc));
    return bound !== undefined ? bound : parseFiniteInputNumber(readValue(id, '', doc), fallback);
}

/** @param {string} id @param {number} [fallback] @param {Document} [doc] @returns {number} */
export function readInt(id, fallback = 0, doc = globalThis.document) {
    const bound = readBoundHouseholdPlanField(getInputElement(id, doc));
    if (bound !== undefined) return Number.isInteger(bound) ? bound : NaN;
    const n = parseFiniteInputNumber(readValue(id, '', doc), Number.NaN);
    return Number.isInteger(n) ? n : fallback;
}

/** @param {string} id @param {Document} [doc] @returns {number} */
export function readDisplayNumber(id, doc = globalThis.document) {
    const bound = readBoundHouseholdPlanField(getInputElement(id, doc));
    return bound !== undefined ? bound : parseDisplayNumber(readValue(id, '', doc));
}

/** @param {unknown} rawValue @param {number} fallback @param {number} min @param {number} max @returns {number} */
export function parseBoundedNumber(rawValue, fallback, min, max) {
    const n = parseFiniteInputNumber(rawValue, Number.NaN);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

/** @param {string} id @param {number} fallback @param {number} min @param {number} max @param {Document} [doc] @returns {number} */
export function readBoundedNumber(id, fallback, min, max, doc = globalThis.document) {
    const bound = readBoundHouseholdPlanField(getInputElement(id, doc));
    return bound !== undefined ? bound : parseBoundedNumber(readValue(id, '', doc), fallback, min, max);
}
