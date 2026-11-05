/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { storeState, hooks, assertDocumentWritable } from './state.js';

export function clearScheduledFlush() {
    if (storeState.flushTimer !== null && typeof clearTimeout === 'function') {
        clearTimeout(storeState.flushTimer);
    }
    storeState.flushTimer = null;
}

export function scheduleFlush() {
    if (!storeState.initialized || typeof setTimeout !== 'function') return;
    clearScheduledFlush();
    storeState.flushTimer = setTimeout(() => {
        hooks.flush().catch(err => {
            console.error('[PersistenceFacade] flush failed:', err);
        });
    }, storeState.debounceMs);
}

export async function flushOwned() {
    clearScheduledFlush();
    if (!storeState.initialized) return true;
    if (storeState.dirtyKeys.size === 0 && storeState.deletedKeys.size === 0) return true;
    assertDocumentWritable();
    for (const observer of storeState.beforeFlushObservers) observer({ dirtyKeys: [...storeState.dirtyKeys], deletedKeys: [...storeState.deletedKeys] });
    clearScheduledFlush();
    /** @type {{upserts: [string, string][], deletes: string[]}} */
    const batch = {
        upserts: Array.from(storeState.dirtyKeys).map(key => [key, storeState.memCache[key]]),
        deletes: Array.from(storeState.deletedKeys)
    };
    storeState.dirtyKeys.clear();
    storeState.deletedKeys.clear();
    try {
        await storeState.adapter.saveBatch(batch);
        storeState.lastFlushError = null;
        return true;
    } catch (err) {
        batch.upserts.forEach(([key]) => {
            if (!storeState.deletedKeys.has(key)) {
                storeState.dirtyKeys.add(key);
            }
        });
        batch.deletes.forEach(key => {
            if (!storeState.dirtyKeys.has(key)) {
                storeState.deletedKeys.add(key);
            }
        });
        storeState.lastFlushError = err;
        // HV-4: Rust hat den Write wegen eines Haushaltswechsels abgewiesen → Neuladehinweis wie bei geänderter Steuerung.
        if (/** @type {{code?: string}} */ (err)?.code === 'PERSISTENCE_RELOAD_REQUIRED') storeState.areaManager?.contextChanged?.();
        throw err;
    }
}
