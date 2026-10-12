import { startSimulatorDocument, startAutomaticBacktest, createSimulatorInitialization } from '../app/simulator/simulator-auto-backtest.js';
import {
    bindProfileNavigationHandoff, installProfileBfcacheRefresh, installProfilePersistenceHooks,
    shouldHandleProfileHandoff, whenProfilePageReady, completeProfilePageReadiness,
    initializeProfilePage, initProfileSubpageLifecycle, initProfileIndexLifecycle, whenProfileDisplayReady
} from '../app/profile/profile-navigation.js';
import { ensureProfileRegistry, saveCurrentProfileFromLocalStorage } from '../app/profile/profile-storage.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { createNavigationGuard, RESET_RELOAD_REQUIRED_MESSAGE } from '../app/shared/navigation-guard.js';
import { PersistenceFacade, persistenceStorage, resetPersistenceForTests } from '../app/shared/persistence-facade.js';

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function fixture({ href = 'Balance.html', attrs = {}, dataset = {}, ...options } = {}) {
    const attributes = new Map(Object.entries({ href, 'data-profile-handoff': '', ...attrs }));
    const host = { hidden: true, textContent: '' };
    const recovery = { textContent: 'Bestehende Recoverymeldung' };
    const listeners = new Map();
    const root = {
        links: [],
        contains: link => root.links.includes(link),
        getElementById: id => id === 'suiteNavigationStatus' ? host : recovery,
        addEventListener(type, handler) { listeners.set(type, handler); },
        querySelectorAll: () => root.links
    };
    const link = {
        dataset, isConnected: true,
        getAttribute: key => attributes.get(key) ?? null,
        hasAttribute: key => attributes.has(key),
        closest: () => link
    };
    root.links = [link];
    const steps = [];
    let hrefValue = 'index.html';
    const win = { location: {
        get href() { return hrefValue; },
        set href(value) { steps.push('navigate'); hrefValue = value; }
    } };
    bindProfileNavigationHandoff({ root, win, ready: () => true,
        exporter: () => { steps.push('export'); return true; },
        flusher: () => { steps.push('flush'); return true; }, ...options });
    function click(overrides = {}, target = link) {
        const event = { target, button: 0, defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; }, ...overrides };
        const done = listeners.get('click')(event);
        return { event, done };
    }
    return { root, link, win, steps, click, host, recovery, listeners };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

{
    const f = fixture();
    assertEqual(shouldHandleProfileHandoff(f.link), true, 'Opt-in link should be eligible');
    const c = f.click();
    assertEqual(c.event.defaultPrevented, true, 'Eligible navigation should wait for confirmed flush');
    await c.done;
    assertEqual(f.steps.join(','), 'export,flush,navigate', 'Export → Flush → genau ein Wechsel');
    assertEqual(f.win.location.href, 'Balance.html', 'Bestätigter Flush wechselt zum echten Ziel');
    assertEqual(bindProfileNavigationHandoff({ root: f.root }), 0, 'Delegierte Bindung ist idempotent');
}
{
    const hold = deferred();
    const f = fixture({ href: 'depot-tranchen-manager.html', dataset: { profileHandoffExport: 'false' },
        flusher: () => { f.steps.push('flush'); return hold.promise; } });
    const c = f.click(); await tick();
    await f.click().done;
    assertEqual(f.steps.join(','), 'flush', 'Manager handoff must not copy profile payload to window.name');
    assertEqual(f.win.location.href, 'index.html', 'Offener Flush blockiert auch einen Doppelklick');
    hold.resolve(true); await c.done;
    assertEqual(f.steps.join(','), 'flush,navigate', 'Doppelklick erzeugt nur einen Wechsel');
}
{
    const hold = deferred();
    const f = fixture({ flusher: () => hold.promise });
    const root = { ownerDocument: f.root, contains: link => link === f.link,
        addEventListener(type, handler) { this.handler = handler; } };
    let secondExports = 0;
    bindProfileNavigationHandoff({ root, win: f.win, ready: () => true,
        exporter: () => { secondExports++; }, flusher: () => true });
    const c = f.click(); await tick();
    await root.handler({ target: f.link, button: 0, preventDefault() {} });
    assertEqual(secondExports, 0, 'Übergangssperre gilt dokumentweit auch bei anderem Root');
    hold.resolve(true); await c.done;
}
for (const stage of ['exporter', 'flusher']) {
    for (const failure of [() => false, () => { throw new Error('synthetisch'); }, async () => { throw new Error('synthetisch'); }]) {
        const f = fixture({ [stage]: failure });
        await f.click().done;
        assertEqual(f.win.location.href, 'index.html', 'Flush rejection should block navigation');
        assertEqual(f.host.hidden, false, 'Fehler bleibt im ortsfesten Rahmenhost sichtbar');
        assertEqual(f.recovery.textContent, 'Bestehende Recoverymeldung', 'Recoverymeldung wird nicht überschrieben');
        await f.click().done;
        assertEqual(f.host.hidden, false, 'Fehler gibt Übergangssperre wieder frei');
    }
}
for (const message of [RESET_RELOAD_REQUIRED_MESSAGE, 'Reset noch nicht dauerhaft bestätigt. Bitte jetzt neu laden.']) {
    const error = Object.assign(new Error(message), { code: 'PERSISTENCE_RELOAD_REQUIRED' });
    const f = fixture({ exporter: () => { throw error; } });
    for (let attempt = 1; attempt <= 2; attempt++) {
        await f.click().done;
        assertEqual(f.host.hidden, false, 'Resetsperre bleibt im Standardhost sichtbar');
        assertEqual(f.host.textContent, message, 'Typisierte Resetsperre erhält ihre phasengerechte Nachricht');
        assertEqual(f.steps.length, 0, 'Resetsperre startet weder Flush noch Navigation');
        assertEqual(f.host.textContent.includes('Profilübergabe'), false, 'Resetsperre behauptet keinen Übergabefehler');
        assertEqual(f.host.textContent.includes('Bitte erneut versuchen'), false, 'Resetsperre erhält keinen generischen Retrytext');
    }
    let received;
    const custom = fixture({ exporter: () => { throw error; }, onFailure: (failure, link) => { received = { failure, link }; } });
    await custom.click().done;
    assertEqual(received?.failure, error, 'Injizierter Fehlerhook erhält den ursprünglichen Sperrfehler');
    assertEqual(received?.link, custom.link, 'Injizierter Fehlerhook erhält weiterhin den Link');
}
for (const overrides of [{ defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const f = fixture(); const c = f.click(overrides); await c.done;
    assertEqual(f.steps.length, 0, 'Bereits verhinderte und besondere Klicks bleiben eigenständig');
}
for (const config of [{ attrs: { download: '' } }, { attrs: { target: '_blank' } }, { href: '#kapitel' }]) {
    const f = fixture(config); const c = f.click(); await c.done;
    assertEqual(c.event.defaultPrevented, false, 'Download, Kapitel und fremder Tab bleiben nativ');
    assertEqual(f.steps.length, 0, 'Ausnahme exportiert und flusht nicht');
}
{
    const f = fixture(); const old = f.link;
    const replacement = { ...old, getAttribute: key => key === 'href' ? 'Simulator.html' : '', closest() { return this; } };
    old.isConnected = false; f.root.links = [replacement];
    await f.click({}, old).done;
    assertEqual(f.steps.length, 0, 'Abgetrennter Altlink navigiert nicht');
    await f.click({}, replacement).done;
    assertEqual(f.win.location.href, 'Simulator.html', 'DOM-Ersatz bleibt ohne erneute Bindung bedienbar');
    const foreign = { ...replacement, closest() { return this; } };
    await f.click({}, foreign).done;
    assertEqual(f.steps.filter(s => s === 'navigate').length, 1, 'Fremder Root wird nicht übernommen');
}
{
    const before = deferred(), flush = deferred(), after = deferred();
    const f = fixture({
        beforeHandoff: context => { assertEqual(context.href, 'Balance.html', 'Hook erhält geprüftes Ziel'); f.steps.push('before'); return before.promise; },
        flusher: () => { f.steps.push('flush'); return flush.promise; },
        afterFlush: () => { f.steps.push('after'); return after.promise; }
    });
    const c = f.click(); await tick();
    assertEqual(f.steps.join(','), 'before', 'Vor-Hook wird abgewartet');
    before.resolve(true); await tick();
    assertEqual(f.steps.join(','), 'before,export,flush', 'Flush folgt Export und Vor-Hook');
    flush.resolve(true); await tick();
    assertEqual(f.steps.join(','), 'before,export,flush,after', 'Nach-Hook wartet auf Flush');
    after.resolve(true); await c.done;
    assertEqual(f.steps.join(','), 'before,export,flush,after,navigate', 'Nach-Hook wird vor Navigation abgewartet');
}
for (const hook of ['beforeHandoff', 'afterFlush']) {
    const f = fixture({ [hook]: async () => false }); await f.click().done;
    assertEqual(f.win.location.href, 'index.html', 'Erweiterungspunkt false beendet den Ablauf');
}
for (const failure of [false, true]) {
    const f = fixture({ ready: () => whenProfilePageReady(f.root) });
    const c = f.click(); await tick();
    assertEqual(f.steps.length, 0, 'Früher Klick wartet vor dem Export auf Seitenbereitschaft');
    completeProfilePageReadiness(f.root, failure ? new Error('Start fehlgeschlagen') : null);
    await c.done;
    assertEqual(f.win.location.href, failure ? 'index.html' : 'Balance.html', 'Bereitschaftsfehler verhindert nativen Ersatzwechsel');
    assertEqual(completeProfilePageReadiness(f.root), false, 'Bereitschaft ist idempotent und nachlesbar');
    if (!failure) assertEqual(await whenProfilePageReady(f.root), true, 'Später Empfänger liest dieselbe Bereitschaft');
}
{
    let loads = 0;
    resetPersistenceForTests({ name: 'test', open: async () => {}, loadAll: async () => { loads++; return {}; }, saveBatch: async () => {} });
    const events = [], doc = { documentElement: { dataset: { suitePage: 'handbook' } }, contains: () => false,
        addEventListener: type => events.push(type), getElementById: () => null };
    let reloads = 0;
    const win = { addEventListener: type => events.push(type), location: { reload() { reloads++; } } };
    const first = initializeProfilePage({ doc, win });
    assertEqual(initializeProfilePage({ doc, win }), first, 'Handbuchinitialisierung ist idempotent');
    assertEqual(await first, true, 'Handbuch ist nach Persistenzinitialisierung bereit');
    assertEqual(reloads, 0, 'Handbuchstart erzeugt keinen zusätzlichen Reload');
    assertEqual(await whenProfilePageReady(doc), true, 'Handbuch meldet explizite Bereitschaft');
    assertEqual(await whenProfileDisplayReady(doc), true, 'Handbuchanzeige benötigt keinen Profilbootstrap');
    assertEqual(events.join(','), 'pageshow,click,pageshow', 'Handbuch bindet Navigation und BFCache, keine Profil-Speicherhooks');
    assertEqual(loads, 1, 'Handbuch startet Persistenz nur einmal');
    assertEqual(PersistenceFacade.keysSync().length, 0, 'Handbuch legt kein Defaultprofil an');
    resetPersistenceForTests();
}

{
    const doc = {};
    completeProfilePageReadiness(doc, null, false);
    assertEqual(await whenProfilePageReady(doc), true, 'Recovery ändert den bestehenden Handoff-Bereitschaftsvertrag nicht');
    assertEqual(await whenProfileDisplayReady(doc), false, 'Bootstrap-Recovery erlaubt keine aktuelle Identitätsanzeige');
}

{
    let flushes = 0;
    const f = fixture({ flusher: () => ++flushes > 1 });
    await f.click().done;
    assertEqual(f.host.hidden, false, 'Erster Flushfehler bleibt sichtbar');
    await f.click().done;
    assertEqual(flushes, 2, 'Nach Fehler ist ein neuer expliziter Versuch möglich');
    assertEqual(f.host.hidden, true, 'Erfolgreicher Versuch räumt ausschließlich den Handofffehler auf');
    await f.click().done;
    assertEqual(flushes, 2, 'Nach bestätigtem Wechsel bleibt dieses Dokument gegen weitere Übergaben gesperrt');
}
for (const kind of ['index', 'balance', 'simulator', 'manager']) {
    const opened = deferred(), events = [];
    resetPersistenceForTests({ name: 'test', open: () => opened.promise, loadAll: async () => ({}), saveBatch: async () => {} });
    const doc = { documentElement: { dataset: { suitePage: kind } }, contains: () => false,
        addEventListener: type => events.push(type), getElementById: () => null };
    let reloads = 0;
    const win = { addEventListener: type => events.push(type), location: { reload() { reloads++; } } };
    let ready = false;
    // Abonnenten vor dem Start dürfen weder Bootstrap noch Listener auslösen.
    const receiver = whenProfilePageReady(doc).then(() => { ready = true; });
    const parallel = whenProfilePageReady(doc);
    await tick();
    assertEqual(events.length, 0, 'Frühe Bereitschaftsabonnenten initialisieren keine Seite');
    const task = initializeProfilePage({ doc, win });
    assertEqual(initializeProfilePage({ doc, win }), task, 'Wiederholter Profilstart teilt das Dokumentpromise');
    await tick();
    assertEqual(events.join(','), 'pageshow,click', 'Start-/Unterseiten binden vor offener Persistenzinitialisierung');
    assertEqual(ready, false, 'Persistenz- und Profilbereitschaft werden nicht vorgezogen');
    opened.resolve(); await task; await receiver; await parallel;
    assertEqual(ready, true, 'Start-/Unterseiten melden Bereitschaft nach bestehendem Bootstrap');
    const count = events.length;
    const again = await (kind === 'index' ? initProfileIndexLifecycle({ root: doc, win }) : initProfileSubpageLifecycle({ doc, win }));
    assertEqual(again, false, 'Bestehende Lifecycles bleiben idempotent');
    assertEqual(events.length, count, 'Lifecyclewiederholung installiert keine weiteren Listener');
    assertEqual(events.filter(type => type === 'click').length, 1, 'Unterseite nutzt genau denselben zentralen Binder');
    assertEqual(reloads, 0, kind + ': normaler Start und Wiederholung ohne zusätzlichen Reload');
    resetPersistenceForTests();
}
{
    const first = {}, second = {}, failure = new Error('synthetischer Bereitschaftsfehler');
    let secondReady = false;
    const early = whenProfilePageReady(first).catch(error => error);
    const parallel = whenProfilePageReady(first).catch(error => error);
    const independent = whenProfilePageReady(second).then(() => { secondReady = true; });
    completeProfilePageReadiness(first, failure);
    assertEqual(await early, failure, 'Früher Abonnent beobachtet den ursprünglichen Startfehler');
    assertEqual(await parallel, failure, 'Paralleler Abonnent beobachtet denselben Startfehler');
    await tick();
    assertEqual(secondReady, false, 'Ein zweites Dokument besitzt unabhängige Bereitschaft');
    completeProfilePageReadiness(second); await independent;
    assertEqual(secondReady, true, 'Das zweite Dokument wird eigenständig freigegeben');
}
{
    resetPersistenceForTests({ name: 'test', open: async () => { throw new Error('synthetischer Startfehler'); } });
    const host = { hidden: true }, doc = { documentElement: { dataset: { suitePage: 'simulator' } }, contains: () => false,
        addEventListener() {}, getElementById: () => host };
    assertEqual(await initializeProfilePage({ doc, win: {} }), false, 'Gescheiterter Seitenstart wird explizit gemeldet');
    let failed = false;
    try { await whenProfilePageReady(doc); } catch { failed = true; }
    assertEqual(failed, true, 'Empfänger sieht die gescheiterte Bereitschaft');
    assertEqual(host.hidden, false, 'Gescheiterter Start erscheint am ortsfesten Fehlerhost');
    resetPersistenceForTests();
}

// Echte Migration am offenen Flush: gleichzeitige Starts dürfen nicht doppelt bootstrappen.
for (const kind of ['index', 'subpage']) for (const failsFirst of [false, true]) {
    let gate = deferred(), flushes = 0, bootstrapWrites = 0;
    const data = { profile_person_schema_version: '1', profile_geschlecht: 'm' };
    const records = { rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
        test: { meta: { id: 'test', name: 'Synthetische Person', belongsToHousehold: true }, data }
    } }), rs_current_profile: 'test', rs_active_profile: 'test', ...data };
    resetPersistenceForTests({ name: 'parallel-lifecycle', open: async () => {}, loadAll: async () => records,
        async saveBatch() { flushes++; await gate.promise; } });
    await PersistenceFacade.init({ installLifecycleHooks: false, debounceMs: 60000 });
    // Ein fachlich neutraler Dirty-Key hält die wirkliche Migrationsbarriere offen.
    PersistenceFacade.setItemSync('sim_lifecycle', 'Synthetischer Flushbeleg');
    const win = lifecycleTarget(), doc = lifecycleTarget();
    doc.contains = () => false;
    doc.getElementById = () => null;
    getPageNavigationGuard(doc, win);
    const guardPageshowCount = win.count('pageshow');
    const flag = kind === 'index' ? '__rsProfileIndexLifecycleInitialized' : '__rsProfileSubpageLifecycleInitialized';
    const start = () => kind === 'index' ? initProfileIndexLifecycle({ root: doc, win }) : initProfileSubpageLifecycle({ doc, win });
    // Indexbootstrap lädt die aktive ID; Unterseitenbootstrap sichert die Registry.
    // Beide Writes liegen außerhalb der bereits aktuellen, rein lesenden Migration.
    const originalSetItem = persistenceStorage.setItem;
    persistenceStorage.setItem = (key, value) => {
        if (key === (kind === 'index' ? 'rs_active_profile' : 'rs_profiles_v1')) bootstrapWrites++;
        return originalSetItem(key, value);
    };
    try {
        let pending = Promise.allSettled([start(), start()]);
        await tick();
        assertEqual(flushes, 1, `${kind}: parallele Starts warten auf genau einen Migrationsflush`);
        assertEqual(bootstrapWrites, 0, `${kind}: kein Bootstrap vor Ende der Migration`);
        assertEqual(doc.count('click'), 0, `${kind}: kein Navigationsbinding vor Ende der Migration`);
        assertEqual(win.count('pageshow'), guardPageshowCount, `${kind}: kein Profil-BFCache-Binding vor Ende der Migration`);
        if (failsFirst) {
            gate.reject(new Error('SYNTHETIC_MIGRATION_FLUSH_FAILURE'));
            const failures = await pending;
            assertEqual(failures.filter(result => result.status === 'rejected').length, 2, `${kind}: beide Starter beobachten den Migrationsfehler`);
            assertEqual(Boolean(win[flag]), false, `${kind}: Migrationsfehler setzt kein Erfolgsflag`);
            assertEqual(bootstrapWrites, 0, `${kind}: Migrationsfehler führt keinen Bootstrap aus`);
            assertEqual(doc.count('click') + win.count('pageshow'), guardPageshowCount, `${kind}: Migrationsfehler bindet keine Profil-Listener`);
            gate = deferred();
            pending = Promise.allSettled([start(), start()]);
            await tick();
            assertEqual(flushes, 2, `${kind}: Neuversuch startet genau einen weiteren Migrationsflush`);
        }
        gate.resolve();
        const results = await pending;
        assertEqual(results.filter(result => result.status === 'fulfilled' && result.value === true).length, 1, `${kind}: genau ein Starter meldet erfolgreiche Initialisierung`);
        assertEqual(results.filter(result => result.status === 'fulfilled' && result.value === false).length, 1, `${kind}: Mitstarter wartet und meldet keine zweite Initialisierung`);
        assertEqual(bootstrapWrites, 1, `${kind}: wirklicher Profilbootstrap läuft genau einmal`);
        assertEqual(doc.count('click'), 1, `${kind}: Clicklistener ist genau einmal gebunden`);
        assertEqual(win.count('pageshow'), guardPageshowCount + 1, `${kind}: Profil-BFCache-Listener ist genau einmal gebunden`);
        if (kind === 'subpage') assertEqual(doc.count('visibilitychange'), 1, 'Unterseiten-Speicherhook ist genau einmal gebunden');
        assertEqual(await start(), false, `${kind}: auch der spätere Aufruf bleibt idempotent`);
        assertEqual(bootstrapWrites, 1, `${kind}: späterer Aufruf bootstrapped nicht erneut`);
    } finally {
        persistenceStorage.setItem = originalSetItem;
        resetPersistenceForTests();
    }
}

console.log('Test 3: installProfilePersistenceHooks only installs once');
{
    let saveCount = 0;
    let flushCount = 0;
    const winListeners = new Map();
    const docListeners = new Map();
    const win = {
        __rsProfilePersistenceHooksInstalled: false,
        addEventListener(type, handler) {
            winListeners.set(type, handler);
        }
    };
    const doc = {
        visibilityState: 'visible',
        addEventListener(type, handler) {
            docListeners.set(type, handler);
        }
    };

    const first = installProfilePersistenceHooks({
        win,
        doc,
        saver: () => {
            saveCount += 1;
            return true;
        },
        flusher: () => {
            flushCount += 1;
            return true;
        }
    });
    const second = installProfilePersistenceHooks({
        win,
        doc,
        saver: () => {
            saveCount += 1;
            return true;
        },
        flusher: () => {
            flushCount += 1;
            return true;
        }
    });

    assertEqual(first, true, 'First install should register hooks');
    assertEqual(second, false, 'Second install should be ignored');

    assertEqual(winListeners.has('beforeunload'), true, 'Profilsicherung installiert einen getrennten Speicherlistener');
    winListeners.get('beforeunload')();
    winListeners.get('pagehide')();
    doc.visibilityState = 'hidden';
    docListeners.get('visibilitychange')();
    assertEqual(saveCount, 3, 'Alle drei Speicheranlässe rufen den Saver auf');
    assertEqual(flushCount, 3, 'Alle drei Speicheranlässe starten den Flush');
}
console.log('✓ installProfilePersistenceHooks OK');

// Browser-Ereignisse mit Capture/Bubble und Microtask-Checkpoint zwischen
// nativen Listeneraufrufen. Ein bloßer synchroner dispatch würde den Fehler
// verdecken, weil der Facadeflush selbst über eine Promise-Queue läuft.
function lifecycleTarget({ originalOrder = false, omitBeforeUnload = false } = {}) {
    const listeners = [];
    return {
        visibilityState: 'visible',
        addEventListener(type, handler, capture = false) {
            if (omitBeforeUnload && type === 'beforeunload') return;
            listeners.push({ type, handler, capture: originalOrder ? false : capture === true });
        },
        removeEventListener(type, handler) {
            const index = listeners.findIndex(entry => entry.type === type && entry.handler === handler);
            if (index >= 0) listeners.splice(index, 1);
        },
        async dispatch(type, event = { type, defaultPrevented: false, returnValue: 'unberührt',
            preventDefault() { this.defaultPrevented = true; } }) {
            for (const capture of [true, false]) {
                for (const entry of listeners.filter(entry => entry.type === type && entry.capture === capture)) {
                    entry.handler(event);
                    await tick();
                }
            }
            return event;
        },
        handlers: type => listeners.filter(entry => entry.type === type).map(entry => entry.handler),
        count: type => listeners.filter(entry => entry.type === type).length
    };
}

console.log('Regression Befund 6: echte Lifecyclehooks sichern ausschließlich vorhandene MC-Livewerte verlustfrei');
for (const event of ['bootstrap', 'beforeunload', 'pagehide', 'visibilitychange']) {
    const data = { profile_geburtsdatum: '1960-05-06', profile_tagesgeld: '12345', profile_person_schema_version: '1',
        depot_tranchen: '[{"id":"synthetic-lot","type":"aktien_neu","shares":2,"purchasePrice":80,"currentPrice":100}]',
        sim_mcAnzahl: '100', sim_mcDauer: '20' };
    const other = { meta: { id: 'b', name: 'Anderes Profil' }, data: { profile_tagesgeld: '999', profile_person_schema_version: '1' } };
    const durable = { rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
        a: { meta: { id: 'a', name: 'Teilbestand' }, data }, b: other
    } }), rs_current_profile: 'a', rs_active_profile: 'a', sim_mcAnzahl: '500', sim_mcDauer: '30', etfProxyUrl: 'global' };
    resetPersistenceForTests({ loadAll: async () => ({ ...durable }), saveBatch: async ({ upserts, deletes }) => {
        deletes.forEach(key => delete durable[key]); upserts.forEach(([key, value]) => { durable[key] = value; });
    } });
    await PersistenceFacade.init({ installLifecycleHooks: false, debounceMs: 60000 });
    const win = lifecycleTarget(), doc = lifecycleTarget();
    if (event === 'bootstrap') {
        win.name = '';
        await initProfileSubpageLifecycle({ win, doc });
    } else {
        installProfilePersistenceHooks({ win, doc });
        doc.visibilityState = 'hidden';
        await (event === 'visibilitychange' ? doc : win).dispatch(event);
    }
    await PersistenceFacade.flush();
    const confirmed = JSON.parse(durable.rs_profiles_v1);
    assertEqual(JSON.stringify(confirmed.profiles.a.data), JSON.stringify({ ...data, sim_mcAnzahl: '500', sim_mcDauer: '30' }), `${event}: vollständige Registry nach bestätigtem Backendflush`);
    assertEqual(JSON.stringify(confirmed.profiles.b), JSON.stringify(other), `${event}: Fremdprofil unverändert`);
    assertEqual(durable.etfProxyUrl, 'global', `${event}: globaler Key unverändert`);
    resetPersistenceForTests();
}

for (const event of ['pagehide', 'visibilitychange']) {
    for (const originalOrder of [false, true]) {
        const durable = new Map(), batches = [], order = [];
        resetPersistenceForTests({ name: 'lifecycle-test', open: async () => {}, loadAll: async () => ({}),
            async saveBatch(batch) {
                order.push('batch');
                batches.push(structuredClone(batch));
                batch.upserts.forEach(([key, value]) => durable.set(key, value));
                batch.deletes.forEach(key => durable.delete(key));
            } });
        await PersistenceFacade.init({ installLifecycleHooks: false, debounceMs: 60000 });
        const win = lifecycleTarget({ originalOrder }), doc = lifecycleTarget({ originalOrder });
        PersistenceFacade.bindLifecycleFlush(doc, win); // tatsächliche frühere Facaderegistrierung
        PersistenceFacade.setItemSync('rs_profiles_v1', JSON.stringify({ value: 'alt' }));
        let snapshots = 0;
        const options = { win, doc, saver: () => {
            snapshots++;
            order.push('snapshot');
            PersistenceFacade.setItemSync('rs_profiles_v1', JSON.stringify({ value: 'neu' }));
        } };
        assertEqual(installProfilePersistenceHooks(options), true, 'Gemeinsamer Lifecycle installiert Profilsicherung');
        assertEqual(installProfilePersistenceHooks(options), false, 'Wiederholung installiert keinen zweiten Snapshotlistener');
        assertEqual(win.count('beforeunload'), 1, 'Lebenszyklussicherung installiert genau einen Speicherlistener');
        if (event === 'visibilitychange') {
            await doc.dispatch(event);
            assertEqual(snapshots, 0, 'Sichtbares Dokument löst keine Profilsicherung aus');
            assertEqual(batches.length, 0, 'Sichtbares Dokument löst keinen Lifecycleflush aus');
            doc.visibilityState = 'hidden';
        }
        await (event === 'pagehide' ? win : doc).dispatch(event);
        // Kein nachträglicher Testflush: erster Batch und Backend unabhängig lesen.
        const firstValue = JSON.parse(batches[0].upserts.find(([key]) => key === 'rs_profiles_v1')[1]).value;
        assertEqual(firstValue, originalOrder ? 'alt' : 'neu',
            originalOrder ? 'Gegenprobe: ursprüngliche Listenerordnung speichert im ersten Batch den alten Snapshot'
                : 'Capture-Snapshot liegt vor dem ersten Facadeflush im dauerhaften Batch');
        assertEqual(order[0], originalOrder ? 'batch' : 'snapshot', 'Gemeinsamer Lifecycle weist die tatsächliche Reihenfolge nach');
        assertEqual(JSON.parse(durable.get('rs_profiles_v1')).value, 'neu', 'Backend enthält den neuen Snapshot');
        assertEqual(snapshots, 1, 'Ein Ereignis erzeugt genau einen Snapshot');
        PersistenceFacade.unbindLifecycleFlush();
        assertEqual(win.count('pagehide'), 1, 'Facadecleanup entfernt nur ihren eigenen Flushlistener');
        assertEqual(doc.count('visibilitychange'), 1, 'Facadecleanup erhält Capture-Sicherung');
        resetPersistenceForTests();
    }
}

// Echter Profilsaver und echte Facade: nur beforeunload, kein Pagehide/Testflush.
for (const omitBeforeUnload of [false, true]) {
    const batches = [], durable = new Map();
    resetPersistenceForTests({ name: 'early-profile', open: async () => {}, loadAll: async () => ({}),
        async saveBatch(batch) {
            batches.push(structuredClone(batch));
            batch.upserts.forEach(([key, value]) => durable.set(key, value));
        } });
    await PersistenceFacade.init({ installLifecycleHooks: false, debounceMs: 60000 });
    PersistenceFacade.setItemSync('sim_lifecycle', 'alt');
    ensureProfileRegistry();
    const previousRegistry = PersistenceFacade.getItemSync('rs_profiles_v1');
    PersistenceFacade.setItemSync('sim_lifecycle', 'neu');
    const win = lifecycleTarget({ omitBeforeUnload }), doc = lifecycleTarget();
    const options = { win, doc };
    installProfilePersistenceHooks(options);
    assertEqual(installProfilePersistenceHooks(options), false, 'Wiederinstallation ergänzt keinen Zusatzhaken');
    const event = await win.dispatch('beforeunload');
    assertEqual(event.defaultPrevented, false, 'Speicherlistener verhindert kein Browserverlassen');
    assertEqual(event.returnValue, 'unberührt', 'Speicherlistener ändert returnValue nicht');
    if (omitBeforeUnload) {
        assertEqual(batches.length, 0, 'Gegenprobe ohne Zusatzhaken beginnt keinen Batch bei beforeunload');
        assertEqual(PersistenceFacade.getItemSync('rs_profiles_v1'), previousRegistry, 'Gegenprobe erzeugt keinen frühen Profilsnapshot');
    } else {
        const first = JSON.parse(batches[0].upserts.find(([key]) => key === 'rs_profiles_v1')[1]);
        assertEqual(first.profiles.default.data.sim_lifecycle, 'neu', 'Erster echter Batch enthält den synchron neuesten Profilsnapshot');
        const guard = getPageNavigationGuard(doc, win);
        const saverHandler = win.handlers('beforeunload')[0];
        let state = { dirty: true };
        const registration = guard.register('editor', { read: () => state });
        assertEqual(win.handlers('beforeunload').includes(guard.beforeUnload), true, 'Tatsächlicher zentraler Nachfragehandler ist bei Dirty angebunden');
        const denied = await win.dispatch('beforeunload');
        assertEqual(denied.defaultPrevented, true, 'Kombinierter Anlass führt die zentrale native Nachfrage aus');
        assertEqual(denied.returnValue, '', 'Nur zentraler Nachfragehandler setzt returnValue');
        // Native Ablehnung lässt dasselbe Dokument stehen; weitere Eingabe folgt.
        PersistenceFacade.setItemSync('sim_lifecycle', 'nach Ablehnung');
        await win.dispatch('beforeunload');
        const saved = JSON.parse(durable.get('rs_profiles_v1')).profiles.default;
        assertEqual(saved.data.sim_lifecycle, 'nach Ablehnung', 'Nächster Anlass erfasst weitere Eingaben nach abgelehntem Verlassen');
        await win.dispatch('pagehide');
        doc.visibilityState = 'hidden'; await doc.dispatch('visibilitychange');
        const repeated = JSON.parse(durable.get('rs_profiles_v1')).profiles.default;
        assertEqual(JSON.stringify(repeated.data), JSON.stringify(saved.data), 'Wiederholtes Speichern erhält sämtliche Fachwerte');
        assertEqual(repeated.id, saved.id, 'Wiederholtes Speichern erhält die Profilidentität');
        const comparable = profile => {
            const copy = structuredClone(profile);
            delete copy.meta.updatedAt;
            return JSON.stringify(copy);
        };
        assertEqual(comparable(repeated), comparable(saved), 'Außer updatedAt bleiben Name, Zugehörigkeit und übrige Profilwerte unverändert');
        state = { phase: 'commit' }; registration.notify();
        assertEqual(win.handlers('beforeunload').includes(guard.beforeUnload), true, 'Zentraler Handler bleibt während Commit angebunden');
        registration.unregister();
        assertEqual(win.handlers('beforeunload').includes(guard.beforeUnload), false, 'Sauberer Zustand entfernt nur die zentrale Nachfrage');
        assertEqual(win.handlers('beforeunload')[0], saverHandler, 'Speicherlistener bleibt nach Entfernen des Nachfragehandlers erhalten');
        const clean = await win.dispatch('beforeunload');
        assertEqual(clean.defaultPrevented, false, 'Sauberer kombinierter Zustand fragt nicht nach');
        assertEqual(clean.returnValue, 'unberührt', 'Sauberer kombinierter Zustand lässt returnValue unberührt');
    }
    resetPersistenceForTests();
}

// Der gemeinsame Profilpfad darf weder einen fremden Commit noch Schreibschutz überholen.
for (const blocker of ['commit', 'restore', 'reset']) {
    const ownerWrite = deferred(), batches = [];
    resetPersistenceForTests({ name: 'blocked-profile', open: async () => {}, loadAll: async () => ({}),
        async saveBatch(batch) { batches.push(batch); await ownerWrite.promise; } });
    await PersistenceFacade.init({ installLifecycleHooks: false, debounceMs: 60000 });
    PersistenceFacade.setItemSync('sim_lifecycle', 'Bestand des Besitzers');
    ensureProfileRegistry();
    const win = lifecycleTarget(), doc = lifecycleTarget(), guard = getPageNavigationGuard(doc, win);
    let saves = 0, flushes = 0;
    installProfilePersistenceHooks({ win, doc, saver: () => { saves++; return saveCurrentProfileFromLocalStorage(); },
        flusher: () => { flushes++; return PersistenceFacade.flush(); } });
    const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
    const registration = blocker === 'commit' ? guard.register('foreign-write', { read: () => ({ phase: 'commit' }) }) : null;
    const unblock = blocker === 'commit' ? null : PersistenceFacade.blockSyncWrites(
        blocker === 'reset' ? [] : ['rs_profiles_v1'], 'Bestand ersetzt', { prefixes: blocker === 'reset' ? ['sim_'] : [] });
    const flushing = PersistenceFacade.flush(); await tick();
    assertEqual(batches.length, 1, 'Autorisierter Besitzerflush beginnt auch bei aktivem Schutz');
    for (const event of ['beforeunload', 'pagehide', 'visibilitychange']) {
        doc.visibilityState = 'hidden';
        const native = await (event === 'visibilitychange' ? doc : win).dispatch(event);
        if (event === 'beforeunload') assertEqual(native.defaultPrevented, blocker === 'commit', 'Commitnachfrage bleibt vom unabhängigen Speicherpfad getrennt');
    }
    assertEqual(saves, 0, 'Sperrende Anlässe starten keinen Saver');
    assertEqual(flushes, 0, 'Sperrende Anlässe starten keinen eigenen Flush');
    assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, 'Registry- und Bestandsbytes bleiben unter Schutz unverändert');
    ownerWrite.resolve(); await flushing;
    registration?.unregister(); unblock?.();
    await win.dispatch('beforeunload');
    assertEqual(saves, 1, 'Nach Schutzende ist normaler Speicheranlass wieder wirksam');
    assertEqual(flushes, 1, 'Nach Schutzende darf eigener Flush wieder beginnen');
    resetPersistenceForTests();
    assertEqual(PersistenceFacade.hasSyncWriteBlocks(), false, 'Testreset räumt die rein lesbare Sperrverwaltung auf');
}

for (const failure of ['saver', 'flush-false', 'flush-throw']) for (const event of ['beforeunload', 'pagehide', 'visibilitychange']) {
    const win = lifecycleTarget(), doc = lifecycleTarget();
    let flushes = 0;
    const errors = [], previousError = console.error;
    console.error = (...args) => errors.push(args);
    try {
        installProfilePersistenceHooks({ win, doc,
            saver: () => { if (failure === 'saver') throw new Error('SYNTHETIC_SNAPSHOT_FAILURE'); },
            flusher: () => { flushes++; if (failure === 'flush-false') return false; throw new Error('SYNTHETIC_FLUSH_FAILURE'); } });
        doc.visibilityState = 'hidden';
        await (event === 'visibilitychange' ? doc : win).dispatch(event);
        assertEqual(flushes, failure === 'saver' ? 0 : 1, 'Saverfehler startet keinen Profilflush; Flushfehler wird einmal behandelt');
        assertEqual(errors.length, 1, 'Lifecyclefehler wird ohne unbehandelte Rejection gemeldet');
        assertEqual(win.count('beforeunload'), 1, 'Auch Fehler behalten nur den getrennten Speicherlistener');
    } finally { console.error = previousError; }
}

console.log('Test 4: installProfileBfcacheRefresh reloads stale browser cache');
{
    let reloadCount = 0;
    const winListeners = new Map();
    const win = {
        __rsProfileBfcacheRefreshInstalled: false,
        addEventListener(type, handler) {
            winListeners.set(type, handler);
        }
    };

    const first = installProfileBfcacheRefresh({
        win, doc: {}, guard: createNavigationGuard(), ready: () => true, flusher: () => true,
        reload: () => {
            reloadCount += 1;
        }
    });
    const second = installProfileBfcacheRefresh({
        win,
        reload: () => {
            reloadCount += 1;
        }
    });

    assertEqual(first, true, 'First BFCache hook install should register listener');
    assertEqual(second, false, 'Second BFCache hook install should be ignored');

    winListeners.get('pageshow')({ persisted: false });
    assertEqual(reloadCount, 0, 'Normal pageshow should not reload');

    await winListeners.get('pageshow')({ persisted: true });
    assertEqual(reloadCount, 1, 'BFCache restore should reload page');
}
console.log('✓ installProfileBfcacheRefresh OK');

for (const outcome of ['stay', 'input', 'false', 'throw', 'success']) {
    const statuses = [], listeners = new Map(), hold = deferred();
    const docListeners = new Map();
    const doc = { addEventListener: (type, fn) => docListeners.set(type, fn), removeEventListener: type => docListeners.delete(type) };
    const win = { addEventListener: (type, fn) => listeners.set(type, fn) };
    let decisions = 0, flushes = 0, reloads = 0;
    const guard = createNavigationGuard({ decide: () => { decisions++; return outcome !== 'stay'; }, status: text => statuses.push(text), schedule: () => 1, unschedule() {} });
    guard.register('result', { read: () => ({ result: true }) });
    const previous = await guard.prepare({ decide: () => true }); guard.commitNavigation(previous, () => {});
    installProfileBfcacheRefresh({ win, doc, guard, ready: () => true, reload: () => reloads++,
        flusher: () => { flushes++; return hold.promise; } });
    const returning = listeners.get('pageshow')({ persisted: true }); await tick();
    assertEqual(decisions, 1, 'BFCache-Rückkehr erbt keine alte Zustimmung und fragt den wiederhergestellten Ergebnisbesitzer');
    if (outcome !== 'stay') {
        assert(guard.reasons().some(reason => reason.phase === 'commit'), 'BFCache-Neueinführung schützt ihren wirklichen Flush');
        assertEqual(await guard.prepare(), null, 'Appnavigation überholt BFCache-Flush nicht');
    }
    if (outcome === 'input') {
        docListeners.get('input')();
        assertEqual(guard.reasons().filter(reason => reason.phase === 'commit').length, 1, 'Entwerteter BFCache-Flush behält bis zur Speicherantwort seinen Commitbesitzer');
        assertEqual(await guard.prepare(), null, 'Appnavigation bleibt auch nach BFCache-Eingabeentwertung gesperrt');
    }
    if (outcome === 'throw') hold.reject(new Error('BF_FLUSH')); else hold.resolve(outcome !== 'false');
    await returning;
    assertEqual(flushes, outcome === 'stay' ? 0 : 1, 'BFCache-Bleiben flusht nicht; Zustimmung flusht genau einmal');
    assertEqual(reloads, outcome === 'success' ? 1 : 0, 'BFCache lädt nur nach erneuter Zustimmung und bestätigtem unverändertem Flush');
    if (outcome === 'input') {
        const message = statuses.at(-1);
        assertEqual(message, 'Navigation abgebrochen: Der Zustand hat sich geändert. Bitte erneut versuchen.', 'Echter BFCache-Anschluss erhält nach Eingabe exakt den bisherigen Abbruchhinweis');
        assertEqual(message.includes('nicht gespeichert'), false, 'BFCache-Flush behauptet keine ausgebliebene Speicherung');
        assertEqual(/gesperrt|Schreibsperre|Schreibschutz/.test(message), false, 'BFCache-Flush behauptet keinen Schreibschutz');
        assertEqual(guard.isBusy(), false, 'Bestätigter entwerteter BFCache-Flush gibt den Versuch frei');
        assertEqual(guard.reasons().filter(reason => reason.phase === 'commit').length, 0, 'Bestätigter BFCache-Flush räumt seinen Commitbesitzer auf');
    }
    assertEqual(docListeners.size, 0, `${outcome}: echter BFCache-Anschluss räumt Eingabebeobachtung auf`);
}

console.log('✅ Profile navigation lifecycle validated');

for (const outcome of ['stay', 'input', 'change', 'waiting-input', 'waiting-change', 'false', 'throw', 'success']) {
    const hold = deferred(), freshFlush = deferred(), listeners = new Map(), statuses = [];
    let decisions = 0, flushes = 0, reloads = 0;
    const guard = createNavigationGuard({ decide: () => { decisions++; return decisions === 1 || outcome !== 'stay'; },
        status: text => statuses.push(text), schedule: () => 1, unschedule() {} });
    guard.register('result', { read: () => ({ result: true }) });
    const f = fixture({ guard, flusher: () => hold.promise });
    f.root.removeEventListener = type => f.listeners.delete(type);
    f.win.addEventListener = (type, fn) => listeners.set(type, fn);
    const pending = f.click(); await tick();
    installProfileBfcacheRefresh({ win: f.win, doc: f.root, guard, ready: () => true,
        flusher: () => { flushes++; return freshFlush.promise; },
        reload: () => { reloads++; f.steps.push('reload'); } });
    const returning = listeners.get('pageshow')({ persisted: true }); await tick();
    await listeners.get('pageshow')({ persisted: true });
    assertEqual(decisions, 1, 'Offener alter Flush bleibt Besitzer; BFCache fragt noch nicht erneut');
    assertEqual(flushes, 0, 'BFCache-Flush überholt den eingefrorenen Handoff nicht');
    assertEqual(reloads, 0, 'BFCache lädt vor Ende der alten Fortsetzung nicht neu');
    if (outcome.startsWith('waiting-')) f.listeners.get(outcome.slice(8))();
    hold.resolve(true); await pending.done; await tick();
    assertEqual(f.win.location.href, 'index.html', 'BFCache entwertet auch eine vor Rückkehr eingefrorene Handoff-Zustimmung');
    assertEqual(f.steps.includes('navigate'), false, 'Späte alte Flushantwort erzeugt nach BFCache keinen Zielwrite');
    const stopped = outcome === 'stay' || outcome.startsWith('waiting-');
    assertEqual(decisions, outcome.startsWith('waiting-') ? 1 : 2, 'Nach altem Handlerende braucht BFCache eine eigene neue Schutzentscheidung');
    assertEqual(flushes, stopped ? 0 : 1, 'Nur erneute Zustimmung startet genau einen neuen BFCache-Flush');
    assertEqual(reloads, 0, 'Auch nach altem Handlerende wartet der Reload auf den neuen bestätigten Flush');
    if (!stopped) {
        assert(guard.reasons().some(reason => reason.phase === 'commit'), 'Neue BFCache-Fortsetzung schützt den bestätigungspflichtigen Flush');
        assertEqual(await guard.prepare(), null, 'Neue Appnavigation überholt auch den nachgeholten BFCache-Flush nicht');
    }
    if (outcome === 'input' || outcome === 'change') f.listeners.get(outcome)();
    if (outcome === 'throw') freshFlush.reject(new Error('BF_FLUSH')); else freshFlush.resolve(outcome !== 'false');
    await returning;
    assertEqual(reloads, outcome === 'success' ? 1 : 0, 'Nach altem Ende folgt automatisch genau ein Reload nur bei neuer Zustimmung und unverändertem bestätigtem Flush');
    assertEqual(f.steps.includes('navigate'), false, 'Auch die neue Fortsetzung schreibt niemals das alte Handoffziel');
    assertEqual(f.steps.filter(step => step === 'export').length, 1, 'BFCache-Wiedereinführung exportiert kein weiteres Profilbundle');
    assertEqual(f.listeners.has('input') || f.listeners.has('change'), false, 'BFCache räumt seine Warte- und Reloadbeobachter auf');
    if (outcome.startsWith('waiting-')) assertEqual(f.host.hidden, false, 'Eingabe während alter Fortsetzung erklärt den ausgebliebenen Reload ortsfest');
    if (outcome === 'false' || outcome === 'throw') assertEqual(f.host.hidden, false, 'Fehler des nachgeholten Flush bleibt ortsfest sichtbar');
    if (outcome === 'input' || outcome === 'change') assert(statuses.some(text => text.includes('Zustand hat sich geändert')), 'Neue Eingabe verwirft auch die frische BFCache-Zustimmung mit Hinweis');
    guard.revokeNative();
    assertEqual(guard.isBusy(), false, 'Beendete Fortsetzungen geben ihre eigenen Reservierungen frei');
}

// Kontrollierter echter Binder: Zustimmung/alle Abbruchenden vor Bereitschaft/Export.
{
    const steps = [], confirmation = deferred(), ending = deferred();
    let state = { phase: 'running', revision: 1, operationId: 'job-1' };
    const guard = createNavigationGuard({ decide: () => { steps.push('decision'); return confirmation.promise; } });
    const registration = guard.register('job', { read: () => state, cancel: async () => {
        steps.push('cancel'); await ending.promise; state = { ...state, phase: 'idle' }; registration.notify(); steps.push('ended');
    } });
    const f = fixture({ guard, beforeHandoff: () => { steps.push('before'); return true; },
        ready: () => { steps.push('ready'); return true; },
        exporter: () => { steps.push('export'); f.win.name = 'new bundle'; },
        flusher: () => { steps.push('flush'); return true; },
        afterFlush: () => { steps.push('check'); return true; } });
    f.win.name = 'previous';
    const click = f.click(); await tick(); await f.click().done;
    assertEqual(steps.join(','), 'decision', 'Vor Zustimmung keine Bereitschaft, Übergabe oder Abbruch');
    confirmation.resolve(true); await tick();
    assertEqual(steps.join(','), 'decision,cancel', 'Alle Enden vor Handoff abwarten');
    ending.resolve(); await click.done;
    assertEqual(steps.join(','), 'decision,cancel,ended,before,ready,export,flush,check', 'Schutz und Hooks bilden einen einzigen Handoff');
    assertEqual(f.steps.join(','), 'navigate', 'Binder wechselt genau einmal');
}
for (const href of ['Handbuch.html', 'index.html#fullBackupImportBtn', 'Balance.html']) {
    const f = fixture({ href }); f.link.hasAttribute = key => key === 'href';
    await f.click({ button: undefined }).done;
    assertEqual(f.steps.join(','), 'flush,navigate', 'Unmarkierter Karten-/Recovery-/Enterlink erhält Schutz und Flush ohne Export');
}
for (const href of ['https://example.invalid/index.html', 'mailto:test@example.invalid', '#chapter']) {
    const f = fixture({ href }); await f.click().done;
    assertEqual(f.steps.length, 0, 'Externe Ziele und reine Anker bleiben eigenständig');
}
for (const stage of ['beforeHandoff', 'ready', 'exporter', 'flusher', 'afterFlush']) {
    const f = fixture({ exporter: () => { f.win.name = 'new bundle'; return true; }, [stage]: () => false });
    f.win.name = 'old bundle'; await f.click().done;
    assertEqual(f.win.name, 'old bundle', 'Abgelehnte Zwischenstufe stellt Übergabekanal wieder her');
    assertEqual(f.steps.includes('navigate'), false, 'Abgelehnte Zwischenstufe erzeugt keinen Zielwrite');
}
{
    const hold = deferred(); let state = { result: true, revision: 1 };
    const guard = createNavigationGuard({ decide: () => true });
    const registration = guard.register('result', { read: () => state });
    const f = fixture({ guard, exporter: () => { f.win.name = 'new'; return true; }, flusher: () => hold.promise });
    f.win.name = 'old'; const first = f.click(); await tick();
    state = { result: true, revision: 2 }; registration.notify(); hold.resolve(true); await first.done;
    assertEqual(f.win.location.href, 'index.html', 'Neue Revision im echten Handoffflush verhindert Zielwrite');
    assertEqual(f.win.name, 'old', 'Späte Ablehnung verwirft bereits exportierte Übergabe');
}

{
    const f = fixture({ dataset: { profileHandoff: 'false' } }); await f.click().done;
    assertEqual(f.steps.join(','), 'flush,navigate', 'Export-Opt-out erhält Schutz/Flush ohne Bundleexport');
}
{
    const guard = createNavigationGuard({ decide: () => false });
    guard.register('result', { read: () => ({ result: true }) });
    const f = fixture({ guard }); await f.click().done;
    assertEqual(f.steps.length, 0, 'Bleiben im echten Binder erzeugt keinen Export/Flush/Zielwrite');
}
for (const failure of [() => false, () => { throw new Error('ABBRUCH'); }]) {
    const guard = createNavigationGuard({ decide: () => true });
    guard.register('job', { read: () => ({ phase: 'running' }), cancel: failure });
    const f = fixture({ guard }); await f.click().done;
    assertEqual(f.steps.length, 0, 'Abbruchfehler im echten Binder erzeugt keinen Export/Flush/Zielwrite');
}

// Zusammenspiel der echten Profilbereitschaft mit dem einmaligen Simulatorstart.
for (const failingUi of [false, true]) {
    const gate = deferred(); let uiStarts = 0, runs = 0, persistenceStarts = 0;
    resetPersistenceForTests({ name: 'simulator-start', open: () => { persistenceStarts++; return gate.promise; },
        loadAll: async () => ({}), saveBatch: async () => {} });
    const makeDocument = () => ({ readyState: 'complete', documentElement: { dataset: { suitePage: 'simulator' } },
        contains: () => false, addEventListener() {}, getElementById: () => null });
    const doc = makeDocument(), second = makeDocument();
    const early = whenProfilePageReady(doc), parallel = whenProfilePageReady(doc);
    await tick();
    assertEqual(persistenceStarts, 0, 'Frühe Simulatorabonnenten starten weder Persistenz noch Profilbootstrap');
    const start = target => startSimulatorDocument(target, async () => {
        const profileReady = whenProfilePageReady(target);
        const initialization = createSimulatorInitialization({ persistenceReady: PersistenceFacade.init(), profileReady,
            isBlocked: () => false, initialize: () => { uiStarts++; if (failingUi && target === doc) throw new Error('UI_START_FAILED'); } });
        await startAutomaticBacktest(target, {
            persistenceReady: () => PersistenceFacade.init(), profileReady: () => profileReady,
            initializationReady: () => initialization.initialized, isBlocked: () => false, engineReady: () => true,
            provider: () => ({ bounds: { startYear: 1929, endYear: 2025 }, preparePeriod: () => ({ status: 'complete' }) }),
            currentYear: () => 2026, validate() {}, status() {}, setPeriod() {}, run: () => { runs++; }
        });
        await initialization.settle();
    });
    const first = start(doc); const observed = first.catch(error => error);
    assertEqual(start(doc), first, 'Paralleler Simulatorstart teilt Initialisierung und Öffnungslauf');
    const win = { addEventListener() {} };
    const profileStart = initializeProfilePage({ doc, win });
    assertEqual(initializeProfilePage({ doc, win }), profileStart, 'Wiederholter echter Profilstart bleibt dokumentbezogen einmalig');
    await tick();
    assertEqual(uiStarts, 0, 'Offene Persistenz hält die UI-Initialisierung fest');
    assertEqual(runs, 0, 'Offene Persistenz hält auch den Öffnungslauf fest');
    gate.resolve(); await profileStart; await early; await parallel;
    const result = await observed;
    assertEqual(result?.message, failingUi ? 'UI_START_FAILED' : undefined, 'UI-Startfehler bleibt am gemeinsamen Dokumentstart beobachtbar');
    assertEqual(uiStarts, 1, 'Erstes Simulatordokument initialisiert seine UI genau einmal');
    assertEqual(runs, failingUi ? 0 : 1, 'Genau ein Öffnungslauf, ausschließlich nach erfolgreicher UI-Initialisierung');
    assertEqual(await whenProfilePageReady(doc), true, 'Später Simulatorabonnent liest dieselbe Profilbereitschaft');
    const secondStart = start(second);
    await initializeProfilePage({ doc: second, win: { addEventListener() {} } });
    await secondStart;
    assertEqual(uiStarts, 2, 'Zweites Dokument besitzt eine unabhängige einmalige UI-Initialisierung');
    assertEqual(runs, failingUi ? 1 : 2, 'Zweites Dokument hat seinen eigenen Öffnungslauf auch nach Fehler im ersten');
    assertEqual(persistenceStarts, 1, 'Parallele Dokumentbeobachter starten den vorhandenen Persistenzadapter einmal');
    resetPersistenceForTests();
}

for (const href of ['Daten-Sicherung.html#fullBackupImportBtn', 'Handbuch.html#daten-sicherung', 'Balance.html']) {
    const f = fixture({ href, ready: async () => { throw new Error('Beschädigter Profilbestand'); } });
    await f.click().done;
    const recoveryTarget = href !== 'Balance.html';
    assertEqual(f.win.location.href, recoveryTarget ? href : 'index.html', 'Beschädigter Profilbestand: nur Sicherungs- und Handbuchziele freigegeben: ' + href);
    assert(!f.steps.includes('export'), 'Recoveryziel exportiert keinen beschädigten Profilbundle: ' + href);
    assertEqual(f.steps.includes('flush'), recoveryTarget, 'Recoveryverweis behält den geschützten Flush: ' + href);
}
