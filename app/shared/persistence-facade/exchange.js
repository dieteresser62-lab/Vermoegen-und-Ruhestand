/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { keysSync, getItemSync, removeItemSync, setItemSync } from './cache.js';
import { PROBELAUF_STATE_KEY, storeState } from './state.js';
import { init, assertAreaWritable } from './initialization.js';
import { createNavigationOperationLifecycle } from '../navigation-guard.js';
import { replaceRecordsTransactionalWith } from '../persistence-transaction.js';
import { flush, persistentWrite } from './writes.js';
import { clearScheduledFlush } from './batch-flush.js';
import { hasOwn, requireAdapterMethod } from './record-format.js';

/**
 * @returns {{schemaVersion: 1, exportedAt: string, records: D.StringRecords}}
 */
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

/**
 * @param {D.KeyPolicy} allowKey
 * @returns {D.StringRecords}
 */
export function captureRecordsByPolicy(allowKey) {
    const records = Object.create(null);
    keysSync().forEach(key => {
        if (!allowKey(key)) return;
        const value = getItemSync(key);
        if (value !== null && value !== undefined) records[key] = value;
    });
    return records;
}

/** @param {(key: string) => boolean} [allowKey] */
export async function readPersistedRecords(allowKey = () => true) {
    if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
    assertAreaWritable();
    if (storeState.areaManager) await storeState.areaManager.assertCurrent();
    if (typeof storeState.adapter?.loadAll !== 'function') {
        /** @type {import('../../../typcheck/runtime-contracts.js').AppError} */
        const error = new Error('Der Persistenzadapter unterstuetzt keinen verifizierenden Backend-Readback.');
        /** @type {I.AppError} */ (error).name = 'PersistenceBackendReadError';
        /** @type {I.AppError} */ (error).code = 'persistence_backend_read_unavailable';
        throw error;
    }
    const loaded = await (storeState.adapter.readPersistedRecords ? storeState.adapter.readPersistedRecords() : storeState.adapter.loadAll());
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

/**
 * @param {D.StringRecords} records
 * @param {I.ReplaceOptions} [options]
 * @returns {Promise<unknown>}
 */
export async function replaceRecordsTransactional(records, options = {}) {
    storeState.probelaufProtection?.mutation?.(options);
    // Fachkoordinatoren reichen ihren Besitzer explizit weiter. Bestehende
    // andere Domänen behalten ihre äußere Sperre ohne implizite Neuregistrierung.
    const lifecycle = /** @type {I.CreateLifecycle} */ (createNavigationOperationLifecycle)({ guard: options.guard ?? null });
    return lifecycle.run(options, async operation => {
        return replaceRecordsTransactionalWith({ flush, readPersistedRecords, captureRecordsByPolicy, replaceLiveRecords, captureKeyVersions: () => new Map(storeState.keyVersions), getKeyVersion: /** @param {string} key */ key => storeState.keyVersions.get(key) }, records, { ...options, navigationOperation: operation });
    });
}

/**
 * @param {{records?: Record<string, unknown>}} bundle
 * @param {I.ReplaceOptions} [options]
 */
export async function importAll(bundle, options = {}) {
    if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
    storeState.probelaufProtection?.mutation?.(options);
    const records = bundle?.records || {};
    const requestedPolicy = typeof options.allowKey === 'function' ? options.allowKey : () => true;
    /** @param {string} key */
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

/**
 * @param {D.StringRecords} records
 * @param {I.ReplaceOptions} [options]
 */
export async function replaceLiveRecords(records, options = {}) {
    storeState.probelaufProtection?.mutation?.(options);
    // Fachkoordinatoren reichen ihren Besitzer explizit weiter. Bestehende
    // andere Domänen behalten ihre äußere Sperre ohne implizite Neuregistrierung.
    const lifecycle = /** @type {I.CreateLifecycle} */ (createNavigationOperationLifecycle)({ guard: options.guard ?? null });
    return lifecycle.run(options, async operation => {
        return persistentWrite(flushOwned => {
            storeState.probelaufProtection?.mutation?.(options);
            return replaceLiveRecordsImpl(records, { ...options, navigationOperation: operation }, flushOwned);
        }, options);
    });
}

/**
 * @param {D.StringRecords} records
 * @param {I.ReplaceOptions} options
 * @param {() => Promise<boolean>} flushOwned
 */
export async function replaceLiveRecordsImpl(records, options = {}, flushOwned) {
    clearScheduledFlush();
    await flushOwned();
    /** @type {I.Operation} */ (options.navigationOperation).check();
    /** @type {I.Operation} */ (options.navigationOperation).commit();

    const allowKey = typeof options.allowKey === 'function' ? options.allowKey : () => true;
    const requestedDeleteKeys = Array.isArray(options.deleteKeys) ? options.deleteKeys.map(key => String(key)) : [];
    const requestedUpserts = Array.isArray(options.upserts)
        ? options.upserts.map(([key, value]) => [String(key), value])
        : Object.entries(records || {});

    const deleteKeys = requestedDeleteKeys.filter(key => allowKey(key, options));
    const upserts = requestedUpserts
        .filter(([key, value]) => value !== null && value !== undefined && allowKey(String(key), options))
        .map(([key, value]) => [String(key), String(value)]);

    const affectedKeys = new Set([...deleteKeys, ...upserts.map(([key]) => key)]);
    const versions = new Map([...affectedKeys].map(key => [key, storeState.keyVersions.get(key)]));
    const nativeReplace = typeof storeState.adapter?.replaceLiveRecords === 'function';
    const backup = Object.fromEntries([...affectedKeys].filter(key => hasOwn(storeState.memCache, key)).map(key => [key, storeState.memCache[key]]));
    // Der Batch-Fallback zeigt wie bisher seinen laufenden Kandidaten.
    if (!nativeReplace) {
        deleteKeys.forEach(key => { delete storeState.memCache[key]; });
        upserts.forEach(([key, value]) => { storeState.memCache[key] = value; });
    }
    try {
        /** @type {{ok?: boolean, message?: string} | void} */
        const result = nativeReplace
            ? await /** @type {NonNullable<typeof storeState.adapter.replaceLiveRecords>} */ (storeState.adapter.replaceLiveRecords)(records, { ...options, deleteKeys, upserts, allowKey })
            : await requireAdapterMethod('saveBatch')({ deletes: deleteKeys, upserts });
        if (/** @type {{ok?: boolean, message?: string} | undefined} */ (result)?.ok === false) {
            throw new Error(/** @type {{message?: string}} */ (result).message || 'Der Persistenzadapter hat den Replace-Vorgang abgewiesen.');
        }
        // Nur unveränderte Schlüssel übernehmen. Spätere Eingaben behalten
        // ihren Cachewert und ihre Vormerkung, auch nach einem Wertwechsel zurück.
        /** @param {string} key */
        const unchanged = key => storeState.keyVersions.get(key) === versions.get(key);
        deleteKeys.forEach(key => {
            if (unchanged(key)) delete storeState.memCache[key];
        });
        upserts.forEach(([key, value]) => {
            if (unchanged(key)) storeState.memCache[key] = value;
        });
        affectedKeys.forEach(key => {
            if (!unchanged(key)) return;
            storeState.dirtyKeys.delete(key);
            storeState.deletedKeys.delete(key);
        });
        storeState.lastFlushError = null;
        return result ?? { ok: true, deletedCount: deleteKeys.length, upsertCount: upserts.length };
    } catch (err) {
        if (!nativeReplace) affectedKeys.forEach(key => {
            if (storeState.keyVersions.get(key) !== versions.get(key)) return;
            if (hasOwn(backup, key)) storeState.memCache[key] = backup[key];
            else delete storeState.memCache[key];
        });
        storeState.lastFlushError = err;
        throw err;
    }
}
