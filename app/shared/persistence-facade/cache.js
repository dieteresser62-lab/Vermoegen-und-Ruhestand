/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { hasOwn } from './record-format.js';
import { resolveSynchronousArea, assertAreaWritable } from './initialization.js';
import { storeState, assertSyncWriteAllowed } from './state.js';
import { scheduleFlush } from './batch-flush.js';

/**
 * @param {string} key
 * @returns {string | null}
 */
export function getItemSync(key) {
    if (storeState.areaReloadRequired) throw new Error('Speicherbereich geändert. Bitte neu laden.');
    const normalized = String(key);
    if (storeState.initialized) {
        return hasOwn(storeState.memCache, normalized) ? storeState.memCache[normalized] : null;
    }
    return resolveSynchronousArea() ? storeState.adapter.getItemSync?.(normalized) ?? null : null;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {void}
 */
export function setItemSync(key, value) {
    const normalized = String(key);
    assertAreaWritable();
    assertSyncWriteAllowed(normalized);
    const stringValue = String(value);
    if (!storeState.initialized) {
        storeState.adapter.setItemSync?.(normalized, stringValue);
        return;
    }
    if (storeState.memCache[normalized] === stringValue && !storeState.deletedKeys.has(normalized)) return;
    storeState.memCache[normalized] = stringValue;
    storeState.keyVersions.set(normalized, (storeState.keyVersions.get(normalized) || 0) + 1);
    storeState.deletedKeys.delete(normalized);
    storeState.dirtyKeys.add(normalized);
    scheduleFlush();
}

/**
 * @param {string} key
 * @returns {void}
 */
export function removeItemSync(key) {
    const normalized = String(key);
    assertAreaWritable();
    assertSyncWriteAllowed(normalized);
    if (!storeState.initialized) {
        storeState.adapter.removeItemSync?.(normalized);
        return;
    }
    if (!hasOwn(storeState.memCache, normalized) && !storeState.dirtyKeys.has(normalized)) return;
    delete storeState.memCache[normalized];
    storeState.keyVersions.set(normalized, (storeState.keyVersions.get(normalized) || 0) + 1);
    storeState.dirtyKeys.delete(normalized);
    storeState.deletedKeys.add(normalized);
    scheduleFlush();
}

export function keysSync() {
    if (storeState.areaReloadRequired) throw new Error('Speicherbereich geändert. Bitte neu laden.');
    if (storeState.initialized) return Object.keys(storeState.memCache);
    return resolveSynchronousArea() ? storeState.adapter.keysSync?.() ?? [] : [];
}

/**
 * @param {number} index
 * @returns {string | null}
 */
export function keySync(index) {
    return keysSync()[index] || null;
}

/**
 * @param {string[] | D.KeyPolicy} keysOrPredicate
 * @returns {void}
 */
export function clearAllowedSync(keysOrPredicate) {
    const predicate = typeof keysOrPredicate === 'function'
        ? keysOrPredicate
        : (/** @type {string} */ key) => new Set(keysOrPredicate || []).has(key);
    keysSync().forEach(key => {
        if (predicate(key)) removeItemSync(key);
    });
}

export function clearSync() {
    keysSync().forEach(key => removeItemSync(key));
}
