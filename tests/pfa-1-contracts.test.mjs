import { readFileSync } from 'node:fs';
import { readCareCostSettings, resolveCareSetting } from '../app/shared/care-cost-resolver.js';
import { calculateCareNeeds } from '../app/shared/care-needs.js';
import { careTodayErrors, CARE_VALUE_KEYS } from '../app/profile/profile-care.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { readCareInputs } from '../app/simulator/simulator-input-care.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { captureProfileData } from '../app/profile/profile-live-storage.js';
import { exportProfilesBundle, importProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { isAllowedSnapshotCaptureKey, isProbelaufRecordKey } from '../app/shared/persistence-key-policy.js';
import { normalizePersonFile } from '../app/profile/profile-person-file.js';
import { syncManagerCareToday } from '../app/tranches/tranchen-manager-care.js';
import { renderCareTodaySummary } from '../app/simulator/simulator-care-today-ui.js';
import { careRowUsesResidentialCosts } from '../app/simulator/simulator-ui-pflege.js';
import { makeDefaultCareMeta, initMcRunState, simulateOneYear, priceCareMeta } from '../app/simulator/simulator-engine-wrapper.js';
import { priceMonteCarloCareForYear } from '../app/simulator/mc-life-events.js';
import { updateResidentialCareState } from '../app/simulator/simulator-residential-care.js';
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixture, records as fixtureRecords } from './extended/parity-replay-fixture.mjs';
import { buildCareMetrics } from '../app/simulator/results-metrics.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { previewPersonExport, previewPersonImport, importPersonFile } from '../app/profile/profile-person-file.js';
setAppTestDate('2026-10-23');
const record = { sim_pflegeStufe1Zusatz: '6000', sim_pflegeStufe2Zusatz: '12000', sim_pflegeKostenDrift: '3.5',
    sim_pflegeCustomCosts: JSON.stringify({ 1: '6000', 2: '12000', 3: '7000', 4: '0', 5: '60000' }) };
let writes = 0, removes = 0;
const readOnly = { getItem: key => record[key] ?? null, setItem() { writes++; }, removeItem() { removes++; } };
const settings = readCareCostSettings(readOnly);
assertEqual(JSON.stringify(settings.costs), JSON.stringify({ 1: 3600, 2: 6000, 3: 18000, 4: 32000, 5: 60000 }), 'K Vorgaben, fehlende Werte und Altwerte über gemeinsamen Resolver');
assertEqual(settings.driftPercent, 5, 'K Kostenanstieg 3,5 wird lesend 5');
assertEqual(resolveCareSetting('sim_pflegeKostenDrift', '4.0'), 4, 'K eigene 4 % bleiben');
assertEqual(resolveCareSetting('sim_pflegeKostenDrift', '4,0'), 4, 'K eigene Werte mit Dezimalkomma bleiben');
assertEqual(resolveCareSetting('sim_pflegeKostenDrift', '  '), 5, 'P8 leere Leerzeichen sind keine bewusste Null');
assertEqual(resolveCareSetting('sim_pflegeStufe1Zusatz', '7000'), 7000, 'K eigene 7.000 bleiben');
assertEqual(resolveCareSetting('sim_pflegeStufe1Zusatz', '0'), 0, 'P8 bewusst 0 bleibt 0');
assertEqual(resolveCareSetting('sim_pflegeKostenDrift', ''), 5, 'P8 fehlend ist keine Null');
assertEqual(settings.rememberedCosts[1], '3600', 'K gemerkte eigene Staffel liest Altvorgabe neu');
assertEqual(settings.rememberedCosts[4], '0', 'K gemerkte bewusste Null bleibt');
const doc = { getElementById: id => ({ value: record[`sim_${id}`] ?? '', dataset: {} }) };
const fromDom = readCareInputs({ doc, storage: readOnly });
const profile = Object.values(JSON.parse(fixtureRecords.rs_profiles_v1).profiles)[0].data;
const fromProfile = buildSimulatorInputsFromProfileData({ ...profile, ...record }, { storage: readOnly, referenceYear: 2026, planValues: null });
for (const input of [fromDom, fromProfile]) {
    assertEqual(input.pflegeGradeConfigs[1].zusatz, 3600, 'K DOM und Profil dieselbe Staffel');
    assertEqual(input.pflegeKostenDrift, .05, 'K DOM und Profil derselbe Kostenanstieg');
}
assertEqual(writes, 0, 'P8 Lesen ruft setItem nie auf');
assertEqual(removes, 0, 'P8 Lesen ruft removeItem nie auf');
const inputs = { ...fixture, careReferenceDate: '2026-10-23', startFloorBedarf: 36000, startFlexBedarf: 12000,
    minimumFlexAnnual: 6000, survivorFloorPercent: 75, pflegeMaxFloor: 120000, pflegeKostenDrift: .05,
    pflegeRegionalZuschlag: 0, pflegeHeimEigeneAusgaben: 500, pflegeRampUp: 5,
    pflegeGradeConfigs: Object.fromEntries([3600, 6000, 18000, 32000, 60000].map((zusatz, i) => [i + 1,
        { zusatz, flexCut: [1, 1, .5, 0, 0][i], mortalityFactor: 0 }])),
    partner: { ...fixture.partner, careToday: { grade: 4, form: 'residential', residentialSince: '2023-01' } } };
const meta = makeDefaultCareMeta(false, 'm', inputs.partner.careToday, 80, inputs);
meta.currentYearInCare = 1;
const household = { p1Alive: true, p2Alive: true, care: { p1: null, p2: meta } };
const original = JSON.stringify({ inputs, household });
const projection = calculateCareNeeds({ inputs, household, referenceDate: '2026-10-23' });
assertClose(projection.current.total, 58332, 1e-8, 'P9 reine Funktion laufendes Jahr D');
assertClose(projection.next.total, 59598.6, 1e-8, 'P9 reine Funktion Folgejahr E');
assertEqual(projection.current.persons[1].residentialCosts, 25332, 'P9 Person und Bestandteil getrennt');
assertEqual(projection.current.persons[0].homeFloor, 27000, 'P9 Grundbedarf der Person zu Hause');
assertEqual(projection.current.flexFactor, .75, 'P2 absoluter Flex-Faktor');
assertEqual(JSON.stringify({ inputs, household }), original, 'P9 Vorschau mutiert keine Eingaben oder Metadaten');
{
    const person = { grade: 3, form: 'residential', residentialSince: '2023-01' };
    const i = { ...inputs, careToday: person, pflegeGradeConfigs: { ...inputs.pflegeGradeConfigs,
        4: { ...inputs.pflegeGradeConfigs[4], careForm: 'home-support' } } };
    const care = makeDefaultCareMeta(false, 'w', person, 80, i);
    const h = { p1Alive: true, p2Alive: true, care: { p1: care, p2: null } };
    updateResidentialCareState(care, i, 0, h, 0);
    assertEqual(care.heimJahr, 4, 'Heutiger Heimfall beginnt mit historischer Aufenthaltsdauer');
    care.grade = 4; updateResidentialCareState(care, i, 0, h, 1);
    assertEqual(care.heimJahr, undefined, 'Andere Staffel-Form beendet den Heimaufenthalt');
    care.grade = 5; updateResidentialCareState(care, i, 0, h, 2);
    assertEqual(care.heimJahr, 1, 'Erneuter Heimeintritt beginnt ein neues Heimjahr 1');
    const old = { ...care, heimBestand: true, zusatzFloorZiel: 0, flexFactor: 1 };
    delete old.heimJahr;
    const replay = { ...h, care: { p1: old, p2: null } };
    updateResidentialCareState(old, i, 0, replay, 2);
    priceCareMeta(old, i, initMcRunState(i), 2);
    assertEqual(old.heimBestand, true, 'Alte gespeicherte Heim-Bestände bleiben lesbar');
    assertEqual(old.flexFactor, 1, 'Alte Heim-Bestände behalten ihren aufgezeichneten Flexbezug');
    const legacy = calculateCareNeeds({ inputs: i, household: replay, priced: true });
    assertEqual(legacy.current.total, 36000, 'Altes Replay behält die aufgezeichnete Bestandsrechnung');
}
for (const [alive, expected, current] of [[[true, false], 27000, 43299.3], [[false, true], 33928.53, 46098.6]]) {
    const care = { ...meta, currentYearInCare: 2, heimJahr: 5 };
    const h = { p1Alive: alive[0], p2Alive: alive[1], care: { p1: null, p2: care } };
    const n = calculateCareNeeds({ inputs, household: h, referenceDate: '2026-10-23', yearIndex: 1, deathThisYear: true });
    assertClose(n.current.total, current, 1e-8, 'V laufendes Todesjahr F/G');
    assertClose(n.next.total, expected, 1e-8, 'V voller Resthaushalt im Folgejahr F/G');
}
const state = initMcRunState(inputs);
priceMonteCarloCareForYear(inputs, null, meta, state, 0, true, true, true);
const budget = { ...inputs, renteMonatlich: 0, partner: { ...inputs.partner, monatsrente: 0, brutto: 0 } };
let engineInput;
const engine = { simulateSingleYear(input, last) { engineInput = input; return EngineAPI.simulateSingleYear(input, last); } };
const result = simulateOneYear(state, budget, { jahr: 1930, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 }, 0,
    null, 0, household, .75, engine);
assertEqual(result.kind, 'success', 'P9 vollständiges Jahr mit heutiger Pflege');
assertClose(engineInput.careLiquidityProjection.floor, 59598.6, 1e-8, 'V Liquiditätsziel erhält Folgejahresbedarf');
assertEqual(engineInput.minimumFlexAnnual, 4500, 'P tatsächlicher Engine-Eingang kürzt Mindest-Flex');
for (const [both, cap] of [[false, 21000], [true, 0]]) {
    const today = { grade: both ? 4 : 3, form: both ? 'residential' : 'home-support' };
    const i = { ...budget, dynamicFlex: true, dynamicFlexHorizonYears: 5,
        careToday: both ? today : undefined, partner: { ...budget.partner, careToday: today } };
    const h = { p1Alive: true, p2Alive: true, care: { p1: both ? makeDefaultCareMeta(false, 'w', today, 80, i) : null,
        p2: makeDefaultCareMeta(false, 'm', today, 80, i) } };
    priceMonteCarloCareForYear(i, h.care.p1, h.care.p2, state, 0, true, true, true);
    const n = calculateCareNeeds({ inputs: i, household: h, referenceDate: i.careReferenceDate });
    const out = simulateOneYear(initMcRunState(i), i, { jahr: 1930, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 },
        0, h.care.p1, n.current.homeCareAddition, h, n.current.flexFactor, engine);
    assertEqual(out.kind, 'success', 'Q Dynamic Flex auswertbar');
    assertEqual(2 * engineInput.flexBedarf, cap, 'Q Haushaltsobergrenze einschließlich Einkommensanteil');
}
const storageOf = data => ({ records: { ...data }, get length() { return Object.keys(this.records).length; },
    key(i) { return Object.keys(this.records)[i] ?? null; }, getItem(k) { return this.records[k] ?? null; },
    setItem(k, v) { this.records[k] = String(v); }, removeItem(k) { delete this.records[k]; } });
const storage = storageOf(createMusterHaushaltRecords('2026-10-23'));
storage.setItem(CARE_VALUE_KEYS.grade, '4'); storage.setItem(CARE_VALUE_KEYS.form, 'residential');
storage.setItem(CARE_VALUE_KEYS.residentialSince, '2023-01');
const captured = captureProfileData(storage);
assertEqual(captured[CARE_VALUE_KEYS.residentialSince], '2023-01', 'Seit in Livequelle und Registry-Capture');
const registry = JSON.parse(storage.getItem('rs_profiles_v1')), id = storage.getItem('rs_current_profile');
registry.profiles[id].data = captured; storage.setItem('rs_profiles_v1', JSON.stringify(registry));
const target = storageOf(createMusterHaushaltRecords('2026-10-23'));
assert(importProfilesBundle(exportProfilesBundle({ storage }), { storage: target }).ok, 'Seit in Profilbundle');
assertEqual(target.getItem(CARE_VALUE_KEYS.residentialSince), '2023-01', 'Seit beim Wiederherstellen erhalten');
const entries = Object.entries(registry.profiles).map(([profileId, entry]) => ({ profileId, name: entry.meta.name,
    inputs: buildSimulatorInputsFromProfileData(entry.data, { storage, referenceYear: 2026, planValues: null }) }));
const combined = combineSimulatorProfiles(entries, entries.find(entry => entry.profileId !== id).profileId).combined;
assertEqual(combined.partner.careToday.residentialSince, '2023-01', 'Seit bei Umkehr der Simulator-Profilkombination der richtigen Person zugeordnet');
assert(normalizeFullPersistenceBackup(buildFullPersistenceBackup({ storage })).ok, 'Seit in Vollsicherung');
assert(isAllowedSnapshotCaptureKey(CARE_VALUE_KEYS.residentialSince) && isProbelaufRecordKey(CARE_VALUE_KEYS.residentialSince), 'Seit in Wiederherstellungspunkt und Spielbereich');
for (const invalid of ['2026-13', '2027-01', '2023-1', 202301]) {
    assert(careTodayErrors({ grade: 4, residentialSince: invalid }).length > 0, 'Seit: Schema und Zukunft werden abgewiesen');
    assert(!validatePersistenceDomainRecords({ ...storage.records, [CARE_VALUE_KEYS.residentialSince]: invalid }).ok, 'Import und Recovery prüfen Seit');
}
const fields = { profileCareGradeToday: { value: '4' }, profileCareFormToday: { value: 'residential' },
    profileCareResidentialSince: {}, profileCareResidentialSinceField: {} };
syncManagerCareToday({ getElementById: id => fields[id] }, storage);
assertEqual(fields.profileCareResidentialSinceField.hidden, false, 'Seit bei Heimform sichtbar');
fields.profileCareFormToday.value = 'home-support';
syncManagerCareToday({ getElementById: id => fields[id] }, storage);
assertEqual(fields.profileCareResidentialSinceField.hidden, true, 'Seit bei häuslicher Form verborgen');
const play = await playFixture('tauri', storage.records);
try {
    let controller = await play.boot();
    const exported = await previewPersonExport(id);
    assertEqual(normalizePersonFile(exported.file).profile.data[CARE_VALUE_KEYS.residentialSince], '2023-01', 'Seit im echten Personenexport');
    const draft = await previewPersonImport(exported.file), imported = await importPersonFile(draft);
    assertEqual(JSON.parse(P.getItemSync('rs_profiles_v1')).profiles[imported.id].data[CARE_VALUE_KEYS.residentialSince], '2023-01', 'Seit im bestätigten Personenimport');
    const baseline = play.realBytes();
    await controller.start(() => ({ source: 'copy', testDate: '2026-10-23' })); controller = await play.boot();
    assertEqual(P.getItemSync(CARE_VALUE_KEYS.residentialSince), '2023-01', 'Seit wird in den Spielbereich kopiert');
    P.setItemSync(CARE_VALUE_KEYS.residentialSince, '2024-02'); await P.flush();
    assertEqual(play.realBytes(), baseline, 'Geändertes Seit lässt Echtbestand bytegleich');
    await controller.end(() => true); await play.boot();
    assertEqual(P.getItemSync(CARE_VALUE_KEYS.residentialSince), '2023-01', 'Seit kehrt nach Spielbereichende unverändert zurück');
} finally { await resetPersistenceForTests(); }
const oldDocument = globalThis.document;
const host = { dataset: {} }; globalThis.document = { getElementById: id => id === 'simCareTodaySummary' ? host
    : id === 'pflegeStufe4Form' ? { value: 'residential' } : id === 'pflegeKostenStaffelPreset' ? { value: 'custom' } : null };
renderCareTodaySummary(document, { careToday: { grade: 4, form: 'home-support' } });
assertEqual(careRowUsesResidentialCosts(4), false, 'P11 heutige Pflege zu Hause hält Heimzeilenbetrag nutzbar');
globalThis.document = oldDocument;
const metrics = buildCareMetrics({ extraKPI: { pflege: { p1: {}, p2: {}, household: {}, comparison: {} } } },
    { pflegefallLogikAktivieren: false, careToday: { grade: 3 } });
assert(metrics?.cards.length > 0, 'B17 Pflegeauswertung auch ohne Zufallspflege');
setAppTestDate(null);
