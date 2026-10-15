import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { bindFullBackupButton, bindFullBackupImport } from '../app/shared/persistence-backup.js';
import { initializeProfilePage, whenProfilePageReady } from '../app/profile/profile-navigation.js';
import { isProfileScopedKey } from '../app/profile/profile-key-policy.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { createProbelaufController, getProbelaufController, PROBELAUF_STATE_KEY as KEY } from '../app/shared/probelauf-state.js';
import { initOverview } from '../app/overview/overview-main.js';
import { bindProbelaufUI, renderProbelaufUI } from '../app/shared/probelauf-ui.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { initBalancePlanTrial, getBalancePlanTrial } from '../app/balance/balance-plan-trial.js';
import { initSimulatorPlanTrial, getSimulatorPlanTrial } from '../app/simulator/simulator-plan-trial.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
async function bounded(job) {
    let timer;
    try {
        return await Promise.race([job, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Seitenstart ohne bestätigten Abschluss')), 1000);
        })]);
    } finally { clearTimeout(timer); }
}
function events(target = {}) {
    const listeners = new Map();
    return Object.assign(target, {
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        fire(type, fields = {}) {
            const event = { target: this, currentTarget: this, preventDefault() {}, stopImmediatePropagation() {}, ...fields };
            return Promise.all([...listeners.get(type) || []].map(fn => fn(event)));
        }
    });
}
function dom() {
    const choiceOpened = deferred();
    const doc = events({ activeElement: null, documentElement: { dataset: { suitePage: 'tranches' } } });
    const nodes = [];
    doc.createElement = tag => {
        const node = events({ tag, children: [], dataset: {}, attributes: {}, value: '', textContent: '', isConnected: true,
            setAttribute(key, value) { this.attributes[key] = value; },
            append(...children) { children.forEach(child => this.appendChild(child)); },
            appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
            insertBefore(child, before) { child.remove(); child.isConnected = this.isConnected; child.parentNode = this; const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); return child; },
            replaceChildren(...children) { this.children.forEach(child => child.remove()); this.append(...children); },
            remove() {
                this.isConnected = false;
                if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
            },
            contains(child) { return this === child || this.children.some(node => node.contains(child)); },
            closest() { return null; },
            focus() { doc.activeElement = this; },
            showModal() { this.open = true; if (this.id === 'pageChoiceDialog') choiceOpened.resolve(this); },
            close() { this.open = false; void this.fire('close'); }
        });
        nodes.push(node); return node;
    };
    doc.body = doc.createElement('body');
    for (const id of ['suiteNavigationStatus', 'probelaufStatus', 'navigationGuardDialog', 'navigationGuardTitle',
        'navigationGuardDescription', 'navigationGuardStay', 'navigationGuardLeave']) {
        const node = doc.createElement('div'); node.id = id; doc.body.appendChild(node);
    }
    doc.getElementById = id => nodes.find(node => node.isConnected && node.id === id) || null;
    doc.querySelectorAll = () => [];
    doc.querySelector = () => null;
    doc.contains = node => doc.body.contains(node);
    return { doc, nodes, choiceOpened };
}
// FIFO-Web-Locks mit echtem Warten. Nur das finally darf die Warteschlange
// zur Bereinigung eines nachgewiesenen Hängers ohne Exklusivität entleeren.
function webLocks() {
    let cleanup = false;
    const held = new Set(), queues = new Map(), trace = [];
    const pump = name => {
        const queue = queues.get(name);
        if (held.has(name) || !queue?.length) return;
        const job = queue.shift(); held.add(name);
        trace.push(`lock:entered:${name}`); job.resolve({ name });
    };
    return {
        query: async () => ({ held: [...held].map(name => ({ name, clientId: 'local' })) }),
        trace, get waiting() { return [...queues.values()].reduce((count, queue) => count + queue.length, 0); },
        async request(name, options, run) {
            if (cleanup) return run({ name });
            if (held.has(name) && options.ifAvailable) return run(null);
            if (!queues.has(name)) queues.set(name, []);
            const turn = deferred(); queues.get(name).push({ name, resolve: turn.resolve }); pump(name);
            await turn.promise;
            try { return await run({ name }); }
            finally { held.delete(name); trace.push(`lock:released:${name}`); pump(name); }
        },
        drainForCleanup() {
            cleanup = true;
            for (const queue of queues.values()) queue.splice(0).forEach(job => job.resolve({ name: job.name }));
        }
    };
}

async function migrationLifecycle() {
const previous = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const oldDate = getAppTestDate();
const f = dom(), locks = webLocks(), readEntered = deferred(), releaseRead = deferred();
const data = { profile_aktuelles_alter: '67', profile_rente_monatlich: '0', profile_rente_aktiv: 'false',
    sim_p1Monatsrente: '1234', sim_p1StartInJahren: '1' };
const durable = { rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
    a: { meta: { id: 'a', name: 'Synthetische Person A', belongsToHousehold: true }, data }
} }), rs_current_profile: 'a', rs_active_profile: 'a', ...data };
const points = new Map(), trace = [];
const win = events({ document: f.doc, navigator: { locks }, location: { href: 'http://localhost/depot-tranchen-manager.html' } });
f.doc.defaultView = win;
const guard = getPageNavigationGuard(f.doc, win);
let heldRead = false, job, parallel, ready, confirmed = false, cleanupCompleted = false, failure = null;
const adapter = {
    name: 'Kontrollierter Seitenstart-Speicher',
    async loadAll() {
        if (!heldRead && guard.reasons().some(reason => reason.phase === 'commit')) {
            heldRead = true; trace.push('commit:protection-read'); readEntered.resolve(); await releaseRead.promise;
        }
        return { ...durable };
    },
    async saveBatch({ deletes, upserts }) {
        trace.push('write:' + (upserts.some(([key]) => key === 'profile_person_schema_version') ? 'person' : 'other'));
        deletes.forEach(key => delete durable[key]); upserts.forEach(([key, value]) => durable[key] = value);
    },
    async listSnapshots() { return [...points.values()]; },
    async writeSnapshot(point) { points.set(point.id, structuredClone(point)); },
    async readSnapshot(id) { return structuredClone(points.get(id)); }
};
try {
    globalThis.window = win; globalThis.document = f.doc;
    P.resetPersistenceForTests(adapter); setAppTestDate(null);
    job = initializeProfilePage({ doc: f.doc, win, kind: 'tranches' });
    parallel = initializeProfilePage({ doc: f.doc, win, kind: 'tranches' });
    ready = whenProfilePageReady(f.doc).catch(error => error);
    assertEqual(parallel, job, 'Rahmen- und Fachstarter teilen dieselbe echte Initialisierung');
    await bounded(Promise.race([f.choiceOpened.promise, job.then(() => { throw new Error('Quellwahldialog nicht erreicht'); })]));
    assert(f.nodes.some(node => node.type === 'radio' && node.checked && node.dataset.pageChoiceField === 'a:renteMonatlich'
        && node.parentNode.children.some(child => child.textContent.includes('1.234'))), 'Echter Dialog wählt die künftige Simulatorrente');
    await f.nodes.find(node => Object.hasOwn(node.dataset, 'pageChoiceAccept')).fire('click');
    await bounded(Promise.race([readEntered.promise, job.then(() => { throw new Error('Commit-Schutzread nicht erreicht'); })]));
    assert(!win.__rsProfileSubpageLifecycleInitialized, 'Vor Bestätigung bleibt der Unterseitenstart unvollständig');
    assertEqual(durable.profile_person_schema_version, undefined, 'Vor Bestätigung liegt keine neue Schemaversion im Backend');
    // Der Facade-Lifecycle startet seinen Flush während des zurückgehaltenen
    // Schutzreads unter der exklusiven Replace-Lease (persistentWriteDepth=0).
    await win.fire('pagehide', { persisted: false });
    for (let turn = 0; turn < 20 && locks.waiting === 0; turn++) await Promise.resolve();
    assertEqual(locks.waiting, 1, 'Lifecycleflush wartet am bereits gehaltenen Web-Lock');
    releaseRead.resolve();
    try {
        confirmed = await bounded(job);
        if (confirmed) {
            assertEqual(await ready, true, 'Profilbereitschaft folgt dem bestätigten Commit');
            assertEqual(durable.profile_rente_monatlich, '1234', 'Gewählte künftige Rente dauerhaft bestätigt');
            assertEqual(durable.profile_person_schema_version, '1', 'Personenschema dauerhaft bestätigt');
            assertEqual(win.__rsProfileSubpageLifecycleInitialized, true, 'Unterseite erreicht ihren Lifecycleflag');
        }
    } catch (error) { failure = error; }
    console.log('Seitenstart-Ereignisfolge:', JSON.stringify({ trace, locks: locks.trace, waiting: locks.waiting,
        lifecycle: Boolean(win.__rsProfileSubpageLifecycleInitialized), schema: durable.profile_person_schema_version ?? null,
        error: failure?.message || null }));
} finally {
    releaseRead.resolve(); locks.drainForCleanup();
    if (job) cleanupCompleted = await bounded(job).catch(() => false);
    if (parallel) await bounded(parallel).catch(() => {});
    if (ready) await bounded(ready).catch(() => {});
    await P.flush().catch(() => {});
    guard.revokeNative(); P.resetPersistenceForTests(); setAppTestDate(oldDate);
    for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
}
assertEqual(cleanupCompleted, true, 'Nach Auflösen der Lockwarteschlange im Cleanup endet derselbe echte Start erfolgreich');
assertEqual(durable.profile_rente_monatlich, '1234', 'Cleanup-Gegenprobe bestätigt die tatsächlich gewählte Quelle');
assertEqual(durable.profile_person_schema_version, '1', 'Cleanup-Gegenprobe bestätigt den funktionierenden Transaktionspfad');
assert(confirmed, 'Befunde 6/9: echter paralleler Seitenstart bestätigt die Quellwahl trotz konkurrierendem Lifecycleflush ohne Hänger');

}

function page(kind = 'index', href = 'http://localhost/index.html') {
    const f = dom(); f.doc.documentElement.dataset.suitePage = kind;
    const locks = webLocks();
    const win = events({ document: f.doc, navigator: { locks }, location: { href, reload() {} } });
    f.doc.defaultView = win;
    for (const id of ['probelaufBand', 'probelaufBandText', 'probelaufControls', 'probelaufStart', 'probelaufEnd',
        'fullBackupBtn', 'fullBackupImportBtn', 'fullBackupImportFile', 'fullBackupStatus', 'daten-sicherung']) {
        const node = f.doc.createElement('div'); node.id = id; f.doc.body.appendChild(node);
    }
    for (const action of ['day', 'month', 'date', 'end']) {
        const node = f.doc.createElement('button'); node.dataset.probelaufAction = action;
        node.closest = selector => selector === '[data-probelauf-action]' ? node : null;
        f.doc.getElementById('probelaufBand').appendChild(node);
    }
    f.doc.querySelectorAll = selector => selector === '[data-probelauf-action]'
        ? f.nodes.filter(node => node.isConnected && node.dataset.probelaufAction) : [];
    return { ...f, win, locks, guard: getPageNavigationGuard(f.doc, win) };
}

async function inPlayPage(f, store, run) {
    const previous = { window: globalThis.window, document: globalThis.document };
    f.win.__TAURI__ = store.win.__TAURI__;
    f.win.localStorage = store.local; f.win.sessionStorage = store.session;
    try {
        globalThis.window = f.win; globalThis.document = f.doc;
        P.resetPersistenceRuntimeForTests();
        await P.init({ ...store.options, window: f.win });
        return await run();
    } finally {
        f.locks.drainForCleanup(); f.guard.revokeNative();
        P.resetPersistenceForTests(); setAppTestDate(null);
        for (const key of ['window', 'document']) {
            if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key];
        }
    }
}
// Der bestehende Rundgang startet dieselben produktiven Seiten im getrennten Bereich.
{
    const store = await playFixture('tauri', createMusterHaushaltRecords('2026-12-15'));
    let c = await store.boot(); const before = store.realBytes();
    await c.start(() => ({ source: 'demo', testDate: '2026-12-15' }));
    for (const [kind, path] of [['index', 'index.html'], ['balance', 'Balance.html'], ['simulator', 'Simulator.html'], ['tranches', 'depot-tranchen-manager.html'], ['handbook', 'Handbuch.html'], ['data', 'Daten-Sicherung.html']]) {
        const f = page(kind, 'http://localhost/' + path);
        await inPlayPage(f, store, async () => {
            assertEqual(await bounded(initializeProfilePage({ doc: f.doc, win: f.win, kind })), true, path + ': gemeinsamer Seitenstart');
            c = getProbelaufController(f.doc);
            assertEqual(c.state.version, 2, path + ': getrennter Spielbereich');
            assertEqual(getAppTestDate(), '2026-12-15', path + ': Fachuhr nach Neustart');
            assert(!f.doc.getElementById('probelaufBand').hidden, path + ': Band sichtbar');
            assert(f.doc.getElementById('probelaufBandText').textContent.includes('Beispieldaten'), path + ': Muster klar gekennzeichnet');
            assert(store.realBytes() === before, path + ': Seitenstart lässt echte Dateien bytegleich');
            if (kind === 'data') {
                let target;
                f.win.location.replace = path => { target = path; };
                assertEqual((await c.end(() => true)).status, 'reloaded', 'Beenden aus beliebiger Seite');
                assertEqual(target, 'index.html', 'Beenden führt auf die Startseite');
                assert(store.realBytes() === before, 'Beenden aus dem Seitenrahmen erhält echte Bytes');
            }
        });
    }
}
// Echte Seitenadapter lesen bei jeder Guard-Abfrage den gemeinsamen Plan.
// Genau diese Bindung fehlte bisher im Seitenrundgang und reproduziert SB-3c.
for (const backend of ['tauri', 'indexeddb', 'localstorage']) {
    for (const [kind, path, bindTrial] of [
        ['balance', 'Balance.html', initBalancePlanTrial],
        ['simulator', 'Simulator.html', initSimulatorPlanTrial],
        ['expenses', 'Ausgaben.html'], ['handbook', 'Handbuch.html'],
        ['index', 'index.html'], ['tranches', 'depot-tranchen-manager.html'], ['data', 'Daten-Sicherung.html']
    ]) {
        const store = await playFixture(backend, createMusterHaushaltRecords('2026-12-15'));
        for (const action of ['start', 'date', 'end']) {
            const f = page(kind, 'http://localhost/' + path);
            let target = null, reloads = 0;
            f.win.location.reload = () => { reloads++; target = path; };
            f.win.location.replace = value => { reloads++; target = value; };
            await inPlayPage(f, store, async () => {
                assertEqual(await initializeProfilePage({ doc: f.doc, win: f.win, kind }), true, `${backend}/${path}/${action}: Seitenstart`);
                bindTrial?.({ doc: f.doc });
                const c = getProbelaufController(f.doc);
                await P.flush(); // Den regulären Profilbootstrap vor der Aktion abschließen.
                const before = store.realBytes();
                if (bindTrial) {
                    const trial = kind === 'balance' ? getBalancePlanTrial(f.doc) : getSimulatorPlanTrial(f.doc);
                    trial.start(); trial.update({ flexBedarf: trial.values().flexBedarf + 100 });
                    assert(trial.read().differences.length > 0, `${backend}/${path}/${action}: offener Seitenversuch`);
                    const dialog = f.doc.getElementById('navigationGuardDialog');
                    const show = dialog.showModal;
                    dialog.showModal = () => {
                        show.call(dialog);
                        queueMicrotask(() => { void f.doc.getElementById('navigationGuardLeave').fire('click'); });
                    };
                }
                let lateReads = 0;
                f.guard.register('late-page-read', { read: () => {
                    if (c.blocked || P.getPersistenceStatus().reloadRequired) lateReads++;
                    P.getItemSync('rs_profiles_v1');
                    return {};
                } });
                const result = await bounded(action === 'start' ? c.start(() => ({ source: 'copy', testDate: null }))
                    : action === 'date' ? c.changeDate('2027-01-02') : c.end(() => true));
                assertEqual(result.status, 'reloaded', `${backend}/${path}/${action}: Navigation bestätigt`);
                assertEqual(reloads, 1, `${backend}/${path}/${action}: genau eine Navigation`);
                assertEqual(target, action === 'end' ? 'index.html' : path, `${backend}/${path}/${action}: richtiges Ziel`);
                assertEqual(lateReads, 0, `${backend}/${path}/${action}: keine Seitenleser nach Wechsel`);
                assert(store.realBytes() === before, `${backend}/${path}/${action}: echte Records, Sitzungen und Sicherungspunkte bytegleich`);
                let prevented = false;
                f.guard.beforeUnload({ preventDefault() { prevented = true; } });
                assert(!prevented, `${backend}/${path}/${action}: nativer Schutz lässt den Wechsel durch`);
                assertEqual(await f.guard.prepare(), null, `${backend}/${path}/${action}: alte Seite bleibt beendet`);
            });
        }
    }
}
// Ein abgebrochener Datumswechsel sperrt nur Spielwerte; Beenden bleibt bedienbar.
{
    const store = await playFixture('tauri', createMusterHaushaltRecords('2026-12-15'));
    let c = await store.boot(); await c.start(() => ({ source: 'demo', testDate: '2026-12-15' }));
    const original = store.options.invoke; let saves = 0;
    store.options.invoke = async (command, args) => {
        if (command === 'save_app_state' && args.target === 'spiel' && ++saves === 2) throw new Error('Datumsschreiben unterbrochen');
        return original(command, args);
    };
    c = await store.boot();
    await c.changeDate('2027-01-02').catch(() => {});
    store.options.invoke = original;
    const f = page();
    await inPlayPage(f, store, async () => {
        assertEqual(await initializeProfilePage({ doc: f.doc, win: f.win }), false, 'Halber Datumssprung sperrt Fachdatenstart');
        const c = getProbelaufController(f.doc);
        assert(c.blocked, 'Recovery bleibt gesperrt');
        const buttons = f.nodes.filter(node => node.dataset.probelaufAction);
        assert(buttons.filter(node => node.dataset.probelaufAction !== 'end').every(node => node.disabled), 'Datumsknöpfe gesperrt');
        assert(!buttons.find(node => node.dataset.probelaufAction === 'end').disabled, 'Beenden jederzeit möglich');
        const { assertFullBackupAllowed } = await import('../app/shared/persistence-backup.js');
        let blocked = false; try { await assertFullBackupAllowed({ probelaufController: c }); } catch { blocked = true; }
        assert(blocked, 'Sicherung auch während Spielrecovery gesperrt');
        f.win.location.replace = () => {};
        assertEqual((await c.end(() => true)).status, 'reloaded', 'Recovery verwirft ausschließlich den Spielbereich');
    });
}
// Konkurrierende fachliche Writes enden vor dem Datumssprung, mit und ohne Web Locks.
for (const useLocks of [false, true]) {
    const store = await playFixture('tauri', createMusterHaushaltRecords('2026-12-15'));
    let c = await store.boot(); await c.start(() => ({ source: 'demo', testDate: '2026-12-15' }));
    const f = page(); if (!useLocks) delete f.win.navigator.locks;
    const original = store.options.invoke, entered = deferred(), gate = deferred(); let hold = false;
    store.options.invoke = async (command, args) => {
        if (hold && command === 'save_app_state' && args.target === 'spiel') { hold = false; entered.resolve(); await gate.promise; }
        return original(command, args);
    };
    await inPlayPage(f, store, async () => {
        await initializeProfilePage({ doc: f.doc, win: f.win });
        c = getProbelaufController(f.doc);
        P.setItemSync('profile_tagesgeld', '90123'); hold = true;
        const writer = P.flush(); await bounded(entered.promise);
        const change = c.changeDate('2027-01-02');
        await Promise.resolve(); assert(c.waiting, 'Datumssprung wartet auf fremden Commit');
        gate.resolve(); await bounded(writer); await bounded(change);
        assertEqual(c.state.testDate, '2027-01-02', 'Einmalige Fortsetzung nach Commit');
        assertEqual(store.values.profile_tagesgeld, '90123', 'Vorheriger Fachwrite bleibt bestätigt');
    });
}

await migrationLifecycle();
