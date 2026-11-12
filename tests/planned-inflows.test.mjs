import { readGU1References } from './helpers/gu-1-expectations.mjs';
// LE-1 (FR-75) und KO-2 (Ergänzung FR-76) in einem Leser; Paare, die beide ändern, sind für den vereinten Stand gemessen.
import { readLE1KO2References } from './helpers/le-1-ko-2-expectations.mjs';
import { readPFA1References } from './helpers/pfa-1-expectations.mjs';
const readEV1bReferences = value => readPFA1References(beforePFA1References(value));
import { withoutExampleNeeds } from './helpers/ff-3-expectations.mjs';
import { installRealClock } from './helpers/fixed-real-clock.mjs';
import { readEV1bReferences as beforePFA1References } from './helpers/ev-1b-expectations.mjs';
const readZG1References = value => readEV1bReferences(readBeforeEV1bReferences(value));
import { readZG1References as readBeforeEV1bReferences } from './helpers/zg-1-expectations.mjs';
import { readEV1References as readBeforeZG1References, ev1Evidence } from './helpers/ev-1-expectations.mjs';
const readEV1References = value => readZG1References(readBeforeZG1References(value));
import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readVF2EReferences } from './helpers/vf-2e-expectations.mjs';
const readVF2BReferences = value => readQSCReferences(readVF2EReferences(previousVF2BReferences(value)));
import { readVF2BReferences as previousVF2BReferences } from './helpers/vf-2b-expectations.mjs';
import { readMU1Hash } from './helpers/mu-1-expectations.mjs';
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { readAS1Hash } from './helpers/as-1-expectations.mjs';
import { readEP1Hash } from './helpers/ep-1-expectations.mjs';
import { readRNG1Hash as readBeforeEP1Hash, rng1Evidence } from './helpers/rng-1-expectations.mjs';
import { readPG1bHash } from './helpers/pg-1b-expectations.mjs';
import { readAN1Hash } from './helpers/an-1-expectations.mjs';
import { readEK1dHash } from './helpers/ek-1d-expectations.mjs';
import { readNR1Hash } from './helpers/nr-1-expectations.mjs';
import { legacyDemoIncomeRecords } from './helpers/income-legacy-demo.mjs';
import { INCOME_KEY, readIncome, writeIncome, simulatorOneTimeIncome } from '../app/profile/profile-income.js';
import { applyPersonIncomeToDom, bindPersonIncome } from '../app/tranches/tranchen-manager-income.js';
import { readJB2Hash } from './helpers/jb-2-expectations.mjs';
import { readKG1Hash } from './helpers/kg-1-expectations.mjs';
import { readBK2Hash } from './helpers/bk-2-expectations.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { getProfileData, exportProfilesBundle, saveCurrentProfileFromLocalStorage } from '../app/profile/profile-storage.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { readPlannedInflows, writePlannedInflows, PLANNED_INFLOWS_KEY, personPlannedInflowsErrors } from '../app/profile/profile-planned-inflows.js';
import { applyPlannedInflows } from '../app/simulator/planned-inflows.js';
import { initializePlannedInflows } from '../app/simulator/planned-inflows-ui.js';
import { loadProfileAssetValues, saveProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { previewPersonExport, confirmPersonExport, previewPersonImport, importPersonFile } from '../app/profile/profile-person-file.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { prepareCashRecords } from '../app/profile/profile-cash-update.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { validateSimulatorInputs, formatSimulatorValidationError } from '../app/simulator/simulator-input-validation.js';
import { initSimulatorProfileSelection } from '../app/simulator/simulator-main-profiles.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initDynamicFlexControls } from '../app/simulator/simulator-main-dynamic-flex.js';
import { initSimulatorPlanTrial, getSimulatorPlanTrial } from '../app/simulator/simulator-plan-trial.js';
import { getCommonInputs, initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { runHistoricalBacktest } from '../app/simulator/historical-backtest-runner.js';
import { createHistoricalBacktestContractProvider } from '../app/simulator/historical-backtest-contract.js';
import { computeAdjPctForYear } from '../app/simulator/simulator-main-helpers.js';
import { resolveDynamicFlexRunnerHorizon } from '../app/simulator/dynamic-flex-runner-horizon.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
import { prepareHistoricalDataOnce, getDataVersion, initMcRunState } from '../app/simulator/simulator-engine-helpers.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { runSweepChunk } from '../app/simulator/sweep-runner.js';
import { runMonteCarloAutoOptimize } from '../app/simulator/auto-optimize-worker.js';
import { evaluateCandidate } from '../app/simulator/auto-optimize-evaluate.js';
import { createStressReplayCaptureRequest, materializeStressReplayPathV1 } from '../app/simulator/stress-replay-path-materializer.js';
import { createStressReplayFingerprint } from '../app/simulator/stress-replay-contract.js';
import { runStressReplayPathV1 } from '../app/simulator/stress-replay-runner.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { simulatorDocument } from './simulator-page-fixture.mjs';

const readRNG1Hash = before => readQSCReferences(readAS1Hash(readEP1Hash(readBeforeEP1Hash(before))));
const incomeEntries = rows => rows.map((row, index) => ({ id: `test-${index + 1}`, monat: `${row.year}-01`, betrag: row.amount, bezeichnung: row.label || '' }));
const same = (a, b, message) => assertEqual(JSON.stringify(a), JSON.stringify(b), message);
const parameters = { anzahl: 4, maxDauer: 35, blockSize: 3, seed: 3, methode: 'regime_markov',
    rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
{
    const doc = createSelectionDocument();
    for (const id of ['plannedInflowsRows', 'plannedInflowsSummary']) addField(doc, id);
    const row = { year: 2028, amount: 12000, label: 'Rückzahlung' };
    const person = (profileId, name, entries) => ({ profileId, name, data: { [PLANNED_INFLOWS_KEY]: writePlannedInflows(entries) } });
    initializePlannedInflows([person('a', 'Max', [row]), person('b', 'Erika', [row, { ...row, year: 2029 }])], 2026, doc);
    const columns = doc.getElementById('plannedInflowsRows').children;
    assertEqual(columns.length, 2, 'Zuflusskarte: beide Personen als Spalten');
    assertEqual(columns[0].children.length, 2, 'Zuflusskarte: einzelner Eintrag ohne doppelte Personensumme');
    assertEqual(columns[0].children[1].textContent, '2028 · 12.000 € · Rückzahlung', 'Zuflusskarte: Jahr, Betrag und Bezeichnung unter dem Namen');
    assertEqual(columns[1].children[3].className, 'sim-inflow-person-total', 'Zuflusskarte: mehrere Einträge mit schlichter Personensumme');
    assertEqual(doc.getElementById('plannedInflowsSummary').textContent, '3 einmalige Einkünfte · zusammen 36.000 € · 2028–2029', 'Zuflusskarte: genau eine Haushaltsgesamtzeile');
}
function adapter(records = {}) {
    const store = new Map(Object.entries(records)), snapshots = new Map();
    return { name: 'ZF-2 memory', async open() {}, async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); },
        async listSnapshots() { return [...snapshots.values()].map(({ records, ...meta }) => meta); },
        async readSnapshot(id) { return snapshots.get(id); }, async writeSnapshot(snapshot) { snapshots.set(snapshot.id, structuredClone(snapshot)); return true; },
        async deleteSnapshot(id) { return snapshots.delete(id); } };
}
async function boot(records) {
    P.resetPersistenceForTests(adapter(records));
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
function page() {
    const doc = simulatorDocument();
    globalThis.document = doc; globalThis.window = { EngineAPI, addEventListener() {}, removeEventListener() {} };
    initInputPersistence(); initDynamicFlexControls({ enableLocalPersistence: false });
    initSimulatorProfileSelection(); initSimulatorPlanTrial();
    assertEqual(window.__profileRecoveryBlocker, null, 'Profilübernahme ohne Fehler');
    return doc;
}
function backtest(inputs) {
    return runHistoricalBacktest({ inputs, period: { startYear: 2000, endYear: 2025 },
        historicalDataProvider: createHistoricalBacktestContractProvider(), initializePortfolio,
        simulateYear: (...args) => simulateOneYear(...args, null, 0, null, 1, EngineAPI),
        computeAdjustmentPct: computeAdjPctForYear, resolveHorizon: resolveDynamicFlexRunnerHorizon,
        totalPortfolio: portfolioTotal, breakOnRuin: true });
}
const previous = { document: globalThis.document, window: globalThis.window };
prepareHistoricalDataOnce();
try {
    const list = [{ year: 2028, amount: 40000, label: 'Erbe' }, { year: 2030, amount: 1234.56, label: '' }];
    same(readPlannedInflows(writePlannedInflows(list)), list, 'Versionierte Liste hin und zurück');
    same(readPlannedInflows(undefined), [], 'Altbestand ohne Schlüssel hat keine Zuflüsse');
    for (const raw of ['{', '{"schemaVersion":2,"entries":[]}', '{"schemaVersion":1,"entries":[null]}']) {
        let caught = false; try { readPlannedInflows(raw); } catch { caught = true; } assert(caught, 'Beschädigte Liste wird nicht als leer gelesen');
    }
    await boot(createMusterHaushaltRecords('2026-10-16', 'jan-lena'));
    saveProfileAssetValues({ ...loadProfileAssetValues(), einkuenfte: incomeEntries(list) });
    saveCurrentProfileFromLocalStorage();
    same(simulatorOneTimeIncome(getProfileData('muster_jan')), list, 'Persönliche Speicherung übersteht Live-Capture');
    const cash = prepareCashRecords(getProfileData('muster_jan'), '12345', '2026-10-16');
    assertEqual(cash.profile_tagesgeld, '12345', 'Tagesgeldpfad berücksichtigt keine Zuflüsse');
    const restoreRealClock = installRealClock('2031-01-02');
    try {
    setAppTestDate('2032-01-02');
    assertEqual(prepareCashRecords(getProfileData('muster_jan'), '12345', '2032-01-02').profile_tagesgeld, '12345', 'Vergangene Zuflüsse sperren späteren Jahresabschluss nicht');
    } finally { setAppTestDate(null); restoreRealClock(); }
    await P.flush();
    const personFile = await confirmPersonExport(await previewPersonExport('muster_jan'));
    same(simulatorOneTimeIncome(personFile.registry.profiles.muster_jan.data), list, 'Personendatei enthält die persönliche Liste');
    const imported = await importPersonFile(await previewPersonImport(personFile));
    same(simulatorOneTimeIncome(getProfileData(imported.id)), list, 'Personendatei hin und zurück erhält alle Zuflüsse');
    assertEqual(getProfileData(imported.id) !== null, true, 'Außenperson behält ihre Zuflüsse');
    page();
    assertEqual(getCommonInputs().plannedInflows.length, 3, 'Simulator berücksichtigt nur Jan und Lena, Außenperson behält ihre Liste');
    assert(!getCommonInputs().plannedInflows.some(entry => entry.profileId === imported.id), 'Außenperson fließt nicht in Haushaltsrechnung ein');
    const exported = exportProfilesBundle();
    assert(JSON.stringify(exported).includes('Nettozahlung aus vereinbartem Verkauf'), 'Profilexport enthält Lenas Liste');
    assert(JSON.stringify(exported).includes('1234.56'), 'Profilexport enthält bearbeitete Liste');
    const backup = JSON.parse(JSON.stringify(buildFullPersistenceBackup()));
    delete globalThis.document; delete globalThis.window;
    await boot({});
    const restored = await importFullPersistenceBackup(backup);
    assertEqual(restored.ok, true, 'Vollsicherung wird wiederhergestellt: ' + JSON.stringify(restored));
    same(simulatorOneTimeIncome(getProfileData('muster_jan')), list, 'Wiederherstellung erhält Jans Liste');
    same(simulatorOneTimeIncome(getProfileData('muster_lena')), [{ year: 2031, amount: 60000, label: 'Nettozahlung aus vereinbartem Verkauf' }], 'Wiederherstellung erhält Lenas Liste');
    // Actual area copy preserves the key and never changes the real records.
    const f = await playFixture('tauri', backup.records);
    let controller = await f.boot();
    const real = f.realBytes();
    await controller.start(() => ({ source: 'copy', testDate: null })); controller = await f.boot();
    same(simulatorOneTimeIncome(getProfileData('muster_jan')), list, 'Spielbereich-Kopie enthält persönliche Zuflüsse');
    assertEqual(f.realBytes(), real, 'Spielbereich lässt echte Daten bytegleich');
    await controller.end(() => true);
    P.resetPersistenceRuntimeForTests();
    await boot(createMusterHaushaltRecords('2026-10-16'));
    const oldBackup = JSON.parse(JSON.stringify(buildFullPersistenceBackup()));
    await boot({});
    assertEqual((await importFullPersistenceBackup(oldBackup)).ok, true, 'Alte Vollsicherung ohne Zuflussschlüssel bleibt wiederherstellbar');
    setAppTestDate('2026-10-16');
    const doc = page();
    const inputs = getCommonInputs();
    assert(!Object.hasOwn(inputs, 'plannedInflows'), 'Seitenweg mit Altbestand bleibt ohne Zusatzfeld');
    const inflows = [{ profileId: 'muster_b', year: 2026, amount: 50000, label: 'Rückzahlung' }];
    const withInflows = { ...inputs, plannedInflows: inflows, plannedInflowsReferenceYear: 2026 };
    for (const [key, value] of [['year', 0], ['year', 10000], ['year', 2026.5], ['amount', 0], ['amount', -1],
        ['amount', NaN], ['amount', Infinity], ['label', 'a'.repeat(61)], ['profileId', 'fremd']]) {
        let error; try { validateSimulatorInputs({ ...withInflows, plannedInflows: [{ ...inflows[0], [key]: value }] }, { horizonYears: 35 }); } catch (caught) { error = caught; }
        assert(error?.errors.some(entry => entry.fieldId.endsWith(key)), `${key}=${value}: Feldfehler`);
        assert(formatSimulatorValidationError(error).includes('Einmalige Einkunft 1'), 'Startmeldung nennt den Zufluss in Klartext');
    }
    validateSimulatorInputs({ ...withInflows, plannedInflows: [{ ...inflows[0], year: 2060, label: 'a'.repeat(60) }] }, { horizonYears: 35 });
    assert(true, '60 Zeichen sind gültig');
    for (const year of [2025, 2087, 2026.5]) assert(personPlannedInflowsErrors([{ year, amount: 1, label: '' }]).some(error => error.field.endsWith('year')), 'Personenjahr wird geprüft: ' + year);
    for (const year of [2026, 2086]) same(personPlannedInflowsErrors([{ year, amount: 1, label: '' }]), [], 'Personenjahr an der Grenze gültig: ' + year);
    const outside = { ...withInflows, plannedInflows: [{ ...inflows[0], year: 2086 }] };
    validateSimulatorInputs(outside, { horizonYears: 1 });
    assertEqual(applyPlannedInflows(structuredClone(initializePortfolio(inputs)), outside, 0), null, 'Späterer Personenzufluss sperrt kurzen Lauf nicht und wird noch nicht gebucht');
    const portfolio = structuredClone(initializePortfolio(inputs));
    const before = portfolio.personAccounts.map(account => account.tagesgeld);
    same(applyPlannedInflows(portfolio, withInflows, 0), { zufluss: 50000, zufluss_personen: [{ profileId: 'muster_b', amount: 50000, label: 'Rückzahlung' }] }, 'Zuflussprotokoll enthält Person und Betrag');
    assertEqual(portfolio.personAccounts[0].tagesgeld, before[0], 'Max bekommt Erikas Zufluss nicht');
    assertEqual(portfolio.personAccounts[1].tagesgeld, before[1] + 50000, 'Erika bekommt den vollen Nettobetrag');
    const historical = { jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0 };
    let boundary;
    const result = simulateOneYear(initMcRunState(inputs, 0), withInflows, historical, 0, null, 0, null, 1,
        { simulateSingleYear(input, ...args) { boundary = input; return EngineAPI.simulateSingleYear(input, ...args); } });
    assertEqual(result.kind, 'success', 'Echtes Enginejahr mit Zufluss läuft');
    assertEqual(boundary.tagesgeld, inputs.tagesgeld + 50000, 'Gutschrift erreicht die Engine vor ihrer Verkaufsentscheidung');
    assertEqual(result.logData.zufluss, 50000, 'Jahresprotokoll nennt den Zufluss');
    const noInflowResult = simulateOneYear(initMcRunState(inputs, 0), inputs, historical, 0, null, 0, null, 1, EngineAPI);
    assert(result.logData.liquiditaet > noInflowResult.logData.liquiditaet || result.logData.vk.vkGes < noInflowResult.logData.vk.vkGes,
        'Zufluss bewirkt mehr Liquidität oder weniger Verkauf');
    assertEqual(result.logData.renteSum, noInflowResult.logData.renteSum, 'Zufluss wird nicht als Rente gezählt');
    assertClose(result.logData.portfolio_flow_delta, 0, 1, 'Zufluss verursacht keine ungeklärte Flow-Differenz');
    const combined = structuredClone(initializePortfolio(inputs));
    const sum = applyPlannedInflows(combined, { ...withInflows, plannedInflows: [...inflows,
        { ...inflows[0], amount: 1000, label: 'Rate 2' }, { ...inflows[0], profileId: 'muster_a', amount: 2000 }] }, 0);
    assertEqual(sum.zufluss, 53000, 'Mehrere Zuflüsse im selben Jahr werden addiert');
    assertEqual(combined.personAccounts[0].tagesgeld, before[0] + 2000, 'Gemeinsames Zuflussjahr wahrt Max’ Eigentum');
    assertEqual(combined.personAccounts[1].tagesgeld, before[1] + 51000, 'Beide Raten gehören Erika');
    const html = renderProtocolTable([result.logData], { source: 'mc', moneyBasis: 'nominal' });
    assert(html.includes('Einmalige Einkünfte') && html.includes('50.000'), 'Szenarioprotokoll zeigt den Zufluss mit der neuen Anzeigebezeichnung');
    const realHtml = renderProtocolTable([{ ...result.logData, inflation_factor_cum: 2 }], { source: 'mc', moneyBasis: 'real' });
    assert(realHtml.includes('25.000'), 'Zufluss folgt dem Euro-Schalter');
    assert(!renderProtocolTable([noInflowResult.logData], { source: 'mc' }).includes('data-protocol-column="zufluss"'), 'Ohne Zufluss bleibt das Protokoll ohne neue Spalte');
    // Personengruppe bearbeitet einen Entwurf, Simulator zeigt ausschließlich gespeicherte Werte.
    const personDoc = createSelectionDocument();
    for (const id of ['profileEinkuenfte', 'profileFixedIncomeRows', 'profileOneTimeIncomeRows', 'profileOneTimeIncomeAdd', 'profileIncomeStatus']) addField(personDoc, id);
    applyPersonIncomeToDom([], personDoc); bindPersonIncome(personDoc);
    personDoc.getElementById('profileOneTimeIncomeAdd').dispatchEvent({ type: 'click' });
    const monthField = personDoc.getElementById('income-0-monat'); monthField.value = '10.2026'; monthField.dispatchEvent({ type: 'input' });
    const amountField = personDoc.getElementById('income-0-betrag');
    assertEqual(amountField.getAttribute('aria-invalid'), 'true', 'Neue leere Betragszeile ist markiert');
    amountField.value = '12000,50'; amountField.dispatchEvent({ type: 'input' });
    const incomeDraft = readIncome(personDoc.getElementById('profileEinkuenfte').value);
    const draft = simulatorOneTimeIncome({ [INCOME_KEY]: writeIncome(incomeDraft) });
    same(draft, [{ year: 2026, amount: 12000.5, label: '' }], 'Personengruppe liest deutschen Eurobetrag ohne Personenauswahl');
    assertEqual(personDoc.getElementById('plannedInflow-0-profileId'), null, 'Personengruppe braucht keine Personenauswahl');
    assert(!getCommonInputs().plannedInflows, 'Ungespeicherter Personenentwurf ändert Simulator nicht');
    saveProfileAssetValues({ ...loadProfileAssetValues(), einkuenfte: incomeDraft }); saveCurrentProfileFromLocalStorage();
    initSimulatorProfileSelection();
    same(getCommonInputs().plannedInflows, [{ ...draft[0], profileId: 'muster_a' }], 'Simulator liest gespeicherten Zufluss über den Personen-Seitenweg');
    assertEqual(doc.getElementById('plannedInflowsRows').querySelector('input'), null, 'Simulatoranzeige enthält keine Eingabe');
    assertEqual(doc.getElementById('plannedInflowsAdd'), null, 'Simulator bietet kein Hinzufügen');
    assertEqual(doc.getElementById('plannedInflowsSummary').textContent.includes('12.001'), true, 'Simulator zeigt persönliche Summe');
    personDoc.getElementById('profileOneTimeIncomeRows').querySelector('button').dispatchEvent({ type: 'click' });
    same(readIncome(personDoc.getElementById('profileEinkuenfte').value), [], 'Entfernen leert den Personenentwurf');
    saveProfileAssetValues({ ...loadProfileAssetValues(), einkuenfte: [] }); saveCurrentProfileFromLocalStorage();
    initSimulatorProfileSelection();
    assert(!getCommonInputs().plannedInflows, 'Entfernen leert die Berechnungsliste');
    // Historische Vollreferenzen verwenden ausdrücklich 70/75/75 %; FR-55-Vorgaben werden separat geprüft.
    // Referenzhashes einschließlich Pfad 0; RF-1 korrigiert Rentengarantie, Pflegetod und Kirchensteuer.
    const expected = JSON.parse(readFileSync(new URL('./fixtures/planned-inflows-empty-ff-g.json', import.meta.url)));
    const carePriceReferences = JSON.parse(readFileSync(new URL('./fixtures/pf-1a-care-price-references.json', import.meta.url)));
    const careFlexReferences = JSON.parse(readFileSync(new URL('./fixtures/pf-1b-care-flex-references.json', import.meta.url)));
    const carePathReferences = JSON.parse(readFileSync(new URL('./fixtures/pm-1c-care-path-references.json', import.meta.url)));
    const careDeathReferences = JSON.parse(readFileSync(new URL('./fixtures/sn-1b-care-death-flex-references.json', import.meta.url)));
    const afterCareDeathChange = hash => careDeathReferences.hashes[hash] ?? hash;
    // PM-1c verschiebt die Pflegeziehungen dieses festen Pfads. Die alten
    // Vollreferenzen bleiben als belegte Vorgänger erhalten; neue Rohpayloads
    // werden vollständig geprüft, ohne historische Diagnosefelder umzuschreiben.
    for (const household of ['max-erika', 'renate', 'helga-werner', 'jan-lena']) {
        const records = legacyDemoIncomeRecords(withoutExampleNeeds(createMusterHaushaltRecords('2026-10-16', household)));
        if (household === 'renate') {
            assertEqual(createHash('sha256').update(JSON.stringify(records)).digest('hex'), readLE1KO2References(readGU1References(readQSCReferences(readVF2BReferences('d70f827e3e6290501c7dc596f1a1a750a886893725442d143c231b3f93d6d115')))),
                'Renate: vollständige Musterrecords mit Personenzuordnung im Beleg');
            const receipt = JSON.parse(records.annual_plan_record_v1);
            for (const entry of Object.values(receipt.entries)) for (const outcome of [entry.recommended, entry.adopted])
                for (const source of outcome.action.quellen || []) delete source.sourceProfileName;
            records.annual_plan_record_v1 = JSON.stringify(receipt);
        }
        const payload = household === 'jan-lena' ? { balance: records.ruhestandsmodellValues_v29_guardrails, annual: records.annual_plan_record_v1 } : records;
        assertEqual(createHash('sha256').update(JSON.stringify(payload)).digest('hex'), readLE1KO2References(readGU1References(readQSCReferences(readVF2BReferences(readGL1References(household === 'renate'
            ? '0e8bc1e8cfb45b6edac14057d6a6990e850331402a88f0c78896b26529d5ae20'
            : readMU1Hash(readAN1Hash(readJB2Hash(readBK2Hash(expected.demoHashes[household]))))))))),
            household + ': vollständige Musterreferenz; Renate mit 3 Töpfen nach FR-58');
    }
    for (const preset of ['Vorgabe', 'konservativ', 'ausgewogen', 'offensiv']) {
        const trial = getSimulatorPlanTrial(doc);
        if (preset !== 'Vorgabe') { trial.start(); doc.getElementById('dynamicFlexPreset').value = preset; doc.getElementById('dynamicFlexPreset').dispatchEvent({ type: 'change' }); }
        const current = { ...getCommonInputs(), survivorFloorPercent: 70, survivorFlexPercent: 75, survivorMinimumFlexPercent: 75 };
        const chunk = await runMonteCarloChunk({ inputs: current, monteCarloParams: parameters, widowOptions: current.widowOptions,
            useCapeSampling: doc.getElementById('useCapeSampling').checked, runRange: { start: 0, count: 4 }, engine: EngineAPI });
        const payload = { rows: backtest(current).rows, path0: chunk.runMeta.find(run => run.index === 0).logDataRows };
        const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        const reference = carePriceReferences.presets[preset];
        assertEqual(readQSCReferences(readJB2Hash(readBK2Hash(expected.hashes[preset]))), reference.before,
            `${preset}: historische Referenz bleibt als Basis der Pflegepreiskorrektur erhalten`);
        const flexReference = careFlexReferences.presets[preset];
        assertEqual(reference.after, flexReference.before, `${preset}: FR-38-Referenz bleibt erhalten`);
        const legacy = structuredClone(current);
        for (const [i, level] of [.75, .25, .1, 0, 0].entries()) legacy.pflegeGradeConfigs[i + 1].flexCut = level;
        legacy.pflegeStufe1FlexCut = .75;
        const legacyChunk = await runMonteCarloChunk({ inputs: legacy, monteCarloParams: parameters, widowOptions: legacy.widowOptions,
            useCapeSampling: doc.getElementById('useCapeSampling').checked, runRange: { start: 0, count: 4 }, engine: EngineAPI });
        const legacyPayload = { rows: backtest(legacy).rows, path0: legacyChunk.runMeta.find(run => run.index === 0).logDataRows };
        assertEqual(carePathReferences.presets[preset].legacyPayload.beforeHistoricalSha256,
            afterCareDeathChange(readQSCReferences(readKG1Hash(reference.after))), `${preset}: historische Referenz mit alten Flex-Werten bleibt erhalten`);
        assertEqual(createHash('sha256').update(JSON.stringify(legacyPayload)).digest('hex'), readLE1KO2References(readGU1References(readEV1References(readQSCReferences(readVF2BReferences(readGL1References(readRNG1Hash(readPG1bHash(readAN1Hash(readEK1dHash(carePathReferences.presets[preset].legacyPayload.afterSha256)))))))))), `${preset}: vollständiger PM-1c-Pfad mit alten Flex-Werten`);
        assertEqual(JSON.stringify(payload.rows), JSON.stringify(legacyPayload.rows), `${preset}: Backtest-Jahreszeilen ohne Pflege bleiben gleich`);
        assertEqual(carePathReferences.presets[preset].payload.beforeHistoricalSha256,
            afterCareDeathChange(readQSCReferences(readKG1Hash(flexReference.after))), `${preset}: historische FR-39/FR-40-Vollreferenz bleibt erhalten`);
        assertEqual(hash, readLE1KO2References(readGU1References(readEV1References(readQSCReferences(readVF2BReferences(readGL1References(readRNG1Hash(readPG1bHash(readAN1Hash(readEK1dHash(carePathReferences.presets[preset].payload.afterSha256)))))))))), `${preset}: vollständiger PM-1c-Backtest und MC-Pfad 0`);
        for (const [kind, actual] of [['payload', payload], ['legacyPayload', legacyPayload]]) {
            const ev1 = ev1Evidence.controls[preset][kind];
            const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
            assertEqual(digest(actual.rows), readLE1KO2References(readGU1References(ev1.backtest)), `${preset}/${kind}: EV-1 lässt sämtliche Backtestzeilen bytegleich`);
            assertEqual(digest(actual.path0.slice(0, ev1.deathIndex)), readLE1KO2References(readGU1References(readPFA1References(ev1.beforeDeath))), `${preset}/${kind}: EV-1 lässt alle Zeilen vor dem Erbfall bytegleich`);
            const reference = rng1Evidence.carePath[preset][kind];
            assertEqual(createHash('sha256').update(JSON.stringify(actual.path0.slice(0, reference.prefixLength))).digest('hex'), readLE1KO2References(readGU1References(readQSCReferences(readVF2BReferences(readGL1References(reference.prefixSha256))))), `${preset}/${kind}: alle Jahresfelder vor geänderter Pflegeziehung mit belegten NR-1-Anzeigeänderungen`);
            assertEqual(createHash('sha256').update(JSON.stringify(actual.rows)).digest('hex'), readLE1KO2References(readGU1References(readQSCReferences(readVF2BReferences(readGL1References(reference.backtestSha256))))),
                `${preset}/${kind}: alle Backtestzeilen mit belegten NR-1-Anzeigeänderungen`);
            const firstCare = actual.path0.find(row => row.CareP1_Active);
            assertEqual(firstCare.jahr, reference.firstCareYear, `${preset}/${kind}: neuer Pflegebeginn`);
            assertEqual(firstCare.CareP1_Grade, reference.firstCareGrade, `${preset}/${kind}: neuer Anfangsgrad`);
            const death = actual.path0.find(row => row.jahr === reference.deathYear);
            assert(death.SurvivorDeathYear && death.Person1Alive === 0 && death.CareP1_Grade === reference.deathGrade,
                `${preset}/${kind}: PG3-Tod bleibt trotz späteren Eintritts geprüft`);
            // SN-1: unabhängige Ankerrechnung am neuen Eintritt und im neuen
            // Sterbejahr (halbes Paarjahr + halbes Hinterbliebenenjahr mit 70 %).
            for (const [row, floorFactor] of [[firstCare, 1], [death, .85]]) {
                const persons = Number(Boolean(row.CareP1_Active)) + Number(Boolean(row.CareP2_Active));
                const floor = current.startFloorBedarf * row.inflation_factor_cum * floorFactor;
                const maximum = current.pflegeMaxFloor * row.inflation_factor_cum
                    * (1 + current.pflegeKostenDrift) ** (row.jahr - 1);
                assertClose(row.pflege_floor_anchor, persons * floor, 1e-7, `${preset}/${kind}: SN-1-Grundbedarfsanker`);
                assertClose(row.pflege_cap_zusatz, persons * Math.max(0, maximum - floor), 1e-7,
                    `${preset}/${kind}: SN-1-Zusatzdeckel`);
            }
        }
        const firstChanged = payload.path0.findIndex((row, i) => JSON.stringify(row) !== JSON.stringify(legacyPayload.path0[i]));
        assertEqual(payload.path0[firstChanged]?.jahr, rng1Evidence.carePath[preset].payload.firstCareYear, `${preset}: erster Flex-Unterschied beim neuen Pflegeeintritt`);
        assertEqual(payload.path0[firstChanged]?.CareP1_Grade, 1, `${preset}: PG1 behält mit FR-39 vollen Flex`);
        const withoutCare = { ...current, pflegefallLogikAktivieren: false };
        const healthyChunk = await runMonteCarloChunk({ inputs: withoutCare, monteCarloParams: parameters,
            widowOptions: withoutCare.widowOptions, useCapeSampling: doc.getElementById('useCapeSampling').checked,
            runRange: { start: 0, count: 4 }, engine: EngineAPI });
        const healthyPayload = { rows: backtest(withoutCare).rows,
            path0: healthyChunk.runMeta.find(run => run.index === 0).logDataRows };
        assertEqual(createHash('sha256').update(JSON.stringify(healthyPayload)).digest('hex'), readLE1KO2References(readGU1References(readEV1References(readQSCReferences(readVF2BReferences(readGL1References(readRNG1Hash(readAN1Hash(readEK1dHash(readKG1Hash(reference.withoutCare)))))))))),
            `${preset}: Backtest und MC-Pfad ohne Pflege auf Basis samt belegten KG-1-Texten`);
        if (preset !== 'Vorgabe') trial.reset();
    }
    // Jan/Lena demo years shift with all other demo dates.
    const shifted = JSON.parse(createMusterHaushaltRecords('2029-10-16', 'jan-lena').rs_profiles_v1);
    assertEqual(simulatorOneTimeIncome(shifted.profiles.muster_jan.data)[0].year, 2031, 'Jans Musterjahr verschiebt sich');
    assertEqual(simulatorOneTimeIncome(shifted.profiles.muster_lena.data)[0].year, 2034, 'Lenas Musterjahr verschiebt sich');
    await boot(createMusterHaushaltRecords('2026-10-16', 'jan-lena')); page();
    const janLena = getCommonInputs();
    assertEqual(janLena.plannedInflows.length, 2, 'Außenperson wird vom Simulator nicht gerechnet');
    const sourceRequest = { inputs: janLena, widowOptions: janLena.widowOptions, monteCarloParams: { ...parameters, anzahl: 1, maxDauer: 6 }, useCapeSampling: false };
    const source = await runMonteCarloChunk({ ...sourceRequest, runRange: { start: 0, count: 1 }, logIndices: [0],
        stressReplayCapture: createStressReplayCaptureRequest([0]), engine: EngineAPI });
    const meta = source.runMeta[0];
    const path = materializeStressReplayPathV1({ capture: meta.stressReplayCapture, sourceLogRows: meta.logDataRows,
        sourceRequest, dataFingerprint: createStressReplayFingerprint({ dataVersion: getDataVersion() }),
        engineFingerprint: createStressReplayFingerprint({ engineVersion: EngineAPI.version }), scenarioKey: 'zf-jan-lena', selectionMetric: 'nominal_terminal_wealth_eur' });
    const replay = runStressReplayPathV1({ path, baselineInputs: janLena, sourceScenarioLog: meta.logDataRows, engine: EngineAPI });
    assertEqual(replay.reconciliation.matched, true, 'Stresspfad-Replay mit Zuflüssen stimmt mit dem MC-Pfad überein');
    for (const logDetailLevel of ['normal', 'detailed']) {
        const html = renderProtocolTable(replay.scenarioLog.records, { source: 'mc', logDetailLevel });
        const ids = [...html.matchAll(/data-protocol-column="([^"]+)"/g)].map(match => match[1]);
        const start = ids.indexOf('income-total');
        const expected = ['income-total', 'expense-total', ...(logDetailLevel === 'detailed'
            ? ['withdrawal', 'rentesum', 'rente1', 'rente2', 'other-income', 'zufluss', 'planned-expenses', 'income-saved', 'widow-income-offset'] : [])];
        assertEqual(ids.slice(start, start + expected.length).join(','), expected.join(','), 'Gerechneter Stresspfad-Replay zeigt Summen und vollständige Details');
        assertEqual((html.match(/>Einnahmen und Ausgaben<\/th>/g) || []).length, 1, 'Gerechneter Replay hat genau einen Geldblock');
    }
    const sweep = runSweepChunk({ baseInputs: janLena, paramCombinations: [{ liquidityRunwayYears: 5 }],
        sweepConfig: { anzahlRuns: 1, maxDauer: 6, blockSize: 3, seed: 3, methode: 'regime_markov', rngMode: 'per-run-seed' }, engine: EngineAPI });
    assertEqual(sweep.results[0].metrics.comparison.runCount, 1, 'Sweep mit denselben Zuflüssen läuft');
    let candidateInputs;
    await evaluateCandidate({ liquidityRunwayYears: 5 }, janLena, 1, 6, [12345], null, null, {
        runMonteCarlo: async request => { candidateInputs = request.inputs; return runMonteCarloAutoOptimize(request); } });
    same(candidateInputs.plannedInflows, janLena.plannedInflows, 'Auto-Optimize reicht persönliche Zuflüsse an seine Rechnung weiter');
} finally {
    setAppTestDate(null); Object.assign(globalThis, previous); P.resetPersistenceRuntimeForTests();
}
