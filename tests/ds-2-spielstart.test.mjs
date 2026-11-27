import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { MemoryWebStorage, fakeAreaIndexedDB, fakeAreaTauri } from './helpers/persistence-area-backends.mjs';

// DS-2/SV-1: Spielbereich „Kopie meiner Daten“ übernimmt keine Wiederherstellungspunkte.

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

// SV-1: Der Spielbereich bekommt keine Punkte, auch nicht als Kopie; die echte Punktedatei bleibt bytegleich.
{
    const writes = calls('save_app_state', 'spielsnapshots');
    await P.activatePlayArea({ source: 'copy', records: await P.readRealRecords() });
    assertEqual(calls('save_app_state', 'spielsnapshots') - writes, 0, 'Spielbereich schreibt keine Punktedatei');
    await restart();
    assertEqual((await P.listSnapshots()).length, 0, 'Spielbereich zeigt keine Punkte');
    assertEqual(tauri.files.get('snapshots'), realBefore, 'Echte Punktedatei bleibt bytegleich');
    await P.discardPlayArea();
    await restart();
    assertEqual((await P.listSnapshots()).length, 8, 'Nach dem Spielbereich sind die echten Punkte unverändert da');
}
P.resetPersistenceRuntimeForTests();
P.resetPersistenceForTests();
