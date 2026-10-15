import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { previewPersonExport, confirmPersonExport, normalizePersonFile, previewPersonImport, importPersonFile } from '../app/profile/profile-person-file.js';
import { PersistenceFacade as p, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { PROBELAUF_STATE_KEY } from '../app/shared/persistence-key-policy.js';
import { projectPersonPension } from '../app/profile/profile-person-data.js';
import { LEGACY_PERSON_KEYS } from '../app/profile/profile-person-migration.js';
import { CONFIG } from '../app/balance/balance-config.js';
const canonical = records => JSON.stringify(Object.entries(records).sort());
async function fixture() {
    const records = createMusterHaushaltRecords('2026-09-01');
    const calls = []; const fail = {};
    const adapter = { name: 'person-test', loadAll: async () => {
            if (fail.readback && calls.length === 1) return { ...records, rs_profiles_v1: '{}' };
            return { ...records };
        }, saveBatch: async batch => {
            calls.push(batch);
            if (fail.rollback && calls.length > 1 || fail.write && calls.length === 1) throw new Error('SYNTHETIC_WRITE');
            for (const key of batch.deletes) delete records[key];
            for (const [key, value] of batch.upserts) records[key] = value;
            if (fail.gate) await fail.gate;
        } };
    resetPersistenceForTests(adapter); await p.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return { records, calls, fail };
}
let f = await fixture(); const before = canonical(f.records);
const id = f.records.rs_current_profile, other = Object.keys(JSON.parse(f.records.rs_profiles_v1).profiles).find(key => key !== id);
const preview = await previewPersonExport(id);
assertEqual(canonical(f.records), before, 'Personenexportvorschau bleibt schreibfrei');
const file = await confirmPersonExport(preview);
assertEqual(Object.keys(file.registry.profiles).join(), id, 'Export enthält genau die gewählte Person');
assertEqual(file.registry.profiles[id].data.depot_tranchen, f.records.depot_tranchen, 'Export verwendet bestätigtes Live-Depot');
assertEqual(file.registry.profiles[id].data.profile_cash_history_v1, f.records.profile_cash_history_v1, 'Export enthält Cashhistorie');
assert(!file.registry.profiles[id].data.overview_month_provision_v1 && !Object.keys(file.registry.profiles[id].data).some(key => key.startsWith('ruhestandsmodellValues')), 'Ein-Person-Datei enthält keine Haushaltsbelege oder Balance-Gesamtwerte');
assertEqual(Object.keys(file.globals).length, 0, 'Personenexport enthält keine Haushaltsglobals');
const inactive = await previewPersonExport(other);
assertEqual(inactive.file.registry.profiles[other].data.depot_tranchen, JSON.parse(f.records.rs_profiles_v1).profiles[other].data.depot_tranchen, 'Inaktive Person verwendet eigenes Depot');
const incoming = structuredClone(file); incoming.registry.profiles[id].meta.partnerProfileId = other;
incoming.registry.profiles[id].data.sim_partnerAktiv = 'false'; incoming.registry.profiles[id].data.sim_p2StartAlter = '55';
const plan = await previewPersonImport(incoming);
assertEqual(f.calls.length, 0, 'Importvorschau und Abbruch schreiben nichts');
const result = await importPersonFile(plan);
assertEqual(result.status, 'imported', 'Neue Außenperson dauerhaft bestätigt');
const registry = JSON.parse(f.records.rs_profiles_v1), oldRegistry = JSON.parse(JSON.parse(before).find(([key]) => key === 'rs_profiles_v1')[1]);
assertEqual(Object.keys(registry.profiles).length, Object.keys(oldRegistry.profiles).length + 1, 'Genau eine Person hinzugefügt');
for (const [key, profile] of Object.entries(oldRegistry.profiles)) assertEqual(JSON.stringify(registry.profiles[key]), JSON.stringify(profile), 'Bestehende Person bytegleich: ' + key);
for (const [key, value] of JSON.parse(before)) if (key !== 'rs_profiles_v1') assertEqual(f.records[key], value, 'Live, aktive Auswahl und Globals bytegleich: ' + key);
assertEqual(registry.profiles[result.id].meta.belongsToHousehold, false, 'Import erzeugt Außenperson');
assert(result.id !== id && result.name !== file.registry.profiles[id].meta.name, 'ID- und Namenskollisionen werden aufgelöst');
assert(!registry.profiles[result.id].meta.partnerProfileId && !registry.profiles[result.id].data.sim_partnerAktiv && !registry.profiles[result.id].data.sim_p2StartAlter, 'Fremde Partnerreferenzen und P2-Daten nicht übernommen');
const collision = await previewPersonImport(file);
assert(collision.id !== result.id && collision.name !== result.name, 'Wiederholter Import bekommt neue ID und Namen');
for (const mutation of [
    copy => copy.schemaVersion++, copy => copy.profileVersion++, copy => copy.registry.profiles.other = structuredClone(copy.registry.profiles[id]),
    copy => copy.globals.etfProxyUrl = 'https://synthetic.invalid', copy => copy.registry.profiles[id].data.unknown = 'x',
    copy => copy.registry.profiles[id].data.profile_tagesgeld = 'NaN', copy => copy.registry.profiles[id].data.depot_tranchen = '[{"shares":-1}]'
]) {
    const copy = structuredClone(file); mutation(copy); let rejected = false;
    try { normalizePersonFile(copy); } catch { rejected = true; }
    assert(rejected, 'Kaputte Version, Mehrpersonenbestand, Keys und Finanzwerte abgewiesen');
}
for (const mode of ['context', 'write', 'readback', 'rollback', 'trial']) {
    f = await fixture(); const baseline = canonical(f.records); const draft = await previewPersonImport(file);
    if (mode === 'context') p.setItemSync('rs_current_profile', other);
    if (mode === 'trial') p.setItemSync(PROBELAUF_STATE_KEY, '{}');
    if (mode === 'write') f.fail.write = true;
    if (['readback', 'rollback'].includes(mode)) f.fail.readback = true;
    if (mode === 'rollback') f.fail.rollback = true;
    let error; try { await importPersonFile(draft); } catch (e) { error = e; }
    assert(error, mode + ': Importfehler sichtbar');
    if (['context', 'trial'].includes(mode)) assertEqual(f.calls.filter(call => call.upserts.some(([key]) => key === 'rs_profiles_v1')).length, 0, mode + ': keine Registrymutation');
    else if (mode === 'rollback') assertEqual(error.code, 'rollback_failed', 'Unbestätigter Rollback wird nicht als Erfolg gemeldet');
    else assertEqual(canonical(f.records), baseline, mode + ': vorherige Bytes nach Rollback bestätigt');
}
f = await fixture(); let release; f.fail.gate = new Promise(resolve => release = resolve);
const draft = await previewPersonImport(file), first = importPersonFile(draft);
assertEqual((await importPersonFile(draft)).status, 'in_flight', 'Doppelklick startet keinen zweiten Import');
release(); await first;
f = await fixture(); const stale = await previewPersonExport(id); p.setItemSync('profile_tagesgeld', '42'); await p.flush();
let staleError; try { await confirmPersonExport(stale); } catch (error) { staleError = error; }
assert(staleError, 'Exportbestätigung verwirft veränderten Livebestand');
for (const action of [() => previewPersonExport(id, { probelaufController: { state: {} } }), () => previewPersonImport(file, { probelaufController: { busy: true } })]) {
    let rejected = false; try { await action(); } catch { rejected = true; } assert(rejected, 'Probelaufsperre gilt vor Export und Importvorschau');
}
resetPersistenceForTests();

// Unterstützte Altform des Profilbundles, nur synthetische Personenwerte.
function legacyPersonFile(data) {
    return { version: 1, exportedAt: '2025-09-01T10:00:00.000Z',
        registry: { version: 1, profiles: { legacy: {
            meta: { id: 'legacy', name: 'Max Mustermann', belongsToHousehold: false }, data
        } } }, currentProfileId: 'legacy', globals: {} };
}
{
    f = await fixture();
    const oldFile = legacyPersonFile({ sim_p1StartAlter: '61', profile_rente_monatlich: '1234.567', sim_p1StartInJahren: '3' });
    const original = JSON.stringify(oldFile), baseline = canonical(f.records);
    const draft = await previewPersonImport(oldFile);
    assertEqual(canonical(f.records), baseline, 'Altdateivorschau bleibt schreibfrei');
    const result = await importPersonFile(draft);
    const data = JSON.parse(f.records.rs_profiles_v1).profiles[result.id].data;
    assertEqual(projectPersonPension(data, 2026).renteImJahr, 0, 'Altdatei verliert künftigen Rentenbeginn nicht vor der Migration');
    assertEqual(projectPersonPension(data, 2028).renteImJahr, 1234.567 * 12, 'Rente beginnt im datierten Altjahr statt im Importjahr plus Offset');
    assertEqual(JSON.parse(data.profile_person_migration_v1).referenceYear, 2025, 'Exportjahr datiert den alten Simulatoroffset');
    assertEqual(JSON.stringify(oldFile), original, 'Personenimport verändert die Altdatei nicht');
    resetPersistenceForTests();
}
{
    f = await fixture();
    const current = structuredClone(file);
    current.registry.profiles[id].data.profile_rentenbeginn = '';
    current.registry.profiles[id].data.profile_person_migration_v1 = ' { "referenceYear": 2025, "sources": {}, "renteStartOffsetJahre": 3, "suggestedRentenbeginn": "2028-01-01" } ';
    const bytes = JSON.stringify(current), dataBytes = JSON.stringify(current.registry.profiles[id].data);
    const baseline = canonical(f.records), draft = await previewPersonImport(current);
    assertEqual(canonical(f.records), baseline, 'Aktuelle Importvorschau bleibt bytegleich');
    const imported = await importPersonFile(draft);
    const data = JSON.parse(f.records.rs_profiles_v1).profiles[imported.id].data;
    assertEqual(JSON.stringify(data), dataBytes, 'Heutiger Import erhält sämtliche Personen- und Depotbytes einschließlich Herkunfts-JSON');
    const exported = await confirmPersonExport(await previewPersonExport(imported.id));
    assertEqual(JSON.stringify(exported.registry.profiles[imported.id].data), dataBytes, 'Heutiger Export nach Import erhält sämtliche Datenbytes');
    assertEqual(JSON.stringify(current), bytes, 'Aktuelle Quelldatei bleibt bytegleich');
    assertEqual(projectPersonPension(data, 2026).renteImJahr, 0, 'Bereits datierter Rentenbeginn bleibt beim heutigen Import erhalten');
    resetPersistenceForTests();
}

// Alle Aliasnamen stammen aus P1/P2 der produktiven Personenmigration.
const ownLegacy = [
    ['sim_p1StartAlter', '61', 'profile_aktuelles_alter', '61'],
    ['sim_startAlter', '62', 'profile_aktuelles_alter', '62'],
    ['sim_p1Geschlecht', 'w', 'profile_geschlecht', 'w'],
    ['sim_geschlecht', 'd', 'profile_geschlecht', 'd'],
    ['sim_p1Monatsrente', '1234.567', 'profile_rente_monatlich', '1234.567'],
    ['sim_renteMonatlich', '2345.678', 'profile_rente_monatlich', '2345.678'],
    ['sim_p1StartInJahren', '3', 'offset', 3],
    ['sim_renteStartOffsetJahre', '2', 'offset', 2],
    ['sim_rentAdjMode', 'cpi', 'profile_rentenanpassung_art', 'cpi'],
    ['sim_renteIndexierungsart', 'fest', 'profile_rentenanpassung_art', 'fix'],
    ['sim_rentAdjPct', '-2.5', 'profile_rentenanpassung_pct', '-2.5'],
    ['sim_renteFesterSatz', '1.25', 'profile_rentenanpassung_pct', '1.25'],
    ['sim_r2Anpassung', '2.5', 'profile_rentenanpassung_pct', '2.5'],
    ['sim_p1KirchensteuerPct', '8', 'profile_kirchensteuer_pct', '8'],
    ['sim_kirchensteuerSatz', '0.09', 'profile_kirchensteuer_pct', '9'],
    ['sim_p1SparerPauschbetrag', '0', 'profile_sparer_pauschbetrag', '0'],
    ['sim_startSPB', '1000', 'profile_sparer_pauschbetrag', '1000']
];
const partnerLegacy = [
    ['sim_r2StartAlter', '63'], ['sim_r2Geschlecht', 'w'],
    ['sim_r2Monatsrente', '1234.567'], ['sim_r2Brutto', '24000'],
    ['sim_r2StartInJahren', '3'], ['sim_r2KirchensteuerPct', '9'],
    ['sim_r2SparerPauschbetrag', '1000'], ['sim_r2Steuerquote', '25']
];
const partnerFlags = ['sim_partnerAktiv', 'sim_chkPartnerAktiv'];
assertEqual([...ownLegacy.map(([key]) => key), ...partnerLegacy.map(([key]) => key), ...partnerFlags].sort().join(),
    [...LEGACY_PERSON_KEYS].sort().join(), 'Importprüfungen erfassen jeden bekannten sim_ Personenwert der Migration');
{
    f = await fixture(); const baseline = canonical(f.records);
    for (const [key, value, target, expected] of ownLegacy) {
        const incoming = legacyPersonFile({ [key]: value, sim_mcSeed: '42' });
        const original = JSON.stringify(incoming), draft = await previewPersonImport(incoming);
        const result = await importPersonFile(draft);
        const data = JSON.parse(f.records.rs_profiles_v1).profiles[result.id].data;
        const actual = target === 'offset' ? JSON.parse(data.profile_person_migration_v1).renteStartOffsetJahre : data[target];
        assertEqual(actual, expected, key + ': alter Personenwert vor der Filterung übernommen');
        assert(LEGACY_PERSON_KEYS.every(key => !Object.hasOwn(data, key)) && !Object.hasOwn(data, 'sim_mcSeed'), key + ': nur migrierte Personenwerte importiert');
        assertEqual(JSON.stringify(incoming), original, key + ': Altdatei bleibt unverändert');
    }
    for (const [key, value] of JSON.parse(baseline)) if (key !== 'rs_profiles_v1') assertEqual(f.records[key], value, 'Altfeldimporte erhalten Live- und Haushaltsbytes: ' + key);
    resetPersistenceForTests();
}
{
    f = await fixture();
    for (const [key, value] of [...partnerLegacy, ...partnerLegacy.filter(([key]) => key !== 'sim_r2Geschlecht').map(([key]) => [key, '0']),
        ...partnerFlags.flatMap(key => [[key, 'true'], [key, 'ungültig']])]) {
        const baseline = canonical(f.records), writes = f.calls.length;
        let error; try { await previewPersonImport(legacyPersonFile({ [key]: value })); } catch (caught) { error = caught; }
        assert(error && /Partner/.test(error.message), key + ': unklare Partnerwerte verständlich abgewiesen');
        assertEqual(f.calls.length, writes, key + ': keine Schreiboperation bei Abweisung');
        assertEqual(canonical(f.records), baseline, key + ': Bestand bleibt bytegleich');
    }
    for (const key of partnerFlags) for (const value of ['false', '']) {
        const result = await importPersonFile(await previewPersonImport(legacyPersonFile({ [key]: value })));
        const data = JSON.parse(f.records.rs_profiles_v1).profiles[result.id].data;
        assert(!Object.hasOwn(data, key), key + ': abgeschalteter oder leerer Partnerschalter entfällt nach Migration');
    }
    resetPersistenceForTests();
}
{
    f = await fixture(); const baseline = canonical(f.records);
    const conflicts = [
        { sim_p1StartAlter: '61', sim_startAlter: '62' },
        { profile_rente_monatlich: '0', sim_p1Monatsrente: '1000', sim_p1StartInJahren: '3' },
        { sim_p1StartInJahren: '2', sim_renteStartOffsetJahre: '3' },
        { profile_rentenbeginn: '2027-01-01', sim_p1StartInJahren: '3' },
        { profile_person_schema_version: '1', profile_person_migration_v1: '{"referenceYear":2025,"renteStartOffsetJahre":3}', sim_p1StartAlter: '61' },
        { sim_p1StartInJahren: '-1' }, { sim_p1StartInJahren: '9007199254740991' }, { sim_p1Geschlecht: 'unbekannt' },
        { sim_p1Monatsrente: 'NaN' }, { sim_p1KirchensteuerPct: '101' }
    ];
    for (const data of conflicts) {
        let error; try { await previewPersonImport(legacyPersonFile(data)); } catch (caught) { error = caught; }
        assert(error && /Personen|Rentenbeginn/.test(error.message), 'Widersprüchliche oder beschädigte Altdaten verständlich abgewiesen');
        assertEqual(canonical(f.records), baseline, 'Abgewiesene Altdaten verändern keine Bestandsbytes');
    }
    assertEqual(f.calls.length, 0, 'Abgewiesene Altdaten schreiben nichts');
    const balanceKey = CONFIG.STORAGE.LS_KEY;
    const incoming = legacyPersonFile({ sim_p1StartInJahren: '3', [balanceKey]: JSON.stringify({
        inputs: { renteMonatlich: 1234.567, aktuellesAlter: 61 },
        annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2025', pendingCommit: null }
    }) });
    const result = await importPersonFile(await previewPersonImport(incoming));
    const data = JSON.parse(f.records.rs_profiles_v1).profiles[result.id].data;
    assertEqual(JSON.parse(data.profile_person_migration_v1).referenceYear, 2026, 'Planungsjahr der Datei hat gemäß Personenmigration Vorrang vor Exportjahr');
    assertEqual(data.profile_rente_monatlich, '1234.567', 'Alte Balance-Personenwerte werden vor der Filterung übernommen');
    assertEqual(projectPersonPension(data, 2028).renteImJahr, 0, 'Datierter Rentenbeginn berücksichtigt Jahresmetadaten');
    assert(!Object.hasOwn(data, balanceKey), 'Haushaltsbezogener Balancebeleg wird erst nach Migration entfernt');
    resetPersistenceForTests();
}
