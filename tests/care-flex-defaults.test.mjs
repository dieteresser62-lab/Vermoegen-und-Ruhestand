// Altformat, Import/Spielkopie und PG1/2 ohne direkte Flex-Kürzung
import { readFileSync } from 'node:fs';
import { CARE_FLEX_DEFAULT_PERCENT, CARE_FLEX_FIELD_KEYS, CARE_FLEX_MIGRATION_KEY, migrateCareFlexRecord } from '../app/simulator/simulator-care-flex.js';
import { migrateStoredCareFlex } from '../app/simulator/simulator-care-flex-persistence.js';
import { readCareInputs } from '../app/simulator/simulator-input-care.js';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { makeDefaultCareMeta, updateCareMeta, computeHouseholdFlexFactor, endCareForDeceased, initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs } from './extended/parity-replay-fixture.mjs';
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
const defaults = [100, 100, 50, 0, 0];
const fields = values => Object.fromEntries(CARE_FLEX_FIELD_KEYS.map((key, i) => [key, values[i]]));
const old = fields(['75', '25', '10', '0', '0']);
const custom = fields(['80', '60', '30', '0', '0']);
const snapshot = storage => JSON.stringify([...storage.records]);
const assertLevels = (record, expected, message) => CARE_FLEX_FIELD_KEYS.forEach((key, i) =>
    assertEqual(Number(record[key]), expected[i], `${message}: PG${i + 1}`));

// Die Schlüssel stammen schon aus dem historischen lokalen Autosave (29cfc78b),
// vor den heutigen Fixtures und vor der PersistenceFacade. Profilversion 1
// erlaubte eine fehlende version und fehlende meta.id; nichts davon wird geraten.
for (const values of [['75', '25', '10', '0', '0'], [75, 25, 10, 0, 0], ['75,0', '25.00', '10.0', '0', '0']]) {
    const record = { ...fields(values), untouched: 'bleibt' }, before = JSON.stringify(record);
    const result = migrateCareFlexRecord(record);
    assertLevels(result, defaults, 'Vollständiger Altstand migriert');
    assertEqual(JSON.stringify(record), before, 'Lesender Profiladapter mutiert keinen Quellbestand');
    assertEqual(result.untouched, 'bleibt', 'Fremde Felder bleiben');
    assertEqual(migrateCareFlexRecord(result), result, 'Zweiter Start ist ohne Änderung');
    assertEqual(migrateCareFlexRecord({ ...result, ...old })[CARE_FLEX_FIELD_KEYS[0]], '75', 'Nach Migration bewusst zurückgestellte Werte bleiben');
}
for (const record of [custom, fields(['75', '25', '10', '', '0']), fields(['75', '25', '10', null, '0']),
    { ...old, [CARE_FLEX_FIELD_KEYS[2]]: '11' }, { ...old, [CARE_FLEX_FIELD_KEYS[4]]: undefined }]) {
    assertEqual(migrateCareFlexRecord(record), record, 'Eigene, unvollständige und ungültige Werte bleiben bytegleich');
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
    storage.setItem = (key, value) => { if (fail && key === CARE_FLEX_FIELD_KEYS[1]) { fail = false; throw new Error('Testfehler'); } set(key, value); };
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
        const value = Number(html.match(new RegExp(`id="pflegeStufe${grade}FlexCut"[^>]*?value="([^"]+)"`))[1]);
        assertEqual(value, defaults[grade - 1], 'HTML-Vorgaben stimmen');
        for (const input of [dom, profile, legacyProfile]) assertEqual(input.pflegeGradeConfigs[grade].flexCut, defaults[grade - 1] / 100, 'Reader verwendet dieselben Vorgaben');
        assertEqual(ownProfile.pflegeGradeConfigs[grade].flexCut, [80, 60, 30, 0, 0][grade - 1] / 100, 'Profilreader erhält eigene Werte');
        const care = { ...makeDefaultCareMeta(true), active: true, triggered: true, grade };
        updateCareMeta(care, { pflegefallLogikAktivieren: true, pflegeGradeConfigs: { [grade]: {} } }, 80, { inflation: 0 }, () => .999999);
        assertEqual(care.flexFactor, CARE_FLEX_DEFAULT_PERCENT[grade] / 100, 'DOM-freier Runner nutzt Grad-Vorgabe');
    }
}
// Externe Pflege ohne Zusatzkosten oder Pflegegeld isoliert den direkten Flexeffekt, einschließlich
// Dynamic Flex, Go-Go, Sicherheitsboden und Sterbejahr/Hinterbliebenenjahr.
for (const grade of [1, 2]) for (const dynamicFlex of [false, true]) for (const phase of ['couple', 'death', 'survivor', 'single']) {
    const input = { ...structuredClone(fixtureInputs), startFlexBedarf: 10000, minimumFlexAnnual: 1000,
        dynamicFlex, goGoActive: true, goGoMultiplier: 1.2, horizonYears: 25,
        partner: { ...fixtureInputs.partner, aktiv: phase !== 'single' }, pflegefallLogikAktivieren: true,
        pflegeGradeConfigs: { ...fixtureInputs.pflegeGradeConfigs, [grade]: { ...fixtureInputs.pflegeGradeConfigs[grade], careForm: 'external' } } };
    const care = { ...makeDefaultCareMeta(true), active: true, triggered: true, grade, flexFactor: 1 };
    const dead = ['death', 'survivor'].includes(phase);
    if (phase === 'survivor') endCareForDeceased(care, false);
    const household = { p1Alive: !dead, p2Alive: phase !== 'single', care: { p1: care, p2: null } };
    const neutral = { ...household, care: { p1: null, p2: null } };
    const factor = ctx => computeHouseholdFlexFactor({ hasPartner: input.partner.aktiv, ...ctx, careMetaP1: ctx.care.p1, careMetaP2: ctx.care.p2 });
    assertEqual(factor(household), factor(neutral), 'PG1/2 hat denselben Haushaltsfaktor wie ohne Pflege');
    const state = initMcRunState(input);
    if (phase === 'survivor') state.survivor = { deathYearIndex: 0, deceasedProfileId: 'p1', survivorProfileId: 'p2' };
    if (dynamicFlex) Object.assign(state.lastState, { initialized: true, vpwSafetyStage: 2, vpwLastDynamicFlex: 100000 });
    const year = { jahr: 2001, inflation: 2, rendite: .04, gold_eur_perf: 0, zinssatz: .02, lohn: 0 };
    const run = (ctx, careInput) => simulateOneYear(structuredClone(state), careInput, year, phase === 'survivor' ? 1 : 0,
        ctx.care.p1, 0, structuredClone(ctx), factor(ctx), EngineAPI);
    const result = run(household, input), without = run(neutral, { ...input, pflegefallLogikAktivieren: false });
    assertEqual(result.kind, 'success', 'PG1/2-Probe ist auswertbar');
    assertEqual(without.kind, 'success', 'Gegenprobe ohne Pflege ist auswertbar');
    for (const key of ['flex_brutto_haushalt', 'flex_haushalt_erfuellt', 'minimumFlexAnnual']) {
        assertClose(result.logData[key] ?? 0, without.logData[key] ?? 0, 1e-7, `PG${grade}/${phase}: ${key} wie ohne Pflege`);
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
