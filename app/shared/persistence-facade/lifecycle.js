/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { flush } from './writes.js';
import { storeState, hooks } from './state.js';
import { showNavigationGuardDialog, getPageNavigationGuard } from '../navigation-guard-dialog.js';

/** Auch gewöhnliche Eingaben ohne eigenen Dirty-Provider verwerfen einen Reload. */
/**
 * @param {EventListener} notify
 * @param {Document} [doc]
 */
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
    if (storeState.lifecycleBindings.length > 0) return;
    const requestFlush = () => {
        if (storeState.areaReloadRequired) return;
        flush().catch(err => console.error('[PersistenceFacade] lifecycle flush failed:', err));
    };
    const visibilityHandler = () => {
        if (doc.visibilityState === 'hidden') requestFlush();
    };
    if (doc?.addEventListener) {
        doc.addEventListener('visibilitychange', visibilityHandler);
        storeState.lifecycleBindings.push({ target: doc, type: 'visibilitychange', handler: visibilityHandler });
    }
    if (win?.addEventListener) {
        win.addEventListener('pagehide', requestFlush);
        storeState.lifecycleBindings.push({ target: win, type: 'pagehide', handler: requestFlush });
    }
    bindTauriClose(doc, win);
}

/** Der EXE-Hook ist unabhängig von den bestmöglichen Browser-Speicherhooks. */
export function bindTauriClose(doc = globalThis.document, win = globalThis.window) {
    if (storeState.tauriCloseBinding || !win?.__TAURI__?.event?.listen || !win?.__TAURI__?.core?.invoke) return;
    const bindToken = storeState.lifecycleBindToken;
    /** @param {string} attemptId @param {'hold' | 'allow' | 'reject'} response */
    const invoke = (attemptId, response) => /** @type {NonNullable<NonNullable<Window["__TAURI__"]>["core"]>} */ (/** @type {NonNullable<Window["__TAURI__"]>} */ (win.__TAURI__).core).invoke('confirm_app_close', { attemptId, response });
    const binding = /** @type {I.CloseBinding} */ ({ pending: null, lastId: 0n, disposed: false, unlisten: null, rejections: new Map() });
    const scheduleRetry = win.setTimeout?.bind(win) || globalThis.setTimeout;
    const clearRetry = win.clearTimeout?.bind(win) || globalThis.clearTimeout;
    storeState.tauriCloseBinding = binding;
    /** @param {I.CloseRequest} request */
    const current = request => !binding.disposed && bindToken === storeState.lifecycleBindToken && binding.pending === request;
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
        /** @type {{promise: Promise<void> | null, timer: ReturnType<typeof setTimeout> | null}} */
        const task = { promise: null, timer: null };
        binding.rejections.set(id, task);
        task.promise = Promise.resolve().then(() => invoke(id, 'reject')).then(() => {
            binding.rejections.delete(id); // Auch false: Versuch ist bereits ungültig.
        }).catch(error => {
            console.error('[PersistenceFacade] Tauri close rejection failed:', error);
            if (binding.disposed || bindToken !== storeState.lifecycleBindToken) {
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
        if (request.attempt) /** @type {I.Guard} */ (request.guard).end(request.attempt);
        if (request.held) return binding.reject(request.id);
    };
    binding.dispose = () => {
        binding.disposed = true;
        win.removeEventListener?.('pagehide', binding.cancelPending);
        for (const task of binding.rejections.values()) clearRetry(/** @type {number | undefined} */ (task.timer));
        binding.rejections.clear();
        binding.cancelPending();
    };
    // Erst pagehide bestätigt den Dokumentwechsel; ein abgelehnter
    // beforeunload-Hinweis muss die lebende Nachfrage unverändert lassen.
    win.addEventListener?.('pagehide', binding.cancelPending);
    /** @param {{payload?: {attemptId?: unknown}}} event */
    const handler = async event => {
        const id = event?.payload?.attemptId;
        if (binding.disposed || binding.pending || typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) return;
        if (BigInt(id) <= binding.lastId) return;
        binding.lastId = BigInt(id);
        /** @type {I.CloseRequest} */
        const request = { id, controller: new AbortController(), guard: null, attempt: null };
        binding.pending = request;
        let held = false, allowed = false;
        try {
            // Vor bestätigter Übernahme weder Dialog, Abbruch noch Flush starten.
            held = await invoke(id, 'hold') === true;
            request.held = held;
            if (!held || !current(request)) return;
            // Ein fremd gewechselter Bereich kann nicht mehr gespeichert werden.
            // Die ausdrückliche Verlustbestätigung ersetzt nur in diesem Zustand
            // den normalen Guard/Flush; Rust behält hold/allow/reject unverändert.
            const hasBufferedChanges = storeState.dirtyKeys.size > 0 || storeState.deletedKeys.size > 0;
            if (hasBufferedChanges && storeState.areaManager && !storeState.areaReloadRequired) {
                try { await storeState.areaManager.assertCurrent(); }
                catch (error) { if (!storeState.areaReloadRequired) throw error; }
            }
            if (hasBufferedChanges && storeState.areaReloadRequired) {
                const accepted = await showNavigationGuardDialog({ intent: 'close', signal: request.controller.signal,
                    reasons: [{ message: 'Nicht gespeicherte Eingaben gehen verloren – trotzdem schließen?' }] }, doc);
                if (accepted && current(request)) allowed = await invoke(id, 'allow') === true;
                if (accepted && !allowed && current(request)) report();
                return;
            }
            request.guard = getPageNavigationGuard(doc, win);
            request.attempt = await /** @type {I.Guard} */ (request.guard).prepare({ intent: 'close', signal: request.controller.signal });
            if (!current(request) || !request.attempt) return;
            if (!/** @type {I.Guard} */ (request.guard).validate(request.attempt)) return;
            // Tauri garantiert keine Browser-Entladeereignisse. Wie pagehide
            // zuerst die Livewerte in den Personenstand übernehmen, dann flushen.
            // Ohne Registry (etwa im Handbuch) keinen neuen Bestand anlegen.
            if (!request.attempt.discardedSave && hooks.facade.getItemSync('rs_profiles_v1')) {
                try {
                    const { saveCurrentProfileFromLocalStorage } = await import("../../profile/profile-storage.js");
                    if (!current(request) || !/** @type {I.Guard} */ (request.guard).validate(request.attempt)) return;
                    if (hooks.facade.hasSyncWriteBlocks() || saveCurrentProfileFromLocalStorage() === false) {
                        throw new Error('PROFILE_SAVE_FAILED');
                    }
                } catch (error) {
                    if (!current(request)) return;
                    const accepted = await showNavigationGuardDialog({ intent: 'close', signal: request.controller.signal,
                        reasons: [{ message: 'Nicht gespeicherte Eingaben gehen verloren – trotzdem schließen?' }] }, doc);
                    if (accepted && current(request)) allowed = await invoke(id, 'allow') === true;
                    if (accepted && !allowed && current(request)) report();
                    return;
                }
            }
            if (await hooks.facade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            if (!current(request) || !/** @type {I.Guard} */ (request.guard).validate(request.attempt)) return;
            allowed = await invoke(id, 'allow') === true;
            if (!allowed && current(request)) report();
        } catch (error) {
            if (current(request)) report();
            console.error('[PersistenceFacade] Tauri close failed:', error);
        } finally {
            if (request.attempt) /** @type {I.Guard} */ (request.guard).end(request.attempt);
            // Rust kann nach reject bereits die nächste Kennung senden, während
            // deren Vorgänger noch auf die IPC-Antwort wartet. Dessen JS-Bindung
            // vorher lösen; alte Antworten dürfen den neuen Versuch nicht belegen.
            if (binding.pending === request) binding.pending = null;
            if (held && !allowed) {
                await binding.reject(id);
            }
        }
    };
    Promise.resolve().then(() => /** @type {NonNullable<NonNullable<Window["__TAURI__"]>["event"]>} */ (/** @type {NonNullable<Window["__TAURI__"]>} */ (win.__TAURI__).event).listen('ruhestand://close-requested', handler))
        .then(unlisten => {
            if (!binding.disposed && bindToken === storeState.lifecycleBindToken) binding.unlisten = unlisten;
            else unlisten?.();
        })
        .catch(error => {
            binding.dispose();
            if (storeState.tauriCloseBinding === binding) storeState.tauriCloseBinding = null;
            console.error('[PersistenceFacade] Tauri close listener failed:', error);
        });
}

export function unbindLifecycleFlush() {
    storeState.lifecycleBindToken += 1;
    const close = storeState.tauriCloseBinding;
    storeState.tauriCloseBinding = null;
    if (close) {
        close.dispose();
        try { close.unlisten?.(); }
        catch (error) { console.error('[PersistenceFacade] Failed to unbind close listener:', error); }
    }
    storeState.lifecycleBindings.forEach(({ target, type, handler }) => {
        target?.removeEventListener?.(/** @type {string} */ (type), /** @type {EventListener} */ (handler));
    });
    storeState.lifecycleBindings.forEach(({ unlisten }) => {
        try {
            unlisten?.();
        } catch (err) {
            console.error('[PersistenceFacade] Failed to unbind lifecycle listener:', err);
        }
    });
    storeState.lifecycleBindings = [];
}
