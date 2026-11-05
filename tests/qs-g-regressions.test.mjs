import { balanceStorageFixture, recordStorage } from './helpers/balance-storage-fixtures.mjs';
import { createBalancePageFixture } from './helpers/balance-page-fixture.mjs';
import { PLANNED_EXPENSES_KEY, savePlannedExpenses } from '../app/profile/household-planned-expenses.js';
import { planScope, PLAN_DEFAULTS } from '../app/profile/household-plan.js';
import { buildAnnualPlanRecord, ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { importExpenses, requestExpensesPreview } from '../app/balance/balance-expenses-import.js';
import { EXPENSES_STORAGE_KEY, loadExpensesStore, loadExpensesStoreResult, saveExpensesStore } from '../app/balance/balance-expenses-storage.js';
import { computeBudgetSpent } from '../app/balance/balance-expenses-metrics.js';
import { projectOverview, projectAnnualClosePreparation, projectFocusExpenses, projectOverviewYear } from '../app/overview/overview-model.js';
import { projectExpenses } from '../app/expenses/expenses-model.js';
import { sourceFingerprint } from '../app/overview/overview-simulation-summary.js';
import { summaryEntryKey, OVERVIEW_SUMMARY_KEY } from '../app/overview/overview-storage.js';
import { projectHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { setAppTestDate, getAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState, prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { simulateAccumulationYear } from '../app/simulator/simulator-accumulation-year.js';
import { validateSimulatorInputs } from '../app/simulator/simulator-input-validation.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';

const once = { id: 'auto', monat: '2026-04', betrag: 25000, bezeichnung: 'Auto' };
function planned(fixture, items) {
    fixture.records[PLANNED_EXPENSES_KEY] = JSON.stringify({ version: 1, entries: { [fixture.scope.key]: { scope: fixture.scope, items } } });
    return fixture;
}
async function backend(records) {
    const values = new Map(Object.entries(records));
    P.resetPersistenceForTests({ name: 'QS-G', async loadAll() { return Object.fromEntries(values); },
        async saveBatch({ upserts, deletes }) { deletes.forEach(key => values.delete(key)); upserts.forEach(([key, value]) => values.set(key, value)); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return values;
}
const target = text => ({ year: 2026, month: 4, profileId: 'muster_a', text: async () => text });
const options = { storage: persistenceStorage, controller: null, win: null, now: () => new Date('2026-10-27T12:00:00Z') };
const record = amount => ({ categories: { Alltag: amount } });
const storeWith = months => ({ version: 1, activeYear: 2026, years: { 2026: { months } } });

async function finding1() {
    const fixture = planned(balanceStorageFixture('Einzelprofil'), [once]);
    await backend(fixture.records);
    const csv = 'Kategorie;Betrag\nAuto;-25000\nAlltag;-1200';
    await importExpenses({ ...options, targets: [target(csv)], confirm: async targets => { targets[0].plannedExpenseChoices[0].selected = true; return true; } });
    await savePlannedExpenses({ scope: fixture.scope, items: [], storage: persistenceStorage });
    const previous = persistenceStorage.getItem(EXPENSES_STORAGE_KEY);
    const cancel = await importExpenses({ ...options, targets: [target(csv)], confirm: async () => false });
    assertEqual(cancel.status, 'cancelled', 'QS-G 1: Abbruch bleibt ohne Änderung');
    assertEqual(persistenceStorage.getItem(EXPENSES_STORAGE_KEY), previous, 'QS-G 1: Abbruch erhält Zahlungsnachweis bytegleich');
    const result = await importExpenses({ ...options, targets: [target(csv)], confirm: async targets => {
        assertEqual(targets[0].plannedExpenseChoices.length, 1, 'QS-G 1: gelöschter Planposten bleibt bestätigbar');
        assert(targets[0].plannedExpenseChoices[0].selected, 'QS-G 1: vorhandener Nachweis bleibt ausgewählt'); return true;
    } });
    assertEqual(result.status, 'saved', 'QS-G 1: identischer Reimport gespeichert');
    const read = () => loadExpensesStore(persistenceStorage).years[2026].months[4].profiles.muster_a;
    assertEqual(computeBudgetSpent(read()).spent, 1200, 'QS-G 1: Budgetverbrauch bleibt 1.200 Euro');
    await importExpenses({ ...options, targets: [target(csv)], confirm: async targets => { targets[0].plannedExpenseChoices[0].selected = false; return true; } });
    assertEqual(computeBudgetSpent(read()).spent, 26200, 'QS-G 1: ausdrückliches Abwählen entfernt den Nachweis');
}

async function finding3() {
    const fixture = balanceStorageFixture('Einzelprofil');
    const registry = JSON.parse(fixture.records.rs_profiles_v1), scope = fixture.scope;
    const context = { registry, activeId: 'muster_a', liveData: fixture.records, scope, kind: 'balance' };
    const first = sourceFingerprint(context);
    const input = () => buildBalanceEngineInputFromStorage({ storage: recordStorage(fixture.records), scope, referenceYear: 2026 });
    const plain = input(), plainResult = EngineAPI.simulateSingleYear(plain.engineInput, plain.engineLastState);
    planned(fixture, [{ ...once, betrag: 100000 }]);
    const second = sourceFingerprint(context), extra = input(), result = EngineAPI.simulateSingleYear(extra.engineInput, extra.engineLastState);
    assertEqual(result.ui.zielLiquiditaet - plainResult.ui.zielLiquiditaet, 100000, 'QS-G 3: Planposten verändert das Liquiditätsziel um 100.000 Euro');
    assert(first && second && first !== second, 'QS-G 3: Planänderung macht Fingerabdruck ungleich');
    const preview = { year: 2026, scope, createdAt: '2026-10-27T12:00:00Z', monthlyBudget: 1000,
        actionBasis: { fingerprintVersion: 1, sourceFingerprint: first } };
    assertEqual(projectHouseholdPlanComparison({ year: 2026, scope, storage: recordStorage(fixture.records), preview,
        sourceFingerprint: second, now: new Date('2026-10-27T12:00:00Z') }).previewStatus, 'stale', 'QS-G 3: alte Verkaufsvorschau wird veraltet');
    fixture.records[EXPENSES_STORAGE_KEY] = JSON.stringify(storeWith({ 4: { profiles: { muster_a: { categories: { Auto: -100000 },
        plannedExpenses: [{ id: 'auto', month: '2026-04', label: 'Auto', amount: 100000, scopeKey: scope.key }] } } } }));
    const paid = sourceFingerprint(context);
    assert(paid && paid !== second, 'QS-G 3: Zahlungsstatus verändert den Fingerabdruck');
    planned(fixture, [{ ...once, betrag: 100000, priceYear: 2025 }]);
    assert(sourceFingerprint(context) !== paid, 'QS-G 3: Preisbasis wird berücksichtigt');
}

async function finding4() {
    const fixture = balanceStorageFixture('Einzelprofil'), scope = fixture.scope, now = new Date('2027-01-05T12:00:00Z');
    const summary = { year: 2026, scope, monthlyBudget: 2000, monthlyWithdrawal: 2000, createdAt: '2026-10-27T12:00:00Z' };
    fixture.records[OVERVIEW_SUMMARY_KEY] = JSON.stringify({ version: 1, entries: { [summaryEntryKey(2026, scope)]: summary } });
    const outcome = { monthlyWithdrawal: 1500, monthlyBudget: 1500, liquidityBefore: 70, liquidityAfter: 80,
        flexRate: 100, marketPhase: 'Normal', action: { type: 'NONE', title: 'Keine Transaktion' } };
    fixture.records[ANNUAL_PLAN_RECORD_KEY] = buildAnnualPlanRecord(null, { targetYear: 2025, scope,
        committedAt: '2026-01-02T12:00:00Z', recommended: outcome,
        adopted: { ...outcome, snapshot: { plan: structuredClone(PLAN_DEFAULTS), inflation: 2, ageByPerson: { muster_a: 67 } } } }).raw;
    const store = storeWith(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, { profiles: { muster_a: record(-1800) } }])));
    fixture.records[EXPENSES_STORAGE_KEY] = JSON.stringify(store);
    const project = () => projectOverview({ registry: JSON.parse(fixture.records.rs_profiles_v1), activeId: 'muster_a', liveData: fixture.records, now, balanceSingleFallback: true });
    const model = project();
    assertEqual(model.annual.budget, 1500, 'QS-G 4: Übersicht liest den Jahresbeleg');
    const prepared = projectAnnualClosePreparation(model, { store, annualBudgetSummary: summary });
    assertEqual(prepared.annual.budget, 1500, 'QS-G 4: Abschlussdialog behält den Jahresbeleg');
    assertEqual(prepared.annual.total - prepared.annual.budget * 12, 3600, 'QS-G 4: 3.600 Euro Jahresüberschreitung');
    assertEqual(prepared.annual.budgetStatus, 'adopted', 'QS-G 4: Beschluss bleibt als Quelle sichtbar');
    now.setMonth(1);
    const state = JSON.parse(fixture.records[CONFIG.STORAGE.LS_KEY]);
    state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2026', pendingCommit: null };
    fixture.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    const later = projectAnnualClosePreparation(project(), { store, annualBudgetSummary: summary });
    assertEqual(later.annual.budget, 1500, 'QS-G 4: nach Januar liest der Jahresrückblick weiterhin den Vorjahresbeleg');
    fixture.records[ANNUAL_PLAN_RECORD_KEY] = '{broken';
    const invalid = projectAnnualClosePreparation(project(), { store, annualBudgetSummary: summary });
    assertEqual(invalid.annual.budget, null, 'QS-G 4: beschädigter Beleg erlaubt keinen Vorschaufallback');
    assertEqual(invalid.annual.budgetStatus, 'invalid', 'QS-G 4: beschädigter Beleg bleibt ausdrücklich ungültig');
}

async function finding5() {
    const people = [{ id: 'a' }, { id: 'b' }], scope = planScope('household', ['a', 'b']), now = new Date('2026-03-05T12:00:00Z');
    const store = storeWith({ 1: { profiles: { a: record(-1000), b: record(-1000) } }, 2: { profiles: { a: record(-1000) } } });
    const expenses = projectExpenses({ store, year: 2026, people, now });
    const overview = projectOverviewYear({ store, scope, now });
    assertEqual(overview.forecast, 24000, 'QS-G 5: Übersicht verwendet vollständigen Januar');
    assertEqual(expenses.stats.annualForecast, overview.forecast, 'QS-G 5: Teilimport und laufender Monat verändern die Hochrechnung nicht');
    assertEqual(expenses.stats.annualUsed, 3000, 'QS-G 5: bekannte Teilausgaben bleiben in Istsumme');
    store.years[2026].months[3] = { profiles: { a: record(-9000), b: record(-9000) } };
    assertEqual(projectExpenses({ store, year: 2026, people, now }).stats.annualForecast, 24000, 'QS-G 5: laufender Monat bleibt außerhalb der Hochrechnung');
    const noFull = projectExpenses({ store: storeWith({ 2: { profiles: { a: record(-1000) } } }), year: 2026, people, now });
    assertEqual(noFull.stats.annualForecast, 0, 'QS-G 5: ohne vollständigen Monat keine Hochrechnung');
}

async function finding6() {
    const fixture = createBalancePageFixture({ storage: recordStorage({}), url: 'http://localhost/Ausgaben.html' });
    const create = fixture.doc.createElement.bind(fixture.doc);
    fixture.doc.createElement = tag => { const node = create(tag); if (tag === 'dialog') {
        node.showModal = () => { node.open = true; }; node.close = () => { node.open = false; };
    } return node; };
    const walk = node => [node, ...node.children.flatMap(walk)];
    try {
        for (const changeFocus of [false, true]) {
            const choice = { id: 'plan', label: 'Plan', month: '2026-04', scopeKey: 'synthetisch', selected: true, amount: 125 * 1.025 };
            const preview = requestExpensesPreview([{ categories: { Alltag: -228.13 }, total: 228.13, plannedExpenseChoices: [choice] }], { doc: fixture.doc });
            const dialog = fixture.doc.getElementById('expensesImportPreview');
            const amount = walk(dialog).find(node => node.tagName === 'INPUT' && node.type === 'text');
            if (changeFocus) { amount.dispatchEvent({ type: 'focus' }); amount.dispatchEvent({ type: 'blur' }); }
            walk(dialog).find(node => Object.hasOwn(node.dataset, 'expensesPreviewAccept')).dispatchEvent({ type: 'click' });
            const accepted = !dialog.open;
            if (!accepted) walk(dialog).find(node => Object.hasOwn(node.dataset, 'expensesPreviewCancel')).dispatchEvent({ type: 'click' });
            await preview;
            assert(accepted, 'QS-G 6: unveränderte Bestätigung bleibt ohne Summenfehler');
            assertClose(choice.amount, 128.125, 1e-10, 'QS-G 6: Vorschlag behält den Dezimalwert ohne stille Rundung');
        }
    } finally { fixture.restore(); }
}

async function finding7() {
    const fixture = balanceStorageFixture('Einzelprofil');
    const store = storeWith({ 4: { profiles: { muster_a: record('-1000') } } });
    fixture.records[EXPENSES_STORAGE_KEY] = JSON.stringify(store);
    assert(validatePersistenceDomainRecords(fixture.records).ok, 'QS-G 7: Altstand mit Zahlenstrings bleibt gültig');
    assertEqual(loadExpensesStoreResult(recordStorage(fixture.records)).status, 'ok', 'QS-G 7: Store bleibt lesbar');
    const focus = projectFocusExpenses(store, fixture.scope, 2026, 4);
    const view = projectExpenses({ store, year: 2026, people: [{ id: 'muster_a' }], now: new Date('2026-05-05') });
    assertEqual(focus.complete, view.months[3].complete, 'QS-G 7: Abschluss und Ausgabenseite erkennen denselben Import');
    assertEqual(focus.spent, 1000, 'QS-G 7: Abschluss liest 1.000 Euro aus Zahlenstring');
    for (const amount of [null, false, 'kaputt', Infinity]) assertEqual(projectFocusExpenses(storeWith({ 4: { profiles: { muster_a: record(amount) } } }), fixture.scope, 2026, 4).complete, false, 'QS-G 7: ungültiger Wert wird nicht zu einem Nullimport');
}

async function finding8() {
    const person = { profile_person_schema_version: '1', profile_geburtsdatum: '1960-01-01', profile_geschlecht: 'w', profile_tagesgeld: '200000', sim_simStartVermoegen: '200000' };
    const inputs = { ...buildSimulatorInputsFromProfileData(person, { referenceYear: 2026, planValues: null }),
        accumulationPhase: { enabled: true, sparrate: 1000, sparrateIndexing: 'none' }, transitionYear: 1,
        startFloorBedarf: 12000, startFlexBedarf: 6000, minimumFlexAnnual: 0, dynamicFlex: false, healthBucket: { enabled: false } };
    prepareHistoricalDataOnce();
    const data = { jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0 };
    const plain = simulateOneYear(initMcRunState(inputs, 0), inputs, data, 0, null, 0, null, 1, EngineAPI);
    assertEqual(portfolioTotal(plain.newState.portfolio), 212000, 'QS-G 8: bisheriger Ansparpfad ohne Ausgabe bleibt erhalten');
    const combined = { ...inputs, plannedExpensesReferenceYear: 2026, plannedExpenses: [once] };
    let validation; try { validateSimulatorInputs(combined); } catch (error) { validation = error; }
    assertEqual(validation?.name, 'SimulatorValidationError', 'QS-G 8: nicht unterstützte Kombination wird ausdrücklich abgelehnt');
    const state = initMcRunState(inputs, 0), bytes = JSON.stringify(state);
    const result = simulateOneYear(state, combined, data, 0, null, 0, null, 1, EngineAPI);
    assertEqual(result.kind, 'technical_error', 'QS-G 8: direkter Jahreseinstieg kann Ausgaben nicht verschlucken');
    assertEqual(JSON.stringify(state), bytes, 'QS-G 8: Ablehnung verändert keinen Jahreszustand');
    let direct; try { simulateAccumulationYear({ currentState: state, inputs: combined, yearData: data, portfolio: state.portfolio, yearIndex: 0 }); } catch (error) { direct = error; }
    assertEqual(direct?.name, 'SimulatorValidationError', 'QS-G 8: auch direkter Ansparhelfer lehnt ausdrücklich ab');
}

async function finding9() {
    const fixture = balanceStorageFixture('Einzelprofil');
    fixture.records[EXPENSES_STORAGE_KEY] = JSON.stringify(storeWith({ 4: { profiles: { muster_a: record(-1200) } } }));
    await backend(fixture.records);
    const before = persistenceStorage.getItem(EXPENSES_STORAGE_KEY), huge = '1' + '0'.repeat(308);
    for (const csv of [`Kategorie;Betrag\nAlltag;${huge}\nAlltag;${huge}`, `Kategorie;Betrag\nA;${huge}\nB;${huge}`]) {
        let error, previews = 0;
        try { await importExpenses({ ...options, targets: [target(csv)], confirm: async () => { previews++; return true; } }); } catch (failure) { error = failure; }
        assert(error, 'QS-G 9: Kategorien- oder Gesamtsummenüberlauf bricht Import ab');
        assertEqual(previews, 0, 'QS-G 9: nicht endliche Summen erreichen keine Vorschau');
        assertEqual(persistenceStorage.getItem(EXPENSES_STORAGE_KEY), before, 'QS-G 9: gültiger Monatsrecord bleibt bytegleich');
    }
    let failure; try { saveExpensesStore(storeWith({ 4: { profiles: { muster_a: record(Infinity) } } }), persistenceStorage); } catch (error) { failure = error; }
    assert(failure, 'QS-G 9: Saver weist nicht endliche Werte vor JSON-Konvertierung ab');
    assertEqual(persistenceStorage.getItem(EXPENSES_STORAGE_KEY), before, 'QS-G 9: fehlgeschlagener Direktwrite erhält Bestand');
}

const savedDate = getAppTestDate(), failures = [];
try {
    setAppTestDate('2026-10-27');
    for (const check of [finding1, finding3, finding4, finding5, finding6, finding7, finding8, finding9]) {
        if (process.env.QSG_CASE && check.name !== `finding${process.env.QSG_CASE}`) continue;
        try { await check(); } catch (error) { console.error(check.name, String(error.message).slice(0, 220)); failures.push(error); }
        finally { P.resetPersistenceForTests(); }
    }
} finally { setAppTestDate(savedDate); }
if (failures.length) throw failures[0];
