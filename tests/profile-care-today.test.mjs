import { normalizeCareForm } from '../app/shared/care-benefits.js';
import { projectAnnualPreview } from '../app/balance/balance-annual-preview.js';
import { writeIncome } from '../app/profile/profile-income.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { CARE_VALUE_KEYS, careTodayFromRecord, careTodayFromStorage } from '../app/profile/profile-care.js';
import { loadProfileAssetValues, saveProfileAssetValues, applyProfileAssetValuesToDom } from '../app/profile/profile-asset-values.js';
import { captureProfileData } from '../app/profile/profile-live-storage.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { exportProfilesBundle, importProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { previewPersonExport, previewPersonImport, importPersonFile } from '../app/profile/profile-person-file.js';
import { syncManagerCareToday } from '../app/tranches/tranchen-manager-care.js';
import { renderCareTodaySummary } from '../app/simulator/simulator-care-today-ui.js';
import { projectPersonPension } from '../app/profile/profile-person-data.js';
import { careSettingsFromRecord } from '../app/shared/care-benefits.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';

const storageOf = (records = {}) => ({ records: { ...records }, get length() { return Object.keys(this.records).length; },
    key(i) { return Object.keys(this.records)[i] ?? null; }, getItem(key) { return this.records[key] ?? null; },
    setItem(key, value) { this.records[key] = String(value); }, removeItem(key) { delete this.records[key]; } });
const initial = createMusterHaushaltRecords('2026-10-20'), storage = storageOf(initial);
assertEqual(careTodayFromRecord({}).grade, 0, 'Alte Profile ohne neue Schlüssel bedeuten keiner');
const expected = { grade: 2, form: 'family', progression: 'slower' };
storage.setItem(CARE_VALUE_KEYS.additionalMonthly, 'obsolete');
storage.setItem(CARE_VALUE_KEYS.allowanceAsIncome, 'obsolete');
storage.setItem('sim_pflegeStufe2Form', 'family');
storage.setItem('sim_pflegeStufe3Form', 'external');
const values = { ...loadProfileAssetValues(storage), careToday: expected };
saveProfileAssetValues(values, storage);
assertEqual(JSON.stringify(loadProfileAssetValues(storage).careToday), JSON.stringify(expected), 'Profil speichert Grad und angenommenen Verlauf');
const registry = JSON.parse(storage.getItem('rs_profiles_v1')), id = storage.getItem('rs_current_profile');
registry.profiles[id].data = captureProfileData(storage);
storage.setItem('rs_profiles_v1', JSON.stringify(registry));
const bundle = exportProfilesBundle({ storage }), target = storageOf(initial);
assert(importProfilesBundle(bundle, { storage: target }).ok, 'Profilbundle importiert den heutigen Pflegezustand');
assertEqual(JSON.stringify(careTodayFromStorage(target)), JSON.stringify(expected), 'Import/Export erhält die aktiven Werte');
for (const schemaVersion of [1, 2]) {
    const backup = buildFullPersistenceBackup({ storage }); backup.schemaVersion = schemaVersion;
    const normalized = normalizeFullPersistenceBackup(backup);
    assert(normalized.ok, `Vollsicherung Schema ${schemaVersion} mit Pflegegrad importierbar`);
    assertEqual(normalized.backup.records.sim_pflegeStufe2Form, 'family', 'Vollsicherung erhält die Pflegeform');
    assertEqual(normalized.backup.records[CARE_VALUE_KEYS.additionalMonthly], 'obsolete', 'Vollsicherung bewahrt still ignorierte Altwerte');
}
for (const [key, value] of [[CARE_VALUE_KEYS.grade, '6'], [CARE_VALUE_KEYS.progression, 'unknown']]) {
    assertEqual(validatePersistenceDomainRecords({ ...storage.records, [key]: value }).ok, false, 'Import verwirft ungültigen Pflegewert: ' + key);
}
const inputs = buildSimulatorInputsFromProfileData(registry.profiles[id].data, { referenceYear: 2026 });
assertEqual(JSON.stringify(inputs.careToday), JSON.stringify(expected), 'Profilreader transportiert Pflegezustand');
const other = Object.keys(registry.profiles).find(key => key !== id);
const partnerData = { ...registry.profiles[other].data, ...Object.fromEntries(Object.values(CARE_VALUE_KEYS).map(key => [key, storage.getItem(key)])) };
const combined = combineSimulatorProfiles([
    { profileId: id, name: 'Max Mustermann', inputs: buildSimulatorInputsFromProfileData(registry.profiles[other].data, { referenceYear: 2026 }) },
    { profileId: other, name: 'Erika Mustermann', inputs: buildSimulatorInputsFromProfileData(partnerData, { referenceYear: 2026 }) }
], id).combined;
assert(!combined.careToday && combined.partner.careToday.grade === 2, 'Partnergrad bleibt der zweiten Person zugeordnet');
// Balance hat nur eine Zweckbindung, keine gradabhängige Freigabe und keine Pflegekosten.
const before = buildBalanceEngineInputFromStorage({ storage: storageOf(initial), referenceYear: 2026 });
const after = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
assertEqual(after.engineInput.renteMonatlich, before.engineInput.renteMonatlich + 347, 'Balance zählt Pflegegeld zu monatlichen Einkünften');
{
    const dom = { profileCareGradeToday: { value: '2' }, profileCareTodayFields: {}, profileCareAllowanceRow: {},
        profileCareAdditionalMonthly: { value: '0' }, profileCareIncomeWarning: {}, profileEinkuenfte: { value: writeIncome([{ id: 'care', art: 'sonstige', bezeichnung: 'Pflegegeld Probe', betragMonat: 347, ab: null, bis: null, anpassung: 'keine' }]) } };
    const doc = { getElementById: id => dom[id] ?? null };
    syncManagerCareToday(doc, storage);
    assertEqual(dom.profileCareAdditionalMonthly.value, '0', 'Platzhalter überschreibt keine eigenen Mehrkosten');
    assertEqual(dom.profileCareIncomeWarning.hidden, false, 'Bezeichnung Pflegegeld löst Hinweis aus, ohne Einkunft zu löschen');
    dom.profileEinkuenfte.value = writeIncome([]);
    dom.profileRenteBezeichnung = { value: 'Pflegegeld Probe' };
    syncManagerCareToday(doc, storage);
    assertEqual(dom.profileCareIncomeWarning.hidden, false, 'Pflegegeld-Hinweis erfasst auch die Bezeichnung einer bestehenden Rentenzeile');
    dom.profileCareGradeToday.value = '0'; syncManagerCareToday(doc, storage);
    assertEqual(dom.profileCareTodayFields.hidden, true, 'Ohne Grad verschwinden abhängige Felder');
    const checkbox = { value: '', checked: false }, fields = { profileCareAllowanceAsIncome: checkbox };
    applyProfileAssetValuesToDom(values, { getElementById: id => fields[id] ?? null });
    assertEqual(checkbox.checked, false, 'Entferntes Häkchen wird nicht mehr projiziert');
    const summary = {}, simulator = { getElementById: id => id === 'simCareTodaySummary' ? summary : id === 'pflegeStufe2Zusatz' ? { value: '0' } : null };
    renderCareTodaySummary(simulator, { ...combined, partner: { aktiv: false }, careToday: { ...expected, additionalMonthly: null } });
    assert(summary.textContent.includes('Grad 2') && !summary.textContent.includes('Mehrkosten'), 'Simulator-Lesezeile nennt den heutigen Grad ohne entfallenes Feld');
}
{
    const f = await playFixture('tauri', storage.records); let controller = await f.boot();
    const realBytes = f.realBytes();
    const exported = await previewPersonExport(id);
    assertEqual(exported.file.registry.profiles[id].data[CARE_VALUE_KEYS.grade], '2', 'Ein-Person-Datei enthält den heutigen Grad');
    const draft = await previewPersonImport(exported.file); const imported = await importPersonFile(draft);
    assertEqual(JSON.parse(P.getItemSync('rs_profiles_v1')).profiles[imported.id].data[CARE_VALUE_KEYS.progression], 'slower', 'Personenimport erhält den Verlauf');
    const baseline = f.realBytes();
    await controller.start(() => ({ source: 'copy', testDate: '2026-12-15' })); controller = await f.boot();
    assertEqual(P.getItemSync(CARE_VALUE_KEYS.grade), '2', 'Spielbereich kopiert den heutigen Grad');
    assertEqual(P.getItemSync('sim_pflegeStufe2Form'), 'family', 'Spielbereich kopiert die Pflegeform');
    P.setItemSync(CARE_VALUE_KEYS.grade, '3');
    P.setItemSync('sim_pflegeStufe2Form', 'external'); await P.flush();
    await controller.changeDate('2027-01-02'); controller = await f.boot();
    assertEqual(P.getItemSync(CARE_VALUE_KEYS.grade), '3', 'Pflegegrad bleibt bei Spielbereich-Neustart erhalten');
    assertEqual(P.getItemSync('sim_pflegeStufe2Form'), 'external', 'Geänderte Pflegeform bleibt bei Spielbereich-Neustart erhalten');
    assertEqual(f.realBytes(), baseline, 'Spieländerung lässt den Echtbestand bytegleich');
    await controller.end(() => true); await f.boot();
    assertEqual(P.getItemSync(CARE_VALUE_KEYS.grade), '2', 'Nach Spielbereichende ist der echte Pflegegrad wieder da');
    assertEqual(P.getItemSync('sim_pflegeStufe2Form'), 'family', 'Spielbereichende stellt die echte Pflegeform wieder her');
    assertEqual(f.realBytes(), baseline, 'Rückkehr erhält alle echten Bytes');
    assert(realBytes !== baseline, 'Vorheriger Personenimport wurde tatsächlich dauerhaft gespeichert');
    resetPersistenceForTests();
}

assertEqual(storage.getItem(CARE_VALUE_KEYS.additionalMonthly), 'obsolete', 'Autosave überschreibt alte Mehrkosten nicht');
assertEqual(storage.getItem(CARE_VALUE_KEYS.allowanceAsIncome), 'obsolete', 'Autosave überschreibt altes Häkchen nicht');
for (const key of ['sim_pflegeStufe2Form', 'sim_pflegeStufe3Form']) {
    assertEqual(target.getItem(key), normalizeCareForm(storage.getItem(key), Number(key.match(/Stufe([1-5])/)[1])), 'Pflegeform wird beim Profilimport sofort übernommen: ' + key);
}

{
    const data = { ...registry.profiles[id].data, profile_care_grade_today: '2' };
    assertEqual(projectPersonPension(data, 2027).pflegegeld, 347, 'Balance leitet Pflegegeld für das Planungsjahr ab');
    assertEqual(projectPersonPension({ ...data, sim_pflegeKostenStaffelPreset: 'amtlich' }, 2027).pflegegeld, undefined, 'Balance zählt bei Amtlichem Durchschnitt kein Pflegegeld');
    assertEqual(projectPersonPension({ ...data, profile_care_form_today: 'home-support', sim_pflegeStufe2Form: 'external' }, 2027).pflegegeld, undefined, 'Balance zählt bei externer Pflege kein Pflegegeld');
    const shared = careSettingsFromRecord({ sim_pflegeStufe2Form: 'external' });
    assertEqual(projectPersonPension({ ...data, profile_care_form_today: '' }, 2027, shared).pflegegeld, undefined, 'Ohne persönliche Form verwendet der Partner die gemeinsame Staffel des Hauptprofils');
    assertEqual(validatePersistenceDomainRecords({ ...storage.records, sim_pflegeStufe2Form: 'invalid' }).ok, false, 'Sicherungsimport verwirft unbekannte Pflegeform');
}

{
    const data = { ...registry.profiles[id].data, profile_care_grade_today: '2' };
    const preview = projectAnnualPreview({ targetYear: 2026, confirmed: true, inputs: {},
        storage: storageOf({ rs_current_profile: 'erika' }), entries: [
            { profileId: 'max', name: 'Max', data: { ...data, sim_pflegeKostenStaffelPreset: 'custom' } },
            { profileId: 'erika', name: 'Erika', data: { ...data, sim_pflegeKostenStaffelPreset: 'amtlich' } }
        ] });
    assert(preview.people.every(person => !person.error && person.pflegegeld === 347), 'Jahresvorschau folgt bei aktiver Person 2 der Staffel des ersten Haushaltsprofils');
}
