import { exportProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { SnapshotArchive as A, SNAPSHOT_KINDS } from '../app/shared/snapshot-archive.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { createProbelaufController, PROBELAUF_STATE_KEY as KEY, PROBELAUF_SESSION_KEYS, validateProbelaufState } from '../app/shared/probelauf-state.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { isAllowedPersistenceImportKey, isAllowedSnapshotCaptureKey, isProbelaufRecordKey } from '../app/shared/persistence-key-policy.js';
import { isProfileScopedKey } from '../app/profile/profile-key-policy.js';
import { buildRecoveryPersistenceBackup, buildFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { PLAN_DEFAULTS, HOUSEHOLD_PLAN_KEY, planScope, buildPlanRecord, assertHouseholdPlanRecord } from '../app/profile/household-plan.js';
import { ANNUAL_PLAN_RECORD_KEY, annualPlanEntryKey, assertAnnualPlanRecord } from '../app/profile/annual-plan-record.js';

const equal = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
async function rejects(fn, message) { let error; try { await fn(); } catch (cause) { error = cause; } assert(Boolean(error), message); return error; }
const storage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), key: i => [...values.keys()][i] ?? null, get length() { return values.size; } };
};
function separateAdapter(records, name) {
    const points = new Map(), values = { ...records }, events = [];
    return { name, values, points, events, fail: null,
        async loadAll() { events.push('read'); if (this.fail === 'read') throw new Error('read'); return { ...values }; },
        async saveBatch({ deletes = [], upserts = [] }) { events.push(upserts.some(([key]) => key === KEY) ? `state:${JSON.parse(upserts.find(([key]) => key === KEY)[1]).phase}` : 'save'); if (this.fail === 'save') throw new Error('save'); deletes.forEach(key => delete values[key]); upserts.forEach(([key, value]) => values[key] = value); },
        async listSnapshots() { return [...points.values()].map(({ records, ...entry }) => entry); },
        async readSnapshot(id) { events.push('snapshot-read'); const point = points.get(id); if (!point) throw new Error('missing'); return structuredClone(point); },
        async writeSnapshot(point) { events.push('snapshot-write'); if (this.fail === 'snapshot') throw new Error('snapshot'); points.set(point.id, structuredClone(point)); },
        async deleteSnapshot(id) { if (this.fail === 'cleanup') throw new Error('cleanup'); points.delete(id); }
    };
}
const win = { location: { href: 'http://localhost/index.html?probelauf=1' } };
const selection = () => ({ source: 'copy', testDate: '2027-01-31' });
async function boot(adapter) { P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false }); setAppTestDate(null); }
const controller = (session, options = {}) => createProbelaufController({ win, session, reload: () => {}, restoreReload: () => {}, ...options });
const originalScope = planScope('household', ['a', 'b']);
const originalPlan = buildPlanRecord(null, [{ scope: originalScope, values: structuredClone(PLAN_DEFAULTS) }], { now: () => new Date('2026-01-01') }).record;
const outcome = { monthlyWithdrawal: 1500, monthlyBudget: 3000, action: { type: 'NONE', title: 'Kein Handlungsbedarf' }, liquidityBefore: 100, liquidityAfter: 100, marketPhase: 'Normal', flexRate: 100 };
const annual = { year: 2026, scope: originalScope, periodId: 'calendar-year:2026', committedAt: '2025-12-31T12:00:00Z', recommended: outcome,
    adopted: { ...outcome, snapshot: { plan: structuredClone(PLAN_DEFAULTS), inflation: 2, ageByPerson: { a: 67, b: 64 } } }, adjusted: false, adjustedFields: [] };
const originals = {
    [HOUSEHOLD_PLAN_KEY]: JSON.stringify(originalPlan, null, 2),
    [ANNUAL_PLAN_RECORD_KEY]: JSON.stringify({ version: 1, entries: { [annualPlanEntryKey(2026, originalScope)]: annual } }, null, 2),
    rs_profiles_v1: '{ "version": 1, "profiles": {"a": {"meta": {"name": "A"}, "data": {}}, "b": {"meta": {"name": "B"}, "data": {"profile_tagesgeld": "2"}}} }',
    rs_current_profile: 'a', rs_active_profile: 'a', [CONFIG.STORAGE.LS_KEY]: '{"lastState":{}}',
    balance_expenses_v1: '{"years":{}}', profile_tagesgeld: '001.20', depot_tranchen: '[ ]',
    profile_cash_history_v1: '{"cash":[]}', profile_wealth_history_lots_v1: '{"lots":{}}',
    overview_balance_summary_v1: '{"summary":1}', overview_simulation_summary_v1: '{"sim":1}',
    rs_daily_prices_v1: '{"prices":{}}', rs_wealth_history_start_v1: '{"version":1,"startDate":"2020-01-01"}',
    overview_last_full_backup_v1: '2026-01-01', featureFlags: '{ "test": false }', ui_panel: 'open'
};
for (const mode of ['indexeddb', 'tauri-json-file', 'localStorage']) {
    const local = storage(); for (const [key, value] of Object.entries({ ...originals, unrelated: 'keep' })) local.setItem(key, value);
    const adapter = mode === 'localStorage' ? createLocalStorageAdapter(local) : separateAdapter({ ...originals, unrelated: 'keep' }, mode);
    await boot(adapter);
    await A.createSnapshot({ id: 'old', label: 'Alter Punkt', records: { profile_tagesgeld: '2' } });
    const old = JSON.stringify(await A.readSnapshot('old'));
    const session = storage(); session.setItem(PROBELAUF_SESSION_KEYS[0], 'vorher');
    let c = controller(session); await c.initialize();
    const result = await c.start(async context => {
        assertEqual(getAppTestDate(), null, 'Auswahl vor Uhrumschaltung');
        const points = await A.listSnapshots();
        assert(points.some(point => point.label === 'Vor Probelauf'), 'Auswahl erst nach dauerhaftem Snapshot');
        assertEqual(P.getItemSync(KEY), null, 'Auswahl vor dauerhafter Startphase');
        assert(context.demoAvailable, 'Musteroption mit Standardloader verfügbar');
        return selection();
    });
    assertEqual(result.status, 'reloaded', `${mode}: Kopie startet`);
    assertEqual(c.action, null, 'Startabschluss entfernt Aktionskennung');
    assertEqual(c.state.phase, 'active', 'Aktive Phase bestätigt');
    assertEqual(getAppTestDate(), '2027-01-31', 'Virtuelle Uhr erst nach Startphase');
    const snapshotId = c.state.snapshotId;
    const savedPoint = await A.readSnapshot(snapshotId);
    for (const key of [HOUSEHOLD_PLAN_KEY, ANNUAL_PLAN_RECORD_KEY]) {
        assertEqual(savedPoint.records[key], originals[key], 'Probelaufpunkt erhält echte Rohbytes: ' + key);
        assert(isProbelaufRecordKey(key) && !isProfileScopedKey(key), 'Globaler Plan-/Belegkey im geschützten Probelaufumfang: ' + key);
    }
    if (adapter.events) {
        const events = adapter.events;
        assert(events.indexOf('snapshot-write') < events.lastIndexOf('snapshot-read'), 'Snapshotwrite vor Readback');
        assert(events.indexOf('state:starting') < events.indexOf('state:active'), 'Startphase vor Aktivierung');
    }
    assert(!JSON.stringify(exportProfilesBundle()).includes(KEY), 'Echter Profilbundleexport enthält keinen Steuerkey');
    assert(!(KEY in P.exportAllSync().records), 'Allgemeiner Export enthält keinen Steuerkey');
    assert(!isAllowedPersistenceImportKey(KEY) && !isAllowedSnapshotCaptureKey(KEY) && !isProfileScopedKey(KEY), 'Steuerkey außerhalb aller Fach-/Profilpolicies');
    assert(!(KEY in A.captureCurrentRecords({ keys: P.keysSync, getItem: P.getItemSync })), 'Fachlicher Snapshot enthält keinen Steuerkey');
    await rejects(() => c.start(selection), 'Doppelter Start abgewiesen');
    // Neues Dokument mit demselben dauerhaften Backend hebt ausschließlich Dokumentlocks auf.
    await boot(adapter); c = controller(session); await c.initialize();
    assertEqual(c.state.snapshotId, snapshotId, 'Aktiver Neustart behält Rückkehrpunkt');
    assertEqual(getAppTestDate(), '2027-01-31', 'Aktiver Neustart setzt virtuelle Uhr');
    await P.replaceRecordsTransactional({ 'sim.stressReplay.active.v1': 'Testworkspace' }, { allowKey: key => key === 'sim.stressReplay.active.v1' });
    assertEqual(P.getItemSync('sim.stressReplay.active.v1'), 'Testworkspace', 'Fachlicher Replayarbeitsstand bleibt im Probelauf bedienbar');
    for (const key of Object.keys(originals)) P.setItemSync(key, `test:${key}`);
    const registry = JSON.parse(originals.rs_profiles_v1);
    registry.profiles.b.data.profile_tagesgeld = '555';
    registry.profiles.new = { meta: { name: 'Testprofil' }, data: { profile_tagesgeld: '444' } };
    P.setItemSync('rs_profiles_v1', JSON.stringify(registry));
    P.setItemSync('sim_added', 'test'); P.setItemSync('profile_gold_ziel_pct', '5');
    await P.flush();
    await A.createSnapshot({ id: 'test-point', label: 'Testabschluss', records: {} });
    await rejects(() => A.deleteSnapshot('old'), 'Ursprünglicher Archivpunkt geschützt');
    await rejects(() => A.deleteSnapshot(snapshotId), 'Rückkehrpunkt geschützt');
    await rejects(() => P.importAll({ records: { [KEY]: 'fremd' } }, { replace: true }), 'Import während aktivem Lauf gesperrt');
    const rejected = await c.end(() => false);
    assertEqual(rejected.status, 'cancelled', 'Verweigerte Rückfrage mutiert nichts');
    assertEqual(rejected.error, undefined, 'Benutzerabbruch enthält keine Speicherwarnung');
    assertEqual(c.action, null, 'Benutzerabbruch entfernt Aktionskennung');
    assertEqual(c.busy, false, 'Benutzerabbruch beendet busy');
    assertEqual(P.getItemSync('sim_added'), 'test', 'Testbestand bei verweigerter Rückfrage erhalten');
    const end = await c.end(() => true);
    assertEqual(end.status, 'reloaded', `${mode}: Beenden lädt geschütztes Ziel`);
    const actual = await P.readPersistedRecords(isProbelaufRecordKey);
    assert(equal(actual, originals), `${mode}: Menge und Rohstrings vollständig bytegleich`);
    for (const key of [HOUSEHOLD_PLAN_KEY, ANNUAL_PLAN_RECORD_KEY]) assertEqual(actual[key], originals[key], `${mode}: Plan-/Belegrohrecord bytegleich zurückgeholt: ` + key);
    assertEqual(P.getItemSync(KEY), null, 'Steuerkey erst nach Restore entfernt');
    assertEqual(getAppTestDate(), null, 'Systemzeit erst nach Restore');
    assertEqual(JSON.stringify(await A.readSnapshot('old')), old, 'Alter Archivpunkt bytegleich');
    const points = await A.listSnapshots();
    assertEqual(points.length, 2, 'Nur alter Punkt und Vor Probelauf bleiben');
    assert(points.some(point => point.id === snapshotId), 'Vor Probelauf bleibt dauerhaft');
    assertEqual(P.getItemSync('unrelated'), 'keep', 'Unzugehöriger Key bleibt unverändert');
    for (const key of PROBELAUF_SESSION_KEYS) assertEqual(session.getItem(key), null, 'Rückkehr entfernt Sitzungssperre: ' + key);
}

{
    const adapter = separateAdapter(originals, 'indexeddb'); await boot(adapter);
    const session = storage();
    for (const key of PROBELAUF_SESSION_KEYS) session.setItem(key, 'alte Sitzung');
    let c = controller(session); await c.initialize(); await c.start(selection);
    await boot(adapter);
    let navigations = 0;
    c = createProbelaufController({ session, win: { location: { ...win.location, async replace(target) {
        navigations++;
        assertEqual(target, 'index.html', 'Probelauf-Ende kehrt zur Übersicht zurück');
        assert(equal(await P.readPersistedRecords(isProbelaufRecordKey), originals), 'Rohbytes vor Navigation vollständig zurückgelesen');
        assertEqual(adapter.values[KEY], undefined, 'Probelauf-Sitzungszustand vor Navigation dauerhaft entfernt');
        assertEqual(getAppTestDate(), null, 'Testdatum vor Navigation entfernt');
        for (const key of PROBELAUF_SESSION_KEYS) assertEqual(session.getItem(key), null, 'Sitzungsrest vor Navigation entfernt: ' + key);
        assertEqual(session.getItem('unrelated'), 'keep', 'Unzugehörige Sitzung bleibt erhalten');
    } } } });
    await c.initialize();
    P.setItemSync('profile_tagesgeld', 'Testbestand'); await P.flush();
    for (const key of PROBELAUF_SESSION_KEYS) session.setItem(key, 'synthetische Sitzung');
    session.setItem('unrelated', 'keep');
    assertEqual((await c.end(() => true)).status, 'reloaded', 'Standard-Rückkehr nach bestätigtem Restore');
    assertEqual(navigations, 1, 'Probelauf-Ende navigiert genau einmal');
}

for (const failure of ['snapshot', 'save', 'read', 'cancel']) {
    const adapter = separateAdapter({ ...originals }, 'indexeddb'); await boot(adapter);
    const c = controller(storage()); await c.initialize(); adapter.fail = failure === 'cancel' ? null : failure;
    let chosen = false;
    if (failure === 'cancel') assertEqual((await c.start(() => { chosen = true; return null; })).status, 'cancelled', 'Dialogabbruch beendet Vorbereitung');
    else await rejects(() => c.start(() => { chosen = true; return selection(); }), `Fehler ${failure} verhindert Start`);
    assert(equal(adapter.values, originals), `${failure}: echte Rohrecords unverändert`);
    assertEqual(getAppTestDate(), null, `${failure}: keine virtuelle Uhr`);
    assertEqual(c.action, null, `${failure}: Aktionskennung nach Fehler oder Abbruch entfernt`);
    assertEqual(c.busy, false, `${failure}: busy nach Fehler oder Abbruch beendet`);
    if (failure === 'snapshot' || failure === 'read') assert(!chosen, `${failure}: keine Auswahl ohne bestätigten Snapshot`);
}
for (const phase of ['starting', 'restoring', 'active']) {
    const adapter = separateAdapter({ ...originals }, 'indexeddb'); await boot(adapter);
    let c = controller(storage()); await c.initialize(); await c.start(selection);
    const stored = { ...c.state, phase };
    adapter.values[KEY] = JSON.stringify(stored); adapter.values.profile_tagesgeld = 'Test';
    await boot(adapter); c = controller(storage(), { win: { location: { href: 'http://localhost/Handbuch.html' } } }); await c.initialize();
    assertEqual(c.blocked, phase !== 'active', `${phase}: Wiederanlauf sperrt halbfertige Fachdaten`);
    if (phase !== 'active') await rejects(() => Promise.resolve(P.setItemSync('profile_tagesgeld', 'Gefahr')), 'Recovery sperrt Fachwrites');
    await c.end(() => true);
    assert(equal(await P.readPersistedRecords(isProbelaufRecordKey), originals), `${phase}: Wiederherstellung wiederholbar`);
}
for (const failure of ['save', 'cleanup', 'missing', 'reload']) {
    const adapter = separateAdapter({ ...originals }, 'indexeddb'); await boot(adapter);
    let c = controller(storage()); await c.initialize(); await c.start(selection);
    const id = c.state.snapshotId;
    await boot(adapter); c = controller(storage(), { restoreReload: () => { if (failure === 'reload') throw new Error('reload'); } }); await c.initialize();
    P.setItemSync('profile_tagesgeld', 'Test'); await P.flush();
    await A.createSnapshot({ id: 'test', records: {} });
    adapter.fail = ['save', 'cleanup'].includes(failure) ? failure : null;
    if (failure === 'missing') adapter.points.delete(id);
    if (failure === 'reload') {
        assertEqual((await c.end(() => true)).status, 'reload_required', 'Reloadfehler bleibt sichtbar');
        assertEqual(P.getItemSync(KEY), null, 'Bestätigter Restore darf Zustand vor Reload entfernen');
    } else {
        await rejects(() => c.end(() => true), `${failure}: Restorefehler wird gemeldet`);
        assertEqual(validateProbelaufState(P.getItemSync(KEY)).snapshotId, id, 'Restorefehler behält Snapshot-ID');
        assert(c.blocked, 'Restorefehler bleibt gesperrt');
        adapter.fail = null;
        if (failure !== 'missing') { await boot(adapter); c = controller(storage()); await c.initialize(); await c.end(() => true); assert(equal(await P.readPersistedRecords(isProbelaufRecordKey), originals), 'Restore nach Fehler idempotent'); }
    }
}
// Außerhalb des Probelaufs ignorieren allgemeine Importe den Steuerkey, auch bei Replace.
const adapter = separateAdapter({ profile_tagesgeld: '10', [KEY]: 'bewahren' }, 'indexeddb'); await boot(adapter);
await P.importAll({ records: { [KEY]: 'fremd', profile_tagesgeld: '20' } }, { replace: true });
assertEqual(P.getItemSync(KEY), 'bewahren', 'Import kann Steuerkey weder setzen noch entfernen');
assert(!(KEY in buildFullPersistenceBackup({ storage: P }).records), 'Vollbackup enthält keinen Steuerkey');
assert(!(KEY in buildRecoveryPersistenceBackup({ storage: P }).records), 'Recoverybackup enthält keinen Steuerkey');

for (const failure of ['snapshot-readback', 'flush-false']) {
    const adapter = separateAdapter({ ...originals }, 'indexeddb'); await boot(adapter);
    const persistence = failure === 'flush-false' ? { ...P, flush: async () => false } : P;
    const archive = failure === 'snapshot-readback' ? { ...A, readSnapshot: async (id, options) => {
        const point = await A.readSnapshot(id, options); return { ...point, records: { ...point.records, profile_tagesgeld: 'tampered' } };
    } } : A;
    const c = controller(storage(), { persistence, archive }); await c.initialize();
    let selected = false;
    await rejects(() => c.start(() => { selected = true; return selection(); }), `${failure}: Start sicher abgewiesen`);
    assert(!selected, `${failure}: keine Auswahl ohne Bestätigung`);
    assert(equal(adapter.values, originals), `${failure}: Ausgangsrecords unverändert`);
}
{
    const adapter = separateAdapter({ ...originals }, 'indexeddb'); await boot(adapter);
    let c = controller(storage()); await c.initialize(); await c.start(selection);
    const id = c.state.snapshotId;
    await boot(adapter);
    const everyday = { location: { href: win.location.href }, __TAURI__: { app: { getIdentifier: async () => 'de.vermoegen-ruhestand.suite' } } };
    c = controller(storage(), { win: everyday });
    await c.initialize();
    assertEqual(getAppTestDate(), '2027-01-31', 'Alltags-Tauri setzt bestätigten aktiven Lauf fort');
    assert(!c.blocked, 'Intakter aktiver Rückkehrpunkt erlaubt Alltagsfortsetzung');
    await boot(adapter); adapter.points.delete(id); c = controller(storage());
    await rejects(() => c.initialize(), 'Fehlender Rückkehrpunkt sperrt aktiven Neustart');
    assertEqual(c.state.snapshotId, id, 'Fehlender Punkt verliert Snapshot-ID nicht');
    assert(c.blocked, 'Fehlender Punkt gibt keine Fachwrites frei');
}
{
    const adapter = separateAdapter({ ...originals }, 'indexeddb'); await boot(adapter);
    const c = controller(storage()); await c.initialize();
    let resolve;
    const first = c.start(() => new Promise(done => { resolve = done; }));
    while (!resolve) await Promise.resolve();
    await rejects(() => c.start(selection), 'Verschachtelter Start während Auswahl abgewiesen');
    resolve(null); await first;
    assert(equal(adapter.values, originals), 'Doppelstart während Auswahl mutiert keine echten Records');
}
{
    const held = new Set(), requests = [];
    const locks = { async request(name, options, run) {
        requests.push(name);
        assert(['rs-annual-operation', 'rs-probelauf-operation'].includes(name), 'Jahresbesitz und Backendwriter verwenden getrennte bekannte Locks');
        if (held.has(name) && options.ifAvailable) return run(null);
        if (held.has(name)) throw new Error('Verschachtelter Backendlock');
        if (name === 'rs-probelauf-operation' && held.has('rs-annual-operation'))
            assertEqual(held.size, 1, 'Jahresbesitz schützt den anschließenden Writererwerb');
        held.add(name); try { return await run({ name }); } finally { held.delete(name); }
    } };
    const browser = { ...win, navigator: { locks } };
    const adapter = separateAdapter({ ...originals }, 'indexeddb');
    P.resetPersistenceForTests(adapter); await P.init({ window: browser, installLifecycleHooks: false }); setAppTestDate(null);
    let c = controller(storage(), { win: browser }); await c.initialize(); await c.start(selection);
    assertEqual(JSON.stringify(requests), JSON.stringify(['rs-annual-operation', 'rs-probelauf-operation']), 'Start erwirbt zuerst Jahresbesitz und dann genau einen Backendwriter');
    assertEqual(held.size, 0, 'Bestätigter Start gibt beide Locks frei');
    P.resetPersistenceForTests(adapter); await P.init({ window: browser, installLifecycleHooks: false });
    c = controller(storage(), { win: browser }); await c.initialize();
    let finish;
    const other = locks.request('rs-probelauf-operation', {}, () => new Promise(done => { finish = done; }));
    assertEqual((await c.changeDate('2027-02-01')).status, 'cancelled', 'Unbekannter Lockbesitz verhindert Datumsmutation');
    assertEqual(c.state.testDate, '2027-01-31', 'Parallele Seite verändert Uhr nicht');
    finish(); await other;
    P.setItemSync('profile_tagesgeld', 'stale');
    adapter.values[KEY] = JSON.stringify({ ...c.state, testDate: '2027-02-03' });
    await rejects(() => P.flush(), 'Backendcommit liest veränderten Steuerzustand erneut');
    assertEqual(adapter.values.profile_tagesgeld, originals.profile_tagesgeld, 'Veralteter Write erreicht Backend nicht');
    assert(c.blocked, 'Veraltetes Dokument bleibt gesperrt');
}
{
    const adapter = separateAdapter({ ...originals }, 'indexeddb'); await boot(adapter);
    let c = controller(storage()); await c.initialize(); await c.start(selection);
    await boot(adapter);
    delete adapter.values[KEY]; // Anderes Dokument hat nach unserem Cacheload beendet.
    c = controller(storage());
    await rejects(() => c.initialize(), 'Zustandswechsel zwischen Cacheload und Bereitschaft sperrt Seitenstart');
    assert(c.blocked, 'Veralteter Testcache wird nicht als Echtbestand freigegeben');
}
// Leaseaudit: echter Reloadbesitz wird bis in Archiv- und Transaktionswriter
// geliehen. Kein Ersatz für guard.reload oder die fachlichen Folgewriter.
for (const source of ['copy', 'demo']) {
    const adapter = separateAdapter({ ...originals }, 'indexeddb');
    let release, entered, timer, task, guard;
    const reached = new Promise(done => { entered = done; });
    const gate = new Promise(done => { release = done; });
    const writeSnapshot = adapter.writeSnapshot.bind(adapter);
    let hold = false, reloads = 0;
    adapter.writeSnapshot = async point => {
        if (hold) { entered(); await gate; }
        return writeSnapshot(point);
    };
    const bounded = async promise => {
        try { return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Leaseaudit ohne Abschluss')), 2000);
        })]); } finally { clearTimeout(timer); }
    };
    const makeController = () => controller(storage(), { guard, reload: () => {
        reloads++;
        assertEqual(JSON.parse(adapter.values[KEY]).phase, 'active', source + ': Reload erst nach dauerhaftem active');
    }, restoreReload: () => { reloads++; assertEqual(adapter.values[KEY], undefined, source + ': Rückkehr erst nach dauerhaftem Restore'); } });
    try {
        await boot(adapter); await A.createSnapshot({ id: 'audit-old', records: {} });
        guard = createNavigationGuard();
        let c = makeController(); await c.initialize(); hold = true;
        task = c.start(() => {
            assertEqual(guard.reasons().length, 1, source + ': Auswahl unter genau einem äußeren Reloadbesitzer');
            return { source, testDate: '2027-07-01' };
        });
        await bounded(Promise.race([reached, task.then(() => { throw new Error('Rückkehrpunktwriter nicht erreicht'); })]));
        assert(guard.isBusy() && guard.reasons().length === 1 && guard.reasons()[0].phase === 'commit', source + ': Archivwriter erreicht trotz eigener Reloadlease');
        assertEqual(await guard.prepare(), null, source + ': fremde Navigation bleibt gesperrt');
        assertEqual(reloads, 0, source + ': kein Reload vor Archivbestätigung');
        assertEqual(adapter.values[KEY], undefined, source + ': kein Startrecord vor Archivbestätigung');
        release(); assertEqual((await bounded(task)).status, 'reloaded', source + ': echte Transaktionswriter bestätigen Start');
        guard.revokeNative();
        assertEqual(guard.reasons().length, 0, source + ': Reloadwrite löst eigene Lease');
        const snapshotId = c.state.snapshotId;
        hold = false;
        await boot(adapter); guard = createNavigationGuard(); c = makeController(); await c.initialize();
        await A.createSnapshot({ id: 'audit-created-in-run', records: {} });
        task = c.changeDate('2027-07-02');
        assertEqual((await bounded(task)).status, 'reloaded', source + ': Datumstransaktionen leihen Reloadbesitz');
        assertEqual(JSON.parse(adapter.values[KEY]).testDate, '2027-07-02', source + ': Datum im Backend bestätigt');
        guard.revokeNative();
        await boot(adapter); guard = createNavigationGuard(); c = makeController(); await c.initialize();
        task = c.end(() => true);
        assertEqual((await bounded(task)).status, 'reloaded', source + ': Restore und Archivdelete leihen Reloadbesitz');
        assert(equal(adapter.values, originals), source + ': Rückkehrrecords dauerhaft bytegleich');
        assert(adapter.points.has('audit-old') && adapter.points.has(snapshotId) && !adapter.points.has('audit-created-in-run'), source + ': echter Archivdelete erreicht Backend');
        guard.revokeNative(); assertEqual(guard.reasons().length, 0, source + ': alle geliehenen Leases beendet');
    } finally {
        release(); if (task) await bounded(task).catch(() => {});
        guard?.revokeNative(); P.resetPersistenceForTests(); setAppTestDate(null);
    }
}
P.resetPersistenceForTests(); setAppTestDate(null);

// Auch ein bereits beschäftigter Guard wird vor jeder Vorbereitung sichtbar abgewiesen.
for (const reason of ['commit', 'busy']) {
    const adapter = separateAdapter({ ...originals }, 'indexeddb'); await boot(adapter);
    const guard = createNavigationGuard();
    let selected = false, saves = 0, reloads = 0;
    let elapsed = 0;
    const c = controller(storage(), { guard, clock: () => elapsed, wait: async ms => { elapsed += ms; }, saveProfile: async () => { saves++; }, reload: () => { reloads++; } });
    await c.initialize();
    const lease = reason === 'commit' ? guard.register('foreign', { read: () => ({ phase: 'commit' }) }) : null;
    const attempt = reason === 'busy' ? await guard.prepare() : null;
    try {
        const result = await c.start(() => { selected = true; return selection(); });
        assertEqual(result.status, 'cancelled', reason + ': frühe Ablehnung bleibt cancelled');
        assertEqual(result.error?.message, 'Gerade wird noch gespeichert. Bitte in ein paar Sekunden erneut versuchen.', reason + ': frühe Ablehnung trägt sichtbare Rückmeldung');
        assertEqual(c.action, null, 'Frühe Guardablehnung beginnt keine eigene Aktion');
        assertEqual(c.blocked, false, 'Frühe Guardablehnung installiert keine Recoverysperre');
        assert(!selected && !saves && !reloads, 'Frühe Guardablehnung ruft Auswahl, Profilsaver und Reload nicht auf');
        assertEqual(adapter.points.size, 0, 'Frühe Guardablehnung legt keinen Snapshot an');
        assert(equal(adapter.values, originals), 'Frühe Guardablehnung erhält alle Rohrecords');
        assertEqual(getAppTestDate(), null, 'Frühe Guardablehnung aktiviert keine Uhr');
        assert(reason === 'commit' ? guard.reasons().some(r => r.owner === 'foreign') : guard.isBusy(), 'Fremder Guardbesitz bleibt erhalten');
        P.setItemSync('profile_tagesgeld', '001.20'); // Keine neue Schreibsperre.
    } finally { lease?.unregister(); if (attempt) guard.end(attempt); }
}

// Auch der Koordinator ohne Facade-Helfer wartet vor dem eigenen Guardweg.
for (const releaseWriter of [true, false]) {
    const adapter = separateAdapter({ ...originals }, 'indexeddb'); await boot(adapter);
    const guard = createNavigationGuard(), lease = guard.register('local-start', { read: () => ({ phase: 'commit' }) });
    let elapsed = 0, reloads = 0;
    const c = controller(storage(), { persistence: { ...P, withProbelaufOperation: undefined }, guard,
        clock: () => elapsed, wait: async ms => { elapsed += ms; if (releaseWriter) lease.unregister(); }, reload: () => { reloads++; } });
    await c.initialize();
    const result = await c.start(selection);
    assertEqual(result.status, releaseWriter ? 'reloaded' : 'cancelled', 'Legacykoordinator behält begrenzte lokale Wartegrenze');
    assertEqual(reloads, releaseWriter ? 1 : 0, 'Legacykoordinator reloadet nur nach Writerfreigabe');
    if (!releaseWriter) { assert(equal(adapter.values, originals), 'Legacytimeout erhält dauerhafte Rohrecords'); assertEqual(adapter.points.size, 0, 'Legacytimeout schreibt keinen Snapshot'); }
    lease.unregister();
}

// Ein Startwriter kann seine Commitlease erst während des Lockerwerbs anmelden.
for (const action of ['start', 'date']) for (const releaseWriter of [true, false]) {
    const adapter = separateAdapter({ ...originals }, 'indexeddb'); await boot(adapter);
    if (action === 'date') {
        const initial = controller(storage()); await initial.initialize(); await initial.start(selection);
        await boot(adapter);
    }
    const guard = createNavigationGuard();
    let elapsed = 0, reloads = 0, acquisitions = 0, lease, held = false, progress = 0;
    const persistence = { ...P, withProbelaufOperation: (execute, browser, options) => P.withProbelaufOperation(async () => {
        held = true;
        try {
            if (++acquisitions === 1) {
                elapsed += 125;
                lease = guard.register('late-start-writer', { read: () => ({ phase: 'commit' }) });
            }
            return await execute();
        } finally { held = false; }
    }, browser, options) };
    const c = controller(storage(), { persistence, guard, clock: () => elapsed,
        wait: async ms => {
            assert(!held, 'Nach Erwerbsrennen wird ohne gehaltenen Operationslock gewartet');
            assert(c.waiting && !c.busy && c.action === null, 'Erwerbsrennen hält Wartekennung ohne eigene Writerblockade');
            elapsed += ms;
            if (releaseWriter && elapsed >= 225) lease.unregister();
        }, reload: () => { reloads++; }, notify: (controller, error) => { if (error?.message === 'Speichert noch …') progress++; } });
    await c.initialize();
    const before = { ...adapter.values }, cache = Object.fromEntries(P.keysSync().map(key => [key, P.getItemSync(key)])), snapshots = JSON.stringify([...adapter.points]);
    const beforeState = JSON.stringify(c.state), beforeDate = getAppTestDate(), writes = adapter.events.filter(e => e === 'save' || e.startsWith('state:') || e === 'snapshot-write').length;
    try {
        const result = await (action === 'date' ? c.changeDate('2027-02-01') : c.start(selection));
        assertEqual(result.status, releaseWriter ? 'reloaded' : 'cancelled', action + ': Erwerbsrennen bleibt dieselbe Warteepisode');
        assert(progress > 0, 'Erwerbsrennen meldet sichtbaren Wartefortschritt');
        assertEqual(reloads, releaseWriter ? 1 : 0, 'Erwerbsrennen lädt nur nach Freigabe genau einmal neu');
        assertEqual(c.waiting, false, 'Erwerbsrennen bereinigt Wartekennung');
        if (releaseWriter) {
            assertEqual(elapsed, 225, 'Freigabe vor Deadline setzt die Aktion fort');
            assertEqual(acquisitions, 2, 'Nach Guardfreigabe wird der Operationslock erneut erworben');
            const date = action === 'date' ? '2027-02-01' : '2027-01-31';
            assertEqual(c.state.testDate, date, 'Fortsetzung bestätigt das angeforderte Testdatum');
            assertEqual(JSON.parse(adapter.values[KEY]).testDate, date, 'Testdatum ist dauerhaft bestätigt');
            assertEqual(getAppTestDate(), date, 'Fortsetzung schaltet die Testuhr korrekt um');
        } else {
            assertEqual(elapsed, 10000, 'Erwerbsrennen setzt die gemeinsame Zehnsekundenfrist nicht zurück');
            assertEqual(result.error?.code, 'PROBELAUF_COMMIT_BUSY', 'Erwerbsrennen endet mit normalem Beschäftigtcode');
            assert(equal(adapter.values, before), 'Erwerbstimeout erhält bytegleiche Backendrecords');
            assert(equal(Object.fromEntries(P.keysSync().map(key => [key, P.getItemSync(key)])), cache), 'Erwerbstimeout erhält den Cache');
            assertEqual(JSON.stringify([...adapter.points]), snapshots, 'Erwerbstimeout erzeugt oder verändert keinen Snapshot');
            assertEqual(adapter.events.filter(e => e === 'save' || e.startsWith('state:') || e === 'snapshot-write').length, writes, 'Erwerbstimeout beginnt keinen Write');
            assertEqual(JSON.stringify(c.state), beforeState, 'Erwerbstimeout erhält den Controllerzustand');
            assertEqual(getAppTestDate(), beforeDate, 'Erwerbstimeout erhält die Testuhr');
            assertEqual(c.blocked, false, 'Erwerbstimeout installiert keine Recoverysperre');
        }
    } finally { lease?.unregister(); guard.revokeNative(); }
}

// Der Legacy-Web-Lock-Pfad darf bei lokalem Lockbesitz nicht sofort ablehnen.
for (const releaseWriter of [true, false]) {
    const adapter = separateAdapter({ ...originals }, 'indexeddb'); await boot(adapter);
    let elapsed = 0, reloads = 0, occupied = true, attempts = 0;
    const held = new Set();
    const locks = { async request(name, options, execute) {
        assert(['rs-annual-operation', 'rs-probelauf-operation'].includes(name), 'Legacyversuch trennt Jahresbesitz und Operationswriter');
        assert(options.ifAvailable && options.mode === 'exclusive', 'Legacyversuch reiht sich nicht unbegrenzt ein');
        if (name === 'rs-probelauf-operation') {
            assert(held.has('rs-annual-operation'), 'Auch der Legacywriter folgt auf den Jahresbesitz');
            attempts++;
            if (occupied) return execute(null);
        }
        assert(!held.has(name), 'Kein doppelter Besitz desselben Sperrnamens');
        held.add(name); try { return await execute({ name }); } finally { held.delete(name); }
    } };
    const c = controller(storage(), { persistence: { ...P, withProbelaufOperation: undefined }, win: { ...win, navigator: { locks } },
        clock: () => elapsed, wait: async ms => {
            assertEqual(held.size, 0, 'Legacywartephase hält keinen Lock');
            elapsed += ms; if (releaseWriter && elapsed >= 150) occupied = false;
        }, reload: () => { reloads++; } });
    await c.initialize();
    const result = await c.start(selection);
    assertEqual(result.status, releaseWriter ? 'reloaded' : 'cancelled', 'Legacylockkonkurrenz wartet begrenzt');
    assert(attempts > 1, 'Legacylockkonkurrenz versucht den exklusiven Erwerb erneut');
    assertEqual(elapsed, releaseWriter ? 150 : 10000, 'Legacylockkonkurrenz behält die gemeinsame Deadline');
    assertEqual(reloads, releaseWriter ? 1 : 0, 'Legacylockkonkurrenz reloadet genau einmal nach Freigabe');
    if (releaseWriter) assertEqual(c.state.testDate, '2027-01-31', 'Legacyfortsetzung bestätigt das angeforderte Testdatum');
    else {
        assertEqual(result.error?.code, 'PROBELAUF_COMMIT_BUSY', 'Legacylocktimeout trägt den normalen Beschäftigtcode');
        assert(equal(adapter.values, originals), 'Legacylocktimeout erhält bytegleiche Records');
        assertEqual(adapter.points.size, 0, 'Legacylocktimeout schreibt keinen Snapshot');
        assertEqual(getAppTestDate(), null, 'Legacylocktimeout aktiviert keine Testuhr');
    }
}
P.resetPersistenceForTests(); setAppTestDate(null);

// Ein kopierter Altbestand erhält nur im geschützten Testbestand einen direkten Plan.
{
    const legacy = { ...originals }; delete legacy[HOUSEHOLD_PLAN_KEY];
    const adapter = separateAdapter(legacy, 'indexeddb'); await boot(adapter);
    let c = controller(storage()); await c.initialize();
    assertEqual((await c.start(selection)).status, 'reloaded', 'Altkopie startet ohne zusätzliche Planrückfrage');
    assertEqual(Object.keys(assertHouseholdPlanRecord(P.getItemSync(HOUSEHOLD_PLAN_KEY)).entries).length, 1, 'Altkopie erhält direkt einen Haushaltsplan');
    assertAnnualPlanRecord(P.getItemSync(ANNUAL_PLAN_RECORD_KEY));
    assertEqual(P.getItemSync(ANNUAL_PLAN_RECORD_KEY), legacy[ANNUAL_PLAN_RECORD_KEY], 'Altkopie erfindet und verändert keinen Jahresbeleg');
    await boot(adapter); c = controller(storage()); await c.initialize(); await c.end(() => true);
    assert(equal(await P.readPersistedRecords(isProbelaufRecordKey), legacy), 'Altkopierückkehr entfernt ausschließlich den neuen Testplan und erhält den echten Beleg');
}
setAppTestDate(null);

// Runtimefreigabe lockert keinen Recoveryvertrag in einer fremden Alltags-EXE.
for (const failure of [null, 'missing', 'damaged']) {
    const adapter = separateAdapter({ ...originals }, 'tauri-json-file'); await boot(adapter);
    const alltagsWin = { location: { href: 'tauri://localhost/Handbuch.html' }, __TAURI__: { app: { getIdentifier: async () => 'com.fremd.alltag' } } };
    let c = controller(storage(), { win: alltagsWin }); await c.initialize(); await c.start(selection);
    const beforeId = c.state.snapshotId;
    const raw = JSON.parse(adapter.values[KEY]); raw.phase = 'starting'; adapter.values[KEY] = JSON.stringify(raw);
    if (failure === 'missing') adapter.points.delete(beforeId);
    if (failure === 'damaged') adapter.points.get(beforeId).kind = 'beschädigt';
    await boot(adapter); c = controller(storage(), { win: alltagsWin });
    if (failure) await rejects(() => c.initialize(), `${failure}: Rückkehrpunkt sperrt Alltagsinitialisierung`);
    else await c.initialize();
    assert(c.blocked, 'Alltagszwischenphase bleibt gesperrt');
    assert(c.runtime.canRecover, 'Alltagskennung erlaubt sicheren Recoveryversuch');
    const bytes = JSON.stringify(adapter.values), points = JSON.stringify([...adapter.points]);
    if (failure) {
        await rejects(() => c.end(() => true), `${failure}: Recovery bleibt ohne intakten Rückkehrpunkt gesperrt`);
        assertEqual(JSON.stringify(adapter.values), bytes, 'Abgelehnte Alltagsrecovery verändert keine Rohrecords');
        assertEqual(JSON.stringify([...adapter.points]), points, 'Abgelehnte Alltagsrecovery verändert kein Archiv');
    } else {
        await c.end(() => true);
        assert(equal(adapter.values, originals), 'Alltagszwischenphase stellt alle ursprünglichen Rohbytes wieder her');
        assertEqual(adapter.points.size, 1, 'Recovery behält ausschließlich Vor Probelauf');
    }
}
P.resetPersistenceForTests(); setAppTestDate(null);
