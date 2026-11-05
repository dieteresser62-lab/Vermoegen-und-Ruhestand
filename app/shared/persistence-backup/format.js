/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { PARTNERSHIP_KEY, migratePartnershipRecord } from '../../profile/household-partnership.js';
import { detectRuntime } from '../runtime-env.js';
import { PersistenceFacade } from '../persistence-facade.js';
import { isAllowedPersistenceImportKey } from '../persistence-key-policy.js';
import { FULL_BACKUP_TYPE, FULL_BACKUP_APP_ID, FULL_BACKUP_LEGACY_SCHEMA_VERSION, FULL_BACKUP_SCHEMA_VERSION, FULL_BACKUP_RECORD_SCOPE, BLOCKED_BACKUP_KEYS } from './schema.js';
import { collectStorageRecords, isPlainRecord, hasOwn, validateIsoTimestamp, recordsMatch } from './records.js';
import { validatePersistenceDomainRecords } from './domain-validation.js';

function timestampForFilename(date = new Date()) {
    return date.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
}

/**
 * @param {I.BackupOptions} [options]
 * @returns {D.FullBackup}
 */
export function buildFullPersistenceBackup(options = {}) {
    const storage = options.storage || PersistenceFacade;
    const sourceRecords = storage.exportAllSync
        ? storage.exportAllSync().records
        : collectStorageRecords(/** @type {D.RecordStorage} */ (storage));
    const records = Object.create(null);
    /** @type {string[]} */
    const excludedKeys = [];
    Object.entries(sourceRecords || {}).forEach(([key, value]) => {
        if (!isAllowedPersistenceImportKey(key)) {
            excludedKeys.push(key);
            return;
        }
        if (typeof value !== 'string') {
            throw new Error(`Persistenzwert ${key} liegt nicht im kanonischen Stringformat vor.`);
        }
        records[key] = value;
    });
    const exportedAt = new Date().toISOString();
    // HV-3: Herkunft für den Import-Hinweis; nur der Haushalt, keine weiteren Verzeichnisdaten.
    const registry = !options.storage || options.storage === PersistenceFacade ? PersistenceFacade.getHouseholds?.() : null;
    const origin = registry && registry.households.length > 1 ? registry.households.find(entry => entry.id === registry.active) : null;

    return {
        ...(origin ? { household: { id: origin.id, name: origin.name || 'Haushalt 1' } } : {}),
        backupType: FULL_BACKUP_TYPE,
        schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
        app: FULL_BACKUP_APP_ID,
        exportedAt,
        runtime: detectRuntime(options.window || globalThis.window),
        recordScope: FULL_BACKUP_RECORD_SCOPE,
        recordCount: Object.keys(records).length,
        excludedRecordCount: excludedKeys.length,
        excludedKeys: excludedKeys.sort(),
        records,
        localStorage: records
    };
}

export function createFullBackupFilename(date = new Date()) {
    return `ruhestand-suite-full-backup-${timestampForFilename(date)}.json`;
}

export function createRecoveryBackupFilename(date = new Date()) {
    return `ruhestand-suite-recovery-before-import-${timestampForFilename(date)}.json`;
}

/**
 * @param {I.BackupOptions} [options]
 * @returns {D.FullBackup}
 */
export function buildRecoveryPersistenceBackup(options = {}) {
    const backup = buildFullPersistenceBackup(options);
    return {
        ...backup,
        backupPurpose: 'recovery-before-import',
        recoveryReason: options.reason || 'before-full-import'
    };
}

/**
 * @param {unknown} payload
 * @returns {D.BackupValidation}
 */
export function normalizeFullPersistenceBackup(payload) {
    if (!isPlainRecord(payload)) {
        return { ok: false, message: 'Ungueltige Backup-Datei.' };
    }
    if (payload.backupType !== FULL_BACKUP_TYPE) {
        return { ok: false, message: 'Die Datei ist kein komplettes Backup von Vermögen & Ruhestand.' };
    }
    if (payload.app !== FULL_BACKUP_APP_ID) {
        return { ok: false, message: 'Das Backup gehoert nicht zu Vermögen & Ruhestand.' };
    }
    if (/** @type {1 | 2} */ (payload.schemaVersion) !== FULL_BACKUP_SCHEMA_VERSION
        && /** @type {1 | 2} */ (payload.schemaVersion) !== FULL_BACKUP_LEGACY_SCHEMA_VERSION) {
        return { ok: false, message: `Backup-Schema ${String(/** @type {1 | 2} */ (payload.schemaVersion))} wird nicht unterstuetzt.` };
    }
    try {
        validateIsoTimestamp(/** @type {string} */ (payload.exportedAt), 'exportedAt');
    } catch (error) {
        return { ok: false, message: /** @type {I.AppError} */ (error).message };
    }
    const isLegacy = /** @type {1 | 2} */ (payload.schemaVersion) === FULL_BACKUP_LEGACY_SCHEMA_VERSION;
    const records = isPlainRecord(payload.records)
        ? payload.records
        : (isLegacy && isPlainRecord(payload.localStorage) ? payload.localStorage : null);
    if (!records) return { ok: false, message: 'Backup enthaelt keine gueltigen Datensaetze.' };

    const sourceCount = Object.keys(records).length;
    if (!Number.isInteger(payload.recordCount) || payload.recordCount !== sourceCount) {
        return {
            ok: false,
            message: `Backup recordCount ${String(payload.recordCount)} passt nicht zu ${sourceCount} Datensaetzen.`
        };
    }
    if (payload.records !== undefined && payload.localStorage !== undefined) {
        if (!isPlainRecord(payload.localStorage) || !recordsMatch(payload.localStorage, records)) {
            return { ok: false, message: 'Der localStorage-Alias stimmt nicht mit den kanonischen Backup-Records ueberein.' };
        }
    }

    const normalizedRecords = Object.create(null);
    /** @type {string[]} */
    const excludedKeys = [];
    for (const [key, value] of Object.entries(records)) {
        const safeKey = String(key);
        if (BLOCKED_BACKUP_KEYS.has(safeKey) || !isAllowedPersistenceImportKey(safeKey)) {
            if (!isLegacy) {
                return { ok: false, message: `Backup enthaelt den nicht erlaubten Key ${safeKey}.` };
            }
            excludedKeys.push(safeKey);
            continue;
        }
        if (typeof value !== 'string') {
            return { ok: false, message: `Backupwert ${safeKey} muss als String vorliegen.` };
        }
        normalizedRecords[safeKey] = value;
    }
    const recordCount = Object.keys(normalizedRecords).length;
    const domainValidation = validatePersistenceDomainRecords(normalizedRecords);
    if (!domainValidation.ok) return /** @type {Extract<D.DomainValidation, {ok: false}>} */ (domainValidation);
    if (hasOwn(normalizedRecords, PARTNERSHIP_KEY)) {
        normalizedRecords[PARTNERSHIP_KEY] = migratePartnershipRecord(normalizedRecords[PARTNERSHIP_KEY]);
    }
    return {
        ok: true,
        backup: {
            .../** @type {D.NormalizedFullBackup} */ (/** @type {unknown} */ (payload)),
            schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
            sourceSchemaVersion: /** @type {1 | 2} */ (payload.schemaVersion),
            migrated: isLegacy,
            recordScope: FULL_BACKUP_RECORD_SCOPE,
            records: normalizedRecords,
            localStorage: normalizedRecords,
            recordCount,
            excludedRecordCount: isLegacy
                ? excludedKeys.length
                : Number.isInteger(/** @type {number} */ (payload.excludedRecordCount)) ? /** @type {number} */ (payload.excludedRecordCount) : 0,
            excludedKeys: isLegacy
                ? excludedKeys.sort()
                : (Array.isArray(payload.excludedKeys) ? payload.excludedKeys.slice() : [])
        }
    };
}
