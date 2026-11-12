import fs from 'node:fs';
import { startAppTabLock, showAppTabDialog, APP_TAB_LOCK, APP_TAB_OWNER_KEY, APP_TAB_TEXTS } from '../app/shared/app-tab-lock.js';
import { PersistenceFacade as persistence } from '../app/shared/persistence-facade.js';
import { createPersistenceAreas } from '../app/shared/persistence-areas.js';
import { AREA_CONTROL_KEY } from '../app/shared/persistence-area-storage.js';
import { MemoryWebStorage } from './helpers/persistence-area-backends.mjs';
import { initializeProfilePage } from '../app/profile/profile-navigation.js';
import { documentDouble } from './helpers/page-dialog-dom.mjs';

// ES-1/ES-1c: Tabs desselben Ursprungs teilen einen Web-Lock-Verwalter, jeder Tab hat sein sessionStorage.
// Ein geschlossener Tab feuert pagehide; danach gibt er wie im Browser seine Sperren ab.
function createLockManager() {
    const held = new Map(), queues = new Map(), log = [];
    const abortError = () => Object.assign(new Error('synthetisch abgebrochen'), { name: 'AbortError' });
    const next = name => { if (!held.has(name)) queues.get(name)?.shift()?.grant(); };
    return {
        log, held,
        async query() {
            return { held: [...held.keys()].map(name => ({ name, mode: 'exclusive' })),
                pending: [...queues].flatMap(([name, queue]) => queue.map(() => ({ name, mode: 'exclusive' }))) };
        },
        request(name, options, callback) {
            if (options.steal) log.push(`steal:${name}`);
            log.push(`${options.ifAvailable ? 'try' : 'wait'}:${name}`);
            return new Promise((resolve, reject) => {
                if (options.signal?.aborted) { reject(abortError()); return; }
                const grant = () => {
                    const entry = {};
                    held.set(name, entry);
                    log.push(`grant:${name}`);
                    Promise.resolve().then(() => callback({ name, mode: 'exclusive' })).then(result => {
                        held.delete(name); log.push(`release:${name}`); resolve(result); next(name);
                    }, error => { held.delete(name); reject(error); next(name); });
                };
                const queue = queues.get(name) || queues.set(name, []).get(name);
                if (!held.has(name) && !queue.length) { grant(); return; }
                if (options.ifAvailable) { Promise.resolve().then(() => callback(null)).then(resolve, reject); return; }
                const abort = () => { if (queue.includes(waiter)) queue.splice(queue.indexOf(waiter), 1); reject(abortError()); };
                const waiter = { grant: () => { options.signal?.removeEventListener('abort', abort); grant(); } };
                options.signal?.addEventListener('abort', abort);
                queue.push(waiter);
            });
        }
    };
}

function createPage(locks, session, { tauri = false, waitMs = 40, realPersistence = false, localStorage } = {}) {
    const listeners = new Map(), dialogs = [], gates = [];
    const page = { dialogs, gates, reloads: 0, blocked: null };
    page.win = {
        navigator: locks ? { locks } : {}, sessionStorage: session, ...(localStorage ? { localStorage } : {}),
        ...(tauri ? { __TAURI_INTERNALS__: {} } : {}),
        addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
        fire(type, event = {}) { (listeners.get(type) || []).forEach(fn => fn(event)); }
    };
    page.doc = {};
    page.persistence = {
        holdWritesUntil: decision => { gates.push(decision); if (realPersistence) persistence.holdWritesUntil(decision); },
        blockDocumentWrites: message => { page.blocked = message; if (realPersistence) persistence.blockDocumentWrites(message); }
    };
    page.lock = startAppTabLock({ win: page.win, doc: page.doc, persistence: page.persistence, waitMs,
        showDialog: request => { dialogs.push(request); return new Promise(() => {}); }, reload: () => { page.reloads++; } });
    page.settled = () => Promise.all(gates);
    return page;
}

const ticks = async (count = 20) => { for (let i = 0; i < count; i++) await Promise.resolve(); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (condition, ms = 1000) => { const end = Date.now() + ms; while (!condition() && Date.now() < end) await sleep(5); };

// Erster Tab besitzt die App, ein zweiter Tab wird gesperrt und zeigt den Hinweis; er wartet nicht.
const locks = createLockManager();
const tabA = new MemoryWebStorage(), tabB = new MemoryWebStorage();
const a1 = createPage(locks, tabA);
await a1.settled();
assertEqual(a1.lock.state(), 'owner', 'ES-1 erster Tab erhält den Schreibbesitz');
assertEqual(a1.blocked, null, 'ES-1 erster Tab bleibt schreibfähig');
assertEqual(a1.dialogs.length, 0, 'ES-1 erster Tab zeigt keinen Hinweis');
assertEqual(tabA.getItem(APP_TAB_OWNER_KEY), '1', 'ES-1 Tabmerker liegt im sessionStorage des Besitzertabs');

const timers = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...args) => { timers.push(args[1]); return realSetTimeout(...args); };
locks.log.length = 0;
const b1 = createPage(locks, tabB, { waitMs: 300 });
await b1.settled();
await ticks();
globalThis.setTimeout = realSetTimeout;
assertEqual(b1.lock.state(), 'blocked', 'ES-1 zweiter Tab ist gesperrt');
assert(b1.blocked?.includes('anderen Tab'), 'ES-1 zweiter Tab sperrt alle Writes des Dokuments');
assertEqual(b1.dialogs.length, 1, 'ES-1 zweiter Tab zeigt genau einen Hinweis');
assertEqual(typeof b1.dialogs[0].reload, 'function', 'ES-1c Hinweis bekommt „Erneut versuchen“ = Neuladen');
assertEqual(tabB.getItem(APP_TAB_OWNER_KEY), null, 'ES-1 gesperrter Tab trägt keinen Besitzmerker');
assertEqual(a1.lock.state(), 'owner', 'ES-1 Start des zweiten Tabs ändert den ersten nicht');
assertEqual(locks.log.join(','), 'try:rs-app-tab', 'ES-1c zweiter Tab fragt die Sperre genau einmal an, ohne Warteschlange');
assertEqual((await locks.query()).pending.length, 0, 'ES-1c gesperrter Tab wartet nicht auf die Sperre');
assertEqual(timers.length, 0, 'ES-1c zweiter Tab setzt keine Timer');
await sleep(350);
assertEqual(b1.reloads, 0, 'ES-1c zweiter Tab lädt nie selbst neu');

// Seitenwechsel im ersten Tab, auch langsam (Folgeseite erst nach 3 s): Der Tab bleibt Besitzer, niemand kann dazwischen.
const switchStarted = Date.now();
a1.win.fire('pagehide', { persisted: false });
await sleep(20);
const a2 = createPage(locks, tabA, { waitMs: 2000 });
await a2.settled();
assertEqual(a2.lock.state(), 'owner', 'ES-1 Seitenwechsel im selben Tab gilt nicht als zweiter Start');
assert(Date.now() - switchStarted < 500, 'ES-1 Seitenwechsel hängt nicht bis zur Frist');
assertEqual(a2.dialogs.length + a2.reloads + (a2.blocked ? 1 : 0), 0, 'ES-1 Seitenwechsel ohne Hinweis, Neuladen oder Sperre');
assertEqual(a1.lock.state(), 'released', 'ES-1 verlassene Seite hält keine Sperre');
a2.win.fire('pagehide', { persisted: false });
{
    // Auch ein zweiter Tab, der mitten im Wechsel neu lädt, bekommt nur den Hinweis, nie eine spätere Übernahme.
    const slowWait = 3000;
    const slow = createPage(locks, tabA, { waitMs: slowWait });
    await slow.settled();
    assertEqual(slow.lock.state(), 'owner', 'ES-1c langsame Folgeseite (Lock frei) wird Besitzer ohne Hinweis');
    assertEqual(slow.dialogs.length + b1.dialogs.length, 1, 'ES-1c nur der zweite Tab zeigt den Hinweis');
    slow.win.fire('pagehide', { persisted: false });
}

// „Erneut versuchen“ nach Schließen des ersten Tabs: neu geladener Tab arbeitet.
b1.win.fire('pagehide', { persisted: false });
await ticks();
const b2 = createPage(locks, tabB);
await b2.settled();
assertEqual(b2.lock.state() + (b2.dialogs.length + (b2.blocked ? 1 : 0)), 'owner0', 'ES-1c nach dem Neuladen besitzt der Tab die App ohne Hinweis');

// Duplizierter Tab mit kopiertem Merker wartet nur bis zur Frist und wird dann gesperrt.
const copied = new MemoryWebStorage(); copied.setItem(APP_TAB_OWNER_KEY, '1');
const duplicate = createPage(locks, copied, { waitMs: 30 });
await duplicate.settled();
assertEqual(duplicate.lock.state(), 'blocked', 'ES-1 kopierter Merker überholt keinen lebenden Besitzer');
assertEqual(copied.getItem(APP_TAB_OWNER_KEY), null, 'ES-1 kopierter Merker wird verworfen');
assertEqual(b2.lock.state(), 'owner', 'ES-1 lebender Besitzer bleibt unberührt');
duplicate.win.fire('pagehide', { persisted: false });

// Verlassen während der Entscheidung: kein Hinweis, Merker bleibt für die nächste Seite im Tab.
const leaving = createPage(locks, tabB, { waitMs: 2000 });
leaving.win.fire('pagehide', { persisted: true });
await leaving.settled();
assertEqual(leaving.lock.state(), 'released', 'ES-1 verlassene Seite entscheidet nicht mehr');
assertEqual(leaving.dialogs.length + (leaving.blocked ? 1 : 0), 0, 'ES-1 verlassene Seite zeigt nichts und sperrt nichts');
assertEqual(tabB.getItem(APP_TAB_OWNER_KEY), '1', 'ES-1 Merker des Tabs bleibt erhalten');

// Fehlende Schnittstellen oder EXE: bisheriges Verhalten ohne Tor und ohne Sperre.
for (const [label, page] of [
    ['ohne Web Locks', createPage(null, new MemoryWebStorage())],
    ['ohne sessionStorage', createPage(createLockManager(), null)],
    ['in der EXE', createPage(createLockManager(), new MemoryWebStorage(), { tauri: true })]
]) {
    assertEqual(page.lock, null, `ES-1 ${label}: keine Tabsperre`);
    assertEqual(page.gates.length + page.dialogs.length + (page.blocked ? 1 : 0), 0, `ES-1 ${label}: bisheriges Verhalten`);
}

// Codex-Gegenprobe (ES-1b): Spielbereich in Vorbereitung; ein zweiter Tab startet mit echter Persistenz und schreibt nichts.
{
    class CountingStorage extends MemoryWebStorage {
        writes = 0;
        setItem(key, value) { this.writes++; super.setItem(key, value); }
        removeItem(key) { this.writes++; super.removeItem(key); }
    }
    const local = new CountingStorage();
    const bytes = () => JSON.stringify([...local.records].sort());
    const setup = { window: { localStorage: local, sessionStorage: new MemoryWebStorage() }, localStorage: local, installLifecycleHooks: false };
    const areas = createPersistenceAreas(setup);
    const real = areas.makeAdapter('echt'), play = areas.makeAdapter('spiel');
    await real.open(); await real.saveBatch({ upserts: [['profile_tagesgeld', '1000.00']], deletes: [] });
    await play.open(); await play.saveBatch({ upserts: [['profile_tagesgeld', 'Spielstand synthetisch']], deletes: [] });
    local.setItem(AREA_CONTROL_KEY, JSON.stringify({ version: 1, activeArea: 'spiel', source: 'copy', startedAt: '2026-11-09T12:00:00.000Z', id: 'synthetisch', phase: 'preparing' }));
    const before = bytes();
    local.writes = 0;
    try {
        persistence.resetPersistenceRuntimeForTests();
        const shared = createLockManager();
        const owner = createPage(shared, new MemoryWebStorage());
        await owner.settled();
        const second = createPage(shared, new MemoryWebStorage(), { realPersistence: true, localStorage: local, waitMs: 30 });
        // Wie initializeProfilePage: Tabsperre vor init().
        let started = false;
        void persistence.init({ ...setup, window: second.win }).then(() => { started = true; });
        await sleep(60);
        assertEqual(second.lock.state(), 'blocked', 'ES-1b zweiter Tab mit echter Persistenz gesperrt');
        assertEqual(started, false, 'ES-1b gesperrter Tab beendet init() nicht');
        assertEqual(local.writes, 0, 'ES-1b gesperrter Tab ruft setItem/removeItem beim Start nie auf');
        assertEqual(bytes(), before, 'ES-1b Spielbereich in Vorbereitung samt Spielrecord bleibt bytegleich');
        assertEqual(persistence.getPersistenceStatus().areaWarning, null, 'ES-1b gesperrter Tab meldet keinen verworfenen Spielbereich');
        // Ein Write vor dem nie endenden init() scheitert sofort und hält keine gemeinsame Sperre (kein hängender Seitenwechsel).
        let writeError;
        try { await persistence.writeSnapshot({ id: 'synthetisch' }, { guard: null }); } catch (error) { writeError = error; }
        assertEqual(writeError?.code, 'PERSISTENCE_RELOAD_REQUIRED', 'ES-1b Write im gesperrten Tab scheitert sofort');
        assertEqual(shared.held.has('rs-probelauf-operation'), false, 'ES-1b gesperrter Tab nimmt die gemeinsame Schreibsperre nicht');

        // Der erste Tab schließt: Der zweite lädt nicht von selbst, erst „Erneut versuchen“ lädt neu; danach arbeitet er normal.
        owner.win.fire('pagehide', { persisted: false });
        await sleep(100);
        assertEqual(second.reloads, 0, 'ES-1c zweiter Tab lädt nach dem Schließen des ersten nicht selbst neu');
        second.dialogs[0].reload();
        assertEqual(second.reloads, 1, 'ES-1c „Erneut versuchen“ lädt den zweiten Tab neu');
        second.win.fire('pagehide', { persisted: false });
        persistence.resetPersistenceRuntimeForTests();
        const restarted = createPage(shared, second.win.sessionStorage, { realPersistence: true, localStorage: local });
        assertEqual(await persistence.init({ ...setup, window: restarted.win }), true, 'ES-1b neu geladener Tab startet die Persistenz');
        assertEqual(restarted.lock.state(), 'owner', 'ES-1b neu geladener Tab besitzt die App');
        persistence.setItemSync('profile_tagesgeld', '2000.00');
        assertEqual(await persistence.flush(), true, 'ES-1b neu geladener Tab speichert');
    } finally { persistence.resetPersistenceForTests(); }
}

// ES-1d: Das Handbuch nimmt an der Sperre teil wie jede Seite. Im zweiten Tab ist es gesperrt und schreibt nichts:
// Spielbereich in Vorbereitung samt Spielrecord bleibt bytegleich, auch mit beschädigtem Verzeichnis, auch nach Schreibversuchen.
{
    class CountingStorage extends MemoryWebStorage {
        writes = 0;
        setItem(key, value) { this.writes++; super.setItem(key, value); }
        removeItem(key) { this.writes++; super.removeItem(key); }
        clear() { this.writes++; super.clear(); }
    }
    const local = new CountingStorage();
    const bytes = () => JSON.stringify([...local.records].sort());
    const setup = { window: { localStorage: local, sessionStorage: new MemoryWebStorage() }, localStorage: local, installLifecycleHooks: false };
    const areas = createPersistenceAreas(setup);
    const real = areas.makeAdapter('echt'), play = areas.makeAdapter('spiel');
    await real.open(); await real.saveBatch({ upserts: [['profile_tagesgeld', '1000.00']], deletes: [] });
    await play.open(); await play.saveBatch({ upserts: [['profile_tagesgeld', 'Spielstand synthetisch']], deletes: [] });
    for (const damaged of [false, true]) {
        local.setItem(AREA_CONTROL_KEY, JSON.stringify({ version: 1, activeArea: 'spiel', source: 'copy', startedAt: '2026-11-09T12:00:00.000Z', id: 'synthetisch', phase: 'preparing' }));
        if (damaged) local.setItem('rs_households_v1', '{kaputt');
        const before = bytes();
        local.writes = 0;
        try {
            persistence.resetPersistenceRuntimeForTests();
            const shared = createLockManager();
            const owner = createPage(shared, new MemoryWebStorage());
            await owner.settled();
            const doc = { documentElement: { dataset: { suitePage: 'handbook' } }, contains: () => false, addEventListener() {}, getElementById: () => null };
            const win = { ...setup.window, navigator: { locks: shared }, document: doc, addEventListener() {}, location: { reload() {} } };
            const ready = await Promise.race([initializeProfilePage({ doc, win }), sleep(300).then(() => 'wartet')]);
            assert(ready !== true, `ES-1d Handbuch im zweiten Tab startet nicht${damaged ? ' (Verzeichnis beschädigt)' : ''}`);
            try { persistence.setItemSync('profile_tagesgeld', '18000.00'); } catch { /* gesperrt */ }
            await persistence.flush().catch(() => {});
            assertEqual(local.writes, 0, 'ES-1d Handbuch im zweiten Tab ruft setItem/removeItem/clear nie auf');
            assertEqual(bytes(), before, 'ES-1d Spielbereich in Vorbereitung samt Spielrecord bleibt im Handbuch bytegleich');
            assertEqual(shared.log.filter(entry => /^(try|wait):/.test(entry)).join(','), 'try:rs-app-tab,try:rs-app-tab', 'ES-1d auch das Handbuch fragt die Sperre an');
        } finally { persistence.resetPersistenceForTests(); }
    }
}

// ES-1d: Handbuch im selben Tab nach einer App-Seite (Seitenwechsel): Besitz bleibt, kein Hinweis.
{
    persistence.resetPersistenceForTests();
    const shared = createLockManager(), tab = new MemoryWebStorage(), local = new MemoryWebStorage();
    try {
        const app = createPage(shared, tab);
        await app.settled();
        app.win.fire('pagehide', { persisted: false });
        const doc = { documentElement: { dataset: { suitePage: 'handbook' } }, contains: () => false, addEventListener() {}, getElementById: () => null };
        const win = { localStorage: local, sessionStorage: tab, navigator: { locks: shared }, document: doc, addEventListener() {}, location: { reload() {} } };
        const ready = await initializeProfilePage({ doc, win });
        assertEqual(ready, true, 'ES-1d Handbuch im selben Tab nach einer App-Seite startet ohne Hinweis');
    } finally { persistence.resetPersistenceForTests(); }
}

// Laufende Speicherung im ersten Tab: Ein zweiter Tab kann sie nicht unterbrechen; Write und Rücknahme laufen zu Ende.
{
    const records = { sim_old: 'bisheriger Stand' };
    let saves = 0, finishFirst;
    const firstWrite = new Promise(resolve => { finishFirst = resolve; });
    const adapter = { name: 'es1b-delayed', async loadAll() { return { ...records }; },
        async saveBatch({ upserts, deletes }) {
            if (++saves === 1) await firstWrite;
            deletes.forEach(key => delete records[key]); Object.assign(records, Object.fromEntries(upserts));
        } };
    try {
        persistence.resetPersistenceForTests(adapter);
        const shared = createLockManager();
        const owner = createPage(shared, new MemoryWebStorage(), { realPersistence: true });
        await owner.settled();
        await persistence.init({ installLifecycleHooks: false, debounceMs: 60000 });
        const restore = persistence.replaceRecordsTransactional({ sim_new: 'Importziel' }, { postValidate: () => false }).then(() => null, error => error);
        await until(() => saves > 0);
        const second = createPage(shared, new MemoryWebStorage());
        await second.settled();
        assertEqual(second.lock.state(), 'blocked', 'ES-1b zweiter Tab während der Speicherung gesperrt');
        finishFirst();
        const error = await restore;
        assertEqual(error?.code, 'restore_rolled_back', 'ES-1b Rücknahme des ersten Tabs läuft zu Ende');
        assertEqual(saves, 2, 'ES-1b Write und Rücknahme erreichen den Speicher');
        assertEqual(JSON.stringify(records), JSON.stringify({ sim_old: 'bisheriger Stand' }), 'ES-1b bisheriger Bestand wiederhergestellt');
        assertEqual(owner.lock.state() + (owner.blocked ? 'gesperrt' : ''), 'owner', 'ES-1b erster Tab bleibt Besitzer und schreibfähig');
        assertEqual(second.reloads, 0, 'ES-1b zweiter Tab bleibt gesperrt');
        assert(!shared.log.some(entry => entry.startsWith('steal:')), 'ES-1b keine Übernahme per steal');
    } finally { persistence.resetPersistenceForTests(); }
}

// Hinweisdialog: vorhandener Seitendialog ohne Knopf, nicht wegklickbar.
{
    const env = documentDouble();
    let retried = 0;
    void showAppTabDialog({ doc: env.doc, reload: () => { retried++; } });
    const dialog = env.dialog();
    const walk = node => [node, ...node.children.flatMap(walk)];
    assert(dialog?.open, 'ES-1 Hinweis erscheint als Seitendialog');
    assert(walk(dialog).some(node => node.textContent === APP_TAB_TEXTS.title), 'ES-1 Hinweis nennt den anderen Tab');
    assert(walk(dialog).some(node => node.textContent?.includes('Schließe den anderen Tab')), 'ES-1b Hinweis sagt, was zu tun ist');
    dialog.fire('keydown', { key: 'Escape' });
    dialog.close();
    assert(dialog.open, 'ES-1 Hinweis lässt sich nicht wegklicken');
    assertEqual(env.controls().length, 1, 'ES-1c genau ein Knopf');
    assertEqual(env.controls()[0].textContent, 'Erneut versuchen', 'ES-1c Knopf „Erneut versuchen“');
    env.controls()[0].fire('click');
    assertEqual(retried, 1, 'ES-1c „Erneut versuchen“ lädt die Seite neu');
}
assert(!/steal|Hier weiterarbeiten/.test(fs.readFileSync(new URL('../app/shared/app-tab-lock.js', import.meta.url), 'utf8')), 'ES-1b Quelle ohne Übernahme');

// EXE: Startsperre nur mit der Standardbibliothek, vor dem Tauri-Aufbau und je Kennung.
{
    const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const lib = read('src-tauri/src/lib.rs'), single = read('src-tauri/src/single_instance.rs');
    const cargo = read('src-tauri/Cargo.toml'), lock = read('src-tauri/Cargo.lock');
    assert(lib.includes('mod single_instance;'), 'ES-1 Rustmodul eingebunden');
    const run = lib.slice(lib.indexOf('pub fn run()'));
    assert(run.indexOf('single_instance::acquire') > 0 && run.indexOf('single_instance::acquire') < run.indexOf('tauri::Builder::default()'),
        'ES-1 Startsperre vor dem Aufbau des Fensters');
    assert(/InstanceStart::Second => return/.test(run), 'ES-1 zweiter Start endet ohne eigenes Fenster');
    assert(run.includes('context.config().identifier') && run.includes('.run(context)'), 'ES-1 Sperre je Kennung aus derselben Konfiguration');
    assert(/lock\.serve\(move \|\| single_instance::bring_to_front/.test(run), 'ES-1 erste Instanz holt ihr Fenster nach vorn');
    const imports = [...single.matchAll(/^use ([\w:]+)/gm)].map(match => match[1]);
    assert(imports.length > 0 && imports.every(path => path.startsWith('std::')), 'ES-1 Rustmodul nutzt nur die Standardbibliothek');
    assert(!/single.instance/i.test(cargo) && !/single-instance/i.test(lock), 'ES-1 keine zusätzliche Abhängigkeit beim Bau');
    for (const name of ['instance_lock_path_is_one_file_per_identifier', 'instance_wake_address_accepts_only_port_and_hex_token',
        'instance_wake_needs_the_matching_token', 'instance_second_start_wakes_the_first_and_does_not_start',
        'instance_released_lock_allows_the_next_start']) {
        assert(single.includes(`fn ${name}(`), `ES-1 Rusttest ${name} vorhanden`);
    }
}
