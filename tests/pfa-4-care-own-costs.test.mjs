// FR-73 Paket 4, Punkt 13: eigener Wert „Pflegekosten heute über die Kasse hinaus“ (Sollfall Z), Speicherwege des neuen
// Personenfelds, Personenkarte und Hinweise; dazu Gutachten PFA-3, Befund 2 (Hinweis nach gespeicherter Planänderung).
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { annualTestMarketData, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { HOUSEHOLD_PLAN_KEY, readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState, calcCareCost } from '../app/simulator/simulator-engine-wrapper.js';
import { fixedCareTodayForYear } from '../app/simulator/simulator-care-today.js';
import { composeYearNeed } from '../app/simulator/simulator-survivor.js';
import { calculateCareNeeds, homeCareAnnualCosts } from '../app/shared/care-needs.js';
import { createAnnualCareEditor } from '../app/shared/annual-care-editor.js';
import { applyCareTodayClosing, projectCareTodayMonthly } from '../app/shared/care-today-closing.js';
import { CARE_VALUE_KEYS, careTodayErrors, careTodayFromRecord } from '../app/profile/profile-care.js';
import { PROFILE_VALUE_KEYS } from '../app/profile/profile-state.js';
import { loadProfileAssetValues, saveProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { careHintPersons, renderCareHint, projectCareHint } from '../app/shared/care-hint.js';
import { syncManagerCareToday } from '../app/tranches/tranchen-manager-care.js';
import { createManagerHouseholdPlan } from '../app/tranches/tranchen-manager-household-plan.js';
import { createNavigationGuard, createNavigationOperationLifecycle } from '../app/shared/navigation-guard.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { exportProfilesBundle, importProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { isAllowedPersistenceImportKey, isAllowedSnapshotCaptureKey } from '../app/shared/persistence-key-policy.js';
import { probelaufDomainChecksum } from '../app/shared/probelauf-records.js';
import { PersistenceFacade as P, persistenceStorage, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
setAppTestDate('2026-10-23');

const own = (grade, form, homeCostsMonthly, extra = {}) => ({ grade, form, homeCostsMonthly, ...extra });
const close = (a, b, label, tolerance = 1e-6) => assert(Math.abs(a - b) < tolerance, `${label}: ${a} = ${b}`);
const listen = (node, type, fn) => node.addEventListener(type, fn);
const plain = text => String(text).replace(/[\u00a0\u202f]/g, ' ');
const KEY = CARE_VALUE_KEYS.homeCostsMonthly, ANCHOR = CARE_VALUE_KEYS.residentialFirstYear;
function balance(options) {
    const { records, scope } = pfa2Records(options);
    const { storage, counts } = countingStorage(records);
    const calculation = buildBalanceEngineInputFromStorage({ storage, scope, referenceYear: 2026 });
    assertEqual(counts.setItem + counts.removeItem, 0, 'Lesen schreibt nie');
    return { records, calculation, input: calculation.inputData, care: calculation.careNeeds, hint: calculation.careHint };
}
function simulatorYearOne(records) {
    const storage = { getItem: key => records[key] ?? null };
    const registry = JSON.parse(records.rs_profiles_v1), plan = readBalanceHouseholdPlan({ storage });
    const entries = IDS.map(profileId => ({ profileId, name: registry.profiles[profileId].meta.name,
        inputs: buildSimulatorInputsFromProfileData(registry.profiles[profileId].data, { storage, referenceYear: 2026, planValues: plan.entry.values, profileId }) }));
    const inputs = combineSimulatorProfiles(entries, IDS[0], { planValues: plan.entry.values }).combined;
    const state = initMcRunState(inputs), fixed = fixedCareTodayForYear(inputs, state, 0);
    return { inputs, fixed, need: composeYearNeed({ inputs, baseFloor: state.baseFloor, household: fixed.householdContext, deathThisYear: false, careFloorAddition: fixed.careFloorAddition }) };
}

// Sollfall Z: Werner heute Grad 2 Angehörige, Feld 0 €/Monat → 36.000 € und Pflegegeld 4.164 €; 200 €/Monat → 38.400 €. Parität Balance = Simulator Jahr 1.
{
    const zero = balance({ care: [null, own(2, 'family', 0)] });
    assertEqual(zero.input.floorBedarf, 36000, 'Z eigener Wert 0 €: Bedarf 36.000 € statt 42.000 € mit Staffel');
    assertEqual(zero.input.renteMonatlich * 12, 4164, 'Z Pflegegeld 4.164 €/Jahr bleibt Einkunft');
    const two = balance({ care: [null, own(2, 'family', 200)] });
    assertEqual(two.input.floorBedarf, 38400, 'Z eigener Wert 200 €/Monat: 36.000 + 2.400 = 38.400 €');
    assertEqual(two.care.persons[1].homeCostsMonthly, 200, 'Z Projektion nennt den eigenen Wert der Person');
    for (const [label, result] of [['0 €', zero], ['200 €', two]]) {
        const sim = simulatorYearOne(result.records);
        close(sim.need.total, result.input.floorBedarf, `Z Parität ${label}: Balance = Simulator Jahr 1`);
        close(calcCareCost(sim.fixed.householdContext.care.p2).zusatzFloor, result.care.persons[1].homeCareAddition, `Z Parität ${label}: Pflegezusatz je Person`);
        assertEqual(sim.inputs.partner.careToday.homeCostsMonthly, result.care.persons[1].homeCostsMonthly, `Z ${label}: Profilkombination trägt den eigenen Wert`);
    }
    const staffel = balance({ care: [null, { grade: 2, form: 'family' }] });
    assertEqual(staffel.input.floorBedarf, 42000, 'Z leeres Feld: Staffel 6.000 € (Sollfall B)');
    const persons = careHintPersons(two.care);
    assertEqual(`${persons[0].own} ${persons[0].monthly}`, 'true 200', 'Z Hinweis kennt den eigenen Wert');
    const host = { hidden: true, html: '', children: [], set innerHTML(value) { this.html = value; }, get innerHTML() { return this.html; }, replaceChildren() { this.html = ''; } };
    renderCareHint(host, { done: false, persons });
    assert(plain(host.html).includes('Pflege Werner: 200 €/Monat (Grad 2 zu Hause, eigener Wert)'), 'Z Hinweis nennt „eigener Wert“');
    renderCareHint(host, { done: false, persons: careHintPersons(staffel.care) });
    assert(host.html.includes('zu Hause, Staffel)'), 'Z Hinweis nennt sonst „Staffel“');
    const official = balance({ care: [null, own(3, 'home-support', 200)], sim: { sim_pflegeKostenStaffelPreset: 'amtlich' } });
    assertEqual(`${official.input.floorBedarf} ${official.input.renteMonatlich}`, '36000 0', 'Z „Amtlich“: Feld ohne Wirkung, Netto-Konvention (Sollfall N)');
    assertEqual(careHintPersons(official.care)[0].own, false, 'Z „Amtlich“: Hinweis nennt keinen eigenen Wert');
}

// Z im Simulator: Jahr 2 mit eigenem Wert fortgeschrieben (Kostenanstieg 5 %), nach Gradwechsel die Staffel des neuen Grads (18.900 €).
{
    const staffel = Object.fromEntries([3600, 6000, 18000, 32000, 60000].map((zusatz, i) => [i + 1, { zusatz, flexCut: [1, 1, .5, 0, 0][i], mortalityFactor: 0 }]));
    const inputs = { startFloorBedarf: 36000, startFlexBedarf: 0, minimumFlexAnnual: 0, partner: { aktiv: true, careToday: own(2, 'family', 200) }, careReferenceDate: '2026-10-23',
        pflegeGradeConfigs: staffel, pflegeMaxFloor: 120000, pflegeRampUp: 5, pflegeModellTyp: 'chronisch', pflegeKostenDrift: .05, pflegeRegionalZuschlag: 0, survivorFloorPercent: 75 };
    const meta = (grade, extra = {}) => ({ active: true, triggered: true, startAge: -1, durationYears: 0, currentYearInCare: 2, zusatzFloorZiel: 0, zusatzFloorDelta: 0, flexFactor: 1,
        kumulierteKosten: 0, floorAtTrigger: 0, flexAtTrigger: 0, maxFloorAtTrigger: 0, grade, gradeLabel: '', mortalityFactor: 0, personGender: 'm', initialGrade: 2, initialHomeCostsMonthly: 200, ...extra });
    const same = calculateCareNeeds({ inputs, household: { p1Alive: true, p2Alive: true, care: { p1: null, p2: meta(2) } }, referenceDate: '2026-10-23', yearIndex: 1 }).current;
    close(same.homeCareAddition, 2520, 'Z Jahr 2 im heutigen Grad: 200 × 12 × 1,05 = 2.520 €');
    const changed = calculateCareNeeds({ inputs, household: { p1Alive: true, p2Alive: true, care: { p1: null, p2: meta(3) } }, referenceDate: '2026-10-23', yearIndex: 1 }).current;
    close(changed.homeCareAddition, 18900, 'Z nach Wechsel auf Grad 3: Staffel 18.000 × 1,05 = 18.900 €, Rampe nur bei bindendem Deckel');
    close(homeCareAnnualCosts(meta(2, { currentYearInCare: 1 }), { ...inputs, pflegeRegionalZuschlag: .1 }, { baseFloor: 36000 }).homeCareAddition, 2400, 'Z eigener Wert ohne Regionalzuschlag (Staffel 6.600 €)');
    close(homeCareAnnualCosts(meta(2, { currentYearInCare: 1 }), { ...inputs, pflegeMaxFloor: 37000 }, { baseFloor: 36000 }).homeCareAddition, 1000, 'Z Deckel gilt auch für den eigenen Wert');
}

// Jahresabschluss „Pflegewerte“ schreibt den eigenen Wert wie die Staffel fort (× 1,02 × 1,05, ganze Euro) und zeigt ihn im Dialog.
{
    const { records, scope } = pfa2Records({ care: [own(2, 'family', 300), own(3, 'home-support', 200)] });
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
    state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state); records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) { const ownState = JSON.parse(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]); ownState.annualPeriodMetadata = state.annualPeriodMetadata; registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(ownState); }
    records.rs_profiles_v1 = JSON.stringify(registry);
    const marketData = { ...annualTestMarketData, inflation: { ...annualTestMarketData.inflation, rate: 2 } };
    assertEqual(projectCareTodayMonthly(200, { inflationRate: 2, driftPercent: 5 }), 214, 'Fortschreibung 200 × 1,02 × 1,05 = 214,20 → 214 €');
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, scope, storage: annualRecordStorage(records), now: annualTestNow });
    const prepared = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, adoptedPlanPatch: { floorBedarf: 36720 }, now: annualTestNow });
    const next = JSON.parse(prepared.records.rs_profiles_v1).profiles;
    assertEqual(`${next[IDS[0]].data[KEY]} ${next[IDS[1]].data[KEY]}`, '321 214', 'Abschluss schreibt 300 → 321 und 200 → 214 €/Monat in die Registry');
    assertEqual(prepared.records[KEY], '321', 'Abschluss schreibt den Wert der aktiven Person auch in die Livequelle');
    assertEqual(JSON.parse(records.rs_profiles_v1).profiles[IDS[1]].data[KEY], '200', 'Die Basis bleibt bis zum Abschluss unverändert');
    const after = buildBalanceEngineInputFromStorage({ storage: annualRecordStorage(prepared.records), scope, referenceYear: 2027 });
    assertEqual(after.inputData.floorBedarf, 36720 + 321 * 12 + 214 * 12, 'Balance 2027 rechnet mit den fortgeschriebenen eigenen Werten');
    const { doc } = createDialogFixture();
    const editor = createAnnualCareEditor({ doc, targetYear: 2026, storage: annualRecordStorage(records), listen }); doc.body.append(editor.root);
    const line = () => doc.querySelector('[data-annual-care-own-values]');
    assert(!line().hidden && line().textContent.includes('Helga 300 €/Monat') && line().textContent.includes('Werner 200 €/Monat'), 'Dialog nennt die eigenen Werte je Person');
    editor.setInflation(2);
    assert(line().textContent.includes('Helga 300 € → 321 €/Monat') && line().textContent.includes('Werner 200 € → 214 €/Monat'), 'Dialog zeigt die Fortschreibung der eigenen Werte');
    const none = createAnnualCareEditor({ doc, targetYear: 2026, storage: annualRecordStorage(pfa2Records({ care: [null, { grade: 3, form: 'home-support' }] }).records), listen });
    assert(none.root.querySelector('[data-annual-care-own-values]').hidden, 'Ohne eigene Werte bleibt die Zeile verborgen');
    const anchored = applyCareTodayClosing(annualRecordStorage(pfa2Records({ care: [null, { grade: 4, form: 'residential' }] }).records), { ids: IDS, activeId: IDS[0], inflationRate: 2, driftPercent: 5, targetYear: 2026 });
    assertEqual(JSON.stringify(anchored), JSON.stringify([{ profileId: IDS[1], key: ANCHOR, value: '2026' }]), 'Abschluss setzt nur den Heimjahr-Anker, wenn „seit“ fehlt');
    assertEqual(applyCareTodayClosing(annualRecordStorage(pfa2Records({ care: [null, { grade: 4, form: 'residential', residentialFirstYear: 2025 }] }).records), { ids: IDS, activeId: IDS[0], inflationRate: 2, driftPercent: 5, targetYear: 2026 }).length, 0, 'Ein vorhandener Anker bleibt');
}

// Speichervertrag: Schema, Import/Recovery, Vollsicherung, Profilbundle, Spielbereich, Schlüsselpolitik, Personenkarte.
{
    const { records } = pfa2Records({ care: [null, own(2, 'family', 200)] });
    assert(validatePersistenceDomainRecords(records).ok, 'Import und Recovery nehmen den eigenen Wert an');
    const werner = JSON.parse(records.rs_profiles_v1);
    for (const bad of ['-5', 'abc']) {
        const broken = structuredClone(werner); broken.profiles[IDS[1]].data[KEY] = bad;
        assert(!validatePersistenceDomainRecords({ ...records, rs_profiles_v1: JSON.stringify(broken) }).ok, `Import weist ungültigen eigenen Wert ab: ${bad}`);
    }
    const anchorBroken = structuredClone(werner); anchorBroken.profiles[IDS[1]].data[ANCHOR] = '26';
    assert(!validatePersistenceDomainRecords({ ...records, rs_profiles_v1: JSON.stringify(anchorBroken) }).ok, 'Import weist einen ungültigen Heimjahr-Anker ab');
    assertEqual(careTodayErrors({ grade: 2, form: 'family', homeCostsMonthly: '0' }).length, 0, '0 € ist ein gültiger eigener Wert');
    assertEqual(careTodayErrors({ grade: 2, form: 'family', homeCostsMonthly: '' }).length, 0, 'Leer ist erlaubt (Staffel)');
    assertEqual(careTodayErrors({ grade: 2, form: 'family', homeCostsMonthly: '-1' })[0].field, 'careToday.homeCostsMonthly', 'Negativ wird am Feld abgewiesen');
    assertEqual(careTodayFromRecord({ [CARE_VALUE_KEYS.grade]: '2', [KEY]: '199,5' }).homeCostsMonthly, 199.5, 'Dezimalkomma wird gelesen');
    const storage = annualRecordStorage(records);
    assertEqual(JSON.parse(normalizeFullPersistenceBackup(buildFullPersistenceBackup({ storage })).backup.records.rs_profiles_v1).profiles[IDS[1]].data[KEY], '200', 'Vollsicherung bewahrt den eigenen Wert');
    const target = annualRecordStorage(pfa2Records({}).records);
    assert(importProfilesBundle(exportProfilesBundle({ storage }), { storage: target }).ok, 'Profilbundle importierbar');
    assertEqual(JSON.parse(target.getItem('rs_profiles_v1')).profiles[IDS[1]].data[KEY], '200', 'Profilbundle trägt den eigenen Wert');
    assert([KEY, ANCHOR].every(key => isAllowedPersistenceImportKey(key) && isAllowedSnapshotCaptureKey(key)), 'Beide Schlüssel gehören zu Import und Wiederherstellungspunkt');
    assertEqual(`${PROFILE_VALUE_KEYS.care_homeCostsMonthly} ${PROFILE_VALUE_KEYS.care_residentialFirstYear}`, `${KEY} ${ANCHOR}`, 'Registry und Livequelle führen beide Schlüssel');
    const changedRecords = { ...records, [KEY]: '250' };
    assert(probelaufDomainChecksum(records) !== probelaufDomainChecksum(changedRecords), 'Im Spielbereich zählt der eigene Wert als Nutzeränderung');
    // Personenkarte: speichern und lesen; der Heimjahr-Anker bleibt nur, solange die Person im Heim lebt.
    const live = { records: { ...records, [ANCHOR]: '2025', [CARE_VALUE_KEYS.form]: 'residential', [CARE_VALUE_KEYS.grade]: '4' }, getItem(key) { return this.records[key] ?? null; }, setItem(key, value) { this.records[key] = String(value); }, removeItem(key) { delete this.records[key]; } };
    const values = loadProfileAssetValues(live);
    assertEqual(`${values.careToday.form} ${values.careToday.residentialFirstYear}`, 'residential 2025', 'Laden liest den Anker');
    saveProfileAssetValues({ ...values, careToday: { grade: 4, form: 'residential', progression: 'usual' } }, live);
    assertEqual(live.getItem(ANCHOR), '2025', 'Speichern aus der Karte behält den Anker im Heim');
    saveProfileAssetValues({ ...values, careToday: { grade: 2, form: 'family', homeCostsMonthly: '200', progression: 'usual' } }, live);
    assertEqual(`${live.getItem(ANCHOR)} ${live.getItem(KEY)}`, ' 200', 'Wechsel nach Hause löscht den Anker und speichert den eigenen Wert');
    saveProfileAssetValues({ ...values, careToday: { grade: 2, form: 'family', homeCostsMonthly: '', progression: 'usual' } }, live);
    assertEqual(live.getItem(KEY), '', 'Leeres Feld speichert leer (Staffel)');
    const card = { profileCareGradeToday: { value: '2' }, profileCareFormToday: { value: 'family' }, profileCareTodayFields: {}, profileCareHomeCostsField: {}, profileCareHomeCostsHelp: {}, profileCareResidentialSinceField: {} };
    syncManagerCareToday({ getElementById: id => card[id] ?? null }, storage);
    assert(card.profileCareHomeCostsField.hidden === false && card.profileCareHomeCostsHelp.textContent.startsWith('Leer rechnet'), 'Feld sichtbar bei Pflege zu Hause');
    card.profileCareFormToday.value = 'residential'; syncManagerCareToday({ getElementById: id => card[id] ?? null }, storage);
    assertEqual(card.profileCareHomeCostsField.hidden, true, 'Feld verborgen im Heim');
    card.profileCareFormToday.value = 'family';
    syncManagerCareToday({ getElementById: id => card[id] ?? null }, annualRecordStorage(pfa2Records({ sim: { sim_pflegeKostenStaffelPreset: 'amtlich' } }).records));
    assert(card.profileCareHomeCostsHelp.textContent.startsWith('Ohne Wirkung'), 'Bei „Amtlich“ steht der Hinweis am Feld');
}

// PFA3-B2: Haushalt & Plan projiziert den Hinweis nach jeder gespeicherten Planänderung neu (333 → 833 €/Monat), gemeinsam mit der Personenkarte.
{
    const { records } = pfa2Records({ care: [null, { grade: 3, form: 'home-support' }], sim: { sim_pflegeMaxFloor: '40000' } });
    const backend = new Map(Object.entries(records));
    P.resetPersistenceForTests({ name: 'pfa-4-plan-hint', async open() {}, async loadAll() { return Object.fromEntries(backend); },
        async saveBatch(batch) { for (const key of batch.deletes) backend.delete(key); for (const [key, value] of batch.upserts) backend.set(key, String(value)); } });
    await P.init();
    try {
        const { doc } = createDialogFixture();
        const panel = doc.createElement('div'); panel.id = 'managerPlanPanel'; doc.body.append(panel);
        const host = doc.createElement('section'); host.id = 'managerHouseholdPlan'; panel.append(host);
        for (const id of ['managerPlanScope', 'managerPlanStatus', 'managerPlanRetry', 'managerPlanResume', 'managerPlanComparison', 'managerPlanCapeOrigin', 'managerPlanInflation']) {
            const node = doc.createElement('div'); node.id = id; doc.body.append(node);
        }
        for (const id of ['managerPlanCareHint', 'profileCareHint']) { const node = doc.createElement('div'); node.id = id; node.className = 'ds-note'; node.dataset.careHint = ''; node.hidden = true; doc.body.append(node); }
        const row = doc.createElement('div'); row.className = 'pv-plan-field household-plan-field';
        const field = doc.createElement('input'); field.id = 'managerPlan_floorBedarf'; field.dataset.managerPlanField = 'floorBedarf'; field.type = 'text'; row.append(field); host.append(row);
        const guard = createNavigationGuard({ decide: async () => true }), lifecycle = createNavigationOperationLifecycle({ guard });
        const timers = new Map(); let timerId = 0;
        const controller = createManagerHouseholdPlan({ doc, storage: persistenceStorage, persistence: P, getProfileId: () => records.rs_current_profile,
            runOperation: execute => lifecycle.run({}, execute), now: () => new Date('2026-10-23T12:00:00Z'),
            schedule: fn => { const id = ++timerId; timers.set(id, () => { timers.delete(id); fn(); }); return id; }, unschedule: id => timers.delete(id) });
        const text = id => plain(doc.getElementById(id).innerHTML);
        assert(!doc.getElementById('managerPlanCareHint').hidden && text('managerPlanCareHint').includes('Pflege Werner: 333 €/Monat'), 'PFA3-B2 Hinweis zeigt 333 €/Monat (4.000 €/Jahr unter dem Deckel 40.000 €)');
        assert(text('profileCareHint').includes('333 €/Monat'), 'PFA3-B2 Personenkarte zeigt denselben Hinweis');
        field.value = '30000'; await field.fire('input');
        [...timers.values()][0]();
        for (let i = 0; i < 200 && controller.read().writing; i++) await new Promise(resolve => setTimeout(resolve, 2));
        assertEqual(doc.getElementById('managerPlanStatus').textContent, 'Gespeichert', 'PFA3-B2 Planänderung gespeichert');
        assertEqual(readBalanceHouseholdPlan({ storage: persistenceStorage }).entry.values.floorBedarf, 30000, 'PFA3-B2 Grundbedarf 30.000 € im Speicher');
        assert(text('managerPlanCareHint').includes('Pflege Werner: 833 €/Monat'), 'PFA3-B2 Hinweis nach dem Speichern: 833 €/Monat (10.000 €/Jahr) statt 333 €');
        assert(text('profileCareHint').includes('833 €/Monat'), 'PFA3-B2 Personenkarte wird gemeinsam aktualisiert');
        assertEqual(projectCareHint({ storage: persistenceStorage }).persons[0].monthly * 12, 10000, 'PFA3-B2 Projektion aus dem gespeicherten Stand');
        controller.dispose();
    } finally { await resetPersistenceForTests(); }
}
setAppTestDate(null);
