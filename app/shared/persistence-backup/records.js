/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { persistenceStorage, PersistenceFacade } from '../persistence-facade.js';
import { isAllowedPersistenceImportKey } from '../persistence-key-policy.js';

/**
 * @param {Pick<D.RecordStorage, 'getItem' | 'key' | 'length'>} storage
 * @returns {D.StringRecords}
 */
export function collectStorageRecords(storage) {
    const records = Object.create(null);
    for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key) continue;
        const value = storage.getItem(key);
        if (value === null || value === undefined) continue;
        if (typeof value !== 'string') {
            throw new Error(`Persistenzwert ${key} liegt nicht im kanonischen Stringformat vor.`);
        }
        records[key] = value;
    }
    return records;
}

export function collectImportDecisionRecords() {
    const records = collectStorageRecords(persistenceStorage);
    // Der localStorage-Fallback legt die eigene Importsicherung im Archiv ab.
    // Das Archiv gehört nicht zum Livebestand und wird nicht ersetzt.
    delete records.rs_snapshot_archive_v1;
    return records;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {PropertyKey} key
 * @returns {boolean}
 */
export function hasOwn(value, key) {
    return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * @param {D.StringRecords} records
 */
export function createRecordsStorage(records) {
    const keys = Object.keys(records || {});
    return {
        /** @param {string} key */
        getItem(key) {
            return hasOwn(records, key) ? records[key] : null;
        },
        /** @param {number} index */
        key(index) {
            return keys[index] || null;
        },
        get length() {
            return keys.length;
        }
    };
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {void}
 */
export function validateIsoTimestamp(value, path) {
    if (typeof value !== 'string' || !value) {
        throw new Error(`${path} fehlt oder ist kein String.`);
    }
    const timestamp = new Date(value);
    if (!Number.isFinite(timestamp.getTime())) {
        throw new Error(`${path} ist kein gueltiger Zeitstempel.`);
    }
}

/**
 * @param {Record<string, unknown>} left
 * @param {Record<string, unknown>} right
 * @returns {boolean}
 */
export function recordsMatch(left, right) {
    const leftKeys = Object.keys(left || {}).sort();
    const rightKeys = Object.keys(right || {}).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

/**
 * @param {I.Facade} [persistence]
 * @returns {D.StringRecords}
 */
export function collectAllowedFacadeRecords(persistence = PersistenceFacade) {
    const exported = persistence.exportAllSync();
    const records = Object.create(null);
    Object.entries(exported?.records || {}).forEach(([key, value]) => {
        if (!isAllowedPersistenceImportKey(key)) return;
        if (typeof value !== 'string') {
            throw new Error(`Persistenzwert ${key} liegt nicht im kanonischen Stringformat vor.`);
        }
        records[key] = value;
    });
    return records;
}
