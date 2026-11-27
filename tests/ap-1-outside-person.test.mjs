// AP-1 [A7]: Personen außerhalb des Haushalts gibt es nicht mehr. Ein gespeichertes `belongsToHousehold: true` oder ein fehlendes
// Feld bleibt gültig. Ein älterer Stand mit `false` gilt beim Lesen als beschädigt und wird nicht geschrieben; eine solche
// Vollsicherung lehnt der Import vor jedem Speicherzugriff ab. Erfundene Daten aus dem Muster Max und Erika.
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup, normalizeFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { loadProfileRegistry, OUTSIDE_PERSON_CODE, OUTSIDE_PERSON_IMPORT_MESSAGE, OUTSIDE_PERSON_RESTORE_POINT_MESSAGE } from '../app/profile/profile-registry.js';
import { buildSnapshot, SNAPSHOT_KINDS } from '../app/shared/snapshot-archive.js';
import { restorePointDamage, buildSnapshotRestorePlan } from '../app/shared/snapshot-restore.js';
import { isAllowedSnapshotRestoreLiveKey } from '../app/shared/persistence-key-policy.js';

const records = createMusterHaushaltRecords('2026-11-26');
const registry = JSON.parse(records.rs_profiles_v1);
const [first, second] = Object.keys(registry.profiles);
const map = new Map(Object.entries(records));
let writes = 0;
const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => { writes++; map.set(key, String(value)); },
    removeItem: key => { writes++; map.delete(key); }, key: i => [...map.keys()][i], get length() { return map.size; } };

// Gespeichertes `true` und fehlendes Feld bleiben gültig.
registry.profiles[first].meta.belongsToHousehold = true;
delete registry.profiles[second].meta.belongsToHousehold;
map.set('rs_profiles_v1', JSON.stringify(registry));
assertEqual(loadProfileRegistry(storage).status, 'valid', 'true und fehlendes Feld bleiben gültig');
assert(normalizeFullPersistenceBackup(buildFullPersistenceBackup({ storage })).ok, 'Gegenprobe: Sicherung ohne Außenperson ist einspielbar');

// Älterer Stand mit einer Person außerhalb des Haushalts: Lesen meldet einen eigenen Code und schreibt nichts.
const outside = structuredClone(registry);
outside.profiles[second].meta.belongsToHousehold = false;
map.set('rs_profiles_v1', JSON.stringify(outside));
writes = 0;
const before = JSON.stringify([...map]);
const loaded = loadProfileRegistry(storage);
assertEqual(loaded.status, 'corrupt', 'Altstand mit Außenperson gilt als beschädigt');
assertEqual(loaded.error?.code, OUTSIDE_PERSON_CODE, 'Eigener Fehlercode für die Außenperson');
assert(loaded.error?.message.includes('außerhalb des Haushalts'), 'Meldung nennt den Grund');
assertEqual(loaded.recovery?.raw, JSON.stringify(outside), 'Rohtext bleibt für die bestehende Profil-Recovery erhalten');
assertEqual(writes, 0, 'Lesen schreibt nichts');
assertEqual(JSON.stringify([...map]), before, 'Lesen verändert keinen Record');

// Vollsicherung mit Außenperson: Import lehnt klar ab, bevor er Speicher oder Archiv berührt.
const backup = buildFullPersistenceBackup({ storage });
let accesses = 0;
const untouched = new Proxy({}, { get() { accesses++; throw new Error('Import darf keinen Speicherzugriff starten'); } });
const result = await importFullPersistenceBackup(backup, { persistence: untouched });
assert(!result.ok, 'Import einer Sicherung mit Außenperson abgelehnt');
assert(result.message.includes(OUTSIDE_PERSON_IMPORT_MESSAGE), `Meldung rät zu einem eigenen Haushalt: ${result.message}`);
assertEqual(accesses, 0, 'Abgelehnter Import berührt weder Speicher noch Archiv');
assertEqual(writes, 0, 'Abgelehnter Import schreibt nichts');
assertEqual(JSON.stringify([...map]), before, 'Speicher nach abgelehntem Import bytegleich');

// AP-1b: Ein Wiederherstellungspunkt mit Außenperson lässt sich nicht zurückholen; die Meldung nennt den Punkt statt einer Sicherung.
const point = buildSnapshot({ id: 'punkt-mit-aussenperson', kind: SNAPSHOT_KINDS.monthlyClosePreMutation, createdAt: '2026-11-01T10:00:00Z',
    records: Object.fromEntries([...map].filter(([key]) => isAllowedSnapshotRestoreLiveKey(key))) });
assertEqual(restorePointDamage(point), OUTSIDE_PERSON_RESTORE_POINT_MESSAGE, 'Punkt mit Außenperson gilt als beschädigt');
let refusal = null;
try { buildSnapshotRestorePlan(point, Object.fromEntries(map)); } catch (error) { refusal = error; }
assert(refusal?.message.includes('Dieser Wiederherstellungspunkt enthält eine Person außerhalb des Haushalts') && !refusal.message.includes('Diese Sicherung'),
    `Zurückholen nennt den Wiederherstellungspunkt: ${refusal?.message}`);
assertEqual(JSON.stringify([...map]), before, 'Geprüfter Punkt verändert keinen Record');
