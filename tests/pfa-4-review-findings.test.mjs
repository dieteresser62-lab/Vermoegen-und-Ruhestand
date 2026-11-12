// FR-73 Paket 4: Gegenproben der Codex-Gutachten zu PFA-2 (Befunde 1–7) und PFA-3 (Befunde 1, 3) sowie die
// Rundung der Fortschreibung (Bildabnahme 08.11.). Testdatum 23.10.2026; alter Stand 36067b92 rot.
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { annualTestMarketData, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { HOUSEHOLD_PLAN_KEY, readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { calculateHouseholdWithdrawalNeed, calculateWithdrawalDistribution } from '../app/profile/profilverbund-balance.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState } from '../app/simulator/simulator-engine-wrapper.js';
import { fixedCareTodayForYear } from '../app/simulator/simulator-care-today.js';
import { readCareInputs } from '../app/simulator/simulator-input-care.js';
import { initInputPersistence, writeCarePriceField } from '../app/simulator/simulator-main-input-persist.js';
import { initializePflegeUIControls, PFLEGE_CUSTOM_COSTS_KEY } from '../app/simulator/simulator-ui-pflege.js';
import { createAnnualCareEditor } from '../app/shared/annual-care-editor.js';
import { projectCareValuesForYear, projectCarePrices, resolveCarePrices, careValuesWithPrices, CARE_PRICE_DEFAULTS } from '../app/shared/care-prices.js';
import { parseRememberedCareCosts, rememberedCareCostsRecord } from '../app/shared/care-cost-resolver.js';
import { HOUSEHOLD_CARE_VALUES_KEY as KEY, parseCareValues, readCareValues } from '../app/shared/household-care-values.js';
import { CARE_VALUE_KEYS } from '../app/profile/profile-care.js';
import { protocolCashflowBreakdown, protocolMoneyDivisor } from '../app/simulator/protocol-cashflows.js';
import { formatProtocolValue, PROTOCOL_COLUMNS } from '../app/simulator/protocol-columns.js';
import { PersistenceFacade as P, persistenceStorage, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { simulatorDocument } from './simulator-page-fixture.mjs';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
setAppTestDate('2026-10-23');

const today = (grade, form, residentialSince) => ({ grade, form, ...(residentialSince ? { residentialSince } : {}) });
const close = (a, b, label, tolerance = 1e-6) => assert(Math.abs(a - b) < tolerance, `${label}: ${a} = ${b}`);
const listen = (node, type, fn) => node.addEventListener(type, fn);
const metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };
/** Abschlussfähige Records mit offener Periode 2026. */
function closable(options) {
    const { records, scope } = pfa2Records(options);
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]); state.annualPeriodMetadata = metadata;
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state); records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) if (registry.profiles[id]) { const own = JSON.parse(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]); own.annualPeriodMetadata = metadata; registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(own); }
    records.rs_profiles_v1 = JSON.stringify(registry);
    return { records, scope, marketData: { ...annualTestMarketData, inflation: { ...annualTestMarketData.inflation, rate: 2 } } };
}
/** Simulator Jahr 1 aus denselben Records (Profilkombination, feste heutige Pflege). */
function simulatorYearOne(records, referenceYear = 2026) {
    const storage = { getItem: key => records[key] ?? null };
    const registry = JSON.parse(records.rs_profiles_v1), plan = readBalanceHouseholdPlan({ storage });
    const entries = IDS.filter(id => registry.profiles[id]).map(profileId => ({ profileId, name: registry.profiles[profileId].meta.name,
        inputs: buildSimulatorInputsFromProfileData(registry.profiles[profileId].data, { storage, referenceYear, planValues: plan.entry.values, profileId }) }));
    const inputs = combineSimulatorProfiles(entries, IDS[0], { planValues: plan.entry.values }).combined;
    return fixedCareTodayForYear(inputs, initMcRunState(inputs), 0);
}

// PFA2-B1: Heimjahr ohne „seit“ zählt in Vorschau, vorbereitetem Abschluss und nach dem echten Jahreswechsel weiter.
{
    const { records, scope, marketData } = closable({ care: [null, today(4, 'residential')] });
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, scope, storage: annualRecordStorage(records), now: annualTestNow });
    const prepared = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, adoptedPlanPatch: { floorBedarf: 36720 }, now: annualTestNow });
    const after = buildBalanceEngineInputFromStorage({ storage: annualRecordStorage(prepared.records), scope, referenceYear: 2027 });
    assertEqual(after.inputData.floorBedarf, 72864, 'B1 vorbereiteter Abschluss: Heimjahr 2 → 27.540 + 39.204 + 6.120 = 72.864 € (nicht 76.896)');
    assertEqual(after.careNeeds.persons[1].heimJahr, 2, 'B1 Folgejahr zählt Heimjahr 1 → 2 ohne „seit“');
    const anchor = JSON.parse(prepared.records.rs_profiles_v1).profiles[IDS[1]].data[CARE_VALUE_KEYS.residentialFirstYear];
    assertEqual(anchor, '2026', 'B1 der Abschluss verankert das Planjahr des ersten Heimjahrs an der Person (P8)');
    assertEqual(JSON.parse(records.rs_profiles_v1).profiles[IDS[1]].data[CARE_VALUE_KEYS.residentialFirstYear], undefined, 'B1 die Basis-Records bleiben beim Lesen ohne Anker');
    setAppTestDate('2027-01-02');
    const reread = buildBalanceEngineInputFromStorage({ storage: annualRecordStorage(prepared.records), scope });
    assertEqual(reread.inputData.floorBedarf, 72864, 'B1 erneutes Lesen am 02.01.2027 bleibt bei Heimjahr 2');
    assertEqual(simulatorYearOne(prepared.records, 2027).householdContext.care.p2.heimJahr, 2, 'B1 Simulator Jahr 1 im Jahr 2027 startet mit Heimjahr 2 (Parität)');
    setAppTestDate('2026-10-23');
    const since = closable({ care: [null, today(4, 'residential', '2023-01')] });
    const sinceDraft = computeAnnualPlanUpdate({ targetYear: 2026, marketData: since.marketData, scope: since.scope, storage: annualRecordStorage(since.records), now: annualTestNow });
    const sincePrepared = prepareAnnualCommitRecords(sinceDraft, { engineApi: EngineAPI, adoptedPlanPatch: { floorBedarf: 36720 }, now: annualTestNow });
    assertEqual(JSON.parse(sincePrepared.records.rs_profiles_v1).profiles[IDS[1]].data[CARE_VALUE_KEYS.residentialFirstYear], undefined, 'B1 mit „seit“ braucht es keinen Anker');
    const { storage, counts } = countingStorage(prepared.records);
    buildBalanceEngineInputFromStorage({ storage, scope, referenceYear: 2027 });
    assertEqual(counts.setItem + counts.removeItem, 0, 'B1 Lesen mit Anker schreibt nie');
}

// PFA2-B2: Liquiditätsziel mit Folgejahreseinkünften (Rentenbeginn 01/2027, befristete Einkunft bis 12/2026).
// Seit PFA-5 wachsen Folgejahreseinkünfte mit der Rentenanpassung; feste 0 % halten diese Kalenderprobe bei 36.000 € (Lohnannahme sonst 2,5 %).
{
    const { records, scope } = pfa2Records({ care: [null, today(4, 'residential', '2023-01')], pensions: [3000, 0],
        sim: { profile_rentenbeginn: '2027-01-01', profile_rentenanpassung_art: 'fix', profile_rentenanpassung_pct: '0' } });
    const calc = buildBalanceEngineInputFromStorage({ storage: countingStorage(records).storage, scope, referenceYear: 2026 });
    assertEqual(calc.inputData.renteMonatlich, 0, 'B2 laufendes Jahr 2026 noch ohne Rente');
    close(calc.inputData.careLiquidityProjection.floor, 60790.572, 'B2 Folgejahresbedarf D mit 2 % Inflation');
    assertEqual(calc.inputData.careLiquidityProjection.income, 36000, 'B2 Folgejahreseinkünfte 36.000 € aus dem Rentenbeginn 01/2027');
    const engine = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState);
    assertEqual(engine.ui.zielLiquiditaet, 124000, 'B2 Zielliquidität 5 × (60.790,57 − 36.000) ≈ 124.000 € (nicht 304.000)');
    const income = JSON.stringify({ schemaVersion: 1, entries: [{ id: 'job', art: 'sonstige', bezeichnung: 'Nebenjob', betragMonat: 1000, ab: null, bis: '2026-12', anpassung: 'keine' }] });
    const limited = pfa2Records({ care: [null, today(4, 'residential', '2023-01')], sim: { profile_einkuenfte_v1: income, profile_einkuenfte_migration_v1: '1' } });
    const limitedCalc = buildBalanceEngineInputFromStorage({ storage: countingStorage(limited.records).storage, scope: limited.scope, referenceYear: 2026 });
    assertEqual(limitedCalc.inputData.renteMonatlich, 1000, 'B2 befristete Einkunft zählt 2026');
    assertEqual(limitedCalc.inputData.careLiquidityProjection.income, 0, 'B2 befristete Einkunft endet vor dem Folgejahr');
}

// PFA2-B3: Unverheiratet mit eigener Rente des Heimbewohners (60/40): 16.200 € / 21.168 € statt 0 / 37.368 €.
{
    const { records, scope } = pfa2Records({ care: [null, today(4, 'residential')], unmarried: true, cash: [600000, 400000], clearTranches: true, pensions: [0, 3000] });
    const calc = buildBalanceEngineInputFromStorage({ storage: countingStorage(records).storage, scope, referenceYear: 2026 });
    const need = calculateHouseholdWithdrawalNeed(calc.profiles, { floorBedarf: calc.inputData.floorBedarf, flexBedarf: calc.inputData.flexBedarf });
    assertEqual(`${need.grossNeed} ${need.incomeAnnual} ${need.netWithdrawal}`, '73368 36000 37368', 'B3 Bruttobedarf, Einkünfte und Nettoentnahme des Haushalts');
    const split = calculateWithdrawalDistribution(calc.profiles, need, 'proportional');
    close(split.items.find(item => item.profileId === IDS[0]).withdrawalAmount, 16200, 'B3 Helga trägt 60 % des gemeinsamen Bedarfs', .01);
    close(split.items.find(item => item.profileId === IDS[1]).withdrawalAmount, 21168, 'B3 Werner: 10.800 + 46.368 − 36.000 eigene Rente', .01);
    close(split.items.reduce((sum, item) => sum + item.withdrawalAmount, 0), 37368, 'B3 Summe bleibt die Nettoentnahme', .01);
    const surplus = calculateWithdrawalDistribution(calc.profiles, { ...need, netWithdrawal: 73368 - 36000 - 20000 }, 'proportional');
    close(surplus.items.reduce((sum, item) => sum + item.withdrawalAmount, 0), 17368, 'B3 Überschüssige Einkünfte helfen dem Haushalt; Summe bleibt die Nettoentnahme', .01);
    const noIncome = calculateWithdrawalDistribution(calc.profiles.map(entry => ({ ...entry, inputs: { ...entry.inputs, renteAktiv: false } })), { ...need, netWithdrawal: 73368 }, 'proportional');
    close(noIncome.items.find(item => item.profileId === IDS[1]).withdrawalAmount, 57168, 'B3 ohne Einkünfte unverändert 57.168 € (Sollfall U)', .01);
}

// PFA2-B4 / PFA3-B1: Ohne bestätigten Plan rechnet Balance Pflege und Flex-Faktor mit der gespeicherten Bedarfsbasis; der Hinweis nennt den Betrag.
{
    const { records } = pfa2Records({ care: [null, today(3, 'home-support')], plan: { flexBedarf: 12000, minimumFlexAnnual: 6000 } });
    delete records[HOUSEHOLD_PLAN_KEY];
    const patch = raw => { const state = JSON.parse(raw); state.inputs.flexBedarf = 12000; state.inputs.minimumFlexAnnual = 6000; return JSON.stringify(state); };
    records[CONFIG.STORAGE.LS_KEY] = patch(records[CONFIG.STORAGE.LS_KEY]);
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = patch(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]);
    records.rs_profiles_v1 = JSON.stringify(registry);
    const { storage, counts } = countingStorage(records);
    const calc = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
    assertEqual(calc.householdPlan.status, 'missing', 'B4 Vorbedingung: kein Planrecord');
    assertEqual(calc.inputData.floorBedarf, 54000, 'B4 Pflege 18.000 € auch ohne Plan: 54.000 € statt 36.000 €');
    close(calc.inputData.flexBedarf, 10500, 'B4 Flex-Faktor 0,875 (gesund + Grad 3) auch ohne Plan');
    assertEqual(JSON.stringify(calc.careHint.persons), JSON.stringify([{ profileId: 'muster_werner', name: 'Werner', grade: 3, residential: false, own: false, monthly: 1500 }]), 'PFA3-B1 Balance-Hinweis nennt Werner mit 1.500 €/Monat ohne Plan');
    assertEqual(counts.setItem + counts.removeItem, 0, 'B4 Lesen schreibt nie');
}

// PFA2-B5: Außenperson behält ihre eigene Staffel im Simulator-Profilreader, trotz Preisblock des Haushalts.
{
    const prices = JSON.stringify(careValuesWithPrices(null, { costs: { 3: 18000 } }, { priceYear: 2026 }));
    const { records } = pfa2Records({ care: [today(3, 'home-support'), null], careValuesRaw: prices });
    const registry = JSON.parse(records.rs_profiles_v1);
    registry.profiles.aussen = { meta: { name: 'Außen', belongsToHousehold: false }, data: { ...registry.profiles[IDS[0]].data, sim_pflegeStufe3Zusatz: '21000' } };
    records.rs_profiles_v1 = JSON.stringify(registry);
    const storage = { getItem: key => records[key] ?? null };
    const outside = buildSimulatorInputsFromProfileData(registry.profiles.aussen.data, { storage, referenceYear: 2026, planValues: null, profileId: 'aussen' });
    assertEqual(outside.pflegeGradeConfigs[3].zusatz, 21000, 'B5 Außenperson: eigene Staffel 21.000 € (nicht 18.000 aus dem Preisblock)');
    const member = buildSimulatorInputsFromProfileData(registry.profiles.aussen.data, { storage, referenceYear: 2026, planValues: null, profileId: IDS[0] });
    assertEqual(member.pflegeGradeConfigs[3].zusatz, 18000, 'B5 Haushaltsmitglied liest den gemeinsamen Preisblock');
    assertEqual(buildSimulatorInputsFromProfileData(registry.profiles.aussen.data, { storage, referenceYear: 2026, planValues: null }).pflegeGradeConfigs[3].zusatz, 18000,
        'B5 ohne Profilangabe gilt das geöffnete Profil (hier das Haushaltsmitglied Helga)');
    records.rs_current_profile = 'aussen'; records.rs_active_profile = 'aussen';
    assertEqual(buildSimulatorInputsFromProfileData(registry.profiles.aussen.data, { storage, referenceYear: 2026, planValues: null }).pflegeGradeConfigs[3].zusatz, 21000,
        'B5 geöffnete Außenperson ohne Profilangabe: eigene Staffel wie in Balance (57.000 € Bedarf)');
    const simulator = buildSimulatorInputsFromProfileData({ ...registry.profiles.aussen.data, sim_startFloorBedarf: '36000' }, { storage, referenceYear: 2026, planValues: null, profileId: 'aussen' });
    assertEqual(simulator.startFloorBedarf + simulator.pflegeGradeConfigs[3].zusatz, 57000, 'B5 Simulator-Eingangsweg ergibt 36.000 + 21.000 = 57.000 € wie Balance');
}

// PFA2-B6: Bewusst eingegebene 3,5 % bleiben 3,5 %; unmarkierter Altbestand 3,5 gilt weiter als 5 (Sollfall K).
{
    const { records } = pfa2Records({ care: [null, today(3, 'home-support')], sim: { sim_pflegeKostenDrift: '3.5' } });
    const store = annualRecordStorage(records);
    const doc = { getElementById: id => id === 'pflegeKostenDrift' ? { value: '3.5', dataset: {} } : id === 'pflegeKostenStaffelPreset' ? { value: 'custom' } : null };
    assertEqual(readCareInputs({ doc, storage: store }).pflegeKostenDrift, .05, 'K Altbestand 3,5 ohne Markierung gilt als 5 % (DOM)');
    const registry = JSON.parse(store.getItem('rs_profiles_v1'));
    assertEqual(buildSimulatorInputsFromProfileData({ ...registry.profiles[IDS[0]].data, sim_pflegeKostenDrift: '3.5' }, { storage: store, referenceYear: 2026, planValues: null }).pflegeKostenDrift, .05, 'K Altbestand 3,5 gilt als 5 % (Profilreader)');
    store.setItem(KEY, JSON.stringify(careValuesWithPrices(store.getItem(KEY), { driftPercent: 3.5 }, { priceYear: 2026, legacySource: store })));
    assertEqual(readCareInputs({ doc, storage: store }).pflegeKostenDrift, .035, 'B6 markierte 3,5 % bleiben 3,5 % (DOM)');
    assertEqual(buildSimulatorInputsFromProfileData({ ...registry.profiles[IDS[0]].data, sim_pflegeKostenDrift: '3.5' }, { storage: store, referenceYear: 2026, planValues: null }).pflegeKostenDrift, .035, 'B6 markierte 3,5 % bleiben 3,5 % (Profilreader)');
    const prices = resolveCarePrices(readCareValues(store), store);
    assertEqual(`${prices.driftPercent} ${prices.driftMarked}`, '3.5 true', 'B6 Resolver liefert den markierten Kostenanstieg');
    const projected = projectCareValuesForYear(store.getItem(KEY), { inflationRate: 2, driftPercent: prices.driftPercent, priceYear: 2027, legacySource: store });
    assertEqual(`${projected.prices.costs[3]} ${projected.prices.driftPercent}`, '19003 3.5', 'B6 Fortschreibung 18.000 × 1,02 × 1,035 = 19.002,60 → 19.003 €, Markierung bleibt');
    const { doc: dialog } = createDialogFixture();
    const editor = createAnnualCareEditor({ doc: dialog, targetYear: 2026, storage: store, listen }); dialog.body.append(editor.root);
    editor.setInflation(2);
    assert(dialog.querySelector('[data-annual-care-explanation]').textContent.includes('Kostenanstieg über der Inflation 3,5 %'), 'B6 Jahresabschluss rechnet mit den markierten 3,5 % (GU-1: Wortlaut nach FR-38)');
    const calc = buildBalanceEngineInputFromStorage({ storage: countingStorage(store.records).storage, scope: pfa2Records({}).scope, referenceYear: 2026 });
    close(calc.inputData.careLiquidityProjection.floor, 36720 + 18000 * 1.02 * 1.035, 'B6 Balance-Folgejahr nutzt die markierten 3,5 %');
    await P.init({ installLifecycleHooks: false });
    try {
        for (const [key, value] of Object.entries(pfa2Records({ sim: { sim_pflegeKostenDrift: '3.5' } }).records)) P.setItemSync(key, value);
        writeCarePriceField('pflegeKostenDrift', '3,5');
        assertEqual(parseCareValues(P.getItemSync(KEY)).prices.driftPercent, 3.5, 'B6 Eingabe im Simulator markiert den Kostenanstieg im Preisblock');
        writeCarePriceField('pflegeStufe3Zusatz', '21000');
        assertEqual(parseCareValues(P.getItemSync(KEY)).prices.driftPercent, 3.5, 'B6 eine spätere Staffeleingabe behält die Markierung');
    } finally { await resetPersistenceForTests(); }
}

// PFA2-B7: Gemerkte Staffel kennzeichnet sich selbst; der flache Altbestand meint bei Vorgabewerten „Vorgabe“ (nach Fortschreibung 3.856/6.426 €).
{
    const legacy = JSON.stringify({ 1: '6000', 2: '12000', 3: '7000', 4: '32000', 5: '60000' });
    const parsed = parseRememberedCareCosts(legacy);
    assertEqual(`${parsed.marked} ${parsed.defaultGrades.join(',')} ${parsed.values[1]} ${parsed.values[3]}`, 'false 1,2,4,5 3600 7000', 'B7 flacher Altbestand: unmarkiert, Vorgabegrade erkannt, eigene 7.000 bleiben');
    const marked = parseRememberedCareCosts(rememberedCareCostsRecord({ 1: '6000', 2: '12000', 3: '7000', 4: '32000', 5: '60000' }));
    assertEqual(`${marked.marked} ${marked.defaultGrades.length} ${marked.values[1]}`, 'true 0 6000', 'B7 markierter Datensatz wird nicht umgedeutet');
    assertEqual(parseRememberedCareCosts('{"version":1,"origin":"von Hand","values":{"1":"x"}}'), null, 'B7 unlesbarer markierter Datensatz zählt nicht');
    const projected = JSON.stringify(projectCareValuesForYear(null, { inflationRate: 2, driftPercent: 5, priceYear: 2027 }));
    const prior = { document: globalThis.document, window: globalThis.window };
    const store = new Map(Object.entries({ sim_pflegeKostenStaffelPreset: 'amtlich', [PFLEGE_CUSTOM_COSTS_KEY]: JSON.stringify({ 1: '6000', 2: '12000', 3: '18000', 4: '32000', 5: '60000' }), [KEY]: projected }));
    P.resetPersistenceForTests({ name: 'PFA-4 B7', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    try {
        globalThis.document = simulatorDocument(); globalThis.window = { addEventListener() {}, removeEventListener() {} };
        initInputPersistence(); initializePflegeUIControls();
        const field = id => document.getElementById(id), select = field('pflegeKostenStaffelPreset');
        select.value = 'custom'; select.dispatchEvent(new Event('change'));
        assertEqual([1, 2, 3, 4, 5].map(grade => field(`pflegeStufe${grade}Zusatz`).value).join('/'), '3856/6426/19278/34272/64260', 'B7 Rückkehr zu „Individuelle Werte“ nach Fortschreibung: 3.856/6.426 € statt 6.000/12.000 €');
        field('pflegeStufe3Zusatz').value = '21000'; field('pflegeStufe3Zusatz').dispatchEvent(new Event('input'));
        select.value = 'ambulant'; select.dispatchEvent(new Event('change'));
        const remembered = JSON.parse(persistenceStorage.getItem(PFLEGE_CUSTOM_COSTS_KEY));
        assertEqual(`${remembered.version} ${remembered.origin} ${remembered.values[3]}`, '1 von Hand 21000', 'B7 Wechsel weg von „Individuelle Werte“ merkt markiert');
        select.value = 'custom'; select.dispatchEvent(new Event('change'));
        assertEqual(field('pflegeStufe3Zusatz').value, '21000', 'B7 markierte eigene Beträge kommen unverändert zurück');
    } finally { globalThis.document = prior.document; globalThis.window = prior.window; await resetPersistenceForTests(); }
}

// PFA3-B3: Sichtbarkeitsgrenze 0,50 € in der gewählten Eurobasis; Rohwerte und Summen bleiben nominal.
{
    const row = (rest, factor) => ({ jahr: 2, recordType: 'financial_year', entscheidung: { jahresEntnahme: 0 }, renteSum: 0, floor_brutto: 46368 + rest, pflege_zusatz_floor: 0,
        pflege_heimkosten: 40368, pflege_heim_eigene_ausgaben: 6000, flex_haushalt_erfuellt: 0, inflation_factor_cum: factor });
    const column = PROTOCOL_COLUMNS.find(item => item.id === 'floor-brutto');
    const nominalNegative = protocolCashflowBreakdown(row(-.6, 2), { moneyBasis: 'nominal' }).expenses.map(item => item.label);
    assert(nominalNegative.includes('Grundbedarf zu Hause'), 'PFA3-B3 nominal: −0,60 € bleibt eine Zeile');
    const realNegative = protocolCashflowBreakdown(row(-.6, 2), { moneyBasis: 'real' }).expenses.map(item => item.label);
    assert(!realNegative.includes('Grundbedarf zu Hause'), 'PFA3-B3 heutige Euro: −0,60 € nominal bei Faktor 2 sind −0,30 € und keine Zeile mehr („-0 €“ entfällt)');
    const realPositive = protocolCashflowBreakdown(row(.4, .5), { moneyBasis: 'real' }).expenses.find(item => item.label === 'Grundbedarf zu Hause');
    assert(realPositive, 'PFA3-B3 heutige Euro: +0,40 € nominal bei Faktor 0,5 sind 0,80 € und bleiben');
    close(realPositive.amount, .4, 'PFA3-B3 der Rohwert bleibt nominal');
    assertEqual(formatProtocolValue(column, realPositive.amount, row(.4, .5), { moneyBasis: 'real' }), '1 €', 'PFA3-B3 der Renderer zeigt die Zeile als 1 €');
    assert(!protocolCashflowBreakdown(row(.4, .5), { moneyBasis: 'nominal' }).expenses.some(item => item.label === 'Grundbedarf zu Hause'), 'PFA3-B3 nominal: 0,40 € bleibt unter der Grenze');
    assertEqual(protocolMoneyDivisor({ row: row(0, 2), inflationVJ: 10 }, { moneyBasis: 'real', source: 'backtest' }), 2.2, 'PFA3-B3 Backtest teilt einschließlich der Jahresinflation wie die Geldspalten');
    assertEqual(protocolMoneyDivisor(row(0, 2), { moneyBasis: 'nominal' }), 1, 'PFA3-B3 nominal ohne Umrechnung');
}

// Bildabnahme 10b: kaufmännische Rundung ohne Gleitkommarest (3.600 × 1,025 × 1,05 = 3.874,50 → 3.875 €).
{
    const projected = projectCarePrices({ ...CARE_PRICE_DEFAULTS, driftMarked: false }, { inflationRate: 2.5, driftPercent: 5, priceYear: 2027 });
    assertEqual(projected.costs[1], 3875, '10b Grad 1: 3.874,50 € rundet auf 3.875 €');
    assertEqual(projectCareValuesForYear(null, { inflationRate: 2.5, driftPercent: 5, priceYear: 2027 }).prices.costs[1], 3875, '10b auch über den vollständigen Record');
    assertEqual(projected.costs[3], Math.round(18000 * 1.025 * 1.05 + 1e-9), '10b übrige Werte unverändert gerundet');
}
setAppTestDate(null);
