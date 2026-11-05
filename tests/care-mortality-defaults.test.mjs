// FR-41: historische sim_pflegeStufe*Mortality-Schlüssel, Import und Spielbereich.
import { readFileSync } from 'node:fs';
import { CARE_MORTALITY_FIELD_KEYS, migrateCareMortalityRecord } from '../app/simulator/simulator-care-flex.js';
import { migrateStoredCareFlex } from '../app/simulator/simulator-care-flex-persistence.js';
import { readCareInputs } from '../app/simulator/simulator-input-care.js';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { MemoryWebStorage } from './helpers/persistence-area-backends.mjs';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { importProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';

const memoryStorage = records => {
    const storage = new MemoryWebStorage();
    for (const [key, value] of Object.entries(records)) storage.setItem(key, value);
    return storage;
};
const defaults = [1.5, 2, 3, 4, 5];
const fields = values => Object.fromEntries(CARE_MORTALITY_FIELD_KEYS.map((key, i) => [key, values[i]]));
const old = fields(['0', '0', '3', '5', '5']);
const custom = fields(['1.1', '1.2', '2', '3', '4']);
const snapshot = storage => JSON.stringify([...storage.records]);
const assertLevels = (record, expected, message) => CARE_MORTALITY_FIELD_KEYS.forEach((key, i) =>
    assertEqual(Number(record[key]), expected[i], `${message}: PG${i + 1}`));
assertLevels(migrateCareMortalityRecord({ ...old, sim_careFlexDefaultsVersion: '1' }), defaults,
    'Bereits abgeschlossene FR-39-Umstellung verhindert FR-41 nicht');

// Die Schlüssel stammen schon aus dem historischen lokalen Autosave (29cfc78b),
// vor den heutigen Fixtures und vor der PersistenceFacade. Profilversion 1
// erlaubte eine fehlende version und fehlende meta.id; nichts davon wird geraten.
for (const values of [['0', '0', '3', '5', '5'], [0, 0, 3, 5, 5], ['0,0', '0.00', '3.0', '5', '5']]) {
    const record = { ...fields(values), untouched: 'bleibt' }, before = JSON.stringify(record);
    const result = migrateCareMortalityRecord(record);
    assertLevels(result, defaults, 'Vollständiger Altstand migriert');
    assertEqual(JSON.stringify(record), before, 'Lesender Profiladapter mutiert keinen Quellbestand');
    assertEqual(result.untouched, 'bleibt', 'Fremde Felder bleiben');
    assertEqual(migrateCareMortalityRecord(result), result, 'Zweiter Start ist ohne Änderung');
    assertEqual(migrateCareMortalityRecord({ ...result, ...old })[CARE_MORTALITY_FIELD_KEYS[0]], '0', 'Nach Migration bewusst zurückgestellte Werte bleiben');
}
for (const record of [custom, fields(['0', '0', '3', '', '5']), fields(['0', '0', '3', null, '5']),
    { ...old, [CARE_MORTALITY_FIELD_KEYS[2]]: '11' }, { ...old, [CARE_MORTALITY_FIELD_KEYS[4]]: undefined }]) {
    assertEqual(migrateCareMortalityRecord(record), record, 'Eigene, unvollständige und ungültige Werte bleiben bytegleich');
}
{
    const registry = { profiles: { old: { meta: { name: 'Max Mustermann' }, data: old }, own: { meta: { name: 'Erika Mustermann' }, data: custom } } };
    const storage = memoryStorage({ ...old, rs_profiles_v1: JSON.stringify(registry) });
    const result = migrateStoredCareFlex(storage);
    assert(result.warning.includes('einmalig'), 'Erste Umstellung meldet sich');
    assertLevels(Object.fromEntries(storage.records), defaults, 'Live-Eingaben migriert');
    const profiles = JSON.parse(storage.getItem('rs_profiles_v1')).profiles;
    assertLevels(profiles.old.data, defaults, 'Inaktives altes Profil migriert');
    assertEqual(JSON.stringify(profiles.own.data), JSON.stringify(custom), 'Eigener Profilstand bytegleich');
    const before = snapshot(storage);
    assertEqual(migrateStoredCareFlex(storage).warning, '', 'Zweiter Start meldet nichts mehr');
    assertEqual(snapshot(storage), before, 'Zweiter Start schreibt nichts');
    storage.setItem('rs_profiles_v1', '{broken');
    const corrupt = snapshot(storage);
    assertEqual(migrateStoredCareFlex(storage).changed, false, 'Defekte Registry bleibt bei Recovery');
    assertEqual(snapshot(storage), corrupt, 'Recovery wird nicht überschrieben');
}
{
    const storage = memoryStorage(old), before = snapshot(storage);
    const set = storage.setItem.bind(storage); let fail = true;
    storage.setItem = (key, value) => { if (fail && key === CARE_MORTALITY_FIELD_KEYS[1]) { fail = false; throw new Error('Testfehler'); } set(key, value); };
    let caught = false;
    try { migrateStoredCareFlex(storage); } catch { caught = true; }
    assert(caught, 'Schreibfehler bleibt sichtbar');
    assertEqual(snapshot(storage), before, 'Fehlgeschlagene Umstellung rollt alle Werte zurück');
}
{
    const html = readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
    const personData = Object.values(JSON.parse(createMusterHaushaltRecords('2026-01-01').rs_profiles_v1).profiles)[0].data;
    const dom = readCareInputs({ doc: { getElementById: () => null } });
    const profile = buildSimulatorInputsFromProfileData(personData, { referenceYear: 2026, planValues: null });
    const legacyProfile = buildSimulatorInputsFromProfileData({ ...personData, ...old }, { referenceYear: 2026, planValues: null });
    const ownProfile = buildSimulatorInputsFromProfileData({ ...personData, ...custom }, { referenceYear: 2026, planValues: null });
    for (const grade of [1, 2, 3, 4, 5]) {
        const value = Number(html.match(new RegExp(`id="pflegeStufe${grade}Mortality"[^>]*?value="([^" ]+)"`))[1]);
        assertEqual(value, defaults[grade - 1], 'HTML-Sterblichkeitsvorgaben stimmen');
        for (const input of [dom, profile, legacyProfile]) assertEqual(input.pflegeGradeConfigs[grade].mortalityFactor, defaults[grade - 1], 'Alle Reader nutzen dieselben Vorgaben');
        assertEqual(ownProfile.pflegeGradeConfigs[grade].mortalityFactor, [1.1, 1.2, 2, 3, 4][grade - 1], 'Eigene Profilfaktoren bleiben');
    }
}
// Vollsicherung Schema 1 (localStorage-Alias), Schema 2 und altes Profilbundle
// führen ihre Originalrecords über den normalen Import zum gleichen Startpfad.
const records = createMusterHaushaltRecords('2026-01-01');
const registry = JSON.parse(records.rs_profiles_v1);
const ids = Object.keys(registry.profiles);
Object.assign(registry.profiles[ids[0]].data, old);
Object.assign(registry.profiles[ids[1]].data, custom);
Object.assign(records, old, { rs_profiles_v1: JSON.stringify(registry) });
for (const schemaVersion of [1, 2]) {
    const f = await playFixture('tauri'); await f.boot();
    const backup = buildFullPersistenceBackup({ storage: memoryStorage(records) });
    backup.schemaVersion = schemaVersion;
    if (schemaVersion === 1) delete backup.records;
    const bytes = JSON.stringify(backup);
    const imported = await importFullPersistenceBackup(backup);
    assertEqual(imported.ok, true, `Vollsicherung Schema ${schemaVersion} importiert: ${imported.message}`);
    assertEqual(migrateStoredCareFlex().changed, true, 'Importaltstand wird beim Start umgestellt');
    await P.flush();
    await f.boot();
    assertEqual(migrateStoredCareFlex().changed, false, 'Neustart nach Import idempotent');
    assertEqual(JSON.stringify(backup), bytes, 'Sicherungsquelle unverändert');
    assertLevels(P.exportAllSync().records, defaults, 'Importierte Eingaben mit neuer Vorgabe');
    P.resetPersistenceRuntimeForTests();
}
{
    const f = await playFixture('tauri', records); await f.boot();
    const before = f.realBytes();
    await P.activatePlayArea({ source: 'copy', records: await P.readRealRecords() });
    P.resetPersistenceRuntimeForTests(); await P.init(f.options);
    assertEqual(migrateStoredCareFlex().changed, true, 'Spielbereich-Kopie wird umgestellt');
    await P.flush();
    assertEqual(f.realBytes(), before, 'Spielumstellung verändert keine echten Records');
    assertLevels(P.exportAllSync().records, defaults, 'Spielwerte umgestellt');
    const bundle = { version: 1, exportedAt: '2025-11-01T12:00:00.000Z', currentProfileId: ids[0], registry, globals: {} };
    const imported = importProfilesBundle(bundle);
    assertEqual(imported.ok, true, `Historisches Profilbundle importiert: ${imported.message}`);
    assertEqual(migrateStoredCareFlex().changed, true, 'Altes Profilbundle erhält dieselbe Umstellung');
    const profiles = JSON.parse(persistenceStorage.getItem('rs_profiles_v1')).profiles;
    assertLevels(profiles[ids[0]].data, defaults, 'Profilbundle alt umgestellt');
    assertEqual(JSON.stringify(profiles[ids[1]].data), JSON.stringify(registry.profiles[ids[1]].data), 'Profilbundle eigene Werte bleiben');
    await P.flush(); P.resetPersistenceRuntimeForTests();
}
