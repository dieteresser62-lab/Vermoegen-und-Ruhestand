/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { init, assertAreaWritable } from './initialization.js';
import { isLocalStorageFallbackAdapter, normalizeSnapshotListArchive, toSnapshotArchiveIndexEntry, serializeSnapshotListArchive } from './record-format.js';
import { getItemSync, setItemSync } from './cache.js';
import { LOCAL_SNAPSHOT_ARCHIVE_KEY, storeState } from './state.js';
import { createNavigationOperationLifecycle } from '../navigation-guard.js';
import { getPageNavigationGuard } from '../navigation-guard-dialog.js';
import { persistentWrite } from './writes.js';

export async function listSnapshots() {
    if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (storeState.areaManager) await storeState.areaManager.assertCurrent();
    if (typeof storeState.adapter?.listSnapshots === 'function') {
        return storeState.adapter.listSnapshots();
    }
    if (!isLocalStorageFallbackAdapter()) {
        throw new Error('Aktiver Persistenzadapter unterstuetzt listSnapshots() nicht.');
    }
    const archive = normalizeSnapshotListArchive(getItemSync(LOCAL_SNAPSHOT_ARCHIVE_KEY));
    return archive.snapshots.map(toSnapshotArchiveIndexEntry);
}

/**
 * @param {string} id
 * @returns {Promise<D.Snapshot>}
 */
export async function readSnapshot(id) {
    if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (storeState.areaManager) await storeState.areaManager.assertCurrent();
    if (typeof storeState.adapter?.readPersistedSnapshot === 'function') return storeState.adapter.readPersistedSnapshot(String(id || ''));
    if (typeof storeState.adapter?.readSnapshot === 'function') {
        return storeState.adapter.readSnapshot(String(id || ''));
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

/**
 * Liest mehrere Punkte. Die Windows-App liest die Punktedatei dafür einmal statt einmal je Punkt.
 * @param {string[]} ids
 * @returns {Promise<D.Snapshot[]>}
 */
export async function readSnapshots(ids) {
    const wanted = ids.map(id => String(id || ''));
    if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
    if (typeof storeState.adapter?.readPersistedSnapshots !== 'function') return Promise.all(wanted.map(readSnapshot));
    assertAreaWritable();
    if (storeState.areaManager) await storeState.areaManager.assertCurrent();
    const byId = new Map((await storeState.adapter.readPersistedSnapshots()).map(point => [String(point?.id || ''), point]));
    // Nicht gefundene Kennungen laufen über das Einzellesen mit Altbestandsumzug und Fehlermeldung.
    return Promise.all(wanted.map(id => byId.get(id) || readSnapshot(id)));
}

/**
 * @param {D.Snapshot} snapshot
 * @param {I.ReplaceOptions} [options]
 * @returns {Promise<boolean>}
 */
export async function writeSnapshot(snapshot, options = {}) {
    storeState.probelaufProtection?.snapshot?.(snapshot.id, options);
    const lifecycle = /** @type {I.CreateLifecycle} */ (createNavigationOperationLifecycle)({ guard: options.guard ?? (globalThis.document ? getPageNavigationGuard() : null) });
    return lifecycle.run(options, async operation => {
        if (!options.navigationOperation) operation.commit();
        return persistentWrite(flushOwned => writeSnapshotImpl(snapshot, options, flushOwned), options);
    });
}

/**
 * @param {D.Snapshot} snapshot
 * @param {I.ReplaceOptions} options
 * @param {() => Promise<boolean>} flushOwned
 * @returns {Promise<boolean>}
 */
export async function writeSnapshotImpl(snapshot, options, flushOwned) {
    storeState.probelaufProtection?.snapshot?.(snapshot.id, options);
    if (typeof storeState.adapter?.writeSnapshot === 'function') {
        if (await storeState.adapter.writeSnapshot(snapshot) === false) throw new Error('PERSISTENCE_SNAPSHOT_WRITE_FAILED');
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

/**
 * @param {string} id
 * @param {I.ReplaceOptions} [options]
 * @returns {Promise<boolean>}
 */
export async function deleteSnapshot(id, options = {}) {
    storeState.probelaufProtection?.snapshot?.(id, options);
    const lifecycle = /** @type {I.CreateLifecycle} */ (createNavigationOperationLifecycle)({ guard: options.guard ?? (globalThis.document ? getPageNavigationGuard() : null) });
    return lifecycle.run(options, async operation => {
        operation.commit();
        return persistentWrite(flushOwned => deleteSnapshotImpl(id, options, flushOwned), options);
    });
}

/**
 * @param {string} id
 * @param {I.ReplaceOptions} options
 * @param {() => Promise<boolean>} flushOwned
 * @returns {Promise<boolean>}
 */
export async function deleteSnapshotImpl(id, options, flushOwned) {
    storeState.probelaufProtection?.snapshot?.(id, options);
    if (typeof storeState.adapter?.deleteSnapshot === 'function') {
        if (await storeState.adapter.deleteSnapshot(String(id || '')) === false) throw new Error('PERSISTENCE_SNAPSHOT_DELETE_FAILED');
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
    if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (storeState.areaManager) await storeState.areaManager.assertCurrent();
    if (typeof storeState.adapter?.migrateLegacySnapshotsIfNeeded === 'function') {
        return storeState.adapter.migrateLegacySnapshotsIfNeeded();
    }
    if (isLocalStorageFallbackAdapter()) {
        return { migratedCount: 0, skippedCount: 0, notStandardRestorableCount: 0, errors: [] };
    }
    throw new Error('Aktiver Persistenzadapter unterstuetzt migrateLegacySnapshotsIfNeeded() nicht.');
}
