// @ts-check
import { AppError } from '../balance-config.js';

export function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

export function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

export class BalanceImportError extends AppError {
    /** @param {string} code @param {string} message @param {{originalError?: unknown}} [options] */
    constructor(code, message, { originalError } = {}) {
        super(message, {}, originalError === undefined ? undefined : { cause: originalError });
        this.name = 'BalanceImportError';
        this.code = code;
    }
}

export function failImport(code, message) {
    throw new BalanceImportError(code, message);
}

export class MarketCsvImportError extends AppError {
    constructor(code, message, details = {}) {
        super(message, details);
        this.name = 'MarketCsvImportError';
        this.code = code;
        this.details = details;
    }
}

export function failMarketCsv(code, message, details = {}) {
    throw new MarketCsvImportError(code, message, details);
}
