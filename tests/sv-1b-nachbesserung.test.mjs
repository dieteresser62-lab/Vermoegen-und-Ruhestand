// SV-1b (Codex-Gutachten 18.11.2026): Sperre bei unbestätigter Rücknahme, beschädigte Punkte, robuste Erststart-Leerung,
// voller Umfang der Punkte vor „Neu beginnen“, Vollimport und Übernahme, Verwerfen ohne vorzeitige Sperre.
// SV-1c (Nutzer 19.11.2026 „Schutzlogik zurück“): Die Speicher-Adapter schreiben wieder wie produktiv; ihre Alles-oder-nichts-Prüfungen
// sind mit der Adapterlogik entfallen. Doppelte Quotenfehler (Vorgang und Rücknahme) sind eine bekannte Grenze.
// Nur synthetische Daten: Musterhaushalt Max und Erika, Testdatum 2026-10-02.
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS as K, IMPORT_POINT_LABELS } from '../app/shared/snapshot-archive.js';
import { restoreSnapshotById } from '../app/shared/snapshot-restore.js';
import { resetRestorePointsOnce, isRestorePointNoticeOpen, readRestorePointReset, RESTORE_POINTS_RESET_KEY } from '../app/shared/snapshot-reset.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup, downloadFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { createNewBeginningController } from '../app/data/data-new-beginning.js';
import { readDataModel } from '../app/data/data-model.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { AREA_CONTROL_KEY } from '../app/shared/persistence-area-storage.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { isAllowedPersistenceImportKey, isNewBeginningRecordKey } from '../app/shared/persistence-key-policy.js';

const DATE = '2026-10-02';
const ARCHIVE = 'rs_snapshot_archive_v1';
const PRICES = '{"version":1,"symbols":{}}';
const quotaError = () => Object.assign(new Error('Speicher voll'), { name: 'QuotaExceededError' });
/** Web Storage mit Quote in Zeichen und eingespielten Quotenfehlern je Schreibzugriff auf Fachrecords (das Archiv zählt nicht mit). */
function quotaStorage(records = {}, quota = Infinity) {
    const map = new Map(Object.entries(records)), s = { writes: 0, thrown: 0, failAt: new Set(), failFrom: Infinity };
    const used = () => [...map].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
    const count = key => {
        if (key === ARCHIVE) return;
        s.writes += 1;
        if (s.failAt.has(s.writes) || s.writes >= s.failFrom) { s.thrown += 1; throw quotaError(); }
    };
    Object.defineProperty(s, 'length', { get: () => map.size });
    return Object.assign(s, { map, getItem: key => map.get(key) ?? null, key: index => [...map.keys()][index] ?? null,
        removeItem(key) { count(key); map.delete(key); }, clear: () => map.clear(),
        setItem(key, value) {
            count(key);
            const next = used() - (map.has(key) ? key.length + map.get(key).length : 0) + key.length + String(value).length;
            if (next > quota) throw quotaError();
            map.set(key, String(value));
        },
        arm(failAt = [], failFrom = Infinity) { s.writes = 0; s.failAt = new Set(failAt); s.failFrom = failFrom; } });
}
async function bootLocal(storage) {
    resetPersistenceForTests(createLocalStorageAdapter(storage)); setAppTestDate(null);
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
const fachbestand = storage => JSON.stringify([...storage.map].filter(([key]) => key !== ARCHIVE && !key.startsWith('metadata.')).sort());
const capture = records => SnapshotArchive.captureCurrentRecords({ keys: Object.keys(records), getItem: key => records[key] });
/** Altpunkt aus der Zeit vor der vereinfachten Sicherung: ohne Herkunft. */
const legacyPoint = (id, kind, records, createdAt = '2026-09-01T10:00:00.000Z') => {
    const { origin, ...point } = SnapshotArchive.buildSnapshot({ id, kind, records: capture(records), createdAt });
    return P.writeSnapshot(point);
};
const changeLive = async () => {
    const registry = JSON.parse(P.getItemSync('rs_profiles_v1'));
    for (const profile of Object.values(registry.profiles)) profile.data.profile_tagesgeld = '4321';
    P.setItemSync('rs_profiles_v1', JSON.stringify(registry)); P.setItemSync('profile_tagesgeld', '4321');
    P.setItemSync('sim_mcSeed', '99'); P.setItemSync('household_simulator_needs_warning_ack_v1', '1');
    await P.flush();
};

// 3 · Scheitert jede Rücknahme, bleibt nie still eine Mischung: Sperre mit Meldung, der Punkt davor bleibt und holt den alten Stand zurück.
for (const path of ['Einspielen', 'Zurückholen']) {
    const storage = quotaStorage(createMusterHaushaltRecords(DATE));
    await bootLocal(storage);
    const backup = buildFullPersistenceBackup();
    const point = path === 'Zurückholen' ? await SnapshotArchive.createSnapshot({ id: 'monat', kind: K.monthlyClosePreMutation,
        label: 'Monatsabschluss 2026-09', records: capture(await P.readPersistedRecords()) }) : null;
    await changeLive();
    const before = fachbestand(storage);
    const originalWrite = P.writeSnapshot;
    P.writeSnapshot = async (...args) => { const result = await originalWrite(...args); storage.arm([], 3); return result; };
    let outcome;
    try {
        if (path === 'Einspielen') outcome = await importFullPersistenceBackup(structuredClone(backup));
        else { try { await restoreSnapshotById(point.id, { reload: () => {} }); } catch (error) { outcome = error; } }
    } finally { P.writeSnapshot = originalWrite; storage.arm(); }
    assertEqual(outcome?.code, 'rollback_failed', `${path}: unbestätigte Rücknahme wird gemeldet`);
    let blocked = null;
    try { P.setItemSync('profile_tagesgeld', '1'); } catch (error) { blocked = error; }
    assert(/neu/.test(blocked?.message || '') && /Punkt „Vor dem/.test(blocked?.message || ''), `${path}: Seite sperrt mit klarer Meldung und nennt den Punkt`);
    const undo = (await SnapshotArchive.listSnapshots()).find(entry => entry.kind === K.fullBackupImportRecovery);
    assert(undo, `${path}: Punkt davor bleibt zum Zurückholen`);
    await bootLocal(storage); // Neuladen
    assertEqual((await restoreSnapshotById(undo.id, { reload: () => {} })).status, 'restored', `${path}: Punkt davor lässt sich zurückholen`);
    assertEqual(fachbestand(storage), before, `${path}: Zurückholen stellt den vollständigen alten Stand her`);
}

// 5 · Beschädigter Punkt: Domänenprüfung wie beim Einspielen. Er erscheint als beschädigt und überschreibt nichts.
{
    const storage = quotaStorage(createMusterHaushaltRecords(DATE));
    await bootLocal(storage);
    const records = capture(await P.readPersistedRecords());
    await SnapshotArchive.createSnapshot({ id: 'kaputt', kind: K.monthlyClosePreMutation, label: 'Monatsabschluss 2026-09', records: { ...records, depot_tranchen: '{kaputt' } });
    await SnapshotArchive.createSnapshot({ id: 'heil', kind: K.monthlyClosePreMutation, label: 'Monatsabschluss 2026-08', createdAt: '2026-08-31T10:00:00.000Z', records });
    const model = await readDataModel(P);
    assertEqual(JSON.stringify(model.damagedSnapshotIds), JSON.stringify(['kaputt']), 'Liste zeigt genau den beschädigten Punkt als beschädigt');
    const before = fachbestand(storage);
    let error;
    try { await restoreSnapshotById('kaputt', { reload: () => {} }); } catch (caught) { error = caught; }
    assertEqual(error?.code, 'restore_point_damaged', 'Beschädigter Punkt lässt sich nicht zurückholen');
    assertEqual(fachbestand(storage), before, 'Gültige Haushaltsdaten bleiben unverändert');
}

// 6 · Erststart-Leerung: nur alte Punkte, nie Jahrespunkte, nie neue Punkte; Verweise nur aus dem Livebestand.
{
    const seed = createMusterHaushaltRecords(DATE);
    const state = JSON.parse(seed.ruhestandsmodellValues_v29_guardrails);
    const pending = { ...seed, ruhestandsmodellValues_v29_guardrails: JSON.stringify({ ...state, annualPeriodMetadata: { schemaVersion: 1,
        lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'alt-monat' } } }) };
    const storage = quotaStorage(pending);
    await bootLocal(storage);
    await legacyPoint('alt-monat', K.monthlyClosePreMutation, seed);
    await legacyPoint('alt-jahr', K.annualClosePreMutation, seed);
    assertEqual((await resetRestorePointsOnce({ now: () => new Date('2026-11-19T08:00:00Z') })).status, 'waiting', 'Offener Vorgang verweist auf einen alten Punkt: die Leerung wartet');
    await SnapshotArchive.createSnapshot({ id: 'neu-jahr', kind: K.annualClosePreMutation, label: 'Max', records: capture(seed) });
    await SnapshotArchive.createSnapshot({ id: 'neu-monat', kind: K.monthlyClosePreMutation, label: 'Monatsabschluss 2026-11', records: capture(seed) });
    P.setItemSync('ruhestandsmodellValues_v29_guardrails', seed.ruhestandsmodellValues_v29_guardrails); await P.flush();
    const result = await resetRestorePointsOnce({ now: () => new Date('2026-11-20T08:00:00Z') });
    const ids = (await SnapshotArchive.listSnapshots()).map(point => point.id).sort();
    assertEqual(result.status, 'cleared', 'Nach dem Abschluss läuft die Leerung');
    assertEqual(ids.join(','), 'alt-jahr,neu-jahr,neu-monat', 'Gelöscht wird nur der alte Monatspunkt; Jahrespunkte und neue Punkte bleiben');
    // Markierung verloren: ein erneuter Lauf löscht nichts Neues.
    storage.map.delete(`metadata.${RESTORE_POINTS_RESET_KEY}`);
    await resetRestorePointsOnce();
    assertEqual((await SnapshotArchive.listSnapshots()).map(point => point.id).sort().join(','), 'alt-jahr,neu-jahr,neu-monat', 'Ohne Markierung löscht ein erneuter Lauf keine neuen Punkte');
}
{
    // Ein pendingCommit, der nur in einer Archivkopie steht, hält die Leerung nicht auf (localStorage-Fallback).
    const seed = createMusterHaushaltRecords(DATE), state = JSON.parse(seed.ruhestandsmodellValues_v29_guardrails);
    const historic = { ...seed, ruhestandsmodellValues_v29_guardrails: JSON.stringify({ ...state, annualPeriodMetadata: { schemaVersion: 1,
        lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2025', phase: 'writes_started', snapshotId: 'alt-kopie' } } }) };
    const storage = quotaStorage(seed);
    await bootLocal(storage);
    await legacyPoint('alt-kopie', K.monthlyClosePreMutation, historic);
    assertEqual((await resetRestorePointsOnce()).status, 'cleared', 'Archivkopie mit altem Vorgang hält die Leerung nicht auf');
    assertEqual((await SnapshotArchive.listSnapshots()).length, 0, 'Alter Punkt ist entfernt');
}

// 7 · Hinweis: Eine angestoßene Vollsicherung erledigt ihn dauerhaft, auch nach dem Einspielen einer älteren Datei.
{
    const seed = createMusterHaushaltRecords(DATE);
    const storage = quotaStorage(seed);
    await bootLocal(storage);
    const older = buildFullPersistenceBackup();
    await legacyPoint('alt-monat', K.monthlyClosePreMutation, seed);
    await resetRestorePointsOnce({ now: () => new Date('2026-11-19T08:00:00Z') });
    assertEqual(readRestorePointReset(await P.getMetadata(RESTORE_POINTS_RESET_KEY))?.notice, 'open', 'Hinweis ist nach der Leerung offen');
    await downloadFullPersistenceBackup({ download: async () => 'angestossen' });
    assert((await importFullPersistenceBackup(structuredClone(older))).ok, 'Ältere Sicherung eingespielt');
    assert(!isRestorePointNoticeOpen(await P.getMetadata(RESTORE_POINTS_RESET_KEY), await P.readPersistedRecords()), 'Hinweis erscheint nach dem Einspielen nicht wieder');
}

// 8 · Die Markierung übersteht die Rücknahme einer gescheiterten Übernahme (localStorage); der Rückkehrpunkt bleibt.
{
    const f = await playFixture('local', createMusterHaushaltRecords(DATE));
    let c = await f.boot();
    assertEqual((await resetRestorePointsOnce()).status, 'cleared', 'Erster Start setzt die Markierung');
    await c.start(async () => ({ source: 'copy', testDate: null }));
    c = await f.boot();
    P.setItemSync('profile_tagesgeld', '12345'); await P.flush();
    const setItem = f.local.setItem.bind(f.local);
    let failControl = true;
    f.local.setItem = (key, value) => {
        if (key === AREA_CONTROL_KEY && failControl && JSON.parse(value).activeArea === 'echt') { failControl = false; throw quotaError(); }
        return setItem(key, value);
    };
    let failure = null;
    try { await c.end(async () => ({ action: 'transfer', review: await c.readEndReview() })); } catch (caught) { failure = caught; }
    f.local.setItem = setItem;
    assert(failure && !failControl, 'Übernahme scheitert beim Bereichswechsel und wird zurückgenommen');
    const real = f.areas.makeAdapter('echt');
    assert(readRestorePointReset(await real.readMetadata(RESTORE_POINTS_RESET_KEY)), 'Markierung übersteht die Rücknahme der Übernahme');
    const discard = await f.boot();
    await discard.end(async () => true);
    await f.boot();
    const points = await SnapshotArchive.listSnapshots();
    assertEqual((await resetRestorePointsOnce()).status, 'done', 'Kein zweiter Leerungslauf');
    assertEqual((await SnapshotArchive.listSnapshots()).length, points.length, 'Rückkehrpunkt der Übernahme bleibt');
}

// 9 · Umfang: Der Punkt vor dem Vollimport stellt beim Zurückholen auch Tageskurse und Verlaufsbeginn wieder her.
{
    const seed = { ...createMusterHaushaltRecords(DATE), rs_daily_prices_v1: PRICES, featureFlags: '{"probe":true}' };
    const storage = quotaStorage(seed);
    await bootLocal(storage);
    const backup = buildFullPersistenceBackup();
    backup.records.rs_daily_prices_v1 = '{"version":1,"symbols":{"NEU":{"currency":null,"days":[],"closes":[],"queried":[],"failures":0,"lastError":null}}}';
    delete backup.records.featureFlags; backup.recordCount = Object.keys(backup.records).length;
    const before = fachbestand(storage);
    const imported = await importFullPersistenceBackup(backup);
    assert(imported.ok, 'Vollimport mit anderen Tageskursen gelingt');
    assertEqual((await SnapshotArchive.readSnapshot(imported.recoverySnapshotId)).scope, 'import', 'Punkt vor dem Einspielen trägt den Importumfang');
    assertEqual((await restoreSnapshotById(imported.recoverySnapshotId, { reload: () => {} })).status, 'restored', 'Punkt vor dem Einspielen zurückgeholt');
    assertEqual(fachbestand(storage), before, 'Tageskurse, technische Werte und Haushalt sind wieder der Stand vor dem Einspielen');
}

// 10 · „Neu beginnen“: Der Punkt davor umfasst alles Gelöschte; Aufräumfehler danach sind eine Warnung, kein Fehlschlag.
{
    const seed = { ...createMusterHaushaltRecords(DATE), rs_daily_prices_v1: PRICES, featureFlags: '{"probe":true}',
        overview_last_full_backup_v1: '2026-10-01T10:00:00.000Z', ui_probe: 'offen' };
    const storage = quotaStorage(seed);
    await bootLocal(storage);
    const before = fachbestand(storage);
    const originalReset = P.resetNewBeginningBrowserStorage;
    P.resetNewBeginningBrowserStorage = async () => { throw new Error('Sitzungsspeicher gesperrt'); };
    let result;
    try { result = await createNewBeginningController({ guard: createNavigationGuard(), window: { localStorage: storage, sessionStorage: quotaStorage() }, navigate: () => {} })
        .execute({ withoutBackup: true, confirmed: true }); }
    finally { P.resetNewBeginningBrowserStorage = originalReset; }
    assert(['restarted', 'reload_required'].includes(result.status), 'Aufräumfehler nach dem Löschen meldet kein „failed“');
    assert(/Sitzungsspeicher gesperrt/.test(result.warning || ''), 'Aufräumfehler erscheint als Warnung');
    assertEqual((await SnapshotArchive.readSnapshot(result.snapshotId)).label, IMPORT_POINT_LABELS.newBeginning, 'Punkt „Vor Neu beginnen“ liegt vor');
    await bootLocal(storage);
    assertEqual((await restoreSnapshotById(result.snapshotId, { reload: () => {} })).status, 'restored', 'Punkt vor Neu beginnen zurückgeholt');
    assertEqual(fachbestand(storage), before, 'Sicherungszeit, featureFlags, Tageskurse und technische Werte kommen mit zurück');
}

// 11 · Verwerfen: Ein Lesefehler vor dem Bereichswechsel setzt keine Neuladen-Sperre; die Seite bleibt im Spielbereich bedienbar.
{
    const trace = [];
    const probe = await playFixture('tauri', createMusterHaushaltRecords(DATE));
    let c = await probe.boot();
    await c.start(async () => ({ source: 'copy', testDate: null }));
    c = await probe.boot();
    const recorded = probe.tauri.invoke;
    probe.tauri.invoke = async (command, args = {}) => { trace.push(`${command}:${args.target || ''}`); return recorded(command, args); };
    await c.end(async () => true);
    // Letzte Steuerlesung vor dem Schreiben des echten Bereichs gehört zur Bereichsprüfung des Verwerfens.
    const switchIndex = trace.indexOf('save_app_state:control');
    const readIndex = trace.slice(0, switchIndex).lastIndexOf('load_app_state:control');
    const readNumber = trace.slice(0, readIndex + 1).filter(entry => entry === 'load_app_state:control').length;

    const f = await playFixture('tauri', createMusterHaushaltRecords(DATE));
    c = await f.boot({ guard: createNavigationGuard({ decide: async () => true }) });
    await c.start(async () => ({ source: 'copy', testDate: null }));
    c = await f.boot({ guard: createNavigationGuard({ decide: async () => true }) });
    const invoke = f.tauri.invoke;
    let reads = 0;
    f.tauri.invoke = async (command, args = {}) => {
        if (command === 'load_app_state' && args.target === 'control' && ++reads === readNumber) throw new Error('SYNTHETIC_CONTROL_READ');
        return invoke(command, args);
    };
    let outcome;
    try { outcome = await c.end(async () => true); } catch (error) { outcome = { status: 'failed', error }; }
    f.tauri.invoke = invoke;
    assertEqual(outcome.status, 'failed', 'Verwerfen scheitert am Lesefehler');
    assert(/SYNTHETIC_CONTROL_READ/.test(outcome.error?.message || ''), 'Der eingespielte Lesefehler war die Ursache');
    assert(!P.getPersistenceStatus().reloadRequired && !c.blocked, 'Lesefehler vor dem Bereichswechsel setzt keine Neuladen-Sperre');
    assertEqual(P.getPersistenceStatus().activeArea, 'spiel', 'Spielbereich bleibt aktiv');
    assertEqual((await c.end(async () => true)).status, 'reloaded', 'Erneutes Verwerfen gelingt');
}

// 12 · SV-1c Punktprüfung: keine Typumwandlung vor der Domänenprüfung, und der Umfang muss zum Punkt passen.
{
    const seed = { ...createMusterHaushaltRecords(DATE), rs_daily_prices_v1: PRICES, featureFlags: '{"probe":true}' };
    const storage = quotaStorage(seed);
    await bootLocal(storage);
    const all = await P.readPersistedRecords(isNewBeginningRecordKey), records = capture(all);
    const point = input => SnapshotArchive.buildSnapshot({ label: 'Monatsabschluss 2026-09', kind: K.monthlyClosePreMutation, records, ...input });
    const numeric = point({ id: 'zahl' });
    numeric.records = { ...numeric.records, profile_tagesgeld: 18000 };
    await P.writeSnapshot(numeric);
    await P.writeSnapshot({ ...point({ id: 'monat-all' }), scope: 'all' });
    await P.writeSnapshot(point({ id: 'neu-import', kind: K.fullBackupImportRecovery, label: IMPORT_POINT_LABELS.newBeginning, scope: 'import',
        records: Object.fromEntries(Object.entries(all).filter(([key]) => isAllowedPersistenceImportKey(key))) }));
    await P.writeSnapshot(point({ id: 'import-fremd', kind: K.fullBackupImportRecovery, label: 'Vollbackup-Import Recovery 2026-10-01', scope: 'import',
        records: { ...Object.fromEntries(Object.entries(all).filter(([key]) => isAllowedPersistenceImportKey(key))), ui_probe: 'offen' } }));
    await P.writeSnapshot(point({ id: 'neu-all', kind: K.fullBackupImportRecovery, label: IMPORT_POINT_LABELS.newBeginning, scope: 'all', records: all }));
    await P.writeSnapshot(point({ id: 'monat-heil', createdAt: '2026-08-31T10:00:00.000Z' }));
    const model = await readDataModel(P);
    assertEqual([...model.damagedSnapshotIds].sort().join(','), 'import-fremd,monat-all,neu-import,zahl',
        'Liste zeigt Zahlenwert, Monatspunkt mit ganzem Umfang, falschen Umfang und Record außerhalb des Umfangs als beschädigt');
    const before = fachbestand(storage);
    for (const id of ['zahl', 'monat-all']) {
        let error;
        try { await restoreSnapshotById(id, { reload: () => {} }); } catch (caught) { error = caught; }
        assertEqual(error?.code, 'restore_point_damaged', `${id}: Punkt lässt sich nicht zurückholen`);
    }
    assertEqual(fachbestand(storage), before, 'Tageskurse, featureFlags und Haushalt bleiben unverändert');
    assertEqual((await restoreSnapshotById('neu-all', { reload: () => {} })).status, 'restored', 'Passender Punkt „Vor Neu beginnen“ bleibt zurückholbar');
}

// 13 · SV-1c Erststart-Leerung: Ein offener Jahresabschluss mit Jahresvorabpunkt hält sie an, auch wenn kein alter Punkt betroffen ist.
for (const annual of ['neu', 'alt']) {
    const seed = createMusterHaushaltRecords(DATE), state = JSON.parse(seed.ruhestandsmodellValues_v29_guardrails);
    const open = { ...seed, ruhestandsmodellValues_v29_guardrails: JSON.stringify({ ...state, annualPeriodMetadata: { schemaVersion: 1,
        lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'jahr-vorab' } } }) };
    const storage = quotaStorage(open);
    await bootLocal(storage);
    await legacyPoint('alt-monat', K.monthlyClosePreMutation, seed);
    if (annual === 'alt') await legacyPoint('jahr-vorab', K.annualClosePreMutation, seed);
    else await SnapshotArchive.createSnapshot({ id: 'jahr-vorab', kind: K.annualClosePreMutation, label: 'Max', records: capture(seed) });
    assertEqual((await resetRestorePointsOnce({ now: () => new Date('2026-11-19T08:00:00Z') })).status, 'waiting', `${annual}er Jahresvorabpunkt: die Leerung wartet`);
    const ids = async () => (await SnapshotArchive.listSnapshots()).map(entry => entry.id).sort().join(',');
    assertEqual(await ids(), 'alt-monat,jahr-vorab', `${annual}er Jahresvorabpunkt: nichts entfernt, solange der Abschluss offen ist`);
    P.setItemSync('ruhestandsmodellValues_v29_guardrails', seed.ruhestandsmodellValues_v29_guardrails); await P.flush();
    assertEqual((await resetRestorePointsOnce()).status, 'cleared', `${annual}er Jahresvorabpunkt: nach dem Abschluss läuft die Leerung`);
    assertEqual(await ids(), 'jahr-vorab', `${annual}er Jahresvorabpunkt: nur der alte Monatspunkt ist entfernt`);
}

// 14 · SV-1c Hinweis: Eine Vollsicherung während der aufgeschobenen oder laufenden Leerung erledigt ihn dauerhaft, auch über einen Import.
for (const moment of ['aufgeschoben', 'laufend']) {
    const seed = createMusterHaushaltRecords(DATE), state = JSON.parse(seed.ruhestandsmodellValues_v29_guardrails);
    const open = { ...seed, ruhestandsmodellValues_v29_guardrails: JSON.stringify({ ...state, annualPeriodMetadata: { schemaVersion: 1,
        lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'alt-monat' } } }) };
    const storage = quotaStorage(moment === 'aufgeschoben' ? open : seed);
    await bootLocal(storage);
    const older = buildFullPersistenceBackup();
    await legacyPoint('alt-monat', K.monthlyClosePreMutation, seed);
    const marker = async () => readRestorePointReset(await P.getMetadata(RESTORE_POINTS_RESET_KEY));
    let archive = SnapshotArchive;
    if (moment === 'aufgeschoben') {
        assertEqual((await resetRestorePointsOnce({ now: () => new Date('2026-11-19T08:00:00Z') })).status, 'waiting', 'Leerung ist aufgeschoben');
        await downloadFullPersistenceBackup({ download: async () => 'bestaetigt' });
        assertEqual((await marker())?.notice, 'pending', 'Die Vollsicherung lässt die aufgeschobene Leerung unverändert');
        P.setItemSync('ruhestandsmodellValues_v29_guardrails', seed.ruhestandsmodellValues_v29_guardrails); await P.flush();
    } else {
        let backedUp = false;
        archive = { ...SnapshotArchive, async deleteSnapshot(id, options) {
            if (!backedUp) { backedUp = true; await downloadFullPersistenceBackup({ download: async () => 'angestossen' }); }
            return SnapshotArchive.deleteSnapshot(id, options);
        } };
    }
    assertEqual((await resetRestorePointsOnce({ archive, now: () => new Date('2026-11-19T08:00:00Z') })).status, 'cleared', `${moment}: Leerung läuft`);
    assertEqual((await marker())?.notice, 'closed', `${moment}: Die Leerung öffnet den erledigten Hinweis nicht`);
    assert((await importFullPersistenceBackup(structuredClone(older))).ok, `${moment}: Ältere Sicherung eingespielt`);
    assert(!isRestorePointNoticeOpen(await P.getMetadata(RESTORE_POINTS_RESET_KEY), await P.readPersistedRecords()), `${moment}: Hinweis erscheint nach dem Import nicht wieder`);
}

// 15 · SV-1c Windows-App: Die Markierung läuft in der gemeinsamen Schreibreihenfolge. Scheitert ihr Schreiben, bleibt eine bestätigte Eingabe.
{
    const f = await playFixture('tauri', createMusterHaushaltRecords(DATE));
    await f.boot();
    const recorded = f.tauri.invoke, liveSaves = [];
    let releaseFlush, failNext = false, flushDone = false;
    const gate = new Promise(resolve => { releaseFlush = resolve; });
    f.tauri.invoke = async (command, args = {}) => {
        if (command === 'save_app_state' && !args.target) {
            const content = JSON.parse(args.content);
            liveSaves.push({ marker: Boolean(content.metadata?.[RESTORE_POINTS_RESET_KEY]), afterFlush: flushDone });
            if (liveSaves.length === 1) await gate;
            if (failNext) { failNext = false; throw quotaError(); }
        }
        return recorded(command, args);
    };
    P.setItemSync('profile_tagesgeld', '12345');
    const flushing = P.flush().then(result => { flushDone = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 0));
    const marking = P.setMetadata(RESTORE_POINTS_RESET_KEY, { version: 2, installedAt: '2026-11-19T08:00:00.000Z', clearedAt: '2026-11-19T08:00:00.000Z', notice: 'pending' })
        .then(() => 'ok', () => 'failed');
    await new Promise(resolve => setTimeout(resolve, 20));
    assertEqual(liveSaves.length, 1, 'Die Markierung wartet, bis das laufende Speichern fertig ist');
    failNext = false;
    releaseFlush(); await flushing;
    failNext = true;
    assertEqual(await marking, 'failed', 'Ein Schreibfehler der Markierung wird gemeldet');
    assert(liveSaves[1]?.marker && liveSaves[1].afterFlush, 'Die Markierung schreibt erst nach dem Speichern der Eingabe');
    P.setItemSync('sim_mcSeed', '7'); await P.flush();
    f.tauri.invoke = recorded;
    assertEqual(JSON.parse(f.tauri.files.get('live')).records.profile_tagesgeld, '12345', 'Das nächste Speichern behält die bestätigte Eingabe');
}

// 16 · SV-1c „Neu beginnen“: Eine Warnung über Sitzungsreste erreicht den Nutzer; die Seite bleibt dafür stehen.
{
    const storage = quotaStorage(createMusterHaushaltRecords(DATE));
    await bootLocal(storage);
    const session = quotaStorage({ rs_sitzung: '1' });
    session.removeItem = () => { throw new Error('Sitzungsspeicher gesperrt'); };
    let navigations = 0;
    const result = await createNewBeginningController({ guard: createNavigationGuard(), window: { localStorage: storage, sessionStorage: session },
        navigate: () => { navigations += 1; } }).execute({ withoutBackup: true, confirmed: true });
    assertEqual(result.status, 'reload_required', 'Mit Warnung meldet der Dialog das Ergebnis statt sich zu schließen');
    assertEqual(navigations, 0, 'Die Seite navigiert nicht weg, bevor die Warnung gelesen ist');
    assert(/Sitzungsspeicher gesperrt/.test(result.warning || ''), 'Die Warnung nennt den Sitzungsspeicher');
}

// 17 · SV-1d Erststart-Leerung: Ein Jahresabschluss, der nach dem ersten Lesen offen wird, hält das Löschen noch an.
{
    const seed = createMusterHaushaltRecords(DATE), state = JSON.parse(seed.ruhestandsmodellValues_v29_guardrails);
    const open = JSON.stringify({ ...state, annualPeriodMetadata: { schemaVersion: 1,
        lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'jahr-vorab' } } });
    const storage = quotaStorage(seed);
    await bootLocal(storage);
    await legacyPoint('alt-monat', K.monthlyClosePreMutation, seed);
    await SnapshotArchive.createSnapshot({ id: 'jahr-vorab', kind: K.annualClosePreMutation, label: 'Max', records: capture(seed) });
    const update = P.updateMetadata;
    let opened = false;
    P.updateMetadata = async (...args) => {
        const result = await update.apply(P, args);
        // Nach dem ersten Lesen und der Markierung „läuft“ beginnt ein Jahresabschluss und speichert seinen pendingCommit.
        if (!opened) { opened = true; P.setItemSync('ruhestandsmodellValues_v29_guardrails', open); await P.flush(); }
        return result;
    };
    let outcome;
    try { outcome = await resetRestorePointsOnce({ now: () => new Date('2026-11-19T08:00:00Z') }); } finally { P.updateMetadata = update; }
    const ids = async () => (await SnapshotArchive.listSnapshots()).map(entry => entry.id).sort().join(',');
    assertEqual(outcome.status, 'waiting', 'Die Leerung bricht ab, wenn vor dem Löschen ein Abschluss offen ist');
    assertEqual(await ids(), 'alt-monat,jahr-vorab', 'Kein Punkt entfernt, solange der Abschluss offen ist');
    P.setItemSync('ruhestandsmodellValues_v29_guardrails', seed.ruhestandsmodellValues_v29_guardrails); await P.flush();
    assertEqual((await resetRestorePointsOnce()).status, 'cleared', 'Nach dem Abschluss setzt ein späterer Start die Leerung fort');
    assertEqual(await ids(), 'jahr-vorab', 'Nur der alte Monatspunkt ist entfernt');
}
