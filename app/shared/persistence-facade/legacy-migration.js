/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { MARKER_KEY_SET, INDEXEDDB_MIGRATION_TARGET, TAURI_MIGRATION_TARGET, LEGACY_MIGRATION_MARKER_KEYS, PROBELAUF_STATE_KEY } from './state.js';

/**
 * @param {D.StringRecords} records
 * @returns {string}
 */
export function simpleChecksum(records) {
    const json = JSON.stringify(Object.keys(records).sort().map(key => [key, records[key]]));
    let hash = 0;
    for (let i = 0; i < json.length; i += 1) {
        hash = ((hash << 5) - hash + json.charCodeAt(i)) | 0;
    }
    return String(hash >>> 0);
}

export async function collectAllowedLegacyRecords(storage = globalThis.localStorage) {
    const { listAllowedPersistenceImportKeys } = await import("../persistence-key-policy.js");
    const records = Object.create(null);
    listAllowedPersistenceImportKeys(storage).forEach(key => {
        if (MARKER_KEY_SET.has(key)) return;
        const value = storage.getItem(key);
        if (value !== null && value !== undefined) records[key] = String(value);
    });
    return records;
}

/**
 * @param {import('../../../typcheck/runtime-contracts.js').PersistenceAdapter} activeAdapter
 */
export function getMigrationTargetForAdapter(activeAdapter) {
    if (activeAdapter?.name === 'IndexedDB') return INDEXEDDB_MIGRATION_TARGET;
    if (activeAdapter?.name === 'Tauri JSON File') return TAURI_MIGRATION_TARGET;
    return null;
}

/**
 * @param {import('../../../typcheck/runtime-contracts.js').PersistenceAdapter} activeAdapter
 * @param {D.StringRecords} loadedRecords
 * @param {I.InitOptions} [options]
 */
export async function migrateLegacyLocalStorageToTargetIfNeeded(activeAdapter, loadedRecords, options = {}) {
    const migrationTarget = getMigrationTargetForAdapter(activeAdapter);
    if (!migrationTarget) return { records: loadedRecords, warning: null };
    const storage = options.localStorage || globalThis.localStorage;
    if (!storage) return { records: loadedRecords, warning: null };

    const legacyRecords = await collectAllowedLegacyRecords(/** @type {Storage} */ (storage));
    const hasTargetRecords = Object.keys(loadedRecords).length > 0;
    const hasLegacyRecords = Object.keys(legacyRecords).length > 0;
    const migratedTarget = storage.getItem(LEGACY_MIGRATION_MARKER_KEYS.target);

    if (!hasTargetRecords && storage.getItem(PROBELAUF_STATE_KEY) !== null) {
        throw new Error('Spielbereich-Recovery: Der aktive LocalStorage-Rückkehrpunkt darf nicht automatisch in einen anderen Speicher migriert werden.');
    }

    if (hasTargetRecords || !hasLegacyRecords) {
        return { records: loadedRecords, warning: null };
    }

    if (migratedTarget === migrationTarget) {
        return {
            records: loadedRecords,
            warning: {
                code: `${migrationTarget}-empty-after-migration`,
                message: `${activeAdapter.name} ist leer, obwohl bereits eine Migration markiert wurde. Veraltete localStorage-Daten wurden nicht automatisch erneut eingespielt.`
            }
        };
    }

    await activeAdapter.saveBatch({
        upserts: Object.entries(legacyRecords),
        deletes: []
    });
    const checksum = simpleChecksum(legacyRecords);
    storage.setItem(LEGACY_MIGRATION_MARKER_KEYS.target, migrationTarget);
    storage.setItem(LEGACY_MIGRATION_MARKER_KEYS.completedAt, new Date().toISOString());
    storage.setItem(LEGACY_MIGRATION_MARKER_KEYS.checksum, checksum);
    await activeAdapter.writeMetadata?.('legacyMigration', {
        target: migrationTarget,
        completedAt: new Date().toISOString(),
        checksum,
        recordCount: Object.keys(legacyRecords).length
    });

    return {
        records: await activeAdapter.loadAll(),
        warning: null
    };
}
