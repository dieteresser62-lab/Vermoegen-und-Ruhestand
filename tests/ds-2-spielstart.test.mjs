import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { MemoryWebStorage, fakeAreaIndexedDB, fakeAreaTauri } from './helpers/persistence-area-backends.mjs';

// DS-2: Spielbereich „Kopie meiner Daten“ schreibt und bestätigt die Punkte in der Windows-App mit je einem Dateizugriff.

const local = new MemoryWebStorage(), session = new MemoryWebStorage(), tauri = fakeAreaTauri();
const window = { localStorage: local, sessionStorage: session, name: '', __TAURI__: {} };
const options = { window, localStorage: local, indexedDB: fakeAreaIndexedDB(), invoke: tauri.invoke, installLifecycleHooks: false };
const restart = async () => { P.resetPersistenceRuntimeForTests(); await P.init(options); };
const calls = (command, target) => tauri.calls.filter(call => call.command === command && call.target === target).length;

await restart();
P.setItemSync('profile_tagesgeld', '100.00'); await P.flush();
for (let index = 0; index < 8; index++) {
    await P.writeSnapshot(SnapshotArchive.buildSnapshot({ id: `ds2-punkt-${index}`, activeProfileId: 'default',
        createdAt: `2026-11-0${1 + (index % 5)}T1${index}:00:00.000Z`, records: { profile_tagesgeld: `${index}.00` } }));
}
await restart();
const realBefore = tauri.files.get('snapshots');

// 1. Start mit Kopie: ein Schreiben, höchstens zwei Lesevorgänge der Spiel-Punktedatei; alle Punkte gleich.
{
    const snapshots = await P.readRealSnapshots();
    const writes = calls('save_app_state', 'spielsnapshots'), reads = calls('load_app_state', 'spielsnapshots');
    await P.activatePlayArea({ source: 'copy', records: await P.readRealRecords(), snapshots });
    assertEqual(calls('save_app_state', 'spielsnapshots') - writes, 1, 'Spiel-Punktedatei wird einmal geschrieben');
    assert(calls('load_app_state', 'spielsnapshots') - reads <= 2, 'Spiel-Punktedatei wird höchstens zweimal gelesen');
    await restart();
    const play = await P.listSnapshots();
    assertEqual(play.length, 8, 'Spielbereich hat alle Punkte');
    assertEqual(JSON.stringify(JSON.parse(tauri.files.get('spielsnapshots')).snapshots), JSON.stringify(snapshots), 'Spielpunkte gleich den echten Punkten');
    assertEqual(tauri.files.get('snapshots'), realBefore, 'Echte Punktedatei bleibt bytegleich');
    await P.discardPlayArea();
    await restart();
}
// 2. Ohne Punkte entsteht wie bisher keine Spiel-Punktedatei.
{
    const writes = calls('save_app_state', 'spielsnapshots');
    await P.activatePlayArea({ source: 'copy', records: await P.readRealRecords(), snapshots: [] });
    assertEqual(calls('save_app_state', 'spielsnapshots') - writes, 0, 'Ohne Punkte kein Schreiben der Spiel-Punktedatei');
    await restart();
    await P.discardPlayArea();
    await restart();
}
// 3. Doppelte Kennung wird abgewiesen, der Spielbereich bleibt aus.
{
    const [point] = await P.readRealSnapshots();
    let rejected = false;
    try { await P.activatePlayArea({ source: 'copy', records: await P.readRealRecords(), snapshots: [point, point] }); } catch { rejected = true; }
    assert(rejected, 'Doppelte Punktkennung wird abgewiesen');
    await restart();
    assertEqual(P.getPersistenceStatus().storageArea, 'echt', 'Nach Abweisung bleibt der echte Bereich offen');
}
P.resetPersistenceRuntimeForTests();
P.resetPersistenceForTests();
