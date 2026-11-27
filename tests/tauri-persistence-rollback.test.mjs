import { createTauriJsonFileAdapter } from '../app/shared/persistence-adapter-tauri.js';
import { fakeAreaTauri } from './helpers/persistence-area-backends.mjs';

const { files, invoke } = fakeAreaTauri();
const writeError = new Error('Simulierter Schreibfehler');
let failNextWrite = false;
const adapter = createTauriJsonFileAdapter({
    async invoke(command, args) {
        if (command === 'report_app_save') return;
        if (command === 'save_app_state' && failNextWrite) {
            failNextWrite = false;
            throw writeError;
        }
        return invoke(command, args);
    }
});

async function expectWriteFailure(write) {
    failNextWrite = true;
    const error = await write().catch(error => error);
    assertEqual(error, writeError, 'Der Adapter reicht den Schreibfehler weiter');
}

await adapter.open();
await adapter.saveBatch({ upserts: [['changed', 'alt'], ['deleted', 'alt']], deletes: [] });
const records = await adapter.loadAll();
const initialRecords = JSON.stringify(records);
await expectWriteFailure(() => adapter.saveBatch({
    upserts: [['changed', 'fehlgeschlagen'], ['added', 'fehlgeschlagen']], deletes: ['deleted']
}));
assertEqual(JSON.stringify(await adapter.loadAll()), initialRecords, 'Fehlgeschlagener Batch lässt die Records im Speicher unverändert');
assertEqual(JSON.stringify(records), initialRecords, 'Zuvor gelesene Records behalten ihren Stand');
await adapter.saveBatch({ upserts: [['confirmed', 'neu']], deletes: [] });
assertEqual(JSON.stringify(JSON.parse(files.get('live')).records),
    JSON.stringify({ ...JSON.parse(initialRecords), confirmed: 'neu' }), 'Der nächste Batch schreibt nur seine Änderung');

await adapter.writeMetadata('changed', { value: 'alt' });
await expectWriteFailure(() => adapter.writeMetadata('changed', { value: 'fehlgeschlagen' }));
await expectWriteFailure(() => adapter.writeMetadata('added', { value: 'fehlgeschlagen' }));
assertEqual((await adapter.readMetadata('changed')).value, 'alt', 'Vorhandene Metadaten behalten ihren Wert');
assertEqual(await adapter.readMetadata('added'), null, 'Fehlgeschlagene neue Metadaten fehlen im Speicher');
await adapter.writeMetadata('confirmed', { value: 'neu' });
assertEqual(JSON.stringify(JSON.parse(files.get('live')).metadata),
    JSON.stringify({ changed: { value: 'alt' }, confirmed: { value: 'neu' } }), 'Die nächste Speicherung enthält nur bestätigte Metadaten');

const oldSnapshot = { id: 'existing', label: 'alt' };
await adapter.writeSnapshot(oldSnapshot);
await expectWriteFailure(() => adapter.writeSnapshot({ id: oldSnapshot.id, label: 'fehlgeschlagen' }));
await expectWriteFailure(() => adapter.writeSnapshot({ id: 'added', label: 'fehlgeschlagen' }));
assertEqual((await adapter.readSnapshot(oldSnapshot.id)).label, oldSnapshot.label, 'Ein vorhandener Sicherungspunkt behält seinen Stand');
assertEqual((await adapter.listSnapshots()).map(point => point.id).join(','), oldSnapshot.id, 'Ein fehlgeschlagener neuer Punkt fehlt im Archiv');
const newSnapshot = { id: 'confirmed', label: 'neu' };
await adapter.writeSnapshot(newSnapshot);
assertEqual(JSON.stringify(JSON.parse(files.get('snapshots')).snapshots), JSON.stringify([oldSnapshot, newSnapshot]),
    'Die nächste Speicherung ergänzt nur den neuen Sicherungspunkt');

await Promise.all([
    expectWriteFailure(() => adapter.saveBatch({ upserts: [['overlap', 'fehlgeschlagen']], deletes: ['confirmed'] })),
    adapter.writeMetadata('parallel', true)
]);
const afterOverlap = JSON.parse(files.get('live'));
assertEqual(afterOverlap.records.confirmed, 'neu', 'Ein wartender Schreibvorgang erhält den bestätigten Record');
assertEqual(afterOverlap.records.overlap, undefined, 'Ein wartender Schreibvorgang übernimmt keinen fehlgeschlagenen Record');
assertEqual(afterOverlap.metadata.parallel, true, 'Der wartende Schreibvorgang wird bestätigt');

// ST6-FIX (P2-1): Schlägt das Löschen eines Sicherungspunkts fehl, bleibt der Punkt im Speicher und im nächsten Schreiben.
await expectWriteFailure(() => adapter.deleteSnapshot(newSnapshot.id));
assertEqual((await adapter.listSnapshots()).map(point => point.id).join(','), `${oldSnapshot.id},${newSnapshot.id}`, 'Fehlgeschlagenes Löschen lässt den Punkt im Speicher');
await adapter.writeSnapshot({ id: 'after-delete', label: 'neu' });
assertEqual(JSON.parse(files.get('snapshots')).snapshots.map(point => point.id).join(','), `${oldSnapshot.id},${newSnapshot.id},after-delete`, 'Der nächste Schreibvorgang verliert den Punkt nicht');
