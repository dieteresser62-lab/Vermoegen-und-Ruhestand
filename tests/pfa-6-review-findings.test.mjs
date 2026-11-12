// FR-73 Paket 6: Restbefunde der Codex-Nachprüfung PFA-5 (B1, B2) und des Argon-Gutachtens FR73A (B1–B4).
// Testdatum 23.10.2026; alter Stand 642f87e4 rot.
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { fixedCareTodayForYear } from '../app/simulator/simulator-care-today.js';
import { OWN_CARE_PRICES_KEY, resolveCarePrices } from '../app/shared/care-prices.js';
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { createTranchenPageDom, createLocalStorageMock, installGlobals, waitFor, MockElement } from './tranchen-manager-page.test.mjs';
import { initTranchenManagerPage, switchManagerProfile } from '../app/tranches/tranchen-manager-page.js';
import { CARE_VALUE_KEYS, CARE_FORM_IDS } from '../app/profile/profile-care.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { annualTestMarketData, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { createAnnualCareEditor } from '../app/shared/annual-care-editor.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { syncManagerCareToday } from '../app/tranches/tranchen-manager-care.js';
import { renderCareTodaySummary } from '../app/simulator/simulator-care-today-ui.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { previewPersonExport, confirmPersonExport, previewPersonImport, importPersonFile } from '../app/profile/profile-person-file.js';
setAppTestDate('2026-10-23');

const today = (grade, form, residentialSince) => ({ grade, form, ...(residentialSince ? { residentialSince } : {}) });
const close = (a, b, label, tolerance = 1e-6) => assert(Math.abs(a - b) < tolerance, `${label}: ${a} = ${b}`);
/** Balance-Lesung ohne Writes. */
function balance(records, scope) {
    const { storage, counts } = countingStorage(records);
    const calc = buildBalanceEngineInputFromStorage({ storage, scope, referenceYear: 2026 });
    assertEqual(counts.setItem + counts.removeItem, 0, 'Lesen schreibt nie');
    return calc;
}
const listen = (node, type, fn) => node.addEventListener(type, fn);
const metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };
const ownBlock = { costs: { 1: 3600, 2: 6000, 3: 21000, 4: 32000, 5: 60000 }, maximumFloor: 120000, ownExpensesMonthly: 500, driftPercent: 3.5, origin: 'von Hand', priceYear: 2026 };
/** Abschlussfähige Records mit offener Periode 2026 (wie in PFA-4/5); optional zuletzt geöffnete Außenperson mit eigenem Preisblock. */
function closable(options, { outside = false, outsideOnly = false } = {}) {
    const { records, scope } = pfa2Records(options);
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]); state.annualPeriodMetadata = metadata;
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state); records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) if (registry.profiles[id]) { const own = JSON.parse(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]); own.annualPeriodMetadata = metadata; registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(own); }
    if (outsideOnly) {
        // Einzelprofil einer Außenperson: es gibt keinen Haushalt, Helga ist als Außenperson markiert.
        registry.profiles[IDS[0]].meta.belongsToHousehold = false;
        registry.profiles[IDS[0]].data[OWN_CARE_PRICES_KEY] = records[OWN_CARE_PRICES_KEY] = JSON.stringify(ownBlock);
    }
    if (outside) {
        const data = { ...registry.profiles[IDS[0]].data, [OWN_CARE_PRICES_KEY]: JSON.stringify(ownBlock) };
        for (const key of Object.keys(data)) if (key.startsWith('profile_care')) delete data[key];
        registry.profiles.aussen = { meta: { id: 'aussen', name: 'Außen', belongsToHousehold: false }, data };
        for (const key of Object.keys(records)) if (/^(profile_|sim_|depot_)/.test(key)) delete records[key];
        Object.assign(records, data, { rs_current_profile: 'aussen', rs_active_profile: 'aussen' });
    }
    records.rs_profiles_v1 = JSON.stringify(registry);
    return { records, scope, marketData: { ...annualTestMarketData, inflation: { ...annualTestMarketData.inflation, rate: 2 } } };
}
/** Jahresabschluss über den Pflegeeditor (Vorschlag unverändert bestätigt) oder ohne Dialogentwurf; liefert die Records danach. */
async function closeYear({ records, scope, marketData }, { dialog = true } = {}) {
    let careValues, proposal = null;
    if (dialog) {
        const { doc } = createDialogFixture();
        const editor = createAnnualCareEditor({ doc, targetYear: 2026, storage: annualRecordStorage(records), listen }); doc.body.append(editor.root);
        editor.setInflation(2); await editor.root.querySelector('[data-annual-care-confirm]').fire('click');
        careValues = editor.accept(); proposal = careValues.prices;
    }
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, scope, storage: annualRecordStorage(records), now: annualTestNow });
    const prepared = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, adoptedPlanPatch: { floorBedarf: 36720 }, careValues, now: annualTestNow });
    const after = { ...records, ...prepared.records };
    return { proposal, after, floor: buildBalanceEngineInputFromStorage({ storage: annualRecordStorage(after), referenceYear: 2027 }).inputData.floorBedarf };
}
/** Ein tatsächlich ausgeführtes Simulatorjahr 1 aus denselben Records (Profilkombination, feste heutige Pflege). */
function simulatorYearOne(records, yearData) {
    const storage = { getItem: key => records[key] ?? null };
    const registry = JSON.parse(records.rs_profiles_v1), plan = readBalanceHouseholdPlan({ storage });
    const entries = IDS.filter(id => registry.profiles[id]).map(profileId => ({ profileId, name: registry.profiles[profileId].meta.name,
        data: registry.profiles[profileId].data,
        inputs: buildSimulatorInputsFromProfileData(registry.profiles[profileId].data, { storage, referenceYear: 2026, planValues: plan.entry.values, profileId }) }));
    const inputs = combineSimulatorProfiles(entries, IDS[0], { planValues: plan.entry.values }).combined;
    const state = initMcRunState(inputs), fixed = fixedCareTodayForYear(inputs, state, 0);
    let captured;
    const engine = { simulateSingleYear(input, last) { captured = EngineAPI.simulateSingleYear(input, last); return captured; } };
    const result = simulateOneYear(state, inputs, yearData, 0, fixed.pflegeMeta, fixed.careFloorAddition, fixed.householdContext, .75, engine);
    assertEqual(result.kind, 'success', 'Simulatorjahr auswertbar');
    return { inputs, captured };
}

// PFA5-B1: Im Haushalt gilt die Rentenanpassung des Hauptprofils (Helga) – in Balance wie im Simulator.
{
    const { records, scope } = pfa2Records({ care: [null, today(4, 'residential', '2023-01')], pensions: [1000, 1000],
        sim: { profile_rentenanpassung_art: 'fix', profile_rentenanpassung_pct: '3' } });
    const registry = JSON.parse(records.rs_profiles_v1);
    Object.assign(registry.profiles[IDS[1]].data, { profile_rentenanpassung_art: 'fix', profile_rentenanpassung_pct: '1' });
    records.rs_profiles_v1 = JSON.stringify(registry);
    const calc = balance(records, scope);
    close(calc.inputData.careLiquidityProjection.floor, 60790.572, 'PFA5-B1 Folgejahresbedarf D mit 2 % Inflation');
    const sim = simulatorYearOne(records, { jahr: 2026, inflation: 2, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 });
    close(sim.captured.input.careLiquidityProjection.income, 24720, 'PFA5-B1 Simulator: beide Renten mit 3 % des Hauptprofils → 24.720 €');
    close(calc.inputData.careLiquidityProjection.income, 24720, 'PFA5-B1 Balance: 2 × 12.000 × 1,03 = 24.720 € (nicht 24.480)');
    const engine = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState);
    assertEqual(engine.ui.zielLiquiditaet, 180400, 'PFA5-B1 Balance-Zielliquidität 180.400 € (nicht 181.600)');
    assertEqual(sim.captured.ui.zielLiquiditaet, 180400, 'PFA5-B1 Simulator-Zielliquidität 180.400 €');
}

// PFA5-B2: Export und Import einer einzelnen Außenperson nehmen ihren eigenen Preisblock mit.
{
    const { records } = pfa2Records({ care: [null, today(3, 'home-support')] });
    const registry = JSON.parse(records.rs_profiles_v1);
    const own = { costs: { 1: 3600, 2: 6000, 3: 21000, 4: 32000, 5: 60000 }, maximumFloor: 130000, ownExpensesMonthly: 600, driftPercent: 3.5, origin: 'von Hand', priceYear: 2026 };
    const outside = { ...registry.profiles[IDS[0]].data, [OWN_CARE_PRICES_KEY]: JSON.stringify(own) };
    registry.profiles.aussen = { meta: { id: 'aussen', name: 'Außen', belongsToHousehold: false }, data: outside };
    // Ein liegengebliebener Block an einem Haushaltsmitglied wirkt nicht und reist nicht mit.
    registry.profiles[IDS[1]].data[OWN_CARE_PRICES_KEY] = JSON.stringify(own);
    records.rs_profiles_v1 = JSON.stringify(registry);
    const store = { ...records };
    P.resetPersistenceForTests({ name: 'PFA-6 PFA5-B2', async loadAll() { return { ...store }; },
        async saveBatch({ upserts, deletes }) { for (const key of deletes) delete store[key]; Object.assign(store, Object.fromEntries(upserts)); } });
    try {
        await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const file = await confirmPersonExport(await previewPersonExport('aussen'));
        assertEqual(file.registry.profiles.aussen.data[OWN_CARE_PRICES_KEY], JSON.stringify(own), 'PFA5-B2 die Exportdatei enthält den Preisblock der Außenperson');
        const member = await confirmPersonExport(await previewPersonExport(IDS[1]));
        assertEqual(member.registry.profiles[IDS[1]].data[OWN_CARE_PRICES_KEY], undefined, 'PFA5-B2 Haushaltsmitglied: Export unverändert ohne Preisblock');
        const before = JSON.parse(store.rs_profiles_v1).profiles;
        const preview = await previewPersonImport(file);
        assertEqual((await importPersonFile(preview)).status, 'imported', 'PFA5-B2 Import bestätigt');
        const after = JSON.parse(store.rs_profiles_v1).profiles, imported = after[preview.id].data;
        const prices = resolveCarePrices(null, imported, { shared: false });
        assertEqual(`${prices.driftPercent / 100} ${prices.costs[3]}`, '0.035 21000', 'PFA5-B2 nach dem Import 3,5 % und Grad 3 21.000 € (nicht 5 % / 18.000 €)');
        assertEqual(`${prices.driftMarked} ${prices.maximumFloor} ${prices.ownExpensesMonthly} ${prices.origin}`, 'true 130000 600 von Hand', 'PFA5-B2 Markierung, Deckel, eigene Heimausgaben und Herkunft erhalten');
        assertEqual(JSON.stringify(JSON.parse(imported[OWN_CARE_PRICES_KEY]).costs), JSON.stringify(own.costs), 'PFA5-B2 Staffel erhalten');
        const inputs = buildSimulatorInputsFromProfileData(imported, { storage: { getItem: key => store[key] ?? null }, referenceYear: 2026, planValues: null, profileId: preview.id });
        assertEqual(`${inputs.pflegeKostenDrift} ${inputs.pflegeGradeConfigs[3].zusatz}`, '0.035 21000', 'PFA5-B2 der Simulator rechnet die importierte Außenperson mit ihren Preisen');
        for (const id of IDS) assertEqual(JSON.stringify(after[id]), JSON.stringify(before[id]), `PFA5-B2 Haushaltsmitglied ${id} bleibt unverändert`);
        let error = '';
        const broken = structuredClone(file); broken.registry.profiles.aussen.data[OWN_CARE_PRICES_KEY] = '{"costs":{}}';
        try { await previewPersonImport(broken); } catch (e) { error = e.message; }
        assert(error.includes('ungültige Pflegepreise'), 'PFA5-B2 ein unlesbarer Preisblock in der Datei wird abgewiesen');
    } finally { await resetPersistenceForTests(); }
}

// Argon-B1: „Im Heim seit“ übersteht Laden → anderes Feld ändern → Speichern und wird beim Personenwechsel nicht verschleppt.
{
    const globals = Object.fromEntries(['document', 'window', 'localStorage', 'confirm', 'alert', 'URL', 'Blob'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const { records, scope } = pfa2Records({ care: [null, today(4, 'residential', '2023-01')] });
    const registry = JSON.parse(records.rs_profiles_v1), werner = IDS[1], helga = IDS[0];
    for (const key of Object.keys(records)) if (/^(profile_|sim_|depot_)/.test(key)) delete records[key];
    Object.assign(records, registry.profiles[werner].data, { rs_current_profile: werner, rs_active_profile: werner });
    const backend = new Map(Object.entries(records));
    const doc = createTranchenPageDom();
    for (const [field, id] of Object.entries(CARE_FORM_IDS)) doc.register(new MockElement(id, ['grade', 'form', 'progression'].includes(field) ? 'select' : 'input'));
    installGlobals(doc, createLocalStorageMock());
    P.resetPersistenceForTests({ name: 'PFA-6 Argon-B1', async open() {}, async loadAll() { return Object.fromEntries(backend); },
        async saveBatch({ deletes, upserts }) { deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, raw]) => backend.set(key, raw)); } });
    const since = () => doc.getElementById(CARE_FORM_IDS.residentialSince);
    const stored = id => backend.get('rs_current_profile') === id ? backend.get(CARE_VALUE_KEYS.residentialSince)
        : JSON.parse(backend.get('rs_profiles_v1')).profiles[id].data[CARE_VALUE_KEYS.residentialSince];
    const changeRent = async value => {
        const rent = doc.getElementById('profileRenteMonatlich');
        rent.value = value; rent.dispatchEvent({ type: 'change', target: rent });
        await waitFor(() => backend.get('profile_rente_monatlich') === value && !rent.disabled, 'Rente wird automatisch gespeichert');
    };
    try {
        await P.init({ doc, window, installLifecycleHooks: false, installTauriCloseHook: false });
        await initTranchenManagerPage({ profileId: werner });
        assertEqual(since().value, '2023-01', 'Argon-B1 Laden zeigt das gespeicherte „Im Heim seit“ (nicht leer)');
        await changeRent('900');
        assertEqual(stored(werner), '2023-01', 'Argon-B1 Speichern eines anderen Felds erhält 2023-01 (nicht „“)');
        const calc = buildBalanceEngineInputFromStorage({ storage: { getItem: key => backend.get(key) ?? null }, scope, referenceYear: 2026 });
        assertEqual(calc.inputData.floorBedarf, 58332, 'Argon-B1 Fall D bleibt bei Heimjahr 4: 58.332 € (nicht 73.368)');
        since().value = '2024-03'; since().dispatchEvent({ type: 'change', target: since() });
        assertEqual(await switchManagerProfile(helga), true, 'Argon-B1 Personenwechsel zu Helga');
        assertEqual(since().value, '', 'Argon-B1 nach dem Wechsel steht Helgas leeres Feld (kein verschlepptes Datum)');
        await changeRent('800');
        assertEqual(stored(helga) ?? '', '', 'Argon-B1 Helga bekommt kein Heimdatum');
        assertEqual(stored(werner), '2024-03', 'Argon-B1 das neue Datum gehört Werner');
    } finally {
        await resetPersistenceForTests();
        for (const [key, descriptor] of Object.entries(globals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    }
}

// Argon-B2: Jahresabschluss mit zuletzt geöffneter Außenperson schreibt die Haushaltspreise aus dem Haushalt fort.
{
    const household = () => closable({ care: [null, today(3, 'home-support')] }, { outside: true });
    const viaDialog = await closeYear(household());
    assertEqual(viaDialog.proposal.costs[3], 19278, 'Argon-B2 Dialogvorschlag Grad 3 = 18.000 × 1,02 × 1,05 = 19.278 € (nicht 22.170 aus der Außenperson)');
    const stored = JSON.parse(viaDialog.after.household_care_values_v1).prices;
    assertEqual(`${stored.costs[3]} ${stored.driftPercent}`, '19278 undefined', 'Argon-B2 Haushaltsrecord: 19.278 € ohne den Kostenanstieg der Außenperson');
    assertEqual(viaDialog.floor, 55998, 'Argon-B2 Haushalts-Floor 36.720 + 19.278 = 55.998 € (nicht 58.890)');
    assertEqual(JSON.parse(viaDialog.after.rs_profiles_v1).profiles.aussen.data[OWN_CARE_PRICES_KEY], JSON.stringify(ownBlock), 'Argon-B2 Außenpreise im Registry unverändert');
    assertEqual(viaDialog.after[OWN_CARE_PRICES_KEY], JSON.stringify(ownBlock), 'Argon-B2 Außenpreise in der Livequelle unverändert');
    const direct = await closeYear(household(), { dialog: false });
    assertEqual(`${JSON.parse(direct.after.household_care_values_v1).prices.costs[3]} ${direct.floor}`, '19278 55998', 'Argon-B2 auch ohne Dialogentwurf 19.278 € / 55.998 €');
    // Zweite Hälfte: Einzelprofil einer Außenperson – der Abschluss schreibt ihren eigenen Preisblock fort.
    const single = await closeYear(closable({ single: true, care: [today(3, 'home-support'), null] }, { outsideOnly: true }));
    assertEqual(single.proposal.costs[3], 22170, 'Argon-B2 Einzelprofil: Vorschlag aus dem eigenen Block 21.000 × 1,02 × 1,035 = 22.170 €');
    const block = JSON.parse(JSON.parse(single.after.rs_profiles_v1).profiles[IDS[0]].data[OWN_CARE_PRICES_KEY]);
    assertEqual(`${block.costs[3]} ${block.driftPercent} ${block.priceYear}`, '22170 3.5 2027', 'Argon-B2 Einzelprofil: eigener Preisblock fortgeschrieben, Markierung bleibt');
    assertEqual(single.after[OWN_CARE_PRICES_KEY], JSON.stringify(block), 'Argon-B2 Einzelprofil: Livequelle trägt denselben Block');
    assertEqual(single.floor, 58890, 'Argon-B2 Einzelprofil: Folgejahr 36.720 + 22.170 = 58.890 € (nicht 57.720 mit verpuffter Fortschreibung)');
    assertEqual(JSON.parse(single.after.household_care_values_v1).prices, undefined, 'Argon-B2 Einzelprofil: der Haushaltsrecord bekommt keine Außenpreise');
}

// Argon-B3: Personenkarte nennt das Pflegegeld der wirksamen Form (Sollfall R: Helga Grad 3, Werner Grad 2 durch Angehörige).
{
    const card = (care, { asWerner = true } = {}) => {
        const { records } = pfa2Records({ care });
        if (asWerner) {
            const registry = JSON.parse(records.rs_profiles_v1);
            for (const key of Object.keys(records)) if (/^(profile_|sim_|depot_)/.test(key)) delete records[key];
            Object.assign(records, registry.profiles[IDS[1]].data, { rs_current_profile: IDS[1], rs_active_profile: IDS[1] });
        }
        const { storage, counts } = countingStorage(records);
        const nodes = { profileCareGradeToday: { value: '2' }, profileCareFormToday: { value: 'family' }, profileCareAllowanceSummary: {} };
        syncManagerCareToday({ getElementById: id => nodes[id] || null }, storage);
        assertEqual(counts.setItem + counts.removeItem, 0, 'Argon-B3 die Personenkarte liest ohne Writes');
        return nodes.profileCareAllowanceSummary.textContent.replace(/[\u00a0\u202f]/g, ' ');
    };
    const r = card([today(3, 'home-support'), today(2, 'family')]);
    assert(!r.includes('347') && r.startsWith('Angesetzt:') && r.includes(' · kein Pflegegeld'), `Argon-B3 Sollfall R: Werner ohne Pflegegeld (nicht 347 €/Monat): ${r}`);
    assert(r.includes('Pflegegrad 3') && r.includes('externer Unterstützung'), `Argon-B3 der Grund nennt den Angehörigenausfall: ${r}`);
    const partnerGrade2 = card([today(2, 'family'), today(2, 'family')]);
    assert(partnerGrade2.includes('Pflegegeld 347 €/Monat kommt als Einkunft dazu'), `Argon-B3 Partnerin mit Grad 2 pflegt weiter: 347 €/Monat (${partnerGrade2})`);
    const { records } = pfa2Records({ single: true, care: [today(2, 'family'), null] });
    const nodes = { profileCareGradeToday: { value: '2' }, profileCareFormToday: { value: 'family' }, profileCareAllowanceSummary: {} };
    syncManagerCareToday({ getElementById: id => nodes[id] || null }, countingStorage(records).storage);
    assert(nodes.profileCareAllowanceSummary.textContent.replace(/[\u00a0\u202f]/g, ' ').includes('Pflegegeld 347 €/Monat kommt als Einkunft dazu'), 'Argon-B3 alleinstehend bleibt das Pflegegeld 347 €/Monat (4.164 €/Jahr)');
}

// Argon-B4: Der eigene Wert erscheint und wirkt nur bei Pflege zu Hause und nicht bei „Amtlich“.
{
    // Simulator-Kopftext.
    const header = preset => {
        const host = {};
        renderCareTodaySummary({ getElementById: id => id === 'simCareTodaySummary' ? host : null },
            { careToday: { grade: 3, form: 'home-support', homeCostsMonthly: 200 }, partner: { aktiv: false }, pflegeKostenStaffelPreset: preset, simulationPeople: [{ name: 'Werner' }] });
        return host.textContent.replace(/[\u00a0\u202f]/g, ' ');
    };
    assert(!header('amtlich').includes('eigener Wert'), `Argon-B4 Simulator-Kopftext bei „Amtlich“ ohne „eigener Wert“ (gerechnet 0 €): ${header('amtlich')}`);
    assert(header('individuell').includes('(eigener Wert 200 €/Monat)'), 'Argon-B4 Simulator-Kopftext mit eigener Staffel nennt den eigenen Wert');
    // Jahresabschluss: kein Feld, keine Fortschreibung im Heim oder bei „Amtlich“; der Wert bleibt gespeichert.
    const KEY = CARE_VALUE_KEYS.homeCostsMonthly, werner = IDS[1];
    for (const [label, care, sim] of [['im Heim', { grade: 4, form: 'residential', residentialSince: '2023-01', homeCostsMonthly: 200 }, {}],
        ['Amtlich', { grade: 3, form: 'home-support', homeCostsMonthly: 200 }, { sim_pflegeKostenStaffelPreset: 'amtlich' }]]) {
        const source = closable({ care: [null, care], sim });
        const { doc } = createDialogFixture();
        const editor = createAnnualCareEditor({ doc, targetYear: 2026, storage: annualRecordStorage(source.records), listen }); doc.body.append(editor.root);
        editor.setInflation(2);
        assert(!doc.getElementById(`annualCare_own:${werner}`), `Argon-B4 Jahresabschluss ${label}: kein Feld „eigener Wert“ für Werner`);
        const { after } = await closeYear(source);
        assertEqual(JSON.parse(after.rs_profiles_v1).profiles[werner].data[KEY], '200', `Argon-B4 Jahresabschluss ${label}: Wert bleibt 200 € gespeichert, nicht fortgeschrieben (nicht 214)`);
    }
    const home = await closeYear(closable({ care: [null, { grade: 3, form: 'home-support', homeCostsMonthly: 200 }] }));
    assertEqual(JSON.parse(home.after.rs_profiles_v1).profiles[werner].data[KEY], '214', 'Argon-B4 Kontrolle: zu Hause mit Staffel schreibt der Abschluss 214 € fort');
    // Balance-ⓘ der Pflegezeile nennt, womit gerechnet wird.
    const previous = globalThis.document, doc = createPresentationTestDocument();
    globalThis.document = doc;
    try {
        const info = (care, sim = {}) => {
            const { records, scope } = pfa2Records({ care: [null, care], sim });
            const calc = balance(records, scope), engine = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState);
            const outputs = Object.fromEntries(['balanceMonthlyBudget', 'balanceNeedRows', 'balanceNeedTotal', 'balanceFloorCoverage'].map(key => [key, doc.createElement('div')]));
            new SummaryRenderer({ outputs }, { loadState: () => ({}) }).renderPlanCards({ ...engine.ui, input: calc.inputData, careNeeds: calc.careNeeds });
            const rows = outputs.balanceNeedRows.children.flatMap(group => group.className === 'household-plan-group' ? group.children.slice(1) : [group]);
            return rows.find(line => line.children[0].textContent.startsWith('Pflege Werner')).children[0].children[0].children[1].textContent;
        };
        assert(info({ grade: 3, form: 'home-support' }).includes('Staffelbetrag des Grads'), 'Argon-B4 Balance-ⓘ: leeres Feld → Staffel');
        const own = info({ grade: 3, form: 'home-support', homeCostsMonthly: 200 });
        assert(own.includes('eigener Wert') && !own.includes('Staffelbetrag'), `Argon-B4 Balance-ⓘ: eigener Wert statt Staffel: ${own}`);
        const official = info({ grade: 3, form: 'home-support', homeCostsMonthly: 200 }, { sim_pflegeKostenStaffelPreset: 'amtlich' });
        assert(official.includes('amtlichen Durchschnitt') && !official.includes('eigener Wert') && !official.includes('Staffelbetrag'), `Argon-B4 Balance-ⓘ: „Amtlich“ mit 0 € Zusatz: ${official}`);
    } finally { globalThis.document = previous; }
}
setAppTestDate(null);
