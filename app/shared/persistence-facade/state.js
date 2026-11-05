/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { createLocalStorageAdapter } from '../persistence-adapter-localstorage.js';
import { createPersistenceAreas } from '../persistence-areas.js';

export const PROBELAUF_STATE_KEY = 'rs_probelauf_state_v1';

export const DEFAULT_DEBOUNCE_MS = 250;

export const INDEXEDDB_MIGRATION_TARGET = 'indexeddb';

export const TAURI_MIGRATION_TARGET = 'tauri-json-file';

export const LEGACY_MIGRATION_MARKER_KEYS = Object.freeze({
    target: 'ruhestandsapp_migrated_to_target',
    completedAt: 'ruhestandsapp_migration_completed_at',
    checksum: 'ruhestandsapp_migration_checksum'
});

export const LOCAL_SNAPSHOT_ARCHIVE_KEY = 'rs_snapshot_archive_v1';

export const LOCAL_SNAPSHOT_ARCHIVE_SCHEMA_VERSION = 1;

export const MARKER_KEY_SET = new Set(Object.values(LEGACY_MIGRATION_MARKER_KEYS));

export const storeState = {
    /** @type {ReturnType<typeof createPersistenceAreas> | null} */
    areaManager: null,

    /** @type {{activeArea: string; [key: string]: unknown}} */
    areaControl: { activeArea: 'echt' },

    /** Tatsächlicher Speicherbereich: echt, spiel oder hh:<Kennung> (HV-1). */
    storageArea: 'echt',

    /** @type {ReturnType<typeof import('../household-registry.js').defaultHouseholdRegistry> | null} */
    households: null,

    areaReloadRequired: false,

    synchronousAreaResolved: false,

    /** @type {Storage | null} */
    synchronousStorage: null,

    /** @type {string | null} */
    synchronousControlRaw: null,

    /** @type {import('../../../typcheck/runtime-contracts.js').PersistenceAdapter} */
    adapter: createLocalStorageAdapter(),

    adapterExplicitlyConfigured: false,

    /** @type {D.StringRecords} */
    memCache: Object.create(null),

    initialized: false,

    /** @type {Promise<boolean> | null} */
    initPromise: null,

    /** @type {Set<string>} */
    dirtyKeys: new Set(),

    /** @type {Set<string>} */
    deletedKeys: new Set(),

    /** @type {Map<string, number>} */
    keyVersions: new Map(),

    /** @type {ReturnType<typeof setTimeout> | null} */
    flushTimer: null,

    debounceMs: DEFAULT_DEBOUNCE_MS,

    /** @type {{target?: Document | Window, type?: string, handler?: EventListener, unlisten?: () => void}[]} */
    lifecycleBindings: [],

    lifecycleBindToken: 0,

    /** @type {I.CloseBinding | null} */
    tauriCloseBinding: null,

    /** @type {unknown} */
    lastFlushError: null,

    /** @type {Promise<unknown>} */
    flushChain: Promise.resolve(),

    pendingFlushes: 0,

    /** @type {I.Warning | null} */
    migrationWarning: null,

    /** @type {I.Warning | null} */
    areaWarning: null,

    /** @type {Map<symbol, {keys: Set<string>, prefixes: string[], predicate: D.KeyPolicy | null, message: string | (() => string)}>} */
    syncWriteBlocks: new Map(),

    /** @type {string | null} */
    documentWriteBlock: null,

    /** @type {Set<(change: {dirtyKeys: string[], deletedKeys: string[]}) => void>} */
    beforeFlushObservers: new Set(),

    /** @type {I.ProbelaufProtection | null} */
    probelaufProtection: null,

    persistenceWindow: globalThis.window,

    /** @type {Promise<void> | null} */
    fallbackWriteChain: null,
};

/** Rückverweise werden einmal beim Zusammensetzen der öffentlichen API gesetzt.
 * @type {{flush: typeof import("./writes.js").flush, bindLifecycleFlush: typeof import("./lifecycle.js").bindLifecycleFlush, bindTauriClose: typeof import("./lifecycle.js").bindTauriClose, facade: typeof import("./api.js").PersistenceFacade}} */
export const hooks = /** @type {typeof hooks} */ ({});

/**
 * @param {I.ProbelaufProtection | null} protection
 * @returns {void}
 */
export function setProbelaufProtection(protection) { storeState.probelaufProtection = protection; }

/** Veraltete Formularwerte dürfen einen gerade ersetzten Bestand nicht überschreiben. */
/**
 * @param {string[]} keys
 * @param {string | (() => string)} message
 * @param {{prefixes?: string[], predicate?: D.KeyPolicy | null}} [options]
 */
export function blockSyncWrites(keys, message, { prefixes = [], predicate = null } = {}) {
    const owner = Symbol('sync-write-block');
    storeState.syncWriteBlocks.set(owner, { keys: new Set(keys.map(String)), prefixes: prefixes.map(String), predicate, message });
    return () => storeState.syncWriteBlocks.delete(owner);
}

/** Rein lesend: unabhängige Lifecycle-Saver setzen während Restore/Reset aus. */
export function hasSyncWriteBlocks() {
    return storeState.documentWriteBlock !== null || storeState.syncWriteBlocks.size > 0;
}

/** BFCache-Dokumente dürfen erst nach einem echten Neustart wieder schreiben. */
/**
 * @param {string} message
 * @returns {void}
 */
export function blockDocumentWrites(message) { storeState.documentWriteBlock = message; }

export function assertDocumentWritable() {
    if (storeState.documentWriteBlock === null) return;
    throw Object.assign(new Error(storeState.documentWriteBlock), { code: 'PERSISTENCE_RELOAD_REQUIRED' });
}

/** Zusätzliche Records nur zusammen mit einem bereits wartenden Write vormerken. */
/**
 * @param {(change: {dirtyKeys: string[], deletedKeys: string[]}) => void} observer
 */
export function observeBeforeFlush(observer) {
    storeState.beforeFlushObservers.add(observer);
    return () => storeState.beforeFlushObservers.delete(observer);
}

/**
 * @param {string} key
 * @returns {void}
 */
export function assertSyncWriteAllowed(key) {
    assertDocumentWritable();
    for (const block of storeState.syncWriteBlocks.values()) {
        if (!block.keys.has(key) && !block.prefixes.some(prefix => key.startsWith(prefix)) && !block.predicate?.(key)) continue;
        /** @type {import('../../../typcheck/runtime-contracts.js').AppError} */
        const error = new Error(typeof block.message === 'function' ? block.message() : block.message);
        /** @type {I.AppError} */ (error).code = 'PERSISTENCE_RELOAD_REQUIRED';
        throw error;
    }
}
