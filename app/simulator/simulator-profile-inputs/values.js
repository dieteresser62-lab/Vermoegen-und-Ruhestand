import { STRATEGY_OPTIONS } from '../../../types/strategy-options.js';

export const DYNAMIC_FLEX_DEFAULTS = {
    HORIZON_METHOD: 'survival_quantile',
    HORIZON_YEARS: 30,
    SURVIVAL_QUANTILE: 0.85,
    GO_GO_MULTIPLIER: 1.0
};

const DYNAMIC_FLEX_ALLOWED_HORIZON_METHODS = new Set(['mean', 'survival_quantile']);

const LEGACY_STANDARD_MODES = new Set(['dynamic_flex', 'vpw', 'guardrails', 'fixed_real', 'none']);

export function readValue(data, key) {
    if (!data || typeof data !== 'object') return null;
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
}

export function readString(data, key, fallback = '') {
    const raw = readValue(data, key);
    if (raw === null || raw === undefined || raw === '') return fallback;
    return String(raw);
}

export function readNumber(data, key, fallback = 0) {
    const raw = readValue(data, key);
    if (raw === null || raw === undefined || raw === '') return fallback;
    const n = Number(String(raw).replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
}

export function readInt(data, key, fallback = 0) {
    const raw = readValue(data, key);
    if (raw === null || raw === undefined || raw === '') return fallback;
    const n = parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : fallback;
}

export function readBool(data, key, fallback = false) {
    const raw = readValue(data, key);
    if (raw === null || raw === undefined || raw === '') return fallback;
    if (raw === true || raw === false) return raw;
    const str = String(raw).toLowerCase();
    return str === 'true' || str === '1' || str === 'yes' || str === 'on';
}

export function readPositiveBalanceNeed(balanceInputs, key) {
    if (!balanceInputs || typeof balanceInputs !== 'object'
        || !Object.prototype.hasOwnProperty.call(balanceInputs, key)) return null;
    const raw = balanceInputs[key];
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(String(raw).replace(',', '.'));
    return Number.isFinite(value) && value > 0 ? value : null;
}

export function simKey(id) {
    return `sim_${id}`;
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function normalizeDynamicFlexHorizonMethod(method) {
    return DYNAMIC_FLEX_ALLOWED_HORIZON_METHODS.has(method)
        ? method
        : DYNAMIC_FLEX_DEFAULTS.HORIZON_METHOD;
}

export function normalizeDecumulationMode(modeRaw) {
    const mode = String(modeRaw || '').trim().toLowerCase();
    if (mode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE) return STRATEGY_OPTIONS.THREE_BUCKET_JILGE;
    if (mode === STRATEGY_OPTIONS.STANDARD || LEGACY_STANDARD_MODES.has(mode) || mode === '') {
        return STRATEGY_OPTIONS.STANDARD;
    }
    return STRATEGY_OPTIONS.STANDARD;
}

export function parseWidowOptions(data) {
    const mode = readString(data, simKey('widowPensionMode'), 'stop');
    const pctRaw = readNumber(data, simKey('widowPensionPct'), 0);
    const marriageOffsetYears = Math.max(0, readInt(data, simKey('widowMarriageOffsetYears'), 0));
    const minMarriageYears = Math.max(0, readInt(data, simKey('widowMinMarriageYears'), 0));
    return {
        mode,
        percent: Math.max(0, Math.min(100, pctRaw)) / 100,
        marriageOffsetYears,
        minMarriageYears
    };
}
