import { buildPersonMigrationDraft, applyPersonMigrationChoices, migratePersonData, LEGACY_PERSON_KEYS } from '../app/profile/profile-person-migration.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from '../app/shared/snapshot-archive.js';
import { isAllowedSnapshotRestoreLiveKey } from '../app/shared/persistence-key-policy.js';
import { persistenceStorage } from '../app/shared/persistence-facade.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { captureProfileData } from '../app/profile/profile-live-storage.js';
import { exportProfilesBundle, importProfilesBundle, switchProfile, saveCurrentProfileFromLocalStorage } from '../app/profile/profile-storage.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { PERSON_VALUE_KEYS } from '../app/profile/profile-person-data.js';
import { readHouseholdPersonStatus, showPersonDataStatus } from '../app/shared/person-data-status.js';

const snapshot = records => JSON.stringify(Object.entries(records).sort());
function records(data = {}, other = null) {
    const profiles = { a: { meta: { id: 'a', name: 'Synthetische Person A', belongsToHousehold: true }, data } };
    if (other) profiles.b = { meta: { id: 'b', name: 'Synthetische Person B', belongsToHousehold: false }, data: other };
    return { rs_profiles_v1: JSON.stringify({ version: 1, profiles }), rs_current_profile: 'a', rs_active_profile: 'a', ...data };
}
{
    const input = records({ profile_aktuelles_alter: '67', profile_rente_monatlich: '900',
        [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { renteMonatlich: 1100 } }) });
    input.profile_rente_monatlich = '1000';
    input[CONFIG.STORAGE.LS_KEY] = JSON.stringify({ inputs: { renteMonatlich: 1200 } });
    const draft = buildPersonMigrationDraft(input, { referenceYear: 2026 });
    const candidates = draft.people[0].candidates.renteMonatlich;
    assertEqual(candidates.map(item => item.value).sort((a, b) => a - b).join(','), '900,1000,1100,1200', 'Registry und Live bleiben auch bei Balance getrennte belegte Quellen');
    candidates.forEach((candidate, index) => assertEqual(applyPersonMigrationChoices(draft, { a: { renteMonatlich: index } }).profile_rente_monatlich,
        String(candidate.value), 'Jede Registry-/Live-/Balanceauswahl bleibt exakt'));
}
for (const data of [{ profile_aktuelles_alter: '67', profile_rente_monatlich: '1000' }, { sim_p1StartAlter: '67', sim_p1Monatsrente: '1000' }, { [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { aktuellesAlter: 67, renteMonatlich: 1000, renteAktiv: false, sparerPauschbetrag: 0 } }) }]) {
    const input = records(data); const before = snapshot(input);
    const draft = buildPersonMigrationDraft(input, { referenceYear: 2026 });
    const migrated = applyPersonMigrationChoices(draft);
    assertEqual(snapshot(input), before, 'Reiner Entwurf verändert keine Rohrecords');
    assertEqual(migrated.profile_aktuelles_alter, '67', 'Alter stammt aus belegter Quelle');
    assertEqual(migrated.profile_rente_monatlich, '1000', 'Betrag wird einmal übernommen');
    assertEqual(migrated.profile_geburtsdatum, '', 'Kein erfundener Geburtstag');
    assertEqual(JSON.parse(migrated.profile_person_migration_v1).suggestedBirthYear, 1958, 'Geburtsjahr bleibt Vorschlag');
    assert(LEGACY_PERSON_KEYS.every(key => !Object.hasOwn(migrated, key)), 'Nur explizite Altpersonenkeys verschwinden');
}
{
    const draft = buildPersonMigrationDraft(records({ profile_aktuelles_alter: '67', profile_rente_monatlich: '0', sim_p1Monatsrente: '1234.567', sim_mcSeed: '42' }), { referenceYear: 2026 });
    for (const index of [0, 1]) {
        const migrated = applyPersonMigrationChoices(draft, { a: { renteMonatlich: index } });
        assertEqual(migrated.profile_rente_monatlich, index ? '1234.567' : '0', 'Jede Konfliktquelle ist auswählbar');
        assertEqual(migrated.sim_mcSeed, '42', 'Seed ist keine Personeneigenschaft');
    }
    assertEqual(draft.people[0].candidates.alter.length, 1, 'Gleiche Werte erzeugen keinen Konflikt');
}
{
    const input = records({ sim_p1StartAlter: '67', sim_r2StartAlter: '65', sim_r2Brutto: '12000' }, { profile_aktuelles_alter: '65' });
    const draft = buildPersonMigrationDraft(input, { referenceYear: 2026 });
    assertEqual(draft.pendingAssignments.length, 1, 'Außenperson ist kein automatisch belegter Partner');
    const assigned = buildPersonMigrationDraft(input, { referenceYear: 2026, partnerTargets: { a: 'b' } });
    const migrated = applyPersonMigrationChoices(assigned);
    const registry = JSON.parse(migrated.rs_profiles_v1);
    assertEqual(Object.keys(registry.profiles).length, 2, 'Keine doppelte Person');
    assertEqual(registry.profiles.b.data.profile_rente_monatlich, '1000', 'Jahresbetrag nutzt bestehende Monatsumrechnung');
    assertEqual(registry.profiles.b.meta.belongsToHousehold, false, 'Keine automatische Mitgliedschaft');
}

function fixture(initial, fault = '') {
    let backend = { ...initial }, writes = 0, reads = 0, snapshotWrites = 0;
    const archive = new Map();
    const adapter = { name: 'Personen-Testspeicher', async init() {}, async loadAll() {
        reads++;
        if (fault === 'readback' && writes === 1) return { ...backend, profile_rente_monatlich: '9999' };
        return { ...backend };
    }, async saveBatch({ upserts, deletes }) {
        writes++;
        if (fault === 'write' && writes === 1 || fault === 'rollback' && writes <= 2) throw new Error('synthetischer Schreibfehler');
        deletes.forEach(key => delete backend[key]); upserts.forEach(([key, value]) => { backend[key] = value; });
    }, async listSnapshots() { return [...archive.values()].map(({ records, ...entry }) => entry); }, async writeSnapshot(value) {
        snapshotWrites++;
        if (fault === 'backup') throw new Error('synthetischer Sicherungsfehler');
        archive.set(value.id, structuredClone(value));
    }, async readSnapshot(id) {
        const value = structuredClone(archive.get(id));
        if (fault === 'backup-read') value.records.rs_current_profile = 'falsch';
        return value;
    } };
    return { adapter, backend: () => backend, writes: () => writes, reads: () => reads, snapshots: () => snapshotWrites, archive };
}

// Gemischte Null-/fehlende Felder und wechselseitige Partnerkopien werden
// personenweise zusammengeführt, statt Beträge oder Personen zu verdoppeln.
{
    const input = records({ profile_aktuelles_alter: '67', profile_rente_monatlich: null,
        sim_p1Monatsrente: '1000', sim_p1SparerPauschbetrag: '0', sim_r2Monatsrente: '2000' },
    { profile_aktuelles_alter: '65', profile_rente_monatlich: '2000', sim_r2Monatsrente: '1000', profile_rente_aktiv: 'false' });
    const registry = JSON.parse(input.rs_profiles_v1); registry.profiles.b.meta.belongsToHousehold = true;
    input.rs_profiles_v1 = JSON.stringify(registry);
    const draft = buildPersonMigrationDraft(input, { referenceYear: 2026 });
    assertEqual(draft.pendingAssignments.length, 0, 'Zwei belegte Mitglieder ordnen Partnerkopien wechselseitig zu');
    assertEqual(draft.people[0].candidates.renteMonatlich.length, 1, 'Gleiche P1-/P2-Beträge sind eine Quelle');
    const migrated = applyPersonMigrationChoices(draft), next = JSON.parse(migrated.rs_profiles_v1);
    assertEqual(Object.keys(next.profiles).length, 2, 'Wechselseitige Kopien erzeugen keine Doppelperson');
    assertEqual(Object.values(next.profiles).reduce((sum, p) => sum + Number(p.data.profile_rente_monatlich), 0), 3000, 'Jede Rente zählt genau einmal');
    assertEqual(migrated.profile_sparer_pauschbetrag, '0', 'Nullwert wird nicht durch einen Default ersetzt');
}

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
{
    const input = records({ profile_aktuelles_alter: '67', sim_r2Steuerquote: '25' }, { profile_aktuelles_alter: '65' });
    const draft = buildPersonMigrationDraft(input, { referenceYear: 2026, partnerTargets: { a: 'b' } });
    const candidates = draft.people.find(person => person.id === 'b').candidates.renteSteuerquotePct;
    assertEqual(candidates.map(candidate => candidate.value).join(','), '0,25', 'Abweichende P2-Steuerquote verlangt Auswahl gegen die bisher wirksame Nullbasis');
    for (const index of [0, 1]) assertEqual(JSON.parse(applyPersonMigrationChoices(draft, { b: { renteSteuerquotePct: index } }).rs_profiles_v1).profiles.b.data.profile_rente_steuerquote_pct,
        String(index ? 25 : 0), 'Jede ausdrücklich gewählte Steuerquotenbasis bleibt erhalten');
}
async function install(f) {
    PersistenceFacade.resetPersistenceForTests(f.adapter);
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
{
    const initial = records({ profile_aktuelles_alter: '67', sim_p1Monatsrente: '1000' });
    const f = fixture(initial), gate = deferred(), entered = deferred(); await install(f);
    const originalSave = f.adapter.saveBatch;
    f.adapter.saveBatch = async batch => { entered.resolve(); await gate.promise; return originalSave(batch); };
    PersistenceFacade.setItemSync('sim_mcSeed', '42');
    const options = { doc: null, win: null, now: 2026, decide: async () => { throw new Error('Kein Konflikt erwartet'); } };
    const first = migratePersonData(options), second = migratePersonData(options);
    assertEqual(first, second, 'Gleichzeitiger Start teilt denselben Koordinator');
    await entered.promise;
    assertEqual(f.snapshots(), 0, 'Verzögerter Vorflush wird vor Recovery und Mutation abgewartet');
    gate.resolve(); await first;
    assertEqual([...f.archive.values()][0].records.sim_mcSeed, '42', 'Recovery enthält auch den bestätigten Vorflush');
    assertEqual(f.snapshots(), 1, 'Doppelstart sichert genau einmal');
    const durable = snapshot(f.backend());
    await install(f); // Reload: alle Reads stammen erneut aus dem Backend.
    assertEqual((await migratePersonData(options)).status, 'current', 'Reload erkennt abgeschlossenen Bestand ohne Prozessmarker');
    assertEqual(snapshot(f.backend()), durable, 'Reload erzeugt keine zweite Mutation');
    assertEqual(f.snapshots(), 1, 'Reload erzeugt keine zweite Sicherung');
    PersistenceFacade.resetPersistenceRuntimeForTests();
}
{
    const f = fixture(records({ profile_aktuelles_alter: '67', profile_rente_monatlich: '1000', sim_p1Monatsrente: '1100' }));
    await install(f); const before = snapshot(f.backend()), entered = deferred();
    const guard = createNavigationGuard({ decide: async () => true });
    const pending = migratePersonData({ doc: null, win: null, now: 2026, guard,
        decide: ({ signal }) => new Promise(resolve => { entered.resolve(); signal.addEventListener('abort', () => resolve(null), { once: true }); }) });
    await entered.promise;
    const attempt = await guard.prepare();
    assertEqual((await pending).status, 'cancelled', 'Kontextwechsel kündigt den offenen Personendialog');
    assertEqual(snapshot(f.backend()), before, 'Kontextabbruch erhält dauerhaft gelesene Fachbytes');
    assert(attempt && guard.reasons().length === 0, 'Kontextwechsel wartet vollständiges Listener-/Handlerende ab');
    guard.end(attempt); PersistenceFacade.resetPersistenceRuntimeForTests();
}
{
    const completed = { profile_person_schema_version: '1', profile_geburtsdatum: '1960-01-01',
        profile_rente_monatlich: '2222.222', profile_sparer_pauschbetrag: '0' };
    const initial = records({ profile_aktuelles_alter: '67', sim_p1Monatsrente: '1000', sim_r2Monatsrente: '9999',
        [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { aktuellesAlter: 67, renteMonatlich: 1000, sparerPauschbetrag: 0 } }) }, completed);
    const f = fixture(initial); await install(f); let calls = 0;
    const options = { doc: null, win: null, now: 2026, decide: async ({ rows }) => {
        calls++; return Object.fromEntries(rows.map(row => [row.id, row.id.startsWith('mapping:') ? 'b' : '0']));
    } };
    const result = await migratePersonData(options);
    assertEqual(snapshot(JSON.parse(f.backend().rs_profiles_v1).profiles.b.data), snapshot(completed), 'Aktuelles Außenprofil wird durch alte Partnerkopie nicht neu migriert');
    const saved = Object.fromEntries(Object.values(PERSON_VALUE_KEYS).map(key => [key, f.backend()[key]]));
    const captured = captureProfileData();
    for (const key of Object.keys(saved)) assertEqual(captured[key], saved[key], 'Capture erhält ' + key);
    saveCurrentProfileFromLocalStorage(); await PersistenceFacade.flush();
    const bundle = exportProfilesBundle();
    for (const key of Object.keys(saved)) assertEqual(bundle.registry.profiles.a.data[key], saved[key], 'Bundle erhält ' + key);
    assert(switchProfile('b') && switchProfile('a'), 'Zentrale Werte überstehen echten A/B/A-Profilwechsel');
    await PersistenceFacade.flush();
    for (const key of Object.keys(saved)) assertEqual((await f.adapter.loadAll())[key], saved[key], 'Backendread nach Wechsel erhält ' + key);
    const backup = buildFullPersistenceBackup({ storage: PersistenceFacade });
    assert(normalizeFullPersistenceBackup(backup).ok, 'Vollbackup mit Personenschlüsseln ist wieder importierbar');
    for (const key of Object.keys(saved)) assertEqual(backup.records[key], saved[key], 'Vollbackup erhält ' + key);
    const archiveBefore = [...f.archive].map(([id, point]) => [id, JSON.stringify(point)]);
    const guard = createNavigationGuard({ decide: async () => true });
    const restored = await StorageManager.restoreSnapshot(result.snapshotId, null, { guard, reload: () => true });
    assertEqual(restored.status, 'restored', 'Produktiver Balance-Snapshot-Restore nimmt Personen-Recovery an');
    assertEqual(snapshot(f.backend()), snapshot(initial), 'Recovery stellt Registry, Außenprofil und Livealtkeys bytegleich wieder her');
    assert(PersistenceFacade.hasSyncWriteBlocks(), 'Restore hält das alte Dokument bis zum tatsächlichen Neustart schreibgesperrt');
    assertEqual(f.snapshots(), 2, 'Restore ergänzt genau einen bestätigten Rückkehrpunkt');
    for (const [id, bytes] of archiveBefore) assertEqual(JSON.stringify(await SnapshotArchive.readSnapshot(id)), bytes, 'Restore erhält vorhandene Archivbytes');
    const returnPoint = await SnapshotArchive.readSnapshot(restored.recoverySnapshotId);
    assertEqual(returnPoint.kind, SNAPSHOT_KINDS.beforeRestoreRecovery, 'Personen-Recovery erzeugt Punkt vor Zurückholen');
    assertEqual(snapshot(returnPoint.records), snapshot(backup.records), 'Rückkehrpunkt enthält den vollständigen Bestand vor Restore');
    // Ein Reload-Doppel tauscht das Dokument nicht aus; denselben Backendbestand
    // deshalb vor der nächsten Migration in eine neue Persistenzgeneration laden.
    await install(f);
    assertEqual((await migratePersonData(options)).status, 'migrated', 'Genau der wiederhergestellte Altbestand wird neu geprüft');
    assertEqual(f.snapshots(), 3, 'Neustart nach Restore erlaubt genau eine neue Rohsicherung');
    assertEqual(JSON.stringify(await SnapshotArchive.readSnapshot(returnPoint.id)), JSON.stringify(returnPoint), 'Erneute Migration erhält Rückkehrpunkt bytegleich');
    const legacyBundle = { version: 1, exportedAt: '2026-01-01T00:00:00.000Z', registry: JSON.parse(initial.rs_profiles_v1), currentProfileId: 'a', globals: {} };
    const imported = importProfilesBundle(legacyBundle);
    assert(imported.ok, 'Altbundleimport lädt den alten Personenbestand: ' + imported.message);
    await PersistenceFacade.flush();
    assertEqual(persistenceStorage.getItem('sim_p1Monatsrente'), '1000', 'Altbundle behält Personenquelle bis zur Sicherung');
    assertEqual(JSON.parse(persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY)).inputs.aktuellesAlter, 67, 'Altbundle behält eigene Balance-Alteingaben bis zur gesicherten Übernahme');
    assertEqual((await migratePersonData(options)).status, 'migrated', 'Altbundle wird trotz früher abgeschlossenem Koordinator erneut geprüft');
    assertEqual(snapshot(JSON.parse(f.backend().rs_profiles_v1).profiles.b.data), snapshot(completed), 'Altbundle lässt bereits aktuelles Außenprofil unverändert');
    assertEqual(calls, 3, 'Je neuem Altbestand genau eine explizite Partnerzuordnung');
    PersistenceFacade.resetPersistenceRuntimeForTests();
}
{
    const f = fixture(records({ profile_aktuelles_alter: '67', sim_p1Monatsrente: '1000' }));
    await install(f); const before = snapshot(f.backend()), originalFlush = PersistenceFacade.flush;
    PersistenceFacade.flush = async () => false;
    let error;
    try { await migratePersonData({ doc: null, win: null, now: 2026 }); } catch (caught) { error = caught; }
    finally { PersistenceFacade.flush = originalFlush; }
    assert(error instanceof Error, 'Explizit abgewiesener Vorflush verhindert Umstellung');
    assertEqual(f.snapshots(), 0, 'Abgewiesener Vorflush erzeugt keine falsche Recovery-Sicherung');
    assertEqual(snapshot(f.backend()), before, 'Vorflushfehler erhält Fachbytes');
    PersistenceFacade.resetPersistenceRuntimeForTests();
}
for (const fault of ['', 'backup', 'backup-read', 'write', 'readback', 'rollback', 'dialog', 'cancel', 'changed', 'backend-changed']) {
    const initial = records({ profile_aktuelles_alter: '67', profile_rente_monatlich: '1000', sim_p1Monatsrente: '1100' }, { profile_aktuelles_alter: '70', sim_mcSeed: '7' });
    const f = fixture(initial, fault); PersistenceFacade.resetPersistenceForTests(f.adapter);
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    let calls = 0, failed = false, result;
    const decide = async options => {
        calls++; assertEqual(f.snapshots(), 1, 'Vor jeder Nachfrage steht eine dauerhafte Sicherung');
        assertEqual(snapshot([...f.archive.values()][0].records), snapshot(initial), 'Sicherung umfasst Außenprofil und Rohaltkeys bytegleich');
        if (fault === 'dialog') throw new Error('synthetischer Dialogfehler');
        if (fault === 'cancel') return null;
        if (fault === 'changed') PersistenceFacade.setItemSync('rs_current_profile', 'b');
        if (fault === 'backend-changed') f.backend().profile_rente_monatlich = '1777';
        return Object.fromEntries(options.rows.map(row => [row.id, row.options[0].value]));
    };
    try { result = await migratePersonData({ decide, now: new Date('2026-10-07T10:00:00Z'), doc: null, win: null }); } catch { failed = true; }
    if (!fault) {
        assertEqual(result.status, 'migrated', 'Gesicherter Commit ist bestätigt');
        assertEqual(f.backend().profile_person_schema_version, '1', 'Version wurde gemeinsam persistiert');
        assert(!Object.hasOwn(f.backend(), 'sim_p1Monatsrente'), 'Altkeylöschung ist dauerhaft bestätigt');
        const writes = f.writes();
        const next = await migratePersonData({ decide, now: new Date('2026-10-07T10:00:00Z'), doc: null, win: null });
        assertEqual(next.status, 'current', 'Wiederholung ist ein No-op');
        assertEqual(f.writes(), writes, 'Keine zweite Mutation');
        assertEqual(f.snapshots(), 1, 'Keine zweite Sicherung');
        assertEqual(calls, 1, 'Eine Nachfrage für die kanonische Person');
    } else if (fault === 'cancel') {
        assertEqual(result.status, 'cancelled', 'Abbruch ist kein Speicherfehler');
        assertEqual(snapshot(f.backend()), snapshot(initial), 'Abbruch erhält Fachbytes');
    } else {
        assert(failed, fault + ': Fehler wird sichtbar abgewiesen');
        if (fault === 'rollback') {
            assert(PersistenceFacade.hasSyncWriteBlocks(), 'Unbestätigter Rollback sperrt weitere Writes bis Reload/Recovery');
        }
        if (fault === 'backend-changed') {
            assertEqual(f.writes(), 0, 'Geänderter Backendbestand verhindert den ersten Migrationswrite');
            assertEqual(f.backend().profile_rente_monatlich, '1777', 'Fremder Backendwrite bleibt erhalten');
            assert(!Object.hasOwn(f.backend(), 'profile_person_schema_version'), 'Abgewiesene Vorbedingung schreibt keinen Abschlussmarker');
        } else if (fault !== 'changed' && fault !== 'rollback') assertEqual(snapshot(f.backend()), snapshot(initial), fault + ': kompensierter Bestand bleibt bytegleich');
    }
    PersistenceFacade.resetPersistenceRuntimeForTests();
}

// Abschlussweg mit tatsächlicher nichtmodaler Hinweisausgabe und Gegenproben.
{
    const { createSelectionDocument } = await import('./designsystem-selection-dom.mjs');
    for (const scenario of ['missing', 'birth', 'legacy-age', 'later', 'escape', 'write', 'automatic']) {
        const person = { profile_rente_monatlich: '1000', ...(scenario === 'automatic' ? {} : { sim_p1Monatsrente: '1234.567' }),
            ...(scenario === 'birth' ? { profile_geburtsdatum: '1958-03-14' } : {}),
            ...(scenario === 'legacy-age' ? { profile_aktuelles_alter: '67' } : {}) };
        const initial = records(person), f = fixture(initial, scenario === 'write' ? 'write' : ''); await install(f);
        const doc = createSelectionDocument(), create = doc.createElement;
        doc.createElement = tag => {
            const node = create(tag); node.append = (...nodes) => nodes.forEach(child => node.appendChild(child));
            node.focus = () => { doc.activeElement = node; }; node.showModal = () => { node.open = true; };
            node.close = () => { node.open = false; node.dispatchEvent({ type: 'close' }); }; return node;
        };
        const guard = createNavigationGuard({ decide: async () => true });
        let calls = 0;
        const decide = async options => {
            calls++;
            assertEqual(options.title, 'Zwei Angaben für Synthetische Person A – welche stimmt?', 'Vorgegebener verständlicher Personentitel');
            assert(options.description.startsWith('Personendaten werden künftig nur noch in Personen & Vermögen gepflegt.'), 'Vorgegebene Beschreibung');
            assert(options.rows.every(row => row.kind === 'radio'), 'Konflikte sind Radiokarten');
            assert(options.rows.every(row => !/Registry|renteMonatlich|sim_|profile_/.test(row.label + row.options.map(o => o.label).join(''))), 'Präsentation enthält keine internen Kennungen');
            assert(options.rows[0].options.some(o => o.label.includes('1.234,567 €')), 'Deutsche Betragsanzeige erhält Kandidatenpräzision');
            if (scenario === 'later') return null;
            if (scenario === 'escape') {
                const { requestPageChoice } = await import('../app/shared/page-choice-dialog.js');
                const pending = requestPageChoice(options);
                doc.getElementById('pageChoiceDialog').dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
                return pending;
            }
            return Object.fromEntries(options.rows.map(row => [row.id, '1']));
        };
        let failed = false;
        try { await migratePersonData({ decide, now: 2026, doc, win: {}, guard }); } catch { failed = true; }
        assertEqual(failed, scenario === 'write', 'Nur technischer Writefehler lehnt ab');
        showPersonDataStatus({ ready: true, persons: [] }, doc);
        const notice = doc.getElementById('personDataNotice');
        assertEqual(Boolean(notice), scenario === 'missing', scenario + ': Folgehinweis ausschließlich nach bestätigtem Erfolg ohne Datum/Altalter');
        if (notice) {
            assert(notice.children[0].textContent.includes('Synthetische Person A') && notice.children[0].textContent.includes('Geburtsdatum einmal ergänzen'), 'Hinweis nennt Person und Ergänzungsband');
            assertEqual(notice.children[1].href, 'depot-tranchen-manager.html#personendaten', 'Hinweis verlinkt tatsächliches Ergänzungsband');
            assertEqual(f.backend().profile_rente_monatlich, '1234.567', 'Anzeige rundet den bestätigten gespeicherten Kandidaten nicht');
        }
        assertEqual(guard.reasons().length, 0, 'Hinweis und Aufschub halten keinen Guard');
        if (['later', 'escape', 'write'].includes(scenario)) assertEqual(snapshot(f.backend()), snapshot(initial), scenario + ': fachliche Bytes unverändert');
        if (scenario === 'automatic') assertEqual(calls, 0, 'Automatische Umstellung zeigt keinen Folgehinweis');
        PersistenceFacade.resetPersistenceRuntimeForTests();
    }
}

// Vollständiger produktiver Übersichtsstart: Migration und anschließende Bereitschaft.
{
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const { initOverview } = await import('../app/overview/overview-main.js');
    const { getPageNavigationGuard } = await import('../app/shared/navigation-guard-dialog.js');
    const previous = { document: globalThis.document, window: globalThis.window, Date: globalThis.Date };
    const makeDocument = () => {
        const doc = createSelectionDocument(), create = doc.createElement;
        doc.addEventListener = doc.body.addEventListener.bind(doc.body);
        doc.removeEventListener = doc.body.removeEventListener.bind(doc.body);
        doc.contains = node => node.isConnected;
        doc.querySelector = selector => doc.body.querySelector(selector);
        doc.createElement = tag => {
            const node = create(tag); node.append = (...children) => children.forEach(child => node.appendChild(child));
            node.focus = () => { doc.activeElement = node; }; node.showModal = () => { node.open = true; };
            node.close = () => { node.open = false; node.dispatchEvent({ type: 'close' }); }; return node;
        };
        addField(doc, 'overviewHouseholdNames');
        return doc;
    };
    const assertNotice = (doc, label) => {
        const notice = doc.getElementById('personDataNotice');
        assert(notice?.isConnected && !notice.hidden && notice.children[0].textContent.includes('Synthetische Person B'), label + ': Außenname nach abgeschlossenem Start sichtbar');
        assertEqual(notice.children[1].href, 'depot-tranchen-manager.html#personendaten', label + ': tatsächlicher Ergänzungslink');
    };
    try {
        globalThis.Date = class extends previous.Date { constructor(...args) { super(...(args.length ? args : ['2026-10-07T12:00:00Z'])); } };
        for (const scenario of ['confirmed', 'current', 'automatic']) {
            const household = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14', depot_tranchen: '[]' };
            const outside = { depot_tranchen: '[]', ...(scenario === 'current' ? { profile_person_schema_version: '1' }
                : { profile_rente_monatlich: '1000', ...(scenario === 'confirmed' ? { sim_p1Monatsrente: '1100' } : {}) }) };
            const f = fixture(records(household, outside)); await install(f);
            const doc = makeDocument(), win = { addEventListener() {}, removeEventListener() {}, name: '', location: { href: 'http://localhost/index.html', hash: '' } };
            globalThis.document = doc; globalThis.window = win;
            // Reine alte Bereitschaft muss ohne bestätigte Übernahme verschwinden.
            showPersonDataStatus({ ready: false, message: 'Veraltete Sperrbegründung' }, doc);
            const start = initOverview(doc, win);
            if (scenario === 'confirmed') {
                for (let i = 0; i < 200 && !doc.getElementById('pageChoiceDialog'); i++) await new Promise(resolve => setImmediate(resolve));
                assert(doc.getElementById('pageChoiceDialog')?.open, 'Produktiver Lifecycle öffnet echten Übernahmedialog');
                doc.body.querySelectorAll('*').find(node => node.dataset.pageChoiceAccept !== undefined).dispatchEvent({ type: 'click' });
            }
            assertEqual(await start, true, scenario + ': initOverview vollständig abgeschlossen');
            assert(doc.getElementById('overviewHouseholdNames').textContent.includes('Synthetische Person A'), 'Übersicht wurde nach Profilbootstrap gerendert');
            assertEqual(readHouseholdPersonStatus({ win }).ready, true, 'Haushalt ohne Altalter ist vollständig; Außenperson sperrt nicht');
            const outsideData = JSON.parse(persistenceStorage.getItem('rs_profiles_v1')).profiles.b.data;
            assert(!outsideData.profile_geburtsdatum && !outsideData.profile_aktuelles_alter, 'Außenperson besitzt weder Geburtstag noch Altalter');
            const points = await SnapshotArchive.listSnapshots();
            assertEqual(points.filter(point => point.label === 'Vor Umstellung Haushalt & Plan').length, 1, scenario + ': Planumstellung besitzt einen eigenen Wiederherstellungspunkt');
            assertEqual(points.filter(point => point.kind === SNAPSHOT_KINDS.personDataMigrationRecovery).length, scenario === 'current' ? 0 : 1, scenario + ': Personenumstellung bleibt getrennt gesichert');
            if (scenario !== 'confirmed') {
                assertEqual(doc.getElementById('personDataNotice'), null, scenario + ': kein Folgehinweis ohne ausdrückliche Übernahme');
                assertEqual(f.snapshots(), scenario === 'automatic' ? 2 : 1, 'Personen- und Planumstellung benötigen jeweils ihre eigene Sicherung');
                continue;
            }
            assertNotice(doc, 'Start');
            const bytes = snapshot(PersistenceFacade.exportAllSync().records), writes = f.writes(), snapshots = f.snapshots();
            const ready = readHouseholdPersonStatus({ win });
            for (let i = 0; i < 3; i++) { showPersonDataStatus(ready, doc); assertNotice(doc, 'Wiederholung'); }
            doc.getElementById('personDataNotice').remove();
            showPersonDataStatus(ready, doc); assertNotice(doc, 'Neu gerenderter Hinweis');
            showPersonDataStatus({ ready: true, persons: [{ name: 'Altalterperson', status: 'legacy-age' }] }, doc);
            assertNotice(doc, 'Zusätzliches Altalter');
            assert(doc.getElementById('personDataNotice').children[0].textContent.includes('Altalterperson'), 'Altalterbegründung bleibt neben Außenhinweis vorhanden');
            const blocker = 'Für die Rechnung fehlt das Geburtsdatum von Unvollständiger Haushalt';
            showPersonDataStatus({ ready: false, message: blocker }, doc); assertNotice(doc, 'Unvollständiger Haushalt');
            assert(doc.getElementById('personDataNotice').children[0].textContent.includes(blocker), 'Notwendige Sperrbegründung bleibt erhalten');
            showPersonDataStatus(ready, doc);
            assert(!doc.getElementById('personDataNotice').children[0].textContent.includes(blocker), 'Nur die veraltete Sperrbegründung wird entfernt');
            const fresh = makeDocument(); showPersonDataStatus(ready, fresh);
            assertEqual(fresh.getElementById('personDataNotice'), null, 'Frisches Dokument erbt keinen bestätigten Hinweis');
            assertEqual(snapshot(PersistenceFacade.exportAllSync().records), bytes, 'Hinweisdarstellung schreibt keine Records');
            assertEqual(f.writes(), writes, 'Hinweisdarstellung erzeugt keinen Backendwrite');
            assertEqual(f.snapshots(), snapshots, 'Hinweisdarstellung erzeugt keine weitere Sicherung');
            assertEqual(getPageNavigationGuard(doc, win).reasons().length, 0, 'Abgeschlossener Start und Hinweise halten keinen Navigationsschutz offen');
        }
    } finally { Object.assign(globalThis, previous); PersistenceFacade.resetPersistenceRuntimeForTests(); }
}

// Produktiver Seiten-Lifecycle nach Aufschub: kein Bootstrap, keine verwaiste Lease.
{
    const { createSelectionDocument } = await import('./designsystem-selection-dom.mjs');
    const { initializeProfilePage, whenProfilePageReady, whenProfileDisplayReady } = await import('../app/profile/profile-navigation.js');
    const { getPageNavigationGuard } = await import('../app/shared/navigation-guard-dialog.js');
    const initial = records({ profile_rente_monatlich: '1000', sim_p1Monatsrente: '1100' }), f = fixture(initial); await install(f);
    for (const action of ['later', 'escape']) {
        const doc = createSelectionDocument(), create = doc.createElement;
        doc.addEventListener = doc.body.addEventListener.bind(doc.body);
        doc.removeEventListener = doc.body.removeEventListener.bind(doc.body);
        doc.contains = node => node.isConnected;
        doc.querySelector = selector => doc.body.querySelector(selector);
        doc.createElement = tag => {
            const node = create(tag); node.append = (...children) => children.forEach(child => node.appendChild(child));
            node.focus = () => { doc.activeElement = node; }; node.showModal = () => { node.open = true; };
            node.close = () => { node.open = false; node.dispatchEvent({ type: 'close' }); }; return node;
        };
        const win = { addEventListener() {}, removeEventListener() {}, location: { href: 'http://localhost/Simulator.html' }, name: '' };
        const guard = getPageNavigationGuard(doc, win);
        const foreign = guard.register('echte-fremde-eingabe', { read: () => ({ dirty: true }) });
        const page = initializeProfilePage({ doc, win, kind: 'simulator' });
        for (let i = 0; i < 100 && !doc.getElementById('pageChoiceDialog'); i++) await Promise.resolve();
        const dialog = doc.getElementById('pageChoiceDialog');
        assert(dialog?.open, 'Nächste Seite fragt unveränderten Altbestand erneut');
        if (action === 'later') doc.body.querySelectorAll('*').find(n => n.dataset.pageChoiceCancel !== undefined).dispatchEvent({ type: 'click' });
        else dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
        assertEqual(await page, true, 'Aufschub ist erfolgreicher ruhiger Seitenstart');
        assertEqual(await whenProfilePageReady(doc), true, 'Navigation erhält Bereitschaft nach Aufschub');
        assertEqual(await whenProfileDisplayReady(doc), false, 'Altbestand wird nicht nebenbei gebootstrapped');
        assertEqual(win.__personMigrationDeferred, true, 'Dokumentlokaler Aufschub ohne persistenten Schlüssel');
        assertEqual(snapshot(f.backend()), snapshot(initial), 'Lifecycle-Aufschub erhält fachliche Bytes');
        assertEqual(guard.reasons().length, 1, 'Nur der echte fremde Dirtyprovider bleibt wirksam');
        let prevented = false;
        guard.beforeUnload({ preventDefault() { prevented = true; }, returnValue: '' });
        assert(prevented, 'Echte fremde Eingabe warnt weiterhin vor Entladen');
        foreign.unregister(); prevented = false;
        guard.beforeUnload({ preventDefault() { prevented = true; }, returnValue: '' });
        assert(!prevented && guard.reasons().length === 0, 'Saubere Seite warnt nach Später/Escape nicht');
    }
    PersistenceFacade.resetPersistenceRuntimeForTests();
}

// Historische Registrybeigaben bleiben gespeichert, ohne Teil der Liveprojektion zu werden.
const historicalKey = 'ruhestandsmodell_snapshot_2026-01-20T11:48:21.709Z--Muster A';
const historicalData = {
    [historicalKey]: '{ "historisch": "Muster A" }',
    ui_panel_state: ' { "offen": true } ', layout_person_panel: 'links\nrechts',
    'sim.stressReplay.active.v1': '{ "registry": true }'
};
function historicalRecords(conflict = true, live = false) {
    const initial = records({ profile_aktuelles_alter: '67', profile_rente_monatlich: '1000',
        ...(conflict ? { sim_p1Monatsrente: '1100' } : {}), ...historicalData },
    { profile_aktuelles_alter: '70', profile_rente_monatlich: '900', ...historicalData });
    for (const key of Object.keys(historicalData)) {
        if (live) initial[key] = 'abweichender Livewert: ' + key;
        else delete initial[key];
    }
    return initial;
}
function assertHistoricalRegistry(actual) {
    const registry = JSON.parse(actual.rs_profiles_v1);
    for (const id of ['a', 'b']) for (const [key, value] of Object.entries(historicalData)) {
        assertEqual(registry.profiles[id].data[key], value, 'Historischer Registrystring bleibt bytegleich: ' + id + '/' + key);
    }
}
function assertHistoricalLive(actual, initial) {
    for (const key of Object.keys(historicalData)) {
        assertEqual(actual[key], initial[key], 'Ausgeschlossener Livekey wird weder angelegt noch verändert: ' + key);
        assertEqual(Object.hasOwn(actual, key), Object.hasOwn(initial, key), 'Ausgeschlossener Livekey wird nicht gelöscht: ' + key);
    }
}
for (const live of [false, true]) {
    const input = historicalRecords(true, live), before = snapshot(input);
    const draft = buildPersonMigrationDraft(input, { referenceYear: 2026 });
    const draftBefore = JSON.stringify(draft);
    const next = applyPersonMigrationChoices(draft, { a: { renteMonatlich: 1 } });
    assertHistoricalLive(next, input);
    if (!live) assertHistoricalRegistry(next);
    assertEqual(snapshot(input), before, 'Historischer Entwurf erhält Eingangsrecords');
    assertEqual(JSON.stringify(draft), draftBefore, 'Historischer Entwurf bleibt vollständig unverändert');
}
{
    // Aktives Profil bereits aktuell: ausgeschlossene Livekeys fehlen in seiner Registry.
    const input = { ...records({ profile_person_schema_version: '1', profile_rente_monatlich: '1000' },
        { profile_aktuelles_alter: '70', ...historicalData }), ...historicalData };
    const before = snapshot(input), draft = buildPersonMigrationDraft(input, { referenceYear: 2026 });
    const next = applyPersonMigrationChoices(draft);
    assertHistoricalLive(next, input);
    assertEqual(snapshot(input), before, 'Löschgegenprobe erhält ursprüngliche Entwurfsrecords');
    assertEqual(JSON.parse(next.rs_profiles_v1).profiles.b.data.profile_person_schema_version, '1', 'Löschgegenprobe migriert nur inaktives Altprofil');
}
for (const choice of [0, 1, null]) for (const live of [false, true]) {
    const initial = historicalRecords(choice !== null, live), f = fixture(initial); await install(f);
    let calls = 0;
    const options = { doc: null, win: null, now: 2026, decide: async ({ rows }) => {
        calls++; assert(choice !== null, 'Stille historische Umstellung fragt nicht nach');
        return Object.fromEntries(rows.map(row => [row.id, String(choice)]));
    } };
    const result = await migratePersonData(options);
    assertEqual(result.ok, true, 'Historischer Bestand wird erfolgreich umgestellt');
    assertEqual(result.status, 'migrated', 'Historische Umstellung wird bestätigt');
    const actual = await f.adapter.loadAll();
    assertHistoricalLive(actual, initial); assertHistoricalRegistry(actual);
    const registry = JSON.parse(actual.rs_profiles_v1);
    assertEqual(actual.profile_rente_monatlich, choice === 1 ? '1100' : '1000', 'Exakt gewählte historische Personenquelle live');
    assertEqual(registry.profiles.a.data.profile_rente_monatlich, actual.profile_rente_monatlich, 'Registry bestätigt exakt gewählte Quelle');
    for (const id of ['a', 'b']) assertEqual(registry.profiles[id].data.profile_person_schema_version, '1', 'Personenversion in beiden Profilen');
    assertEqual(actual.profile_person_schema_version, '1', 'Personenversion im Livebestand');
    assertEqual(calls, choice === null ? 0 : 1, 'Nur Quellenkonflikt benötigt Entscheidung');
    const durable = snapshot(actual), writes = f.writes(), backups = f.snapshots();
    await install(f);
    assertEqual((await migratePersonData(options)).status, 'current', 'Historischer Reload erkennt abgeschlossene Umstellung');
    assertEqual(snapshot(await f.adapter.loadAll()), durable, 'Historischer Reload erhält Fachbytes');
    assertEqual(f.writes(), writes, 'Historischer Reload schreibt nicht erneut');
    assertEqual(f.snapshots(), backups, 'Historischer Reload sichert nicht erneut');
    const archiveBefore = [...f.archive].map(([id, point]) => [id, JSON.stringify(point)]);
    const recoveryRecords = Object.fromEntries(Object.entries(actual)
        .filter(([key]) => isAllowedSnapshotRestoreLiveKey(key, { mode: 'full' })));
    const restored = await StorageManager.restoreSnapshot(result.snapshotId, null, {
        guard: createNavigationGuard({ decide: async () => true }), reload: () => true
    });
    assertEqual(restored.status, 'restored', 'Personen-Recoveryrestore akzeptiert historische Profildaten');
    assertEqual(snapshot(await f.adapter.loadAll()), snapshot(initial), 'Personen-Recoveryrollback erhält gesamte Registry und ausgeschlossene Livebytes');
    assertEqual(f.archive.size, backups + 1, 'Personen-Recoveryrestore erhält Archivbestand und ergänzt genau einen Rückkehrpunkt');
    for (const [id, bytes] of archiveBefore) assertEqual(JSON.stringify(await SnapshotArchive.readSnapshot(id)), bytes, 'Personen-Recoveryrestore erhält sämtliche bisherigen Archivbytes');
    const returnPoint = await SnapshotArchive.readSnapshot(restored.recoverySnapshotId);
    assertEqual(returnPoint.kind, SNAPSHOT_KINDS.beforeRestoreRecovery, 'Historische Personen-Recovery erzeugt bestätigten Punkt vor Zurückholen');
    assertEqual(snapshot(returnPoint.records), snapshot(recoveryRecords), 'Historischer Rückkehrpunkt enthält vollständigen vorherigen Wiederherstellungsumfang');
    PersistenceFacade.resetPersistenceRuntimeForTests();
}
for (const failure of ['preflight', 'cancel']) {
    const initial = historicalRecords(true, true), f = fixture(initial); await install(f);
    const originalReplace = PersistenceFacade.replaceRecordsTransactional;
    let calls = 0, injected = 0, caught;
    const options = { doc: null, win: null, now: 2026, decide: async ({ rows }) => {
        calls++; return failure === 'cancel' && calls === 1 ? null : Object.fromEntries(rows.map(row => [row.id, '1']));
    } };
    if (failure === 'preflight') PersistenceFacade.replaceRecordsTransactional = (next, transactionOptions) => {
        injected++;
        return originalReplace({ ...next, [historicalKey]: historicalData[historicalKey] }, transactionOptions);
    };
    try {
        const result = await migratePersonData(options);
        assertEqual(result.status, 'cancelled', 'Historischer Abbruch ist sichtbar');
    } catch (error) { caught = error; }
    finally { PersistenceFacade.replaceRecordsTransactional = originalReplace; }
    if (failure === 'preflight') {
        assertEqual(injected, 1, 'Verbotener Key wird einmal über echten Transaktionsweg vorgeprüft');
        assert(caught?.message.includes(historicalKey), 'Vorprüfungsfehler benennt verbotenen Altsnapshot');
        assertEqual(f.writes(), 0, 'Vorprüfungsfehler erfolgt vor erstem Bestandswrite');
    }
    assertEqual(snapshot(await f.adapter.loadAll()), snapshot(initial), 'Fehlversuch/Abbruch erhält Backend und Registry bytegleich');
    assert(!PersistenceFacade.hasSyncWriteBlocks(), 'Fehlversuch/Abbruch gibt temporäre Schreibsperre frei');
    // Ohne Reload muss bereits ein neuer Koordinator einen erneuten Dialog erlauben.
    assertEqual((await migratePersonData({ ...options, decide: async () => { calls++; return null; } })).status,
        'cancelled', 'Kein verwaister Koordinator nach Fehlversuch');
    await install(f);
    const retry = await migratePersonData(options);
    assertEqual(retry.ok, true, 'Regulärer Reload erlaubt erfolgreiche Übernahme ohne Reparatur');
    assertEqual(calls, 3, 'Konflikt wird nach Fehlversuch und Reload erneut angeboten');
    assertHistoricalRegistry(await f.adapter.loadAll()); assertHistoricalLive(await f.adapter.loadAll(), initial);
    assertEqual(f.backend().profile_rente_monatlich, '1100', 'Wiederanlauf übernimmt gewählte Quelle');
    assert(!PersistenceFacade.hasSyncWriteBlocks(), 'Wiederanlauf hinterlässt keine Schreibsperre');
    PersistenceFacade.resetPersistenceRuntimeForTests();
}

// Derselbe produktive Budgetweg für Entwurf, gesicherte Übernahme und Backendreload.
async function assertMigrationBudget(f, { monthly = 0, perPerson = monthly, names = [''], outside = false, profileIds = outside ? [] : ['a'] } = {}) {
    const { createProfileSyncHandlers } = await import('../app/balance/balance-main-profile-sync.js');
    const { createProfilverbundHandlers } = await import('../app/balance/balance-main-profilverbund.js');
    const { UIReader, initUIReader } = await import('../app/balance/balance-reader.js');
    const { PROFILE_VALUE_KEYS } = await import('../app/profile/profile-state.js');
    const { loadProfilverbundProfiles, aggregateProfilverbundInputs } = await import('../app/profile/profilverbund-balance.js');
    const { SummaryRenderer } = await import('../app/balance/balance-renderer-summary.js');
    const { UIUtils } = await import('../app/balance/balance-utils.js');
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const saved = { document: globalThis.document, window: globalThis.window, Date: globalThis.Date, sideEffects: UIReader.applySideEffectsFromInputs };
    const before = snapshot(PersistenceFacade.exportAllSync().records), durable = snapshot(await f.adapter.loadAll()), writes = f.writes();
    try {
        const fixedTime = saved.Date.parse('2026-10-07T12:00:00Z');
        globalThis.Date = class extends saved.Date {
            constructor(...args) { super(...(args.length ? args : [fixedTime])); }
            static now() { return fixedTime; }
        };
        const doc = createSelectionDocument(); globalThis.document = doc; globalThis.window = {};
        const fields = ['aktuellesAlter', 'renteAktiv', 'renteMonatlich', 'fixedIncomeAnnual', 'kirchensteuerSatz', 'sparerPauschbetrag',
            'floorBedarf', 'flexBedarf', 'tagesgeld', 'depotwertAlt', 'costBasisAlt', 'endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath', 'jahreSeitAth', 'inflation'];
        const dom = { inputs: Object.fromEntries(fields.map(key => [key, addField(doc, key)])), containers: {}, outputs: {} };
        for (const [key, value] of Object.entries({ floorBedarf: 24000, flexBedarf: 12000, tagesgeld: 50000, depotwertAlt: 500000,
            costBasisAlt: 350000, endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100, endeVJ_3: 100, ath: 100 })) dom.inputs[key].value = String(value);
        initUIReader(dom); UIReader.applySideEffectsFromInputs = () => {};
        const sync = createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS }).syncProfileDerivedInputs;
        for (let repeat = 0; repeat < 2; repeat++) {
            assert(sync(), 'Übernommene Records sind im echten Balance-Sync bereit');
            assertEqual(UIUtils.parseCurrency(dom.inputs.fixedIncomeAnnual.value), monthly * 12, 'Sync zeigt ausschließlich wirksames Jahresbudget');
            const input = UIReader.readAllInputs(), profiles = loadProfilverbundProfiles();
            assertEqual(input.renteMonatlich, perPerson, 'Echter Reader erhält je Person ausschließlich laufendes Einkommen');
            assertEqual(input.renteAktiv, monthly > 0, 'Sonstige Einkünfte halten die Einkommensbrücke aktiv');
            assertEqual(profiles.length, outside ? 0 : names.length, 'Nur ausgewählte Personen bilden den Haushaltsumfang');
            assertEqual(profiles.map(profile => profile.profileId).sort().join(','), profileIds.join(','), 'Geöffnetes Profil ersetzt keine ausgewählte Person');
            for (const profile of profiles) assertEqual(profile.inputs.renteMonatlich, perPerson, 'Geladener Personeninput enthält ausschließlich laufendes Einkommen');
            if (!outside) {
                assertEqual(aggregateProfilverbundInputs(profiles).totalRenteJahr, monthly * 12, 'Haushaltsaggregation wahrt den Budgetvertrag');
                createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS: { mode: 'synthetic-mode' } }).updateProfilverbundGlobals(profiles, input);
            }
            assertEqual(input.renteMonatlich, monthly, 'Produktive Haushaltsbrücke erhält das vollständige laufende Einkommen');
            const view = createPresentationTestDocument(), create = view.createElement;
            view.createElement = tag => { const node = create.call(view, tag); node.dataset = {}; return node; };
            globalThis.document = view;
            const outputs = Object.fromEntries(['balanceMonthlyBudget', 'balanceBudgetChips', 'balanceMonthlyIncome', 'balanceAnnualBudget'].map(key => [key, view.createElement('div')]));
            const renderer = new SummaryRenderer({ outputs });
            for (let render = 0; render < 2; render++) renderer.renderOverview({ input, spending: { monatlicheEntnahme: 0 } });
            const hints = outputs.balanceBudgetChips.children.filter(node => node.dataset.pensionStatus);
            assertEqual(hints.length, names.length, 'Wiederholte Summary verdoppelt keine Rentenhinweise');
            hints.forEach((hint, index) => {
                const expected = `Rente${names.length > 1 ? ' ' + names[index] : ''} ab 01.01.2028 · noch nicht im Budget`;
                assertEqual(hint.textContent, expected, 'Vollständiger produktiver Hinweis bleibt exakt');
                assertEqual(hint.textContent.split('noch nicht im Budget').length - 1, 1, 'Budgetergänzung erscheint genau einmal');
                assertEqual(hint.textContent.includes('Balance: Jahresdurchschnitt'), false, 'Zukunftsausnahme und Altfall haben getrennte Hinweistexte');
            });
            assertEqual(UIUtils.parseCurrency(outputs.balanceMonthlyIncome.textContent), monthly, 'Summary zeigt die wirksame monatliche Einkommensbrücke');
            globalThis.document = doc;
        }
        await PersistenceFacade.flush();
        assertEqual(f.writes(), writes, 'Balanceprojektion und Summary erzeugen keine Fachwrites');
        assertEqual(snapshot(PersistenceFacade.exportAllSync().records), before, 'Alle Live- und Registrybytes bleiben erhalten');
        assertEqual(snapshot(await f.adapter.loadAll()), durable, 'Backendbytes bleiben nach wiederholtem Rendering erhalten');
    } finally {
        Object.assign(globalThis, { document: saved.document, window: saved.window, Date: saved.Date });
        UIReader.applySideEffectsFromInputs = saved.sideEffects; initUIReader(null);
    }
}
{
    const initial = records({ profile_geburtsdatum: '1958-03-14', profile_rente_monatlich: '0', sim_p1Monatsrente: '1000', sim_p1StartInJahren: '2' });
    const migrated = applyPersonMigrationChoices(buildPersonMigrationDraft(initial, { referenceYear: 2026 }));
    assertEqual(migrated.profile_rente_monatlich, '1000', 'Unveränderte Übernahme erhält erwarteten Betrag');
    assertEqual(migrated.profile_rentenbeginn, '', 'Übernahme erfindet kein bestätigtes Datum');
    const metadata = JSON.parse(migrated.profile_person_migration_v1);
    assertEqual(metadata.renteStartOffsetJahre, 2, 'Übernahme erhält Simulatoroffset');
    assertEqual(metadata.suggestedRentenbeginn, '2028-01-01', 'Januar bleibt bloßer Vorschlag');
    try {
        const f = fixture(migrated); await install(f); await assertMigrationBudget(f);
        const { buildSimulatorInputsFromProfileData } = await import('../app/simulator/simulator-profile-inputs.js');
        const { calculateHouseholdPensionForYear } = await import('../app/simulator/simulator-household-pension.js');
        const input = buildSimulatorInputsFromProfileData(migrated, { referenceYear: 2026 });
        assertEqual(input.renteMonatlich, 1000, 'Produktiver Simulatoradapter erhält unveränderte Monatsrente');
        assertEqual(input.renteStartOffsetJahre, 2, 'Produktiver Simulatoradapter erhält Offset zwei');
        assertEqual(input.renteStartMonate, 12, 'Balance-Nullmonate kürzen nicht die Simulatorstartmonate');
        let annual = 12000;
        for (let index = 0; index < 3; index++) {
            const result = calculateHouseholdPensionForYear({ inputs: { ...input, rentAdjPct: 2 }, yearIndex: index, currentAnnualPension: annual });
            assertEqual(result.renteSum, index < 2 ? 0 : 12000 * 1.02 * 1.02, 'Startindex zahlt volle bis dahin fortgeschriebene Basis');
            annual = result.nextAnnualPension;
        }
    } finally { PersistenceFacade.resetPersistenceRuntimeForTests(); }
}

// Sonstige Einkünfte zählen je ausgewählter Person; ohne Auswahl rechnet A allein.
for (const scope of ['single', 'household', 'outside', 'outside-selected']) for (const otherIncome of [0, 100]) {
    const old = { profile_geburtsdatum: '1958-03-14', profile_rente_monatlich: '0', sim_p1Monatsrente: '1000',
        sim_p1StartInJahren: '2', profile_sonstige_einkuenfte: String(otherIncome) };
    const selectedOutside = scope === 'outside-selected';
    const partner = selectedOutside ? { ...old, profile_sonstige_einkuenfte: String(otherIncome + 75) } : old;
    const initial = records(old, scope === 'single' ? null : partner);
    const registry = JSON.parse(initial.rs_profiles_v1);
    registry.profiles.a.meta.belongsToHousehold = !['outside', 'outside-selected'].includes(scope);
    if (registry.profiles.b) registry.profiles.b.meta.belongsToHousehold = scope !== 'outside';
    initial.rs_profiles_v1 = JSON.stringify(registry);
    const migrated = applyPersonMigrationChoices(buildPersonMigrationDraft(initial, { referenceYear: 2026 }));
    const f = fixture(migrated), household = scope === 'household';
    const perPerson = selectedOutside ? otherIncome + 75 : otherIncome;
    const expected = { monthly: perPerson * (household ? 2 : 1), perPerson,
        names: household ? ['Synthetische Person A', 'Synthetische Person B'] : [''], outside: scope === 'outside',
        profileIds: household ? ['a', 'b'] : selectedOutside ? ['b'] : scope === 'outside' ? [] : ['a'] };
    try {
        await install(f); await assertMigrationBudget(f, expected);
        await install(f); await assertMigrationBudget(f, expected);
    } finally { PersistenceFacade.resetPersistenceRuntimeForTests(); }
}

// Eng begrenzter Vorschlag mit gekoppelter Simulatorherkunft; echter Dialogpfad.
for (const old of [{ profile_rente_monatlich: '0' }, { profile_rente_monatlich: '900', profile_rente_aktiv: 'false' }]) {
    try {
        const initial = records({ profile_geburtsdatum: '1958-03-14', ...old, sim_p1Monatsrente: '1000', sim_p1StartInJahren: '2' });
        const draft = buildPersonMigrationDraft(initial, { referenceYear: 2026 });
        assertEqual(draft.people[0].suggestionReason, 'künftige Rente aus dem Simulator', 'Zukunftsrente erhält gezielte Vorschlagsbegründung');
        const migrated = applyPersonMigrationChoices(draft);
        assertEqual(migrated.profile_rente_monatlich, '1000', 'Unveränderten Vorschlag übernehmen erhält positive Zukunftsrente');
        assertEqual(JSON.parse(migrated.profile_person_migration_v1).suggestedRentenbeginn, '2028-01-01', 'Umstellung erhält Januarvorschlag 2028');
        assertEqual(applyPersonMigrationChoices(draft, { a: { renteMonatlich: 0 } }).profile_rente_monatlich, old.profile_rente_monatlich, 'Explizite Profilwahl bleibt möglich');
        const f = fixture(initial); await install(f);
        let dialogs = 0;
        const result = await migratePersonData({ storage: PersistenceFacade, archive: SnapshotArchive, now: new Date('2026-10-07T12:00:00Z'), decide: async ({ rows }) => {
            dialogs++;
            const row = rows.find(row => row.id === 'a:renteMonatlich');
            assert(row.options.find(option => option.value === row.selected).label.includes('künftige Rente aus dem Simulator'), 'Dialog wählt denselben begründeten Vorschlag');
            return Object.fromEntries(rows.map(row => [row.id, row.selected]));
        } });
        assert(result.ok && dialogs === 1, 'Echter gesicherter Dialogpfad übernimmt Zukunftsrente');
        assertEqual(f.backend().profile_rente_monatlich, '1000', 'Backendreadback bestätigt Zukunftsrente');
        await assertMigrationBudget(f);
        await install(f);
        const reload = await migratePersonData({ storage: PersistenceFacade, archive: SnapshotArchive, decide: () => { throw new Error('UNEXPECTED_DIALOG'); } });
        assertEqual(reload.status, 'current', 'Reload bleibt ohne zweite Umstellung');
        assertEqual(JSON.parse(f.backend().profile_person_migration_v1).renteStartOffsetJahre, 2, 'Reload erhält gekoppelte Offsetherkunft');
        await assertMigrationBudget(f);
        const cancelled = fixture(initial); await install(cancelled);
        const before = snapshot(cancelled.backend());
        assertEqual((await migratePersonData({ storage: PersistenceFacade, archive: SnapshotArchive, decide: async () => null })).status, 'cancelled', 'Zukunftsentscheidung kann abgebrochen werden');
        assertEqual(snapshot(cancelled.backend()), before, 'Abbruch erhält fachliche Ausgangsbytes');
    } finally { PersistenceFacade.resetPersistenceRuntimeForTests(); }
}
{
    const data = { profile_geburtsdatum: '1958-03-14', profile_rente_monatlich: '0', sim_p1Monatsrente: '1000', sim_p1StartInJahren: '0' };
    assertEqual(applyPersonMigrationChoices(buildPersonMigrationDraft(records(data), { referenceYear: 2026 })).profile_rente_monatlich, '0', 'Ohne Startverschiebung bleibt Profilquelle vorgeschlagen');
    const withDate = applyPersonMigrationChoices(buildPersonMigrationDraft(records({ ...data, profile_rentenbeginn: '2028-07-15', sim_p1StartInJahren: '2' }), { referenceYear: 2026 }));
    assertEqual(withDate.profile_rentenbeginn, '2028-07-15', 'Vorhandener gültiger Beginn wird nicht vom Januarvorschlag überschrieben');
    const { buildSimulatorInputsFromProfileData } = await import('../app/simulator/simulator-profile-inputs.js');
    for (const year of [2026, 2028]) {
        const calendar = buildSimulatorInputsFromProfileData(withDate, { referenceYear: year });
        assertEqual(calendar.renteMonatlich, 1000, 'Datierter Simulatoradapter behält übernommenen Monatsbetrag');
        assertEqual(calendar.renteStartOffsetJahre, 2028 - year, 'Bestätigtes ISO-Jahr hat Vorrang vor relativem Migrationsoffset');
        assertEqual(calendar.renteStartMonate, 6, 'Bestätigter Juli hat Vorrang vor zwölf Migrationsstartmonaten');
    }
    const mixed = records({ ...data, sim_p1Monatsrente: '0', sim_p1StartInJahren: '2' }); mixed.sim_p1Monatsrente = '1000'; delete mixed.sim_p1StartInJahren;
    assertEqual(applyPersonMigrationChoices(buildPersonMigrationDraft(mixed, { referenceYear: 2026 })).profile_rente_monatlich, '0', 'Livebetrag kombiniert keinen fehlenden Offset aus fremder Registryquelle');
}
PersistenceFacade.resetPersistenceRuntimeForTests();

// Reale Übernahme, danach beide produktiven Leser über vier feste Kalenderjahre.
{
    const { projectPerson } = await import('../app/profile/profile-person-data.js');
    const { UIReader, initUIReader } = await import('../app/balance/balance-reader.js');
    const { buildSimulatorInputsFromProfileData } = await import('../app/simulator/simulator-profile-inputs.js');
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const { setAppTestDate, getAppTestDate } = await import('../app/shared/app-clock.js');
    const saved = { document: globalThis.document, window: globalThis.window, sideEffects: UIReader.applySideEffectsFromInputs, date: getAppTestDate() };
    try {
        const f = fixture(records({ profile_geburtsdatum: '1958-03-14', profile_sonstige_einkuenfte: '200',
            sim_p1Monatsrente: '1000', sim_p1StartInJahren: '2' }));
        PersistenceFacade.resetPersistenceForTests(f.adapter);
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const result = await migratePersonData({ now: new Date(2026, 0, 2), decide: async () => ({}), doc: null });
        assert(result.ok, 'Produktive datierte Migration erfolgreich');
        const data = JSON.parse(f.backend().rs_profiles_v1).profiles.a.data;
        assertEqual(JSON.parse(data.profile_person_migration_v1).referenceYear, 2026, 'Produktive Migration hält Referenzjahr fest');
        const bytes = snapshot(f.backend()), writes = f.writes();
        const doc = createSelectionDocument(); globalThis.document = doc; globalThis.window = {};
        const fields = ['aktuellesAlter', 'renteAktiv', 'renteMonatlich', 'fixedIncomeAnnual', 'kirchensteuerSatz', 'sparerPauschbetrag', 'floorBedarf', 'flexBedarf', 'tagesgeld', 'depotwertAlt', 'costBasisAlt', 'endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath', 'jahreSeitAth', 'inflation'];
        const inputs = Object.fromEntries(fields.map(key => [key, addField(doc, key)]));
        for (const field of Object.values(inputs)) field.value = '0';
        inputs.floorBedarf.value = '24000'; inputs.flexBedarf.value = '12000'; inputs.tagesgeld.value = '50000';
        initUIReader({ inputs, containers: {}, outputs: {} });
        UIReader.applySideEffectsFromInputs = () => {};
        for (const [year, offset, annual] of [[2026, 2, 0], [2027, 1, 0], [2028, 0, 12000], [2029, 0, 12000]]) {
            setAppTestDate(`${year}-01-02`);
            const person = projectPerson(data, year), simulator = buildSimulatorInputsFromProfileData(data, { referenceYear: year });
            assertEqual(person.renteStartOffsetJahre, offset, year + ': Personenversatz');
            assertEqual(person.renteImJahr, annual, year + ': Jahresrente');
            assertEqual(person.sonstigeEinkuenfte, 200, year + ': Sonstige Einkünfte bleiben unabhängig');
            assertEqual(UIReader.readAllInputs().renteMonatlich * 12, annual + 2400, year + ': echter Balance-Reader mit sonstigen Einkünften');
            assertEqual(simulator.renteStartOffsetJahre, offset, year + ': produktiver Simulatoradapter');
            assertEqual(simulator.renteStartMonate, 12, year + ': zwölf Simulatorstartmonate');
            assertEqual(simulator.renteMonatlich, 1000, year + ': volle erwartete Simulatorrente');
        }
        const explicit = { ...data, profile_rentenbeginn: '2028-07-01' };
        assertEqual(projectPerson(explicit, 2028).renteImJahr, 6000, 'Expliziter Juli hat Vorrang vor migriertem Januar');
        assertEqual(buildSimulatorInputsFromProfileData(explicit, { referenceYear: 2028 }).renteStartMonate, 6, 'Simulator übernimmt sechs Startmonate');
        assertEqual(snapshot(f.backend()), bytes, 'Alle Profil- und Migrationbytes bleiben nach Jahresprojektionen unverändert');
        assertEqual(f.writes(), writes, 'Produktive Leser schreiben nichts');
    } finally {
        globalThis.document = saved.document; globalThis.window = saved.window;
        UIReader.applySideEffectsFromInputs = saved.sideEffects; setAppTestDate(saved.date); PersistenceFacade.resetPersistenceForTests();
    }
}

// Wiederholung nutzt denselben Migrationskoordinator und behält die Rechensperre bis zum Neustart.
for (const outcome of ['later', 'accepted', 'readback', 'flush']) {
    const { retryDeferredPersonMigration, profileMigrationDisplayState, completeProfilePageReadiness, whenProfileDisplayReady, initProfileSubpageLifecycle } = await import('../app/profile/profile-navigation.js');
    const { getPageNavigationGuard } = await import('../app/shared/navigation-guard-dialog.js');
    const f = fixture(records({ profile_aktuelles_alter: '67', profile_rente_monatlich: '1000', sim_p1Monatsrente: '1100' }), outcome === 'readback' ? 'readback' : '');
    PersistenceFacade.resetPersistenceForTests(f.adapter);
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const host = { textContent: '', hidden: true }, doc = { getElementById: () => host, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [] };
    let reloads = 0, choices = 0;
    const win = { __personMigrationDeferred: true, addEventListener() {}, location: { reload() { reloads++; } } };
    doc.defaultView = win; completeProfilePageReadiness(doc, null, false);
    assertEqual(await whenProfileDisplayReady(doc), false, 'Aufschub ist keine Profilbereitschaft');
    const gate = deferred(), guard = getPageNavigationGuard(doc, win), before = snapshot(f.backend());
    const migrate = () => migratePersonData({ doc, win, guard, now: new Date(2026, 0, 2), decide: async () => { choices++; return gate.promise; } });
    const first = retryDeferredPersonMigration({ doc, win, migrate });
    assertEqual(retryDeferredPersonMigration({ doc, win, migrate }), first, 'Doppelklick teilt exakt dieselbe Übernahme');
    for (let tick = 0; tick < 100 && !choices; tick++) await Promise.resolve();
    assertEqual(choices, 1, 'Genau eine echte Quellenentscheidung');
    assert(guard.reasons().length > 0, 'Migrationslease schützt noch offene Entscheidung');
    await initProfileSubpageLifecycle({ doc, win });
    assertEqual(choices, 1, 'Paralleler Lifecycle startet keine zweite Migration');
    if (outcome === 'flush') {
        const original = PersistenceFacade.flush;
        // Vorflush und Entscheidung sind beendet; der öffentliche Reloadflush scheitert.
        PersistenceFacade.flush = async () => false;
        gate.resolve({ 'a:renteMonatlich': '1' }); await first; PersistenceFacade.flush = original;
    } else { gate.resolve(outcome === 'later' ? null : { 'a:renteMonatlich': '1' }); await first; }
    assertEqual(reloads, outcome === 'accepted' ? 1 : 0, 'Nur bestätigte Migration samt Flush startet genau einmal neu');
    assert(win.__personMigrationDeferred, 'Zwischengespeicherte Rechner bleiben bis zum neuen Dokument gesperrt');
    assertEqual(guard.reasons().length, 0, 'Jeder Ausgang beendet seine Migrationslease');
    assertEqual(profileMigrationDisplayState(doc, win), ['readback', 'flush'].includes(outcome) ? 'unavailable' : 'deferred', 'Technischer Fehler bleibt vom Aufschub getrennt');
    if (outcome === 'later' || outcome === 'readback') assertEqual(snapshot(f.backend()), before, 'Aufschub oder fehlgeschlagener Readback erhält alle Personenbytes');
    if (outcome === 'accepted') assertEqual(f.backend().profile_rente_monatlich, '1100', 'Erneute Bestätigung übernimmt gewählte Quelle');
    PersistenceFacade.resetPersistenceForTests();
}

// Ein vorhandener Commitbesitzer (auch Spielbereich) wird vom Wiederholungsweg nicht überholt.
{
    const { retryDeferredPersonMigration, profileMigrationDisplayState, completeProfilePageReadiness } = await import('../app/profile/profile-navigation.js');
    const { getPageNavigationGuard } = await import('../app/shared/navigation-guard-dialog.js');
    const f = fixture(records({ profile_aktuelles_alter: '67', profile_rente_monatlich: '1000', sim_p1Monatsrente: '1100' }));
    PersistenceFacade.resetPersistenceForTests(f.adapter); await PersistenceFacade.init({ installLifecycleHooks: false });
    const doc = { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] }, win = { __personMigrationDeferred: true, addEventListener() {} };
    doc.defaultView = win; completeProfilePageReadiness(doc, null, false);
    const guard = getPageNavigationGuard(doc, win), lease = guard.register('probelauf-commit', { read: () => ({ phase: 'commit' }) });
    let decisions = 0;
    const bytes = snapshot(f.backend());
    await retryDeferredPersonMigration({ doc, win, migrate: () => migratePersonData({ doc, win, guard, decide: async () => { decisions++; return null; } }) });
    assertEqual(decisions, 0, 'Fremder Commitbesitzer verhindert zweite Migration oder Probelaufentscheidung');
    assertEqual(profileMigrationDisplayState(doc, win), 'deferred', 'Belegte Lease ist kein technischer Profilfehler');
    assertEqual(guard.reasons().length, 1, 'Wiederholungsabbruch quittiert keine fremde Lease');
    assertEqual(snapshot(f.backend()), bytes, 'Belegter Commitbesitz verhindert sämtliche Personenwrites');
    lease.unregister(); PersistenceFacade.resetPersistenceForTests();
}

// P12c/Befund 4: echter Dialog an getrennten Backendwrite-/Readbackbarrieren.
{
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const { initializeProfilePage, retryDeferredPersonMigration, whenProfileDisplayReady } = await import('../app/profile/profile-navigation.js');
    const phases = process.env.P12C_MIGRATION_BARRIER ? [process.env.P12C_MIGRATION_BARRIER] : ['write', 'readback'];
    for (const phase of phases) for (const scenario of ['start', 'retry', 'multiple', 'partner', 'future']) {
        const data = { profile_aktuelles_alter: '67', profile_rente_monatlich: '1000', sim_p1Monatsrente: '1234.567',
            ...(scenario === 'future' ? { profile_rente_monatlich: '0', sim_p1StartInJahren: '2' } : {}),
            ...(scenario === 'partner' ? { sim_r2Monatsrente: '2000' } : {}) };
        const initial = records(data, ['multiple', 'partner'].includes(scenario)
            ? { profile_aktuelles_alter: '65', profile_rente_monatlich: '1500', sim_p1Monatsrente: '2000' } : null);
        const f = fixture(initial), entered = deferred(), release = deferred();
        const save = f.adapter.saveBatch, load = f.adapter.loadAll;
        let armed = false, writes = 0;
        f.adapter.saveBatch = async batch => {
            if (batch.upserts.some(([key]) => key === 'profile_person_schema_version')) {
                writes++; armed = true;
                if (phase === 'write') { entered.resolve(); await release.promise; }
            }
            return save(batch);
        };
        f.adapter.loadAll = async () => {
            if (armed && phase === 'readback') { armed = false; entered.resolve(); await release.promise; }
            return load();
        };
        await install(f);
        const doc = createSelectionDocument(), create = doc.createElement;
        doc.addEventListener = doc.body.addEventListener.bind(doc.body);
        doc.removeEventListener = doc.body.removeEventListener.bind(doc.body);
        doc.contains = node => node.isConnected;
        doc.querySelector = selector => doc.body.querySelector(selector);
        let durableAtClose = false;
        doc.createElement = tag => {
            const node = create(tag); node.append = (...nodes) => nodes.forEach(child => node.appendChild(child));
            node.focus = () => { doc.activeElement = node; }; node.showModal = () => { node.open = true; };
            node.close = () => { node.open = false; node.dispatchEvent({ type: 'close' }); };
            if (tag === 'dialog') {
                const remove = node.remove.bind(node);
                node.remove = () => {
                    const backend = f.backend(), registry = JSON.parse(backend.rs_profiles_v1);
                    durableAtClose = backend.profile_person_schema_version === '1' && Boolean(backend.profile_person_migration_v1)
                        && Object.values(registry.profiles).every(p => p.data.profile_person_schema_version === '1' && p.data.profile_person_migration_v1);
                    remove();
                };
            }
            return node;
        };
        const field = addField(doc, 'profileRenteMonatlich');
        const query = doc.querySelectorAll.bind(doc);
        doc.querySelectorAll = selector => selector.startsWith('input[id^="profile"]') ? [field] : query(selector);
        let reloads = 0;
        const win = { name: '', addEventListener() {}, removeEventListener() {}, location: { href: 'http://localhost/Simulator.html', reload() { reloads++; } } };
        doc.defaultView = win;
        const waitFor = async test => { for (let i = 0; i < 300 && !test(); i++) await new Promise(resolve => setImmediate(resolve)); assert(test(), scenario + ': kontrollierte Barriere erreicht'); };
        const find = key => doc.body.querySelectorAll('*').find(node => node.dataset[key] !== undefined);
        let task = initializeProfilePage({ doc, win, kind: 'simulator' });
        await waitFor(() => doc.getElementById('pageChoiceDialog'));
        if (scenario === 'retry') {
            find('pageChoiceCancel').dispatchEvent({ type: 'click' }); await task;
            durableAtClose = false;
            task = retryDeferredPersonMigration({ doc, win });
            assertEqual(retryDeferredPersonMigration({ doc, win }), task, 'Echter Wiederholungsklick teilt Besitzer');
            await waitFor(() => doc.getElementById('pageChoiceDialog'));
        }
        const mapping = doc.body.querySelectorAll('*').find(n => n.dataset.pageChoiceField === 'mapping:a');
        if (mapping) { mapping.value = 'b'; mapping.dispatchEvent({ type: 'change' }); }
        const radios = doc.body.querySelectorAll('*').filter(n => n.type === 'radio');
        const pension = radios.find(n => n.dataset.pageChoiceField === 'a:renteMonatlich' && n.value === '1');
        pension.dispatchEvent({ type: 'change' });
        const dialog = doc.getElementById('pageChoiceDialog'), accept = find('pageChoiceAccept');
        accept.dispatchEvent({ type: 'click' });
        await waitFor(() => armed || writes > 0);
        await entered.promise;
        const visible = dialog.open && dialog.isConnected, focused = doc.activeElement === dialog || doc.activeElement?.parentNode === dialog || dialog.querySelectorAll('*').includes(doc.activeElement);
        const locked = field.disabled, blocked = PersistenceFacade.hasSyncWriteBlocks();
        accept.dispatchEvent({ type: 'click' });
        pension.parentNode.dispatchEvent({ type: 'click' });
        dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
        find('pageChoiceCancel')?.dispatchEvent({ type: 'click' });
        dialog.dispatchEvent({ type: 'keydown', key: 'Tab', preventDefault() {} });
        release.resolve(); await task;
        assert(visible && focused, phase + '/' + scenario + ': Dialog bleibt bis Backendabschluss sichtbar und fokussiert');
        assert(locked && blocked, 'Personenfeld und Fachwrites bis bestätigtem Readback gesperrt');
        assertEqual(writes, 1, 'Doppelklick committed höchstens einmal');
        assert(durableAtClose, 'Dialogschluss bestätigt beide Marker und sämtliche Registrykopien ohne Nachwartezeit');
        assertEqual(f.backend().profile_rente_monatlich, '1234.567', 'Eingefrorener Betrag exakt erhalten');
        assertEqual(reloads, scenario === 'retry' ? 1 : 0, 'Nur bestätigte Wiederholung lädt einmal neu');
        if (scenario === 'retry') {
            assert(field.disabled && !await whenProfileDisplayReady(doc), 'Altes Wiederholungsdokument bleibt gesperrt');
            assertEqual(retryDeferredPersonMigration({ doc, win }), task, 'Erfolgreicher Dokumentbesitzer verhindert einen zweiten Neustart');
            assertEqual(reloads, 1, 'Späterer Klick im alten Dokument lädt nicht nochmals neu');
        }
        if (scenario === 'future') assertEqual(JSON.parse(f.backend().profile_person_migration_v1).renteStartOffsetJahre, 2, 'Zukunftsrente behält Versatz 2');
        PersistenceFacade.resetPersistenceForTests(f.adapter); await PersistenceFacade.init({ installLifecycleHooks: false });
        let decisions = 0;
        const restarted = await migratePersonData({ now: new Date(2026, 9, 7), decide: async () => { decisions++; return null; }, doc: null, win: null });
        assertEqual(restarted.status, 'current', 'Backendneustart unmittelbar nach Dialogende bereits current');
        assertEqual(decisions, 0, 'Kein erneuter Entscheidungsdialog');
        PersistenceFacade.resetPersistenceForTests();
    }
}

// Echte Dialogfehler: kein Erfolgsende und keine Feldfreigabe nach Write/Readback.
{
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const { initializeProfilePage } = await import('../app/profile/profile-navigation.js');
    for (const fault of ['write', 'readback', 'rollback']) {
        const initial = records({ profile_rente_monatlich: '1000', sim_p1Monatsrente: '1100' }), f = fixture(initial, fault);
        await install(f);
        const doc = createSelectionDocument(), create = doc.createElement;
        doc.addEventListener = doc.body.addEventListener.bind(doc.body); doc.removeEventListener = doc.body.removeEventListener.bind(doc.body);
        doc.contains = n => n.isConnected; doc.querySelector = s => doc.body.querySelector(s);
        doc.createElement = tag => {
            const node = create(tag); node.append = (...nodes) => nodes.forEach(n => node.appendChild(n));
            node.focus = () => { doc.activeElement = node; }; node.showModal = () => { node.open = true; };
            node.close = () => { node.open = false; node.dispatchEvent({ type: 'close' }); }; return node;
        };
        const field = addField(doc, 'profileRenteMonatlich'), query = doc.querySelectorAll.bind(doc);
        doc.querySelectorAll = s => s.startsWith('input[id^="profile"]') ? [field] : query(s);
        let reloads = 0;
        const win = { name: '', addEventListener() {}, removeEventListener() {}, location: { reload() { reloads++; } } };
        const start = initializeProfilePage({ doc, win, kind: 'simulator' });
        for (let i = 0; i < 300 && !doc.getElementById('pageChoiceDialog'); i++) await new Promise(r => setImmediate(r));
        const dialog = doc.getElementById('pageChoiceDialog');
        doc.body.querySelectorAll('*').find(n => n.dataset.pageChoiceAccept !== undefined).dispatchEvent({ type: 'click' });
        assertEqual(await start, false, fault + ': technischer Fehler beendet Seitenstart nicht erfolgreich');
        assert(dialog.open && dialog.isConnected && field.disabled, fault + ': Fehlerdialog sichtbar, Personenfeld gesperrt');
        assert(dialog.querySelectorAll('*').some(n => n.textContent.includes('Übernahme nicht bestätigt')), 'Dialog erklärt fehlende Bestätigung');
        assertEqual(reloads, 0, 'Fehler löst keinen Neustart aus');
        if (fault === 'rollback') assert(PersistenceFacade.hasSyncWriteBlocks(), 'Unbestätigter Rollback erhält Recovery-Schreibsperre');
        else assertEqual(snapshot(f.backend()), snapshot(initial), 'Bestätigter Rollback erhält ursprüngliche Fachbytes');
        dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
        assert(!dialog.isConnected, 'Fehlerhinweis kann anschließend mit Cleanup geschlossen werden');
        PersistenceFacade.resetPersistenceForTests();
    }
}
