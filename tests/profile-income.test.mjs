import { INCOME_KEY, INCOME_MIGRATION_KEY, incomeFromRecord, migrateIncomeRecord, incomeErrors, annualOtherIncome, monthlyOtherIncome, incomeFromStorage, fixedMonthlyIncome, simulatorOneTimeIncome, writeIncome } from '../app/profile/profile-income.js';
import { migrateStoredIncome } from '../app/profile/profile-income-migration.js';
import { projectPersonPension } from '../app/profile/profile-person-data.js';
import { isProfileScopedKey } from '../app/profile/profile-key-policy.js';
import { isAllowedPersistenceImportKey, isAllowedSnapshotCaptureKey } from '../app/shared/persistence-key-policy.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';

const same = (a,b,label) => assertEqual(JSON.stringify(a), JSON.stringify(b), label);
const storage = source => {
    const records = { ...source };
    return { records, getItem: key => records[key] ?? null, setItem: (key,value) => { records[key] = value; }, removeItem: key => { delete records[key]; } };
};
const oldList = JSON.stringify({ schemaVersion: 1, entries: [{ year: 2028, amount: 12345.67, label: 'Rückzahlung' }, { year: 2028, amount: 12345.67, label: 'Rückzahlung' }] });
const old = { profile_sonstige_einkuenfte: '750.125', profile_planned_inflows_v1: oldList };
setAppTestDate('2026-10-21');
try {
    for (const data of [{}, { profile_sonstige_einkuenfte: '', profile_planned_inflows_v1: '' }, old, { ...old, profile_person_schema_version: '1' }]) {
        const migrated = migrateIncomeRecord(data);
        for (const key of Object.keys(data)) assertEqual(migrated[key], data[key], 'Übernahme bewahrt jeden alten Record');
        assert(migrateIncomeRecord(migrated) === migrated, 'Zweiter Start verändert nichts');
        assertEqual(migrated[INCOME_MIGRATION_KEY], '1', 'Marker gehört zur Person');
    }
    const migrated = migrateIncomeRecord(old), entries = incomeFromRecord(migrated);
    assertEqual(entries.length, 3, 'Alte sonstige und doppelte einmalige Einkünfte bleiben vollständig');
    assertEqual(entries[0].bezeichnung, 'Sonstige Einkünfte', 'Altes Monatsfeld erhält seinen Namen');
    assertEqual(entries[1].monat, '2028-01', 'Alte Jahre werden auf Januar abgebildet');
    same(simulatorOneTimeIncome(migrated), JSON.parse(oldList).entries, 'Alter Runnerinput bleibt in Reihenfolge und Beträgen bytegleich');
    same(incomeFromRecord({ ...migrated, profile_sonstige_einkuenfte: '9999', profile_planned_inflows_v1: '{' }), entries, 'Altschlüssel werden nach der Übernahme ignoriert');
    same(incomeFromRecord({ ...old, [INCOME_KEY]: writeIncome([]) }), [], 'Eine bereits vorhandene leere neue Liste hat Vorrang');
    for (const amount of [1234.567, 0.1, 123.45]) {
        const data = migrateIncomeRecord({ profile_sonstige_einkuenfte: String(amount) });
        assertEqual(monthlyOtherIncome(incomeFromRecord(data), 2026), amount, 'Übernommene Ganzjahreswerte bleiben ohne Zwischenrundung bytegleich');
        same(incomeFromStorage({ getItem(key) { if (key.startsWith('profile_sonstige') || key.startsWith('profile_planned')) throw new Error('Altschlüssel gelesen'); return data[key] ?? null; } }), incomeFromRecord(data), 'Nach Übernahme liest der Speicheradapter keine Altschlüssel');
    }
    const fixed = { id: 'salary', art: 'sonstige', bezeichnung: 'Gehalt', betragMonat: 4000, ab: '2026-04', bis: '2027-03', anpassung: 'inflation' };
    assertEqual(annualOtherIncome([fixed], 2026), 36000, 'Beginnmonat zählt vollständig');
    assertEqual(annualOtherIncome([fixed], 2027, { baseYear: 2026, inflationPct: 2 }), 12240, 'Endmonat zählt vollständig, Anpassung erst im Folgejahr');
    assertEqual(annualOtherIncome([{ ...fixed, anpassung: 'lohn' }], 2027, { baseYear: 2026, wagePct: 5 }), 12600, 'Lohnanpassung wird getrennt gewählt');
    assertEqual(annualOtherIncome([fixed], 2028), 0, 'Nach dem Ende fließt nichts');
    assertEqual(fixedMonthlyIncome([fixed], '2026-03'), 0, 'Personenkarte zeigt vor Beginn keine festen Einkünfte');
    assertEqual(fixedMonthlyIncome([fixed], '2026-04'), 4000, 'Personenkarte zeigt den tatsächlichen Monatsbetrag');
    assertEqual(projectPersonPension({ profile_rente_monatlich: '1100.75', profile_rentenbeginn: '2026-07-01', [INCOME_KEY]: writeIncome([fixed]) }, 2026).sonstigeEinkuenfte, 3000, 'Balance erhält den Monatsdurchschnitt der festen Zeilen');
    for (const patch of [{ betragMonat: 0 }, { betragMonat: -1 }, { betragMonat: Infinity }, { ab: '2026-13' }, { bis: '2026-03' }, { anpassung: 'fremd' }]) assert(incomeErrors([{ ...fixed, ...patch }]).length > 0, 'Ungültige feste Einkünfte werden abgewiesen');
    for (const key of [INCOME_KEY, INCOME_MIGRATION_KEY, 'profile_rente_bezeichnung']) assert(isProfileScopedKey(key) && isAllowedPersistenceImportKey(key) && isAllowedSnapshotCaptureKey(key), 'Neue Schlüssel werden kopiert, importiert und gesichert');
    const outside = { meta: { id: 'outside', name: 'Synthetische Außenperson', belongsToHousehold: false, updatedAt: '2026-01-01' },
        data: { profile_rente_monatlich: '2222', profile_tagesgeld: '34567.89', depot_tranchen: ' [ ] ',
            profile_sonstige_einkuenfte: '300', profile_planned_inflows_v1: oldList,
            'sim.stressReplay.active.v1': '{ "historisch": true }' } };
    const registry = { version: 1, profiles: { max: { meta: { id: 'max', name: 'Max' }, data: old }, erika: { meta: { id: 'erika', name: 'Erika' }, data: { profile_sonstige_einkuenfte: '200' } }, outside } };
    const s = storage({ ...old, rs_profiles_v1: JSON.stringify(registry), rs_current_profile: 'max', rs_active_profile: 'max' });
    assert(migrateStoredIncome(s).changed, 'Start übernimmt aktive und inaktive Personen');
    const bytes = JSON.stringify(s.records);
    assert(!migrateStoredIncome(s).changed, 'Zweiter Speicherstart schreibt nichts');
    assertEqual(JSON.stringify(s.records), bytes, 'Zweiter Speicherstart ist bytegleich');
    assertEqual(incomeFromRecord(JSON.parse(s.records.rs_profiles_v1).profiles.erika.data)[0].betragMonat, 200, 'Inaktive Person übernimmt ihre eigenen Werte');
    const migratedOutside = JSON.parse(s.records.rs_profiles_v1).profiles.outside;
    same(migratedOutside, { ...outside, data: { ...outside.data,
        [INCOME_KEY]: JSON.stringify({ schemaVersion: 1, entries: [
            { id: 'legacy-sonstige', art: 'sonstige', bezeichnung: 'Sonstige Einkünfte', betragMonat: 300, ab: null, bis: null, anpassung: 'keine' },
            { id: 'legacy-einmalig-1', monat: '2028-01', betrag: 12345.67, bezeichnung: 'Rückzahlung' },
            { id: 'legacy-einmalig-2', monat: '2028-01', betrag: 12345.67, bezeichnung: 'Rückzahlung' }
        ] }), [INCOME_MIGRATION_KEY]: '1' } }, 'EK-1a ergänzt auch außerhalb des Haushalts ausschließlich Liste und Marker aus eigenen Altwerten; alle Altbytes und Metadaten bleiben gleich');
    const broken = storage({ rs_profiles_v1: JSON.stringify({ ...registry, profiles: { ...registry.profiles, erika: { ...registry.profiles.erika, data: { profile_planned_inflows_v1: '{' } } } }), rs_current_profile: 'max', ...old });
    const before = JSON.stringify(broken.records); let error;
    try { migrateStoredIncome(broken); } catch (caught) { error = caught; }
    assert(error && JSON.stringify(broken.records) === before, 'Beschädigte Altlisten schreiben keine halbe Übernahme');

    const records = createMusterHaushaltRecords('2026-10-16');
    const legacy = JSON.parse(records.rs_profiles_v1);
    for (const person of Object.values(legacy.profiles)) { delete person.data[INCOME_KEY]; delete person.data[INCOME_MIGRATION_KEY]; Object.assign(person.data, old); delete person.data.profile_person_schema_version; }
    delete records[INCOME_KEY]; delete records[INCOME_MIGRATION_KEY]; Object.assign(records, old);
    records.rs_profiles_v1 = JSON.stringify(legacy);
    delete records.rs_probelauf_state_v1;
    delete records.probelauf_state_v1;
    assert(validatePersistenceDomainRecords(records).ok, 'Altbestand ohne Personenschema ist importierbar');
    const boot = async source => {
        const store = new Map(Object.entries(source)), snapshots = new Map();
        P.resetPersistenceForTests({ name: 'income', async loadAll() { return Object.fromEntries(store); },
            async saveBatch({ upserts, deletes }) { for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); },
            async listSnapshots() { return [...snapshots.values()].map(({ records, ...meta }) => meta); },
            async readSnapshot(id) { return snapshots.get(id); }, async writeSnapshot(snapshot) { snapshots.set(snapshot.id, structuredClone(snapshot)); return true; }, async deleteSnapshot(id) { return snapshots.delete(id); } });
        await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    };
    await boot(records);
    const backup = JSON.parse(JSON.stringify(buildFullPersistenceBackup()));
    setAppTestDate(null);
    for (const schema of [1, 2]) {
        await boot({});
        const restored = await importFullPersistenceBackup({ ...backup, schemaVersion: schema });
        assert(restored.ok, `Sicherung Schema ${schema} wird importiert: ${restored.message || ''}`);
        migrateStoredIncome();
        same(simulatorOneTimeIncome({ [INCOME_KEY]: persistenceStorage.getItem(INCOME_KEY), [INCOME_MIGRATION_KEY]: '1' }), JSON.parse(oldList).entries, `Sicherung Schema ${schema} übernimmt Altwerte`);
        assert(!migrateStoredIncome().changed, 'Auch nach Import bleibt der zweite Start unverändert');
    }
    const f = await playFixture('tauri', backup.records);
    let controller = await f.boot(); const real = f.realBytes();
    await controller.start(() => ({ source: 'copy', testDate: null })); controller = await f.boot();
    migrateStoredIncome();
    assertEqual(f.realBytes(), real, 'Übernahme im Spielbereich verändert die echten Daten nicht');
    assertEqual(incomeFromRecord({ [INCOME_KEY]: persistenceStorage.getItem(INCOME_KEY) }).length, 3, 'Spielkopie übernimmt alle alten Einkünfte');
    await controller.end(() => true);
} finally { setAppTestDate(null); P.resetPersistenceRuntimeForTests(); }
