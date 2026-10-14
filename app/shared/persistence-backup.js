// @ts-check
import { HOUSEHOLD_PLAN_KEY, assertHouseholdPlanRecord } from '../profile/household-plan.js';
import { ANNUAL_PLAN_RECORD_KEY, assertAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { DATA_BACKUP_SUMMARY_KEY, assertBackupSummary, buildBackupSummary } from '../data/data-backup-summary.js';
import { requestPageConfirmation } from './page-dialog.js';
import { OVERVIEW_SIMULATION_KEY, assertSimulationRecord } from '../overview/overview-simulation-summary.js';
import { PERSON_VALUE_KEYS, validatePersonValues } from '../profile/profile-person-data.js';
import { PROFILE_CASH_HISTORY_KEY, PROFILE_WEALTH_LOTS_KEY, assertCashHistory, assertWealthLots } from '../profile/profile-wealth-history.js';
import { WEALTH_HISTORY_START_KEY, DAILY_PRICES_KEY, assertHistoryStart, assertDailyPrices, requireHistoryRecord, historyDay } from '../tranches/tranchen-history-store.js';
import { OVERVIEW_BACKUP_KEY } from '../overview/overview-storage.js';
import { persistenceStorage } from './persistence-facade.js';

import { createNavigationGuard, createNavigationOperationLifecycle } from './navigation-guard.js';
import { getPageNavigationGuard } from './navigation-guard-dialog.js';
import { detectRuntime } from './runtime-env.js';
import { PersistenceFacade } from './persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from './snapshot-archive.js';
import { PROBELAUF_STATE_KEY, isAllowedPersistenceImportKey, isSnapshotTechnicalKey } from './persistence-key-policy.js';
import { getAppTestDate } from './app-clock.js';
import {
    PROFILE_HEALTH_BUCKET_KEY,
    PROFILE_CASH_CONFIRMED_DATE_KEY,
    PROFILE_LOAD_STATUS,
    PROFILE_STORAGE_KEYS,
    PROFILE_TRANCHES_KEY,
    PROFILE_VALUE_KEYS,
    loadProfileHealthBucketFromData,
    loadStoredBalanceStateFromData,
    parseStoredBool,
    parseStoredNumber
} from '../profile/profile-state.js';
import { isProfileScopedKey } from '../profile/profile-key-policy.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import {
    EXPENSES_STORAGE_KEY,
    EXPENSES_STORE_STATUS,
    loadExpensesStoreResult
} from '../balance/balance-expenses-storage.js';
import { CONFIG } from '../balance/balance-config.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { assertCumulativeInflationFactor } from '../../types/cumulative-inflation-contract.js';

export const FULL_BACKUP_TYPE = 'ruhestand-suite-full-persistence-backup';
export const FULL_BACKUP_APP_ID = 'ruhestand-suite';
export const FULL_BACKUP_LEGACY_SCHEMA_VERSION = 1;
export const FULL_BACKUP_SCHEMA_VERSION = 2;
export const FULL_BACKUP_RECOVERY_KIND = SNAPSHOT_KINDS.fullBackupImportRecovery;
export const PROBELAUF_BACKUP_MESSAGE = 'Vollsicherung und Import sind während des Probelaufs gesperrt. Bitte zuerst den Probelauf beenden.';
const PROBELAUF_BACKUP_STATE_UNAVAILABLE_MESSAGE = 'Vollsicherung und Import gesperrt: Probelauf-Zustand konnte nicht sicher gelesen werden. Bitte neu laden.';

// Nur der lokale Bestandsvergleich darf diesen Hinweis auslösen, keine Backendmeldung.
class FullBackupLiveChangedError extends Error {
    constructor() {
        super('Der Livebestand hat sich nach der Importsicherung geändert. Bitte erneut importieren.');
    }
}

/** Jeder Steuerrecord sperrt, auch beschädigte oder noch nicht aktive Phasen. */
export async function assertFullBackupAllowed(options = {}) {
    const persistence = options.persistence || PersistenceFacade;
    const check = () => {
        const coordinator = options.probelaufController;
        if (getAppTestDate() !== null || coordinator?.state || coordinator?.busy || coordinator?.blocked
            || persistence.getItemSync(PROBELAUF_STATE_KEY) !== null) {
            const error = new Error(PROBELAUF_BACKUP_MESSAGE);
            error.code = 'probelauf_backup_blocked';
            throw error;
        }
    };
    check();
    let records;
    try {
        records = await persistence.readPersistedRecords(key => key === PROBELAUF_STATE_KEY);
    } catch (cause) {
        const error = new Error(PROBELAUF_BACKUP_STATE_UNAVAILABLE_MESSAGE);
        error.code = 'probelauf_backup_state_unavailable';
        error.cause = cause;
        throw error;
    }
    check();
    if (hasOwn(records, PROBELAUF_STATE_KEY)) {
        const error = new Error(PROBELAUF_BACKUP_MESSAGE);
        error.code = 'probelauf_backup_blocked';
        throw error;
    }
}
const FULL_BACKUP_RECORD_SCOPE = 'authorized-application-records';
const BLOCKED_BACKUP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PROFILE_SELECTOR_KEYS = [
    PROFILE_STORAGE_KEYS.current,
    PROFILE_STORAGE_KEYS.active
];
const PROFILE_NUMBER_KEYS = new Set([
    PROFILE_VALUE_KEYS.tagesgeld,
    PROFILE_VALUE_KEYS.renteMonatlich,
    PROFILE_VALUE_KEYS.sonstigeEinkuenfte,
    PROFILE_VALUE_KEYS.alter,
    PROFILE_VALUE_KEYS.goldZiel,
    PROFILE_VALUE_KEYS.goldFloor,
    PROFILE_VALUE_KEYS.goldRebalBand
]);
const PROFILE_BOOLEAN_KEYS = new Set([
    PROFILE_VALUE_KEYS.renteAktiv,
    PROFILE_VALUE_KEYS.goldAktiv,
    PROFILE_VALUE_KEYS.goldSteuerfrei
]);

function timestampForFilename(date = new Date()) {
    return date.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
}

function collectStorageRecords(storage) {
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

function isPlainRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function createRecordsStorage(records) {
    const keys = Object.keys(records || {});
    return {
        getItem(key) {
            return hasOwn(records, key) ? records[key] : null;
        },
        key(index) {
            return keys[index] || null;
        },
        get length() {
            return keys.length;
        }
    };
}

function invalidDomain(code, message, error = null) {
    return {
        ok: false,
        code,
        message,
        ...(error ? { error } : {})
    };
}

function validateIsoTimestamp(value, path) {
    if (typeof value !== 'string' || !value) {
        throw new Error(`${path} fehlt oder ist kein String.`);
    }
    const timestamp = new Date(value);
    if (!Number.isFinite(timestamp.getTime())) {
        throw new Error(`${path} ist kein gueltiger Zeitstempel.`);
    }
}

function validateBalanceInflationState(balanceState, path) {
    const lastState = balanceState?.lastState;
    if (!isPlainRecord(lastState) || !hasOwn(lastState, 'cumulativeInflationFactor')) return;
    assertCumulativeInflationFactor(lastState.cumulativeInflationFactor, {
        path: `${path}.lastState.cumulativeInflationFactor`
    });
}

function validateStoredTranches(data, path) {
    if (!hasOwn(data, PROFILE_TRANCHES_KEY)) return;
    const raw = data[PROFILE_TRANCHES_KEY];
    if (typeof raw !== 'string') {
        throw new Error(`${path}.${PROFILE_TRANCHES_KEY} muss als JSON-String vorliegen.`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`${path}.${PROFILE_TRANCHES_KEY} enthaelt ungueltiges JSON.`);
    }
    normalizeTrancheCollection(parsed, { mode: 'persisted' });
}

function validateProfileScalarValues(data, path) {
    if (hasOwn(data, PROFILE_CASH_CONFIRMED_DATE_KEY)) historyDay(data[PROFILE_CASH_CONFIRMED_DATE_KEY]);
    if (data[PERSON_VALUE_KEYS.personSchemaVersion] !== undefined) {
        if (data[PERSON_VALUE_KEYS.personSchemaVersion] !== '1') throw new Error(`${path}: unbekannte Personenversion.`);
        validatePersonValues(Object.fromEntries(Object.entries(PERSON_VALUE_KEYS).map(([field, key]) => [field, data[key]])));
        if (data[PERSON_VALUE_KEYS.personMigration]) {
            const metadata = JSON.parse(data[PERSON_VALUE_KEYS.personMigration]);
            if (!isPlainRecord(metadata) || !Number.isSafeInteger(metadata.referenceYear)) throw new Error(`${path}: ungültige Personenherkunft.`);
        }
    }

    Object.entries(data).forEach(([key, value]) => {
        if (PROFILE_NUMBER_KEYS.has(key) && parseStoredNumber(value, null) === null) {
            throw new Error(`${path}.${key} enthaelt keine endliche Zahl.`);
        }
        if (PROFILE_BOOLEAN_KEYS.has(key) && parseStoredBool(value, null) === null) {
            throw new Error(`${path}.${key} enthaelt keinen gueltigen Booleanwert.`);
        }
    });
}

function validateProfileData(data, path, { allowHistoricalTechnicalKeys = false } = {}) {
    if (!isPlainRecord(data)) {
        throw new Error(`${path} ist kein gueltiges Profildatenobjekt.`);
    }
    Object.entries(data).forEach(([key, value]) => {
        // Nur verschachtelte Registrydaten dürfen historische technische Strings behalten.
        if (BLOCKED_BACKUP_KEYS.has(key) || (!isProfileScopedKey(key)
            && !(allowHistoricalTechnicalKeys && isSnapshotTechnicalKey(key)))) {
            throw new Error(`${path}.${key} ist kein erlaubter profilbezogener Key.`);
        }
        if (typeof value !== 'string') {
            throw new Error(`${path}.${key} muss als String vorliegen.`);
        }
    });

    const healthResult = loadProfileHealthBucketFromData(data);
    if (healthResult.status === PROFILE_LOAD_STATUS.CORRUPT
        || healthResult.status === PROFILE_LOAD_STATUS.UNAVAILABLE) {
        throw new Error(healthResult.error?.message || `${path}.${PROFILE_HEALTH_BUCKET_KEY} ist ungueltig.`);
    }

    const balanceResult = loadStoredBalanceStateFromData(data);
    if (balanceResult.status === PROFILE_LOAD_STATUS.CORRUPT
        || balanceResult.status === PROFILE_LOAD_STATUS.UNAVAILABLE) {
        throw new Error(`${path}.${CONFIG.STORAGE.LS_KEY}: ${balanceResult.error?.message || 'Der Balance-State ist ungueltig.'}`);
    }
    if (balanceResult.value) {
        validateBalanceInflationState(balanceResult.value, `${path}.${CONFIG.STORAGE.LS_KEY}`);
    }

    for (const [key, validator] of [[PROFILE_CASH_HISTORY_KEY, assertCashHistory], [PROFILE_WEALTH_LOTS_KEY, assertWealthLots]]) {
        if (hasOwn(data, key)) requireHistoryRecord(data[key], validator);
    }
    if (hasOwn(data, OVERVIEW_SIMULATION_KEY)) assertSimulationRecord(data[OVERVIEW_SIMULATION_KEY]);
    validateStoredTranches(data, path);
    validateProfileScalarValues(data, path);
}

function validateRegistryAndProfiles(records, options = {}) {
    const storage = createRecordsStorage(records);
    const registryResult = loadProfileRegistry(storage);
    if (registryResult.status === PROFILE_LOAD_STATUS.CORRUPT
        || registryResult.status === PROFILE_LOAD_STATUS.UNAVAILABLE) {
        throw new Error(registryResult.error?.message || 'Die Profilregistry ist ungueltig.');
    }

    const registryPresent = hasOwn(records, PROFILE_STORAGE_KEYS.registry);
    const registry = registryResult.value || { version: 1, profiles: {} };
    if (options.requireProfileContext && !registryPresent) {
        throw new Error('Die Profilregistry fehlt.');
    }

    Object.entries(registry.profiles || {}).forEach(([profileId, profile]) => {
        const meta = profile.meta || {};
        if (meta.createdAt !== undefined) validateIsoTimestamp(meta.createdAt, `registry.profiles.${profileId}.meta.createdAt`);
        if (meta.updatedAt !== undefined) validateIsoTimestamp(meta.updatedAt, `registry.profiles.${profileId}.meta.updatedAt`);
        validateProfileData(profile.data, `registry.profiles.${profileId}.data`, { allowHistoricalTechnicalKeys: true });
    });

    PROFILE_SELECTOR_KEYS.forEach(key => {
        if (!hasOwn(records, key)) {
            if (options.requireProfileContext) {
                throw new Error(`${key} fehlt.`);
            }
            return;
        }
        const profileId = records[key];
        if (!profileId || !hasOwn(registry.profiles, profileId)) {
            throw new Error(`${key} verweist auf das nicht vorhandene Profil ${profileId || '<leer>'}.`);
        }
    });
    return registry;
}

function validateLiveDomains(records) {
    const liveProfileData = Object.create(null);
    Object.entries(records).forEach(([key, value]) => {
        if (isProfileScopedKey(key)) liveProfileData[key] = value;
    });
    validateProfileData(liveProfileData, 'records');

    if (hasOwn(records, EXPENSES_STORAGE_KEY)) {
        const expensesResult = loadExpensesStoreResult(createRecordsStorage(records));
        if (expensesResult.status === EXPENSES_STORE_STATUS.CORRUPT) {
            throw new Error(expensesResult.error?.message || 'Der Ausgabenstore ist ungueltig.');
        }
    }
}

export function validatePersistenceDomainRecords(records, options = {}) {
    if (!isPlainRecord(records)) {
        return invalidDomain('records_invalid', 'Persistenz-Records muessen ein Objekt sein.');
    }
    try {
        Object.entries(records).forEach(([key, value]) => {
            if (BLOCKED_BACKUP_KEYS.has(key) || !isAllowedPersistenceImportKey(key)) {
                throw new Error(`Persistenz-Key ${key} ist nicht erlaubt.`);
            }
            if (typeof value !== 'string') {
                throw new Error(`Persistenzwert ${key} muss als String vorliegen.`);
            }
        });
        for (const [key, validator] of [[WEALTH_HISTORY_START_KEY, assertHistoryStart], [DAILY_PRICES_KEY, assertDailyPrices]]) {
            if (hasOwn(records, key)) requireHistoryRecord(records[key], validator);
        }
        if (hasOwn(records, DATA_BACKUP_SUMMARY_KEY)) {
            const summary = assertBackupSummary(JSON.parse(records[DATA_BACKUP_SUMMARY_KEY]));
            if (hasOwn(records, OVERVIEW_BACKUP_KEY) && summary.exportedAt !== records[OVERVIEW_BACKUP_KEY]) throw new Error('Sicherungszeit und Vergleichsbasis widersprechen sich.');
        }
        for (const [key, validator] of [[HOUSEHOLD_PLAN_KEY, assertHouseholdPlanRecord], [ANNUAL_PLAN_RECORD_KEY, assertAnnualPlanRecord]]) {
            if (hasOwn(records, key)) validator(records[key]);
        }
        const registry = validateRegistryAndProfiles(records, options);
        validateLiveDomains(records);
        return { ok: true, records, registry };
    } catch (error) {
        return invalidDomain(
            error?.code || 'domain_validation_failed',
            error?.message || 'Persistenzdaten sind fachlich ungueltig.',
            error
        );
    }
}

function recordsMatch(left, right) {
    const leftKeys = Object.keys(left || {}).sort();
    const rightKeys = Object.keys(right || {}).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function collectAllowedFacadeRecords(persistence = PersistenceFacade) {
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

export function buildFullPersistenceBackup(options = {}) {
    const storage = options.storage || PersistenceFacade;
    const sourceRecords = storage.exportAllSync
        ? storage.exportAllSync().records
        : collectStorageRecords(storage);
    const records = Object.create(null);
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

    return {
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

export function buildRecoveryPersistenceBackup(options = {}) {
    const backup = buildFullPersistenceBackup(options);
    return {
        ...backup,
        backupPurpose: 'recovery-before-import',
        recoveryReason: options.reason || 'before-full-import'
    };
}

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
    if (payload.schemaVersion !== FULL_BACKUP_SCHEMA_VERSION
        && payload.schemaVersion !== FULL_BACKUP_LEGACY_SCHEMA_VERSION) {
        return { ok: false, message: `Backup-Schema ${String(payload.schemaVersion)} wird nicht unterstuetzt.` };
    }
    try {
        validateIsoTimestamp(payload.exportedAt, 'exportedAt');
    } catch (error) {
        return { ok: false, message: error.message };
    }
    const isLegacy = payload.schemaVersion === FULL_BACKUP_LEGACY_SCHEMA_VERSION;
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
    if (!domainValidation.ok) return domainValidation;
    return {
        ok: true,
        backup: {
            ...payload,
            schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
            sourceSchemaVersion: payload.schemaVersion,
            migrated: isLegacy,
            recordScope: FULL_BACKUP_RECORD_SCOPE,
            records: normalizedRecords,
            localStorage: normalizedRecords,
            recordCount,
            excludedRecordCount: isLegacy
                ? excludedKeys.length
                : Number.isInteger(payload.excludedRecordCount) ? payload.excludedRecordCount : 0,
            excludedKeys: isLegacy
                ? excludedKeys.sort()
                : (Array.isArray(payload.excludedKeys) ? payload.excludedKeys.slice() : [])
        }
    };
}

export function downloadJsonFile(data, filename, doc = globalThis.document) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    doc.body.appendChild(anchor);
    try { anchor.click(); }
    finally { anchor.remove(); URL.revokeObjectURL(url); }
}

export async function downloadFullPersistenceBackup(options = {}) {
    const persistence = options.persistence || PersistenceFacade;
    const lifecycle = createNavigationOperationLifecycle({ guard: options.guard ?? (globalThis.document ? getPageNavigationGuard(options.document) : null) });
    return lifecycle.run(options, async navigationOperation => {
        await assertFullBackupAllowed({ ...options, persistence });
        const preflight = validatePersistenceDomainRecords(buildFullPersistenceBackup({ ...options, storage: options.storage || persistence }).records);
        if (!preflight.ok) throw new Error(preflight.message);
        if (await persistence.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        navigationOperation.check();
        await assertFullBackupAllowed({ ...options, persistence });
        const backup = buildFullPersistenceBackup({ ...options, storage: options.storage || persistence });
        if (backup.recordCount === 0) throw new Error('Keine gespeicherten Daten fuer ein Backup gefunden.');
        const validation = validatePersistenceDomainRecords(backup.records);
        if (!validation.ok) throw new Error(validation.message);
        const metadataKeys = [OVERVIEW_BACKUP_KEY, DATA_BACKUP_SUMMARY_KEY];
        const previous = Object.fromEntries(metadataKeys.filter(key => persistence.getItemSync(key) !== null)
            .map(key => [key, persistence.getItemSync(key)]));
        const summary = await buildBackupSummary(backup.records, backup.exportedAt);
        navigationOperation.check();
        await assertFullBackupAllowed({ ...options, persistence });
        const metadata = { [OVERVIEW_BACKUP_KEY]: backup.exportedAt, [DATA_BACKUP_SUMMARY_KEY]: JSON.stringify(summary) };
        Object.assign(backup.records, metadata);
        backup.recordCount = Object.keys(backup.records).length;
        const filename = options.filename || createFullBackupFilename();
        const delivered = await (options.download || downloadJsonFile)(backup, filename, options.document || globalThis.document);
        if (delivered === false) throw new Error('Dateiausgabe wurde nicht bestätigt.');
        navigationOperation.check();
        await assertFullBackupAllowed({ ...options, persistence });
        try {
            if (await persistence.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            await assertFullBackupAllowed({ ...options, persistence });
            // Enge bestätigte Transaktion: Zeit und Basis gemeinsam, ohne übrige Fachdaten zu ersetzen.
            await persistence.replaceRecordsTransactional(metadata, {
                allowKey: key => metadataKeys.includes(key), expectedRecords: previous, navigationOperation
            });
        } catch (error) {
            throw new Error(`Backup-Dateiausgabe angestoßen; Sicherungszeit und Vergleichsbasis konnten nicht dauerhaft bestätigt werden. ${error?.message || ''}`);
        }
        options.document?.dispatchEvent?.(new (options.document.defaultView?.Event || Event)('overview-backup-changed'));
        return { filename, backup };
    });
}

export async function downloadRecoveryPersistenceBackup(options = {}) {
    await assertFullBackupAllowed(options);
    if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    await assertFullBackupAllowed(options);
    const backup = buildRecoveryPersistenceBackup(options);
    if (backup.recordCount === 0) {
        return { filename: null, backup, skipped: true };
    }
    const filename = options.filename || createRecoveryBackupFilename();
    downloadJsonFile(backup, filename, options.document || globalThis.document);
    return { filename, backup, skipped: false };
}

async function prepareFullBackupRecovery(persistence, snapshotStorage, navigationOperation, options = {}) {
    await assertFullBackupAllowed({ ...options, persistence });
    navigationOperation.check();
    if (await persistence.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    await assertFullBackupAllowed({ ...options, persistence });
    navigationOperation.check();
    const previousRecords = collectAllowedFacadeRecords(persistence);
    const activeProfileId = previousRecords[PROFILE_STORAGE_KEYS.active]
        || previousRecords[PROFILE_STORAGE_KEYS.current]
        || '';
    const recovery = await SnapshotArchive.createSnapshot({
        label: `Vollbackup-Import Recovery ${new Date().toISOString()}`,
        kind: FULL_BACKUP_RECOVERY_KIND,
        records: previousRecords,
        activeProfileId,
        restoreScope: {
            profileRegistryMode: 'replace-all-rollback',
            profileLiveDataMode: 'replace-all-rollback'
        }
    }, { storage: snapshotStorage, navigationOperation });
    const confirmedRecovery = await SnapshotArchive.readSnapshot(recovery.id, {
        storage: snapshotStorage
    });
    const recoverySnapshotId = confirmedRecovery.id;
    navigationOperation.check();
    if (!recordsMatch(previousRecords, confirmedRecovery.records)) {
        const error = new Error('Import abgebrochen: Der Wiederherstellungspunkt stimmt nicht mit dem aktuellen Stand überein. Bitte in Daten & Sicherung › Wiederherstellungspunkte prüfen.');
        error.code = 'recovery_snapshot_mismatch';
        error.recoverySnapshotId = recoverySnapshotId;
        throw error;
    }

    return { recoverySnapshotId, previousRecords };
}

function fullBackupImportErrorMessage(error, code) {
    if (error instanceof FullBackupLiveChangedError) return error.message;
    switch (code) {
        case 'probelauf_backup_blocked':
            return PROBELAUF_BACKUP_MESSAGE;
        case 'probelauf_backup_state_unavailable':
            return PROBELAUF_BACKUP_STATE_UNAVAILABLE_MESSAGE;
        case 'restore_rolled_back':
            return 'Die Sicherung konnte nicht eingespielt werden. Dein bisheriger Stand ist unverändert.';
        case 'rollback_failed':
            return 'Die Sicherung konnte nicht vollständig eingespielt werden. Die Wiederherstellung deines bisherigen Stands konnte nicht bestätigt werden.';
        case 'recovery_snapshot_mismatch':
            return 'Der Import wurde vor dem Ersetzen abgebrochen. Der Wiederherstellungspunkt stimmt nicht mit dem aktuellen Stand überein. Bitte den Punkt vor einer Wiederherstellung prüfen.';
        default:
            return 'Die Sicherung konnte nicht eingespielt werden. Bitte den aktuellen Stand prüfen und den Import erneut versuchen.';
    }
}

export async function importFullPersistenceBackup(payload, options = {}) {
    const normalized = normalizeFullPersistenceBackup(payload);
    if (!normalized.ok) return normalized;
    const backup = normalized.backup;
    if (backup.recordCount === 0) {
        return { ok: false, message: 'Backup enthaelt keine gespeicherten Daten.' };
    }
    const persistence = options.persistence || PersistenceFacade;
    const snapshotStorage = options.snapshotStorage || persistence;
    let recoverySnapshotId = '';
    const lifecycle = createNavigationOperationLifecycle({ guard: options.guard ?? (globalThis.document ? getPageNavigationGuard() : null) });
    try {
        return await lifecycle.run(options, async navigationOperation => {
            await assertFullBackupAllowed({ ...options, persistence });
            navigationOperation.check();
            const preparedRecovery = options.preparedRecovery
                || await prepareFullBackupRecovery(persistence, snapshotStorage, navigationOperation, options);
            recoverySnapshotId = preparedRecovery.recoverySnapshotId;
            await assertFullBackupAllowed({ ...options, persistence });
            navigationOperation.check();
            if (!recordsMatch(preparedRecovery.previousRecords, collectAllowedFacadeRecords(persistence))) {
                throw new FullBackupLiveChangedError();
            }

            navigationOperation.commit();
            const result = await persistence.replaceRecordsTransactional(backup.records, {
                allowKey: isAllowedPersistenceImportKey, navigationOperation,
                postValidate(records) {
                    const domainValidation = validatePersistenceDomainRecords(records);
                    if (!domainValidation.ok) return domainValidation;
                    if (typeof options.validateAfterLoad === 'function') {
                        return options.validateAfterLoad(records, backup);
                    }
                    return domainValidation;
                }
        });
        return {
            ok: true,
            message: `Komplettes Backup importiert (${backup.recordCount} Eintraege${backup.migrated ? ', Schema 1 migriert' : ''}).`,
            backup,
            recoverySnapshotId,
            restore: result
        };
        });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        recoverySnapshotId ||= error?.recoverySnapshotId || '';
        const code = error?.code || 'full_backup_import_failed';
        const message = fullBackupImportErrorMessage(error, code);
        const recoveryHint = recoverySnapshotId
            ? ' Ein Wiederherstellungspunkt wurde angelegt. Du findest ihn in Daten & Sicherung › Wiederherstellungspunkte.'
                + (code === 'rollback_failed' ? ' Bitte deinen bisherigen Stand von dort wiederherstellen.' : '')
            : code === 'rollback_failed' ? ' Bitte deinen bisherigen Stand aus einer vorhandenen Sicherung wiederherstellen.' : '';
        return {
            ok: false,
            code,
            message: `${message}${recoveryHint}`,
            recoverySnapshotId: recoverySnapshotId || null,
            rollbackError: error?.rollbackError || null
        };
    }
}

function showBackupError(status, error, doc) {
    if (!status) return;
    status.dataset.kind = error?.name === 'AbortError' ? '' : 'error';
    status.textContent = error?.name === 'AbortError' ? 'Import abgebrochen.' : error?.message || 'Backupaktion fehlgeschlagen.';
    if (status.textContent.includes('Probelauf')) {
        const card = doc.getElementById?.('daten-sicherung');
        if (card) card.open = true;
    }
}

export function bindFullBackupButton(options = {}) {
    const doc = options.document || globalThis.document;
    const button = options.button || doc.getElementById('fullBackupBtn');
    const status = options.status || doc.getElementById('fullBackupStatus');
    if (!button) return false;

    button.addEventListener('click', async () => {
        button.disabled = true;
        if (status) {
            status.dataset.kind = '';
            status.textContent = 'Backup wird erstellt...';
        }
        try {
            const { backup } = await downloadFullPersistenceBackup({ ...options, document: doc });
            if (status) {
                status.dataset.kind = 'ok';
                const excludedText = backup.excludedRecordCount
                    ? ` ${backup.excludedRecordCount} UI-/Layout-Einstellungen sind nicht enthalten.`
                    : '';
                status.textContent = `Komplettes fachliches Backup erstellt (${backup.recordCount} Eintraege). Dateiausgabe der Vollsicherung angestoßen.${excludedText}`;
            }
        } catch (err) {
            showBackupError(status, err, doc);
        } finally {
            button.disabled = false;
        }
    });

    return true;
}

export function bindFullBackupImport(options = {}) {
    const doc = options.document || globalThis.document;
    const button = options.button || doc.getElementById('fullBackupImportBtn');
    const fileInput = options.fileInput || doc.getElementById('fullBackupImportFile');
    const status = options.status || doc.getElementById('fullBackupStatus');
    if (!button || !fileInput) return false;

    button.addEventListener('click', async () => {
        fileInput.value = '';
        try {
            await assertFullBackupAllowed(options);
            fileInput.click();
        } catch (error) {
            showBackupError(status, error, doc);
        }
    });

    const guard = options.guard ?? (globalThis.document ? getPageNavigationGuard(doc) : createNavigationGuard());
    const lifecycle = createNavigationOperationLifecycle({ guard });
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        if (lifecycle.isBlocked()) {
            if (status) {
                status.dataset.kind = 'error';
                status.textContent = 'Eine andere Aktion läuft. Bitte warten und die Importdatei danach erneut auswählen.';
            }
            fileInput.value = '';
            return;
        }
        let recoveryArchiveTouched = false;
        try {
            const prepared = await lifecycle.run({}, async navigationOperation => {
                try {
                    await assertFullBackupAllowed(options);
                    navigationOperation.check();
                    const text = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result || ''));
                        reader.onerror = () => reject(reader.error || new Error('Datei konnte nicht gelesen werden.'));
                        reader.onabort = () => reject(new Error('Dateilesen wurde abgebrochen.'));
                        reader.readAsText(file);
                    });
                    await assertFullBackupAllowed(options);
                    navigationOperation.check();
                    const normalized = normalizeFullPersistenceBackup(JSON.parse(text));
                    if (!normalized.ok) throw new Error(normalized.message);
                    const backup = normalized.backup;
                    const decisionRecords = collectStorageRecords(persistenceStorage);
                    const confirmImport = options.confirmImport || (description => requestPageConfirmation({ doc, title: 'Backup importieren', description, confirmLabel: 'Backup importieren', danger: true, signal: navigationOperation.controller.signal, opener: button }));
                    const migrationText = backup.migrated
                        ? `\n\nSchema 1 wird migriert; ${backup.excludedRecordCount} nicht mehr unterstützte Einträge werden ausgelassen.` : '';
                    const confirmed = await confirmImport(
                        `Komplettes Backup mit ${backup.recordCount} Einträgen importieren?\n\nAlle aktuell gespeicherten fachlichen Daten werden ersetzt.${migrationText}`);
                    await assertFullBackupAllowed(options);
                    navigationOperation.check();
                    if (confirmed !== true) {
                        if (status) { status.dataset.kind = ''; status.textContent = 'Import abgebrochen; die gespeicherten Daten wurden nicht ersetzt.'; }
                        return null;
                    }
                    if (JSON.stringify(decisionRecords) !== JSON.stringify(collectStorageRecords(persistenceStorage))) throw new FullBackupLiveChangedError();
                    if (status) { status.dataset.kind = ''; status.textContent = 'Wiederherstellungssicherung wird erstellt …'; }
                    let recoveryResult;
                    try {
                        recoveryResult = await (options.createRecoveryBackup || downloadRecoveryPersistenceBackup)({ ...options, document: doc });
                    } catch (error) {
                        throw new Error(`Import abgebrochen: Recovery-Backup konnte nicht erstellt werden (${error?.message || 'unbekannter Fehler'}).`);
                    }
                    navigationOperation.check();
                    await assertFullBackupAllowed(options);
                    if (!recordsMatch(decisionRecords, collectStorageRecords(persistenceStorage))) throw new FullBackupLiveChangedError();
                    recoveryArchiveTouched = true;
                    const preparedRecovery = await prepareFullBackupRecovery(PersistenceFacade, PersistenceFacade, navigationOperation, options);
                    navigationOperation.check();
                    await assertFullBackupAllowed(options);
                    if (!recordsMatch(decisionRecords, collectStorageRecords(persistenceStorage))) throw new FullBackupLiveChangedError();
                    return { backup, recoveryResult, preparedRecovery };
                } finally { fileInput.value = ''; }
            });
            if (!prepared) return;
            let importResult;
            const navigated = await guard.reload({
                opener: button,
                subscribeChanges: notify => PersistenceFacade.observeInputChanges(notify, doc),
                mutate: async navigationOperation => {
                    const result = await importFullPersistenceBackup(prepared.backup, { probelaufController: options.probelaufController, navigationOperation, preparedRecovery: prepared.preparedRecovery });
                    importResult = result;
                    if (status && !result.ok) {
                        status.dataset.kind = 'error';
                        status.textContent = result.message || 'Import fehlgeschlagen.';
                    }
                    return result.ok;
                },
                flush: () => PersistenceFacade.flush(),
                reload: options.reload || (() => globalThis.location?.reload?.())
            });
            if (status && !importResult) {
                status.dataset.kind = '';
                status.textContent = 'Import abgebrochen; die gespeicherten Daten wurden nicht ersetzt. Die Wiederherstellungssicherung bleibt erhalten.';
            }
            if (status && importResult?.ok) {
                status.dataset.kind = navigated ? 'ok' : 'error';
                const recoveryText = prepared.recoveryResult?.skipped
                    ? ' Keine Wiederherstellungssicherung nötig, da vorher keine Daten gespeichert waren.'
                    : ' Wiederherstellungssicherung wurde vorher erstellt.';
                status.textContent = navigated ? `${importResult.message}${recoveryText}`
                    : 'Import gespeichert; Reload wegen einer Zustandsänderung abgebrochen. Bitte erneut prüfen.';
            }
        } catch (error) {
            showBackupError(status, error, doc);
        } finally {
            if (recoveryArchiveTouched) {
                try { doc.dispatchEvent?.(new CustomEvent('overview-backup-changed')); }
                catch { /* Die Importmeldung darf nicht durch den Refresh ersetzt werden. */ }
            }
        }
    });

    return true;
}
