/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { init, assertAreaWritable } from './initialization.js';
import { assertDocumentWritable, storeState } from './state.js';
import { flushOwned, clearScheduledFlush } from './batch-flush.js';

/** @template T
 * @param {(flushOwned: () => Promise<boolean>) => T | Promise<T>} execute
 * @param {I.ReplaceOptions} [options]
 * @param {() => boolean} [needsProtection]
 * @returns {Promise<T>}
 */
export async function persistentWrite(execute, options = {}, needsProtection = () => true) {
    // ES-1: erst nach der Tabentscheidung und vor jeder Sperre. ES-1b: Ein gesperrtes Dokument wartet nicht und scheitert
    // sofort; es nimmt nie die gemeinsame Schreibsperre, um darin auf sein nie endendes init() zu warten.
    if (storeState.writeGate && storeState.documentWriteBlock === null) await storeState.writeGate;
    assertDocumentWritable();
    const run = async () => {
        if (!storeState.initialized && !storeState.adapterExplicitlyConfigured) await init();
        assertAreaWritable();
        if (storeState.areaManager) await storeState.areaManager.assertCurrent();
        if (needsProtection() && storeState.probelaufProtection?.checkCurrent) await storeState.probelaufProtection.checkCurrent();
        assertDocumentWritable();
        // Nur der interne Folgewriter erhält diesen Flushbesitz. Ein unabhängiger
        // Lifecycleflush wartet weiter am Lock und wird niemals über eine globale
        // Verschachtelungstiefe zum Besitzer des gerade laufenden Writers.
        return execute(flushOwned);
    };
    if (storeState.probelaufProtection?.ownsWrites?.(options)) return run();
    if (storeState.persistenceWindow?.navigator?.locks?.request) {
        return storeState.persistenceWindow.navigator.locks.request('rs-probelauf-operation', { mode: 'exclusive' }, run);
    }
    return queueFallbackWrite(run);
}

/** @template T
 * @param {() => T | Promise<T>} run
 * @returns {Promise<T>}
 */
export function queueFallbackWrite(run) {
    const job = storeState.fallbackWriteChain ? storeState.fallbackWriteChain.then(run, run) : Promise.resolve(run());
    const tail = job.catch(() => true).then(() => {
        if (storeState.fallbackWriteChain === tail) storeState.fallbackWriteChain = null;
    });
    storeState.fallbackWriteChain = tail;
    return job;
}

/** Koordinator und unabhängige Writer teilen auch ohne Web Locks eine Reihenfolge.
 * @template T
 * @param {(flushOwned: () => Promise<boolean>) => T | Promise<T>} execute
 * @param {Window} [win]
 * @param {{check?: () => void, onWait?: (message: string) => void, clock?: () => number, wait?: (ms: number) => Promise<unknown>, timeoutMs?: number, signal?: AbortSignal}} [options]
 */
export async function withProbelaufOperation(execute, win = storeState.persistenceWindow, {
    check = () => {}, onWait = () => {}, clock = Date.now,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 10000, signal
} = {}) {
    const deadline = clock() + timeoutMs;
    const busyError = (foreign = false) => {
        /** @type {import('../../../typcheck/runtime-contracts.js').AppError} */
        const error = new Error(foreign ? 'Eine andere Seite führt gerade eine Spielbereich-Aktion aus.'
            : 'Gerade wird noch gespeichert. Bitte in ein paar Sekunden erneut versuchen.');
        /** @type {I.AppError} */ (error).code = foreign ? 'PROBELAUF_OTHER_PAGE' : 'PROBELAUF_COMMIT_BUSY';
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
                if (lock) clientId = /** @type {LockInfo[]} */ ((await locks.query()).held).find(entry => entry.name === name)?.clientId;
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
            const held = locks.query ? /** @type {LockInfo[]} */ ((await locks.query()).held).find(entry => entry.name === 'rs-probelauf-operation') : null;
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
    let expired = false, started = false, /** @type {ReturnType<typeof setTimeout> | undefined} */ timer, /** @type {(() => void) | undefined} */ abort;
    const cancelled = new Promise((resolve, reject) => {
        abort = () => { if (!started) { expired = true; reject(/** @type {AbortSignal} */ (signal).reason); } };
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
    } finally { if (!started) expired = true; clearTimeout(timer); signal?.removeEventListener('abort', /** @type {() => void} */ (abort)); }
}

/**
 * @param {I.ReplaceOptions} [options]
 * @returns {Promise<boolean>}
 */
export async function flush(options = {}) {
    clearScheduledFlush();
    if (!storeState.initialized) return true;
    // Ein leerer Puffer braucht keine Schreib- oder Bereichsberechtigung.
    // Bereits laufende Writes müssen vor einer Schließfreigabe trotzdem enden.
    if (storeState.dirtyKeys.size === 0 && storeState.deletedKeys.size === 0) {
        if (storeState.probelaufProtection?.ownsWrites?.(options)) return true;
        if (storeState.pendingFlushes === 0 && !storeState.fallbackWriteChain) return true;
        await storeState.flushChain;
        if (storeState.fallbackWriteChain) await storeState.fallbackWriteChain;
        return storeState.dirtyKeys.size === 0 && storeState.deletedKeys.size === 0 ? true : flush(options);
    }
    // Der Koordinator reicht seinen privaten Besitz ausdrücklich weiter. Er darf
    // nicht hinter einem Lifecycleflush auf seinen eigenen äußeren Lock warten.
    if (storeState.probelaufProtection?.ownsWrites?.(options)) return persistentWrite(flushOwned, options);
    const run = () => storeState.dirtyKeys.size === 0 && storeState.deletedKeys.size === 0
        ? true : persistentWrite(flushOwned, options, () => storeState.dirtyKeys.size > 0 || storeState.deletedKeys.size > 0);
    storeState.pendingFlushes++;
    const queuedFlush = storeState.flushChain.then(run, run).finally(() => { storeState.pendingFlushes--; });
    storeState.flushChain = queuedFlush.catch(() => true);
    return queuedFlush;
}
