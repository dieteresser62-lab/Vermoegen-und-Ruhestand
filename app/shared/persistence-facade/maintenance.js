/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { storeState, PROBELAUF_STATE_KEY, DEFAULT_DEBOUNCE_MS, assertDocumentWritable } from './state.js';
import { keysSync } from './cache.js';
import { init, assertAreaWritable } from './initialization.js';
import { scopeWebStorage, areaSessionStorage, setStorageArea } from '../persistence-area-storage.js';
import { isLocalStorageFallbackAdapter } from './record-format.js';
import { createLocalStorageAdapter } from '../persistence-adapter-localstorage.js';
import { clearScheduledFlush } from './batch-flush.js';
import { unbindLifecycleFlush } from './lifecycle.js';
import { persistentWrite } from './writes.js';

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

/** Technische Markierung des geöffneten Bereichs außerhalb der Fachrecords (nicht in Vollsicherung oder Spielkopie).
 * SV-1c: Lesen und Schreiben laufen in der gemeinsamen Schreibreihenfolge der Fachrecords, nicht daneben.
 * @param {string} key @param {(current: unknown) => unknown} update liefert den neuen Wert oder `undefined` für „unverändert“
 * @param {I.ReplaceOptions} [options] @returns {Promise<boolean>} `false`, wenn der Speicher keine Markierungen kennt. */
export async function updateMetadata(key, update, options = {}) {
    if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    assertDocumentWritable();
    if (typeof storeState.adapter.writeMetadata !== 'function') return false;
    return persistentWrite(async () => {
        // Der Adapter zum Zeitpunkt des Schreibens; die Schreibreihenfolge hat inzwischen den Bereich geprüft.
        const adapter = storeState.adapter, write = adapter.writeMetadata?.bind(adapter);
        if (!write) return false;
        const next = update(await adapter.readMetadata?.(key) ?? null);
        if (next !== undefined) await write(key, next);
        return true;
    }, options);
}

/** @param {string} key @param {unknown} value @param {I.ReplaceOptions} [options] @returns {Promise<boolean>} */
export function setMetadata(key, value, options = {}) {
    return updateMetadata(key, () => value, options);
}

/** Alte Migrationskopien dürfen nach dem Leerstart nicht wieder lebendig werden.
 * Fachrecords werden ausschließlich durch den Adapter ersetzt.
 * @param {{window?: Window & typeof globalThis, navigationOperation?: import('../../../typcheck/runtime-contracts.js').NavigationOperation}} [options] */
export async function resetNewBeginningBrowserStorage({ window: win = storeState.persistenceWindow, navigationOperation } = {}) {
    if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (storeState.areaManager) await storeState.areaManager.assertCurrent();
    const { isAllowedPersistenceImportKey, isSnapshotTechnicalKey } = await import("../persistence-key-policy.js");
    navigationOperation?.check();
    /** @param {string | null} key */
    const owned = key => isAllowedPersistenceImportKey(key) || isSnapshotTechnicalKey(key) || key === PROBELAUF_STATE_KEY;
    const local = scopeWebStorage(win?.localStorage, storeState.storageArea);
    // Der Fallback-Hauptspeicher wurde bereits transaktional geschrieben.
    if (local && !isLocalStorageFallbackAdapter()) {
        const keys = Array.from({ length: local.length }, (_, i) => local.key(i)).filter(owned);
        keys.forEach(key => local.removeItem(key));
        if (keys.some(key => local.getItem(key) !== null)) throw new Error('Browser-Einstellungen konnten nicht bestätigt werden.');
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
    storeState.writeGate = null;
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
