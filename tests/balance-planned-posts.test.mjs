import { readVF2DReferences } from './helpers/vf-2d-expectations.mjs';
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { readAN1Hash } from './helpers/an-1-expectations.mjs';
import { readFileSync } from 'node:fs';
import { readNR1Hash } from './helpers/nr-1-expectations.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { balanceMeasurement, hash } from './helpers/ga-1b-measurement.mjs';
import { balanceStorageFixture, recordStorage, annualTestMarketData, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { computeAnnualPlanUpdate, captureAnnualRecords, annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { evaluateAnnualDraft, prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { buildPlanRecord, HOUSEHOLD_PLAN_KEY, planScope } from '../app/profile/household-plan.js';
import { PLANNED_EXPENSES_KEY, plannedExpensesForYear } from '../app/profile/household-planned-expenses.js';
import { INCOME_KEY, writeIncome } from '../app/profile/profile-income.js';
import { plannedExpenseImportChoices, readBalancePlannedPosts } from '../app/balance/balance-planned-posts.js';
import { computeBudgetSpent, computeSpent, computeYearStats } from '../app/balance/balance-expenses-metrics.js';
import { projectFocusExpenses } from '../app/overview/overview-model.js';
import { projectExpenses } from '../app/expenses/expenses-model.js';
import { loadExpensesStore, loadExpensesStoreResult, EXPENSES_STORAGE_KEY } from '../app/balance/balance-expenses-storage.js';
import { importExpenses } from '../app/balance/balance-expenses-import.js';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { setAppTestDate, getAppTestDate } from '../app/shared/app-clock.js';
import { validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { createPlannedPostsView } from '../app/balance/balance-planned-posts-renderer.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState, prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { buildPlanOverview } from '../app/simulator/simulator-plan-overview.js';
import { buildInputsCtxFromPortfolio } from '../app/simulator/simulator-portfolio-tranches.js';

const saved = getAppTestDate();
const same = (a, b, label) => assertEqual(JSON.stringify(a), JSON.stringify(b), label);
const close = (a, b, label) => assertClose(a, b, 1e-6, label);
const once = { id: 'auto', monat: '2026-04', betrag: 25000, bezeichnung: 'Auto' };
const fixed = { id: 'kredit', bezeichnung: 'Kredit', betragMonat: 450, ab: '2026-10', bis: '2027-03', anpassung: 'inflation' };
function withPlan(fixture, items) {
    fixture.records[PLANNED_EXPENSES_KEY] = JSON.stringify({ version: 1, entries: { [fixture.scope.key]: { scope: fixture.scope, items } } });
    return fixture;
}
function read(fixture, year = 2026) { return buildBalanceEngineInputFromStorage({ storage: recordStorage(fixture.records), scope: fixture.scope, referenceYear: year }); }
function simulate(calc) {
    const result = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState);
    if (result.error) throw result.error;
    return result;
}
try {
    setAppTestDate('2026-10-21');
    const before = JSON.parse(readFileSync(new URL('./fixtures/ga-1b-balance-parity.json', import.meta.url)));
    const priorResults = readGL1References(before.map(row => ({ ...row, result: readAN1Hash(readNR1Hash(row.result)) })));
    // Nur Drei Töpfe: FR-63 ergänzt die Anleihenpriorität und sperrt Bärenauffüllungen.
    const threeBucketHashes = {
        d58f618bcf7e55ae4362d963badc4936acae514821da005ca4e3f04973c9048e: 'c827601100d06cf4d5ec79163501d7b232f13dbaa268da22528ac2cdd4e8cd79',
        '3461649b6c0a20d888fc057aa02d6a406a7eb8667bf271d2cfa19f212f950724': 'ace8d2b667bd58acfaeb760af9d289435d6775c751edf46b209b6b7a74995e70',
        baeb3b12ca056c1464194efd581fc66492a3ac67106c89247a4c1148e3ef3d0e: '5bd7771d37b3dfb12c70cc54be5c5103ce40ec812513d340601eda912ae1b51a'
    };
    same(balanceMeasurement(), priorResults.map(row => ({ ...row,
        result: row.strategy === '3_bucket_jilge' ? readVF2DReferences(threeBucketHashes[row.result]) : row.result })),
        'Ohne geplante Posten: Standard bytegleich; vollständige Drei-Töpfe-Ergebnisse nach FR-63');
    assertEqual(hash(before), '4c821e638a2dcfd17f1483c1358d0bd883a33cf0cdc3ab691cf37737ba9f846b', 'Prüfsummenbestand stammt vom Ausgangsstand');
    for (const strategy of ['standard', '3_bucket_jilge']) {
        const fixture = balanceStorageFixture('Einzelprofil', strategy);
        const plain = simulate(read(fixture));
        withPlan(fixture, [fixed, once]);
        const calc = read(fixture), result = simulate(calc);
        close(calc.inputData.plannedExpenseLiquidityReserve, 26350, 'Nur drei Kreditmonate und die einmalige Zahlung im Planjahr');
        close(result.ui.zielLiquiditaet - plain.ui.zielLiquiditaet, 26350, 'Reserve erhöht das Ziel genau um die geplanten Ausgaben, ohne Reichweitenfaktor');
        same(result.ui.spending, plain.ui.spending, 'Grundbedarf, Flex, Monatsentnahme und Rundung bleiben vollständig unverändert');
        for (const key of ['alarmActive', 'entnahmequote']) same(result.diagnosis.general?.[key], plain.diagnosis.general?.[key], `${key} bleibt unverändert`);
        same(result.newState, plain.newState, 'Reserve ändert keine Budget-, Kürzungs- oder Entnahmehistorie');
        assertEqual(calc.inputData.floorBedarf, read(balanceStorageFixture('Einzelprofil', strategy)).inputData.floorBedarf, 'Grundbedarf im Reader unverändert');
        assert(result.ui.action.type === 'TRANSACTION', 'Verkauf stellt Liquidität rechtzeitig bereit');
        assert(result.ui.action.steuer >= 0, 'Zusätzliche Finanzierung verwendet die vorhandene Verkaufssteuer');
    }
    {
        const fixture = withPlan(balanceStorageFixture('Einzelprofil'), [{ ...once, monat: '2027-01' }]);
        same(simulate(read(fixture)), simulate(read(balanceStorageFixture('Einzelprofil'))), 'Nur künftige Ausgabe: aktuelles Jahr vollständig bytegleich');
        const calc = read(fixture);
        const registry = JSON.parse(fixture.records.rs_profiles_v1);
        const incomes = writeIncome([{ id: 'erbe', monat: '2026-12', bezeichnung: 'Erbe', betrag: 80000 }]);
        fixture.records[INCOME_KEY] = registry.profiles.muster_a.data[INCOME_KEY] = incomes;
        fixture.records.rs_profiles_v1 = JSON.stringify(registry);
        const pending = read(fixture), result = simulate(pending), plain = simulate(calc);
        same(result.ui.spending, plain.ui.spending, 'Vor Eingang keine Wirkung einer einmaligen Einkunft auf das Budget');
        close(result.ui.zielLiquiditaet, plain.ui.zielLiquiditaet, 'Künftige Einkunft deckt keine Liquiditätslücke im Voraus');
        close(pending.inputData.tagesgeld, calc.inputData.tagesgeld, 'Geplanter Eingang wird nicht aufs Tagesgeld gebucht');
        assert(pending.inputData.plannedPosts.items.some(item => item.kind === 'income' && item.month === '2026-12'), 'Überblick enthält Einkunft mit Zahlungsmonat');
        fixture.records.profile_tagesgeld = registry.profiles.muster_a.data.profile_tagesgeld = String(calc.inputData.tagesgeld + 80000);
        fixture.records.rs_profiles_v1 = JSON.stringify(registry);
        const received = read(fixture);
        close(received.inputData.tagesgeld, calc.inputData.tagesgeld + 80000, 'Eingang zählt genau einmal über den bestätigten Istbestand');
        close(simulate(received).ui.zielLiquiditaet, plain.ui.zielLiquiditaet, 'Einmalige Einkunft bleibt außerhalb des Budgetbedarfs');
    }
    // Zwingende Finanzierung auch bei kleinem Betrag, Bär und leeren Anleihen.
    const input = { ...read(balanceStorageFixture('Einzelprofil')).engineInput, dynamicFlex: false, tagesgeld: 0, geldmarktEtf: 0,
        detailledTranches: null, depotwertAlt: 0, depotwertNeu: 200000, costBasisNeu: 100000,
        goldAktiv: false, maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 0, renteAktiv: false,
        floorBedarf: 12000, flexBedarf: 6000, minimumFlexAnnual: 0, inflation: 0,
        endeVJ: 60, endeVJ_1: 100, endeVJ_2: 100, ath: 100, jahreSeitAth: 1 };
    for (const mode of ['standard', '3_bucket_jilge']) {
        const own = { ...input, decumulation: { mode, bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null } };
        const plain = EngineAPI.simulateSingleYear(own);
        const extra = EngineAPI.simulateSingleYear({ ...own, plannedExpenseLiquidityReserve: 35000 });
        if (extra.error) throw extra.error;
        same(extra.ui.spending, plain.ui.spending, `${mode}: Bär ändert die Budgetentscheidung nicht`);
        if (mode === '3_bucket_jilge') close(extra.ui.action.nettoErlös, 35000, 'Bär ohne Anleihen: Nur die Ausgabe wird aus Aktien finanziert');
        else assert(extra.ui.action.verwendungen.liquiditaet >= extra.ui.zielLiquiditaet - .01, 'Standard deckt die ganze Reserve');
        assert(extra.ui.action.steuer > 0, `${mode}: Finanzierung berücksichtigt Verkaufssteuern`);
    }
    for (const bad of [-1, Infinity, NaN, '10']) assert(EngineAPI.simulateSingleYear({ ...input, plannedExpenseLiquidityReserve: bad }).error, 'Ungültiger Reservezuschlag wird validiert');
    {
        const fixture = withPlan(balanceStorageFixture('Muster-Haushalt'), [fixed, once]);
        fixture.records[EXPENSES_STORAGE_KEY] = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
        // Echter Importweg mit gemeinsamem Haushalt und Zuordnung bei einer Person.
        const backend = new Map(Object.entries(fixture.records));
        P.resetPersistenceForTests({ name: 'GA-1b', async loadAll() { return Object.fromEntries(backend); },
            async saveBatch({ upserts, deletes }) { deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, value]) => backend.set(key, value)); } });
        await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const target = id => ({ year: 2026, month: 4, profileId: id, text: async () => 'Kategorie;Betrag\nAuto;-25000\nAlltag;-1200' });
        const options = { storage: persistenceStorage, controller: null, now: () => new Date('2026-10-21T12:00:00Z'), win: null };
        const cancelled = await importExpenses({ ...options, targets: [target('muster_a')], confirm: async () => false });
        assertEqual(cancelled.status, 'cancelled', 'Abbruch schreibt keine Zuordnung');
        assert(!persistenceStorage.getItem(EXPENSES_STORAGE_KEY)?.includes('plannedExpenses'), 'Abbruch hinterlässt keine Zahlungsmarkierung');
        const imported = await importExpenses({ ...options, targets: [target('muster_a')], confirm: async targets => {
            assertEqual(targets[0].plannedExpenseChoices[0].selected, false, 'Neue Zuordnung verlangt ausdrückliche Bestätigung');
            targets[0].plannedExpenseChoices[0].selected = true; return true;
        } });
        assertEqual(imported.status, 'saved', 'Bestätigte Zahlung wird im gemeinsamen Import gespeichert');
        const store = loadExpensesStore(persistenceStorage), entry = store.years[2026].months[4].profiles.muster_a;
        close(computeSpent(entry.categories).spent, 26200, 'Rohsumme für tatsächlichen Kontostand bleibt vollständig');
        close(computeBudgetSpent(entry).spent, 1200, 'Auto zählt nicht als Monatsüberschreitung');
        close(computeYearStats({ yearData: store.years[2026] }).annualUsed, 1200, 'Jahresbudgetvergleich zieht geplante Zahlung ebenfalls ab');
        close(projectFocusExpenses(store, planScope('single', ['muster_a']), 2026, 4).spent, 1200, 'Monatsabschluss prüft nur den laufenden Bedarf');
        const view = projectExpenses({ store, year: 2026, people: [{ id: 'muster_a' }], budget: { monthly: 1200 }, now: new Date('2026-10-21') });
        close(view.stats.annualUsed, 1200, 'Ausgabenseite verwendet dieselbe Abgrenzung');
        const posts = readBalancePlannedPosts({ storage: persistenceStorage, scope: fixture.scope, year: 2026, people: [] });
        close(posts.reserve, 1350, 'Haushaltsreserve zählt bezahltes Auto unabhängig vom Zahlenden nicht doppelt');
        assert(posts.items.find(item => item.id === 'auto').paid, 'Überblick zeigt den Zahlungsnachweis');
        assertEqual(plannedExpenseImportChoices({ storage: persistenceStorage, scope: fixture.scope, year: 2026, month: 4, profileId: 'muster_b', store }).length, 0, 'Zweite Person kann dieselbe Zahlung nicht nochmals zuordnen');
        const reimport = await importExpenses({ ...options, targets: [target('muster_a')], confirm: async targets => {
            assert(targets[0].plannedExpenseChoices[0].selected, 'Reimport bewahrt die eigene vorherige Zuordnung als bestätigbaren Vorschlag'); return true;
        } });
        assertEqual(reimport.status, 'saved', 'Reimport ersetzt Zahlung statt sie zu addieren');
        close(readBalancePlannedPosts({ storage: persistenceStorage, scope: fixture.scope, year: 2026, people: [] }).reserve, 1350, 'Reimport verändert den offenen Betrag nicht');
        const raw = persistenceStorage.getItem(EXPENSES_STORAGE_KEY), bad = JSON.parse(raw);
        bad.years[2026].months[4].profiles.muster_b = structuredClone(entry);
        assertEqual(loadExpensesStoreResult({ getItem: () => JSON.stringify(bad) }).status, 'corrupt', 'Doppelte Zahlung wird beim Lesen und Wiederherstellen abgewiesen');
        const records = Object.fromEntries(backend);
        const validation = validatePersistenceDomainRecords(records);
        assert(validation.ok, 'Sicherung/Import akzeptiert bestätigte Zahlungszuordnungen');
        const singleScope = planScope('single', ['muster_a']);
        const foreign = readBalancePlannedPosts({ storage: persistenceStorage, scope: singleScope, year: 2026, people: [] });
        assertEqual(foreign, null, 'Haushaltsausgaben werden nicht in einen Einzelbereich kopiert');
        P.resetPersistenceForTests();
    }
    {
        const fixture = withPlan(balanceStorageFixture('Einzelprofil'), [fixed, { ...once, monat: '2027-04' }]);
        const state = JSON.parse(fixture.records[CONFIG.STORAGE.LS_KEY]);
        state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'synthetisch', phase: 'writes_started' } };
        fixture.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        fixture.records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
        const source = recordStorage(fixture.records);
        assert(captureAnnualRecords(source)[PLANNED_EXPENSES_KEY], 'Jahresvorbereitung erfasst den Haushaltsplan auch mit rein lesendem Adapter');
        const draft = computeAnnualPlanUpdate({ storage: source, scope: fixture.scope, targetYear: 2026, marketData: annualTestMarketData, now: annualTestNow });
        const result = evaluateAnnualDraft(draft, { engineApi: EngineAPI, now: annualTestNow });
        close(result.inputData.plannedExpenseLiquidityReserve, 26350 * (1 + annualTestMarketData.inflation.rate / 100), 'Neuer Beschluss enthält nur Januar bis März und einmalige Ausgabe des neuen Jahres');
        assertEqual(result.outcome.plannedPosts.year, 2027, 'Einmalige Posten gehen mit dem neuen Planjahr in den Beschluss ein');
        const prepared = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now: annualTestNow });
        same(prepared.receipt.adopted.plannedPosts, result.outcome.plannedPosts, 'Festgeschriebener Jahresbeleg bewahrt die vollständige Monatsliste');
        same(JSON.parse(fixture.records[PLANNED_EXPENSES_KEY]), JSON.parse(draft.records[PLANNED_EXPENSES_KEY]), 'Jahresabschluss verändert keine ursprünglichen Ausgabepläne');
        const paidRecords = { ...draft.records, [EXPENSES_STORAGE_KEY]: JSON.stringify({ version: 1, activeYear: 2027,
            years: { 2027: { months: { 4: { profiles: { muster_a: { categories: { Auto: -25000 },
                plannedExpenses: [{ id: 'auto', month: '2027-04', label: 'Auto', amount: 25000, scopeKey: fixture.scope.key }] } } } } } } }) };
        const paid = evaluateAnnualDraft({ ...draft, records: paidRecords }, { engineApi: EngineAPI, now: annualTestNow });
        close(paid.inputData.plannedExpenseLiquidityReserve, 1350 * (1 + annualTestMarketData.inflation.rate / 100), 'Schon bezahlter Einmalposten des neuen Jahres wird im Beschluss nicht doppelt reserviert');
        close(paid.monthlyBudget, result.monthlyBudget, 'Bestätigte Zahlung ändert das neue Monatsbudget nicht');
        assert(paid.outcome.plannedPosts.items.find(item => item.id === 'auto').paid, 'Neuer Beschluss bewahrt den Zahlungsstatus');
    }
    {
        const person = { profile_person_schema_version: '1', profile_geburtsdatum: '1960-01-01', profile_geschlecht: 'w', profile_rentenbeginn: '2026-01-01',
            profile_rente_monatlich: '0', profile_rentenanpassung_art: 'fix', profile_rentenanpassung_pct: '0', profile_tagesgeld: '200000', sim_simStartVermoegen: '200000' };
        const single = buildSimulatorInputsFromProfileData(person, { referenceYear: 2026, planValues: null });
        const combined = combineSimulatorProfiles([{ profileId: 'max', inputs: single }], 'max', { planValues: null }).combined;
        const inputs = { ...combined, startFloorBedarf: 12000, startFlexBedarf: 6000, minimumFlexAnnual: 0, dynamicFlex: false, maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 0,
            goldAktiv: false, pflegefallLogikAktivieren: false, healthBucket: { enabled: false }, plannedExpenses: [fixed, once], plannedExpensesReferenceYear: 2026 };
        prepareHistoricalDataOnce();
        const state = initMcRunState(inputs, 0);
        const balanceInput = buildInputsCtxFromPortfolio(inputs, state.portfolio, { pensionAnnual: 0, marketData: { jahr: 2000, inflation: 0 } });
        const balance = EngineAPI.simulateSingleYear({ ...balanceInput, floorBedarf: 12000, flexBedarf: 6000, plannedExpenseLiquidityReserve: plannedExpensesForYear(inputs.plannedExpenses, 2026) });
        const simulator = simulateOneYear(state, inputs, { jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0 }, 0, null, 0, null, 1, EngineAPI);
        if (balance.error) throw balance.error;
        close(simulator.logData.geplante_ausgaben, 26350, 'Simulator und Balance haben im ersten Jahr denselben Ausgabenbetrag');
        close(balance.ui.spending.monatlicheEntnahme, simulator.ui.spending.monatlicheEntnahme, 'Erstes Jahr: gleiches Monatsbudget bei identischen Jahresannahmen');
        const overview = buildPlanOverview({ inputs, entries: [{ profileId: 'max', data: person }], referenceYear: 2026 });
        close(overview.rows[0].expenses, 26350, 'Simulatorübersicht und Balance zeigen dieselbe Jahressumme');
    }
    {
        const scope = planScope('single', ['a']);
        const fixture = withPlan({ records: {}, scope }, [once]);
        const posts = readBalancePlannedPosts({ storage: recordStorage(fixture.records), scope, year: 2026, people: [{ profileId: 'a', name: 'Max', data: { [INCOME_KEY]: writeIncome([{ id: 'i', monat: '2026-05', betrag: 1000, bezeichnung: 'Erstattung' }]) } }] });
        const doc = { createElement(tag) { return { tag, dataset: {}, children: [], appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); } }; } };
        const root = createPlannedPostsView(doc, posts);
        const text = node => [node.textContent || '', ...node.children.map(text)].join(' ');
        assert(text(root).includes('04.2026') && text(root).includes('−') && text(root).includes('+'), 'Überblick zeigt Monat sowie Plus bei Einkünften und Minus bei Ausgaben');
        assert(text(root).includes('erst nach Eingang'), 'Vorsichtige Behandlung der Einkunft steht direkt bei den Posten');
    }
} finally { P.resetPersistenceForTests(); setAppTestDate(saved); }
