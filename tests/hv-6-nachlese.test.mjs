import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { applyProfileManagementAction } from '../app/profile/profile-manager-bindings.js';
import { listProfiles, getProfileData } from '../app/profile/profile-storage.js';
import { migrateStoredIncome } from '../app/profile/profile-income-migration.js';
import { INCOME_KEY, INCOME_MIGRATION_KEY, writeIncome } from '../app/profile/profile-income.js';
import { readHouseholdPersonStatus, readBalancePersonStatus } from '../app/shared/person-data-status.js';
import { EXPENSES_STORAGE_KEY } from '../app/balance/balance-expenses-storage.js';
import { WEALTH_CAPTURES_KEY } from '../types/wealth-capture-contract.js';
import { householdBackupState } from '../app/data/data-households.js';
import { validateHouseholdRegistry } from '../app/shared/household-registry.js';
import { createFullBackupFilename } from '../app/shared/persistence-backup.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { MemoryWebStorage, fakeAreaIndexedDB, fakeAreaTauri } from './helpers/persistence-area-backends.mjs';

// HV-6 Nachlese (Gutachten 05.11.2026): Nachbesserungen rund um „Mehrere Haushalte“.

async function fresh(records = {}) {
    P.resetPersistenceForTests({ name: 'synthetic-hv-6', loadAll: async () => ({ ...records }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete records[key]); batch.upserts.forEach(([key, value]) => { records[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return records;
}
const names = () => listProfiles().map(profile => profile.name).join(',');

// 1. Falle „Default“: Die erste angelegte Person ersetzt das unberührte „Default“, statt es zu ergänzen.
{
    await fresh();
    assertEqual(names(), 'Default', 'Leerer Bereich beginnt mit „Default“');
    applyProfileManagementAction({ kind: 'create', name: 'Anna' });
    assertEqual(names(), 'Anna', 'Erste Person benennt „Default“ um, kein Zwei-Personen-Haushalt');
    applyProfileManagementAction({ kind: 'create', name: 'Ben' });
    assertEqual(names(), 'Anna,Ben', 'Jede weitere Person wird ergänzt');
}
// 1b. DP-1: Wie nach einem echten Start und Seitenbesuchen (Probe im Browser 06.11.2026). Start-Übernahme der
// Einkünfte, Inflationsmarke der Balance und Ergebnisspeicher des Simulators machen „Default“ nicht zur echten Person.
const BOOKKEEPING = 'migration_v29_inflation_sanitized,overview_simulation_summary_v1,profile_einkuenfte_migration_v1,profile_einkuenfte_v1,profile_person_schema_version';
async function startedDefault(extra = {}) {
    await fresh();
    for (const [key, value] of Object.entries(extra)) P.setItemSync(key, value);
    migrateStoredIncome();
    P.setItemSync('profile_person_schema_version', '1');
    P.setItemSync('migration_v29_inflation_sanitized', '1');
    P.setItemSync('overview_simulation_summary_v1', JSON.stringify({ version: 1, entries: {} }));
    await P.flush();
    names(); // Registry steht danach wie nach dem Start.
}
{
    await startedDefault();
    assertEqual(Object.keys(getProfileData('default')).sort().join(','), BOOKKEEPING,
        'Gestartetes „Default“ trägt die Verwaltungseinträge wie im echten Start');
    assertEqual(readHouseholdPersonStatus().status, 'demo', 'Unberührtes „Default“ bleibt Demobetrieb');
    const before = JSON.stringify(getProfileData('default'));
    applyProfileManagementAction({ kind: 'create', name: 'Anna' });
    assertEqual(names(), 'Anna', 'Nach echtem Start ersetzt die erste Person „Default“');
    assertEqual(listProfiles()[0].id, 'default', 'Kennung bleibt erhalten');
    assertEqual(JSON.stringify(getProfileData('default')), before, 'Gespeicherte Werte bleiben unverändert');
    // Gutachten DP Befund 4: Die umbenannte Person wird gewöhnlich geprüft, nicht als Demo übergangen.
    for (const [page, read] of [['Simulator', readHouseholdPersonStatus], ['Balance', readBalancePersonStatus]]) {
        const status = read();
        assert(status.status === 'missing' && status.ready === false, `${page} fragt bei „Anna“ nach fehlenden Personendaten`);
    }
}
// Gutachten DPN Befund 1: Gespeicherte Werte zählen, auch wenn live eine leere Liste steht.
const storedOnly = patch => {
    const registry = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
    Object.assign(registry.profiles.default.data, patch);
    persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
};
// Gutachten DP Befunde 1–3 und 5: Jeder eigene Wert hält „Default“ als eigene Person, auch wenn er nur live
// oder außerhalb der Personendaten steht. Ob das Anlegen dabei gelingt oder abgelehnt wird, ist hier gleich.
const valued = [
    ['Altangabe Einkünfte', () => startedDefault({ profile_sonstige_einkuenfte: '300' })],
    ['Monatsabschluss', () => startedDefault({ overview_month_provision_v1: JSON.stringify({ version: 1, entries: {} }) })],
    ['Live-Tagesgeld nach angelegter Registry', async () => { await startedDefault(); P.setItemSync('profile_tagesgeld', '1234.00'); await P.flush(); }],
    ['Live-Geburtsdatum nach angelegter Registry', async () => { await startedDefault(); P.setItemSync('profile_geburtsdatum', '1960-03-01'); await P.flush(); }],
    ['neue Einkünfteliste mit Eintrag', async () => { await startedDefault(); P.setItemSync(INCOME_KEY, writeIncome([{ id: 'e1', art: 'sonstige',
        bezeichnung: 'Sonstige Einkünfte', betragMonat: 300, ab: null, bis: null, anpassung: 'keine' }])); await P.flush(); }],
    ['fremde Übernahme-Marke', async () => { await startedDefault(); P.setItemSync(INCOME_MIGRATION_KEY, '2'); await P.flush(); }],
    ['beschädigte Einkünfteliste', async () => { await startedDefault(); P.setItemSync(INCOME_KEY, '{kaputt'); await P.flush(); }],
    ['Marke mit leerer Einkünfteliste', async () => { await startedDefault(); P.setItemSync(INCOME_KEY, ''); await P.flush(); }],
    ['Marke ohne Einkünfteliste', async () => { await startedDefault(); persistenceStorage.removeItem(INCOME_KEY); await P.flush(); }],
    ['gespeicherten Einkünften bei leerer Live-Liste', async () => { await startedDefault(); storedOnly({ [INCOME_KEY]: writeIncome([{ id: 'e1',
        art: 'sonstige', bezeichnung: 'Sonstige Einkünfte', betragMonat: 300, ab: null, bis: null, anpassung: 'keine' }]) }); await P.flush(); }],
    ['gespeicherter beschädigter Liste bei leerer Live-Liste', async () => { await startedDefault(); storedOnly({ [INCOME_KEY]: '{kaputt' }); await P.flush(); }],
    ['Ausgaben', async () => { await startedDefault(); P.setItemSync(EXPENSES_STORAGE_KEY, JSON.stringify({})); await P.flush(); }],
    ['erfasste Vermögensstände', async () => { await startedDefault(); P.setItemSync(WEALTH_CAPTURES_KEY, JSON.stringify({})); await P.flush(); }]
];
for (const [label, prepare] of valued) {
    await prepare();
    try { applyProfileManagementAction({ kind: 'create', name: 'Ben' }); } catch { /* Ablehnung ist hier auch richtig. */ }
    assert(listProfiles().some(profile => profile.id === 'default' && profile.name === 'Default'), `„Default“ mit ${label} wird nicht umbenannt`);
}
// Gutachten DPN Befund 6: Ein Lesefehler bei der Schlüsselsuche führt nicht zum Umbenennen.
{
    await startedDefault();
    const key = persistenceStorage.key;
    persistenceStorage.key = () => { throw new Error('synthetischer Lesefehler'); };
    try { applyProfileManagementAction({ kind: 'create', name: 'Ben' }); } catch { /* Ablehnung ist hier auch richtig. */ }
    finally { persistenceStorage.key = key; }
    assert(listProfiles().some(profile => profile.id === 'default' && profile.name === 'Default'), '„Default“ bei Lesefehler wird nicht umbenannt');
}
// 2. Ein „Default“ mit eigenen Werten bleibt erhalten; dann wird ergänzt.
{
    await fresh({ rs_profiles_v1: JSON.stringify({ version: 1, profiles: { default: {
        meta: { id: 'default', name: 'Default', belongsToHousehold: true }, data: { profile_person_schema_version: '1', profile_geburtsdatum: '1960-03-01' } } } }),
        rs_current_profile: 'default' });
    applyProfileManagementAction({ kind: 'create', name: 'Clara' });
    assertEqual(names(), 'Default,Clara', '„Default“ mit Werten wird nicht stillschweigend umbenannt');
}
// 3. Sicherungsstand je Haushalt: nie gesichert und alt sind Warnungen, frisch nicht.
{
    const now = new Date(2026, 10, 5, 12, 0);
    assertEqual(JSON.stringify(householdBackupState(null, now)), JSON.stringify({ text: 'noch nie', warning: true }), 'Nie gesichert warnt');
    assertEqual(householdBackupState(new Date(2026, 10, 5, 9, 0).toISOString(), now).text, 'heute', 'Heute gesichert');
    assertEqual(householdBackupState(new Date(2026, 10, 4, 9, 0).toISOString(), now).text, 'vor 1 Tag', 'Gestern gesichert');
    const old = householdBackupState(new Date(2026, 9, 1, 9, 0).toISOString(), now);
    assert(old.text === 'vor 35 Tagen' && old.warning, 'Älter als 30 Tage warnt');
    assert(!householdBackupState(new Date(2026, 9, 30, 9, 0).toISOString(), now).warning, 'Eine Woche alt warnt nicht');
}
// 4. Testlücke Gutachten: Die Oberfläche schickt bei jedem Schreiben in der Windows-App die Generation mit.
{
    const local = new MemoryWebStorage(), session = new MemoryWebStorage(), tauri = fakeAreaTauri();
    const window = { localStorage: local, sessionStorage: session, name: '', __TAURI__: {} };
    const writes = [];
    const invoke = async (command, args = {}) => { if (['save_app_state', 'delete_play_state', 'quarantine_app_state'].includes(command)) writes.push([command, args]); return tauri.invoke(command, args); };
    const options = { window, localStorage: local, indexedDB: fakeAreaIndexedDB(), invoke, installLifecycleHooks: false };
    const restart = async () => { P.resetPersistenceRuntimeForTests(); await P.init(options); };
    await restart();
    P.setItemSync('profile_tagesgeld', '100.00'); await P.flush();
    await P.createHousehold('Probe');
    await restart();
    P.setItemSync('profile_tagesgeld', '200.00'); await P.flush();
    await P.activatePlayArea({ source: 'copy', records: await P.readRealRecords(), snapshots: [] });
    await restart();
    await P.discardPlayArea();
    await restart();
    // Codex HV6-2: auch Wiederherstellungspunkte (echt und Spiel) und Quarantäne.
    const point = SnapshotArchive.buildSnapshot({ id: 'hv6-punkt', activeProfileId: 'default', createdAt: '2026-11-05T12:00:00.000Z', records: { profile_tagesgeld: '200.00' } });
    await P.writeSnapshot(point);
    await P.activatePlayArea({ source: 'copy', records: await P.readRealRecords(), snapshots: [] });
    await restart();
    await P.writeSnapshot(SnapshotArchive.buildSnapshot({ id: 'hv6-spiel', activeProfileId: 'default', createdAt: '2026-11-05T12:00:00.000Z', records: { profile_tagesgeld: '1.00' } }));
    await P.discardPlayArea();
    await restart();
    await P.switchHousehold('h1');
    tauri.files.set('live', '{kaputt');
    await restart().catch(() => {});
    const targets = new Set(writes.map(([command, args]) => `${command}:${args.target || 'live'}`));
    for (const needed of ['save_app_state:snapshots', 'save_app_state:spielsnapshots', 'quarantine_app_state:live'])
        assert(targets.has(needed), `Prüfung erreicht ${needed}`);
    const missing = writes.filter(([, args]) => !Number.isSafeInteger(args.expectedGeneration)).map(([command, args]) => `${command}:${args.target || 'live'}`);
    assert(writes.length >= 4, 'Es wurde mehrfach geschrieben');
    assertEqual(missing.join(','), '', 'Jeder Schreibbefehl trägt die Generation');
}
// 5. Testlücke Gutachten: doppelte Haushaltskennungen machen das Verzeichnis ungültig.
{
    const entry = { id: 'abc123def456', name: 'Zwei', createdAt: '2026-11-05T10:00:00.000Z' };
    let rejected = false;
    try { validateHouseholdRegistry(JSON.stringify({ version: 1, active: 'h1', generation: 2, households: [{ id: 'h1', name: '', createdAt: null }, entry, { ...entry, name: 'Drei' }] })); }
    catch { rejected = true; }
    assert(rejected, 'Doppelte Kennung wird abgewiesen');
}
// 6. Vollsicherung nennt bei mehreren Haushalten den Haushalt im Dateinamen; ohne Namen wie bisher.
{
    const date = new Date('2026-11-05T12:13:14Z');
    assert(createFullBackupFilename(date).startsWith('ruhestand-suite-full-backup-2026-11-05_'), 'Ein Haushalt: Dateiname wie bisher');
    assert(createFullBackupFilename(date, 'Testkind M.').startsWith('ruhestand-suite-full-backup-Testkind-M-2026-11-05_'), 'Mehrere Haushalte: Name im Dateinamen');
}
P.resetPersistenceRuntimeForTests();
P.resetPersistenceForTests();
