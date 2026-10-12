import { createNavigationGuard } from './navigation-guard.js';

const pageGuards = new WeakMap();
const dialogs = new WeakMap();

/** Native showModal macht auch darunterliegende Fachdialoge inert. */
export function showNavigationGuardDialog({ reasons, opener, intent = 'navigate', signal }, doc = globalThis.document) {
    if (signal?.aborted) return Promise.resolve(false);
    if (dialogs.has(doc)) return dialogs.get(doc).promise;
    const dialog = doc?.getElementById?.('navigationGuardDialog');
    const stay = doc?.getElementById?.('navigationGuardStay');
    const leave = doc?.getElementById?.('navigationGuardLeave');
    if (!dialog?.showModal || !stay || !leave) return Promise.resolve(false);
    const title = doc.getElementById('navigationGuardTitle');
    const description = doc.getElementById('navigationGuardDescription');
    const discard = intent === 'discard';
    const close = intent === 'close';
    title.textContent = discard ? 'Änderungen verwerfen?' : close ? 'Anwendung schließen?' : 'Seite verlassen?';
    leave.textContent = discard ? 'Verwerfen' : close ? 'Trotzdem schließen' : 'Trotzdem wechseln';
    const action = close ? 'schließen' : 'wechseln';
    description.textContent = discard ? 'Ungespeicherte Eingaben gehen verloren – trotzdem verwerfen?' : reasons.map(reason => reason.message || (reason.result
        ? `Ergebnis geht verloren – trotzdem ${action}?`
        : reason.dirty ? `Ungespeicherte Eingaben gehen verloren – trotzdem ${action}?`
            : `Laufende Rechnung wird abgebrochen – trotzdem ${action}?`)).join('\n');
    // Ein programmatisch ausgelöster Rahmenlink liegt hinter dem Fachdialog.
    // Bei Bleiben gehört der Fokus weiterhin in den offenen Editor.
    const focusedDialog = doc.activeElement?.closest?.('[role="dialog"][aria-modal="true"]');
    const returnFocus = focusedDialog && opener && !focusedDialog.contains(opener)
        ? doc.activeElement : opener || doc.activeElement;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    dialogs.set(doc, { promise });
    let finished = false;
    function finish(accepted) {
        if (finished) return;
        finished = true;
        stay.removeEventListener('click', stayHandler);
        leave.removeEventListener('click', leaveHandler);
        dialog.removeEventListener('cancel', cancelHandler);
        dialog.removeEventListener('close', closeHandler);
        doc.removeEventListener('keydown', keys, true);
        signal?.removeEventListener('abort', abortHandler);
        dialogs.delete(doc);
        if (dialog.open) dialog.close();
        if (returnFocus?.isConnected !== false) returnFocus?.focus?.();
        resolve(accepted);
    }
    const stayHandler = () => finish(false), leaveHandler = () => finish(true);
    const cancelHandler = event => { event.preventDefault(); event.stopImmediatePropagation(); finish(false); };
    const closeHandler = () => finish(false);
    const abortHandler = () => finish(false);
    const keys = event => {
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopImmediatePropagation(); finish(false);
        } else if (event.key === 'Tab') {
            // Nur zwei Bedienziele; auch bei programmatisch fremdem Fokus schließen.
            event.preventDefault(); event.stopImmediatePropagation();
            const next = doc.activeElement === stay ? leave : doc.activeElement === leave ? stay : event.shiftKey ? leave : stay;
            next.focus();
        }
    };
    stay.addEventListener('click', stayHandler);
    leave.addEventListener('click', leaveHandler);
    dialog.addEventListener('cancel', cancelHandler);
    dialog.addEventListener('close', closeHandler);
    doc.addEventListener('keydown', keys, true);
    signal?.addEventListener('abort', abortHandler, { once: true });
    try { dialog.showModal(); stay.focus(); } catch { finish(false); }
    return promise;
}

export function isNavigationGuardDialogOpen(doc = globalThis.document) { return dialogs.has(doc); }

/** Reset/Recovery/BFCache: kein Profilbundle, aber Eingabe- und Schlussprüfung. */
export function reloadGuardedPage({ doc = globalThis.document, win = doc?.defaultView || globalThis.window,
    guard = getPageNavigationGuard(doc, win), ...options } = {}) {
    return guard.reload({
        reload: () => win.location.reload(),
        subscribeChanges: notify => {
            doc?.addEventListener?.('input', notify, true);
            doc?.addEventListener?.('change', notify, true);
            return () => {
                doc?.removeEventListener?.('input', notify, true);
                doc?.removeEventListener?.('change', notify, true);
            };
        },
        ...options
    });
}

export function getPageNavigationGuard(doc = globalThis.document, win = doc?.defaultView || globalThis.window) {
    if (pageGuards.has(doc)) return pageGuards.get(doc);
    const guard = createNavigationGuard({
        decide: options => showNavigationGuardDialog(options, doc),
        status: message => {
            const host = doc?.getElementById?.('suiteNavigationStatus');
            if (host) { host.hidden = false; host.textContent = message; }
        }
    });
    pageGuards.set(doc, guard);
    let installed = false;
    const update = () => {
        const needed = guard.reasons().length > 0;
        if (needed === installed || !win?.addEventListener) return;
        if (needed) win.addEventListener('beforeunload', guard.beforeUnload);
        else win.removeEventListener?.('beforeunload', guard.beforeUnload);
        installed = needed;
    };
    guard.subscribe(update);
    // Nur der Nachfragehandler ist bedarfsabhängig; der getrennte Profil-Saver
    // darf dauerhaft gebunden bleiben. Rückkehr widerruft nur Freigaben.
    win?.addEventListener?.('pageshow', event => {
        if (event?.persisted) guard.restoreDocument(); else guard.revokeNative();
        update();
    });
    return guard;
}
