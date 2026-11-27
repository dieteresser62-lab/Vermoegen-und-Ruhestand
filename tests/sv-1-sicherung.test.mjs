// SV-1 (Nutzer 18.11.2026): Auslöser der Punkte, einmalige Archivleerung mit Hinweis und Beenden des Spielbereichs ohne
// unsichtbaren Seitenfehler. Nur synthetische Daten: Musterhaushalt Max und Erika, Testdatum 2026-10-02.
import { PersistenceFacade as P, persistenceStorage, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS as K } from '../app/shared/snapshot-archive.js';
import { resetRestorePointsOnce, closeRestorePointNotice, isRestorePointNoticeOpen, readRestorePointReset, RESTORE_POINTS_RESET_KEY } from '../app/shared/snapshot-reset.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { createAnnualSnapshot } from '../app/shared/annual-coordinator.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { initializeAssumptionsUI } from '../app/simulator/simulator-assumptions-ui.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';

const DATE = '2026-10-02';
const memory = (records = {}) => {
    const map = new Map(Object.entries(records));
    return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key),
        key: index => [...map.keys()][index] ?? null, get length() { return map.size; }, clear: () => map.clear() };
};
async function bootLocal(records) {
    const storage = memory(records);
    resetPersistenceForTests(createLocalStorageAdapter(storage)); await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return storage;
}
const capture = records => SnapshotArchive.captureCurrentRecords({ keys: Object.keys(records), getItem: key => records[key] });
/** Punkt aus der Zeit vor der vereinfachten Sicherung: ohne Herkunft (SV-1b). */
const legacyPoint = (id, kind, records) => { const { origin, ...point } = SnapshotArchive.buildSnapshot({ id, kind, records: capture(records),
    createdAt: '2026-09-01T10:00:00.000Z' }); return P.writeSnapshot(point); };

// 1 · Auslöser: Jahresabschluss und Einspielen legen je einen Punkt des ganzen Haushalts an; Einspielen behält die letzten drei.
{
    const seed = createMusterHaushaltRecords(DATE);
    await bootLocal(seed);
    const id = await createAnnualSnapshot({ storage: persistenceStorage, archive: SnapshotArchive, profileId: seed.rs_current_profile, label: 'Max',
        date: new Date('2027-01-05T12:00:00Z'), check() {}, navigationOperation: { check() {}, commit() {} } });
    const annual = await SnapshotArchive.readSnapshot(id);
    assertEqual(annual.kind, K.annualClosePreMutation, 'Jahresabschluss legt einen Jahrespunkt an');
    assertEqual(annual.records.rs_profiles_v1, seed.rs_profiles_v1, 'Jahrespunkt hält den ganzen Haushalt');
    const backup = buildFullPersistenceBackup();
    for (let round = 0; round < 4; round++) assert((await importFullPersistenceBackup(structuredClone(backup))).ok, 'Einspielen gelingt ' + (round + 1));
    const imports = (await SnapshotArchive.listSnapshots()).filter(point => point.kind === K.fullBackupImportRecovery);
    assertEqual(imports.length, 3, 'Einspielen legt je einen Punkt an und behält die letzten drei');
    assert((await SnapshotArchive.listSnapshots()).some(point => point.id === id), 'Kürzung lässt Jahrespunkte stehen');
}

// 2 · Einmalige Archivleerung beim ersten Start: Hinweis, Markierung außerhalb der Fachrecords, Schließen und Vollsicherung.
{
    const seed = createMusterHaushaltRecords(DATE);
    const storage = await bootLocal(seed);
    await legacyPoint('alt-person', 'profile-management-before', seed);
    await legacyPoint('alt-monat', K.monthlyClosePreMutation, seed);
    const result = await resetRestorePointsOnce({ now: () => new Date('2026-11-19T08:00:00Z') });
    assertEqual(result.status, 'cleared', 'Erster Start leert das alte Archiv');
    assertEqual((await SnapshotArchive.listSnapshots()).length, 0, 'Archivleerung entfernt alle alten Punkte');
    const marker = await P.getMetadata(RESTORE_POINTS_RESET_KEY);
    assertEqual(readRestorePointReset(marker)?.notice, 'open', 'Hinweis ist offen');
    assert(!Object.keys(await P.readPersistedRecords()).some(key => key.includes('restore_points')), 'Markierung liegt außerhalb der Fachrecords');
    assert(!Object.hasOwn(buildFullPersistenceBackup().records, RESTORE_POINTS_RESET_KEY), 'Markierung gehört nicht zur Vollsicherung');
    const records = await P.readPersistedRecords();
    assert(isRestorePointNoticeOpen(marker, records), 'Daten & Sicherung zeigt den Hinweis');
    assert(!isRestorePointNoticeOpen(marker, { ...records, overview_last_full_backup_v1: '2026-11-19T09:00:00Z' }), 'Eine neue Vollsicherung beendet den Hinweis');
    await SnapshotArchive.createSnapshot({ id: 'neu-monat', kind: K.monthlyClosePreMutation, records: capture(seed) });
    assertEqual((await resetRestorePointsOnce()).status, 'done', 'Zweiter Start leert nicht erneut');
    assertEqual((await SnapshotArchive.listSnapshots()).length, 1, 'Neue Punkte bleiben nach der Leerung');
    assert(await closeRestorePointNotice(), 'Hinweis lässt sich schließen');
    assert(!isRestorePointNoticeOpen(await P.getMetadata(RESTORE_POINTS_RESET_KEY), records), 'Geschlossener Hinweis bleibt geschlossen');
    // Einspielen einer alten Sicherung lässt die Markierung stehen; die Leerung läuft nicht noch einmal.
    assert((await importFullPersistenceBackup(buildFullPersistenceBackup())).ok, 'Einspielen nach der Leerung');
    assertEqual((await resetRestorePointsOnce()).status, 'done', 'Einspielen setzt die Markierung nicht zurück');
    assert(storage.length > 0, 'Speicher bleibt gefüllt');
}

// 3 · Leeres Archiv: Markierung ohne Hinweis. Offener Jahresabschluss oder Spielbereich: die Leerung wartet.
{
    const seed = createMusterHaushaltRecords(DATE);
    await bootLocal(seed);
    assertEqual((await resetRestorePointsOnce()).status, 'cleared', 'Leeres Archiv wird markiert');
    assertEqual(readRestorePointReset(await P.getMetadata(RESTORE_POINTS_RESET_KEY))?.notice, 'closed', 'Ohne entfernte Punkte kein Hinweis');
    const state = JSON.parse(seed.ruhestandsmodellValues_v29_guardrails || '{}');
    const pending = { ...seed, ruhestandsmodellValues_v29_guardrails: JSON.stringify({ ...state, annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: null,
        pendingCommit: { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'offen' } } }) };
    await bootLocal(pending);
    // SV-1b: Jahrespunkte bleiben immer; ein offener Vorgang mit Verweis auf einen alten Monatspunkt lässt die Leerung warten.
    await legacyPoint('offen', K.annualClosePreMutation, seed);
    await resetRestorePointsOnce();
    assertEqual((await SnapshotArchive.listSnapshots()).length, 1, 'Punkt des offenen Jahresabschlusses bleibt');
    await bootLocal({ ...pending, ruhestandsmodellValues_v29_guardrails: pending.ruhestandsmodellValues_v29_guardrails.replace('"offen"', '"offen-monat"') });
    await legacyPoint('offen-monat', K.monthlyClosePreMutation, seed);
    assertEqual((await resetRestorePointsOnce()).status, 'waiting', 'Offener Vorgang mit Verweis auf einen alten Punkt: die Leerung wartet');
    assertEqual((await SnapshotArchive.listSnapshots()).length, 1, 'Punkt des offenen Vorgangs bleibt');
    const f = await playFixture('tauri', seed);
    let c = await f.boot();
    await c.start(async () => ({ source: 'copy', testDate: null }));
    c = await f.boot();
    assertEqual((await resetRestorePointsOnce()).status, 'waiting', 'Im Spielbereich wartet die Leerung auf den echten Bereich');
}

// 4 · Beenden des Spielbereichs: drei Varianten, danach liest die alte Seite den Speicher nicht mehr; die Beobachter bleiben angemeldet.
function observedAssumptions() {
    const doc = createPresentationTestDocument(), create = doc.createElement.bind(doc);
    doc.createElement = tag => { const node = create(tag); node.dataset = {}; node.addEventListener = () => {}; node.querySelectorAll = () => []; node.querySelector = () => null; return node; };
    const host = doc.createElement('div'); host.id = 'tab-annahmen';
    // Sichtbare Spur der Auffrischung: Die Einheit der Ehedauer setzt nur refreshAssumptionFillStatus.
    const unit = doc.createElement('span'), years = doc.createElement('input');
    years.id = 'widowMinMarriageYears'; years.value = '2'; years.parentElement = { querySelector: selector => selector === '.ds-field-unit' ? unit : null };
    let callback, observed = 0;
    doc.addEventListener = () => {};
    doc.defaultView = { MutationObserver: class { constructor(fn) { callback = fn; } observe() { observed++; } disconnect() {} } };
    initializeAssumptionsUI(doc);
    return { fire: () => { unit.textContent = ''; callback(); return unit.textContent !== ''; }, get observed() { return observed; } };
}
for (const variant of ['Beispiel verwerfen', 'Spielkopie verwerfen', 'Spielkopie übernehmen']) {
    const f = await playFixture('tauri', createMusterHaushaltRecords(DATE));
    let c = await f.boot();
    await c.start(async () => variant === 'Beispiel verwerfen' ? { source: 'demo', householdId: 'max-erika', testDate: DATE } : { source: 'copy', testDate: null });
    c = await f.boot();
    const observer = observedAssumptions();
    const before = observer.observed;
    const result = await c.end(async () => variant === 'Spielkopie übernehmen' ? { action: 'transfer', review: await c.readEndReview() } : true);
    assertEqual(result.status, 'reloaded', variant + ': beendet');
    assert(P.getPersistenceStatus().reloadRequired, variant + ': alte Seite gilt als veraltet');
    let readError = null; try { P.getItemSync('profile_tagesgeld'); } catch (error) { readError = error; }
    assert(readError?.message.includes('Speicherbereich geändert'), variant + ': direkter Speicherzugriff wäre der unsichtbare Seitenfehler');
    assert(!observer.fire(), variant + ': Simulator-Beobachter frischt nach dem Bereichswechsel nicht mehr auf');
    assertEqual(observer.observed, before + 1, variant + ': Simulator-Beobachter liest nicht und bleibt angemeldet');
}

// 5 · Fehlerpfade: gescheitertes Verwerfen vor dem Bereichswechsel sperrt nicht; gescheiterte Übernahme lässt Beobachter und Lesen weiterlaufen.
{
    const f = await playFixture('tauri', createMusterHaushaltRecords(DATE));
    let c = await f.boot();
    await c.start(async () => ({ source: 'copy', testDate: null }));
    c = await f.boot();
    f.fail = true; // erster Dateizugriff ist der Bereichswechsel
    let error = null;
    try { await c.end(async () => true); } catch (caught) { error = caught; }
    assert(error?.areaUnchanged, 'Verwerfen scheitert vor dem Bereichswechsel');
    assert(!P.getPersistenceStatus().reloadRequired && !c.blocked, 'Gescheitertes Verwerfen sperrt nicht bis zum Neuladen');
    assertEqual(P.getPersistenceStatus().activeArea, 'spiel', 'Spielbereich bleibt aktiv');
    assert(P.getItemSync('profile_tagesgeld') !== undefined, 'Seite bleibt bedienbar');
    assertEqual((await c.end(async () => true)).status, 'reloaded', 'Erneutes Verwerfen gelingt');
}
{
    const f = await playFixture('tauri', createMusterHaushaltRecords(DATE));
    let c = await f.boot();
    await c.start(async () => ({ source: 'copy', testDate: null }));
    c = await f.boot();
    P.setItemSync('profile_tagesgeld', '12345'); await P.flush();
    const observer = observedAssumptions();
    const invoke = f.tauri.invoke, live = () => f.tauri.files.get('live');
    let failControl = true;
    f.tauri.invoke = async (command, args = {}) => {
        if (command === 'save_app_state' && args.target === 'control' && failControl) { failControl = false; throw new Error('SYNTHETIC_FINISH_TRANSFER'); }
        return invoke(command, args);
    };
    const realBefore = live();
    let failure = null;
    try { await c.end(async () => ({ action: 'transfer', review: await c.readEndReview() })); } catch (caught) { failure = caught; }
    f.tauri.invoke = invoke;
    assert(failure?.message.includes('Nicht übernommen'), 'Übernahme scheitert beim Bereichswechsel und wird zurückgenommen');
    assertEqual(live(), realBefore, 'Zurückgenommene Übernahme lässt den echten Bestand bytegleich');
    assert(!P.getPersistenceStatus().reloadRequired && !c.blocked, 'Zurückgenommene Übernahme sperrt die Seite nicht');
    assertEqual(P.getItemSync('profile_tagesgeld'), '12345', 'Spielbereich bleibt lesbar');
    const before = observer.observed;
    assert(observer.fire(), 'Simulator-Beobachter frischt nach zurückgenommener Übernahme wieder auf');
    assertEqual(observer.observed, before + 1, 'Simulator-Beobachter bleiben nach zurückgenommener Übernahme angemeldet');
}
