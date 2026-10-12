import { bindFullBackupButton, bindFullBackupImport } from '../app/shared/persistence-backup.js';
import { initializeProfilePage, whenProfilePageReady } from '../app/profile/profile-navigation.js';
import { isProfileScopedKey } from '../app/profile/profile-key-policy.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { createProbelaufController, getProbelaufController, PROBELAUF_STATE_KEY as KEY } from '../app/shared/probelauf-state.js';
import { initOverview } from '../app/overview/overview-main.js';
import { bindProbelaufUI, renderProbelaufUI } from '../app/shared/probelauf-ui.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
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

function backend(records = createMusterHaushaltRecords('2027-07-01')) {
    const durable = { ...records }, points = new Map(), trace = [];
    return { name: 'Getrennter dauerhafter Testbestand', durable, points, trace,
        async loadAll() { trace.push('read'); return { ...durable }; },
        async saveBatch({ deletes = [], upserts = [] }) {
            trace.push(upserts.some(([key]) => key === KEY) ? 'state:' + JSON.parse(upserts.find(([key]) => key === KEY)[1]).phase : 'write');
            deletes.forEach(key => delete durable[key]); upserts.forEach(([key, value]) => durable[key] = value);
        },
        async listSnapshots() { return [...points.values()]; },
        async writeSnapshot(point) { points.set(point.id, structuredClone(point)); },
        async readSnapshot(id) { return structuredClone(points.get(id)); },
        async deleteSnapshot(id) { points.delete(id); }
    };
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
async function inPage(f, adapter, execute) {
    const saved = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const date = getAppTestDate();
    try {
        globalThis.window = f.win; globalThis.document = f.doc;
        P.resetPersistenceForTests(adapter); setAppTestDate(null);
        return await execute();
    } finally {
        f.locks.drainForCleanup(); f.guard.revokeNative();
        await bounded(P.flush()).catch(() => {});
        P.resetPersistenceForTests(); setAppTestDate(date);
        for (const [key, descriptor] of Object.entries(saved)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
        }
    }
}
function linkFor(f, href) {
    const link = f.doc.createElement('a');
    link.dataset = {}; link.getAttribute = key => key === 'href' ? href : null;
    link.hasAttribute = key => key === 'href'; link.closest = () => link;
    f.doc.body.appendChild(link); return link;
}
async function navigationDuringStart() {
    for (const accept of [false, true]) {
        const f = page('balance', 'http://localhost/Balance.html'), adapter = backend(), gate = deferred();
        adapter.open = () => gate.promise;
        await inPage(f, adapter, async () => {
            const start = initializeProfilePage({ doc: f.doc, win: f.win });
            const ready = whenProfilePageReady(f.doc).catch(error => error);
            const reason = f.guard.register('idle-result', { read: () => ({ phase: 'idle', result: true, revision: 1 }) });
            const link = linkFor(f, 'Simulator.html');
            const click = f.doc.fire('click', { target: link });
            try {
                assert(f.doc.getElementById('navigationGuardDialog').open, 'Befund 5: Rückfrage öffnet trotz ausstehender Start-I/O für idle/result');
                await f.doc.getElementById(accept ? 'navigationGuardLeave' : 'navigationGuardStay').fire('click');
                if (!accept) {
                    await bounded(click);
                    assertEqual(f.guard.isBusy(), false, 'Bleiben beendet den Versuch vor der Start-I/O');
                }
                gate.resolve();
                assertEqual(await bounded(start), true, 'Befund 5: echte Probelaufinitialisierung und Seitenbootstrap bleiben trotz Navigation bereit');
                assertEqual(await ready, true, 'Bereitschaft wird eindeutig abgeschlossen');
                await bounded(click);
                assertEqual(f.win.location.href, accept ? 'Simulator.html' : 'http://localhost/Balance.html', 'Befund 5: Zustimmung wird nach Bereitschaft ausgeführt, Bleiben bleibt');
                f.guard.revokeNative();
                assertEqual(f.guard.isBusy(), false, 'Beendeter Wechsel/Bleiben hinterlässt keine Reservierung');
                const commit = f.guard.register('foreign', { read: () => ({ phase: 'commit' }) });
                assertEqual(await f.guard.prepare(), null, 'Fremder Commit bleibt gesperrt'); commit.unregister();
            } finally { gate.resolve(); reason.unregister(); await bounded(start); await bounded(click); }
        });
    }
}
async function seedActive(adapter) {
    const f = page('index', 'http://localhost/index.html?probelauf=1');
    await inPage(f, adapter, async () => {
        await initializeProfilePage({ doc: f.doc, win: f.win });
        assertEqual((await getProbelaufController(f.doc).start(() => ({ source: 'demo', testDate: '2027-07-01' }))).status,
            'reloaded', 'Muster-Probelauf über den echten gemeinsamen Start angelegt');
        const annual = f.locks.trace.indexOf('lock:entered:rs-annual-operation');
        const writer = f.locks.trace.indexOf('lock:entered:rs-probelauf-operation', annual + 1);
        assert(annual >= 0 && writer > annual, 'Musterstart erwirbt Jahresbesitz vor dem Persistenzwriter');
        const writerReleased = f.locks.trace.indexOf('lock:released:rs-probelauf-operation', writer + 1);
        const annualReleased = f.locks.trace.indexOf('lock:released:rs-annual-operation', writer + 1);
        assert(writerReleased > writer && annualReleased > writerReleased, 'Musterstart gibt den Writer vor dem Jahresbesitz frei');
    });
}
async function delayedActiveStart() {
    const adapter = backend(); await seedActive(adapter);
    const load = adapter.loadAll.bind(adapter), entered = deferred(), gate = deferred(); let reads = 0;
    adapter.loadAll = async () => { if (++reads === 2) { entered.resolve(); await gate.promise; } return load(); };
    const f = page('balance', 'http://localhost/Balance.html');
    await inPage(f, adapter, async () => {
        const start = initializeProfilePage({ doc: f.doc, win: f.win });
        const ready = whenProfilePageReady(f.doc).catch(error => error);
        try {
            await bounded(entered.promise);
            P.setItemSync('sim_start_delay', 'Synthetischer Startwrite');
            const lifecycleFlush = P.flush().catch(error => error);
            // Ein aktiver Cache trifft während verzögertem Schutzread auf den echten Flush.
            for (let i = 0; i < 20; i++) await Promise.resolve();
            gate.resolve();
            assertEqual(await bounded(start), true, 'Befund 8: verzögerter aktiver Seitenstart mit Lifecycleflush erzeugt kein falsches Recovery');
            assertEqual(await ready, true, 'Aktiver Seitenstart bestätigt Profilbereitschaft');
            assertEqual(await lifecycleFlush, true, 'Lifecycleflush unter bestätigtem Startschutz erfolgreich');
            assertEqual(getProbelaufController(f.doc).blocked, false, 'Bestätigter aktiver Zustand bleibt bedienbar');
            assertEqual(JSON.parse(adapter.durable[KEY]).phase, 'active', 'Dauerhafter Zustand fällt nicht auf starting zurück');
        } finally { gate.resolve(); await bounded(start); await ready; }
    });
}
async function tauriStart() {
    for (const identifier of ['com.dieter.ruhestandsapp.kandidat', 'com.dieter.ruhestandsapp', 'unbekannt', null, 'IPC-Fehler']) {
        const f = page('tranches', 'tauri://localhost/depot-tranchen-manager.html'), adapter = backend();
        const expectedCash = JSON.parse(adapter.durable.rs_profiles_v1).profiles.muster_a.data.profile_tagesgeld;
        Object.keys(adapter.durable).filter(isProfileScopedKey).forEach(key => delete adapter.durable[key]);
        f.win.__TAURI__ = { app: { getIdentifier: async () => { if (identifier === 'IPC-Fehler') throw new Error('IPC'); return identifier; } } };
        await inPage(f, adapter, async () => {
            const reason = f.guard.register('restored-result', { read: () => ({ phase: 'idle', result: true }) });
            // Die Tauri-Unterseite restauriert auch während eines frühen Wechselversuchs.
            const start = initializeProfilePage({ doc: f.doc, win: f.win });
            const click = f.doc.fire('click', { target: linkFor(f, 'Balance.html') });
            await f.doc.getElementById('navigationGuardLeave').fire('click');
            try {
                assertEqual(await bounded(start), true, 'Befund 7: Tauri-Protokoll erreicht Profilrestoration und Unterseitenbereitschaft');
                assertEqual(await whenProfilePageReady(f.doc), true, 'Tauri-Profilbereitschaft bestätigt');
                assertEqual(f.win.__rsProfileSubpageLifecycleInitialized, true, 'Tauri-Unterseitenflag erreicht');
                const c = getProbelaufController(f.doc);
                assertEqual(c.runtime.kind, 'tauri', 'Tauri-Merkmal verhindert Browserfallback');
                assertEqual(c.runtime.canStart, true, 'Alle Tauri-Kennungen erlauben Probelauf');
                assertEqual(P.getItemSync('rs_current_profile'), 'muster_a', 'Vorhandener Profilbestand restauriert');
                assertEqual(P.getItemSync('profile_tagesgeld'), expectedCash, 'Tauri-Bootstrap restauriert fehlenden Livewert aus der vorhandenen Registry');
                assertEqual(P.getItemSync('profile_person_schema_version'), '1', 'Tauri-Restoration erhält bestätigtes Personenschema');
                await bounded(click);
            } finally { reason.unregister(); await bounded(start); await bounded(click); }
        });
    }
}
async function roundtrip() {
    const adapter = backend(); await seedActive(adapter);
    for (const [kind, path] of [['balance', 'Balance.html'], ['simulator', 'Simulator.html'], ['tranches', 'depot-tranchen-manager.html'],
        ['handbook', 'Handbuch.html'], ['index', 'index.html']]) {
        const f = page(kind, 'http://localhost/' + path);
        await inPage(f, adapter, async () => {
            assertEqual(await initializeProfilePage({ doc: f.doc, win: f.win }), true, path + ': echter schneller Start bereit');
            const c = getProbelaufController(f.doc);
            assertEqual(c.blocked, false, path + ': Band bedienbar ohne Schlafpause');
            assertEqual(getAppTestDate(), '2027-07-01', path + ': Testdatum erhalten');
            await f.win.fire('pagehide', { persisted: false });
            await P.flush();
            assertEqual(JSON.parse(adapter.durable[KEY]).phase, 'active', path + ': Lifecycle erhält active');
            if (kind === 'index') {
                const entered = deferred(), gate = deferred(), save = adapter.saveBatch.bind(adapter);
                let held = false;
                adapter.saveBatch = async batch => {
                    if (!held && batch.upserts.some(([key]) => key === KEY)) { held = true; entered.resolve(); await gate.promise; }
                    return save(batch);
                };
                const reloaded = deferred(); f.win.location.reload = () => reloaded.resolve(true);
                const day = f.nodes.find(node => node.dataset.probelaufAction === 'day');
                const pending = f.doc.getElementById('probelaufBand').fire('click', { target: day });
                try {
                    await bounded(entered.promise);
                    const flush = P.flush(); // Unabhängiger Flush darf den Phasenwriter nicht überholen.
                    gate.resolve();
                    assertEqual(await bounded(reloaded.promise), true, 'Befund 8: +1 Tag ohne Pause bestätigt trotz verzögertem Write und fremdem Flush');
                    await bounded(flush);
                    assertEqual(JSON.parse(adapter.durable[KEY]).phase, 'active', 'Verzögerte Folge erhält active');
                    assertEqual(JSON.parse(adapter.durable[KEY]).testDate, '2027-07-02', '02.07.2027 dauerhaft bestätigt');
                } finally { gate.resolve(); await bounded(pending); await bounded(reloaded.promise).catch(() => {}); adapter.saveBatch = save; }
            }
        });
    }
}
async function recoveryBackup() {
    const adapter = backend(); await seedActive(adapter);
    const f = page(), save = adapter.saveBatch.bind(adapter);
    await inPage(f, adapter, async () => {
        await initializeProfilePage({ doc: f.doc, win: f.win });
        const c = getProbelaufController(f.doc);
        adapter.saveBatch = async batch => { if (batch.upserts.some(([key]) => key === KEY)) throw new Error('Echter Transaktionsfehler'); return save(batch); };
        const result = await c.changeDate('2027-07-02').catch(error => ({ error }));
        assert(result.error && c.blocked, 'Echter Writefehler erzeugt weiterhin Recovery');
        adapter.saveBatch = save;
        const before = JSON.stringify(adapter.durable), snapshots = adapter.points.size;
        // initOverview muss Sicherungsknöpfe auch bei erfolgloser Profilbereitschaft binden.
        await initOverview(f.doc, f.win);
        // Zentraler Zieldienst bleibt auch nach erfolglosem Start gesperrt.
        bindFullBackupButton({ document: f.doc, window: f.win, probelaufController: getProbelaufController(f.doc) });
        bindFullBackupImport({ document: f.doc, window: f.win, probelaufController: getProbelaufController(f.doc) });
        await f.doc.getElementById('fullBackupBtn').fire('click');
        assert(f.doc.getElementById('fullBackupStatus').textContent?.includes('gesperrt'), 'Befund 8: Vollsicherung meldet Recovery-Sperre sichtbar');
        f.doc.getElementById('fullBackupStatus').textContent = '';
        let fileClicks = 0;
        f.doc.getElementById('fullBackupImportFile').click = () => fileClicks++;
        await f.doc.getElementById('fullBackupImportBtn').fire('click');
        assert(f.doc.getElementById('fullBackupStatus').textContent?.includes('gesperrt'), 'Befund 8: Import meldet Recovery-Sperre sichtbar');
        assertEqual(fileClicks, 0, 'Recovery öffnet keine Dateiauswahl');
        assertEqual(JSON.stringify(adapter.durable), before, 'Recovery-Sicherung/Import verändern keine Persistenz');
        assertEqual(adapter.points.size, snapshots, 'Recovery-Sicherung/Import erzeugen kein Archiv');
        renderProbelaufUI(f.doc, c);
        const day = f.nodes.find(node => node.dataset.probelaufAction === 'day');
        assert(day.disabled && day.title?.length > 0, 'Befund 8: gesperrter Bandknopf besitzt einen konkreten Sperrgrund');
    });
}
async function fallbackOrder() {
    const adapter = backend(); await seedActive(adapter);
    const f = page(); delete f.win.navigator.locks;
    await inPage(f, adapter, async () => {
        await initializeProfilePage({ doc: f.doc, win: f.win });
        const entered = deferred(), gate = deferred(), save = adapter.saveBatch.bind(adapter);
        let held = false;
        adapter.saveBatch = async batch => {
            if (!held) { held = true; entered.resolve(); await gate.promise; }
            return save(batch);
        };
        P.setItemSync('profile_tagesgeld', '90123');
        const prior = P.flush();
        await bounded(entered.promise);
        const c = getProbelaufController(f.doc), change = c.changeDate('2027-07-02');
        try {
            for (let i = 0; i < 20; i++) await Promise.resolve();
            assertEqual(c.busy, false, 'Ohne Web Locks wartet der Koordinator auf den unabhängigen bereits laufenden Writer');
            assertEqual(JSON.parse(adapter.durable[KEY]).phase, 'active', 'Wartender Koordinator schreibt keine frühe Startphase');
            gate.resolve(); await bounded(prior);
            assertEqual((await bounded(change)).status, 'reloaded', 'Lokale Writerreihenfolge bestätigt den Datumswechsel ohne Hänger');
            assertEqual(JSON.parse(adapter.durable[KEY]).phase, 'active', 'Lokale verzögerte Schreibfolge erhält active');
            assertEqual(JSON.parse(adapter.durable[KEY]).testDate, '2027-07-02', 'Lokale verzögerte Schreibfolge bestätigt den nächsten Tag');
            assertEqual(adapter.durable.profile_tagesgeld, '90123', 'Vorheriger fachlicher Write bleibt dauerhaft erhalten');
        } finally { gate.resolve(); await bounded(prior); await bounded(change); adapter.saveBatch = save; }
    });
}
async function migrationFields() {
    for (const fails of [false, true]) {
        const data = { profile_aktuelles_alter: '67', profile_rente_monatlich: '0', profile_rente_aktiv: 'false',
            sim_p1Monatsrente: '1234', sim_p1StartInJahren: '1' };
        const adapter = backend({ rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
            a: { meta: { id: 'a', name: 'Synthetische Person A', belongsToHousehold: true }, data }
        } }), rs_current_profile: 'a', rs_active_profile: 'a', ...data });
        const entered = deferred(), gate = deferred(), save = adapter.saveBatch.bind(adapter);
        let held = false;
        adapter.saveBatch = async batch => {
            if (!held && batch.upserts.some(([key]) => key === 'profile_person_schema_version')) {
                held = true; entered.resolve(); await gate.promise;
                if (fails) throw new Error('Personenwrite fehlgeschlagen');
            }
            return save(batch);
        };
        const f = page('tranches', 'http://localhost/depot-tranchen-manager.html');
        const field = f.doc.createElement('input'); field.id = 'profileRenteMonatlich'; field.disabled = false;
        const hidden = f.doc.createElement('input'); hidden.id = 'profileRenteAktiv'; hidden.disabled = true;
        f.doc.body.append(field, hidden);
        const query = f.doc.querySelectorAll;
        f.doc.querySelectorAll = selector => selector.includes('input[id^="profile"]') ? [field, hidden] : query(selector);
        await inPage(f, adapter, async () => {
            const start = initializeProfilePage({ doc: f.doc, win: f.win });
            const parallel = initializeProfilePage({ doc: f.doc, win: f.win });
            let readySettled = false;
            const ready = whenProfilePageReady(f.doc).then(() => { readySettled = true; return true; }, error => { readySettled = true; return error; });
            try {
                assertEqual(parallel, start, 'Befund 9: verzögerter Personenwrite und Parallelstart teilen denselben Abschluss');
                await bounded(f.choiceOpened.promise);
                await f.nodes.find(node => Object.hasOwn(node.dataset, 'pageChoiceAccept')).fire('click');
                await bounded(entered.promise);
                assertEqual(readySettled, false, 'Befund 9: keine frühe Bereitschaft nach Übernehmen');
                assertEqual(adapter.durable.profile_person_schema_version, undefined, 'Befund 9: verzögerter Write noch nicht dauerhaft bestätigt');
                assertEqual(field.disabled, true, 'Befund 9: Profil-/Personenfeld bleibt nach Übernehmen bis zum dauerhaften Write gesperrt');
                gate.resolve();
                assertEqual(await bounded(start), !fails, 'Befund 9: Erfolg und Writefehler schließen den Seitenstart ohne Hänger ab');
                const result = await bounded(ready);
                assertEqual(result === true, !fails, 'Befund 9: Bereitschaft folgt ausschließlich dem bestätigten Erfolg');
                assertEqual(field.disabled, fails, 'Befund 9: Freigabe erst nach Erfolg, Fehler behält die Feldsperre');
                assertEqual(hidden.disabled, true, 'Vorher gesperrte Felder bleiben gesperrt');
                assertEqual(adapter.durable.profile_rente_monatlich, fails ? '0' : '1234', 'Dauerhafter Quellenwert ist bestätigt oder bytegleich zurückgerollt');
                assertEqual(adapter.durable.profile_person_schema_version, fails ? undefined : '1', 'Schemaversion entsteht ausschließlich nach erfolgreichem Write');
            } finally { gate.resolve(); await bounded(start); await bounded(parallel); await bounded(ready); }
        });
        if (!fails) {
            const reloaded = page('tranches', 'http://localhost/depot-tranchen-manager.html'), snapshots = adapter.points.size;
            await inPage(reloaded, adapter, async () => {
                assertEqual(await initializeProfilePage({ doc: reloaded.doc, win: reloaded.win }), true, 'Befund 6: simuliertes Reload des gewählten Personenbestands bereit');
                assertEqual(await whenProfilePageReady(reloaded.doc), true, 'Befund 6: Profilbereitschaft nach Reload bestätigt');
                assertEqual(reloaded.win.__rsProfileSubpageLifecycleInitialized, true, 'Befund 6: Reload erreicht Unterseiten-Lifecycleflag');
                assertEqual(adapter.points.size, snapshots, 'Bestätigte Migration erzeugt beim Reload keine neue Sicherung');
            });
        }
    }
}
async function recoveryPage() {
    const adapter = backend(); await seedActive(adapter);
    const f = page(), save = adapter.saveBatch.bind(adapter);
    await inPage(f, adapter, async () => {
        await initializeProfilePage({ doc: f.doc, win: f.win });
        let failOnce = true;
        adapter.saveBatch = async batch => {
            if (failOnce && JSON.parse(adapter.durable[KEY]).phase === 'starting' && !batch.upserts.some(([key]) => key === KEY)) {
                failOnce = false; throw new Error('Kursgeneration fehlgeschlagen');
            }
            return save(batch);
        };
        const result = await getProbelaufController(f.doc).changeDate('2027-07-02');
        const c = getProbelaufController(f.doc), id = c.state.snapshotId;
        assert(result.error, 'Echter Fehler nach bestätigtem starting bleibt als Fehler sichtbar');
        assertEqual(JSON.parse(adapter.durable[KEY]).phase, 'starting', 'Echter abgebrochener Datumswechsel behält Recoveryphase');
        assertEqual(c.busy, false, 'Fehlerabschluss beendet eigene Arbeit');
        assertEqual(c.action, null, 'Fehlerabschluss entfernt Aktionskennung');
        assert(f.doc.getElementById('probelaufBandText').textContent.includes('Wiederherstellung erforderlich'), 'Echter Fehler zeigt nach eigener Arbeit Recovery');
        assert(f.doc.getElementById('probelaufStatus').textContent.includes(id), 'Fehlerstatus behält Rückkehrpunkt');
        adapter.saveBatch = save;
    });
    const recovery = page();
    await inPage(recovery, adapter, async () => {
        assertEqual(await initOverview(recovery.doc, recovery.win), false, 'Recovery verhindert Fachdatenbereitschaft');
        bindFullBackupButton({ document: recovery.doc, window: recovery.win, probelaufController: getProbelaufController(recovery.doc) });
        bindFullBackupImport({ document: recovery.doc, window: recovery.win, probelaufController: getProbelaufController(recovery.doc) });
        const c = getProbelaufController(recovery.doc);
        assertEqual(c.action, null, 'Neu initialisierter Controller übernimmt keine flüchtige Aktion');
        assert(recovery.doc.getElementById('probelaufBandText').textContent.includes('Wiederherstellung erforderlich'), 'Neuer Controller zeigt liegengebliebene Zwischenphase als Recovery');
        assertEqual(c.state.snapshotId, JSON.parse(adapter.durable[KEY]).snapshotId, 'Recovery behält dauerhafte Snapshot-ID');
        const before = JSON.stringify(adapter.durable), count = adapter.points.size;
        let clicks = 0; recovery.doc.getElementById('fullBackupImportFile').click = () => clicks++;
        await recovery.doc.getElementById('fullBackupBtn').fire('click');
        assert(recovery.doc.getElementById('fullBackupStatus').textContent?.includes('gesperrt'), 'Befund 8: echter fehlgeschlagener Seitenstart bindet Vollsicherung mit sichtbarer Sperre');
        recovery.doc.getElementById('fullBackupStatus').textContent = '';
        await recovery.doc.getElementById('fullBackupImportBtn').fire('click');
        assert(recovery.doc.getElementById('fullBackupStatus').textContent?.includes('gesperrt'), 'Befund 8: echter fehlgeschlagener Seitenstart bindet Import mit sichtbarer Sperre');
        assertEqual(clicks, 0, 'Gesperrter Import erreicht keine Dateioperation');
        assertEqual(JSON.stringify(adapter.durable), before, 'Recoveryknöpfe erzeugen keinen Persistenzwrite');
        assertEqual(adapter.points.size, count, 'Recoveryknöpfe erzeugen keinen Archivwrite');
        recovery.win.location.replace = () => {};
        assertEqual((await c.end(() => true)).status, 'reloaded', 'Vorhandener Recoveryweg bleibt wiederholbar');
        assertEqual(c.state, null, 'Recoveryende entfernt Steuerzustand erst nach Wiederherstellung');
    });
}
// Befund 1: echte Controllerbenachrichtigungen an drei steuerbaren I/O-Grenzen.
async function progressActions() {
    for (const scenario of ['start', 'date', 'end', 'recovery']) {
        const action = scenario === 'recovery' ? 'end' : scenario;
        const adapter = backend();
        if (action !== 'start') await seedActive(adapter);
        if (scenario === 'recovery') adapter.durable[KEY] = JSON.stringify({ ...JSON.parse(adapter.durable[KEY]), phase: 'restoring' });
        const f = page('index', 'http://localhost/index.html?probelauf=1');
        await inPage(f, adapter, async () => {
            await P.init({ window: f.win, installLifecycleHooks: false });
            const before = deferred(), releaseBefore = deferred(), during = deferred(), releaseDuring = deferred();
            const after = deferred(), releaseAfter = deferred(), notifications = [];
            const load = adapter.loadAll.bind(adapter), save = adapter.saveBatch.bind(adapter);
            let holdRead = false, heldWrite = false, task;
            const message = { start: 'Probelauf wird gestartet …', date: 'Testdatum wird umgestellt …',
                end: 'Ausgangsbestand wird wiederhergestellt …' }[action];
            const persistence = { ...P, async flush(options) {
                const result = await P.flush(options);
                if (heldWrite) { after.resolve(); await releaseAfter.promise; }
                return result;
            } };
            const c = createProbelaufController({ persistence, win: f.win, guard: f.guard, session: null,
                notify(controller, error) {
                    renderProbelaufUI(f.doc, controller, error);
                    notifications.push({ busy: controller.busy, action: controller.action, phase: controller.state?.phase,
                        visible: !f.doc.getElementById('probelaufBand').hidden, text: f.doc.getElementById('probelaufBandText').textContent });
                }, reload() {}, restoreReload() {} });
            await c.initialize();
            if (action === 'end' && !c.blocked) { P.setItemSync('profile_tagesgeld', '999'); await P.flush(); }
            adapter.loadAll = async () => {
                if (holdRead) { holdRead = false; before.resolve(); await releaseBefore.promise; }
                return load();
            };
            adapter.saveBatch = async batch => {
                if (!heldWrite && adapter.durable[KEY] && JSON.parse(adapter.durable[KEY]).phase !== 'active'
                    && !batch.upserts.some(([key]) => key === KEY)) {
                    heldWrite = true; during.resolve(); await releaseDuring.promise;
                }
                return save(batch);
            };
            const check = label => {
                assertEqual(c.busy, true, label + ': eigene Aktion beschäftigt');
                assertEqual(c.action, action, label + ': flüchtige Aktionskennung vorhanden');
                if (!f.doc.getElementById('probelaufBand').hidden) {
                    const text = f.doc.getElementById('probelaufBandText').textContent;
                    assert(text.includes(message), label + ': sichtbarer eigener Fortschritt');
                    assert(!text.includes('Wiederherstellung erforderlich'), label + ': keine Recovery während Arbeit');
                }
            };
            try {
                holdRead = true;
                task = action === 'start' ? c.start(() => ({ source: 'copy', testDate: '2027-07-01' }))
                    : action === 'date' ? c.changeDate('2027-07-02') : c.end(() => true);
                await bounded(before.promise); check('Vor Phasenschreiben'); releaseBefore.resolve();
                await bounded(during.promise); check('Nach Zwischenphase'); releaseDuring.resolve();
                await bounded(after.promise); check('Nach bestätigter Mutation'); releaseAfter.resolve();
                assertEqual((await bounded(task)).status, 'reloaded', action + ': Aktion erfolgreich');
                assertEqual(c.busy, false, 'Abschluss entfernt busy');
                assertEqual(c.action, null, 'Abschluss entfernt flüchtige Aktionskennung');
                assert(notifications.filter(n => n.busy).every(n => n.action === action), 'Jede Busybenachrichtigung trägt die eigene Aktion');
                assert(notifications.filter(n => n.busy && n.visible).every(n => n.text.includes(message)
                    && !n.text.includes('Wiederherstellung erforderlich')), 'Jede sichtbare Busybenachrichtigung zeigt Fortschritt');
                if (adapter.durable[KEY]) assert(!('action' in JSON.parse(adapter.durable[KEY])), 'Aktionskennung wird nicht persistiert');
            } finally {
                releaseBefore.resolve(); releaseDuring.resolve(); releaseAfter.resolve();
                if (task) await bounded(task).catch(() => {});
                adapter.loadAll = load; adapter.saveBatch = save;
            }
        });
    }
}

// Befund 2: echter Bandbinder und echte Facade-Commitlease mit angehaltenem Write.
async function foreignCommitClicks() {
    const warning = 'Gerade wird noch gespeichert. Bitte in ein paar Sekunden erneut versuchen.';
    for (const action of ['end', 'day', 'month', 'date', 'start']) {
        const adapter = backend();
        if (action !== 'start') await seedActive(adapter);
        const f = page('index', 'http://localhost/index.html?probelauf=1');
        await inPage(f, adapter, async () => {
            await P.init({ window: f.win, installLifecycleHooks: false });
            let reloads = 0, finished = null;
            let elapsed = 0;
            const c = createProbelaufController({ win: f.win, guard: f.guard, session: null,
                clock: () => elapsed, wait: async ms => { elapsed += ms; },
                reload() { reloads++; }, restoreReload() { reloads++; },
                notify(controller, error) { renderProbelaufUI(f.doc, controller, error); if (!controller.busy) finished?.resolve(); } });
            await c.initialize();
            bindProbelaufUI(f.doc, c, { dateDialog: async ({ starting }) => starting
                ? { source: 'copy', testDate: '2027-07-01' } : '2027-07-05', confirmEnd: async () => true });
            const entered = deferred(), gate = deferred(), attempted = deferred(), save = adapter.saveBatch.bind(adapter);
            let actionResult;
            for (const method of ['start', 'changeDate', 'end']) {
                const original = c[method];
                c[method] = async (...args) => {
                    const result = await original(...args); actionResult = result; attempted.resolve(); return result;
                };
            }
            let held = false, writer;
            adapter.saveBatch = async batch => {
                if (!held) { held = true; entered.resolve(); await gate.promise; }
                return save(batch);
            };
            const status = f.doc.getElementById('probelaufStatus');
            const click = () => action === 'start' ? f.doc.getElementById('probelaufStart').fire('click')
                : f.doc.getElementById('probelaufBand').fire('click', { target: f.nodes.find(n => n.dataset.probelaufAction === action) });
            try {
                // Unabhängiger Transaktionswriter besitzt die echte Guardlease.
                writer = P.replaceRecordsTransactional({ ui_foreign_commit: 'fertig' }, { allowKey: key => key === 'ui_foreign_commit', guard: f.guard, probelaufDomainWrite: true });
                await bounded(entered.promise);
                const before = JSON.stringify(adapter.durable), points = JSON.stringify([...adapter.points]), clock = getAppTestDate();
                const cache = JSON.stringify(Object.fromEntries(P.keysSync().map(key => [key, P.getItemSync(key)]))), state = JSON.stringify(c.state);
                const reasons = f.guard.reasons();
                assert(reasons.some(reason => reason.phase === 'commit'), 'Fremdwriter hält echte Commitlease');
                await click();
                await bounded(attempted.promise);
                await Promise.resolve(); // Fortsetzung des Binders nach dem Controllerergebnis.
                assertEqual(status.textContent, warning, `Befund 2: ${action} rendert Fremdcommit-Ablehnung`);
                assertEqual(actionResult.status, 'cancelled', 'Frühe Ablehnung bleibt cancelled');
                assertEqual(status.hidden, false, 'Ablehnung ist sichtbar');
                assertEqual(JSON.stringify(adapter.durable), before, 'Abgelehnter Klick verändert keine dauerhaften Records');
                assertEqual(JSON.stringify(Object.fromEntries(P.keysSync().map(key => [key, P.getItemSync(key)]))), cache, 'Abgelehnter Klick verändert keine Cacherecords');
                assertEqual(JSON.stringify(c.state), state, 'Abgelehnter Klick verändert keinen Controllerzustand');
                assertEqual(JSON.stringify([...adapter.points]), points, 'Abgelehnter Klick erzeugt keinen Snapshot');
                assertEqual(getAppTestDate(), clock, 'Abgelehnter Klick schaltet Uhr nicht um');
                assertEqual(c.busy, false, 'Frühe Ablehnung beginnt keine eigene Arbeit');
                assertEqual(c.action, null, 'Frühe Ablehnung hinterlässt keine Aktionskennung');
                assertEqual(c.blocked, false, 'Frühe Ablehnung erzeugt keine Recoverysperre');
                assertEqual(reloads, 0, 'Frühe Ablehnung lädt nicht neu');
                assertEqual(f.guard.reasons()[0].owner, reasons[0].owner, 'Fremde Lease bleibt beim ursprünglichen Besitzer');
                gate.resolve(); await bounded(writer); adapter.saveBatch = save;
                finished = deferred(); await click(); await bounded(finished.promise);
                assertEqual(reloads, 1, 'Erneuter bewusster Klick führt die Aktion normal aus');
                assert(!status.textContent.includes(warning), 'Wiederholung entfernt ausschließlich veraltete Speicherwarnung');
                if (action === 'end') assertEqual(c.state, null, 'Wiederholtes Ende stellt Ausgangsbestand her');
                else assertEqual(c.state.testDate, { start: '2027-07-01', day: '2027-07-02', month: '2027-08-01', date: '2027-07-05' }[action], 'Wiederholung bestätigt gewünschtes Testdatum');
            } finally { gate.resolve(); if (writer) await bounded(writer).catch(() => {}); adapter.saveBatch = save; }
        });
    }
}
async function localCommitDateClicks() {
    for (const action of ['day', 'month', 'date']) {
        const adapter = backend(); await seedActive(adapter);
        const f = page('index', 'http://localhost/index.html?probelauf=1');
        await inPage(f, adapter, async () => {
            await P.init({ window: f.win, installLifecycleHooks: false });
            let reloads = 0, selected = 0, elapsed = 0, writer, result;
            const entered = deferred(), gate = deferred(), completed = deferred(), save = adapter.saveBatch.bind(adapter);
            let held = false;
            adapter.saveBatch = async batch => { if (!held) { held = true; entered.resolve(); await gate.promise; } return save(batch); };
            const c = createProbelaufController({ win: f.win, guard: f.guard, session: null, reload() { reloads++; },
                clock: () => elapsed, wait: async ms => {
                    elapsed += ms;
                    assertEqual(f.doc.getElementById('probelaufStatus').textContent, 'Speichert noch …', 'Frühe Bandaktion rendert normale Warteanzeige');
                    assertEqual(c.busy, false, 'Wartephase blockiert Writer nicht durch künstliches busy');
                    assertEqual(c.state.testDate, '2027-07-01', 'Vor Writerfreigabe bleibt Testdatum erhalten');
                    gate.resolve(); await writer;
                }, notify(controller, error) { renderProbelaufUI(f.doc, controller, error); } });
            await c.initialize();
            const change = c.changeDate;
            c.changeDate = async (...args) => { result = await change(...args); completed.resolve(); return result; };
            bindProbelaufUI(f.doc, c, { dateDialog: async () => { selected++; return '2027-07-05'; } });
            try {
                writer = P.replaceRecordsTransactional({ ui_foreign_commit: 'fertig' }, { allowKey: key => key === 'ui_foreign_commit', guard: f.guard, probelaufDomainWrite: true });
                await bounded(entered.promise);
                const button = f.nodes.find(n => n.dataset.probelaufAction === action);
                await f.doc.getElementById('probelaufBand').fire('click', { target: button });
                await f.doc.getElementById('probelaufBand').fire('click', { target: button });
                await bounded(completed.promise);
                assertEqual(result.status, 'reloaded', 'Früher Bandklick läuft nach lokalem Startwriter weiter');
                assertEqual(reloads, 1, 'Doppelklick erzeugt höchstens einen Reload');
                assertEqual(selected, action === 'date' ? 1 : 0, 'Datumsdialog durch Doppelklick nicht verdoppelt');
                assertEqual(c.state.testDate, { day: '2027-07-02', month: '2027-08-01', date: '2027-07-05' }[action], 'Frühe Bandaktion bestätigt korrektes Datum');
                assertEqual(f.guard.reasons().length, 0, 'Frühe Bandaktion bereinigt Leases');
                assert(!f.doc.getElementById('probelaufStatus').textContent.includes('Ein unerwarteter Anwendungsfehler ist aufgetreten'), 'Bandaktion ohne generischen Fehlerpräfix');
            } finally { gate.resolve(); if (writer) await bounded(writer); adapter.saveBatch = save; }
        });
    }
}

const cases = { local: localCommitDateClicks, progress: progressActions, foreign: foreignCommitClicks, fallback: fallbackOrder, fields: migrationFields, 'recovery-page': recoveryPage, navigation: navigationDuringStart, active: delayedActiveStart, tauri: tauriStart,
    roundtrip, recovery: recoveryBackup, migration: migrationLifecycle };
for (const [name, run] of Object.entries(cases)) {
    if (!process.env.PROBELAUF_CASE || process.env.PROBELAUF_CASE === name) await run();
}
