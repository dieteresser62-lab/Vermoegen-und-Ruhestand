import { PersistenceFacade as persistence } from '../app/shared/persistence-facade.js';
import { createPersistenceAreas } from '../app/shared/persistence-areas.js';
import { AREA_CONTROL_KEY, PLAY_STORAGE_PREFIX, scopeWebStorage, areaSessionStorage } from '../app/shared/persistence-area-storage.js';
import { HOUSEHOLD_PLAY_PREFIX, HOUSEHOLD_REGISTRY_KEY, HOUSEHOLD_STORAGE_PREFIX } from '../app/shared/household-registry.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { MemoryWebStorage, fakeAreaIndexedDB, fakeAreaTauri } from './helpers/persistence-area-backends.mjs';
import { balanceStorageFixture } from './helpers/balance-storage-fixtures.mjs';

// HV-2: Spielbereich je Haushalt und Verwaltung (umbenennen, endgültig löschen, Bereich wieder anlegen).
// Jeder Schritt lässt Haushalt 1 bytegleich; Spiel und Löschen berühren nur den betroffenen Haushalt.
const oldRecords = { ...balanceStorageFixture('Altbestand').records, rs_current_profile: 'default', profile_tagesgeld: ' 12000.00 ' };
const point = SnapshotArchive.buildSnapshot({ id: 'real-point', activeProfileId: 'default', createdAt: '2025-01-02T12:00:00.000Z', records: { profile_tagesgeld: ' 12000.00 ' } });

async function fixture(kind) {
    const local = new MemoryWebStorage(), session = new MemoryWebStorage();
    // Auch unter Tauri gibt es IndexedDB (Ordnerzugriff); der Hauptspeicher nutzt sie dort nicht.
    const indexedDB = kind !== 'localstorage' ? fakeAreaIndexedDB() : null;
    const tauri = kind === 'tauri' ? fakeAreaTauri() : null;
    const window = { localStorage: local, sessionStorage: session, name: '', ...(tauri ? { __TAURI__: {} } : {}) };
    const options = { window, localStorage: local, indexedDB, invoke: tauri?.invoke, installLifecycleHooks: false };
    const real = createPersistenceAreas(options).makeAdapter('echt');
    await real.open();
    await real.saveBatch({ upserts: Object.entries(oldRecords), deletes: [] });
    if (real.writeSnapshot) await real.writeSnapshot(point);
    else local.setItem('rs_snapshot_archive_v1', JSON.stringify({ schemaVersion: 1, snapshots: [point], savedAt: 'old' }));
    real.close?.();
    const reserved = key => key === AREA_CONTROL_KEY || key.startsWith(HOUSEHOLD_REGISTRY_KEY) || key.startsWith(PLAY_STORAGE_PREFIX)
        || key.startsWith(HOUSEHOLD_STORAGE_PREFIX) || key.startsWith(HOUSEHOLD_PLAY_PREFIX);
    const firstBytes = () => JSON.stringify({
        local: [...local.records].filter(([key]) => !reserved(key)),
        backend: tauri ? [tauri.files.get('live'), tauri.files.get('snapshots')] : indexedDB ? [indexedDB.bytes('ruhestand-suite')] : null
    });
    const householdBytes = id => JSON.stringify(tauri ? [tauri.files.get(`hh/${id}/live`), tauri.files.get(`hh/${id}/snapshots`)]
        : indexedDB ? indexedDB.bytes(`ruhestand-suite-hh-${id}`) : [...local.records].filter(([key]) => key.startsWith(`${HOUSEHOLD_STORAGE_PREFIX}${id}:`)).sort());
    const playExists = id => tauri ? tauri.files.has(`hh/${id}/spiel`) : indexedDB ? indexedDB.databases.has(`ruhestand-suite-hh-${id}-spiel`)
        : [...local.records.keys()].some(key => key.startsWith(`${HOUSEHOLD_PLAY_PREFIX}${id}:`));
    // Alle Orte zugleich: native Dateien, jede IndexedDB-Datenbank, Web Storage und Sitzung.
    const anyData = id => [...(tauri ? tauri.files.keys() : [])].some(key => key.startsWith(`hh/${id}/`))
        || [...(indexedDB ? indexedDB.databases.keys() : [])].some(name => name.includes(`-hh-${id}`))
        || [...local.records.keys(), ...session.records.keys()].some(key => key.includes(`${id}:`));
    const restart = async () => { persistence.resetPersistenceRuntimeForTests(); await persistence.init(options); };
    return { kind, local, session, tauri, indexedDB, options, firstBytes, householdBytes, playExists, anyData, restart };
}

const rejects = async (action, text) => {
    let rejected = false;
    try { await action(); } catch { rejected = true; }
    assert(rejected, text);
};

for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
    console.log(`Haushalte Paket 2: ${kind}`);
    const f = await fixture(kind), before = f.firstBytes();
    await f.restart();
    const id = await persistence.createHousehold('Lena');
    await f.restart();
    persistence.setItemSync('profile_tagesgeld', '5000.00');
    persistence.setItemSync('rs_current_profile', 'default');
    await persistence.flush();
    const lenaBytes = f.householdBytes(id);

    // Spielbereich in B: Kopie von B, eigener Ort, B echt und Haushalt 1 unberührt.
    await persistence.activatePlayArea({ source: 'copy', records: await persistence.readRealRecords(), snapshots: await persistence.readRealSnapshots() });
    await f.restart();
    let status = persistence.getPersistenceStatus();
    assertEqual(status.activeArea, 'spiel', `${kind}: Spielbereich in B aktiv`);
    assertEqual(status.storageArea, `hhspiel:${id}`, `${kind}: eigener Spielbereich von B`);
    assertEqual(status.householdId, id, `${kind}: B bleibt geöffnet`);
    assertEqual(persistence.getItemSync('profile_tagesgeld'), '5000.00', `${kind}: Spielkopie aus B`);
    persistence.setItemSync('profile_tagesgeld', '9999.00');
    await persistence.flush();
    assert(f.playExists(id), `${kind}: Spieldaten liegen bei B`);
    assertEqual(f.householdBytes(id), lenaBytes, `${kind}: B echt bleibt im Spiel unverändert`);
    // Befund Codex HV2-1: eine zurückgenommene Übernahme stellt B einschließlich Fertigmarker wieder her.
    const manager = createPersistenceAreas(f.options);
    await manager.resolve();
    const transfer = await manager.openRealTransfer();
    await transfer.adapter.saveBatch({ upserts: [['profile_tagesgeld', 'halb übernommen']], deletes: [] });
    await transfer.rollback();
    transfer.close();
    assertEqual(f.householdBytes(id), lenaBytes, `${kind}: Rücknahme stellt B bytegleich her`);
    assertEqual(f.firstBytes(), before, `${kind}: Spiel in B lässt Haushalt 1 bytegleich`);
    await rejects(() => persistence.switchHousehold('h1'), `${kind}: kein Wechsel aus dem Spielbereich`);
    await rejects(() => persistence.createHousehold('Jonas'), `${kind}: kein Anlegen aus dem Spielbereich`);
    await persistence.discardPlayArea();
    await f.restart();
    status = persistence.getPersistenceStatus();
    assertEqual(status.storageArea, `hh:${id}`, `${kind}: nach dem Verwerfen wieder B echt`);
    assertEqual(persistence.getItemSync('profile_tagesgeld'), '5000.00', `${kind}: B echt unverändert`);
    assert(!f.playExists(id), `${kind}: Spieldaten von B entfernt`);

    // Umbenennen (auch Haushalt 1), dann Löschen mit Schutzregeln.
    await persistence.renameHousehold(id, 'Lena M.');
    await f.restart();
    await persistence.renameHousehold('h1', 'Unser Haushalt');
    await f.restart();
    const names = persistence.getHouseholds().households.map(entry => entry.name);
    assertEqual(JSON.stringify(names), JSON.stringify(['Unser Haushalt', 'Lena M.']), `${kind}: Namen geändert`);
    await rejects(() => persistence.deleteHousehold(id, 'Lena M.'), `${kind}: der geöffnete Haushalt lässt sich nicht löschen`);
    // Alle Löschorte befüllen: Sitzung von B echt und Spiel, Ordnerzugriff von B.
    areaSessionStorage(f.session).setItem('balance.annual-retry.once', 'lena retry');
    f.session.setItem(`${HOUSEHOLD_PLAY_PREFIX}${id}:rs_startup_prices_session_v1`, 'lena play');
    if (f.indexedDB) await new Promise(resolve => { const request = f.indexedDB.open(`ruhestand-suite-snapshot-handles-hh-${id}`, 1); request.onsuccess = () => { request.result.close(); resolve(); }; });
    await persistence.switchHousehold('h1');
    await f.restart();
    await rejects(() => persistence.deleteHousehold('h1', 'Unser Haushalt'), `${kind}: Haushalt 1 lässt sich nicht löschen`);
    await rejects(() => persistence.deleteHousehold(id, 'Lena'), `${kind}: falscher Name wird abgewiesen`);
    await f.restart();
    await persistence.deleteHousehold(id, ' Lena  M. ');
    await f.restart();
    assertEqual(persistence.getHouseholds().households.length, 1, `${kind}: B aus dem Verzeichnis entfernt`);
    assert(!f.anyData(id), `${kind}: alle Daten von B gelöscht`);
    assertEqual(f.firstBytes(), before, `${kind}: Löschen lässt Haushalt 1 bytegleich`);

    // Spielbereich in Haushalt 1 neben einem weiteren Haushalt.
    const jonas = await persistence.createHousehold('Jonas');
    await f.restart();
    await persistence.switchHousehold('h1');
    await f.restart();
    await persistence.activatePlayArea({ source: 'copy', records: await persistence.readRealRecords(), snapshots: await persistence.readRealSnapshots() });
    await f.restart();
    assertEqual(persistence.getPersistenceStatus().storageArea, 'spiel', `${kind}: Haushalt 1 behält seinen Spielbereich`);
    assertEqual(persistence.getItemSync('profile_tagesgeld'), oldRecords.profile_tagesgeld, `${kind}: Spielkopie aus Haushalt 1`);
    await persistence.discardPlayArea();
    await f.restart();
    assertEqual(f.firstBytes(), before, `${kind}: Spiel in Haushalt 1 lässt Haushalt 1 bytegleich`);

    // Rückweg: fehlender Bereich wird markiert und lässt sich wieder anlegen.
    if (f.tauri) f.tauri.files.delete(`hh/${jonas}/live`);
    else if (f.indexedDB) f.indexedDB.databases.delete(`ruhestand-suite-hh-${jonas}`);
    else scopeWebStorage(f.local, `hh:${jonas}`).clear();
    await persistence.switchHousehold(jonas);
    await f.restart();
    assertEqual(persistence.getPersistenceStatus().areaWarning?.code, 'household-area-missing', `${kind}: fehlender Bereich gemeldet`);
    assertEqual(persistence.getHouseholds().households.find(entry => entry.id === jonas)?.missing, true, `${kind}: fehlender Bereich markiert`);
    await persistence.rebuildHousehold(jonas);
    await f.restart();
    status = persistence.getPersistenceStatus();
    assertEqual(status.householdId, jonas, `${kind}: Bereich wieder angelegt und geöffnet`);
    assertEqual(persistence.getHouseholds().households.find(entry => entry.id === jonas)?.missing, undefined, `${kind}: Merker entfernt`);
    assertEqual(f.firstBytes(), before, `${kind}: Rückweg lässt Haushalt 1 bytegleich`);
}
persistence.resetPersistenceRuntimeForTests();
