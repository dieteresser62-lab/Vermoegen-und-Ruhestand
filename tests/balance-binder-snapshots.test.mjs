import { createSnapshotHandlers } from '../app/balance/balance-binder-snapshots.js';
import { resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { StorageManager, initStorageManager } from '../app/balance/balance-storage.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { SnapshotArchive, SNAPSHOT_TYPE } from '../app/shared/snapshot-archive.js';
import { PROFILE_STORAGE_KEYS } from '../app/profile/profile-state.js';

console.log('--- Balance Binder Snapshots Tests ---');

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(String(key), String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
        key: (index) => Array.from(store.keys())[index] || null,
        get length() { return store.size; }
    };
}

const prevLocalStorage = global.localStorage;
const prevConfirm = global.confirm;
const prevLocation = global.location;
const prevSetTimeout = global.setTimeout;

try {
    global.localStorage = createLocalStorageMock();
    resetPersistenceForTests(); // Explizites synchrones Backend für die direkten Fixture-Schreibzugriffe.
    let lastConfirmMessage = '';

    global.location = { reload: () => {} };
    global.setTimeout = (fn) => { fn(); return 0; };

    const dom = {
        inputs: { profilName: { value: 'TestLabel' } },
        outputs: { snapshotList: null },
        controls: {}
    };

    const appState = { snapshotHandle: null };

    let errorHandled = false;
    const prevToast = UIRenderer.toast;
    const prevHandleError = UIRenderer.handleActionError;

    UIRenderer.toast = () => {};
    UIRenderer.handleActionError = () => { errorHandled = true; };

    const handlers = createSnapshotHandlers({
        dom,
        appState,
        decide: async options => { lastConfirmMessage = options.description; return true; },
        confirmAnnual: async () => ({}),
        getLegacyDecision: () => 'not_committed',
        debouncedUpdate: () => {},
        applyAnnualInflation: () => {}
    });

    // Seed localStorage with state + tranchen (Snapshot muss beide enthalten).
    localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({ inputs: { foo: 1 }, lastState: { bar: 2 } }));
    localStorage.setItem('depot_tranchen', JSON.stringify([{ trancheId: 't1' }]));
    localStorage.setItem(PROFILE_STORAGE_KEYS.current, 'default');
    localStorage.setItem(PROFILE_STORAGE_KEYS.active, 'default');

    // --- TEST 1: createSnapshot generates canonical archive JSON ---
    {
        await SnapshotArchive.createSnapshot({ label: 'TestLabel', activeProfileId: 'default',
            records: SnapshotArchive.captureCurrentRecords({
                keys: Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)),
                getItem: key => localStorage.getItem(key) }) });
        const snapshots = await SnapshotArchive.listSnapshots();
        assert(snapshots.length >= 1, 'Snapshot archive entry should be created');
        assertEqual(snapshots[0].records, undefined, 'Snapshot list should not expose full records');
        const parsed = await SnapshotArchive.readSnapshot(snapshots[0].id);
        assertEqual(parsed.snapshotType, SNAPSHOT_TYPE, 'Snapshot should use canonical snapshot type');
        assert(parsed.records[CONFIG.STORAGE.LS_KEY], 'Snapshot should include app state');
        assert(parsed.records['depot_tranchen'], 'Snapshot should include depot_tranchen');
        assert(!Object.keys(parsed.records).some(key => key.startsWith(CONFIG.STORAGE.SNAPSHOT_PREFIX)), 'Snapshot should not include legacy snapshot keys');
    }

    // --- TEST 2: Snapshot label stored in archive entry ---
    {
        const snapshots = await SnapshotArchive.listSnapshots();
        assert(snapshots.some(entry => entry.label === 'TestLabel'), 'Snapshot archive entry should include label');
    }

    // Bestätigte Punktlöschung ohne entfernten Listenhost.
    {
        initStorageManager(dom, appState, UIRenderer);
        const snapshot = await SnapshotArchive.createSnapshot({
            id: 'synthetic-delete-without-balance-list', label: 'Synthetischer Löschpunkt', kind: 'manual',
            activeProfileId: 'default', records: { [CONFIG.STORAGE.LS_KEY]: localStorage.getItem(CONFIG.STORAGE.LS_KEY) }
        });
        const before = JSON.stringify(localStorage.getItem(CONFIG.STORAGE.LS_KEY));
        const button = { dataset: { key: snapshot.id } };
        errorHandled = false;
        await handlers.handleSnapshotActions({ target: { closest: selector => selector === '.delete-snapshot' ? button : null } });
        assert(!(await SnapshotArchive.listSnapshots()).some(entry => entry.id === snapshot.id), 'Bestätigte Löschung benötigt keine Balance-Liste');
        assertEqual(errorHandled, false, 'Bestätigte Löschung erzeugt keinen Darstellungsfehler');
        assertEqual(JSON.stringify(localStorage.getItem(CONFIG.STORAGE.LS_KEY)), before, 'Punktlöschung erhält den fachlichen Livebestand');
    }

    // --- TEST 3: restoreSnapshot restores data without clearing snapshot history or technical keys ---
    {
        const legacyKey = 'ruhestandsmodell_snapshot_2026-01-20T11:48:21.709Z--Muster A';
        const historical = { [legacyKey]: '{ "alt": true }', ui_from_registry: 'historisch UI',
            layout_from_registry: 'historisch Layout', 'sim.stressReplay.active.v1': '{ "registry": true }' };
        localStorage.setItem(PROFILE_STORAGE_KEYS.current, 'default');
        localStorage.setItem(PROFILE_STORAGE_KEYS.active, 'default');
        localStorage.setItem(PROFILE_STORAGE_KEYS.registry, JSON.stringify({
            version: 1,
            currentProfileId: 'default',
            profiles: {
                default: { meta: { name: 'Default' }, data: { ...historical } },
                other: { meta: { name: 'Other' }, data: { profile_tagesgeld: '999', ...historical } }
            }
        }));
        localStorage.setItem('ui_panel_state', 'keep-me');
        localStorage.setItem('layout_person_panel', 'Live Layout');
        localStorage.setItem(legacyKey, 'abweichender Live-Altsnapshot');
        localStorage.setItem('sim.stressReplay.active.v1', 'abweichender Live-Replay');
        const snapshot = await SnapshotArchive.createSnapshot({
            id: 'restore-test',
            label: 'RestoreTest',
            kind: 'manual',
            activeProfileId: 'default',
            activeProfileName: 'Default',
            records: {
                [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { a: 1 }, lastState: { b: 2 } }),
                [PROFILE_STORAGE_KEYS.current]: 'default',
                [PROFILE_STORAGE_KEYS.active]: 'default',
                [PROFILE_STORAGE_KEYS.registry]: JSON.stringify({ profiles: {
                    default: { data: { depot_tranchen: 'from-snapshot-registry', ...historical } },
                    other: { data: { profile_tagesgeld: '111', ...historical } },
                    snapshotOnly: { data: historical }
                } }),
                depot_tranchen: 'restored_value'
            }
        });
        localStorage.setItem('depot_tranchen', 'old');
        localStorage.setItem('profile_tagesgeld', 'old-profile-value');
        const archiveBefore = JSON.stringify(await SnapshotArchive.readSnapshot(snapshot.id));
        const archiveIds = (await SnapshotArchive.listSnapshots()).map(entry => entry.id).sort().join(',');

        const restoreBtn = { dataset: { key: snapshot.id } };
        const event = { target: { closest: (sel) => (sel === '.restore-snapshot' ? restoreBtn : null) } };
        await handlers.handleSnapshotActions(event);

        assert(lastConfirmMessage.includes('Standard-Restore setzt das zugeordnete Profil'), 'restore confirmation should describe standard restore scope');
        assert(lastConfirmMessage.includes('Snapshot-Historie bleiben erhalten'), 'restore confirmation should mention preserved snapshot history');
        assertEqual(localStorage.getItem('depot_tranchen'), 'restored_value', 'restoreSnapshot should restore localStorage data');
        assertEqual(localStorage.getItem('profile_tagesgeld'), null, 'restoreSnapshot should delete missing fachliche profile keys');
        assertEqual(localStorage.getItem('ui_panel_state'), 'keep-me', 'restoreSnapshot should keep technical UI keys');
        assert(await SnapshotArchive.readSnapshot(snapshot.id), 'restoreSnapshot should keep snapshot history');
        const registry = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEYS.registry));
        assert(registry.profiles.other, 'restoreSnapshot should preserve other registry profiles');
        assertEqual(registry.profiles.default.data.depot_tranchen, 'restored_value', 'restoreSnapshot should update restored profile data in current registry');
        assertEqual(registry.profiles.other.data.profile_tagesgeld, '999', 'Standardrestore übernimmt inaktive Snapshotprofile nicht');
        assert(!registry.profiles.snapshotOnly, 'Standardrestore übernimmt keine zusätzliche Snapshotregistry');
        for (const [key, value] of Object.entries(historical)) {
            assertEqual(registry.profiles.other.data[key], value, 'Standardrestore erhält historische inaktive Registrystrings: ' + key);
            assert(!Object.hasOwn(registry.profiles.default.data, key), 'Standardrestore baut aktives Profil nur aus fachlichen Top-Level-Records: ' + key);
        }
        assertEqual(localStorage.getItem(legacyKey), 'abweichender Live-Altsnapshot', 'Standardrestore erhält ausgeschlossenen Live-Altsnapshot');
        assertEqual(localStorage.getItem('sim.stressReplay.active.v1'), 'abweichender Live-Replay', 'Standardrestore erhält ausgeschlossenen Live-Replay');
        assertEqual(localStorage.getItem('layout_person_panel'), 'Live Layout', 'Standardrestore erhält technischen Live-Layoutwert');
        for (const key of ['ui_from_registry', 'layout_from_registry']) {
            assertEqual(localStorage.getItem(key), null, 'Standardrestore erzeugt keinen Livekey aus Registrybeigabe: ' + key);
        }
        assertEqual(JSON.stringify(await SnapshotArchive.readSnapshot(snapshot.id)), archiveBefore, 'Standardrestore erhält historische Archivrecords bytegleich');
        const pointsAfter = await SnapshotArchive.listSnapshots();
        assertEqual(pointsAfter.filter(entry => entry.kind !== 'before-restore-recovery').map(entry => entry.id).sort().join(','), archiveIds, 'Standardrestore erhält alle bestehenden Archivpunkte');
        assertEqual(pointsAfter.filter(entry => entry.kind === 'before-restore-recovery').length, 1, 'Standardrestore legt genau einen bestätigten Rückkehrpunkt an');
        assert(lastConfirmMessage.includes('vor Zurückholen'), 'Bestätigung erklärt den neuen Rückkehrpunkt');
        resetPersistenceForTests(); // Neues Dokument nach dem simulierten Reload.
    }

    // --- TEST 4: Fehlerhafte Snapshots werden abgefangen ---
    {
        const prevRestore = StorageManager.restoreSnapshot;
        StorageManager.restoreSnapshot = async () => { throw new Error('Restore failed'); };
        const restoreBtn = { dataset: { key: 'broken' } };
        const event = { target: { closest: (sel) => (sel === '.restore-snapshot' ? restoreBtn : null) } };
        await handlers.handleSnapshotActions(event);
        assert(errorHandled, 'Errors should be handled via UIRenderer.handleActionError');
        StorageManager.restoreSnapshot = prevRestore;
    }

    // --- TEST 5: Snapshot contains inputs, tranchen, state ---
    {
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({ inputs: { foo: 1 }, lastState: { bar: 2 } }));
        localStorage.setItem('depot_tranchen', JSON.stringify([{ trancheId: 't1' }]));
        dom.inputs.profilName.value = 'WithTranchen';
        await SnapshotArchive.createSnapshot({ label: dom.inputs.profilName.value, activeProfileId: 'default',
            records: SnapshotArchive.captureCurrentRecords({ keys: Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)),
                getItem: key => localStorage.getItem(key) }) });

        const snapshotEntry = (await SnapshotArchive.listSnapshots()).find(entry => entry.label === 'WithTranchen');
        const parsed = await SnapshotArchive.readSnapshot(snapshotEntry.id);
        assert(parsed.records[CONFIG.STORAGE.LS_KEY], 'Snapshot should include inputs/state');
        assert(parsed.records['depot_tranchen'], 'Snapshot should include tranchen');
    }

    // --- TEST 6: Multiple snapshots coexist ---
    {
        dom.inputs.profilName.value = 'Second';
        await SnapshotArchive.createSnapshot({ label: dom.inputs.profilName.value, activeProfileId: 'default',
            records: SnapshotArchive.captureCurrentRecords({ keys: Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)),
                getItem: key => localStorage.getItem(key) }) });
        const snapshots = await SnapshotArchive.listSnapshots();
        assert(snapshots.length >= 2, 'Multiple snapshot archive entries should coexist');
    }

    // --- TEST 7: Restore aborts when snapshot profile is missing in current registry ---
    {
        const snapshot = await SnapshotArchive.createSnapshot({
            id: 'missing-profile-restore-test',
            label: 'MissingProfile',
            kind: 'manual',
            activeProfileId: 'deleted-profile',
            records: {
                [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { missing: true } }),
                [PROFILE_STORAGE_KEYS.current]: 'deleted-profile'
            }
        });
        localStorage.setItem(PROFILE_STORAGE_KEYS.current, 'default');
        localStorage.setItem(PROFILE_STORAGE_KEYS.active, 'default');
        localStorage.setItem(PROFILE_STORAGE_KEYS.registry, JSON.stringify({
            version: 1,
            currentProfileId: 'default',
            profiles: {
                default: { meta: { name: 'Default' }, data: {} }
            }
        }));
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({ inputs: { keep: true } }));

        const restoreBtn = { dataset: { key: snapshot.id } };
        const event = { target: { closest: (sel) => (sel === '.restore-snapshot' ? restoreBtn : null) } };
        errorHandled = false;
        await handlers.handleSnapshotActions(event);

        assert(errorHandled, 'Missing profile restore should be handled as error');
        assert(JSON.parse(localStorage.getItem(CONFIG.STORAGE.LS_KEY)).inputs.keep, 'Missing profile restore should not mutate live state');
    }

    // Verzögerte Rückfragen prüfen vor Fortsetzung die ursprüngliche Identität.
    {
        const previous = { load: StorageManager.loadState, save: StorageManager.saveState,
            restore: StorageManager.restoreSnapshot, remove: StorageManager.deleteSnapshot,
            read: SnapshotArchive.readSnapshot, doc: globalThis.document };
        const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
        const turns = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
        let stored, saves, restores, deletes, profile, year, snapshotVersion;
        const seed = () => { stored = {}; saves = restores = deletes = 0; profile = 'synthetisch'; year = 2025; snapshotVersion = 1; };
        StorageManager.loadState = () => structuredClone(stored);
        StorageManager.saveState = value => { saves++; stored = structuredClone(value); };
        StorageManager.restoreSnapshot = async (key, handle, options) => { restores++; await options?.reload?.(); return { status: 'restored' }; };
        StorageManager.deleteSnapshot = async () => { deletes++; };
        SnapshotArchive.readSnapshot = async id => ({ id, records: { synthetic: String(snapshotVersion) } });
        const options = () => ({ dom: { inputs: { profilName: { value: 'Synthetisch' }, aktuellesAlter: { value: '67' } } },
            appState: {}, getProfileId: () => profile, getTargetYear: () => year,
            getReferenceDate: () => new Date(2026, 0, 15), getPlanningStatus: () => ({}),
            confirmAnnual: async () => null, flushLiveState: async () => {}, reportAnnualError: () => {} });
        const event = (action, signal) => { const button = { dataset: { key: 'synthetischer-snapshot' } };
            return { signal, target: { closest: selector => selector === `.${action}-snapshot` ? button : null } }; };
        try {
            delete globalThis.document;
            for (const action of ['restore', 'delete']) for (const change of ['decline', 'accept', 'profile', 'year', 'metadata', 'snapshot', 'abort', 'preabort']) {
                seed(); const decision = deferred(); const abort = new AbortController(); let questions = 0;
                if (change === 'preabort') abort.abort();
                const handler = createSnapshotHandlers({ ...options(), decide: async ({ signal }) => {
                    questions++; assert(!signal.aborted, 'Bereits abgebrochenes Signal öffnet keine Frage'); return decision.promise;
                } });
                const request = event(action, abort.signal), pending = handler.handleSnapshotActions(request);
                await turns();
                assertEqual(restores + deletes, 0, `${action}/${change}: vor Antwort kein Write`);
                if (change !== 'preabort') assertEqual((await handler.handleSnapshotActions(request)).status, 'in_flight', 'Doppelklick wird schon während der Frage gesperrt');
                if (change === 'profile') profile = 'andere-person';
                if (change === 'year') year = 2024;
                if (change === 'metadata') stored.annualPeriodMetadata = { newer: true };
                if (change === 'snapshot') snapshotVersion++;
                if (change === 'abort') abort.abort();
                decision.resolve(change !== 'decline'); await pending;
                assertEqual(restores + deletes, change === 'accept' ? 1 : 0, `${action}/${change}: nur aktuelle Zustimmung führt die Aktion einmal aus`);
                assertEqual(questions, change === 'preabort' ? 0 : 1, 'Keine zusätzliche Frage durch Doppelklick');
                assertEqual(saves, 0, 'Snapshotrückfrage schreibt keine Jahresmetadaten');
            }
            // Jahres-/Legacy-/Retryrückfragen werden über den echten gemeinsamen Dienst geprüft.
        } finally {
            StorageManager.loadState = previous.load; StorageManager.saveState = previous.save;
            StorageManager.restoreSnapshot = previous.restore; StorageManager.deleteSnapshot = previous.remove;
            SnapshotArchive.readSnapshot = previous.read;
            if (previous.doc === undefined) delete globalThis.document; else globalThis.document = previous.doc;
        }
    }

    UIRenderer.toast = prevToast;
    UIRenderer.handleActionError = prevHandleError;

    console.log('✅ Balance binder snapshots tests passed');
} finally {
    if (prevSetTimeout === undefined) delete global.setTimeout; else global.setTimeout = prevSetTimeout;
    if (prevLocation === undefined) delete global.location; else global.location = prevLocation;
    if (prevConfirm === undefined) delete global.confirm; else global.confirm = prevConfirm;
    if (prevLocalStorage === undefined) delete global.localStorage; else global.localStorage = prevLocalStorage;
}

console.log('--- Balance Binder Snapshots Tests Completed ---');
