import { readFileSync } from 'node:fs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { applyProfileManagementAction, validateProfileManagementAction, confirmUnchangedProfileContext, confirmProfileDeletion } from '../app/profile/profile-manager-bindings.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from '../app/shared/snapshot-archive.js';
import { previewSnapshotRestore, executeSnapshotRestore, recordIdentity } from '../app/shared/snapshot-restore.js';
import { downloadFullPersistenceBackup, importFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { isAllowedPersistenceImportKey } from '../app/shared/persistence-key-policy.js';
import { renderManagerPeople, projectManagerProfiles } from '../app/tranches/tranchen-manager-profiles.js';
import { renderManagerProfiles } from '../app/tranches/tranchen-manager-renderer.js';
import { HOUSEHOLD_CURRENT_LIMIT_MESSAGE } from '../app/profile/profile-registry.js';
import { readBalancePersonStatus, readHouseholdPersonStatus } from '../app/shared/person-data-status.js';
import { projectOverview } from '../app/overview/overview-model.js';
import { combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';

async function fixture(members = 2) {
    const records = createMusterHaushaltRecords('2026-09-01', members === 1 ? 'renate' : 'max-erika');
    if (members === 3) {
        const registry = JSON.parse(records.rs_profiles_v1);
        // Altbestand ohne FR-65-Mitgliedsflag bleibt beim Lesen unverändert.
        registry.profiles.legacy = { meta: { id: 'legacy', name: 'Mara Muster' }, data: {} };
        records.rs_profiles_v1 = JSON.stringify(registry);
        records.sim_legacy_followup = 'synthetischer Altwert';
    }
    const points = new Map(), batches = [];
    P.resetPersistenceForTests({ name: 'synthetic', loadAll: async () => ({ ...records }),
        async saveBatch(batch) { batches.push(batch); batch.deletes.forEach(key => delete records[key]); batch.upserts.forEach(([key, value]) => { records[key] = value; }); },
        writeSnapshot: async point => points.set(point.id, point), readSnapshot: async id => points.get(id),
        listSnapshots: async () => [...points.values()], deleteSnapshot: async id => points.delete(id) });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return { records, points, batches };
}
const persisted = () => P.readPersistedRecords(isAllowedPersistenceImportKey);

// Gegenproben E und D: eigener Altbestand bleibt sicherbar und zurückholbar.
{
    const { records, batches, points } = await fixture(3);
    const initial = recordIdentity(records);
    assertEqual(batches.length, 0, '2: Lesen des Altbestands führt keine Schreibmigration aus');
    let file;
    await downloadFullPersistenceBackup({ download: backup => { file = backup; return true; } });
    assert(file && Object.keys(JSON.parse(file.records.rs_profiles_v1).profiles).length === 3, '2/E: Jetzt sichern gelingt mit drei Mitgliedern');
    assertEqual(recordIdentity(Object.fromEntries(Object.entries(records).filter(([key]) => !['overview_last_full_backup_v1','overview_last_full_backup_delivery_v1','rs_data_backup_summary_v1'].includes(key)))), initial, '2/E: Sicherung ändert nur ihre Metadaten');
    let accesses = 0;
    const result = await importFullPersistenceBackup(file, { persistence: new Proxy({}, { get() { accesses++; throw new Error('unerlaubter Zugriff'); } }) });
    assert(!result.ok && result.message.includes('Die Sicherung enthält mehr als zwei Haushaltspersonen.'), '2/E: Dieselbe Datei bleibt beim Import gesperrt');
    assertEqual(accesses, 0, '2/E: Abgewiesener Import greift weder auf Speicher noch Archiv zu');
    // SV-1: Ein Punkt des ganzen Haushalts holt auch einen Altbestand mit drei Mitgliedern bytegleich zurück.
    const before = recordIdentity(await persisted());
    const point = await SnapshotArchive.createSnapshot({ kind: SNAPSHOT_KINDS.monthlyClosePreMutation, label: 'Monatsabschluss 2026-08',
        activeProfileId: records.rs_current_profile, records: SnapshotArchive.captureCurrentRecords({ keys: Object.keys(records), getItem: key => records[key] }) });
    applyProfileManagementAction({ kind: 'rename', profileId: 'legacy', name: 'Mara Neu' }); await P.flush();
    const preview = await previewSnapshotRestore(point.id);
    assertEqual((await executeSnapshotRestore(preview, { reload: () => true })).status, 'restored', '3/D: Drei-Personen-Punkt wird zurückgeholt');
    assertEqual(recordIdentity(await persisted()), before, '3/D: Altpunkt stellt vollständigen Bestand bytegleich wieder her');
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const read of [readBalancePersonStatus, readHouseholdPersonStatus]) assertEqual(read({ storage: persistenceStorage, win: null }).message, HOUSEHOLD_CURRENT_LIMIT_MESSAGE(3), '6: Rechnung nennt eigenen Haushalt statt Datei');
    assertEqual(projectOverview({ registry, activeId: records.rs_current_profile, liveData: records, now: new Date('2026-09-01') }).householdLimit, HOUSEHOLD_CURRENT_LIMIT_MESSAGE(3), '6: Übersicht nennt den eigenen Bestand');
    let message; try { combineSimulatorProfiles([{}, {}, {}]); } catch (error) { message = error.message; }
    assertEqual(message, HOUSEHOLD_CURRENT_LIMIT_MESSAGE(3), '6: Simulatoraggregation nennt den eigenen Bestand');
    const host = { innerHTML: '' };
    renderManagerProfiles({ getElementById: id => id === 'managerHousehold' ? host : null }, projectManagerProfiles(registry, 'muster_a'));
    assert(host.innerHTML.includes(HOUSEHOLD_CURRENT_LIMIT_MESSAGE(3)), '11: Haushaltskarte nennt die konkrete Ursache');
}

// Ein Punkt aus der Zeit vor FR-65 ohne neueren Livekey-Modus bleibt lesbar.
{
    const { records } = await fixture(3);
    const old = await SnapshotArchive.createSnapshot({ kind: 'annual-close-pre-mutation', label: 'Jahresabschluss 2025',
        createdAt: '2025-01-01T12:00:00Z', records: { ...records }, activeProfileId: records.rs_current_profile,
        restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback' } });
    applyProfileManagementAction({ kind: 'rename', profileId: 'legacy', name: 'Mara Neu' }); await P.flush();
    const preview = await previewSnapshotRestore(old.id);
    assertEqual((await executeSnapshotRestore(preview, { reload: () => true })).status, 'restored', '3: Punkt vor FR-65 lässt sich zurückholen');
    assertEqual(JSON.parse(P.getItemSync('rs_profiles_v1')).profiles.legacy.meta.belongsToHousehold, undefined, '3: Altes Profil ohne Mitgliedsfeld bleibt ohne Schreibmigration erhalten');
}

for (const key of ['rs_profiles_v1', 'rs_current_profile', 'rs_active_profile']) {
    await fixture();
    assert(!await confirmUnchangedProfileContext(async () => { P.setItemSync(key, 'anderer Kontext'); return true; }), '7: Dialog verweigert geänderten Kontext: ' + key);
    await fixture();
    assert(!await confirmProfileDeletion('muster_b', async () => { P.setItemSync(key, 'anderer Kontext'); return true; }), '7: Löschdialog verwendet dieselbe Kontextprüfung: ' + key);
}
await fixture();
assert(await confirmUnchangedProfileContext(async () => true), '7: Unveränderter bestätigter Dialog gilt');
{
    const { records, points } = await fixture(1);
    const nodes = Object.fromEntries(['managerPeopleList', 'managerPersonCreateBtn', 'managerPeopleForm', 'managerPersonRenameBtn'].map(id => [id, {}]));
    renderManagerPeople({ getElementById: id => nodes[id] }, records.rs_current_profile);
    assert(nodes.managerPeopleList.innerHTML.includes('disabled title="Ein Haushalt braucht mindestens eine Person."'), '9: Löschen der letzten Person mit sichtbarem Grund gesperrt');
    let failed = false; try { validateProfileManagementAction({ kind: 'delete', profileId: records.rs_current_profile }); } catch { failed = true; }
    assert(failed && points.size === 0, '9: Auch veralteter Dialog kann die letzte Person nicht löschen');
    assert(combineSimulatorProfiles([]).warnings[0].includes('„Personen verwalten“'), '9: Leerer Simulator verweist auf Verwaltung');
}
const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
assert(source('Simulator.html').includes('Haushalt aus Personen &amp; Vermögen') || source('Simulator.html').includes('Haushalt aus Personen & Vermögen'), '8: Simulatorstart erklärt Herkunft');
assert(source('app/simulator/simulator-main-profiles.js').includes("profiles.length === 1 ? 'Person' : 'Personen'"), '8: Laufzeittext unterscheidet eine und zwei Personen');
assert(source('Handbuch.html').includes('Rechnungen bleiben gesperrt'), '3: Handbuch erklärt Zurückholen alter Haushalte');
