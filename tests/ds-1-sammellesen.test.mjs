import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { readDataModel } from '../app/data/data-model.js';
import { previewSnapshotRetention } from '../app/shared/snapshot-retention.js';
import { assertNewBeginningAllowed } from '../app/data/data-new-beginning.js';
import { MemoryWebStorage, fakeAreaIndexedDB, fakeAreaTauri } from './helpers/persistence-area-backends.mjs';

// H-DS-1: Daten & Sicherung liest die Punktedatei der Windows-App einmal statt einmal je Punkt.

const local = new MemoryWebStorage(), session = new MemoryWebStorage(), tauri = fakeAreaTauri();
const window = { localStorage: local, sessionStorage: session, name: '', __TAURI__: {} };
const options = { window, localStorage: local, indexedDB: fakeAreaIndexedDB(), invoke: tauri.invoke, installLifecycleHooks: false };
const restart = async () => { P.resetPersistenceRuntimeForTests(); await P.init(options); };
const snapshotReads = () => tauri.calls.filter(call => call.command === 'load_app_state' && call.target === 'snapshots').length;
const measure = async run => { const before = snapshotReads(); const result = await run(); return { result, reads: snapshotReads() - before }; };

await restart();
P.setItemSync('profile_tagesgeld', '100.00'); await P.flush();
const ids = Array.from({ length: 8 }, (_, index) => `ds1-punkt-${index}`);
for (const [index, id] of ids.entries()) {
    await P.writeSnapshot(SnapshotArchive.buildSnapshot({ id, activeProfileId: 'default',
        createdAt: `2026-11-0${1 + (index % 5)}T1${index}:00:00.000Z`, records: { profile_tagesgeld: `${index}.00` } }));
}
await restart();

// 1. Datenseite: ein Lesen der Punktedatei für alle Punkte, gleiche Punkte wie das Einzellesen.
{
    const { result: model, reads } = await measure(() => readDataModel(P));
    assertEqual(model.archiveError || '', '', 'Archiv lesbar');
    assertEqual(model.snapshots.length, 8, 'Alle Punkte gelistet');
    assert(reads <= 2, `Datenseite liest die Punktedatei höchstens zweimal (gelesen: ${reads})`);
    const { result: single, reads: singleReads } = await measure(() => Promise.all(model.snapshots.map(point => SnapshotArchive.readSnapshot(point.id))));
    assertEqual(singleReads, 8, 'Gegenprobe: Einzellesen liest die Datei je Punkt');
    const bulk = await SnapshotArchive.readSnapshots(model.snapshots.map(point => point.id));
    assertEqual(JSON.stringify(bulk), JSON.stringify(single), 'Sammellesen liefert dieselben Punkte wie das Einzellesen');
}
// 2. Löschvorschau (Aufräumen) liest ebenfalls einmal.
{
    const { result: preview, reads } = await measure(() => previewSnapshotRetention({ now: new Date('2026-11-06T12:00:00Z') }));
    assert(Array.isArray(preview.remove), 'Löschvorschau berechnet');
    assert(reads <= 1, `Löschvorschau liest die Punktedatei einmal (gelesen: ${reads})`);
}
// 2b. Codex DS1-1: Die Prüfung für „Neu beginnen“ (Seitenstart, Klick, Fensterfokus) liest ebenfalls einmal.
{
    const { result: allowed, reads } = await measure(() => assertNewBeginningAllowed({ window: {} }));
    assertEqual(allowed.points.length, 8, '„Neu beginnen“ prüft alle Punkte');
    assert(reads <= 1, `„Neu beginnen“ liest die Punktedatei einmal (gelesen: ${reads})`);
}
// 3. Unbekannte Kennung meldet wie bisher „nicht gefunden“.
{
    let message = '';
    try { await SnapshotArchive.readSnapshots([ids[0], 'gibt-es-nicht']); } catch (error) { message = error.message; }
    assert(message.includes('nicht gefunden'), `Fehlender Punkt wird gemeldet (${message})`);
}
// 4. Speicher ohne Sammellesen (Browser, Testdoppel): Einzellesen wie bisher.
{
    const points = new Map(ids.slice(0, 3).map(id => [id, SnapshotArchive.buildSnapshot({ id, activeProfileId: 'default', createdAt: '2026-11-05T12:00:00.000Z', records: { a: '1' } })]));
    const storage = { readSnapshot: async id => points.get(id) };
    const read = await SnapshotArchive.readSnapshots(ids.slice(0, 3), { storage });
    assertEqual(read.map(point => point.id).join(','), ids.slice(0, 3).join(','), 'Einzellesen als Rückfall');
}
// 5. Beschädigter Punkt: Löschvorschau markiert ihn wie bisher, statt abzubrechen.
{
    const archive = JSON.parse(tauri.files.get('snapshots'));
    const damagedId = archive.snapshots[0].id;
    archive.snapshots[0].recordCount = 99;
    tauri.files.set('snapshots', JSON.stringify(archive));
    await restart();
    const preview = await previewSnapshotRetention({ now: new Date('2026-11-06T12:00:00Z') });
    assertEqual(preview.keep.find(entry => entry.id === damagedId)?.reason, 'Nicht verlässlich lesbar – bleibt erhalten', 'Löschvorschau markiert den beschädigten Punkt');
    assertEqual(preview.keep.length + preview.remove.length, 8, 'Löschvorschau bewertet alle übrigen Punkte');
    const model = await readDataModel(P);
    assert(Boolean(model.archiveError), 'Datenseite meldet den beschädigten Punkt wie bisher');
}
P.resetPersistenceRuntimeForTests();
P.resetPersistenceForTests();
