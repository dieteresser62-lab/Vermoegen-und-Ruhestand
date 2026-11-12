/** ES-1/ES-1c: Im Browser arbeitet je Ursprung (dieselben Browserdaten) nur ein Tab.
 * Ein weiterer Tab fragt die Sperre einmal an, zeigt bei Misserfolg einen Hinweis mit „Erneut versuchen“ (= neu laden),
 * startet die Persistenz nicht und schreibt nichts. Er wartet nicht und wechselt nie selbst; Übernahme gibt es nicht,
 * damit eine laufende Speicherung samt Rücknahme nie von außen unterbrochen wird.
 * Ein Seitenwechsel im selben Tab wartet kurz auf die Freigabe seiner Vorgängerseite.
 * Ohne Web Locks oder sessionStorage und in der EXE bleibt das bisherige Verhalten.
 */
import { PersistenceFacade } from './persistence-facade.js';
import { runPageDialog } from './page-dialog.js';
import { detectRuntime } from './runtime-env.js';

export const APP_TAB_LOCK = 'rs-app-tab';
/** Tabeigener Merker außerhalb der Bereichsschlüssel: Dieser Tab hielt die App zuletzt. */
export const APP_TAB_OWNER_KEY = 'app-tab-owner';
/** Höchstwartezeit eines Seitenwechsels im selben Tab auf die Freigabe seiner Vorgängerseite. Sie schützt nur vor einem
 * kopierten Merker (Tab duplizieren); die Sperre selbst hält bis dahin nur die Vorgängerseite und kommt sofort. */
export const SAME_TAB_WAIT_MS = 2000;
const BLOCK_MESSAGE = 'Die App ist in einem anderen Tab geöffnet. Dieser Tab speichert nichts.';

export const APP_TAB_TEXTS = Object.freeze({
    title: 'Die App ist schon in einem anderen Tab geöffnet',
    description: 'Schließe den anderen Tab und wähle dann „Erneut versuchen“. Dieser Tab speichert nichts.',
    retry: 'Erneut versuchen'
});

/** @typedef {'checking' | 'owner' | 'released' | 'blocked' | 'unsupported'} AppTabState */
/** @typedef {{holdWritesUntil: (decision: Promise<unknown>) => void, blockDocumentWrites: (message: string) => void}} AppTabPersistence */
/** @typedef {{state: () => AppTabState}} AppTabLock */

/** @type {WeakMap<Document, AppTabLock>} */
const tabs = new WeakMap();

/**
 * @param {{win?: Window, doc?: Document, persistence?: AppTabPersistence, waitMs?: number,
 *   showDialog?: (request: {doc: Document, reload: () => void}) => Promise<unknown>, reload?: () => void}} [options]
 * @returns {AppTabLock | null} null: Schnittstellen fehlen oder EXE; dann bleibt das bisherige Verhalten.
 */
export function startAppTabLock({ win = globalThis.window, doc = win?.document, persistence = PersistenceFacade,
    waitMs = SAME_TAB_WAIT_MS, showDialog = showAppTabDialog, reload = () => win?.location?.reload() } = {}) {
    const locks = win?.navigator?.locks;
    /** @type {Storage | null} */
    let session = null;
    try { session = win?.sessionStorage || null; } catch { session = null; }
    if (!win || !doc || !locks?.request || !session || typeof win.addEventListener !== 'function'
        || typeof AbortController !== 'function' || detectRuntime(/** @type {Window & typeof globalThis} */ (win)) === 'tauri') return null;
    const existing = tabs.get(doc);
    if (existing) return existing;
    const storage = session;

    /** @type {AppTabState} */
    let state = 'checking';
    let hidden = false;
    /** @type {(() => void) | null} */
    let release = null;
    /** @type {AbortController | null} */
    let waiting = null;

    function ownedBefore() {
        try { return storage.getItem(APP_TAB_OWNER_KEY) === '1'; } catch { return false; }
    }
    /** @param {boolean} owned */
    function remember(owned) {
        try { if (owned) storage.setItem(APP_TAB_OWNER_KEY, '1'); else storage.removeItem(APP_TAB_OWNER_KEY); }
        catch { /* Der Merker beschleunigt nur den Seitenwechsel. */ }
    }
    /** Löst mit true auf, sobald dieser Tab die Sperre hält; false: belegt, abgebrochen oder Seite verlassen.
     * @param {LockOptions} options
     * @returns {Promise<boolean>}
     */
    function acquire(options) {
        return new Promise((resolve, reject) => {
            locks.request(APP_TAB_LOCK, options, lock => {
                // Eine schon verlassene Seite gibt eine späte Zusage sofort zurück.
                if (!lock || hidden) { resolve(false); return undefined; }
                resolve(true);
                return new Promise(done => { release = () => done(undefined); });
            }).then(() => resolve(false), error => error?.name === 'AbortError' ? resolve(false) : reject(error));
        });
    }
        function block() {
        state = 'blocked';
        remember(false);
        persistence.blockDocumentWrites(BLOCK_MESSAGE);
        void Promise.resolve().then(() => showDialog({ doc: /** @type {Document} */ (doc), reload })).catch(() => {});
    }
    function decide() {
        const controller = ownedBefore() ? new AbortController() : null;
        waiting = controller;
        const timer = controller ? setTimeout(() => controller.abort(), waitMs) : undefined;
        state = 'checking';
        /** @type {LockOptions} */
        const options = controller ? { mode: 'exclusive', signal: controller.signal } : { mode: 'exclusive', ifAvailable: true };
        const decision = acquire(options).then(owned => {
            if (hidden) {
                if (release) { release(); release = null; }
                state = 'released';
            } else if (owned) {
                state = 'owner';
                remember(true);
            } else block();
        }, () => { state = 'unsupported'; }).finally(() => {
            clearTimeout(timer);
            if (waiting === controller) waiting = null;
        });
        // Persistenzstart und Writes warten auf diese Entscheidung (persistence-facade/initialization.js, writes.js).
        persistence.holdWritesUntil(decision);
        return decision;
    }

    win.addEventListener('pagehide', () => {
        hidden = true;
        waiting?.abort();
        // Der Merker bleibt: Die nächste Seite in diesem Tab wartet auf genau diese Freigabe.
        if (release) { release(); release = null; }
        if (state === 'owner') state = 'released';
    });
    win.addEventListener('pageshow', event => {
        if (!event.persisted) return;
        hidden = false;
        if (state === 'released') decide();
    });

    /** @type {AppTabLock} */
    const handle = { state: () => state };
    tabs.set(doc, handle);
    decide();
    return handle;
}

/** Gemeinsamer Seitendialog mit einem Knopf; er bleibt offen, bis dieser Tab neu lädt oder geschlossen wird.
 * @param {{doc: Document, reload?: () => void}} request
 * @returns {Promise<unknown>}
 */
export function showAppTabDialog({ doc, reload = () => doc.defaultView?.location?.reload() }) {
    return runPageDialog({ title: APP_TAB_TEXTS.title, description: APP_TAB_TEXTS.description, doc, id: 'appTabDialog', queue: true },
        ({ dialog, doc: page, listen }) => {
            const actions = page.createElement('div'); actions.className = 'ds-actions';
            const retry = page.createElement('button'); retry.type = 'button'; retry.dataset.appTabRetry = '';
            retry.className = 'ds-button ds-button-primary'; retry.textContent = APP_TAB_TEXTS.retry;
            listen(retry, 'click', () => reload());
            actions.appendChild(retry); dialog.appendChild(actions);
            return { controls: () => [retry], blocked: () => true };
        });
}
