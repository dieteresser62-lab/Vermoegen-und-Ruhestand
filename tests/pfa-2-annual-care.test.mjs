// FR-73 Paket 2: Jahresabschluss „Pflegewerte“ schreibt Staffel, Deckel, Heim-Bestandteile und eigene Ausgaben fort (J, Y, P8).
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { createAnnualCareEditor } from '../app/shared/annual-care-editor.js';
import { HOUSEHOLD_CARE_VALUES_KEY as KEY, DEFAULT_CARE_VALUES, parseCareValues, readCareValues, residentialMonthly } from '../app/shared/household-care-values.js';
import { projectCareValuesForYear, projectCarePrices, resolveCarePrices, careValuesWithPrices } from '../app/shared/care-prices.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords, evaluateAnnualDraft } from '../app/balance/balance-annual-storage-commit.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { readCareInputs } from '../app/simulator/simulator-input-care.js';
import { writeCarePriceField } from '../app/simulator/simulator-main-input-persist.js';
import { annualTestMarketData, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { exportProfilesBundle, importProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
setAppTestDate('2026-10-23');
const listen = (node, type, fn) => node.addEventListener(type, fn);
const close = (a, b, label, tolerance = 1e-6) => assert(Math.abs(a - b) < tolerance, `${label}: ${a} = ${b}`);
/** Abschlussfähige Records: offene Periode 2026 mit Pflegeperson. */
function closable(options) {
    const { records, scope } = pfa2Records(options);
    const metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]); state.annualPeriodMetadata = metadata;
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state); records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) if (registry.profiles[id]) { const own = JSON.parse(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]); own.annualPeriodMetadata = metadata; registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(own); }
    records.rs_profiles_v1 = JSON.stringify(registry);
    return { records, scope, marketData: { ...annualTestMarketData, inflation: { ...annualTestMarketData.inflation, rate: 2 } } };
}

// J: Fortschreibung mit 2,0 % Inflation und 5 % Kostenanstieg, ganze Euro, Pflegegeld unverändert.
{
    const projected = projectCareValuesForYear(null, { inflationRate: 2, driftPercent: 5, priceYear: 2027 });
    assertEqual(projected.prices.costs[3], 19278, 'J Staffel Grad 3 18.000 → 19.278 €/Jahr');
    assertEqual(JSON.stringify(projected.residential.components), JSON.stringify({ care: 2236, board: 1144, invest: 558 }), 'J Heim-Bestandteile 2.236 / 1.144 / 558 €/Monat');
    assertEqual(projected.residential.monthly, 3603, 'J Heimjahr 1 → 3.603 €/Monat');
    assertEqual(projected.prices.ownExpensesMonthly, 510, 'J eigene Ausgaben 500 → 510 €/Monat nur mit Inflation');
    assertEqual(projected.prices.maximumFloor, 128520, 'P3 Deckel 120.000 → 128.520 € wie die Staffel');
    assertEqual(JSON.stringify(projected.allowance), JSON.stringify(DEFAULT_CARE_VALUES.allowance), 'J Pflegegeld unverändert');
    assertEqual(`${projected.prices.origin} ${projected.residential.origin} ${projected.prices.priceYear} ${projected.residential.validFrom}`, 'fortgeschrieben fortgeschrieben 2027 2027-01', 'J Herkunft „fortgeschrieben“ mit Preisstand und gültig ab Januar');
    assertEqual(JSON.stringify(parseCareValues(JSON.stringify(projected))), JSON.stringify(projected), 'P8 fortgeschriebener Record übersteht Speichern und Lesen');
    const twice = projectCarePrices(projected.prices, { inflationRate: 2, driftPercent: 5, priceYear: 2027 });
    assert(twice.costs[3] !== projected.prices.costs[3], 'Kontrolle: eine zweite Multiplikation wäre sichtbar');
    for (const invalid of [{ ...projected.prices, costs: { ...projected.prices.costs, 2: -1 } }, { ...projected.prices, origin: 'geschätzt' }, { ...projected.prices, priceYear: '2027' }]) {
        let rejected = false;
        try { parseCareValues({ ...projected, prices: invalid }); } catch { rejected = true; }
        assert(rejected, 'P8 ungültige Pflegepreise werden abgewiesen');
    }
}

// Dialog: eingefrorene Basis, genau eine Fortschreibung, Neuberechnung bei geänderter Inflation hebt die Bestätigung auf.
{
    const { records } = pfa2Records({ care: [null, { grade: 3, form: 'home-support' }] });
    const store = annualRecordStorage(records), before = JSON.stringify(store.records), { doc } = createDialogFixture();
    const care = createAnnualCareEditor({ doc, targetYear: 2026, storage: store, listen }); doc.body.append(care.root);
    assertEqual(care.read().values.prices.costs[3], 18000, 'Ohne Inflation zeigt der Entwurf die Basis');
    assert(!care.read().dirty, 'Der Vorschlag der App ist keine eigene Eingabe');
    assert(care.setInflation(2), 'Abschlussinflation setzt den Vorschlag');
    assertEqual(care.read().values.prices.costs[3], 19278, 'J Dialog zeigt die fortgeschriebene Staffel');
    assertEqual(doc.getElementById('annualCare_cost3').value, '19.278 €', 'Feld folgt dem Vorschlag');
    assertEqual(doc.getElementById('annualCare_homeCare').value, '2.236 €', 'Heim-Bestandteil folgt dem Vorschlag');
    assertEqual(care.read().values.residential.monthly, 3603, 'J Heimjahr 1 im Dialog');
    assert(!care.read().dirty && !care.read().confirmed, 'Fortschreibung bleibt unbestätigt und nicht schmutzig');
    assert(!care.setInflation(2), 'Gleiche Inflation rechnet nicht erneut (keine Doppelmultiplikation)');
    await care.root.querySelector('[data-annual-care-confirm]').fire('click');
    assert(care.read().confirmed, '„Unverändert bestätigen“ bestätigt die fortgeschriebenen Werte');
    assertEqual(care.accept().prices.costs[3], 19278, 'Bestätigt wird der fortgeschriebene Stand');
    assert(care.setInflation(2.5), 'Geänderte Inflation rechnet neu');
    assert(!care.read().confirmed, 'Neuberechnung hebt die Bestätigung auf');
    assertEqual(care.read().values.prices.costs[3], Math.round(18000 * 1.025 * 1.05), 'Neuberechnung aus der eingefrorenen Basis, nicht aus dem alten Vorschlag');
    care.setInflation(2);
    await care.root.querySelector('[data-annual-care-edit]').fire('click');
    const field = doc.getElementById('annualCare_cost3'); field.value = '20.000'; await field.fire('input');
    assert(care.read().dirty, 'Eigene Eingabe ist eine Änderung');
    assertEqual(care.read().values.prices.costs[3], 20000, 'Eigener Wert gilt');
    assertEqual(care.read().values.prices.origin, 'von Hand', 'Eigene Werte erhalten die Herkunft „von Hand“');
    care.setInflation(3);
    assertEqual(care.read().values.prices.costs[3], 20000, 'Eigene Werte werden bei neuer Inflation nicht nochmals erhöht');
    assertEqual(care.read().values.prices.costs[4], Math.round(32000 * 1.03 * 1.05), 'Unberührte Felder folgen der neuen Inflation');
    assertEqual(JSON.stringify(store.records), before, 'Der Dialog schreibt keinen Fachrecord');
}

// Y und Vorschau = Abschluss: Deckel-Fortschreibung ergibt im Folgejahr 128.520 € Floor; der Abschluss ohne Dialog rechnet gleich.
{
    const { records, scope, marketData } = closable({ care: [{ grade: 5, form: 'home-support' }], single: true, plan: { floorBedarf: 90000 } });
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, scope, storage: annualRecordStorage(records), now: annualTestNow });
    const { doc } = createDialogFixture();
    const care = createAnnualCareEditor({ doc, targetYear: 2026, storage: annualRecordStorage(records), listen }); doc.body.append(care.root);
    care.setInflation(2); await care.root.querySelector('[data-annual-care-confirm]').fire('click');
    const prepared = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, careValues: care.accept(), adoptedPlanPatch: { floorBedarf: 91800 }, now: annualTestNow });
    const stored = readCareValues(annualRecordStorage(prepared.records));
    assertEqual(`${stored.prices.costs[5]} ${stored.prices.maximumFloor} ${stored.prices.origin} ${stored.confirmedForYear}`, '64260 128520 fortgeschrieben 2027', 'Y Jahresbatch speichert Staffel und Deckel fortgeschrieben');
    const after = buildBalanceEngineInputFromStorage({ storage: annualRecordStorage(prepared.records), scope, referenceYear: 2027 });
    assertEqual(after.inputData.floorBedarf, 128520, 'Y Floor im Folgejahr 128.520 € nach dem Jahresabschluss wie im Simulator');
    const headless = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, adoptedPlanPatch: { floorBedarf: 91800 }, now: annualTestNow });
    const projected = readCareValues(annualRecordStorage(headless.records));
    assertEqual(`${projected.prices.costs[5]} ${projected.prices.maximumFloor} ${projected.residential.components.care}`, '64260 128520 2236', 'Vorschau ohne Dialog nutzt denselben fortgeschriebenen Stand');
    assertEqual(buildBalanceEngineInputFromStorage({ storage: annualRecordStorage(headless.records), scope, referenceYear: 2027 }).inputData.floorBedarf, 128520, 'Vorschau und Abschluss ergeben denselben Floor');
    const current = evaluateAnnualDraft({ status: 'current', records: draft.baseRecords, scope, profileId: draft.profileId, planningYear: 2026, values: draft.before.householdPlan.entry.values, ageByPerson: {} }, { engineApi: EngineAPI, now: annualTestNow });
    assertEqual(current.adapter.getItem(KEY), draft.baseRecords[KEY] ?? null, 'Das laufende Jahr schreibt keine Fortschreibung');
    // Simulator liest dieselben Preise aus dem Record; alte sim_-Beträge bleiben Altbestand.
    const registry = JSON.parse(prepared.records.rs_profiles_v1), data = { ...registry.profiles[IDS[0]].data, sim_pflegeStufe5Zusatz: '60000', sim_pflegeMaxFloor: '120000' };
    const inputs = buildSimulatorInputsFromProfileData(data, { storage: annualRecordStorage(prepared.records), referenceYear: 2027, planValues: null });
    assertEqual(`${inputs.pflegeGradeConfigs[5].zusatz} ${inputs.pflegeMaxFloor} ${inputs.pflegeHeimEigeneAusgaben}`, '64260 128520 510', 'Simulator rechnet mit den fortgeschriebenen Preisen des Records');
    assertEqual(stored.allowance.values[3], 599, 'Pflegegeld bleibt beim gesetzlichen Betrag');
}

// Speichervertrag: Sicherung, Import/Recovery, Profilbundle; Altbestand nur lesend.
{
    const projected = JSON.stringify(projectCareValuesForYear(null, { inflationRate: 2, driftPercent: 5, priceYear: 2027 }));
    const { records } = pfa2Records({ care: [null, { grade: 4, form: 'residential' }], careValuesRaw: projected });
    assert(validatePersistenceDomainRecords(records).ok, 'Import und Recovery nehmen den erweiterten Pflegewerte-Record an');
    assert(!validatePersistenceDomainRecords({ ...records, [KEY]: JSON.stringify({ ...JSON.parse(projected), prices: { costs: {} } }) }).ok, 'Import weist ungültige Pflegepreise ab');
    const storage = annualRecordStorage(records);
    assertEqual(normalizeFullPersistenceBackup(buildFullPersistenceBackup({ storage })).backup.records[KEY], projected, 'Vollsicherung bewahrt die Pflegepreise bytegleich');
    const target = annualRecordStorage(pfa2Records({}).records);
    assert(importProfilesBundle(exportProfilesBundle({ storage }), { storage: target }).ok && target.getItem(KEY) === projected, 'Profilbundle trägt die Pflegepreise');
    const legacy = pfa2Records({ care: [null, { grade: 3, form: 'home-support' }], sim: { sim_pflegeStufe3Zusatz: '21000', sim_pflegeMaxFloor: '100000' } });
    const { storage: counting, counts } = countingStorage(legacy.records);
    const calc = buildBalanceEngineInputFromStorage({ storage: counting, scope: legacy.scope, referenceYear: 2026 });
    assertEqual(calc.inputData.floorBedarf, 57000, 'Altbestand: Balance liest eigene sim_-Staffel 21.000 lesend');
    assertEqual(counts.setItem + counts.removeItem, 0, 'P8 Altbestand wird beim Lesen nicht ergänzt oder geschrieben');
    assertEqual(resolveCarePrices(parseCareValues(null), { getItem: key => legacy.records[key] ?? null }).origin, 'von Hand', 'Eigene Altwerte zählen als „von Hand“');
}

// B3: Eine bewusst getippte 6.000 für Grad 1 bleibt 6.000 nach Speichern und Neuladen; Altbestand ohne Markierung wird weiter umgedeutet.
{
    const { records } = pfa2Records({ sim: { sim_pflegeStufe1Zusatz: '6000' } });
    const store = annualRecordStorage(records);
    const doc = { getElementById: id => id === 'pflegeStufe1Zusatz' ? { value: '6000', dataset: {} } : id === 'pflegeKostenStaffelPreset' ? { value: 'custom' } : null };
    assertEqual(readCareInputs({ doc, storage: store }).pflegeGradeConfigs[1].zusatz, 3600, 'Altbestand ohne Markierung: 6.000 gilt beim Lesen als Vorgabe 3.600');
    const marked = careValuesWithPrices(store.getItem(KEY), { costs: { 1: 6000 } }, { priceYear: 2026, legacySource: store });
    assertEqual(`${marked.prices.costs[1]} ${marked.prices.costs[2]} ${marked.prices.origin}`, '6000 6000 von Hand', 'Speichern durch den Nutzer markiert den Preisstand');
    store.setItem(KEY, JSON.stringify(marked));
    assertEqual(readCareInputs({ doc, storage: store }).pflegeGradeConfigs[1].zusatz, 6000, 'Mit Markierung bleibt die getippte 6.000 auch beim DOM-Lesen');
    const registry = JSON.parse(store.getItem('rs_profiles_v1'));
    assertEqual(buildSimulatorInputsFromProfileData({ ...registry.profiles[IDS[0]].data, sim_pflegeStufe1Zusatz: '6000' }, { storage: store, referenceYear: 2026, planValues: null }).pflegeGradeConfigs[1].zusatz, 6000, 'Mit Markierung bleibt 6.000 auch nach Neuladen über den Profilreader');
    assertEqual(resolveCarePrices(readCareValues(store), store).costs[1], 6000, 'Neuladen der Simulatorfelder zeigt 6.000');
    // Echter Schreibweg des Simulators über die Fassade: nur der Preisblock des Records ändert sich.
    await P.init({ installLifecycleHooks: false });
    try {
        for (const [key, value] of Object.entries(records)) P.setItemSync(key, value);
        writeCarePriceField('pflegeStufe1Zusatz', '6000');
        const written = parseCareValues(P.getItemSync(KEY));
        assertEqual(`${written.prices.costs[1]} ${written.prices.origin} ${written.prices.priceYear}`, '6000 von Hand 2026', 'Simulator-Eingabe schreibt den Preisblock mit Herkunft „von Hand“');
        writeCarePriceField('pflegeStufe1Zusatz', '');
        assertEqual(parseCareValues(P.getItemSync(KEY)).prices.costs[1], 6000, 'Leere Eingabe schreibt nichts');
    } finally { await resetPersistenceForTests(); }
}
setAppTestDate(null);
