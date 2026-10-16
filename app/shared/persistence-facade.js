// @ts-check

import { replaceRecordsTransactionalWith } from './persistence-transaction.js';
import { createLocalStorageAdapter } from './persistence-adapter-localstorage.js';
import { createPersistenceAreas } from './persistence-areas.js';
import { AREA_CONTROL_KEY, areaSessionStorage, scopeWebStorage, setStorageArea, resolveLocalArea } from './persistence-area-storage.js';
import { detectRuntime } from './runtime-env.js';
import { getPageNavigationGuard } from './navigation-guard-dialog.js';
import { createNavigationOperationLifecycle } from './navigation-guard.js';
import { musterHaushalt } from '../demo/muster-haushalte.js';

const PROBELAUF_STATE_KEY = 'rs_probelauf_state_v1';
const DEFAULT_DEBOUNCE_MS = 250;
const INDEXEDDB_MIGRATION_TARGET = 'indexeddb';
const TAURI_MIGRATION_TARGET = 'tauri-json-file';
const LEGACY_MIGRATION_MARKER_KEYS = Object.freeze({
    target: 'ruhestandsapp_migrated_to_target',
    completedAt: 'ruhestandsapp_migration_completed_at',
    checksum: 'ruhestandsapp_migration_checksum'
});
const LOCAL_SNAPSHOT_ARCHIVE_KEY = 'rs_snapshot_archive_v1';
const LOCAL_SNAPSHOT_ARCHIVE_SCHEMA_VERSION = 1;
const MARKER_KEY_SET = new Set(Object.values(LEGACY_MIGRATION_MARKER_KEYS));

let areaManager = null;
let areaControl = { activeArea: 'echt' };
let areaReloadRequired = false;
let synchronousAreaResolved = false;
let synchronousStorage = null;
let synchronousControlRaw = null;
let adapter = createLocalStorageAdapter();
let adapterExplicitlyConfigured = false;
let memCache = Object.create(null);
let initialized = false;
let initPromise = null;
let dirtyKeys = new Set();
let deletedKeys = new Set();
let flushTimer = null;
let debounceMs = DEFAULT_DEBOUNCE_MS;
let lifecycleBindings = [];
let lifecycleBindToken = 0;
let tauriCloseBinding = null;
let lastFlushError = null;
let flushChain = Promise.resolve();
let migrationWarning = null;
let areaWarning = null;
const syncWriteBlocks = new Map();
let probelaufProtection = null;
let persistenceWindow = globalThis.window;
let fallbackWriteChain = null;
export function setProbelaufProtection(protection) { probelaufProtection = protection; }
async function persistentWrite(execute, options = {}, needsProtection = () => true) {
    const run = async () => {
        if (!initialized && !adapterExplicitlyConfigured) await init();
        assertAreaWritable();
        if (areaManager) await areaManager.assertCurrent();
        if (needsProtection() && probelaufProtection?.checkCurrent) await probelaufProtection.checkCurrent();
        // Nur der interne Folgewriter erhält diesen Flushbesitz. Ein unabhängiger
        // Lifecycleflush wartet weiter am Lock und wird niemals über eine globale
        // Verschachtelungstiefe zum Besitzer des gerade laufenden Writers.
        return execute(flushOwned);
    };
    if (probelaufProtection?.ownsWrites?.(options)) return run();
    if (persistenceWindow?.navigator?.locks?.request) {
        return persistenceWindow.navigator.locks.request('rs-probelauf-operation', { mode: 'exclusive' }, run);
    }
    return queueFallbackWrite(run);
}

function queueFallbackWrite(run) {
    const job = fallbackWriteChain ? fallbackWriteChain.then(run, run) : Promise.resolve(run());
    const tail = job.catch(() => true).then(() => {
        if (fallbackWriteChain === tail) fallbackWriteChain = null;
    });
    fallbackWriteChain = tail;
    return job;
}

/** Koordinator und unabhängige Writer teilen auch ohne Web Locks eine Reihenfolge. */
export async function withProbelaufOperation(execute, win = persistenceWindow, {
    check = () => {}, onWait = () => {}, clock = Date.now,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 10000, signal
} = {}) {
    const deadline = clock() + timeoutMs;
    const busyError = (foreign = false) => {
        const error = new Error(foreign ? 'Eine andere Seite führt gerade eine Spielbereich-Aktion aus.'
            : 'Gerade wird noch gespeichert. Bitte in ein paar Sekunden erneut versuchen.');
        error.code = foreign ? 'PROBELAUF_OTHER_PAGE' : 'PROBELAUF_COMMIT_BUSY';
        return error;
    };
    const run = async () => {
        let ownsFlush = true;
        const scopedFlush = () => {
            if (!ownsFlush) throw new Error('PROBELAUF_OPERATION_ENDED');
            return flushOwned();
        };
        try { return await execute(scopedFlush); }
        finally { ownsFlush = false; }
    };
    const locks = win?.navigator?.locks;
    if (locks?.request) {
        let clientId;
        if (locks.query) {
            // Nur Identität bestimmen; diese Hilfssperre hält niemals die Aktion.
            const name = `rs-probelauf-client-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
            await locks.request(name, { mode: 'exclusive', ifAvailable: true }, async lock => {
                if (lock) clientId = (await locks.query()).held.find(entry => entry.name === name)?.clientId;
            });
        }
        const unavailable = Symbol('unavailable');
        for (;;) {
            check();
            if (clock() >= deadline) throw busyError();
            const result = await locks.request('rs-probelauf-operation', { mode: 'exclusive', ifAvailable: true }, lock => {
                if (!lock) return unavailable;
                check();
                if (clock() >= deadline) throw busyError();
                // Expliziter privater Flushbesitz; unabhängige Flushs bleiben eingereiht.
                return run();
            });
            if (result !== unavailable) return result;
            check();
            const held = locks.query ? (await locks.query()).held.find(entry => entry.name === 'rs-probelauf-operation') : null;
            if (held && clientId !== undefined && held.clientId !== undefined && held.clientId !== clientId) throw busyError(true);
            if ((held && (clientId === undefined || held.clientId === undefined)) || !locks.query) throw busyError();
            if (clock() >= deadline) throw busyError();
            onWait('Speichert noch …');
            await wait(Math.min(50, deadline - clock()));
            if (clock() >= deadline) throw busyError();
        }
    }
    // Die bestehende Writerkette bleibt erhalten. Ein verworfener Auftrag wird
    // später nur als leere Queueposition abgearbeitet, niemals ausgeführt.
    let expired = false, started = false, timer, abort;
    const cancelled = new Promise((resolve, reject) => {
        abort = () => { if (!started) { expired = true; reject(signal.reason); } };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
    });
    const job = queueFallbackWrite(() => {
        if (expired) return;
        check();
        if (clock() >= deadline) throw busyError();
        started = true;
        clearTimeout(timer);
        return run();
    });
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => { if (!started) { expired = true; reject(busyError()); } }, timeoutMs);
    });
    try {
        if (!started) onWait('Speichert noch …');
        return await Promise.race([job, timeout, cancelled]);
    } finally { if (!started) expired = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

/** Veraltete Formularwerte dürfen einen gerade ersetzten Bestand nicht überschreiben. */
export function blockSyncWrites(keys, message, { prefixes = [], predicate = null } = {}) {
    const owner = Symbol('sync-write-block');
    syncWriteBlocks.set(owner, { keys: new Set(keys.map(String)), prefixes: prefixes.map(String), predicate, message });
    return () => syncWriteBlocks.delete(owner);
}

/** Rein lesend: unabhängige Lifecycle-Saver setzen während Restore/Reset aus. */
export function hasSyncWriteBlocks() {
    return syncWriteBlocks.size > 0;
}

function assertSyncWriteAllowed(key) {
    for (const block of syncWriteBlocks.values()) {
        if (!block.keys.has(key) && !block.prefixes.some(prefix => key.startsWith(prefix)) && !block.predicate?.(key)) continue;
        const error = new Error(typeof block.message === 'function' ? block.message() : block.message);
        error.code = 'PERSISTENCE_RELOAD_REQUIRED';
        throw error;
    }
}

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function toNullPrototypeRecords(records) {
    const normalized = Object.create(null);
    if (!records || typeof records !== 'object') return normalized;
    Object.entries(records).forEach(([key, value]) => {
        if (value === null || value === undefined) return;
        normalized[String(key)] = String(value);
    });
    return normalized;
}

function normalizeSnapshotListArchive(raw) {
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
        snapshots: parsed.snapshots.filter(snapshot => snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot))
    };
}

function serializeSnapshotListArchive(snapshots) {
    return JSON.stringify({
        schemaVersion: LOCAL_SNAPSHOT_ARCHIVE_SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        snapshots
    });
}

function toSnapshotArchiveIndexEntry(snapshot) {
    const { records, ...indexEntry } = snapshot || {};
    return indexEntry;
}

function isLocalStorageFallbackAdapter(activeAdapter = adapter) {
    return activeAdapter?.name === 'localStorage';
}

function requireAdapterMethod(methodName) {
    const method = adapter?.[methodName];
    if (typeof method !== 'function') {
        throw new Error(`Aktiver Persistenzadapter unterstuetzt ${methodName}() nicht.`);
    }
    return method.bind(adapter);
}

function clearScheduledFlush() {
    if (flushTimer !== null && typeof clearTimeout === 'function') {
        clearTimeout(flushTimer);
    }
    flushTimer = null;
}

function scheduleFlush() {
    if (!initialized || typeof setTimeout !== 'function') return;
    clearScheduledFlush();
    flushTimer = setTimeout(() => {
        flush().catch(err => {
            console.error('[PersistenceFacade] flush failed:', err);
        });
    }, debounceMs);
}

function simpleChecksum(records) {
    const json = JSON.stringify(Object.keys(records).sort().map(key => [key, records[key]]));
    let hash = 0;
    for (let i = 0; i < json.length; i += 1) {
        hash = ((hash << 5) - hash + json.charCodeAt(i)) | 0;
    }
    return String(hash >>> 0);
}

async function collectAllowedLegacyRecords(storage = globalThis.localStorage) {
    const { listAllowedPersistenceImportKeys } = await import('./persistence-key-policy.js');
    const records = Object.create(null);
    listAllowedPersistenceImportKeys(storage).forEach(key => {
        if (MARKER_KEY_SET.has(key)) return;
        const value = storage.getItem(key);
        if (value !== null && value !== undefined) records[key] = String(value);
    });
    return records;
}

function getMigrationTargetForAdapter(activeAdapter) {
    if (activeAdapter?.name === 'IndexedDB') return INDEXEDDB_MIGRATION_TARGET;
    if (activeAdapter?.name === 'Tauri JSON File') return TAURI_MIGRATION_TARGET;
    return null;
}

async function migrateLegacyLocalStorageToTargetIfNeeded(activeAdapter, loadedRecords, options = {}) {
    const migrationTarget = getMigrationTargetForAdapter(activeAdapter);
    if (!migrationTarget) return { records: loadedRecords, warning: null };
    const storage = options.localStorage || globalThis.localStorage;
    if (!storage) return { records: loadedRecords, warning: null };

    const legacyRecords = await collectAllowedLegacyRecords(storage);
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

export function configurePersistence(options = {}) {
    if (options.adapter) {
        adapter = options.adapter;
        adapterExplicitlyConfigured = true;
    }
    if (Number.isFinite(options.debounceMs)) debounceMs = Math.max(0, Number(options.debounceMs));
}

export async function init(options = {}) {
    if (initPromise) return initPromise;
    if (options.adapter || Number.isFinite(options.debounceMs)) {
        configurePersistence(options);
    }
    persistenceWindow = options.window || globalThis.window;
    initPromise = (async () => {
        if (!adapterExplicitlyConfigured) {
            areaManager = createPersistenceAreas(options);
            const resolved = await areaManager.resolve();
            adapter = resolved.adapter;
            areaControl = resolved.control;
            areaWarning = areaWarning || resolved.warning;
            setStorageArea(areaControl.activeArea);
        }
        let loadedRecords;
        let skipLegacyMigration = Boolean(migrationWarning || areaWarning);
        try {
            await adapter.open?.();
            loadedRecords = toNullPrototypeRecords(await adapter.loadAll());
        } catch (err) {
            if (err?.code !== 'tauri-state-corrupt') throw err;
            skipLegacyMigration = true;
            loadedRecords = Object.create(null);
            migrationWarning = {
                code: 'tauri-state-corrupt',
                message: `${err.message || 'Tauri-Daten konnten nicht gelesen werden'} Bitte ein Backup importieren oder mit leerem Zustand fortfahren.`,
                quarantinePath: err.quarantinePath || ''
            };
        }
        const migrationResult = skipLegacyMigration
            ? { records: loadedRecords, warning: null }
            : await migrateLegacyLocalStorageToTargetIfNeeded(adapter, loadedRecords, { ...options,
                localStorage: areaManager ? areaManager.localStorage(areaControl.activeArea) : options.localStorage });
        memCache = toNullPrototypeRecords(migrationResult.records);
        migrationWarning = migrationWarning || migrationResult.warning;
        initialized = true;
        if (options.installLifecycleHooks !== false) bindLifecycleFlush(options.doc, options.window);
        else if (options.installTauriCloseHook === true) bindTauriClose(options.doc, options.window);
        if (typeof globalThis.dispatchEvent === 'function') {
            try {
                const event = typeof globalThis.CustomEvent === 'function'
                    ? new globalThis.CustomEvent('persistence:initialized')
                    : { type: 'persistence:initialized' };
                globalThis.dispatchEvent(event);
            } catch (e) {
                console.warn('[PersistenceFacade] Failed to dispatch initialization event:', e);
            }
        }
        return true;
    })();
    return initPromise;
}

export function isInitialized() {
    return initialized;
}

function resolveSynchronousArea() {
    if (initialized || adapterExplicitlyConfigured) return true;
    // Tauri und IndexedDB warten auf init(); nur der Storage-Fallback ist synchron.
    if (detectRuntime() === 'tauri' || globalThis.indexedDB?.open) return false;
    const storage = globalThis.window?.localStorage || globalThis.localStorage;
    if (synchronousAreaResolved && storage === synchronousStorage) {
        if ((storage?.getItem(AREA_CONTROL_KEY) ?? null) !== synchronousControlRaw) throw new Error('Speicherbereich geändert. Bitte neu laden.');
        return true;
    }
    const resolved = resolveLocalArea(storage);
    areaControl = resolved.control;
    areaWarning = resolved.warning;
    setStorageArea(areaControl.activeArea);
    adapter = createLocalStorageAdapter(() => storage, { area: areaControl.activeArea });
    synchronousStorage = storage;
    synchronousControlRaw = storage?.getItem(AREA_CONTROL_KEY) ?? null;
    synchronousAreaResolved = true;
    return true;
}

function assertAreaWritable() {
    if (areaReloadRequired || !resolveSynchronousArea()) {
        throw new Error('Speicherbereich noch nicht bereit oder geändert. Bitte neu laden.');
    }
}

export function getItemSync(key) {
    if (areaReloadRequired) throw new Error('Speicherbereich geändert. Bitte neu laden.');
    const normalized = String(key);
    if (initialized) {
        return hasOwn(memCache, normalized) ? memCache[normalized] : null;
    }
    return resolveSynchronousArea() ? adapter.getItemSync?.(normalized) ?? null : null;
}

export function setItemSync(key, value) {
    const normalized = String(key);
    assertAreaWritable();
    assertSyncWriteAllowed(normalized);
    const stringValue = String(value);
    if (!initialized) {
        adapter.setItemSync?.(normalized, stringValue);
        return;
    }
    if (memCache[normalized] === stringValue && !deletedKeys.has(normalized)) return;
    memCache[normalized] = stringValue;
    deletedKeys.delete(normalized);
    dirtyKeys.add(normalized);
    scheduleFlush();
}

export function removeItemSync(key) {
    const normalized = String(key);
    assertAreaWritable();
    assertSyncWriteAllowed(normalized);
    if (!initialized) {
        adapter.removeItemSync?.(normalized);
        return;
    }
    if (!hasOwn(memCache, normalized) && !dirtyKeys.has(normalized)) return;
    delete memCache[normalized];
    dirtyKeys.delete(normalized);
    deletedKeys.add(normalized);
    scheduleFlush();
}

export function keysSync() {
    if (areaReloadRequired) throw new Error('Speicherbereich geändert. Bitte neu laden.');
    if (initialized) return Object.keys(memCache);
    return resolveSynchronousArea() ? adapter.keysSync?.() ?? [] : [];
}

export function keySync(index) {
    return keysSync()[index] || null;
}

export function clearAllowedSync(keysOrPredicate) {
    const predicate = typeof keysOrPredicate === 'function'
        ? keysOrPredicate
        : (key) => new Set(keysOrPredicate || []).has(key);
    keysSync().forEach(key => {
        if (predicate(key)) removeItemSync(key);
    });
}

export function clearSync() {
    keysSync().forEach(key => removeItemSync(key));
}

export function exportAllSync() {
    const records = Object.create(null);
    keysSync().forEach(key => {
        if (key === PROBELAUF_STATE_KEY) return;
        const value = getItemSync(key);
        if (value !== null && value !== undefined) records[key] = value;
    });
    return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        records
    };
}

function captureRecordsByPolicy(allowKey) {
    const records = Object.create(null);
    keysSync().forEach(key => {
        if (!allowKey(key)) return;
        const value = getItemSync(key);
        if (value !== null && value !== undefined) records[key] = value;
    });
    return records;
}

export async function readPersistedRecords(allowKey = () => true) {
    if (!initialized && !adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (areaManager) await areaManager.assertCurrent();
    if (typeof adapter?.loadAll !== 'function') {
        const error = new Error('Der Persistenzadapter unterstuetzt keinen verifizierenden Backend-Readback.');
        error.name = 'PersistenceBackendReadError';
        error.code = 'persistence_backend_read_unavailable';
        throw error;
    }
    const loaded = await (adapter.readPersistedRecords ? adapter.readPersistedRecords() : adapter.loadAll());
    const records = Object.create(null);
    Object.entries(loaded || {}).forEach(([key, value]) => {
        const normalizedKey = String(key);
        if (!allowKey(normalizedKey)) return;
        if (typeof value !== 'string') {
            throw new Error(`Persistierter Wert ${normalizedKey} liegt nicht im kanonischen Stringformat vor.`);
        }
        records[normalizedKey] = value;
    });
    return records;
}

export async function replaceRecordsTransactional(records, options = {}) {
    probelaufProtection?.mutation?.(options);
    // Fachkoordinatoren reichen ihren Besitzer explizit weiter. Bestehende
    // andere Domänen behalten ihre äußere Sperre ohne implizite Neuregistrierung.
    const lifecycle = createNavigationOperationLifecycle({ guard: options.guard ?? null });
    return lifecycle.run(options, async operation => {
        return replaceRecordsTransactionalWith({ flush, readPersistedRecords, captureRecordsByPolicy, replaceLiveRecords }, records, { ...options, navigationOperation: operation });
    });
}


export async function importAll(bundle, options = {}) {
    if (!initialized && !adapterExplicitlyConfigured) await init();
    probelaufProtection?.mutation?.(options);
    const records = bundle?.records || {};
    const requestedPolicy = typeof options.allowKey === 'function' ? options.allowKey : () => true;
    const allowKey = key => key !== PROBELAUF_STATE_KEY && requestedPolicy(key);
    if (!records || typeof records !== 'object') {
        return { ok: false, message: 'Ungueltiges Persistenz-Bundle.' };
    }
    if (options.replace === true) {
        keysSync().forEach(key => {
            if (allowKey(key)) removeItemSync(key);
        });
    }
    Object.entries(records).forEach(([key, value]) => {
        if (!allowKey(key)) return;
        if (value === null || value === undefined) return;
        setItemSync(key, String(value));
    });
    await flush();
    return { ok: true, message: 'Import erfolgreich.' };
}

export async function listSnapshots() {
    if (!initialized && !adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (areaManager) await areaManager.assertCurrent();
    if (typeof adapter?.listSnapshots === 'function') {
        return adapter.listSnapshots();
    }
    if (!isLocalStorageFallbackAdapter()) {
        throw new Error('Aktiver Persistenzadapter unterstuetzt listSnapshots() nicht.');
    }
    const archive = normalizeSnapshotListArchive(getItemSync(LOCAL_SNAPSHOT_ARCHIVE_KEY));
    return archive.snapshots.map(toSnapshotArchiveIndexEntry);
}

export async function readSnapshot(id) {
    if (!initialized && !adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (areaManager) await areaManager.assertCurrent();
    if (typeof adapter?.readPersistedSnapshot === 'function') return adapter.readPersistedSnapshot(String(id || ''));
    if (typeof adapter?.readSnapshot === 'function') {
        return adapter.readSnapshot(String(id || ''));
    }
    if (!isLocalStorageFallbackAdapter()) {
        throw new Error('Aktiver Persistenzadapter unterstuetzt readSnapshot() nicht.');
    }
    const snapshotId = String(id || '');
    const archive = normalizeSnapshotListArchive(getItemSync(LOCAL_SNAPSHOT_ARCHIVE_KEY));
    const snapshot = archive.snapshots.find(entry => String(entry?.id || '') === snapshotId);
    if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} wurde nicht gefunden.`);
    }
    return snapshot;
}

export async function writeSnapshot(snapshot, options = {}) {
    probelaufProtection?.snapshot?.(snapshot.id, options);
    const lifecycle = createNavigationOperationLifecycle({ guard: options.guard ?? (globalThis.document ? getPageNavigationGuard() : null) });
    return lifecycle.run(options, async operation => {
        if (!options.navigationOperation) operation.commit();
        return persistentWrite(flushOwned => writeSnapshotImpl(snapshot, options, flushOwned), options);
    });
}

async function writeSnapshotImpl(snapshot, options, flushOwned) {
    probelaufProtection?.snapshot?.(snapshot.id, options);
    if (typeof adapter?.writeSnapshot === 'function') {
        if (await adapter.writeSnapshot(snapshot) === false) throw new Error('PERSISTENCE_SNAPSHOT_WRITE_FAILED');
        return true;
    }
    if (!isLocalStorageFallbackAdapter()) {
        throw new Error('Aktiver Persistenzadapter unterstuetzt writeSnapshot() nicht.');
    }
    const archive = normalizeSnapshotListArchive(getItemSync(LOCAL_SNAPSHOT_ARCHIVE_KEY));
    const snapshotId = String(snapshot?.id || '');
    if (!snapshotId) {
        throw new Error('Snapshot-ID fehlt.');
    }
    const nextSnapshots = archive.snapshots.filter(entry => String(entry?.id || '') !== snapshotId);
    nextSnapshots.push(snapshot);
    setItemSync(LOCAL_SNAPSHOT_ARCHIVE_KEY, serializeSnapshotListArchive(nextSnapshots));
    await flushOwned();
    return true;
}

export async function deleteSnapshot(id, options = {}) {
    probelaufProtection?.snapshot?.(id, options);
    const lifecycle = createNavigationOperationLifecycle({ guard: options.guard ?? (globalThis.document ? getPageNavigationGuard() : null) });
    return lifecycle.run(options, async operation => {
        operation.commit();
        return persistentWrite(flushOwned => deleteSnapshotImpl(id, options, flushOwned), options);
    });
}

async function deleteSnapshotImpl(id, options, flushOwned) {
    probelaufProtection?.snapshot?.(id, options);
    if (typeof adapter?.deleteSnapshot === 'function') {
        if (await adapter.deleteSnapshot(String(id || '')) === false) throw new Error('PERSISTENCE_SNAPSHOT_DELETE_FAILED');
        return true;
    }
    if (!isLocalStorageFallbackAdapter()) {
        throw new Error('Aktiver Persistenzadapter unterstuetzt deleteSnapshot() nicht.');
    }
    const snapshotId = String(id || '');
    const archive = normalizeSnapshotListArchive(getItemSync(LOCAL_SNAPSHOT_ARCHIVE_KEY));
    const nextSnapshots = archive.snapshots.filter(entry => String(entry?.id || '') !== snapshotId);
    if (nextSnapshots.length === archive.snapshots.length) return false;
    setItemSync(LOCAL_SNAPSHOT_ARCHIVE_KEY, serializeSnapshotListArchive(nextSnapshots));
    await flushOwned();
    return true;
}

export async function migrateLegacySnapshotsIfNeeded() {
    if (!initialized && !adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (areaManager) await areaManager.assertCurrent();
    if (typeof adapter?.migrateLegacySnapshotsIfNeeded === 'function') {
        return adapter.migrateLegacySnapshotsIfNeeded();
    }
    if (isLocalStorageFallbackAdapter()) {
        return { migratedCount: 0, skippedCount: 0, notStandardRestorableCount: 0, errors: [] };
    }
    throw new Error('Aktiver Persistenzadapter unterstuetzt migrateLegacySnapshotsIfNeeded() nicht.');
}

export async function replaceLiveRecords(records, options = {}) {
    probelaufProtection?.mutation?.(options);
    // Fachkoordinatoren reichen ihren Besitzer explizit weiter. Bestehende
    // andere Domänen behalten ihre äußere Sperre ohne implizite Neuregistrierung.
    const lifecycle = createNavigationOperationLifecycle({ guard: options.guard ?? null });
    return lifecycle.run(options, async operation => {
        return persistentWrite(flushOwned => {
            probelaufProtection?.mutation?.(options);
            return replaceLiveRecordsImpl(records, { ...options, navigationOperation: operation }, flushOwned);
        }, options);
    });
}

async function replaceLiveRecordsImpl(records, options = {}, flushOwned) {
    clearScheduledFlush();
    await flushOwned();
    options.navigationOperation.check();
    options.navigationOperation.commit();

    const allowKey = typeof options.allowKey === 'function' ? options.allowKey : () => true;
    const requestedDeleteKeys = Array.isArray(options.deleteKeys) ? options.deleteKeys.map(key => String(key)) : [];
    const requestedUpserts = Array.isArray(options.upserts)
        ? options.upserts.map(([key, value]) => [String(key), value])
        : Object.entries(records || {});

    const deleteKeys = requestedDeleteKeys.filter(key => allowKey(key, options));
    const upserts = requestedUpserts
        .filter(([key, value]) => value !== null && value !== undefined && allowKey(String(key), options))
        .map(([key, value]) => [String(key), String(value)]);

    if (typeof adapter?.replaceLiveRecords === 'function') {
        const result = await adapter.replaceLiveRecords(records, { ...options, deleteKeys, upserts, allowKey });
        if (result?.ok === false) {
            throw new Error(result.message || 'Der Persistenzadapter hat den Replace-Vorgang abgewiesen.');
        }
        deleteKeys.forEach(key => {
            delete memCache[key];
        });
        upserts.forEach(([key, value]) => {
            memCache[key] = value;
        });
        dirtyKeys.clear();
        deletedKeys.clear();
        lastFlushError = null;
        return result ?? { ok: true, deletedCount: deleteKeys.length, upsertCount: upserts.length };
    }

    const affectedKeys = new Set([...deleteKeys, ...upserts.map(([key]) => key)]);
    const backup = Object.create(null);
    affectedKeys.forEach(key => {
        if (hasOwn(memCache, key)) backup[key] = memCache[key];
    });

    deleteKeys.forEach(key => {
        delete memCache[key];
    });
    upserts.forEach(([key, value]) => {
        memCache[key] = value;
    });
    dirtyKeys.clear();
    deletedKeys.clear();

    try {
        await requireAdapterMethod('saveBatch')({ deletes: deleteKeys, upserts });
        lastFlushError = null;
        return { ok: true, deletedCount: deleteKeys.length, upsertCount: upserts.length };
    } catch (err) {
        affectedKeys.forEach(key => {
            if (hasOwn(backup, key)) {
                memCache[key] = backup[key];
            } else {
                delete memCache[key];
            }
        });
        dirtyKeys.clear();
        deletedKeys.clear();
        lastFlushError = err;
        throw err;
    }
}

async function flushOwned() {
    clearScheduledFlush();
    if (!initialized) return true;
    if (dirtyKeys.size === 0 && deletedKeys.size === 0) return true;
    const batch = {
        upserts: Array.from(dirtyKeys).map(key => [key, memCache[key]]),
        deletes: Array.from(deletedKeys)
    };
    dirtyKeys.clear();
    deletedKeys.clear();
    try {
        await adapter.saveBatch(batch);
        lastFlushError = null;
        return true;
    } catch (err) {
        batch.upserts.forEach(([key]) => {
            if (!deletedKeys.has(key)) {
                dirtyKeys.add(key);
            }
        });
        batch.deletes.forEach(key => {
            if (!dirtyKeys.has(key)) {
                deletedKeys.add(key);
            }
        });
        lastFlushError = err;
        throw err;
    }
}

export async function flush(options = {}) {
    clearScheduledFlush();
    if (!initialized) return true;
    // Der Koordinator reicht seinen privaten Besitz ausdrücklich weiter. Er darf
    // nicht hinter einem Lifecycleflush auf seinen eigenen äußeren Lock warten.
    if (probelaufProtection?.ownsWrites?.(options)) return persistentWrite(flushOwned, options);
    const run = () => persistentWrite(flushOwned, options, () => dirtyKeys.size > 0 || deletedKeys.size > 0);
    const queuedFlush = flushChain.then(run, run);
    flushChain = queuedFlush.catch(() => true);
    return queuedFlush;
}

export function getDirtyState() {
    return {
        dirtyKeys: Array.from(dirtyKeys),
        deletedKeys: Array.from(deletedKeys),
        lastFlushError
    };
}

export function getPersistenceStatus() {
    return {
        initialized,
        activeArea: areaControl.activeArea,
        areaControl: { ...areaControl },
        reloadRequired: areaReloadRequired,
        backend: adapter?.name || 'unknown',
        recordCount: initialized ? Object.keys(memCache).length : keysSync().length,
        migrationWarning,
        areaWarning,
        lastFlushError
    };
}

export async function getMetadata(key) {
    if (!initialized && !adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (areaManager) await areaManager.assertCurrent();
    return adapter.readMetadata?.(key) ?? null;
}

/** Gerätepräferenzen liegen bisher direkt im Web Storage. */
export async function captureNewBeginningPreferences(win = persistenceWindow) {
    if (!initialized && !adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (areaManager) await areaManager.assertCurrent();
    const { isSnapshotTechnicalKey } = await import('./persistence-key-policy.js');
    const storage = scopeWebStorage(win?.localStorage, areaControl.activeArea), result = Object.create(null);
    for (let i = 0; i < (storage?.length || 0); i++) {
        const key = storage.key(i);
        if (isSnapshotTechnicalKey(key)) result[key] = storage.getItem(key);
    }
    return result;
}

/** Alte Migrationskopien dürfen nach dem Leerstart nicht wieder lebendig werden.
 * Fachrecords werden ausschließlich durch den Adapter ersetzt. */
export async function resetNewBeginningBrowserStorage({ window: win = persistenceWindow, deleteSnapshots = false,
    records = {}, navigationOperation } = {}) {
    if (!initialized && !adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (areaManager) await areaManager.assertCurrent();
    const { isAllowedPersistenceImportKey, isSnapshotTechnicalKey } = await import('./persistence-key-policy.js');
    navigationOperation?.check();
    const owned = key => isAllowedPersistenceImportKey(key) || isSnapshotTechnicalKey(key)
        || key === PROBELAUF_STATE_KEY || deleteSnapshots && key === LOCAL_SNAPSHOT_ARCHIVE_KEY;
    const local = scopeWebStorage(win?.localStorage, areaControl.activeArea);
    // Der Fallback-Hauptspeicher wurde bereits transaktional geschrieben.
    if (local && !isLocalStorageFallbackAdapter()) {
        const keys = Array.from({ length: local.length }, (_, i) => local.key(i)).filter(owned);
        keys.forEach(key => local.removeItem(key));
        for (const [key, value] of Object.entries(records)) if (isSnapshotTechnicalKey(key)) local.setItem(key, value);
        for (const key of keys) {
            if (local.getItem(key) !== (isSnapshotTechnicalKey(key) ? records[key] ?? null : null)) throw new Error('Browser-Einstellungen konnten nicht bestätigt werden.');
        }
    }
    const session = areaSessionStorage(win?.sessionStorage);
    if (session) {
        const keys = Array.from({ length: session.length }, (_, i) => session.key(i))
            .filter(key => owned(key) || key.startsWith('rs_') || key.startsWith('balance.annual-retry.'));
        keys.forEach(key => session.removeItem(key));
        if (keys.some(key => session.getItem(key) !== null)) throw new Error('Sitzungseinstellungen konnten nicht gelöscht werden.');
    }
}

/** Auch gewöhnliche Eingaben ohne eigenen Dirty-Provider verwerfen einen Reload. */
export function observeInputChanges(notify, doc = globalThis.document) {
    if (!doc?.addEventListener) return () => {};
    doc.addEventListener('input', notify, true);
    doc.addEventListener('change', notify, true);
    return () => {
        doc.removeEventListener?.('input', notify, true);
        doc.removeEventListener?.('change', notify, true);
    };
}

export function bindLifecycleFlush(doc = globalThis.document, win = globalThis.window) {
    if (lifecycleBindings.length > 0) return;
    const requestFlush = () => {
        if (areaReloadRequired) return;
        flush().catch(err => console.error('[PersistenceFacade] lifecycle flush failed:', err));
    };
    const visibilityHandler = () => {
        if (doc.visibilityState === 'hidden') requestFlush();
    };
    if (doc?.addEventListener) {
        doc.addEventListener('visibilitychange', visibilityHandler);
        lifecycleBindings.push({ target: doc, type: 'visibilitychange', handler: visibilityHandler });
    }
    if (win?.addEventListener) {
        win.addEventListener('pagehide', requestFlush);
        lifecycleBindings.push({ target: win, type: 'pagehide', handler: requestFlush });
    }
    bindTauriClose(doc, win);
}

/** Der EXE-Hook ist unabhängig von den bestmöglichen Browser-Speicherhooks. */
export function bindTauriClose(doc = globalThis.document, win = globalThis.window) {
    if (tauriCloseBinding || !win?.__TAURI__?.event?.listen || !win?.__TAURI__?.core?.invoke) return;
    const bindToken = lifecycleBindToken;
    const invoke = (attemptId, response) => win.__TAURI__.core.invoke('confirm_app_close', { attemptId, response });
    const binding = { pending: null, lastId: 0n, disposed: false, unlisten: null, rejections: new Map() };
    const scheduleRetry = win.setTimeout?.bind(win) || globalThis.setTimeout;
    const clearRetry = win.clearTimeout?.bind(win) || globalThis.clearTimeout;
    tauriCloseBinding = binding;
    const current = request => !binding.disposed && bindToken === lifecycleBindToken && binding.pending === request;
    const report = () => {
        const host = doc?.getElementById?.('suiteNavigationStatus');
        if (host) {
            host.hidden = false;
            host.textContent = 'Schließen abgebrochen: Die Daten konnten nicht sicher gespeichert oder die Schließfreigabe nicht bestätigt werden. Bitte erneut versuchen.';
        }
    };
    // Ein verlorenes reject darf Held nicht dauerhaft belegen. Wiederholt wird
    // ausschließlich die Ablehnung dieser Kennung, niemals eine Schließfreigabe.
    binding.reject = id => {
        const existing = binding.rejections.get(id);
        if (existing) return existing.promise;
        const task = { promise: null, timer: null };
        binding.rejections.set(id, task);
        task.promise = Promise.resolve().then(() => invoke(id, 'reject')).then(() => {
            binding.rejections.delete(id); // Auch false: Versuch ist bereits ungültig.
        }).catch(error => {
            console.error('[PersistenceFacade] Tauri close rejection failed:', error);
            if (binding.disposed || bindToken !== lifecycleBindToken) {
                binding.rejections.delete(id);
                return;
            }
            report();
            task.timer = scheduleRetry(() => {
                binding.rejections.delete(id);
                binding.reject(id);
            }, 250);
        });
        return task.promise;
    };
    binding.cancelPending = () => {
        const request = binding.pending;
        if (!request) return;
        binding.pending = null;
        request.controller.abort();
        if (request.attempt) request.guard.end(request.attempt);
        if (request.held) return binding.reject(request.id);
    };
    binding.dispose = () => {
        binding.disposed = true;
        win.removeEventListener?.('pagehide', binding.cancelPending);
        for (const task of binding.rejections.values()) clearRetry(task.timer);
        binding.rejections.clear();
        binding.cancelPending();
    };
    // Erst pagehide bestätigt den Dokumentwechsel; ein abgelehnter
    // beforeunload-Hinweis muss die lebende Nachfrage unverändert lassen.
    win.addEventListener?.('pagehide', binding.cancelPending);
    const handler = async event => {
        const id = event?.payload?.attemptId;
        if (binding.disposed || binding.pending || typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) return;
        if (BigInt(id) <= binding.lastId) return;
        binding.lastId = BigInt(id);
        const request = { id, controller: new AbortController(), guard: null, attempt: null };
        binding.pending = request;
        let held = false, allowed = false;
        try {
            // Vor bestätigter Übernahme weder Dialog, Abbruch noch Flush starten.
            held = await invoke(id, 'hold') === true;
            request.held = held;
            if (!held || !current(request)) return;
            request.guard = getPageNavigationGuard(doc, win);
            request.attempt = await request.guard.prepare({ intent: 'close', signal: request.controller.signal });
            if (!current(request) || !request.attempt) return;
            if (!request.guard.validate(request.attempt)) return;
            if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            if (!current(request) || !request.guard.validate(request.attempt)) return;
            allowed = await invoke(id, 'allow') === true;
            if (!allowed && current(request)) report();
        } catch (error) {
            if (current(request)) report();
            console.error('[PersistenceFacade] Tauri close failed:', error);
        } finally {
            if (request.attempt) request.guard.end(request.attempt);
            // Rust kann nach reject bereits die nächste Kennung senden, während
            // deren Vorgänger noch auf die IPC-Antwort wartet. Dessen JS-Bindung
            // vorher lösen; alte Antworten dürfen den neuen Versuch nicht belegen.
            if (binding.pending === request) binding.pending = null;
            if (held && !allowed) {
                await binding.reject(id);
            }
        }
    };
    Promise.resolve().then(() => win.__TAURI__.event.listen('ruhestand://close-requested', handler))
        .then(unlisten => {
            if (!binding.disposed && bindToken === lifecycleBindToken) binding.unlisten = unlisten;
            else unlisten?.();
        })
        .catch(error => {
            binding.dispose();
            if (tauriCloseBinding === binding) tauriCloseBinding = null;
            console.error('[PersistenceFacade] Tauri close listener failed:', error);
        });
}

export function unbindLifecycleFlush() {
    lifecycleBindToken += 1;
    const close = tauriCloseBinding;
    tauriCloseBinding = null;
    if (close) {
        close.dispose();
        try { close.unlisten?.(); }
        catch (error) { console.error('[PersistenceFacade] Failed to unbind close listener:', error); }
    }
    lifecycleBindings.forEach(({ target, type, handler }) => {
        target?.removeEventListener?.(type, handler);
    });
    lifecycleBindings.forEach(({ unlisten }) => {
        try {
            unlisten?.();
        } catch (err) {
            console.error('[PersistenceFacade] Failed to unbind lifecycle listener:', err);
        }
    });
    lifecycleBindings = [];
}

export function resetPersistenceForTests(nextAdapter = createLocalStorageAdapter()) {
    syncWriteBlocks.clear();
    probelaufProtection = null;
    persistenceWindow = globalThis.window;
    fallbackWriteChain = null;
    clearScheduledFlush();
    unbindLifecycleFlush();
    adapter.close?.();
    areaManager = null;
    areaControl = { activeArea: 'echt' };
    areaReloadRequired = false;
    synchronousAreaResolved = false;
    synchronousStorage = null;
    synchronousControlRaw = null;
    setStorageArea('echt');
    adapter = nextAdapter;
    adapterExplicitlyConfigured = true;
    memCache = Object.create(null);
    initialized = false;
    initPromise = null;
    dirtyKeys = new Set();
    deletedKeys = new Set();
    flushTimer = null;
    debounceMs = DEFAULT_DEBOUNCE_MS;
    lastFlushError = null;
    flushChain = Promise.resolve();
    migrationWarning = null;
    areaWarning = null;
    lifecycleBindToken += 1;
}

export function resetPersistenceRuntimeForTests() {
    resetPersistenceForTests(createLocalStorageAdapter());
    adapterExplicitlyConfigured = false;
    setStorageArea(null);
}

/** Nur lesend, auch Migrationen und Quarantäne sind hier ausgeschlossen. */
export async function readRealRecords() {
    await init();
    if (!areaManager) throw new Error('Speicherbereiche benötigen einen Laufzeitadapter.');
    return toNullPrototypeRecords(await areaManager.readRealRecords());
}

export async function readRealSnapshots() {
    await init();
    if (!areaManager) throw new Error('Speicherbereiche benötigen einen Laufzeitadapter.');
    return areaManager.readRealSnapshots();
}

/** Fundament für SB-2: Nach Aktivieren/Verwerfen ist ein Dokumentneustart nötig. */
export async function activatePlayArea(input, options = {}) {
    await init();
    if (!areaManager || areaControl.activeArea !== 'echt') throw new Error('Spielbereich kann hier nicht aktiviert werden.');
    const activate = async () => {
        if (dirtyKeys.size || deletedKeys.size) throw new Error('Bitte zuerst die echten Eingaben speichern.');
        areaReloadRequired = true;
        try { await areaManager.activate(input); }
        catch (error) { areaReloadRequired = false; throw error; }
    };
    return probelaufProtection?.ownsWrites?.(options) ? activate() : withProbelaufOperation(activate);
}

export async function discardPlayArea(options = {}) {
    await init();
    if (!areaManager || areaControl.activeArea !== 'spiel') throw new Error('Kein Spielbereich aktiv.');
    const discard = async () => {
        areaReloadRequired = true;
        clearScheduledFlush();
        dirtyKeys.clear();
        deletedKeys.clear();
        await areaManager.discard(adapter);
    };
    return probelaufProtection?.ownsWrites?.(options) ? discard() : withProbelaufOperation(discard);
}

/** Einziger Schreibweg vom Spielbereich in den echten Bestand. */
export async function adoptPlayArea({ state, expectedPlayChecksum, now = new Date() }, options = {}) {
    await init();
    if (!areaManager || areaControl.activeArea !== 'spiel' || state?.version !== 2 || state.phase !== 'active'
        || !probelaufProtection?.ownsWrites?.(options)) throw new Error('Übernehmen ist hier gesperrt.');
    const [{ buildProbelaufTransferRecords, probelaufDomainChecksum }, { probelaufTransferability, calculateProbelaufEndReview }, { SnapshotArchive, SNAPSHOT_KINDS }] = await Promise.all([
        import('./probelauf-records.js'), import('./probelauf-comparison.js'), import('./snapshot-archive.js')
    ]);
    const allowKey = key => key !== PROBELAUF_STATE_KEY && key !== LOCAL_SNAPSHOT_ARCHIVE_KEY;
    const playRecords = await readPersistedRecords();
    if (playRecords[PROBELAUF_STATE_KEY] !== JSON.stringify(state)
        || expectedPlayChecksum !== probelaufDomainChecksum(playRecords)) throw new Error('Deine Spieländerungen haben sich seit der Bestätigung geändert. Bitte erneut vergleichen.');
    const realRecords = await readRealRecords();
    const eligibility = probelaufTransferability(state, realRecords);
    if (!eligibility.eligible) throw new Error(eligibility.reason === 'date' ? 'Nach Zeitsprüngen nicht übernehmbar.'
        : eligibility.reason === 'demo' ? `Die Beispieldaten von ${musterHaushalt(state.householdId).name} sind nicht übernehmbar.` : 'Deine echten Daten wurden seit dem Start geändert. Bitte erneut vergleichen.');
    const target = buildProbelaufTransferRecords(realRecords, playRecords);
    const review = await calculateProbelaufEndReview({ state, realRecords, playRecords: target, now });
    const transfer = await areaManager.openRealTransfer();
    const real = transfer.adapter;
    const read = async (policy = () => true) => Object.fromEntries(Object.entries(await (real.readPersistedRecords ? real.readPersistedRecords() : real.loadAll())).filter(([key]) => policy(key)));
    const storage = {
        flush: async () => true,
        readPersistedRecords: read,
        captureRecordsByPolicy: async policy => Object.fromEntries(Object.entries(await real.loadAll()).filter(([key]) => policy(key))),
        async replaceLiveRecords(records, plan) {
            const current = await read();
            await real.saveBatch({ deletes: plan.deleteKeys, upserts: plan.upserts.filter(([key, value]) => current[key] !== value) });
        },
        async writeSnapshot(point) {
            if (real.writeSnapshot) return real.writeSnapshot(point);
            const records = await read(), archive = normalizeSnapshotListArchive(records[LOCAL_SNAPSHOT_ARCHIVE_KEY]);
            await real.saveBatch({ deletes: [], upserts: [[LOCAL_SNAPSHOT_ARCHIVE_KEY, serializeSnapshotListArchive([...archive.snapshots, point])]] });
        },
        async readSnapshot(id) {
            if (real.readPersistedSnapshot) return real.readPersistedSnapshot(id);
            if (real.readSnapshot) return real.readSnapshot(id);
            return normalizeSnapshotListArchive((await read())[LOCAL_SNAPSHOT_ARCHIVE_KEY]).snapshots.find(point => point.id === id);
        }
    };
    let replacing = false;
    try {
        const before = Object.fromEntries(Object.entries(realRecords).filter(([key]) => allowKey(key)));
        if (JSON.stringify(Object.entries(await read(allowKey)).sort()) !== JSON.stringify(Object.entries(before).sort())) throw new Error('Der echte Bestand hat sich während der Prüfung geändert.');
        options.navigationOperation.check();
        const snapshot = await SnapshotArchive.createSnapshot({ id: `before_play_transfer_${globalThis.crypto.randomUUID()}`,
            kind: SNAPSHOT_KINDS.probelaufTransferBefore, label: 'Vor Übernahme aus dem Spielbereich', records: before,
            activeProfileId: before.rs_current_profile || before.rs_active_profile || '',
            restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback', liveKeyMode: 'play-transfer' }
        }, { storage, navigationOperation: options.navigationOperation });
        const confirmed = await SnapshotArchive.readSnapshot(snapshot.id, { storage });
        if (JSON.stringify(confirmed) !== JSON.stringify(snapshot)) throw new Error('Der Wiederherstellungspunkt konnte nicht bestätigt werden.');
        // Dieselbe Transaktion wie bei Import/Zurückholen, auf dem echten Adapter.
        replacing = true;
        await replaceRecordsTransactionalWith(storage, target, { ...options, allowKey, expectedRecords: before });
        await areaManager.finishTransfer(adapter);
        areaReloadRequired = true;
        clearScheduledFlush(); dirtyKeys.clear(); deletedKeys.clear();
        return { changes: review.changes, monthlyBudget: review.play.monthlyBudget, year: review.play.year,
            snapshotId: snapshot.id, snapshotLabel: snapshot.label, savedAt: new Date().toISOString() };
    } catch (cause) {
        // Der Transaktionsrollback sichert Records. Dieser Schritt holt zusätzlich
        // die Originalbytes samt Backend-Zeitstempeln zurück.
        if (replacing && cause.code !== 'persistence_precondition_mismatch') {
            try { await transfer.rollback(); }
            catch (rollbackError) { throw Object.assign(new Error('Übernahme fehlgeschlagen. Der echte Bestand konnte nicht bestätigt werden; bitte Daten & Sicherung prüfen. Der Spielbereich bleibt erhalten.'), { cause, rollbackError, code: 'rollback_failed' }); }
        }
        if (cause.code === 'rollback_failed') throw cause;
        throw Object.assign(new Error(`Nicht übernommen: ${cause.message} Dein echter Bestand ist unverändert. Der Spielbereich bleibt erhalten.`), { cause });
    } finally { transfer.close(); }
}

export const PersistenceFacade = {
    readRealRecords,
    readRealSnapshots,
    activatePlayArea,
    discardPlayArea,
    adoptPlayArea,
    setProbelaufProtection,
    withProbelaufOperation,
    readPersistedRecords,
    blockSyncWrites,
    hasSyncWriteBlocks,
    observeInputChanges,
    configurePersistence,
    init,
    isInitialized,
    getItemSync,
    setItemSync,
    removeItemSync,
    clearAllowedSync,
    keysSync,
    keySync,
    clearSync,
    exportAllSync,
    importAll,
    replaceRecordsTransactional,
    listSnapshots,
    readSnapshot,
    writeSnapshot,
    deleteSnapshot,
    migrateLegacySnapshotsIfNeeded,
    replaceLiveRecords,
    flush,
    getDirtyState,
    getPersistenceStatus,
    getMetadata,
    captureNewBeginningPreferences,
    resetNewBeginningBrowserStorage,
    bindLifecycleFlush,
    bindTauriClose,
    unbindLifecycleFlush,
    resetPersistenceForTests,
    resetPersistenceRuntimeForTests
};

export const persistenceStorage = {
    getItem: getItemSync,
    setItem: setItemSync,
    removeItem: removeItemSync,
    clear: clearSync,
    key: keySync,
    get length() {
        return keysSync().length;
    }
};

export default PersistenceFacade;
