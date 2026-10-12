import { listProfileScopedKeys, isProfileScopedKey } from './profile-key-policy.js';
import { initializeProbelaufPage, getProbelaufController } from '../shared/probelauf-state.js';
import { bindProbelaufUI, renderProbelaufUI } from '../shared/probelauf-ui.js';
import { loadProfileRegistry } from './profile-registry.js';
import { buildPersonMigrationDraft, migratePersonData } from './profile-person-migration.js';
import { importProfilesBundleFromWindowName } from './profile-bundle-io.js';
// @ts-check

import {
    ProfileRecoveryError,
    bootstrapProfileContext,
    exportProfilesBundleToWindowName,
    saveCurrentProfileFromLocalStorage
} from './profile-storage.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';
import { getPageNavigationGuard, reloadGuardedPage } from '../shared/navigation-guard-dialog.js';

async function runPersistenceFlush(flusher) {
    if (typeof flusher !== 'function') return true;
    const result = await flusher();
    if (result === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    return true;
}

const handoffBindings = new WeakMap();
const handoffTransitions = new WeakMap();
const pageReadiness = new WeakMap();
const pageInitializations = new WeakMap();
const startupControls = new WeakMap();
const migrationRetries = new WeakMap();
const migrationRetryErrors = new WeakMap();
const PROFILE_STARTUP_CONTROLS = 'input[id^="profile"], select[id^="profile"], textarea[id^="profile"], button[id^="profile"], #managerPersonName, #managerPersonCreateBtn, #managerPersonRenameBtn, #managerPeopleList input, #managerPeopleList button';

function lockProfileStartupControls(doc) {
    const controls = Array.from(doc?.querySelectorAll?.(PROFILE_STARTUP_CONTROLS) || []);
    startupControls.set(doc, controls.map(control => [control, Boolean(control.disabled)]));
    controls.forEach(control => { control.disabled = true; });
}

const indexLifecycleInitializations = new WeakMap();
const subpageLifecycleInitializations = new WeakMap();

async function initializeLifecycleOnce(win, initializedFlag, pending, initialize) {
    if (win?.[initializedFlag]) return false;
    if (win && pending.has(win)) {
        await pending.get(win);
        return false;
    }
    if (win?.__personMigrationDeferred) return false;
    // Vor Migration/Bootstrap reservieren; Mitstarter warten auf dasselbe Ende.
    const task = Promise.resolve().then(initialize);
    if (win) pending.set(win, task);
    try {
        await task;
        return true;
    } finally {
        // Ein fehlgeschlagener Start darf einen späteren Neuversuch nicht sperren.
        if (win) pending.delete(win);
    }
}

function readinessFor(doc) {
    if (!pageReadiness.has(doc)) {
        let resolve;
        // Ein Ergebnis statt einer frühen Promise-Rejection verhindert unbehandelte Fehler.
        const promise = new Promise(done => { resolve = done; });
        pageReadiness.set(doc, { promise, resolve, settled: false });
    }
    return pageReadiness.get(doc);
}

export async function whenProfilePageReady(doc = globalThis.document) {
    const result = await readinessFor(doc).promise;
    if (result.error) throw result.error;
    return true;
}

/** Bootstrap-Recovery ist keine erfolgreiche Bereitschaft für die Identitätsanzeige. */
export async function whenProfileDisplayReady(doc = globalThis.document) {
    await whenProfilePageReady(doc);
    const result = await readinessFor(doc).promise;
    return result.profileAvailable;
}

export function completeProfilePageReadiness(doc = globalThis.document, error = null, profileAvailable = true) {
    const state = readinessFor(doc);
    if (state.settled) return false;
    state.settled = true;
    if (!error && profileAvailable) {
        for (const [control, disabled] of startupControls.get(doc) || []) control.disabled = disabled;
        startupControls.delete(doc);
    }
    state.resolve({ error, profileAvailable });
    return true;
}

export function showHandoffFailure(root, error) {
    const doc = root?.ownerDocument || root;
    const target = doc?.getElementById?.('suiteNavigationStatus');
    if (!target) return;
    target.hidden = false;
    target.textContent = error?.code === 'PERSISTENCE_RELOAD_REQUIRED' ? error.message
        : 'Navigation abgebrochen: Die Profilübergabe konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen.';
}

function clearHandoffFailure(root) {
    const target = (root?.ownerDocument || root)?.getElementById?.('suiteNavigationStatus');
    if (target) { target.textContent = ''; target.hidden = true; }
}

export function shouldHandleProfileHandoff(link) {
    if (!link || typeof link.getAttribute !== 'function') return false;
    if (link.dataset?.profileHandoff === 'false') return false;
    if (!link.hasAttribute('data-profile-handoff') || link.hasAttribute('download')) return false;
    const href = String(link.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#') || /^(?:javascript|data|mailto|tel):/i.test(href)) return false;
    const target = String(link.getAttribute('target') || '').toLowerCase();
    return !target || target === '_self';
}

/** Alle lokalen HTML-Ziele im selben Tab, auch unmarkierte Karten/Recovery. */
export function shouldHandleAppNavigation(link, win) {
    if (!link || link.hasAttribute('download')) return false;
    const href = String(link.getAttribute('href') || '').trim();
    const target = String(link.getAttribute('target') || '').toLowerCase();
    if (!href || href.startsWith('#') || (target && target !== '_self')) return false;
    try {
        const base = new URL(win?.location?.href || 'index.html', 'http://localhost/index.html');
        const url = new URL(href, base);
        return url.origin === base.origin && /\.html$/i.test(url.pathname);
    } catch { return false; }
}

/** Ein Listener je Root, auch für später ersetzte Links. */
export function bindProfileNavigationHandoff(options = {}) {
    const {
        root = globalThis.document,
        selector = 'a[href]',
        exporter = exportProfilesBundleToWindowName,
        flusher = PersistenceFacade.flush,
        win = globalThis.window,
        ready = () => whenProfilePageReady(root.ownerDocument || root),
        beforeHandoff,
        afterFlush,
        guard = getPageNavigationGuard(root.ownerDocument || root, win),
        onFailure = error => { if (!String(error?.message).startsWith('NAVIGATION_CANCEL_')) showHandoffFailure(root, error); }
    } = options;
    if (!root?.addEventListener || handoffBindings.has(root)) return 0;
    const doc = root.ownerDocument || root;
    if (!handoffTransitions.has(doc)) handoffTransitions.set(doc, { pending: false });
    const state = handoffTransitions.get(doc);
    const handler = async event => {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
            || (event.button !== undefined && event.button !== 0)) return;
        const link = event.target?.closest?.(selector);
        if (!link?.isConnected || !root.contains(link) || !shouldHandleAppNavigation(link, win) || !win?.location) return;
        const href = String(link.getAttribute('href')).trim();
        event.preventDefault();
        if (state.pending) return;
        state.pending = true;
        let navigated = false;
        const context = { root, link, href, win };
        let attempt = null;
        let previousName, exported = false;
        try {
            attempt = await guard.prepare({ opener: link });
            if (!attempt) return;
            if (beforeHandoff && await beforeHandoff(context) === false) return;
            if (!guard.validate(attempt)) return;
            const recoveryTarget = /^(?:\.\/)?(?:Daten-Sicherung|Handbuch)\.html(?:[?#]|$)/.test(href);
            let profileReady = false;
            try { profileReady = await ready() !== false; }
            catch (error) { if (!recoveryTarget) throw error; }
            if (!profileReady && !recoveryTarget) return;
            if (!guard.validate(attempt)) return;
            if (profileReady && (!recoveryTarget || !['corrupt', 'unavailable'].includes(loadProfileRegistry().status)) && !getProbelaufController(doc)?.state && !win?.__personMigrationDeferred && shouldHandleProfileHandoff(link) && link.dataset?.profileHandoffExport !== 'false') {
                previousName = win.name;
                exported = true;
                if (await exporter() === false) throw new Error('PROFILE_HANDOFF_EXPORT_FAILED');
            }
            await runPersistenceFlush(flusher);
            if (afterFlush && await afterFlush(context) === false) return;
            if (!guard.validate(attempt)) return;
            clearHandoffFailure(root);
            navigated = guard.commitNavigation(attempt, () => { win.location.href = href; });
        } catch (error) {
            onFailure(error, link);
        } finally {
            // Bis zum Dokumentwechsel gesperrt bleiben; auch ein später zweiter Klick
            // im selben Dokument darf keine weitere Übergabe starten.
            if (!navigated) {
                if (exported) win.name = previousName;
                if (attempt) guard.end(attempt);
                state.pending = false;
            }
        }
    };
    root.addEventListener('click', handler);
    handoffBindings.set(root, state);
    return 1;
}

/** Gemeinsamer, wiederholbarer Start; Handbuch ohne Profilbootstrap oder Speicherhooks. */
export function initializeProfilePage(options = {}) {
    const { doc = globalThis.document, win = globalThis.window, kind = doc?.documentElement?.dataset?.suitePage } = options;
    bindProfileNavigationHandoff({ root: doc, win });
    if (pageInitializations.has(doc)) return pageInitializations.get(doc);
    lockProfileStartupControls(doc);
    const task = (async () => {
        try {
            await PersistenceFacade.init({ doc, window: win, installLifecycleHooks: kind !== 'handbook', installTauriCloseHook: true });
            const probelauf = await initializeProbelaufPage({ doc, win, guard: getPageNavigationGuard(doc, win),
                saveProfile: () => {
                    const profileId = PersistenceFacade.getItemSync('rs_current_profile');
                    const profile = loadProfileRegistry().value?.profiles?.[profileId];
                    const liveKeys = listProfileScopedKeys();
                    const savedKeys = Object.keys(profile?.data || {}).filter(isProfileScopedKey);
                    const unchanged = profile && liveKeys.length === savedKeys.length && liveKeys.every(key => PersistenceFacade.getItemSync(key) === profile.data[key]);
                    if (!unchanged) saveCurrentProfileFromLocalStorage();
                }, notify: (controller, error) => renderProbelaufUI(doc, controller, error) });
            bindProbelaufUI(doc, probelauf);
            if (probelauf.blocked) throw new Error('Probelauf-Recovery: Ausgangsbestand wiederherstellen, bevor Fachdaten geladen werden.');
            if (kind === 'handbook') {
                installProfileBfcacheRefresh({ win, doc });
                completeProfilePageReadiness(doc);
            } else if (kind === 'index') {
                await initProfileIndexLifecycle({ root: doc, win });
            } else {
                await initProfileSubpageLifecycle({ doc, win });
            }
            return true;
        } catch (error) {
            const probelauf = getProbelaufController(doc);
            if (probelauf) { bindProbelaufUI(doc, probelauf); renderProbelaufUI(doc, probelauf, error); }
            if (error instanceof ProfileRecoveryError) {
                if (win) win.__profileRecoveryBlocker = error;
                const recoveryHost = doc?.getElementById?.('error-container');
                if (recoveryHost) {
                    recoveryHost.className = 'error-warn ds-note ds-note-error';
                    recoveryHost.textContent = `Profil-Recovery erforderlich: ${error.message}`;
                }
            }
            completeProfilePageReadiness(doc, error);
            showHandoffFailure(doc, error);
            const status = doc?.getElementById?.('suiteNavigationStatus');
            if (status) { status.hidden = false; status.textContent = error instanceof ProfileRecoveryError
                ? `Profil-Recovery erforderlich: ${error.message}` : `Personen-/Profilstart blockiert: ${error.message}`; }
            return false;
        }
    })();
    pageInitializations.set(doc, task);
    return task;
}

export function installProfilePersistenceHooks(options = {}) {
    const {
        win = window,
        doc = document,
        saver = saveCurrentProfileFromLocalStorage,
        flusher = PersistenceFacade.flush
    } = options;

    if (!win || !doc) return false;
    if (win.__rsProfilePersistenceHooksInstalled) return false;

    const guard = getPageNavigationGuard(doc, win);

    const persist = () => {
        // Dieser unabhängige Anlass besitzt keinen laufenden Commit und darf
        // weder dessen Zwischenstand noch veraltete Restore-/Resetwerte sichern.
        if (PersistenceFacade.hasSyncWriteBlocks() || guard.reasons().some(reason => reason.phase === 'commit')) {
            return Promise.resolve(false);
        }
        try {
            saver();
        } catch (error) {
            console.error('[ProfileNavigation] Profil-Snapshot fehlgeschlagen:', error);
            return Promise.resolve(false);
        }
        return runPersistenceFlush(flusher).catch(error => {
            console.error('[ProfileNavigation] Persistenz-Flush fehlgeschlagen:', error);
            return false;
        });
    };

    // Nur früherer Speicherbeginn: keine Nachfrage, kein preventDefault/returnValue
    // und keine Garantie, dass asynchrone Writes vor dem Entladen abgeschlossen sind.
    win.addEventListener('beforeunload', persist);

    // Die Facade bindet ihren Bubble-Flush schon beim Bootstrap. Der Snapshot
    // muss vorher entstehen, auch wenn zwischen Listenern Microtasks laufen.
    win.addEventListener('pagehide', persist, true);

    doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'hidden') {
            persist();
        }
    }, true);

    win.__rsProfilePersistenceHooksInstalled = true;
    return true;
}

function waitForRestoredNavigation(guard, doc) {
    if (!guard.isBusy()) return Promise.resolve(true);
    return new Promise(resolve => {
        const finish = unchanged => {
            unsubscribe();
            doc?.removeEventListener?.('input', input, true);
            doc?.removeEventListener?.('change', input, true);
            resolve(unchanged);
        };
        const input = () => finish(false);
        const unsubscribe = guard.subscribe(() => { if (!guard.isBusy()) finish(true); });
        doc?.addEventListener?.('input', input, true);
        doc?.addEventListener?.('change', input, true);
    });
}

export function installProfileBfcacheRefresh(options = {}) {
    const {
        win = window,
        doc = win?.document || globalThis.document,
        reload = () => win?.location?.reload?.(),
        guard: suppliedGuard,
        ready = () => whenProfilePageReady(doc),
        flusher = PersistenceFacade.flush
    } = options;

    if (!win || typeof win.addEventListener !== 'function') return false;
    if (win.__rsProfileBfcacheRefreshInstalled) return false;
    const guard = suppliedGuard || getPageNavigationGuard(doc, win);

    let pending = false;
    win.addEventListener('pageshow', async event => {
        if (!event?.persisted || pending) return;
        guard.restoreDocument();
        const transition = handoffTransitions.get(doc);
        if (transition) transition.pending = false;
        pending = true;
        try {
            // Der alte Handler behält seinen Besitzer bis zum echten Ende.
            // Erst danach kann eine neue Zustimmung den BFCache-Reload erlauben.
            if (!await waitForRestoredNavigation(guard, doc)) {
                const host = doc?.getElementById?.('suiteNavigationStatus');
                if (host) {
                    host.hidden = false;
                    host.textContent = 'Navigation abgebrochen: Der Zustand hat sich geändert. Bitte erneut versuchen.';
                }
                return;
            }
            await reloadGuardedPage({ doc, win, guard, ready, flush: () => runPersistenceFlush(flusher), reload });
        } catch { showHandoffFailure(doc); }
        finally { pending = false; }
    });

    win.__rsProfileBfcacheRefreshInstalled = true;
    return true;
}

function completeDeferredMigration(doc, win) {
    if (win) win.__personMigrationDeferred = true;
    bindProfileNavigationHandoff({ root: doc, win });
    installProfileBfcacheRefresh({ win, doc });
    const status = doc?.getElementById?.('suiteNavigationStatus');
    if (status) { status.hidden = false; status.textContent = 'Umstellung der Personendaten ausstehend. Mit „Jetzt übernehmen“ kannst du die Angaben hier prüfen.'; }
    completeProfilePageReadiness(doc, null, false);
}

/** Aufschub ist ein Bedienzustand; technische Fehler bleiben gesperrt. */
export function profileMigrationDisplayState(doc = globalThis.document, win = doc?.defaultView || globalThis.window) {
    if (migrationRetryErrors.has(doc)) return 'unavailable';
    return win?.__personMigrationDeferred ? 'deferred' : null;
}

/** Dieselbe Übernahme, ein Besitzer je Dokument; Freigabe erst im neuen Dokument. */
export function retryDeferredPersonMigration({ doc = globalThis.document, win = doc?.defaultView || globalThis.window,
    migrate = () => migratePendingPersonData(doc, win), reload = () => win.location.reload() } = {}) {
    if (migrationRetries.has(doc)) return migrationRetries.get(doc);
    const task = Promise.resolve().then(async () => {
        await pageInitializations.get(doc);
        if (profileMigrationDisplayState(doc, win) !== 'deferred') return false;
        try {
            const migration = await migrate();
            if (migration.status === 'cancelled') return false;
            if (!migration.ok) throw new Error('Personenumstellung konnte nicht abgeschlossen werden.');
            // Readiness und Rechner sind dokumentlokal zwischengespeichert.
            // Der Aufschubblocker bleibt bis zum geschützten Neustart bestehen.
            return await reloadGuardedPage({ doc, win, reload,
                ready: () => whenProfilePageReady(doc), flush: () => runPersistenceFlush(PersistenceFacade.flush) });
        } catch (error) {
            // Navigation/Probelauf können die Vorbereitung regulär abbrechen
            // oder bereits besitzen. Das ist kein beschädigter Profilbestand.
            if (error.name === 'AbortError' || error.code === 'NAVIGATION_WRITE_BUSY') return false;
            migrationRetryErrors.set(doc, error);
            const host = doc?.getElementById?.('suiteNavigationStatus');
            if (host) { host.hidden = false; host.textContent = `Personen-/Profilstart blockiert: ${error.message}`; }
            return false;
        }
    });
    migrationRetries.set(doc, task);
    // Ein erfolgreicher Neustart behält den Dokumentbesitzer bis zum Entladen.
    // Sonst könnte ein weiterer Klick im alten Dokument nochmals reloaden.
    task.then(reloaded => { if (!reloaded) migrationRetries.delete(doc); }, () => migrationRetries.delete(doc));
    return task;
}

// Der bestätigte aktuelle Bestand benötigt keine schreibende Migrations-Lease.
// So kann ein früher, bereits bestätigter Seitenguard auf Bereitschaft warten,
// ohne dass der rein lesende Bootstrap dieselbe Navigation als Fremdaktion sieht.
async function migratePendingPersonData(doc, win) {
    const records = Object.fromEntries(PersistenceFacade.keysSync().map(key => [key, PersistenceFacade.getItemSync(key)]));
    const draft = buildPersonMigrationDraft(records, { inspectOnly: true });
    if (!draft.people.some(person => person.needed)) {
        await runPersistenceFlush(PersistenceFacade.flush);
        return { ok: true, status: 'current' };
    }
    return migratePersonData({ doc, win });
}

export async function initProfileIndexLifecycle(options = {}) {
    const {
        root = document,
        win = window
    } = options;
    return initializeLifecycleOnce(win, '__rsProfileIndexLifecycleInitialized', indexLifecycleInitializations, async () => {
        const registryStatus = loadProfileRegistry().status;
        const migration = ['corrupt', 'unavailable'].includes(registryStatus) ? { ok: true } : await migratePendingPersonData(root, win);
        if (migration.status === 'cancelled') {
            completeDeferredMigration(root, win);
            return;
        }
        if (!migration.ok) throw new Error('Personenumstellung konnte nicht abgeschlossen werden.');
        const bootstrap = bootstrapProfileContext();
        bindProfileNavigationHandoff({ root, win });
        installProfileBfcacheRefresh({ win, doc: root });
        if (win) win.__rsProfileIndexLifecycleInitialized = true;
        completeProfilePageReadiness(root, null, bootstrap?.action !== 'recovery');
    });
}

export async function initProfileSubpageLifecycle(options = {}) {
    const {
        win = window,
        doc = document
    } = options;

    return initializeLifecycleOnce(win, '__rsProfileSubpageLifecycleInitialized', subpageLifecycleInitializations, async () => {
        if (!PersistenceFacade.getItemSync('rs_profiles_v1')) importProfilesBundleFromWindowName();
        const registryStatus = loadProfileRegistry().status;
        const migration = ['corrupt', 'unavailable'].includes(registryStatus) ? { ok: true } : await migratePendingPersonData(doc, win);
        if (migration.status === 'cancelled') {
            completeDeferredMigration(doc, win);
            return;
        }
        if (!migration.ok) throw new Error('Personenumstellung konnte nicht abgeschlossen werden.');
        const bootstrap = bootstrapProfileContext({
            importFromWindowName: true,
            preserveLiveProfileData: true
        });
        bindProfileNavigationHandoff({ root: doc, win });
        installProfilePersistenceHooks({ win, doc });
        installProfileBfcacheRefresh({ win, doc });
        if (win) win.__rsProfileSubpageLifecycleInitialized = true;
        completeProfilePageReadiness(doc, null, bootstrap?.action !== 'recovery');
    });
}
