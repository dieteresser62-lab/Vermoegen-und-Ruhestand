import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createIndexedDbAdapter } from '../app/shared/persistence-adapter-indexeddb.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { MemoryWebStorage, fakeAreaIndexedDB } from './helpers/persistence-area-backends.mjs';
import { SnapshotArchive as A } from '../app/shared/snapshot-archive.js';
import { buildSnapshotRestorePlan } from '../app/shared/snapshot-restore.js';
import { overviewScope, storeMonthProvision, OVERVIEW_MONTH_KEY } from '../app/overview/overview-storage.js';
import { captureCashPeople } from '../app/profile/profile-cash-update.js';
import { loadProfileAssetValues, saveProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { PROFILE_CASH_HISTORY_KEY } from '../app/profile/profile-wealth-history.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup, normalizeFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { assertProfileIdentityRecords, bootstrapProfileContext } from '../app/profile/profile-storage.js';
import { exportProfilesBundleToWindowName, importProfilesBundleFromWindowName } from '../app/profile/profile-bundle-io.js';
import { createNewBeginningController } from '../app/data/data-new-beginning.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';

const selected = process.env.QSA_CASE;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function boot(adapter) {
    P.resetPersistenceForTests(adapter);
    P.configurePersistence({ debounceMs: 60000 });
    await P.init({ skipMigration: true, bindLifecycle: false });
}
const seed = () => createMusterHaushaltRecords('2026-10-23');
async function caseRun(id, run) {
    if (selected && selected !== String(id)) return;
    try { await run(); } finally { P.resetPersistenceForTests(); }
}

await caseRun(2, async () => {
    const records = seed(), registry = JSON.parse(records.rs_profiles_v1);
    const ids = Object.keys(registry.profiles), activeId = records.rs_current_profile;
    ids.forEach((id, index) => {
        registry.profiles[id].data.profile_tagesgeld = String((index + 1) * 10000);
        delete registry.profiles[id].data[PROFILE_CASH_HISTORY_KEY];
        delete registry.profiles[id].data[OVERVIEW_MONTH_KEY];
    });
    records.rs_profiles_v1 = JSON.stringify(registry);
    records.profile_tagesgeld = registry.profiles[activeId].data.profile_tagesgeld;
    delete records[PROFILE_CASH_HISTORY_KEY]; delete records[OVERVIEW_MONTH_KEY];
    const local = new MemoryWebStorage();
    Object.entries(records).forEach(([k, v]) => local.setItem(k, v));
    await boot(createLocalStorageAdapter(() => local));
    const scope = overviewScope('household', ids);
    const people = captureCashPeople({ storage, ids, activeId });
    const values = Object.fromEntries(people.map(person => [person.id, person.value * 0.9]));
    assert(await storeMonthProvision({ month: '2026-09', scope, expectedProfileId: activeId, cash: { people, values } },
        { guard: null, isBlocked: () => false, now: () => new Date('2026-10-08T12:00:00Z') }), 'QS-A 2: echter Monatsabschluss gespeichert');
    const [point] = await A.listSnapshots();
    const snapshot = await A.readSnapshot(point.id);
    const plan = buildSnapshotRestorePlan(snapshot, await P.readPersistedRecords());
    const restored = JSON.parse(plan.records.rs_profiles_v1);
    assertEqual(ids.reduce((sum, id) => sum + Number(restored.profiles[id].data.profile_tagesgeld), 0), 30000,
        'QS-A 2: Haushaltsrückkehrpunkt stellt 30.000 statt 28.000 Euro her');
    for (const id of ids) {
        assertEqual(restored.profiles[id].data[OVERVIEW_MONTH_KEY], undefined, 'QS-A 2: jeder neue Monatsbeleg entfernt');
        assertEqual(restored.profiles[id].data[PROFILE_CASH_HISTORY_KEY], undefined, 'QS-A 2: jeder neue Cashverlauf entfernt');
    }
    await P.replaceRecordsTransactional(plan.records, { allowKey: plan.allowKey });
    assertEqual(P.getItemSync('profile_tagesgeld'), records.profile_tagesgeld, 'QS-A 2: aktiver Livebetrag zurück');
});

await caseRun(3, async () => {
    for (const nativeReplace of [true, false]) for (const change of ['outside', 'same', 'delete', 'aba', 'failure']) {
        const indexedDb = fakeAreaIndexedDB(), adapter = createIndexedDbAdapter({ indexedDB: indexedDb });
        await adapter.open();
        await adapter.saveBatch({ upserts: [['profile_tagesgeld', '10000'], ['overview_last_full_backup_v1', 'old']], deletes: [] });
        const entered = deferred(), release = deferred();
        const method = nativeReplace ? 'replaceLiveRecords' : 'saveBatch';
        const original = adapter[method].bind(adapter);
        adapter[method] = async (...args) => { entered.resolve(); await release.promise;
            if (change === 'failure') throw new Error('synthetic-replace-failure');
            return original(...args); };
        if (!nativeReplace) adapter.replaceLiveRecords = undefined;
        await boot(adapter);
        const target = change === 'outside' || change === 'failure' ? 'overview_last_full_backup_v1' : 'profile_tagesgeld';
        const pending = P.replaceLiveRecords({ [target]: 'confirmed' }, { allowKey: key => key === target });
        const outcome = pending.then(() => null, error => error);
        await entered.promise;
        if (change === 'delete') P.removeItemSync('profile_tagesgeld');
        else {
            P.setItemSync('profile_tagesgeld', '12000');
            if (change === 'aba') P.setItemSync('profile_tagesgeld', '10000');
        }
        release.resolve();
        const error = await outcome;
        assertEqual(Boolean(error), change === 'failure', 'QS-A 3: erwartetes Replace-Ergebnis');
        // Anschließender Flush verwendet wieder den normalen Produktionsadapter.
        adapter[method] = original;
        await P.flush();
        const expected = change === 'delete' ? null : change === 'aba' ? '10000' : '12000';
        assertEqual(P.getItemSync('profile_tagesgeld'), expected, 'QS-A 3: spätere Eingabe bleibt im Cache');
        assertEqual((await adapter.loadAll()).profile_tagesgeld ?? null, expected, 'QS-A 3: spätere Eingabe dauerhaft bestätigt');
        assertEqual(P.getDirtyState().dirtyKeys.length + P.getDirtyState().deletedKeys.length, 0, 'QS-A 3: bestätigter Puffer leer');
    }
});

await caseRun(4, async () => {
    const records = seed(), registry = JSON.parse(records.rs_profiles_v1);
    records.profile_tagesgeld = '1234,56';
    registry.profiles[records.rs_current_profile].data.profile_tagesgeld = '1234,56';
    records.rs_profiles_v1 = JSON.stringify(registry);
    const backup = buildFullPersistenceBackup({ storage: { exportAllSync: () => ({ records }) } });
    assert(normalizeFullPersistenceBackup(backup).ok, 'QS-A 4: gültige Sicherung mit Dezimalkomma akzeptiert');
    const local = new MemoryWebStorage(); Object.entries(records).forEach(([k,v]) => local.setItem(k,v));
    const values = loadProfileAssetValues(local);
    assertEqual(values.tagesgeld, 1234.56, 'QS-A 4: Vermögensmanager liest akzeptierten Betrag verlustfrei');
    saveProfileAssetValues({ ...values, renteBezeichnung: 'Synthetische Bezeichnung' }, local);
    assertEqual(local.getItem('profile_tagesgeld'), '1234.56', 'QS-A 4: anderes Feld speichern erhält Tagesgeld');
    local.setItem('profile_tagesgeld', 'unlesbar');
    const unreadable = loadProfileAssetValues(local);
    assert(Number.isNaN(unreadable.tagesgeld), 'QS-A 4: unlesbarer nichtleerer Geldbetrag bleibt unlesbar');
    let rejected = false;
    try { saveProfileAssetValues({ ...unreadable, renteBezeichnung: 'Andere Bezeichnung' }, local); } catch { rejected = true; }
    assert(rejected, 'QS-A 4: unlesbarer Geldbetrag sperrt Speichern anderer Felder');
    assertEqual(local.getItem('profile_tagesgeld'), 'unlesbar', 'QS-A 4: unlesbarer Rohbetrag bleibt erhalten');
});

await caseRun(5, async () => {
    const indexedDb = fakeAreaIndexedDB({ strictTransactions: true });
    const adapter = createIndexedDbAdapter({ indexedDB: indexedDb }); await adapter.open();
    const key = 'ruhestandsmodell_snapshot_2026-01-20T11:48:21.709Z--Muster';
    const legacy = { snapshotType: 'full-localstorage', timestamp: '2026-01-20T11:48:21.709Z', localStorage: { ...seed(), profile_tagesgeld: '30000' } };
    await adapter.saveBatch({ upserts: [[key, JSON.stringify(legacy)]], deletes: [] });
    const report = await adapter.migrateLegacySnapshotsIfNeeded();
    assertEqual(report.errors.length, 0, 'QS-A 5: Migration ohne abgelaufene Transaktion');
    assertEqual(report.migratedCount, 1, 'QS-A 5: alter Snapshot migriert');
    const points = await adapter.listSnapshots();
    assertEqual(points.length, 1, 'QS-A 5: altes Archiv sichtbar');
    assertEqual((await adapter.readSnapshot(points[0].id)).records.profile_tagesgeld, '30000', 'QS-A 5: alter Bestand erhalten');
    // Auch readSnapshot muss nach Migration einen frischen Store benutzen.
    const secondDb = fakeAreaIndexedDB({ strictTransactions: true });
    const second = createIndexedDbAdapter({ indexedDB: secondDb }); await second.open();
    await second.saveBatch({ upserts: [[key, JSON.stringify(legacy)]], deletes: [] });
    assertEqual((await second.readSnapshot(key)).records.profile_tagesgeld, '30000', 'QS-A 5: direkter alter Snapshotabruf');
    second.migrateLegacySnapshotsIfNeeded = async () => ({ errors: [{ key, message: 'synthetischer Migrationsfehler' }] });
    let rejected = false; try { await second.listSnapshots(); } catch { rejected = true; }
    assert(rejected, 'QS-A 5: Migrationsfehler erscheint nicht als leeres Archiv');
});

await caseRun(6, async () => {
    const records = seed(), ids = Object.keys(JSON.parse(records.rs_profiles_v1).profiles);
    records.rs_current_profile = ids[0]; records.rs_active_profile = ids[1];
    const payload = buildFullPersistenceBackup({ storage: { exportAllSync: () => ({ records }) } });
    const local = new MemoryWebStorage(); local.setItem('profile_tagesgeld', '777');
    await boot(createLocalStorageAdapter(() => local));
    const result = await importFullPersistenceBackup(payload, { confirm: () => true, guard: createNavigationGuard() });
    assert(!result.ok, 'QS-A 6: widersprüchliche IDs vor Vollimport abgewiesen');
    assertEqual(P.getItemSync('profile_tagesgeld'), '777', 'QS-A 6: bestehender Bestand erhalten');
    assertEqual((await A.listSnapshots()).length, 0, 'QS-A 6: keine unnötige Importsicherung');
    records.rs_active_profile = ids[0];
    assert(normalizeFullPersistenceBackup(buildFullPersistenceBackup({ storage: { exportAllSync: () => ({ records }) } })).ok, 'QS-A 6: gleiche IDs bleiben gültig');
    assertProfileIdentityRecords(JSON.parse(records.rs_profiles_v1), records.rs_current_profile, records.rs_active_profile);
});

await caseRun(7, async () => {
    const local = new MemoryWebStorage(), session = new MemoryWebStorage(), records = seed();
    Object.entries(records).forEach(([k,v]) => local.setItem(k,v));
    const win = { name: '', localStorage: local, sessionStorage: session };
    await boot(createLocalStorageAdapter(() => local));
    assert(exportProfilesBundleToWindowName({ windowRef: win, storage }), 'QS-A 7: altes Seitenpaket angelegt');
    const stale = win.name;
    const controller = createNewBeginningController({ window: win, guard: createNavigationGuard(), navigate: () => { throw new Error('unterbrochene Navigation'); } });
    const result = await controller.execute({ withoutBackup: true, confirmed: true });
    assertEqual(result.status, 'reload_required', 'QS-A 7: Navigation nach erfolgreichem Leeren unterbrochen');
    assert(win.name === '', 'QS-A 7: altes app-eigenes Seitenpaket entfernt');
    assertEqual(P.getItemSync('rs_profiles_v1'), null, 'QS-A 7: Bestand leer');
    // Neue Dokumentgeneration, auch ein versehentlich erneut geliefertes Paket bleibt gesperrt.
    await boot(createLocalStorageAdapter(() => local)); win.name = stale;
    assert(!importProfilesBundleFromWindowName({ windowRef: win, storage }).ok, 'QS-A 7: vollzogener Leerstart sperrt automatischen Altimport');
    bootstrapProfileContext();
    const current = JSON.parse(P.getItemSync('rs_profiles_v1'));
    assert(!current.profiles[records.rs_current_profile], 'QS-A 7: gelöschte Person kehrt nach Start nicht zurück');
    assert(exportProfilesBundleToWindowName({ windowRef: win, storage }), 'QS-A 7: neue Profilübergabe nach Leerstart bleibt möglich');
    assertEqual(session.getItem('rs_profile_handoff_reset_v1'), null, 'QS-A 7: nur eine neue Übergabe hebt den Sitzungsmerker auf');
    win.name = 'fremdes-fenster';
    await P.resetNewBeginningBrowserStorage({ window: win });
    assertEqual(win.name, 'fremdes-fenster', 'QS-A 7: fremder Fenstername bleibt erhalten');
});

await caseRun(8, async () => {
    const records = seed(), registry = JSON.parse(records.rs_profiles_v1);
    const legacyKey = 'ruhestandsmodell_snapshot_2025-01-01T12:00:00.000Z--Alt';
    const historical = registry.profiles[records.rs_current_profile].data;
    historical[legacyKey] = '{"historisch":true}';
    historical.ui_probe = 'historischer Zustand';
    records.rs_profiles_v1 = JSON.stringify(registry);
    records[legacyKey] = JSON.stringify({ snapshotType: 'full-localstorage', localStorage: seed() });
    records.ui_probe = 'alter Browserstand';
    const legacyBackup = { backupType: 'ruhestand-suite-full-persistence-backup', app: 'ruhestand-suite',
        schemaVersion: 1, exportedAt: '2025-01-01T12:00:00Z', recordCount: Object.keys(records).length, localStorage: records };
    const local = new MemoryWebStorage();
    await boot(createLocalStorageAdapter(() => local));
    const result = await importFullPersistenceBackup(legacyBackup, { guard: createNavigationGuard() });
    assert(result.ok, 'QS-A Altstand: Schema-1-Sicherung im ersten Versuch importiert');
    const persisted = await P.readPersistedRecords();
    assert(persisted[legacyKey] === records[legacyKey], 'QS-A Altstand: alter Snapshotkey für anschließende Archivmigration erhalten');
    assertEqual(persisted.ui_probe, undefined, 'QS-A Altstand: alter technischer Livekey ausgeschlossen');
    const after = JSON.parse(persisted.rs_profiles_v1).profiles[records.rs_current_profile].data;
    assertEqual(after[legacyKey], historical[legacyKey], 'QS-A Altstand: historischer Snapshotstring in Registry erhalten');
    assertEqual(after.ui_probe, historical.ui_probe, 'QS-A Altstand: historischer technischer Profilkey erhalten');
});
