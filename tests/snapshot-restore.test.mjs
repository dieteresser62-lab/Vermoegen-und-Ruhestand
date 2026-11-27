// SV-1: Zurückholen setzt immer den ganzen Haushalt auf den Stand des Punkts, atomar und mit Punkt „Vor dem Zurückholen“.
// Nur synthetische Daten: Musterhaushalt Max und Erika, Testdatum 2026-10-02.
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS as K, IMPORT_POINT_LABELS } from '../app/shared/snapshot-archive.js';
import { buildSnapshotRestorePlan, previewSnapshotRestore, executeSnapshotRestore, restoreSnapshotById } from '../app/shared/snapshot-restore.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PROBELAUF_STATE_KEY } from '../app/shared/persistence-key-policy.js';

async function boot(seed, { failWrite = false } = {}) {
    const values = { ...seed }, points = new Map();
    const adapter = { name: 'sv1-restore', async loadAll() { return { ...values }; },
        async saveBatch({ upserts, deletes }) {
            if (failWrite && upserts.some(([key]) => key === 'profile_tagesgeld')) throw new Error('SYNTHETIC_RESTORE_WRITE');
            deletes.forEach(key => delete values[key]); upserts.forEach(([key, value]) => { values[key] = value; });
        },
        async writeSnapshot(point) { points.set(point.id, structuredClone(point)); }, async readSnapshot(id) { return structuredClone(points.get(id)); },
        async listSnapshots() { return [...points.values()].map(({ records, ...entry }) => entry); }, async deleteSnapshot(id) { points.delete(id); } };
    resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return { values, points };
}
const capture = values => SnapshotArchive.captureCurrentRecords({ keys: Object.keys(values), getItem: key => values[key] });

// 1 · Ganzer Haushalt: beide Personen, Plan und Ausgaben kommen zurück; Tageskurse und technische Werte bleiben.
{
    const seed = { ...createMusterHaushaltRecords('2026-10-02'), rs_daily_prices_v1: '{"version":1,"symbols":{}}', ui_probe: 'offen' };
    const { values, points } = await boot(seed);
    const saved = await SnapshotArchive.createSnapshot({ id: 'monat', kind: K.monthlyClosePreMutation, label: 'Monatsabschluss 2026-09',
        activeProfileId: values.rs_current_profile, records: capture(values) });
    const registry = JSON.parse(values.rs_profiles_v1);
    for (const profile of Object.values(registry.profiles)) profile.data.profile_tagesgeld = '1';
    P.setItemSync('rs_profiles_v1', JSON.stringify(registry)); P.setItemSync('profile_tagesgeld', '1');
    P.setItemSync('household_plan_v1', '{"version":1,"entries":{}}'); P.setItemSync('rs_daily_prices_v1', '{"version":1,"symbols":{"NEU":{}}}');
    await P.flush();
    const result = await restoreSnapshotById(saved.id, { reload: () => {} });
    assertEqual(result.status, 'restored', 'Ganzer Haushalt zurückgeholt');
    assertEqual(values.rs_profiles_v1, seed.rs_profiles_v1, 'Beide Personen kommen bytegleich zurück');
    assertEqual(values.profile_tagesgeld, seed.profile_tagesgeld, 'Live-Tagesgeld der aktiven Person zurück');
    assertEqual(values.household_plan_v1, seed.household_plan_v1, 'Haushaltsplan kommt mit zurück');
    assertEqual(values.rs_daily_prices_v1, '{"version":1,"symbols":{"NEU":{}}}', 'Tageskurse bleiben auf dem heutigen Stand');
    assertEqual(values.ui_probe, 'offen', 'Technische Einstellungen bleiben');
    const undo = points.get(result.recoverySnapshotId);
    assertEqual(undo.kind, K.fullBackupImportRecovery, 'Vorher entsteht ein Punkt der Art „vor dem Einspielen“');
    assertEqual(undo.label, IMPORT_POINT_LABELS.restore, 'Punkt heißt „Vor dem Zurückholen“');
    assertEqual(JSON.parse(undo.records.rs_profiles_v1).profiles[values.rs_current_profile].data.profile_tagesgeld, '1', 'Punkt hält den ersetzten Stand');
    assertEqual(points.get('monat').label, 'Monatsabschluss 2026-09', 'Quellpunkt bleibt im Archiv');
}
// 2 · Atomar: scheitert das Ersetzen, bleibt der heutige Stand; der Punkt „Vor dem Zurückholen“ ist dann schon da.
{
    const seed = createMusterHaushaltRecords('2026-10-02');
    const changed = { ...seed, profile_tagesgeld: '777' };
    const { values } = await boot(changed, { failWrite: true });
    const saved = await SnapshotArchive.createSnapshot({ id: 'alt', kind: K.annualClosePreMutation, label: 'Max', activeProfileId: seed.rs_current_profile, records: capture(seed) });
    let error;
    try { await restoreSnapshotById(saved.id, { reload: () => {} }); } catch (caught) { error = caught; }
    assert(error, 'Gescheitertes Ersetzen wird gemeldet');
    assertEqual(JSON.stringify(Object.entries(values).sort()), JSON.stringify(Object.entries(changed).sort()), 'Gescheitertes Ersetzen lässt den heutigen Stand bytegleich');
    assert(error.recoverySnapshotId, 'Fehler nennt den schon angelegten Punkt vor dem Zurückholen');
}
// 3 · Nur sichtbare Arten lassen sich zurückholen; im Spielbereich ist Zurückholen gesperrt.
{
    const seed = createMusterHaushaltRecords('2026-10-02');
    await boot(seed);
    for (const kind of [K.internalRecovery, K.probelaufBefore, 'manual', 'profile-management-before']) {
        let refused = false;
        try { buildSnapshotRestorePlan(SnapshotArchive.buildSnapshot({ kind, records: capture(seed) }), seed); } catch { refused = true; }
        assert(refused, kind + ': nicht über Daten & Sicherung zurückholbar');
    }
    const { values } = await boot({ ...seed, [PROBELAUF_STATE_KEY]: '{"version":2,"active":true}' });
    const saved = await SnapshotArchive.createSnapshot({ id: 'spiel', kind: K.monthlyClosePreMutation, records: capture(seed) });
    let blocked = false;
    try { await previewSnapshotRestore(saved.id); } catch (error) { blocked = /Spielbereich/.test(error.message); }
    assert(blocked && values[PROBELAUF_STATE_KEY], 'Im Spielbereich ist Zurückholen gesperrt');
}
// 4 · Aufbewahrung: Zurückholen kürzt die Punkte vor dem Einspielen auf drei; der gerade benutzte Quellpunkt bleibt zusätzlich.
{
    const seed = createMusterHaushaltRecords('2026-10-02');
    const { points } = await boot(seed);
    for (const day of [1, 2, 3, 4]) await SnapshotArchive.createSnapshot({ id: `einspielen-${day}`, kind: K.fullBackupImportRecovery,
        createdAt: `2026-10-0${day}T12:00:00.000Z`, records: capture(seed) });
    const preview = await previewSnapshotRestore('einspielen-1');
    const result = await executeSnapshotRestore(preview, { reload: () => {} });
    assertEqual(result.status, 'restored', 'Ältester Punkt vor dem Einspielen wird zurückgeholt');
    const kept = [...points.values()].filter(point => point.kind === K.fullBackupImportRecovery).map(point => point.id).sort();
    assertEqual(kept.join(','), ['einspielen-1', 'einspielen-3', 'einspielen-4', result.recoverySnapshotId].sort().join(','), 'Kürzung auf drei schützt den gerade benutzten Quellpunkt');
}
