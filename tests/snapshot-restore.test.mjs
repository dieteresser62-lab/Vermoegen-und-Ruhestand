import { CONFIG } from '../app/balance/balance-config.js';
import { SnapshotArchive, buildSnapshot } from '../app/shared/snapshot-archive.js';
import { buildSnapshotRestorePlan, previewSnapshotRestore, executeSnapshotRestore, recordIdentity } from '../app/shared/snapshot-restore.js';
import { PersistenceFacade as p, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';

const state = CONFIG.STORAGE.LS_KEY;
const base = () => ({ [state]: '{"inputs":{},"marker":"B ä"}', rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
    a: { meta: { name: 'Person A' }, data: { profile_tagesgeld: '11' } },
    b: { meta: { name: 'Person B' }, data: { profile_tagesgeld: '22' } } } }),
    rs_current_profile: 'a', rs_active_profile: 'a', profile_tagesgeld: '111', balance_expenses_2026: 'new',
    rs_daily_prices_v1: 'bytes: daily', rs_wealth_history_start_v1: 'bytes: start', featureFlags: 'bytes: flags',
    ui_panel_state: 'bytes: panel', overview_last_full_backup_v1: 'bytes: backup', rs_data_backup_summary_v1: 'bytes: summary' });
function target(mode = 'standard', id = 'a') {
    return buildSnapshot({ id: 'target', activeProfileId: id, createdAt: '2026-01-01T12:00:00Z',
        kind: mode === 'full-import' ? 'full-backup-import-recovery' : mode === 'snapshot-full' ? 'person-data-migration-recovery' : 'manual',
        records: { [state]: '{"inputs":{},"marker":"A"}', rs_profiles_v1: JSON.stringify({ version: 1, profiles: { [id]: { meta: { name: 'Vorher' }, data: {} } } }),
            rs_current_profile: id, rs_active_profile: id, profile_tagesgeld: '9', rs_daily_prices_v1: 'old daily',
            rs_wealth_history_start_v1: 'old start', featureFlags: 'old flags' },
        ...(mode !== 'standard' ? { restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback' } } : {}) });
}
async function fixture(snapshot = target()) {
    const records = base(), snapshots = new Map([[snapshot.id, snapshot]]), calls = [], fail = {};
    let targetWrites = 0;
    resetPersistenceForTests({ name: 'synthetic', open: async () => {}, loadAll: async () => ({ ...records }),
        saveBatch: async ({ deletes, upserts }) => {
            calls.push('target'); targetWrites++;
            if (fail.target && (targetWrites === 1 || fail.rollback)) throw new Error('TARGET_WRITE_FAILED');
            deletes.forEach(key => { delete records[key]; }); upserts.forEach(([key, value]) => { records[key] = value; });
        },
        writeSnapshot: async snapshot => { calls.push('snapshot'); if (fail.snapshot) throw new Error('SNAPSHOT_FAILED');
            if (fail.gate) await fail.gate; snapshots.set(snapshot.id, snapshot); if (fail.change) records.rs_current_profile = 'b'; },
        readSnapshot: async id => { calls.push('read'); const saved = snapshots.get(id);
            if (fail.readback && id !== 'target') return { ...saved, label: 'wrong' }; return saved; },
        listSnapshots: async () => [...snapshots.values()], deleteSnapshot: async id => snapshots.delete(id) });
    await p.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return { records, snapshots, fail, calls, guard: createNavigationGuard() };
}

for (const mode of ['standard', 'full-import', 'snapshot-full']) {
    const f = await fixture(target(mode)); const initial = { ...f.records };
    const preview = await previewSnapshotRestore('target');
    assertEqual(f.calls.filter(call => ['target', 'snapshot'].includes(call)).length, 0, `${mode}: Vorschau schreibt weder Archiv noch Bestand`);
    assertEqual(preview.mode, mode, `${mode}: tatsächlicher Umfang erkannt`);
    const result = await executeSnapshotRestore(preview, { guard: f.guard, reload: () => true });
    assertEqual(result.status, 'restored', `${mode}: Restore bestätigt`);
    assertEqual(f.snapshots.size, 2, `${mode}: genau ein neuer Rückkehrpunkt`);
    assertEqual(f.calls.filter(call => call === 'snapshot').length, 1, `${mode}: genau ein Recoverywrite`);
    assert(f.calls.indexOf('snapshot') < f.calls.indexOf('target'), `${mode}: Recovery vor Zielwrite`);
    const scoped = Object.fromEntries(Object.entries(f.records).filter(([key]) => preview.allowKey(key)));
    assertEqual(recordIdentity(scoped), recordIdentity(preview.records), `${mode}: Vorschau und Zielwrite bytegleich`);
    assertEqual(JSON.stringify(f.snapshots.get('target')), JSON.stringify(target(mode)), `${mode}: Zielarchivpunkt bleibt unverändert`);
    if (mode === 'standard') {
        for (const key of ['rs_daily_prices_v1', 'rs_wealth_history_start_v1', 'featureFlags', 'ui_panel_state', 'overview_last_full_backup_v1', 'rs_data_backup_summary_v1'])
            assertEqual(f.records[key], initial[key], 'Standard erhält Byteorakel: ' + key);
        assertEqual(JSON.stringify(JSON.parse(f.records.rs_profiles_v1).profiles.b), JSON.stringify(JSON.parse(initial.rs_profiles_v1).profiles.b), 'Standard erhält anderes Profil einschließlich Rohstrings');
    }
    const recovery = f.snapshots.get(result.recoverySnapshotId);
    const undo = buildSnapshotRestorePlan(recovery, f.records);
    const undoExpected = Object.fromEntries(Object.entries(initial).filter(([key]) => undo.allowKey(key)));
    assertEqual(recordIdentity(undo.records), recordIdentity(undoExpected), `${mode}: Rückkehrpunkt stellt vorherigen Umfang bytegleich bereit`);
    f.guard.revokeNative();
    const undone = await executeSnapshotRestore(await previewSnapshotRestore(recovery.id), { guard: f.guard, reload: () => true });
    assertEqual(undone.status, 'restored', `${mode}: Rückkehrpunkt tatsächlich ausführbar`);
    assertEqual(recordIdentity(f.records), recordIdentity(initial), `${mode}: echte Rückkehr stellt sämtliche Livebytes wieder her`);
    assertEqual(f.snapshots.size, 3, `${mode}: auch Rückkehr erzeugt genau einen weiteren Schutzpunkt`);
}
// Andere Zielperson als vorher aktive Person: B zurücksetzen, anschließend B und Live-A zurückholen.
{
    const f = await fixture(target('standard', 'b')); const initial = { ...f.records };
    const result = await executeSnapshotRestore(await previewSnapshotRestore('target'), { guard: f.guard, reload: () => true });
    const recovery = f.snapshots.get(result.recoverySnapshotId);
    const undo = buildSnapshotRestorePlan(recovery, f.records);
    assertEqual(undo.records.rs_current_profile, 'a', 'Rückkehrpunkt erhält vorher aktive Person A');
    assertEqual(undo.records.rs_profiles_v1, initial.rs_profiles_v1, 'Rückkehrpunkt setzt betroffene Person B zurück, ohne Person A zu ersetzen');
    assertEqual(undo.records.profile_tagesgeld, initial.profile_tagesgeld, 'Rückkehrpunkt erhält vorherige Livewerte von A');
}
for (const failure of ['snapshot', 'readback', 'change', 'target', 'rollback', 'reload', 'asyncReload', 'stale', 'point']) {
    const f = await fixture(); const initial = recordIdentity(f.records);
    const preview = await previewSnapshotRestore('target');
    if (failure === 'rollback') { f.fail.target = true; f.fail.rollback = true; }
    else f.fail[failure] = true;
    if (failure === 'stale') { f.records.profile_tagesgeld = 'external'; p.setItemSync('profile_tagesgeld', 'external'); }
    if (failure === 'point') f.snapshots.set('target', { ...f.snapshots.get('target'), label: 'changed' });
    let result, error;
    try { result = await executeSnapshotRestore(preview, { guard: f.guard, reload: () => {
        if (failure === 'reload') throw new Error('RELOAD_FAILED');
        if (failure === 'asyncReload') return Promise.reject(new Error('ASYNC_RELOAD_FAILED'));
        return true;
    } }); } catch (caught) { error = caught; }
    if (['reload', 'asyncReload'].includes(failure)) assertEqual(result.status, 'reload_required', `${failure}: ehrlich gespeicherter Stand ohne Reload`);
    else assert(error, `${failure}: Fehler sichtbar statt Erfolg`);
    if (['snapshot', 'readback', 'target', 'rollback', 'point'].includes(failure)) assertEqual(recordIdentity(f.records), initial, `${failure}: synthetische Livebytes bleiben unverändert`);
    if (['snapshot', 'readback', 'change', 'stale', 'point'].includes(failure)) assertEqual(f.calls.filter(call => call === 'target').length, failure === 'stale' ? 1 : 0, `${failure}: kein Zielwrite ohne bestätigten Kontext`);
    if (failure === 'target') assertEqual(error.code, 'restore_rolled_back', 'Zielwritefehler bestätigt Rollback');
    if (failure === 'rollback') assertEqual(error.code, 'rollback_failed', 'Rollbackfehler wird nicht als unverändert gemeldet');
    let locked;
    try { p.setItemSync(state, 'stale input'); } catch (caught) { locked = caught; }
    assertEqual(locked?.code, ['reload', 'asyncReload', 'rollback'].includes(failure) ? 'PERSISTENCE_RELOAD_REQUIRED' : undefined, `${failure}: passende Formularsperre`);
}
{
    const f = await fixture(); let release; f.fail.gate = new Promise(resolve => { release = resolve; });
    const plan = await previewSnapshotRestore('target');
    const job = executeSnapshotRestore(plan, { guard: f.guard, reload: () => true });
    for (let i = 0; i < 80; i++) await Promise.resolve();
    assertEqual(await f.guard.prepare(), null, 'Verzögerter Recoverywrite schützt Navigation');
    assertEqual((await executeSnapshotRestore(plan, { guard: f.guard })).status, 'in_flight', 'Doppelklick legt keinen zweiten Punkt an');
    assertEqual(f.calls.filter(call => call === 'target').length, 0, 'Verzögerter Snapshotwrite verhindert vorzeitige Mutation');
    release(); await job;
    assertEqual(f.snapshots.size, 2, 'Nach Verzögerung genau ein Rückkehrpunkt');
}
{
    const f = await fixture(); const originalFlush = p.flush; let release, entered = false;
    const preview = await previewSnapshotRestore('target');
    p.flush = async () => { entered = true; await new Promise(resolve => { release = resolve; }); return true; };
    const job = executeSnapshotRestore(preview, { guard: f.guard, reload: () => true });
    for (let i = 0; i < 80; i++) await Promise.resolve();
    assert(entered, 'Verzögerter Vorflush erreicht');
    assertEqual(f.snapshots.size, 1, 'Vorflush legt keinen verfrühten Punkt an');
    p.flush = originalFlush; release(); await job;
    assertEqual(f.snapshots.size, 2, 'Recovery erst nach Vorflush');
}
{
    const f = await fixture(); const snapshot = f.snapshots.get('target');
    for (const invalid of [{ ...snapshot, activeProfileId: '' }, { ...snapshot, activeProfileId: 'missing' }, { ...snapshot, kind: 'probelauf-before' }]) {
        let error; try { buildSnapshotRestorePlan(invalid, f.records); } catch (caught) { error = caught; }
        assert(error, 'Fehlende Profilzuordnung und Probelauf verhindern generischen Restore');
    }
}
// Echter noch ausstehender Write wird vor dem Vorschau-Read bestätigt.
{
    const f = await fixture();
    p.setItemSync('profile_tagesgeld', '98000');
    const preview = await previewSnapshotRestore('target');
    assertEqual(preview.before.profile_tagesgeld, '98000', 'Vorschau liest den echten bestätigten ausstehenden Write');
    assertEqual(f.records.profile_tagesgeld, '98000', 'Vorschau bestätigt den Write im Backend');
    assertEqual(f.snapshots.size, 1, 'Vorschauflush erzeugt keine Recovery');
    const result = await executeSnapshotRestore(preview, { guard: f.guard, reload: () => true });
    assertEqual(result.status, 'restored', 'Ausstehender Write verursacht keinen falschen Identitätsabbruch');
    assertEqual(f.records.profile_tagesgeld, '9', 'Restore stellt das tatsächliche Ziel her');
    assertEqual(f.snapshots.size, 2, 'Nach Vorschauflush genau eine Recovery');
    assertEqual(f.snapshots.get(result.recoverySnapshotId).records.profile_tagesgeld, '98000', 'Recovery erhält den bestätigten Vorwert');
}
for (const mode of ['false', 'reject']) {
    const f = await fixture(), originalFlush = p.flush;
    let error;
    p.flush = async () => { if (mode === 'reject') throw new Error('SYNTHETIC_FLUSH_FAILED'); return false; };
    try { await previewSnapshotRestore('target'); } catch (caught) { error = caught; }
    finally { p.flush = originalFlush; }
    assert(error, mode + ': fehlgeschlagener Flush liefert keine Vorschau');
    assertEqual(f.calls.length, 0, mode + ': kein Archivread oder Zielwrite vor bestätigtem Flush');
    assertEqual(f.snapshots.size, 1, mode + ': keine Recovery bei Flushfehler');
}
{
    const f = await fixture(), originalFlush = p.flush;
    let release;
    p.setItemSync('profile_tagesgeld', '98000');
    p.flush = async (...args) => { await new Promise(resolve => release = resolve); return originalFlush(...args); };
    const pending = previewSnapshotRestore('target');
    await Promise.resolve();
    assertEqual(f.calls.length, 0, 'Verzögerter Vorschauflush liest nicht vorzeitig');
    p.flush = originalFlush; release();
    assertEqual((await pending).before.profile_tagesgeld, '98000', 'Freigegebener Vorschauflush liest bestätigten Wert');
}
resetPersistenceForTests();
