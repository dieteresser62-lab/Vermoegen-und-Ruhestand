import { PersistenceFacade as persistence } from '../app/shared/persistence-facade.js';
import { createPersistenceAreas } from '../app/shared/persistence-areas.js';
import { AREA_CONTROL_KEY, PLAY_STORAGE_PREFIX } from '../app/shared/persistence-area-storage.js';
import { HOUSEHOLD_PLAY_PREFIX, HOUSEHOLD_REGISTRY_KEY, HOUSEHOLD_STORAGE_PREFIX } from '../app/shared/household-registry.js';
import { buildHouseholdTransfer, householdTransferFilename, readHouseholdFile, HOUSEHOLD_TRANSFER_PURPOSE } from '../app/shared/household-transfer.js';
import { buildFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { MemoryWebStorage, fakeAreaIndexedDB, fakeAreaTauri } from './helpers/persistence-area-backends.mjs';
import { balanceStorageFixture } from './helpers/balance-storage-fixtures.mjs';

// HV-3: Haushalt als Datei weitergeben und als neuen Haushalt einspielen; Haushalt 1 bleibt bytegleich.
const oldRecords = { ...balanceStorageFixture('Altbestand').records, rs_current_profile: 'default', profile_tagesgeld: ' 12000.00 ' };

async function fixture(kind) {
    const local = new MemoryWebStorage(), session = new MemoryWebStorage();
    const indexedDB = kind === 'indexeddb' ? fakeAreaIndexedDB() : null;
    const tauri = kind === 'tauri' ? fakeAreaTauri() : null;
    const window = { localStorage: local, sessionStorage: session, name: '', ...(tauri ? { __TAURI__: {} } : {}) };
    const options = { window, localStorage: local, indexedDB, invoke: tauri?.invoke, installLifecycleHooks: false };
    const real = createPersistenceAreas(options).makeAdapter('echt');
    await real.open();
    await real.saveBatch({ upserts: Object.entries(oldRecords), deletes: [] });
    real.close?.();
    const reserved = key => key === AREA_CONTROL_KEY || key.startsWith(HOUSEHOLD_REGISTRY_KEY) || key.startsWith(PLAY_STORAGE_PREFIX)
        || key.startsWith(HOUSEHOLD_STORAGE_PREFIX) || key.startsWith(HOUSEHOLD_PLAY_PREFIX);
    const firstBytes = () => JSON.stringify({
        local: [...local.records].filter(([key]) => !reserved(key)),
        backend: tauri ? [tauri.files.get('live'), tauri.files.get('snapshots')] : indexedDB ? [indexedDB.bytes('ruhestand-suite')] : null
    });
    const restart = async () => { persistence.resetPersistenceRuntimeForTests(); await persistence.init(options); };
    return { firstBytes, restart };
}

for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
    console.log(`Übergabe: ${kind}`);
    const f = await fixture(kind), before = f.firstBytes();
    await f.restart();
    const lena = await persistence.createHousehold('Lena');
    await f.restart();
    // Ein fachlich gültiger Bestand, wie ihn die App nach dem Einrichten hat.
    for (const [key, value] of Object.entries(balanceStorageFixture('Lena').records)) persistence.setItemSync(key, value);
    persistence.setItemSync('profile_tagesgeld', '5000.00');
    await persistence.flush();
    await SnapshotArchive.createSnapshot({ id: 'lena-punkt', records: persistence.exportAllSync().records, activeProfileId: 'default' });
    // Befund Codex HV34-8: auch der normale Download (Fassade als storage) nennt den Haushalt.
    assertEqual(buildFullPersistenceBackup({ storage: persistence }).household?.id, lena, `${kind}: Vollsicherung über die Fassade nennt den Haushalt`);
    const tagged = buildFullPersistenceBackup();
    assertEqual(tagged.household?.id, lena, `${kind}: Vollsicherung nennt bei mehreren Haushalten ihren Haushalt`);
    const lenaRecords = await persistence.readHouseholdRecords(lena);
    await persistence.switchHousehold('h1');
    await f.restart();
    assertEqual(JSON.stringify(await persistence.readHouseholdRecords(lena)), JSON.stringify(lenaRecords), `${kind}: Haushalt B lesbar, ohne ihn zu öffnen`);
    assertEqual((await persistence.readHouseholdRecords('h1')).profile_tagesgeld, oldRecords.profile_tagesgeld, `${kind}: Haushalt 1 lesbar`);
    assertEqual(f.firstBytes(), before, `${kind}: Lesen für die Übergabe ändert Haushalt 1 nicht`);

    // Befund Codex HV34-3: alte Wiederherstellungspunkte (ruhestandsmodell_snapshot_*) gehen nie mit.
    const legacyPoint = 'ruhestandsmodell_snapshot_alter-stand';
    const transfer = buildHouseholdTransfer({ id: lena, name: 'Lena', records: { ...lenaRecords, [legacyPoint]: JSON.stringify({ snapshotType: 'full-localstorage', timestamp: '2025-01-01T12:00:00.000Z', localStorage: { profile_tagesgeld: '1.00' } }) } });
    assert(!(legacyPoint in transfer.records), `${kind}: Altpunkt nicht in der Übergabedatei`);
    assert(!(legacyPoint in readHouseholdFile(JSON.stringify({ ...transfer, records: { ...transfer.records, [legacyPoint]: '{}' }, localStorage: undefined, recordCount: transfer.recordCount + 1 })).records), `${kind}: Altpunkt wird auch beim Einlesen verworfen`);
    assertEqual(transfer.backupPurpose, HOUSEHOLD_TRANSFER_PURPOSE, `${kind}: Übergabedatei gekennzeichnet`);
    assertEqual(transfer.household.name, 'Lena', `${kind}: Übergabedatei trägt den Namen`);
    assert(!JSON.stringify(transfer).includes('lena-punkt'), `${kind}: keine Wiederherstellungspunkte in der Übergabedatei`);
    const read = readHouseholdFile(JSON.stringify(transfer));
    assert(read.transfer && read.name === 'Lena', `${kind}: Datei wird als Übergabe erkannt`);
    assertEqual(read.records.profile_tagesgeld, '5000.00', `${kind}: Records vollständig`);

    const copy = await persistence.createHouseholdFromRecords('Lena', read.records);
    await f.restart();
    const status = persistence.getPersistenceStatus();
    assertEqual(status.householdId, copy, `${kind}: eingespielter Haushalt ist offen`);
    assert(copy !== lena, `${kind}: eingespielter Haushalt bekommt eine eigene Kennung`);
    assertEqual(persistence.getItemSync('profile_tagesgeld'), '5000.00', `${kind}: Daten der Übergabe angekommen`);
    assertEqual((await persistence.listSnapshots()).length, 0, `${kind}: keine Punkte übernommen`);
    assertEqual(f.firstBytes(), before, `${kind}: Einspielen lässt Haushalt 1 bytegleich`);
    assertEqual(JSON.stringify(await persistence.readHouseholdRecords(lena)), JSON.stringify(lenaRecords), `${kind}: Quelle unverändert`);
}

// Dateiprüfung und Dateiname.
for (const bad of ['kein json', '{}', JSON.stringify({ backupType: 'etwas anderes' })]) {
    let rejected = false;
    try { readHouseholdFile(bad); } catch { rejected = true; }
    assert(rejected, `ungültige Datei abgewiesen: ${bad.slice(0, 30)}`);
}
assertEqual(householdTransferFilename('Lena M./Test', new Date('2026-11-04T12:00:00Z')), 'Haushalt-Lena-M-Test_2026-11-04.json', 'Dateiname ohne Sonderzeichen');
assertEqual(householdTransferFilename('Haushalt 1', new Date('2026-11-04T12:00:00Z')), 'Haushalt-1_2026-11-04.json', 'kein doppeltes „Haushalt“ im Dateinamen');
persistence.resetPersistenceRuntimeForTests();
