import { readFileSync } from 'node:fs';
import { createProfile, setProfileVerbundMembership } from '../app/profile/profile-registry.js';
import { importFullPersistenceBackup, buildFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { importProfilesBundle, exportProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { readBalancePersonStatus, readHouseholdPersonStatus } from '../app/shared/person-data-status.js';
import { combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { projectOverview } from '../app/overview/overview-model.js';
const records = createMusterHaushaltRecords('2026-09-01');
const map = new Map(Object.entries(records));
const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key), key: i => [...map.keys()][i], get length() { return map.size; } };
const initial = JSON.stringify([...map]);
let rejected = false; try { createProfile('Dritte Person', { storage }); } catch { rejected = true; }
assert(rejected, 'Zwei Haushaltspersonen: Anlegen abgelehnt');
assertEqual(JSON.stringify([...map]), initial, 'Abgewiesenes Anlegen schreibt nichts');
let registry = JSON.parse(records.rs_profiles_v1);
registry.profiles.third = { meta: { id: 'third', name: 'Dritte Person', belongsToHousehold: false }, data: { profile_person_schema_version: '1' } };
storage.setItem('rs_profiles_v1', JSON.stringify(registry));
const before = JSON.stringify([...map]); rejected = false;
try { setProfileVerbundMembership('third', true, { storage }); } catch { rejected = true; }
assert(rejected, 'Dritte Mitgliedschaft gesperrt');
assertEqual(JSON.stringify([...map]), before, 'Abgewiesene Mitgliedschaft schreibt nichts');
// Einen formal gültigen Altbestand mit drei Mitgliedern konstruieren.
registry.profiles.third.meta.belongsToHousehold = true;
storage.setItem('rs_profiles_v1', JSON.stringify(registry));
for (const read of [readBalancePersonStatus, readHouseholdPersonStatus]) {
    const status = read({ storage, win: null });
    assert(!status.ready && status.href.endsWith('#personen'), 'Altbestand blockiert Rechnung und führt zur Verwaltung');
}
const overview = projectOverview({ registry, activeId: records.rs_current_profile, liveData: records, now: new Date('2026-09-01T12:00:00Z') });
assert(!overview.available && overview.householdLimit, 'Übersicht rechnet Altbestand nicht');
rejected = false; try { combineSimulatorProfiles([{}, {}, {}]); } catch { rejected = true; }
assert(rejected, 'Simulatoraggregation lehnt drei Personen vor Berechnung ab');
const unsafe = JSON.stringify([...map]);
const backup = buildFullPersistenceBackup({ storage });
let accesses = 0;
const untouched = new Proxy({}, { get() { accesses++; throw new Error('Import darf keinen Speicherzugriff starten'); } });
const result = await importFullPersistenceBackup(backup, { persistence: untouched });
assertEqual(accesses, 0, 'Abgelehnter Vollimport berührt weder Speicher noch Archiv');
assert(!result.ok && result.message.includes('mehr als zwei Haushaltspersonen'), 'Vollsicherung mit drei Personen vor jedem Write abgelehnt');
assertEqual(JSON.stringify([...map]), unsafe, 'Speicher bei abgewiesenem Vollimport bytegleich');
const bundle = exportProfilesBundle({ storage });
assert(!importProfilesBundle(bundle, { storage }).ok, 'Profilimport mit drei Personen abgelehnt');
assertEqual(JSON.stringify([...map]), unsafe, 'Profilimport schreibt nichts');
for (const file of ['app/balance/balance-main-profilverbund.js', 'app/simulator/simulator-main-profiles.js']) {
    assert(!readFileSync(new URL('../' + file, import.meta.url), 'utf8').includes('setProfileVerbundMembership'), file + ': keine Mitgliedschaftswrites');
}
