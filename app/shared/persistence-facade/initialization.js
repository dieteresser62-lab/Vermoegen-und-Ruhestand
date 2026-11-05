/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { clearScheduledFlush } from './batch-flush.js';
import { renderReloadRequiredNotice } from '../reload-required-notice.js';
import { storeState, hooks } from './state.js';
import { createPersistenceAreas } from '../persistence-areas.js';
import { setStorageArea, AREA_CONTROL_KEY, resolveLocalArea, takePendingAreaWarning } from '../persistence-area-storage.js';
import { HOUSEHOLD_REGISTRY_KEY } from '../household-registry.js';
import { toNullPrototypeRecords } from './record-format.js';
import { migrateLegacyLocalStorageToTargetIfNeeded } from './legacy-migration.js';
import { detectRuntime } from '../runtime-env.js';
import { createLocalStorageAdapter } from '../persistence-adapter-localstorage.js';

export function requireAreaReload(doc = globalThis.document, win = storeState.persistenceWindow) {
    storeState.areaReloadRequired = true;
    clearScheduledFlush();
    renderReloadRequiredNotice({ doc, win, id: 'storageAreaReloadNotice',
        message: 'Speicherbereich geändert. Bitte neu laden; Eingaben werden bis dahin nicht gespeichert.' });
}

/**
 * @param {I.InitOptions} [options]
 * @returns {void}
 */
export function configurePersistence(options = {}) {
    if (options.adapter) {
        storeState.adapter = options.adapter;
        storeState.adapterExplicitlyConfigured = true;
    }
    if (Number.isFinite(options.debounceMs)) storeState.debounceMs = Math.max(0, Number(options.debounceMs));
}

/**
 * @param {I.InitOptions} [options]
 * @returns {Promise<boolean>}
 */
export async function init(options = {}) {
    if (storeState.initPromise) return storeState.initPromise;
    if (options.adapter || Number.isFinite(options.debounceMs)) {
        configurePersistence(options);
    }
    storeState.persistenceWindow = options.window || globalThis.window;
    storeState.initPromise = (async () => {
        if (!storeState.adapterExplicitlyConfigured) {
            storeState.areaManager = createPersistenceAreas({ ...options, onAreaChanged: () => requireAreaReload(options.doc, options.window) });
            const resolved = await storeState.areaManager.resolve();
            storeState.adapter = /** @type {import('../../../typcheck/runtime-contracts.js').PersistenceAdapter} */ (/** @type {unknown} */ (resolved.adapter));
            storeState.areaControl = resolved.control;
            storeState.storageArea = resolved.storageArea;
            storeState.households = resolved.registry;
            storeState.areaWarning = storeState.areaWarning || resolved.warning || takePendingAreaWarning();
            setStorageArea(storeState.storageArea);
        }
        let loadedRecords;
        // Altbestände (unpräfigierter localStorage) gehören nur Haushalt 1.
        let skipLegacyMigration = Boolean(storeState.migrationWarning || storeState.areaWarning) || storeState.storageArea.startsWith('hh:');
        try {
            await storeState.adapter.open?.();
            loadedRecords = toNullPrototypeRecords(await storeState.adapter.loadAll());
        } catch (err) {
            if (/** @type {I.AppError} */ (err)?.code !== 'tauri-state-corrupt') throw err;
            skipLegacyMigration = true;
            loadedRecords = Object.create(null);
            storeState.migrationWarning = {
                code: 'tauri-state-corrupt',
                message: `${/** @type {I.AppError} */ (err).message || 'Tauri-Daten konnten nicht gelesen werden'} Bitte ein Backup importieren oder mit leerem Zustand fortfahren.`,
                quarantinePath: /** @type {I.AppError} */ (err).quarantinePath || ''
            };
        }
        const migrationResult = skipLegacyMigration
            ? { records: loadedRecords, warning: null }
            : await migrateLegacyLocalStorageToTargetIfNeeded(storeState.adapter, loadedRecords, { ...options,
                localStorage: storeState.areaManager ? storeState.areaManager.localStorage(storeState.storageArea) : options.localStorage });
        storeState.memCache = toNullPrototypeRecords(migrationResult.records);
        storeState.migrationWarning = storeState.migrationWarning || migrationResult.warning;
        storeState.initialized = true;
        if (options.installLifecycleHooks !== false) hooks.bindLifecycleFlush(options.doc, options.window);
        else if (options.installTauriCloseHook === true) hooks.bindTauriClose(options.doc, options.window);
        if (typeof globalThis.dispatchEvent === 'function') {
            try {
                const event = typeof globalThis.CustomEvent === 'function'
                    ? new globalThis.CustomEvent('persistence:initialized')
                    : { type: 'persistence:initialized' };
                globalThis.dispatchEvent(/** @type {Event} */ (event));
            } catch (e) {
                console.warn('[PersistenceFacade] Failed to dispatch initialization event:', e);
            }
        }
        return true;
    })();
    return storeState.initPromise;
}

export function isInitialized() {
    return storeState.initialized;
}

export function resolveSynchronousArea() {
    if (storeState.initialized || storeState.adapterExplicitlyConfigured) return true;
    // Tauri und IndexedDB warten auf init(); nur der Storage-Fallback ist synchron.
    if (detectRuntime() === 'tauri' || /** @type {Partial<IDBFactory> | undefined} */ (globalThis.indexedDB)?.open) return false;
    const storage = globalThis.window?.localStorage || globalThis.localStorage;
    if (storeState.synchronousAreaResolved && storage === storeState.synchronousStorage) {
        if (synchronousControlRaw(storage) !== storeState.synchronousControlRaw) {
            requireAreaReload();
            throw Object.assign(new Error('Speicherbereich geändert. Bitte neu laden.'), { code: 'PERSISTENCE_RELOAD_REQUIRED' });
        }
        return true;
    }
    const resolved = resolveLocalArea(storage);
    storeState.areaControl = resolved.control;
    storeState.storageArea = resolved.area;
    storeState.households = resolved.registry;
    storeState.areaWarning = resolved.warning;
    setStorageArea(storeState.storageArea);
    storeState.adapter = createLocalStorageAdapter(() => storage, { area: storeState.storageArea });
    storeState.synchronousStorage = storage;
    storeState.synchronousControlRaw = synchronousControlRaw(storage);
    storeState.synchronousAreaResolved = true;
    return true;
}

/** Steuerung und Haushaltsverzeichnis zusammen: jede Änderung verlangt ein Neuladen. @param {Storage | null | undefined} storage */
function synchronousControlRaw(storage) {
    return JSON.stringify([storage?.getItem(AREA_CONTROL_KEY) ?? null, storage?.getItem(HOUSEHOLD_REGISTRY_KEY) ?? null]);
}

export function assertAreaWritable() {
    if (storeState.areaReloadRequired || !resolveSynchronousArea()) {
        throw new Error('Speicherbereich noch nicht bereit oder geändert. Bitte neu laden.');
    }
}
