import {
    SNAPSHOT_KINDS,
    SNAPSHOT_TYPE,
    buildSnapshot,
    captureCurrentRecords,
    createSnapshot,
    deleteSnapshot,
    listSnapshots,
    readSnapshot,
    toSnapshotIndexEntry,
    validateSnapshot,
    writeSnapshot
} from '../app/shared/snapshot-archive.js';

function createMemorySnapshotStorage() {
    const snapshots = new Map();
    const calls = [];
    return {
        calls,
        async writeSnapshot(snapshot) {
            calls.push(`write:${snapshot.id}`);
            snapshots.set(snapshot.id, JSON.parse(JSON.stringify(snapshot)));
        },
        async readSnapshot(id) {
            calls.push(`read:${id}`);
            return snapshots.get(id);
        },
        async listSnapshots() {
            calls.push('list');
            return Array.from(snapshots.values());
        },
        async deleteSnapshot(id) {
            calls.push(`delete:${id}`);
            snapshots.delete(id);
        }
    };
}

console.log('Test 1: buildSnapshot normalisiert Schema und erzeugt stabile ID');
{
    const snapshot = buildSnapshot({
        label: 'Profil:/2026?',
        kind: SNAPSHOT_KINDS.annualClosePreMutation,
        createdAt: '2026-06-02T18:00:00.000Z',
        activeProfileId: 'default',
        activeProfileName: 'Standard',
        records: {
            ruhestandsmodellValues_v29_guardrails: '{"inputs":{}}',
            depot_tranchen: null,
            balance_expenses_v1: 42
        }
    });

    assert(snapshot.id.startsWith('snapshot_2026-06-02T18-00-00-000Z--Profil-2026'), 'ID wird aus Zeit und bereinigtem Label gebildet');
    assertEqual(snapshot.schemaVersion, 1, 'Schema-Version ist 1');
    assertEqual(snapshot.snapshotType, SNAPSHOT_TYPE, 'Snapshot-Type ist kanonisch');
    assertEqual(SNAPSHOT_KINDS.balanceImportRecovery, 'balance-import-recovery',
        'Balance-Import-Recovery ist im kanonischen Kind-Register enthalten');
    assertEqual(SNAPSHOT_KINDS.fullBackupImportRecovery, 'full-backup-import-recovery',
        'Vollbackup-Recovery ist im kanonischen Kind-Register enthalten');
    assertEqual(snapshot.recordCount, 2, 'recordCount ignoriert null/undefined Records');
    assertEqual(snapshot.records.balance_expenses_v1, '42', 'Record-Werte werden als Strings normalisiert');
    assertEqual(snapshot.restoreScope.profileRegistryMode, 'preserve-by-default', 'Default-Restore-Scope wird gesetzt');
}

console.log('Test 2: captureCurrentRecords nutzt Snapshot-Key-Policy');
{
    const source = {
        ruhestandsmodellValues_v29_guardrails: 'live',
        depot_tranchen: 'tranches',
        ruhestandsmodell_snapshot_old: 'legacy snapshot',
        featureFlags: 'technical',
        debug_panel: 'technical',
        unrelated: 'no'
    };
    const records = captureCurrentRecords({
        keys: Object.keys(source),
        getItem: key => source[key]
    });

    assertEqual(records.ruhestandsmodellValues_v29_guardrails, 'live', 'fachlicher Balance-State wird aufgenommen');
    assertEqual(records.depot_tranchen, 'tranches', 'profilbezogener Fixed-Key wird aufgenommen');
    assert(!Object.prototype.hasOwnProperty.call(records, 'ruhestandsmodell_snapshot_old'), 'Legacy-Snapshot-Key wird ausgeschlossen');
    assert(!Object.prototype.hasOwnProperty.call(records, 'featureFlags'), 'technischer Exact-Key wird ausgeschlossen');
    assert(!Object.prototype.hasOwnProperty.call(records, 'unrelated'), 'nicht erlaubter Key wird ausgeschlossen');
}

console.log('P10c: Capture erhält verschachtelte historische Registrystrings ohne Livebeigaben');
{
    const historical = { 'ruhestandsmodell_snapshot_2026-01-20T11:48:21.709Z--Muster A': '{ "alt": true }',
        ui_panel_state: ' { "offen": true } ', layout_person_panel: 'links\nrechts',
        'sim.stressReplay.active.v1': '{ "registry": true }' };
    const registryRaw = JSON.stringify({ version: 1, profiles: {
        a: { meta: { id: 'a' }, data: historical }, b: { meta: { id: 'b' }, data: historical }
    } });
    const source = { rs_profiles_v1: registryRaw, ...historical };
    const records = captureCurrentRecords({ keys: Object.keys(source), getItem: key => source[key] });
    assertEqual(records.rs_profiles_v1, registryRaw, 'Capture erhält vollständigen historischen Registrystring bytegleich');
    for (const key of Object.keys(historical)) assert(!Object.hasOwn(records, key), 'Capture erzeugt keinen ausgeschlossenen Livekey: ' + key);
    const storage = createMemorySnapshotStorage();
    const saved = await createSnapshot({ records, activeProfileId: 'a', kind: 'person-data-migration-recovery',
        restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback' }
    }, { storage });
    const restored = await readSnapshot(saved.id, { storage });
    assertEqual(restored.records.rs_profiles_v1, registryRaw, 'Archivreadback erhält historische Registrystrings bytegleich');
    assertEqual(restored.recordCount, 1, 'Verschachtelte Registrybeigaben zählen nicht als zusätzliche Archivrecords');
}

console.log('Test 3: validateSnapshot lehnt unpassenden recordCount ab');
{
    let failed = false;
    try {
        validateSnapshot({
            schemaVersion: 1,
            id: 'bad',
            snapshotType: SNAPSHOT_TYPE,
            kind: 'manual',
            createdAt: '2026-06-02T18:00:00.000Z',
            recordCount: 99,
            records: { a: '1' }
        });
    } catch (err) {
        failed = /recordCount/.test(err.message);
    }
    assert(failed, 'recordCount-Abweichung wird als Fehler behandelt');
}

console.log('Test 4: SnapshotArchive delegiert an In-Memory-Fake-Storage');
{
    const storage = createMemorySnapshotStorage();
    const first = await createSnapshot({
        label: 'Alt',
        createdAt: '2026-06-01T10:00:00.000Z',
        activeProfileId: 'default',
        records: { balance_expenses_v1: 'old' }
    }, { storage });
    const second = buildSnapshot({
        label: 'Neu',
        createdAt: '2026-06-02T10:00:00.000Z',
        activeProfileId: 'default',
        records: { balance_expenses_v1: 'new' }
    });
    await writeSnapshot(second, { storage });

    const listed = await listSnapshots({ storage });
    assertEqual(listed.length, 2, 'zwei Snapshots werden gelistet');
    assertEqual(listed[0].id, second.id, 'Liste ist absteigend nach createdAt sortiert');
    assert(!Object.prototype.hasOwnProperty.call(listed[0], 'records'), 'Indexeintrag enthaelt keine Records');

    const readBack = await readSnapshot(first.id, { storage });
    assertEqual(readBack.records.balance_expenses_v1, 'old', 'readSnapshot validiert und liefert Vollsnapshot');

    await deleteSnapshot(first.id, { storage });
    const remaining = await listSnapshots({ storage });
    assertEqual(remaining.length, 1, 'deleteSnapshot entfernt den Eintrag');
    assert(storage.calls.includes(`write:${first.id}`), 'createSnapshot delegiert writeSnapshot');
    assert(storage.calls.includes(`read:${first.id}`), 'readSnapshot delegiert readSnapshot');
}

console.log('Test 5: toSnapshotIndexEntry markiert fehlende activeProfileId als nicht standard-restorable');
{
    const snapshot = buildSnapshot({
        label: 'Ohne Profil',
        kind: SNAPSHOT_KINDS.fullBackupImportRecovery,
        createdAt: '2026-06-02T18:00:00.000Z',
        records: { balance_expenses_v1: 'x' },
        restoreScope: {
            profileRegistryMode: 'replace-all-rollback',
            profileLiveDataMode: 'replace-all-rollback'
        }
    });
    const indexEntry = toSnapshotIndexEntry(snapshot);
    assertEqual(indexEntry.standardRestorable, false, 'Snapshot ohne activeProfileId ist nicht standard-restore-faehig');
    assertEqual(indexEntry.recordCount, 1, 'Index enthaelt recordCount');
    assertEqual(indexEntry.kind, SNAPSHOT_KINDS.fullBackupImportRecovery,
        'Index behaelt den registrierten Vollbackup-Recovery-Kind');
    assertEqual(indexEntry.restoreScope.profileRegistryMode, 'replace-all-rollback',
        'Index behaelt den Registry-Restore-Scope');
    assertEqual(indexEntry.restoreScope.profileLiveDataMode, 'replace-all-rollback',
        'Index behaelt den Profil-Livedaten-Restore-Scope');
}

console.log('Snapshot archive tests passed.');

console.log('P14: Beschädigte Metadaten und falsche Readbackidentität werden abgewiesen');
for (const input of [
    { ...buildSnapshot({ id: 'missing-date', records: {} }), createdAt: '' },
    { ...buildSnapshot({ id: 'missing-id', records: {} }), id: '' }
]) {
    let error; try { validateSnapshot(input); } catch (caught) { error = caught; }
    assert(error, 'Beschädigter Archivpunkt wird nicht mit erfundener Zeit oder ID repariert');
}
{
    const snapshot = buildSnapshot({ id: 'wrong-id', records: {} });
    let error; try { await readSnapshot('expected-id', { storage: { readSnapshot: async () => snapshot } }); } catch (caught) { error = caught; }
    assert(error?.message.includes('andere ID'), 'Snapshot-Readback prüft angefragte Identität');
    error = null;
    try { await listSnapshots({ storage: { listSnapshots: async () => [snapshot, snapshot] } }); } catch (caught) { error = caught; }
    assert(error?.message.includes('Doppelte'), 'Doppelte Archividentitäten verhindern unsichere Auswahl');
    const a = buildSnapshot({ id: 'a', records: {}, createdAt: '2026-01-01T00:00:00Z' });
    const z = buildSnapshot({ id: 'z', records: {}, createdAt: '2026-01-01T00:00:00Z' });
    assertEqual((await listSnapshots({ storage: { listSnapshots: async () => [a, z] } }))[0].id, 'z', 'Gleiche Zeitpunkte werden stabil nach ID sortiert');
}

assertEqual(SNAPSHOT_KINDS.householdPlanMigrationRecovery, 'household-plan-migration-recovery', 'Planumstellung hat eine eigene dauerhafte Art');
const migrationPoint = buildSnapshot({ kind: SNAPSHOT_KINDS.householdPlanMigrationRecovery, label: 'Vor Umstellung Haushalt & Plan', records: { household_plan_v1: 'synthetischer Rohstring' } });
assertEqual(migrationPoint.kind, 'household-plan-migration-recovery', 'Neue Art verwendet unverändertes Snapshotschema');
assertEqual(migrationPoint.records.household_plan_v1, 'synthetischer Rohstring', 'Archiv erhält Planbytes für bestehendes Zurückholen');
