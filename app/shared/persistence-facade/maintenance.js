/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { storeState, PROBELAUF_STATE_KEY, LOCAL_SNAPSHOT_ARCHIVE_KEY, DEFAULT_DEBOUNCE_MS } from './state.js';
import { keysSync } from './cache.js';
import { init, assertAreaWritable } from './initialization.js';
import { scopeWebStorage, areaSessionStorage, setStorageArea } from '../persistence-area-storage.js';
import { isLocalStorageFallbackAdapter } from './record-format.js';
import { createLocalStorageAdapter } from '../persistence-adapter-localstorage.js';
import { clearScheduledFlush } from './batch-flush.js';
import { unbindLifecycleFlush } from './lifecycle.js';

export function getDirtyState() {
    return {
        dirtyKeys: Array.from(storeState.dirtyKeys),
        deletedKeys: Array.from(storeState.deletedKeys),
        lastFlushError: storeState.lastFlushError
    };
}

export function getPersistenceStatus() {
    return {
        initialized: storeState.initialized,
        activeArea: storeState.areaControl.activeArea,
        areaControl: { ...storeState.areaControl },
        storageArea: storeState.storageArea,
        householdId: storeState.households?.active || 'h1',
        reloadRequired: storeState.areaReloadRequired,
        backend: storeState.adapter?.name || 'unknown',
        recordCount: storeState.initialized ? Object.keys(storeState.memCache).length : keysSync().length,
        migrationWarning: storeState.migrationWarning,
        areaWarning: storeState.areaWarning,
        lastFlushError: storeState.lastFlushError
    };
}

/**
 * @param {string} key
 */
export async function getMetadata(key) {
    if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (storeState.areaManager) await storeState.areaManager.assertCurrent();
    return storeState.adapter.readMetadata?.(key) ?? null;
}

/** Gerätepräferenzen liegen bisher direkt im Web Storage. */
export async function captureNewBeginningPreferences(win = storeState.persistenceWindow) {
    if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (storeState.areaManager) await storeState.areaManager.assertCurrent();
    const { isSnapshotTechnicalKey } = await import("../persistence-key-policy.js");
    const storage = scopeWebStorage(win?.localStorage, storeState.storageArea), result = Object.create(null);
    for (let i = 0; i < (storage?.length || 0); i++) {
        const key = /** @type {Storage} */ (storage).key(i);
        if (isSnapshotTechnicalKey(key)) result[/** @type {string} */ (key)] = /** @type {Storage} */ (storage).getItem(/** @type {string} */ (key));
    }
    return result;
}

/** Alte Migrationskopien dürfen nach dem Leerstart nicht wieder lebendig werden.
 * Fachrecords werden ausschließlich durch den Adapter ersetzt.
 * @param {{window?: Window & typeof globalThis, deleteSnapshots?: boolean, records?: Record<string, string>, navigationOperation?: import('../../../typcheck/runtime-contracts.js').NavigationOperation}} [options] */
export async function resetNewBeginningBrowserStorage({ window: win = storeState.persistenceWindow, deleteSnapshots = false,
    records = {}, navigationOperation } = {}) {
    if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (storeState.areaManager) await storeState.areaManager.assertCurrent();
    const { isAllowedPersistenceImportKey, isSnapshotTechnicalKey } = await import("../persistence-key-policy.js");
    navigationOperation?.check();
    /** @param {string | null} key */
    const owned = key => isAllowedPersistenceImportKey(key) || isSnapshotTechnicalKey(key)
        || key === PROBELAUF_STATE_KEY || deleteSnapshots && key === LOCAL_SNAPSHOT_ARCHIVE_KEY;
    const local = scopeWebStorage(win?.localStorage, storeState.storageArea);
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
    const { clearProfilesBundleHandoff } = await import("../../profile/profile-bundle-io.js");
    clearProfilesBundleHandoff(win);
}

/**
 * @param {import('../../../typcheck/runtime-contracts.js').PersistenceAdapter} [nextAdapter]
 * @returns {void}
 */
export function resetPersistenceForTests(nextAdapter = createLocalStorageAdapter()) {
    storeState.documentWriteBlock = null;
    storeState.syncWriteBlocks.clear();
    storeState.beforeFlushObservers.clear();
    storeState.probelaufProtection = null;
    storeState.persistenceWindow = globalThis.window;
    storeState.fallbackWriteChain = null;
    clearScheduledFlush();
    unbindLifecycleFlush();
    storeState.adapter.close?.();
    storeState.areaManager = null;
    storeState.areaControl = { activeArea: 'echt' };
    storeState.storageArea = 'echt';
    storeState.households = null;
    storeState.areaReloadRequired = false;
    storeState.synchronousAreaResolved = false;
    storeState.synchronousStorage = null;
    storeState.synchronousControlRaw = null;
    setStorageArea('echt');
    storeState.adapter = nextAdapter;
    storeState.adapterExplicitlyConfigured = true;
    storeState.memCache = Object.create(null);
    storeState.initialized = false;
    storeState.initPromise = null;
    storeState.dirtyKeys = new Set();
    storeState.deletedKeys = new Set();
    storeState.keyVersions = new Map();
    storeState.flushTimer = null;
    storeState.debounceMs = DEFAULT_DEBOUNCE_MS;
    storeState.lastFlushError = null;
    storeState.flushChain = Promise.resolve();
    storeState.pendingFlushes = 0;
    storeState.migrationWarning = null;
    storeState.areaWarning = null;
    storeState.lifecycleBindToken += 1;
}

export function resetPersistenceRuntimeForTests() {
    resetPersistenceForTests(createLocalStorageAdapter());
    storeState.adapterExplicitlyConfigured = false;
    setStorageArea(null);
}
