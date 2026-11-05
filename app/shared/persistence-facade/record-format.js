/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { LOCAL_SNAPSHOT_ARCHIVE_SCHEMA_VERSION, storeState } from './state.js';

/**
 * @param {unknown} obj
 * @param {PropertyKey} key
 * @returns {boolean}
 */
export function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * @param {unknown} records
 * @returns {D.StringRecords}
 */
export function toNullPrototypeRecords(records) {
    const normalized = Object.create(null);
    if (!records || typeof records !== 'object') return normalized;
    Object.entries(records).forEach(([key, value]) => {
        if (value === null || value === undefined) return;
        normalized[String(key)] = String(value);
    });
    return normalized;
}

/**
 * @param {unknown} raw
 * @returns {D.SnapshotListArchive}
 */
export function normalizeSnapshotListArchive(raw) {
    if (!raw) {
        return {
            schemaVersion: LOCAL_SNAPSHOT_ARCHIVE_SCHEMA_VERSION,
            savedAt: '',
            snapshots: []
        };
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Snapshot-Archiv ist ungueltig.');
    }
    if (Number(parsed.schemaVersion) !== LOCAL_SNAPSHOT_ARCHIVE_SCHEMA_VERSION) {
        throw new Error(`Snapshot-Archiv-Schema ${parsed.schemaVersion} wird nicht unterstuetzt.`);
    }
    if (!Array.isArray(parsed.snapshots)) {
        throw new Error('Snapshot-Archiv enthaelt keine gueltige Snapshot-Liste.');
    }
    return {
        schemaVersion: LOCAL_SNAPSHOT_ARCHIVE_SCHEMA_VERSION,
        savedAt: parsed.savedAt ? String(parsed.savedAt) : '',
        snapshots: parsed.snapshots.filter(/** @param {unknown} snapshot */ snapshot => snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot))
    };
}

/**
 * @param {D.Snapshot[]} snapshots
 * @returns {string}
 */
export function serializeSnapshotListArchive(snapshots) {
    return JSON.stringify({
        schemaVersion: LOCAL_SNAPSHOT_ARCHIVE_SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        snapshots
    });
}

/**
 * @param {D.Snapshot} snapshot
 * @returns {Omit<D.Snapshot, 'records'>}
 */
export function toSnapshotArchiveIndexEntry(snapshot) {
    const { records, ...indexEntry } = snapshot || {};
    return /** @type {Omit<D.Snapshot, 'records'>} */ (indexEntry);
}

export function isLocalStorageFallbackAdapter(activeAdapter = storeState.adapter) {
    return activeAdapter?.name === 'localStorage';
}

/** @template {keyof import('../../../typcheck/runtime-contracts.js').PersistenceAdapter} K
 * @param {K} methodName
 * @returns {NonNullable<import('../../../typcheck/runtime-contracts.js').PersistenceAdapter[K]>}
 */
export function requireAdapterMethod(methodName) {
    const method = storeState.adapter?.[methodName];
    if (typeof method !== 'function') {
        throw new Error(`Aktiver Persistenzadapter unterstuetzt ${methodName}() nicht.`);
    }
    return /** @type {NonNullable<import('../../../typcheck/runtime-contracts.js').PersistenceAdapter[K]>} */ (method.bind(storeState.adapter));
}
