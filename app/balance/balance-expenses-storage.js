/** @import * as D from "../../typcheck/datenvertraege.js" */
/** @import * as I from "../../typcheck/speicher-integration.js" */
import { appNow } from '../shared/app-clock.js';
import { computeBudgetSpent, hasExpenseImport, hasCategoryNeeds } from './balance-expenses-metrics.js';
/**
 * Module: Balance Expenses Storage
 * Purpose: localStorage access and schema helpers for the expenses check.
 */
"use strict";

import { persistenceStorage } from '../shared/persistence-facade.js';

export const EXPENSES_STORAGE_KEY = 'balance_expenses_v1';
export const EXPENSES_STORE_STATUS = Object.freeze({
    OK: 'ok',
    EMPTY: 'empty',
    CORRUPT: 'corrupt'
});

const EXPENSES_RECOVERY_APP_ID = 'ruhe-stand-suite.balance';
const EXPENSES_RECOVERY_SCHEMA = 'balance-expenses-corrupt-recovery';

export class ExpensesStoreCorruptionError extends Error {
    /** @param {D.ExpensesResult} result */
    constructor(result) {
        super(result?.error?.message || 'Der Ausgabenstore ist beschaedigt.');
        this.name = 'ExpensesStoreCorruptionError';
        this.code = result?.error?.code || 'expenses-store-corrupt';
        this.status = EXPENSES_STORE_STATUS.CORRUPT;
    }
}

/**
 * @param {number} [activeYear]
 * @returns {D.ExpensesStore}
 */
export function createEmptyExpensesStore(activeYear = appNow().getFullYear()) {
    return { version: 1, activeYear, years: {} };
}

/**
 * @param {string | null} raw
 * @param {string} code
 * @param {string} message
 * @returns {Extract<D.ExpensesResult, {status: 'corrupt'}>}
 */
function createCorruptionResult(raw, code, message) {
    return {
        status: EXPENSES_STORE_STATUS.CORRUPT,
        store: null,
        raw,
        error: { code, message }
    };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {D.ExpensesStoreAlt} store
 * @param {D.ExpensesStore | null} [previous]
 */
function validateExpensesRecords(store, previous = null) {
    const assigned = new Set();
    for (const [year, yearData] of Object.entries(store.years || {})) for (const [month, data] of Object.entries(yearData.months || {})) {
        for (const [profileId, entry] of Object.entries(data.profiles || {})) {
            const old = previous?.years?.[year]?.months?.[month]?.profiles?.[profileId];
            if (!previous || JSON.stringify(entry) !== JSON.stringify(old)) {
                if (entry && Object.hasOwn(entry, 'categories') && !hasExpenseImport(entry)) {
                    throw new Error('Kategoriebeträge und Gesamtsumme müssen endlich sein. Bitte den Ausgabenbereich über die Wiederherstellung bereinigen.');
                }
                if (entry && Object.hasOwn(entry, 'plannedExpenses')) computeBudgetSpent(entry);
            }
            for (const item of entry?.plannedExpenses || []) {
                const key = JSON.stringify([item.scopeKey, item.id, item.month]);
                if (item.month !== `${year}-${String(month).padStart(2, '0')}` || assigned.has(key)) throw new Error('Doppelte oder zeitlich falsche Zuordnung geplanter Ausgaben.');
                assigned.add(key);
            }
        }
    }
}


/**
 * @param {D.RecordReader} [storage]
 * @returns {D.ExpensesResult}
 */
export function loadExpensesStoreResult(storage = persistenceStorage) {
    let raw;
    try {
        raw = storage?.getItem(EXPENSES_STORAGE_KEY);
    } catch {
        return createCorruptionResult(
            null,
            'expenses-store-read-failed',
            'Der gespeicherte Ausgabenbereich konnte nicht gelesen werden.'
        );
    }

    if (raw === null || raw === undefined) {
        return {
            status: EXPENSES_STORE_STATUS.EMPTY,
            store: createEmptyExpensesStore(),
            raw: null,
            error: null
        };
    }

    /** @type {D.ExpensesStoreAlt} */
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return createCorruptionResult(
            raw,
            'expenses-store-json-invalid',
            'Die gespeicherten Ausgabendaten enthalten kein gueltiges JSON.'
        );
    }

    if (!isRecord(parsed)) {
        return createCorruptionResult(
            raw,
            'expenses-store-root-invalid',
            'Die gespeicherten Ausgabendaten haben keinen gueltigen Objektaufbau.'
        );
    }
    if (parsed.version !== undefined && Number(parsed.version) !== 1) {
        return createCorruptionResult(
            raw,
            'expenses-store-version-unsupported',
            'Die gespeicherten Ausgabendaten verwenden eine nicht unterstuetzte Version.'
        );
    }
    if (parsed.years !== undefined && !isRecord(parsed.years)) {
        return createCorruptionResult(
            raw,
            'expenses-store-years-invalid',
            'Die gespeicherten Ausgabenjahre haben keinen gueltigen Objektaufbau.'
        );
    }

    const diagnostics = [];
    for (const [year, yearData] of Object.entries(/** @type {Record<string, D.ExpensesYearAlt>} */ (parsed.years || {}))) for (const [month, data] of Object.entries(yearData?.months || {})) {
        for (const [profileId, entry] of Object.entries(data?.profiles || {})) {
            if (entry && Object.hasOwn(entry, 'categoryNeeds') && !hasCategoryNeeds(entry)) {
                diagnostics.push({ code: 'expenses-category-needs-invalid', year, month, profileId });
            }
        }
    }
    try {
        validateExpensesRecords(parsed);
    } catch (error) { return createCorruptionResult(raw, 'expenses-planned-invalid', /** @type {I.AppError} */ (error).message); }
    const activeYear = Number(parsed.activeYear);
    /** @type {D.ExpensesStore} */
    const store = {
        ...parsed,
        version: 1,
        activeYear: Number.isFinite(activeYear) && activeYear > 0
            ? activeYear
            : appNow().getFullYear(),
        years: /** @type {Record<string, D.ExpensesYearAlt>} */ (parsed.years || {})
    };
    return {
        status: EXPENSES_STORE_STATUS.OK,
        store,
        raw,
        error: null,
        diagnostics
    };
}

/**
 * @param {D.RecordReader} [storage]
 * @returns {D.ExpensesStore}
 */
export function loadExpensesStore(storage = persistenceStorage) {
    const result = loadExpensesStoreResult(storage);
    if (result.status === EXPENSES_STORE_STATUS.CORRUPT) {
        throw new ExpensesStoreCorruptionError(result);
    }
    return /** @type {D.ExpensesStore} */ (result.store);
}

/**
 * @param {D.ExpensesStore} store
 * @param {D.RecordWriter} [storage]
 * @returns {void}
 */
export function saveExpensesStore(store, storage = persistenceStorage) {
    const current = loadExpensesStoreResult(storage);
    if (current.status === EXPENSES_STORE_STATUS.CORRUPT) {
        throw new ExpensesStoreCorruptionError(current);
    }
    validateExpensesRecords(store, current.store);
    storage?.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(store));
}

/**
 * @param {D.ExpensesResult} result
 * @param {D.ExpenseRecoveryOptions} [options]
 */
export function createExpensesCorruptionRecoveryDocument(result, options = {}) {
    if (result?.status !== EXPENSES_STORE_STATUS.CORRUPT || typeof result.raw !== 'string') {
        throw new Error('Fuer diesen Ausgabenstore stehen keine exportierbaren Korruptionsrohdaten bereit.');
    }
    return {
        appId: EXPENSES_RECOVERY_APP_ID,
        schema: EXPENSES_RECOVERY_SCHEMA,
        schemaVersion: 1,
        exportedAt: options.exportedAt || new Date().toISOString(),
        affectedArea: 'Ausgaben-Check',
        backend: String(options.backend || 'unknown'),
        corruption: {
            code: result.error?.code || 'expenses-store-corrupt',
            message: result.error?.message || 'Der Ausgabenstore ist beschaedigt.'
        },
        raw: result.raw
    };
}

/**
 * @param {D.ExpensesResult} result
 * @param {D.ExpenseRecoveryOptions} [options]
 * @returns {D.ExpensesStore}
 */
export function resetCorruptExpensesStore(result, options = {}) {
    const storage = options.storage || persistenceStorage;
    if (result?.status !== EXPENSES_STORE_STATUS.CORRUPT || typeof result.raw !== 'string') {
        throw new Error('Der Ausgabenstore kann nicht als bestaetigter Korruptionsfall zurueckgesetzt werden.');
    }
    if (options.rawPreserved !== true && !options.quarantineReference) {
        throw new Error('Vor dem Zuruecksetzen muss der korrupte Rohinhalt exportiert oder quarantiniert sein.');
    }

    const currentRaw = storage?.getItem(EXPENSES_STORAGE_KEY);
    if (currentRaw !== result.raw) {
        throw new Error('Die gespeicherten Ausgabendaten haben sich seit der Recovery-Anzeige geaendert. Bitte neu laden.');
    }

    const emptyStore = createEmptyExpensesStore(options.activeYear);
    storage?.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(emptyStore));
    return emptyStore;
}

/**
 * @param {D.ExpensesStore} store
 * @param {number | string} year
 * @returns {D.ExpensesYear}
 */
export function getExpensesYearData(store, year) {
    const key = String(year);
    if (!store.years) store.years = {};
    if (!store.years[key]) store.years[key] = { months: {} };
    if (!store.years[key].months) store.years[key].months = {};
    return /** @type {D.ExpensesYear} */ (store.years[key]);
}

/**
 * @param {D.ExpensesYearAlt} yearData
 * @param {number | string} month
 * @returns {D.ExpensesMonth}
 */
export function getExpensesMonthData(yearData, month) {
    const key = String(month);
    if (!yearData.months) yearData.months = {};
    if (!yearData.months[key]) yearData.months[key] = { profiles: {} };
    if (!yearData.months[key].profiles) yearData.months[key].profiles = {};
    return /** @type {D.ExpensesMonth} */ (yearData.months[key]);
}

/**
 * @param {number} year
 * @param {D.RecordWriter} [storage]
 * @returns {void}
 */
export function setExpensesActiveYear(year, storage = persistenceStorage) {
    const store = loadExpensesStore(storage);
    store.activeYear = year;
    getExpensesYearData(store, year);
    saveExpensesStore(store, storage);
}

/**
 * @param {D.RecordReader} [storage]
 * @param {number} [fallback]
 * @returns {number}
 */
export function resolveExpensesInitialYear(storage = persistenceStorage, fallback = appNow().getFullYear()) {
    const store = loadExpensesStore(storage);
    const activeYear = Number(store.activeYear);
    return Number.isFinite(activeYear) ? activeYear : fallback;
}

/**
 * @param {{store: D.ExpensesStore, activeYear: number, currentYear?: number}} options
 * @returns {number[]}
 */
export function listExpensesYears({ store, activeYear, currentYear = appNow().getFullYear() }) {
    const years = new Set([currentYear, activeYear]);
    Object.keys(store?.years || {}).forEach(key => {
        const val = Number(key);
        if (Number.isFinite(val)) years.add(val);
    });
    return Array.from(years).sort((a, b) => a - b);
}
