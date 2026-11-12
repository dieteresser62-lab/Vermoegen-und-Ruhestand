import { PersistenceFacade as persistence, persistenceStorage } from '../app/shared/persistence-facade.js';
import { createPersistenceAreas } from '../app/shared/persistence-areas.js';
import { installProfilePersistenceHooks, flushPendingProfileInputSave, initProfileSubpageLifecycle, initProfileIndexLifecycle, bindProfileNavigationHandoff } from '../app/profile/profile-navigation.js';
import { switchProfile, bootstrapProfileContext, PROFILE_LIVE_BASE_KEY, exportProfilesBundleToWindowName } from '../app/profile/profile-storage.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initializePflegeUIControls, PFLEGE_CUSTOM_COSTS_KEY } from '../app/simulator/simulator-ui-pflege.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { careSettingsStorage } from '../app/shared/care-profile-settings.js';
import { overviewScope, storeSimulationSummary } from '../app/overview/overview-storage.js';
import { buildSimulationSummary } from '../app/simulator/simulator-overview-summary.js';
import { FINGERPRINT_VERSION } from '../app/overview/overview-simulation-summary.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { MemoryWebStorage, fakeAreaTauri } from './helpers/persistence-area-backends.mjs';

const tick = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const previous = { document: globalThis.document, window: globalThis.window };

function recordsFor(current, single = false) {
    const profiles = {};
    for (const id of single ? ['a'] : ['a', 'b', 'outside']) profiles[id] = {
        id, meta: { id, name: id === 'a' ? 'Max Mustermann' : 'Erika Mustermann', belongsToHousehold: id !== 'outside' },
        data: { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14',
            sim_mcSeed: `${id}-alt`, sim_pflegeStufe1Zusatz: '6000', sim_pflegeKostenStaffelPreset: 'custom' }
    };
    return { rs_profiles_v1: JSON.stringify({ version: 1, profiles }), rs_current_profile: current,
        rs_active_profile: current, ...profiles[current].data };
}

async function fixture({ current = 'a', single = false, play = false, kind = 'localstorage', household = null } = {}) {
    persistence.resetPersistenceRuntimeForTests();
    const local = new MemoryWebStorage(), native = kind === 'tauri' ? fakeAreaTauri() : null;
    const timers = new Map(), listeners = new Map(), windowListeners = new Map();
    let sequence = 0, now = 0;
    const win = { localStorage: local, sessionStorage: new MemoryWebStorage(),
        addEventListener(type, fn) { const handlers = windowListeners.get(type) || []; handlers.push(fn); windowListeners.set(type, handlers); }, removeEventListener() {},
        setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, due: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); }, ...(native ? { __TAURI__: {} } : {}) };
    const options = { window: win, localStorage: local, indexedDB: null, invoke: native?.invoke,
        installLifecycleHooks: false, debounceMs: 60000 };
    const areas = createPersistenceAreas(options), real = areas.makeAdapter('echt');
    await real.open();
    const records = household ? { ...createMusterHaushaltRecords('2026-10-23', household),
        rs_current_profile: current, rs_active_profile: current } : recordsFor(current, single);
    await real.saveBatch({ upserts: Object.entries(records), deletes: [] });
    real.close?.();
    await persistence.init(options);
    if (play) {
        await persistence.activatePlayArea({ source: 'copy', records: await persistence.readRealRecords() });
        persistence.resetPersistenceRuntimeForTests();
        await persistence.init(options);
    }
    const realBytes = () => JSON.stringify(native ? native.files.get('live') : [...local.records].filter(([key]) => !key.startsWith('rs_spiel_v1:')));
    const doc = createSelectionDocument();
    doc.defaultView = win;
    doc.addEventListener = (type, fn) => { const handlers = listeners.get(type) || []; handlers.push(fn); listeners.set(type, handlers); };
    doc.removeEventListener = () => {};
    doc.contains = () => true;
    const seed = addField(doc, 'mcSeed'), costs = addField(doc, 'pflegeStufe1Zusatz');
    const runs = addField(doc, 'mcAnzahl');
    for (const grade of [2, 3, 4, 5]) addField(doc, `pflegeStufe${grade}Zusatz`, String(grade * 6000));
    const preset = addField(doc, 'pflegeKostenStaffelPreset', 'custom', [['custom', 'Individuelle Werte'], ['amtlich', 'Amtlicher Durchschnitt']]);
    addField(doc, 'displayPortfolioBreakdown');
    for (const field of doc.querySelectorAll('*').filter(node => ['INPUT', 'SELECT'].includes(node.tagName))) {
        const dispatch = field.dispatchEvent.bind(field);
        field.dispatchEvent = event => {
            dispatch(event);
            for (const handler of listeners.get(event.type) || []) handler(event);
        };
    }
    globalThis.document = doc; globalThis.window = win;
    if (household) await initProfileSubpageLifecycle({ doc, win });
    else installProfilePersistenceHooks({ doc, win });
    initInputPersistence();
    if (household) initializePflegeUIControls();
    return { doc, win, seed, costs, preset, runs, realBytes,
        registry: () => JSON.parse(persistence.getItemSync('rs_profiles_v1')),
        edit(field, value, type = 'input') {
            field.value = value;
            const event = { type, target: field };
            field.dispatchEvent(event); // Feldhandler vor dem Bubble-Listener des Dokuments.
        },
        async advance(ms) {
            now += ms;
            for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.fn(); }
            await tick();
        },
        async restart() {
            persistence.resetPersistenceRuntimeForTests();
            await persistence.init(options);
            const root = createSelectionDocument(), nextWin = { ...win };
            root.addEventListener = () => {};
            delete nextWin.__rsProfileSubpageLifecycleInitialized;
            await initProfileIndexLifecycle({ root, win: nextWin });
        },
        async pagehide() {
            for (const handler of windowListeners.get('pagehide') || []) await handler();
            await tick();
        },
        async close() {
            let handler;
            const replies = [];
            const previousTauri = win.__TAURI__;
            win.__TAURI__ = { event: { listen(name, fn) { handler = fn; return () => {}; } },
                core: { async invoke(command, args) { replies.push(args.response); return true; } } };
            try {
                persistence.bindTauriClose(doc, win);
                await tick();
                await handler({ payload: { attemptId: '1' } });
                return replies.join(',');
            } finally {
                if (previousTauri === undefined) delete win.__TAURI__; else win.__TAURI__ = previousTauri;
            }
        }
    };
}

function holdSummaryWrite(f, current) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const ids = Object.keys(f.registry().profiles);
    const scope = overviewScope(ids.length > 1 ? 'household' : 'single', ids);
    const summary = buildSimulationSummary({ kind: 'backtest', scope, sourceFingerprint: 'a'.repeat(64),
        runFingerprint: 'b'.repeat(64), fingerprintVersion: FINGERPRINT_VERSION, deviationApplied: false },
    { request: { startYear: 2000, endYear: 2025 }, outcome: { kind: 'completed' },
        metrics: { values: { wealth_end_real_eur: 1000 } } }, { completedAt: new Date('2026-10-23T12:00:00Z') });
    const pending = storeSimulationSummary(summary, { expectedProfileId: current,
        guard: getPageNavigationGuard(f.doc, f.win), flush: async () => { await gate; return persistence.flush(); } });
    return async () => { release(); return pending; };
}

try {
    // HS-1b: Der echte Bundleexport sichert den offenen Profiltimer selbst.
    {
        const f = await fixture({ current: 'a' });
        let click, exported;
        const addListener = f.doc.addEventListener;
        f.doc.addEventListener = (type, fn) => { if (type === 'click') click = fn; else addListener(type, fn); };
        f.win.location = { href: 'http://localhost/Simulator.html' };
        const link = { isConnected: true, dataset: {}, closest() { return this; },
            getAttribute: name => name === 'href' ? 'Balance.html' : null,
            hasAttribute: name => name === 'data-profile-handoff' };
        bindProfileNavigationHandoff({ root: f.doc, win: f.win, ready: () => true,
            exporter() { const result = exportProfilesBundleToWindowName(); exported = f.registry().profiles.a.data.sim_mcSeed; return result; } });
        f.edit(f.seed, 'vor dem 250-ms-Timer');
        assertEqual(f.registry().profiles.a.data.sim_mcSeed, 'a-alt', 'HS-1b Profilentprellung ist vor dem Link noch offen');
        await click({ target: link, button: 0, preventDefault() {} });
        assertEqual(exported, 'vor dem 250-ms-Timer', 'HS-1b Handoffexport enthält die wartende Profileingabe');
        assertEqual(JSON.parse(f.win.name.slice('RUHESTAND_PROFILE_BUNDLE:'.length)).registry.profiles.a.data.sim_mcSeed,
            'vor dem 250-ms-Timer', 'HS-1b derselbe aktuelle Personenstand steht im echten window.name-Bundle');
        assertEqual(f.win.location.href, 'Balance.html', 'HS-1b Link wechselt erst nach Profilsicherung');
    }
    // HS-1c: Der Profiltimer kann in eine nicht modale Übergabe fallen.
    // Der echte Export übernimmt denselben Stand vor dem abschließenden Flush.
    for (const waitingAt of ['ready', 'flush']) {
        const f = await fixture({ current: 'a' });
        let click, entered = false, release;
        const gate = new Promise(resolve => { release = resolve; });
        const addListener = f.doc.addEventListener;
        f.doc.addEventListener = (type, fn) => { if (type === 'click') click = fn; else addListener(type, fn); };
        f.win.location = { href: 'http://localhost/Simulator.html' };
        const link = { isConnected: true, dataset: {}, closest() { return this; },
            getAttribute: name => name === 'href' ? 'Balance.html' : null,
            hasAttribute: name => name === 'data-profile-handoff' };
        const wait = async () => { entered = true; await gate; return true; };
        bindProfileNavigationHandoff({ root: f.doc, win: f.win,
            ready: waitingAt === 'ready' ? wait : () => true,
            exporter: exportProfilesBundleToWindowName,
            flusher: async () => { if (waitingAt === 'flush') await wait(); return persistence.flush(); } });
        f.edit(f.seed, 'synthetisch während Übergabe');
        const leaving = click({ target: link, button: 0, preventDefault() {} });
        await tick();
        assert(entered && getPageNavigationGuard(f.doc, f.win).isBusy(), `HS-1c ${waitingAt}: Übergabe wartet bei aktivem Guard`);
        await f.advance(250);
        assertEqual(f.registry().profiles.a.data.sim_mcSeed, waitingAt === 'ready' ? 'a-alt' : 'synthetisch während Übergabe',
            `HS-1c ${waitingAt}: Timer schreibt während der Übergabe keinen eigenen Snapshot`);
        release(); await leaving;
        assertEqual(JSON.parse(f.win.name.slice('RUHESTAND_PROFILE_BUNDLE:'.length)).registry.profiles.a.data.sim_mcSeed,
            'synthetisch während Übergabe', `HS-1c ${waitingAt}: echter Export enthält den vom Timer ausgelassenen Stand`);
        const stored = await persistence.readPersistedRecords();
        assertEqual(JSON.parse(stored.rs_profiles_v1).profiles.a.data.sim_mcSeed, 'synthetisch während Übergabe',
            `HS-1c ${waitingAt}: Personenstand erreicht vor dem Wechsel den Adapter`);
        assertEqual(f.win.location.href, 'Balance.html', `HS-1c ${waitingAt}: Übergabe ist abgeschlossen`);
    }
    for (const scenario of ['unchanged', 'registry-newer', 'missing-base', 'other-person']) {
        const f = await fixture({ current: 'b' });
        bootstrapProfileContext({ preserveLiveProfileData: true });
        assertEqual(persistenceStorage.getItem(PROFILE_LIVE_BASE_KEY), null, 'H-1b Start ohne Eingabe legt keine dauerhafte Ladebasis an');
        if (scenario !== 'unchanged') persistenceStorage.setItem('sim_mcSeed', 'abweichende Livewerte');
        await persistence.flush();
        if (scenario === 'registry-newer') {
            const registry = f.registry(); registry.profiles.b.data.sim_mcSeed = 'neuer Personenstand';
            persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        }
        if (scenario === 'missing-base') persistenceStorage.removeItem(PROFILE_LIVE_BASE_KEY);
        if (scenario === 'other-person') {
            const base = JSON.parse(persistenceStorage.getItem(PROFILE_LIVE_BASE_KEY)); base.profileId = 'a';
            persistenceStorage.setItem(PROFILE_LIVE_BASE_KEY, JSON.stringify(base));
        }
        const result = bootstrapProfileContext({ preserveNewerLiveProfileData: true });
        assertEqual(result.action, 'loaded', `H-1 ${scenario}: ohne nachgewiesene neuere Livewerte bleibt der Startweg erhalten`);
        assertEqual(persistenceStorage.getItem('sim_mcSeed'), scenario === 'registry-newer' ? 'neuer Personenstand' : 'b-alt', `H-1 ${scenario}: gespeicherter Stand hat Vorrang`);
    }
    for (const kind of ['localstorage', 'tauri']) for (const play of [false, true]) for (const event of ['input', 'direct']) for (const startup of ['direct', 'migrated']) {
        const f = await fixture({ current: 'b', kind, play });
        if (startup === 'migrated') await f.restart();
        else bootstrapProfileContext();
        await persistence.flush();
        assertEqual(persistenceStorage.getItem(PROFILE_LIVE_BASE_KEY), null, 'H-1b Laden und Startflush schreiben keine Ladebasis');
        if (startup === 'direct') {
            bootstrapProfileContext({ preserveLiveProfileData: true });
            await f.pagehide();
            await persistence.flush();
            assertEqual(persistenceStorage.getItem(PROFILE_LIVE_BASE_KEY), null, 'H-1b Neustart und Entladen ohne Eingabe schreiben keine Ladebasis');
        }
        const beforeReal = f.realBytes();
        if (event === 'input') { f.edit(f.seed, 'neuer als Personenstand'); await f.advance(249); }
        else persistenceStorage.setItem('sim_mcSeed', 'neuer als Personenstand');
        // Der Livewrite ist dauerhaft, der Personen-Snapshot hat noch nicht begonnen.
        await persistence.flush();
        assertEqual(JSON.parse(persistenceStorage.getItem(PROFILE_LIVE_BASE_KEY))?.profileId, 'b', 'H-1b Erster fachlicher Flush sichert die Ladebasis vor dem Personen-Snapshot');
        assertEqual(f.registry().profiles.b.data.sim_mcSeed, 'b-alt', 'H-1 Absturzfenster enthält noch den alten Personenstand');
        await f.restart();
        assertEqual(persistence.getItemSync('sim_mcSeed'), 'neuer als Personenstand', 'H-1 Übersichtstart erhält neuere Livewerte derselben Person nach Absturz');
        assertEqual(f.registry().profiles.b.data.sim_mcSeed, 'neuer als Personenstand', 'H-1 Übersichtstart übernimmt die neueren Werte in den Personenstand');
        assertEqual(f.registry().profiles.a.data.sim_mcSeed, 'a-alt', 'H-1 Absturzstart verändert keine andere Person');
        if (play) assertEqual(f.realBytes(), beforeReal, 'H-1 Absturzstart im Spielbereich erhält echte Daten bytegleich');
    }
    for (const kind of ['localstorage', 'tauri']) {
        const f = await fixture({ current: 'muster_helga', household: 'helga-werner', kind });
        f.edit(f.seed, '918273'); await f.advance(250);
        assertEqual(f.registry().profiles.muster_helga.data.sim_mcSeed, '918273', 'Die erste Änderung wird im Personenstand gespeichert');
        const saved = persistence.getItemSync('rs_profiles_v1');
        f.edit(f.seed, '918273'); await f.advance(250);
        assertEqual(persistence.getItemSync('rs_profiles_v1'), saved, 'Haushaltsanteile lösen nach dem Speichern keinen weiteren Registrywrite aus');
        f.edit(f.seed, 'wartend');
        const unblock = persistence.blockSyncWrites(['rs_profiles_v1'], 'Wiederherstellung läuft');
        assertEqual(await flushPendingProfileInputSave(f.doc), false, 'Import erkennt eine durch Schreibsperre ungesicherte Eingabe');
        unblock();
    }
    for (const kind of ['localstorage', 'tauri']) for (const play of [false, true])
    for (const current of ['muster_helga', 'muster_werner']) for (const exit of ['crash', 'x', 'pagehide']) {
        const f = await fixture({ current, household: 'helga-werner', kind, play }), beforeReal = f.realBytes();
        const other = current === 'muster_helga' ? 'muster_werner' : 'muster_helga';
        const finishSummary = holdSummaryWrite(f, current);
        for (const grade of [1, 2, 3, 4, 5]) {
            const field = f.doc.getElementById(`pflegeStufe${grade}Zusatz`);
            f.edit(field, String(grade * 1000));
            f.edit(field, String(grade * 1000), 'change');
        }
        f.edit(f.preset, 'amtlich', 'change');
        f.edit(f.runs, '1234'); f.edit(f.runs, '1234', 'change');
        if (exit === 'crash') {
            await f.advance(249);
            assertEqual(f.registry().profiles[current].data.sim_mcAnzahl, undefined, 'Die Paar-Eingabe wartet auf die Entprellung');
            await f.advance(1);
            assertEqual(f.registry().profiles[current].data.sim_mcAnzahl, undefined, 'Während der Ergebnisablage beginnt keine unabhängige Personensicherung');
        }
        assertEqual(await finishSummary(), true, 'Die überlappende Ergebnisablage endet bestätigt');
        if (exit === 'crash') await f.advance(1250);
        else {
            assertEqual(f.registry().profiles[current].data.sim_mcAnzahl, undefined, 'Vor X/Seitenwechsel ist die Eingabe noch nicht entprellt');
            if (exit === 'x') assertEqual(await f.close(), 'hold,allow', `${current}: X sichert vor dem Flush ohne Entladeereignis`);
            else await f.pagehide();
        }
        assertEqual(f.registry().profiles[current].data.sim_mcAnzahl, '1234', `${kind}/${play}/${current}/${exit}: Laufzahl im richtigen Personenstand`);
        assertEqual(f.registry().profiles[other].data.sim_mcAnzahl, undefined, 'Die andere Person erhält keine fremde Laufzahl');
        await f.restart();
        assertEqual(persistence.getItemSync('sim_mcAnzahl'), '1234', `${current}/${exit}: Übersichtstart erhält die Laufzahl`);
        assertEqual(careSettingsStorage(persistenceStorage).getItem('sim_pflegeKostenStaffelPreset'), 'amtlich', `${current}: Übersichtstart erhält die gemeinsame Staffel`);
        assertEqual([1, 2, 3, 4, 5].map(grade => careSettingsStorage(persistenceStorage).getItem(`sim_pflegeStufe${grade}Zusatz`)).join('/'),
            '200/2300/7100/15000/18900', 'Alle amtlichen Staffelwerte bleiben erhalten');
        assertEqual(careSettingsStorage(persistenceStorage).getItem(PFLEGE_CUSTOM_COSTS_KEY), JSON.stringify({ version: 1, origin: 'von Hand', values: { 1: '1000', 2: '2000', 3: '3000', 4: '4000', 5: '5000' } }),
            'Die eigenen Pflegewerte bleiben neben der amtlichen Auswahl erhalten');
        assertEqual(persistence.getPersistenceStatus().activeArea, play ? 'spiel' : 'echt', 'Übersichtstart erhält den Datenbereich');
        if (play) assertEqual(f.realBytes(), beforeReal, `${kind}/${current}/${exit}: echte Daten bleiben bytegleich`);
    }
    for (const kind of ['localstorage', 'tauri']) for (const play of [false, true]) {
        for (const [current, single] of [['a', true], ['a', false], ['b', false], ['outside', false]]) {
            const f = await fixture({ current, single, play, kind }), beforeReal = f.realBytes();
            f.edit(f.seed, '111'); await f.advance(200);
            assertEqual(f.registry().profiles[current].data.sim_mcSeed, `${current}-alt`, 'Eingabe wartet auf die Entprellung');
            f.edit(f.seed, '222', 'change');
            f.edit(f.costs, '1234');
            f.edit(f.preset, 'amtlich', 'change');
            await f.advance(249);
            assertEqual(f.registry().profiles[current].data.sim_mcSeed, `${current}-alt`, 'Weitere Eingabe startet die Wartezeit neu');
            await f.advance(1);
            const profiles = f.registry().profiles, careOwner = current === 'outside' ? 'outside' : 'a';
            assertEqual(profiles[current].data.sim_mcSeed, '222', 'Letzte Simulator-Eingabe liegt im richtigen Personenstand');
            assertEqual(profiles[careOwner].data.sim_pflegeStufe1Zusatz, '1234', 'Gemeinsame Pflegewerte liegen auf dem Haushaltsprofil, Außenperson bleibt getrennt');
            assertEqual(profiles[careOwner].data.sim_pflegeKostenStaffelPreset, 'amtlich', 'Die Pflege-Voreinstellung wird beim richtigen Eigentümer gesichert');
            if (!single) {
                const other = current === 'a' ? 'b' : 'a';
                assertEqual(profiles[other].data.sim_mcSeed, `${other}-alt`, 'Andere Person behält ihre eigenen Einstellungen');
            }
            if (play) assertEqual(f.realBytes(), beforeReal, `${kind}: Eingabesicherung im Spielbereich lässt echte Daten bytegleich`);
            await f.restart(); // Ohne pagehide/beforeunload und ohne nachträglichen Testflush.
            assertEqual(persistence.getItemSync('sim_mcSeed'), '222', 'Harter Abbruch und Übersichtstart erhalten den gespeicherten Wert');
            assertEqual(f.registry().profiles[careOwner].data.sim_pflegeStufe1Zusatz, '1234', 'Pflegewerte überstehen den Startweg der Übersicht');
            assertEqual(persistence.getPersistenceStatus().activeArea, play ? 'spiel' : 'echt', 'Neustart bleibt im bisherigen Datenbereich');
            if (play) assertEqual(f.realBytes(), beforeReal, 'Auch der Neustart verändert die echten Daten nicht');
        }
    }
    for (const play of [false, true]) {
        const f = await fixture({ current: 'b', play, kind: 'tauri' }), beforeReal = f.realBytes();
        f.edit(f.seed, 'direkt vor X');
        f.edit(f.costs, '4321');
        assertEqual(await f.close(), 'hold,allow', 'X wartet auf Personensicherung und Flush ohne Eingabe-Entprellung');
        assertEqual(f.registry().profiles.b.data.sim_mcSeed, 'direkt vor X', 'X sichert die aktive zweite Person');
        assertEqual(f.registry().profiles.a.data.sim_pflegeStufe1Zusatz, '4321', 'X erhält gemeinsame Pflegewerte auf dem Haushaltsprofil');
        if (play) assertEqual(f.realBytes(), beforeReal, 'X im Spielbereich lässt die echten Tauri-Daten bytegleich');
    }
    for (const deferred of [false, true]) {
        const f = await fixture({ current: 'b' });
        const lease = deferred ? getPageNavigationGuard(f.doc, f.win).register('write', { read: () => ({ phase: 'commit' }) }) : null;
        f.edit(f.seed, '222');
        if (deferred) await f.advance(250);
        switchProfile('a');
        assertEqual(JSON.parse(persistenceStorage.getItem(PROFILE_LIVE_BASE_KEY))?.profileId, 'b', 'H-1b Personenwechsel sichert die Eingabe; Laden der Zielperson schreibt keine Ladebasis');
        const afterSwitch = persistence.getItemSync('rs_profiles_v1');
        lease?.unregister();
        await f.advance(250);
        assertEqual(persistence.getItemSync('rs_profiles_v1'), afterSwitch, 'Ausstehender Timer sichert nach Personenwechsel keine fremden Livewerte');
        assertEqual(f.registry().profiles.b.data.sim_mcSeed, '222', 'Personenwechsel sichert vorher die geänderte zweite Person');
    }
    for (const replacement of ['restore', 'import']) for (const deferred of [false, true]) {
        const f = await fixture({ current: 'b' });
        const lease = deferred ? getPageNavigationGuard(f.doc, f.win).register('write', { read: () => ({ phase: 'commit' }) }) : null;
        f.edit(f.seed, 'veraltet');
        if (deferred) await f.advance(250);
        const replacementRecords = recordsFor('b');
        replacementRecords.sim_mcSeed = 'wiederhergestellt';
        const registry = JSON.parse(replacementRecords.rs_profiles_v1);
        registry.profiles.b.data.sim_mcSeed = replacementRecords.sim_mcSeed;
        replacementRecords.rs_profiles_v1 = JSON.stringify(registry);
        await persistence.replaceRecordsTransactional(replacementRecords);
        const restored = persistence.getItemSync('rs_profiles_v1');
        lease?.unregister();
        await f.advance(250);
        assertEqual(persistence.getItemSync('rs_profiles_v1'), restored, `${replacement}: aufgeschobene Eingabesicherung verändert den wiederhergestellten Stand nicht`);
        assertEqual(f.registry().profiles.b.data.sim_mcSeed, 'wiederhergestellt', `${replacement}: alter Timer schreibt keine alten Eingabewerte zurück`);
    }
    for (const blocker of ['commit', 'restore']) {
        const f = await fixture();
        f.edit(f.seed, 'wartend');
        const guard = getPageNavigationGuard(f.doc, f.win);
        const registration = blocker === 'commit' ? guard.register('write', { read: () => ({ phase: 'commit' }) }) : null;
        const unblock = blocker === 'restore' ? persistence.blockSyncWrites(['rs_profiles_v1'], 'Wiederherstellung läuft') : null;
        const before = persistence.getItemSync('rs_profiles_v1');
        await f.advance(250);
        assertEqual(persistence.getItemSync('rs_profiles_v1'), before, 'Entprellte Eingabesicherung überholt keinen Commit oder Restore');
        await f.pagehide();
        registration?.unregister(); unblock?.();
        await tick();
        if (blocker === 'commit') assertEqual(f.registry().profiles.a.data.sim_mcSeed, 'wartend', 'Ein Entladeereignis während des Commits verwirft die ausstehende Eingabesicherung nicht');
    }
    {
        const f = await fixture();
        const lease = getPageNavigationGuard(f.doc, f.win).register('write', { read: () => ({ phase: 'commit' }) });
        f.edit(f.seed, 'erste Eingabe'); await f.advance(250);
        f.edit(f.seed, 'neue Eingabe');
        lease.unregister(); await f.advance(249);
        assertEqual(f.registry().profiles.a.data.sim_mcSeed, 'a-alt', 'Neue Eingabe löst die alte Commit-Wartebindung und startet die Entprellung neu');
        await f.advance(1);
        assertEqual(f.registry().profiles.a.data.sim_mcSeed, 'neue Eingabe', 'Nur die neueste Eingabe wird nach der neuen Wartezeit gesichert');
    }
    for (const change of ['area', 'write-block']) {
        const f = await fixture();
        const lease = getPageNavigationGuard(f.doc, f.win).register('write', { read: () => ({ phase: 'commit' }) });
        f.edit(f.seed, 'veraltet'); await f.advance(250);
        const unblock = change === 'write-block' ? persistence.blockSyncWrites(['rs_profiles_v1'], 'Wiederherstellung läuft') : null;
        if (change === 'area') {
            await persistence.flush();
            await persistence.activatePlayArea({ source: 'copy', records: await persistence.readRealRecords() });
        }
        const before = f.realBytes();
        const registry = change === 'write-block' ? persistence.getItemSync('rs_profiles_v1') : null;
        lease.unregister(); await tick(); unblock?.();
        if (change === 'write-block') assertEqual(persistence.getItemSync('rs_profiles_v1'), registry, 'Schreibsperre verhindert nachträglichen Personenwrite');
        else assertEqual(persistence.getPersistenceStatus().reloadRequired, true, 'Bereichswechsel hält das alte Formular bis zum Neuladen gesperrt');
        assertEqual(f.realBytes(), before, `${change}: nachgeholte Eingabesicherung übergeht weder Bereichswechsel noch Schreibsperre`);
    }
    {
        const f = await fixture();
        // Migrationen des Simulatorstarts gehören bereits zum bestätigten Stand.
        const { saveCurrentProfileFromLocalStorage } = await import('../app/profile/profile-storage.js');
        saveCurrentProfileFromLocalStorage(); await persistence.flush();
        const registry = f.registry();
        registry.profiles.a.meta.updatedAt = '2025-01-01T12:00:00.000Z';
        persistence.setItemSync('rs_profiles_v1', JSON.stringify(registry)); await persistence.flush();
        const before = persistence.getItemSync('rs_profiles_v1');
        const file = addField(f.doc, 'importFile');
        f.edit(file, 'synthetische-sicherung.json', 'change');
        await f.advance(250);
        assertEqual(persistence.getItemSync('rs_profiles_v1'), before, 'Dateiauswahl ohne gespeicherte Personenänderung lässt den Import-Ausgangsstand bytegleich');
    }
} finally {
    persistence.resetPersistenceRuntimeForTests();
    for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
}
