import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { createProbelaufController, PROBELAUF_STATE_KEY as KEY, PROBELAUF_SESSION_KEYS, validateProbelaufState } from '../app/shared/probelauf-state.js';
import { SnapshotArchive as A, SNAPSHOT_KINDS } from '../app/shared/snapshot-archive.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { MUSTER_HAUSHALTE, musterHaushalt } from '../app/demo/muster-haushalte.js';
import { getAppTestDate, setAppTestDate, localCalendarDate } from '../app/shared/app-clock.js';
import { ANNUAL_PLAN_RECORD_KEY, readAnnualPlanRecord } from '../app/profile/annual-plan-record.js';
import { planScope } from '../app/profile/household-plan.js';
import { validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { projectOverview } from '../app/overview/overview-model.js';
import { buildFullPersistenceBackup, assertFullBackupAllowed } from '../app/shared/persistence-backup.js';
import { isProbelaufRecordKey } from '../app/shared/persistence-key-policy.js';
import { balanceStorageFixture } from './helpers/balance-storage-fixtures.mjs';
import { AREA_CONTROL_KEY, PLAY_STORAGE_PREFIX, PLAY_DB_NAME } from '../app/shared/persistence-area-storage.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { migratePersonData } from '../app/profile/profile-person-migration.js';
const reject = async (run, label) => { let error; try { await run(); } catch (cause) { error = cause; } assert(error, label); return error; };
const selection = () => ({ source: 'copy', testDate: '2026-12-15' });
const realRecords = { ...createMusterHaushaltRecords('2026-12-15'), profile_tagesgeld: ' 12000.00 ', overview_last_full_backup_v1: 'original timestamp' };
for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
    for (const source of ['copy', 'demo']) {
        const f = await playFixture(kind, realRecords);
        let c = await f.boot();
        await A.createSnapshot({ id: 'old', label: 'Vorhanden', records: { profile_tagesgeld: ' 12000.00 ' } });
        f.session.setItem(PROBELAUF_SESSION_KEYS[0], 'echte Sitzung');
        const before = f.realBytes();
        assertEqual((await c.start(() => null)).status, 'cancelled', 'Abbruch schreibt nichts');
        assert(f.realBytes() === before, `${kind}: Abbruch erhält echte Bytes`);
        const result = await c.start(async () => {
            assertEqual(P.getItemSync(KEY), null, 'Keine echte Steuerphase vor Auswahl');
            return { source, testDate: '2026-12-15' };
        });
        assertEqual(result.status, 'reloaded', `${kind}/${source}: Start`);
        assertEqual(c.state.version, 2, 'Neuer Vertrag ohne Rückkehrsnapshot');
        assertEqual(c.state.snapshotId, undefined, 'Kein neuer Rückkehrpunkt');
        assert(f.realBytes() === before, `${kind}/${source}: Start unverändert`);
        c = await f.boot();
        assertEqual(getAppTestDate(), '2026-12-15', 'Neustart setzt Testdatum');
        if (source === 'copy') assertEqual((await A.readSnapshot('old')).records.profile_tagesgeld, ' 12000.00 ', 'Kopie erhält verfügbare Sicherungspunkte im Spielbereich');
        assertEqual(P.getPersistenceStatus().activeArea, 'spiel', 'Neustart setzt Spielbereich');
        await reject(() => assertFullBackupAllowed(), 'Vollsicherung und Import auch ohne Koordinator gesperrt');
        await reject(() => P.importAll({ records: { profile_tagesgeld: '100' } }, { replace: true }), 'Import bleibt gesperrt');
        await reject(() => c.start(selection), 'Weiterer Start kann nicht nach echt wechseln');
        P.setItemSync('profile_gold_aktiv', 'true'); P.setItemSync('profile_tagesgeld', '99999'); await P.flush();
        await A.createSnapshot({ id: 'spiel-punkt', records: { profile_tagesgeld: '99999' } });
        await c.changeDate('2027-01-02'); c = await f.boot();
        assertEqual(P.getItemSync('profile_gold_aktiv'), 'true', 'Fachänderungen bleiben nach Datumssprung erhalten');
        assert(f.realBytes() === before, `${kind}/${source}: Änderungen und Neustart unverändert`);
        assertEqual((await c.end(() => false)).status, 'cancelled', 'Weiter spielen');
        assertEqual(P.getPersistenceStatus().activeArea, 'spiel', 'Abbruch bleibt im Spielbereich');
        assertEqual((await c.end(() => true)).status, 'reloaded', 'Beenden');
        assert(f.realBytes() === before, `${kind}/${source}: Beenden bytegleich`);
        c = await f.boot();
        assertEqual(c.state, null, 'Echter Neustart ohne Spielzustand');
        assertEqual(getAppTestDate(), null, 'Systemuhr nach Ende');
        assert(f.realBytes() === before, `${kind}/${source}: Rückkehrstart unverändert`);
        assertEqual((await A.listSnapshots()).length, 1, 'Echte Sicherungspunkte ohne Zusatzpunkt');
        assertEqual(P.getItemSync('profile_tagesgeld'), realRecords.profile_tagesgeld, 'Echte Rohstrings wieder sichtbar');
    }
    // Ältere Originalrecords werden ausschließlich in der Spielkopie ergänzt.
    const legacy = balanceStorageFixture('Altbestand').records;
    const f = await playFixture(kind, legacy); let c = await f.boot(); const before = f.realBytes();
    await c.start(selection); c = await f.boot();
    assert(P.getItemSync('household_plan_v1'), 'Altkopie erhält direkten Plan');
    await c.end(() => true); assert(f.realBytes() === before, `${kind}: Altbestand unverändert`);
}
// Ohne Datum startet jede Quelle mit echten Kurswegen, auch bei Altbestand.
for (const kind of ['tauri', 'indexeddb', 'localstorage']) for (const source of ['copy', 'demo']) {
    const f = await playFixture(kind, balanceStorageFixture('Altbestand').records);
    let c = await f.boot(); const before = f.realBytes();
    await c.start(() => ({ source })); c = await f.boot();
    assertEqual(getAppTestDate(), null, `${kind}/${source}: Start ohne Testdatum nutzt Systemdatum`);
    assertEqual(c.state.hasDateJump, false, 'Steuerdatensatz merkt Stand heute');
    if (source === 'demo') assertEqual(P.getItemSync('rs_daily_prices_v1'), null, 'Musterverlauf lässt echte Kursabrufe zu');
    await c.end(() => true); await f.boot();
    assertEqual(f.realBytes(), before, `${kind}/${source}: Stand heute mit Altbestand lässt echte Daten bytegleich`);
}
// SD-3: Musterstart mit Jahresbeleg auf den echten Start- und Speicherwegen.
const today = localCalendarDate(new Date()), currentYear = Number(today.slice(0, 4));
for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
    for (const date of [null, `${currentYear}-06-15`, `${currentYear}-01-01`, `${currentYear + 1}-01-02`]) {
        const f = await playFixture(kind, balanceStorageFixture('Altbestand').records);
        let c = await f.boot();
        await A.createSnapshot({ id: 'sd3-original', label: 'Echter Altbestand', records: balanceStorageFixture('Altbestand').records });
        const before = f.realBytes(), startDate = date ?? today, year = Number(startDate.slice(0, 4));
        await c.start(() => ({ source: 'demo', testDate: date }));
        c = await f.boot();
        assertEqual(getAppTestDate(), date, `${kind}/${startDate}: Stand heute und Testdatum bleiben unterscheidbar`);
        const records = await P.readPersistedRecords(isProbelaufRecordKey);
        assert(validatePersistenceDomainRecords(records, { requireProfileContext: true }).ok, 'Musterstart besteht die echte Domainprüfung');
        const scope = planScope('household', ['muster_a', 'muster_b']);
        const receipt = readAnnualPlanRecord({ year, scope, storage: { getItem: key => records[key] ?? null } });
        assertEqual(receipt.periodId, `calendar-year:${year - 1}`, `${kind}/${startDate}: Musterstart enthält passenden Vorjahresbeleg`);
        const model = projectOverview({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_active_profile,
            liveData: records, now: new Date(`${startDate}T12:00:00`) });
        assertEqual(model.planComparison.recordStatus, 'valid', 'Neustart zeigt festgeschriebenen Musterplan');
        assertEqual(model.occasion.annualState, 'done', 'Januar-Musterstart fordert keinen zweiten Vorjahresabschluss');
        const raw = records[ANNUAL_PLAN_RECORD_KEY];
        await c.changeDate(`${year + 1}-01-03`); c = await f.boot();
        assertEqual(P.getItemSync(ANNUAL_PLAN_RECORD_KEY), raw, 'Späterer Datumssprung ersetzt den festen Musterbeleg nicht');
        assertEqual(f.realBytes(), before, `${kind}/${startDate}: Musterbeleg, Neustart und Datumssprung lassen echte Daten und Archiv bytegleich`);
        await c.end(() => true); await f.boot();
        assertEqual(f.realBytes(), before, `${kind}/${startDate}: Verwerfen des Musterbelegs erhält echte Daten und Archiv bytegleich`);
    }
}
// Auch die echte Personenübernahme darf eine alte Spielkopie bedienbar machen.
for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
    const data = { profile_aktuelles_alter: '67', profile_rente_monatlich: '0', profile_rente_aktiv: 'false',
        sim_p1Monatsrente: '1234', sim_p1StartInJahren: '1' };
    const records = { rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
        a: { meta: { id: 'a', name: 'Max', belongsToHousehold: true }, data }
    } }), rs_current_profile: 'a', rs_active_profile: 'a', ...data };
    const f = await playFixture(kind, records); let c = await f.boot(); const before = f.realBytes();
    await c.start(() => ({ source: 'copy', testDate: null })); c = await f.boot();
    const result = await migratePersonData({ doc: null, win: null, now: 2026,
        decide: async ({ rows }) => Object.fromEntries(rows.map(row => [row.id, '1'])) });
    assertEqual(result.status, 'migrated', `${kind}: alte Spielkopie lässt Personenübernahme zu`);
    assertEqual(P.getItemSync('profile_rente_monatlich'), '1234', 'Rentenwahl in der Spielkopie übernommen');
    assertEqual(f.realBytes(), before, `${kind}: Personenübernahme verändert keine echten Bytes`);
    await c.end(() => true); await f.boot();
    assertEqual(f.realBytes(), before, `${kind}: Beenden der alten Spielkopie erhält echte Bytes`);
}
// Update: jede alte Phase kehrt einmalig über den unveränderten Rückkehrvertrag zurück.
for (const kind of ['tauri', 'indexeddb', 'localstorage']) for (const phase of ['starting', 'active', 'restoring']) {
    const originals = { ...balanceStorageFixture('Altbestand').records, profile_tagesgeld: ' 001.20 ' };
    const f = await playFixture(kind, originals); await f.boot();
    await A.createSnapshot({ id: 'alt', records: originals });
    await A.createSnapshot({ id: 'return', label: 'Vor Probelauf', kind: SNAPSHOT_KINDS.probelaufBefore, records: originals });
    await A.createSnapshot({ id: 'test', records: {} });
    const state = { version: 1, active: true, phase, snapshotId: 'return', archiveIds: ['alt'], source: 'copy', runtime: 'browser',
        testDate: '2027-01-02', sessions: Object.fromEntries(PROBELAUF_SESSION_KEYS.map(k => [k, null])) };
    P.setItemSync(KEY, JSON.stringify(state)); P.setItemSync('profile_tagesgeld', 'ersetzte Spieldaten'); await P.flush();
    const c = await f.boot();
    assertEqual(c.state, null, `${kind}/${phase}: alte Sitzung automatisch beendet`);
    assertEqual(P.getItemSync('profile_tagesgeld'), originals.profile_tagesgeld, 'Alter Rückweg erhält Rohbytes');
    assertEqual(P.getItemSync(KEY), null, 'Alte Steuerung entfernt');
    const restored = await P.readPersistedRecords(isProbelaufRecordKey);
    assert(JSON.stringify(Object.entries(restored).sort()) === JSON.stringify(Object.entries(originals).filter(([key]) => isProbelaufRecordKey(key)).sort()), 'Alter Rückweg bestätigt sämtliche Original-Rohrecords bytegleich');
    assertEqual((await A.listSnapshots()).map(p => p.id).sort().join(','), 'alt,return', 'Nur alte Originalpunkte und Rückkehrpunkt bleiben');
    const before = f.realBytes(); await f.boot(); assert(f.realBytes() === before, 'Ablösung läuft nur einmal');
}
for (const failure of ['missing', 'damaged', 'write']) {
    const f = await playFixture('tauri', realRecords); await f.boot();
    if (failure !== 'missing') await A.createSnapshot({ id: 'return', label: failure === 'damaged' ? 'falsch' : 'Vor Probelauf', kind: SNAPSHOT_KINDS.probelaufBefore, records: realRecords });
    const state = { version: 1, active: true, phase: 'active', snapshotId: 'return', archiveIds: [], source: 'copy', runtime: 'tauri', testDate: '2027-01-02', sessions: Object.fromEntries(PROBELAUF_SESSION_KEYS.map(k => [k, null])) };
    P.setItemSync(KEY, JSON.stringify(state)); await P.flush();
    P.resetPersistenceRuntimeForTests(); await P.init(f.options); f.fail = failure === 'write';
    const c = createProbelaufController({ win: f.win, reload() {}, restoreReload() {} });
    const error = await reject(() => c.initialize(), 'Fehler bei Ablösung bleibt sichtbar');
    assert(error.message.includes('Sicherung und Import bleiben gesperrt'), 'Klare Ablösungsmeldung');
    assert(c.blocked && c.state.snapshotId === 'return', 'Rückkehrpunkt und Sperre erhalten');
    await reject(() => assertFullBackupAllowed({ probelaufController: c }), 'Sicherung im alten Fehlerzustand gesperrt');
    await reject(() => c.start(selection), 'Kein neuer Spielbereich vor alter Rückkehr');
    if (failure === 'write') assertEqual((await c.end(() => true)).status, 'reloaded', 'Alter Rückweg kann erneut versucht werden');
}
// Auch ein beschädigter Sitzungsrecord im fertigen Spielbereich lässt Beenden zu.
for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
    const f = await playFixture(kind, realRecords); let c = await f.boot(); const before = f.realBytes();
    await c.start(selection); await f.boot();
    P.setItemSync(KEY, '{beschädigt'); await P.flush();
    P.resetPersistenceRuntimeForTests(); await P.init(f.options);
    c = createProbelaufController({ win: f.win, reload() {}, restoreReload() {} });
    await reject(() => c.initialize(), 'Beschädigte Spielsitzung sperrt Fachdatenstart');
    assert(c.blocked && c.state, 'Beenden bleibt trotz beschädigter Spielsitzung erreichbar');
    await reject(() => assertFullBackupAllowed(), 'Sperre im Spielbereich braucht keinen lesbaren Sitzungsrecord');
    assertEqual((await c.end(() => true)).status, 'reloaded', 'Beschädigte Spielsitzung sicher verworfen');
    assert(f.realBytes() === before, 'Beschädigte Spielsitzung ändert echte Bytes nicht');
}
// Fehler beim Anlegen löscht den halben Bereich sofort und erlaubt einen neuen Versuch.
for (const stage of ['preparing', 'spiel', 'active']) {
    const f = await playFixture('tauri', realRecords); let c = await f.boot(); const before = f.realBytes();
    const originalInvoke = f.options.invoke;
    let failed = false;
    f.options.invoke = async (command, args) => {
        if (!failed && command === 'save_app_state' && (args.target === stage || args.target === 'control' && JSON.parse(args.content).phase === stage)) {
            failed = true; throw new Error('Unterbrochener Start');
        }
        return originalInvoke(command, args);
    };
    c = await f.boot(); await reject(() => c.start(selection), 'Anlegefehler sichtbar');
    assert(f.realBytes() === before, 'Anlegefehler lässt echt bytegleich');
    assert(!f.tauri.files.has('spiel') && !f.tauri.files.has('spielsnapshots'), 'Halbe Spieldateien entfernt');
    assertEqual(JSON.parse(f.tauri.files.get('control')).activeArea, 'echt', 'Steuerung zurück auf echt');
    f.options.invoke = originalInvoke; c = await f.boot();
    assertEqual((await c.start(selection)).status, 'reloaded', 'Neuer Start nach Fehler möglich');
}
// Warten auf fremden Commit ist zeitlich begrenzt und erzeugt keine späten Writes.
for (const releaseWriter of [true, false]) {
    const f = await playFixture('tauri', realRecords); const guard = createNavigationGuard();
    let elapsed = 0, lease = guard.register('foreign', { read: () => ({ phase: 'commit' }) });
    const c = await f.boot({ guard, clock: () => elapsed, wait: async ms => { elapsed += ms; if (releaseWriter && elapsed >= 100) { lease.unregister(); lease = null; } } });
    const before = f.realBytes(); const result = await c.start(selection);
    assertEqual(result.status, releaseWriter ? 'reloaded' : 'cancelled', 'Commitwartephase endet korrekt');
    assert(f.realBytes() === before, 'Wartephase und Fortsetzung erhalten echte Bytes');
    if (!releaseWriter) { assertEqual(result.error.code, 'PROBELAUF_COMMIT_BUSY', 'Timeout wiederholbar'); assertEqual(c.state, null, 'Kein verspäteter Start'); }
    lease?.unregister();
}
assertEqual(validateProbelaufState(null), null, 'Leerer Zustand');
for (const household of MUSTER_HAUSHALTE) for (const date of [null, '2026-11-02']) {
    const f = await playFixture('tauri', realRecords);
    let c = await f.boot(); const before = f.realBytes();
    await c.start(() => ({ source: 'demo', householdId: household.id, testDate: date })); c = await f.boot();
    assertEqual(c.state.householdId, household.id, 'Gewählter Haushalt bleibt beim Neustart erhalten');
    assertEqual(c.state.testDate, date, 'Jeder Beispielhaushalt unterstützt Stand heute und Spielkurse');
    const review = await c.readEndReview();
    const transferError = await reject(() => c.end(() => ({ action: 'transfer', review })), 'Kein Beispielhaushalt darf übernommen werden');
    assert(transferError.message.includes(household.name), 'Übernahmesperre nennt den gewählten Haushalt');
    if (date === null) assertEqual(P.getItemSync('rs_daily_prices_v1'), null, 'Stand heute behält keinen synthetischen Verlauf');
    if (household.id === 'max-erika') {
        // Rohzustand der Produktiv-EXE ohne neues Haushaltsfeld.
        const old = JSON.parse(f.values[KEY]); delete old.householdId; f.values[KEY] = JSON.stringify(old);
        c = await f.boot();
        assertEqual(musterHaushalt(validateProbelaufState(f.values[KEY]).householdId).name, 'Max und Erika', 'Fehlendes Feld wird als Max und Erika gelesen');
        await c.changeDate('2027-01-02'); c = await f.boot();
        assertEqual(musterHaushalt(c.state.householdId).id, 'max-erika', 'Alter Zustand bleibt nach Datumssprung fortsetzbar');
    }
    await c.end(() => true); await f.boot();
    assertEqual(f.realBytes(), before, 'Auch alte Zustände und neue Haushalte werden bytegleich beendet');
}
for (const householdId of ['unbekannt', null, 7]) {
    const error = await reject(() => validateProbelaufState({ version: 2, active: true, phase: 'active',
        source: 'demo', runtime: 'tauri', testDate: null, householdId }), 'Unbekannter Haushalt wird abgewiesen');
    assert(error.message.includes('Beschädigter Spielbereich-Zustand'), 'Unbekannter Wert meldet beschädigten Zustand');
}
assert(!(KEY in buildFullPersistenceBackup({ storage: { keysSync: () => [KEY], getItemSync: () => '{}' } }).records), 'Steuerung bleibt außerhalb Backups');
P.resetPersistenceForTests(); setAppTestDate(null);
