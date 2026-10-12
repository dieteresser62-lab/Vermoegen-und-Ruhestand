import { stripBalancePersonInputs } from '../profile/profile-person-data.js';
/**
 * Module: Balance Storage (StorageManager)
 * Purpose: Manages data persistence via LocalStorage and the File System Access API (for Snapshots).
 *          Handles state loading/saving, migrations for older versions, and snapshot management.
 * Usage: Used by balance-main.js and balance-binder.js for all persistence operations.
 * Dependencies: balance-config.js
 */
"use strict";

/**
 * ===================================================================================
 * BALANCE-APP PERSISTENZ-SCHICHT (StorageManager)
 * ===================================================================================
 */

import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';

import { CONFIG, StorageError } from './balance-config.js';
import { assertBalanceWealthHistory, WealthHistoryError } from '../../types/wealth-history-contract.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from '../shared/snapshot-archive.js';
import { isFullImportRecoverySnapshot, restoreImportRecoverySnapshot, restoreSnapshotById } from '../shared/snapshot-restore.js';
import { PROFILE_STORAGE_KEYS } from '../profile/profile-state.js';
import { saveCurrentProfileFromLocalStorage } from '../profile/profile-storage.js';
import {
    assertCumulativeInflationFactor,
    CumulativeInflationFactorError
} from '../../types/cumulative-inflation-contract.js';

export const BALANCE_IMPORT_RECOVERY_KIND = SNAPSHOT_KINDS.balanceImportRecovery;
const SNAPSHOT_HANDLE_DB_NAME = 'ruhestand-suite-snapshot-handles';
const LEGACY_SNAPSHOT_HANDLE_DB_NAME = 'snapshotDB';
const SNAPSHOT_HANDLE_STORE_NAME = 'handles';
const SNAPSHOT_DIRECTORY_HANDLE_KEY = 'snapshotDirHandle';

// Module-level references to be injected
let connectFolderBtn = null;
let appState = null;
let UIRenderer = null;

function parseJsonObject(raw, fallback = null) {
    if (!raw) return fallback;
    try {
        const parsed = JSON.parse(String(raw));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function registryHasProfile(registry, profileId) {
    if (!profileId || !registry || typeof registry !== 'object') return false;
    return Boolean(registry.profiles?.[profileId]);
}

function getProfileNameFromRegistry(registry, profileId) {
    return String(registry?.profiles?.[profileId]?.meta?.name || '');
}

function getPersistenceKeys() {
    return Array.from({ length: persistenceStorage.length }, (_, i) => persistenceStorage.key(i)).filter(Boolean);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function validateStoredCumulativeInflationFactor(data) {
    const state = data?.lastState;
    if (!state || typeof state !== 'object' || Array.isArray(state)) return data;
    if (hasOwn(state, 'cumulativeInflationFactor')) {
        assertCumulativeInflationFactor(state.cumulativeInflationFactor, {
            path: 'lastState.cumulativeInflationFactor'
        });
    }
    return data;
}

function captureCurrentSnapshotRecords() {
    return SnapshotArchive.captureCurrentRecords({
        keys: getPersistenceKeys,
        getItem: key => persistenceStorage.getItem(key)
    });
}

async function createArchiveSnapshot({ navigationOperation, label = '', kind = SNAPSHOT_KINDS.manual, allowEmpty = false } = {}) {
    const records = captureCurrentSnapshotRecords();
    if (!allowEmpty && Object.keys(records).length === 0) {
        throw new StorageError('Keine Daten zum Sichern vorhanden.');
    }
    const activeProfileId = SnapshotArchive.getActiveProfileIdFromRecords(records);
    const registry = parseJsonObject(records[PROFILE_STORAGE_KEYS.registry], null);
    return SnapshotArchive.createSnapshot({
        label,
        kind,
        records,
        activeProfileId,
        activeProfileName: getProfileNameFromRegistry(registry, activeProfileId)
    }, { navigationOperation });
}

function getStorageGuard(options = {}) {
    return options.guard ?? (globalThis.document ? getPageNavigationGuard() : null);
}

/**
 * Initialisiert den StorageManager mit den notwendigen Abhängigkeiten
 *
 * @param {Object} domRefs - DOM-Referenzen für UI-Updates
 * @param {Object} state - Globaler Anwendungszustand
 * @param {Object} renderer - UI-Renderer für Toast-Nachrichten
 */
export function initStorageManager(domRefs, state, renderer) {
    connectFolderBtn = domRefs?.controls?.connectFolderBtn ?? null;
    appState = state;
    UIRenderer = renderer;
}

export const StorageManager = {
    /**
     * IndexedDB-Helper für File System Access API Handles
     * Speichert Verzeichnis-Handles persistent zwischen Sessions
     */
    _idbHelper: {
        db: null,
        openPromise: null,
        migrationPromise: null,
        _openDatabase(name, { createHandleStore = false } = {}) {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(name, 1);
                request.onupgradeneeded = () => {
                    if (createHandleStore && !request.result.objectStoreNames.contains(SNAPSHOT_HANDLE_STORE_NAME)) {
                        request.result.createObjectStore(SNAPSHOT_HANDLE_STORE_NAME);
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error || new Error(`IndexedDB ${name} konnte nicht geoeffnet werden.`));
            });
        },
        _read(database, key) {
            if (!database.objectStoreNames.contains(SNAPSHOT_HANDLE_STORE_NAME)) return Promise.resolve(undefined);
            return new Promise((resolve, reject) => {
                const request = database.transaction(SNAPSHOT_HANDLE_STORE_NAME).objectStore(SNAPSHOT_HANDLE_STORE_NAME).get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error || new Error('Verzeichnis-Handle konnte nicht gelesen werden.'));
            });
        },
        _write(database, key, value) {
            return new Promise((resolve, reject) => {
                const request = database.transaction(SNAPSHOT_HANDLE_STORE_NAME, 'readwrite')
                    .objectStore(SNAPSHOT_HANDLE_STORE_NAME)
                    .put(value, key);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error || new Error('Verzeichnis-Handle konnte nicht gespeichert werden.'));
            });
        },
        async _migrateLegacyDirectoryHandle() {
            const currentHandle = await this._read(this.db, SNAPSHOT_DIRECTORY_HANDLE_KEY);
            if (currentHandle !== undefined) return;

            let legacyDb = null;
            try {
                legacyDb = await this._openDatabase(LEGACY_SNAPSHOT_HANDLE_DB_NAME);
                const legacyHandle = await this._read(legacyDb, SNAPSHOT_DIRECTORY_HANDLE_KEY);
                if (legacyHandle !== undefined) {
                    await this._write(this.db, SNAPSHOT_DIRECTORY_HANDLE_KEY, legacyHandle);
                }
            } finally {
                legacyDb?.close?.();
            }
        },
        async open() {
            if (!this.openPromise) {
                this.openPromise = this._openDatabase(SNAPSHOT_HANDLE_DB_NAME, { createHandleStore: true })
                    .then(database => {
                        this.db = database;
                        this.db.onversionchange = () => {
                            this.db?.close?.();
                            this.db = null;
                            this.openPromise = null;
                            this.migrationPromise = null;
                        };
                    })
                    .catch(error => {
                        this.openPromise = null;
                        throw error;
                    });
            }
            await this.openPromise;
            if (!this.migrationPromise) {
                this.migrationPromise = this._migrateLegacyDirectoryHandle()
                    .catch(error => {
                        this.migrationPromise = null;
                        throw error;
                    });
            }
            await this.migrationPromise;
        },
        async get(key) {
            await this.open();
            return this._read(this.db, key);
        },
        async set(key, val) {
            await this.open();
            return this._write(this.db, key, val);
        }
    },

    /**
     * Lädt den gespeicherten Zustand aus localStorage
     *
     * Enthält:
     * - Benutzereingaben (Vermögen, Bedarf, Marktdaten)
     * - Engine-State (Guardrail-History, Inflationsfaktor, etc.)
     *
     * @returns {Object} Gespeicherter Zustand mit inputs und lastState
     * @throws {StorageError} Bei Lade- oder Parse-Fehlern
     */
    loadState() {
        try {
            const data = persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY);
            const parsed = data ? JSON.parse(data) : {};
            assertBalanceWealthHistory(parsed);
            validateStoredCumulativeInflationFactor(parsed);
            return this._runMigrations(parsed);
        } catch (e) {
            if (e instanceof CumulativeInflationFactorError || e instanceof WealthHistoryError
                || e?.code === 'PERSISTENCE_RELOAD_REQUIRED') throw e;
            throw new StorageError("Fehler beim Laden des Zustands aus dem LocalStorage.", { originalError: e });
        }
    },

    /**
     * Speichert den aktuellen Zustand in localStorage
     *
     * @param {Object} state - Zustand mit inputs und lastState
     * @throws {StorageError} Bei Speicher-Fehlern (z.B. Quota exceeded)
     */
    saveState(state) {
        try {
            assertBalanceWealthHistory(state);
            validateStoredCumulativeInflationFactor(state);
            persistenceStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(stripBalancePersonInputs(state)));
        } catch (e) {
            if (e instanceof CumulativeInflationFactorError || e instanceof WealthHistoryError
                || e?.code === 'PERSISTENCE_RELOAD_REQUIRED') throw e;
            throw new StorageError("Fehler beim Speichern des Zustands im LocalStorage.", { originalError: e });
        }
    },

    /**
     * Führt Daten-Migrationen für ältere localStorage-Versionen durch
     *
     * Historische Einmalmigrationen duerfen nur fehlende Metadaten ergaenzen.
     * Ein vorhandener Inflationsfaktor wird vor der Migration strikt validiert
     * und niemals still durch einen Default ersetzt.
     *
     * @param {Object} data - Rohdaten aus localStorage
     * @returns {Object} Migrierte Daten
     * @private
     */
    _runMigrations(data) {
        assertBalanceWealthHistory(data);
        validateStoredCumulativeInflationFactor(data);
        const ensureTaxState = (payload) => {
            if (!payload || typeof payload !== 'object') return payload;
            const state = payload.lastState;
            if (!state || typeof state !== 'object') return payload;
            if (!state.taxState || typeof state.taxState !== 'object') {
                state.taxState = { lossCarry: 0 };
            } else if (!Number.isFinite(state.taxState.lossCarry) || state.taxState.lossCarry < 0) {
                state.taxState.lossCarry = 0;
            }
            payload.lastState = state;
            return payload;
        };
        if (persistenceStorage.getItem(CONFIG.STORAGE.MIGRATION_FLAG)) {
            return ensureTaxState(data);
        }

        let state = data.lastState || {};
        if (state) {
            if (!Number.isFinite(state.lastInflationAppliedAtAge)) {
                state.lastInflationAppliedAtAge = 0;
            }
            data.lastState = state;
        }
        persistenceStorage.setItem(CONFIG.STORAGE.MIGRATION_FLAG, '1');
        return ensureTaxState(data);
    },

    /**
     * Löscht den gespeicherten Zustand (Reset)
     * Entfernt localStorage-Einträge für State und Migrations-Flag
     */
    resetState() {
        persistenceStorage.removeItem(CONFIG.STORAGE.LS_KEY);
        persistenceStorage.removeItem(CONFIG.STORAGE.MIGRATION_FLAG);
    },

    /**
     * Ersetzt ausschliesslich den Balance-State nach bestaetigtem Recovery-Snapshot.
     * Validierung und Engine-Dry-Run muessen der Aufruferseite bereits gelungen sein.
     *
     * @param {Object} state Schema-validierter Balance-State
     * @returns {Promise<{ok: true, recoverySnapshotId: string}>}
     */
    async replaceStateFromImport(state, options = {}) {
        const lifecycle = createNavigationOperationLifecycle({ guard: getStorageGuard(options) });
        return lifecycle.run(options, async navigationOperation => {
            if (!state || typeof state !== 'object' || Array.isArray(state)) {
                throw new StorageError('Der validierte Importzustand ist ungueltig.');
            }
            assertBalanceWealthHistory(state);

            let serializedState;
            try {
                serializedState = JSON.stringify(state);
            } catch (error) {
                throw new StorageError('Der validierte Importzustand konnte nicht serialisiert werden.', { originalError: error });
            }
            if (!serializedState) {
                throw new StorageError('Der validierte Importzustand ist leer.');
            }

            let recoverySnapshotId = '';
            try {
                if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
                navigationOperation.check();
                const previousState = persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY);
                const recovery = await createArchiveSnapshot({
                    label: `Balance-Import Recovery ${new Date().toISOString()}`,
                    kind: BALANCE_IMPORT_RECOVERY_KIND,
                    navigationOperation,
                    allowEmpty: true
                });
                recoverySnapshotId = recovery.id;
                const confirmedRecovery = await SnapshotArchive.readSnapshot(recovery.id);
                navigationOperation.check();
                const recoveryHasState = hasOwn(confirmedRecovery.records, CONFIG.STORAGE.LS_KEY);
                if (
                    (previousState === null && recoveryHasState) ||
                    (previousState !== null && confirmedRecovery.records[CONFIG.STORAGE.LS_KEY] !== previousState)
                ) {
                    throw new StorageError('Der Import-Recovery-Snapshot bildet den aktuellen Balance-State nicht korrekt ab.');
                }

                navigationOperation.commit();
                await PersistenceFacade.replaceRecordsTransactional({ [CONFIG.STORAGE.LS_KEY]: serializedState }, {
                    allowKey: key => key === CONFIG.STORAGE.LS_KEY, navigationOperation
                });

                if (persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY) !== serializedState) {
                    await restoreImportRecoverySnapshot(confirmedRecovery, navigationOperation);
                    throw new StorageError('Der ersetzte Balance-State konnte nicht bestaetigt werden.');
                }

                return {
                    ok: true,
                    recoverySnapshotId: confirmedRecovery.id
                };
            } catch (error) {
                if (error?.name === 'AbortError') throw error;
                if (error instanceof StorageError) throw error;
                throw new StorageError('Recovery-Snapshot oder Balance-Replace ist fehlgeschlagen.', { originalError: error, recoverySnapshotId });
            }
        });
    },

    /**
     * Rollt einen bereits gestarteten Import anhand seines bestaetigten Recovery-Snapshots zurueck.
     *
     * @param {{recoverySnapshotId?: string}|string} receipt Import-Receipt oder Snapshot-ID
     * @returns {Promise<{ok: true, recoverySnapshotId: string}>}
     */
    async rollbackImportReplace(receipt, options = {}) {
        const lifecycle = createNavigationOperationLifecycle({ guard: getStorageGuard(options) });
        return lifecycle.run(options, async navigationOperation => {
            navigationOperation.commit();
            const recoverySnapshotId = typeof receipt === 'string'
                ? receipt
                : String(receipt?.recoverySnapshotId || '');
            if (!recoverySnapshotId) {
                throw new StorageError('Import-Recovery-Snapshot-ID fehlt.');
            }
            try {
                const snapshot = await SnapshotArchive.readSnapshot(recoverySnapshotId);
                if (snapshot.kind !== BALANCE_IMPORT_RECOVERY_KIND && !isFullImportRecoverySnapshot(snapshot)) {
                    throw new StorageError('Der angegebene Snapshot ist kein Balance-Import-Recovery-Punkt.');
                }
                await restoreImportRecoverySnapshot(snapshot, navigationOperation);
                return { ok: true, recoverySnapshotId };
            } catch (error) {
                if (error?.name === 'AbortError') throw error;
                if (error instanceof StorageError) throw error;
                throw new StorageError('Der Balance-Import konnte nicht automatisch zurueckgerollt werden.', { originalError: error });
            }
        });
    },

    /**
     * Initialisiert die Snapshot-Funktionalität
     *
     * Prüft File System Access API-Unterstützung und lädt gespeicherte
     * Verzeichnis-Handles aus IndexedDB. Falls kein Handle oder keine
     * Berechtigung vorhanden, bleibt localStorage als Fallback aktiv.
     *
     * @async
     * @returns {Promise<void>}
     */
    async initSnapshots() {
        if (!('showDirectoryPicker' in window)) {
            if (connectFolderBtn) connectFolderBtn.style.display = 'none';
            return;
        }
        try {
            const handle = await this._idbHelper.get('snapshotDirHandle');
            if (handle && (await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
                appState.snapshotHandle = handle;
            }
        } catch (e) { }
    },

    /**
     * Erstellt einen neuen kanonischen Snapshot des aktuellen Zustands im internen Archiv.
     *
     * @async
     * @param {FileSystemDirectoryHandle|null} handle - Verzeichnis-Handle oder null
     * @param {string} [label=''] - Optionaler Benutzer-Label für den Snapshot
     * @returns {Promise<void>}
     * @throws {StorageError} Wenn keine Daten zum Sichern vorhanden sind
     */
    async createSnapshot(handle, label = '', options = {}) {
        const lifecycle = createNavigationOperationLifecycle({ guard: getStorageGuard(options) });
        return lifecycle.run(options, async navigationOperation => {
            navigationOperation.check();
            saveCurrentProfileFromLocalStorage();
            if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            navigationOperation.check();
            await createArchiveSnapshot({
                navigationOperation, label,
                kind: SNAPSHOT_KINDS.annualClosePreMutation
        });
        navigationOperation.check();
        });
    },

    /**
     * Öffnet Ordner-Auswahl-Dialog und verbindet File-System-Verzeichnis
     *
     * Fordert Benutzer auf, einen Ordner für Snapshots auszuwählen.
     * Speichert das Verzeichnis-Handle in IndexedDB für zukünftige Sessions.
     *
     * @async
     * @returns {Promise<void>}
     * @throws {StorageError} Wenn Zugriff verweigert oder Verbindung fehlschlägt
     */
    async connectFolder() {
        try {
            const handle = await window.showDirectoryPicker();
            if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                throw new StorageError('Zugriff auf den Ordner wurde nicht gewährt.');
            }
            await this._idbHelper.set('snapshotDirHandle', handle);
            appState.snapshotHandle = handle;
            // Dialogabbruch und fehlgeschlagene Verbindung erhalten den bisherigen Fehler.
            UIRenderer.clearActionError('snapshots');
            UIRenderer.toast('Snapshot-Ordner erfolgreich verbunden.');
        } catch (err) {
            if (err.name !== 'AbortError') {
                throw new StorageError('Ordner konnte nicht verbunden werden.', { originalError: err });
            }
        }
    },

    /**
     * Stellt einen kanonischen Archiv-Snapshot per Standard-Restore wieder her.
     *
     * @async
     * @param {string} key - Dateiname oder localStorage-Schlüssel des Snapshots
     * @param {FileSystemDirectoryHandle|null} handle - Verzeichnis-Handle oder null
     * @returns {Promise<{status: string, message?: string}>}
     */
    async restoreSnapshot(key, handle, options = {}) {
        return restoreSnapshotById(key, { ...options, guard: getStorageGuard(options) });
    },

    /**
     * Löscht einen Snapshot aus dem internen Archiv.
     *
     * @async
     * @param {string} key - Dateiname oder localStorage-Schlüssel des Snapshots
     * @param {FileSystemDirectoryHandle|null} handle - Verzeichnis-Handle oder null
     * @returns {Promise<void>}
     */
    async deleteSnapshot(key, handle, options = {}) {
        const lifecycle = createNavigationOperationLifecycle({ guard: getStorageGuard(options) });
        return lifecycle.run(options, async navigationOperation => {
            navigationOperation.commit();
            await SnapshotArchive.deleteSnapshot(key, { navigationOperation });
            UIRenderer.toast('Snapshot gelöscht.');
        });
    }
};
