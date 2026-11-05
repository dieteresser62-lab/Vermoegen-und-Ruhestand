import { createHash } from 'node:crypto';
import { canonicalizeHistoricalContractValue } from '../../app/simulator/historical-backtest-contract.js';

const integerKey = /^(0|[1-9]\d*)$/;
const sparseArray = Symbol('sparseArray');
function ordered(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value
        : Number.isNaN(value) ? '__NaN__' : value > 0 ? '__Infinity__' : '__-Infinity__';
    if (value === undefined) return '__undefined__';
    if (Array.isArray(value)) {
        if (Array.from({ length: value.length }, (_, index) => index).some(index => !Object.hasOwn(value, index))) throw sparseArray;
        return value.map(ordered);
    }
    if (typeof value === 'object') {
        const result = Object.create(null);
        const keys = Object.keys(value).map(key => ({ key, integer: integerKey.test(key) })).sort((a, b) =>
            a.integer && b.integer ? Number(a.key) - Number(b.key) : a.integer !== b.integer ? a.integer ? -1 : 1
                : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
        for (const { key } of keys) result[key] = ordered(value[key]);
        return result;
    }
    return String(value);
}

/** Same canonical bytes and digest as the browser implementation, supplied only by Node callers. */
export function nodeParityHash(value) {
    let bytes;
    try { bytes = JSON.stringify(ordered(value)); }
    catch (error) { if (error !== sparseArray) throw error; bytes = canonicalizeHistoricalContractValue(value); }
    return createHash('sha256').update(bytes, 'utf8').digest('hex');
}
