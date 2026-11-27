import { deepEqual, equal, ok } from 'node:assert/strict';
import { computeBudgetSpent, computeHouseholdNeedsStats, computeSpent, computeYearStats, prepareExpensesHistoryMetrics } from '../app/balance/balance-expenses-metrics.js';
import { refreshExpensesTableValues, renderExpensesDetails } from '../app/balance/balance-expenses-renderer.js';
import { renderBalanceExpensesHistory } from '../app/balance/balance-expenses-history-renderer.js';
import { importExpenses, requestExpensesPreview } from '../app/balance/balance-expenses-import.js';
import { EXPENSES_STORAGE_KEY, loadExpensesStoreResult, saveExpensesStore } from '../app/balance/balance-expenses-storage.js';
import { personalCashTargets } from '../app/balance/balance-liquidity-targets.js';
import { projectExpenses } from '../app/expenses/expenses-model.js';
import { projectCategoryNeeds, projectExpenseNeeds } from '../app/expenses/expenses-needs.js';
import { calculateCashProposal } from '../app/overview/overview-cash-proposal.js';
import { projectFocusExpenses, projectOverviewYear } from '../app/overview/overview-model.js';
import { createOverviewStepContent } from '../app/overview/overview-month-confirmation.js';
import { renderOverviewYear } from '../app/overview/overview-renderer.js';
import { overviewScope } from '../app/overview/overview-storage.js';
import { PLANNED_EXPENSES_KEY } from '../app/profile/household-planned-expenses.js';
import { annualNeedSuggestions } from '../app/shared/annual-needs-review.js';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { balanceStorageFixture } from './helpers/balance-storage-fixtures.mjs';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';

const entry = (floor, flex) => ({ categories: { Alltag: floor + flex }, categoryNeeds: { Alltag: { floor, flex } } });
const normal = entry(-600, -400), refund = entry(300, 0);
const makeYear = (...entries) => ({ months: Object.fromEntries(entries.map((record, i) => [i + 1, { profiles: { a: record } }])) });
const makeStore = yearData => ({ version: 1, activeYear: 2026, years: { 2026: yearData } });
const yearData = makeYear(normal, refund), store = makeStore(yearData);
const now = new Date(2026, 2, 1);
const people = [{ id: 'a', name: 'Ada' }];
const scope = overviewScope('single', ['a']);
const payment = { id: 'p', scopeKey: scope.key, month: '2026-02', label: 'Muster', amount: 500 };
const text = element => [element.textContent, ...element.children.map(text)].join(' ');
const cases = [];
const test = (name, run) => cases.push({ name, run });

test('Metrik, Durchschnitt und Hochrechnung', () => {
    equal(computeSpent({ Arzt: 800, Alltag: -500 }).spent, -300);
    const stats = computeYearStats({ yearData });
    deepEqual([stats.annualUsed, stats.monthsWithData, stats.avgMonthly, stats.annualForecast], [700, 2, 350, 4200]);
    deepEqual(computeBudgetSpent({ categories: { Arzt: 800, Alltag: -500 }, plannedExpenses: [payment] }),
        { spent: -800, planned: 500, total: -300 });
});

test('Floor/Flex, Jahresgrenzen und feste Ausgaben im Ist', () => {
    const stats = computeHouseholdNeedsStats({ yearData });
    deepEqual(stats.months.map(({ floor, flex, total }) => [floor, flex, total]), [[600, 400, 1000], [-300, 0, -300]]);
    deepEqual(stats.annualForecast, { floor: 1800, flex: 2400, total: 4200 });
    const needs = projectExpenseNeeds({ yearData, profileIds: ['a'], actualFixedMonths: [100, 300] });
    equal(needs.fixedInActual, 2400);
    const withPayment = makeYear(entry(-100, 0), { ...refund, plannedExpenses: [payment] });
    equal(computeHouseholdNeedsStats({ yearData: withPayment }).annualForecast.floor, 0);
    const separateRefund = makeYear(normal, { categories: { ...refund.categories, NurErstattung: 200 },
        categoryNeeds: { ...refund.categoryNeeds, NurErstattung: { floor: 0, flex: 200 } } });
    deepEqual(computeHouseholdNeedsStats({ yearData: separateRefund }).annualForecast, { floor: 1800, flex: 1200, total: 3000 });
    deepEqual(projectCategoryNeeds(separateRefund, ['a']).categories.get('NurErstattung'), { floor: 0, flex: -200, unallocated: 0 });

    const zeroMonth = makeYear(normal, entry(-50, 50));
    const zeroStats = computeHouseholdNeedsStats({ yearData: zeroMonth });
    equal(zeroStats.monthsWithBreakdown, 1);
    deepEqual(zeroStats.annualForecast, { floor: 7200, flex: 4800, total: 12000 });
});

test('NG-14c: 1.200 Euro Erstattung mindern den Grundbedarf des Jahres über Kategorien hinweg', () => {
    const month = categories => ({ categories, categoryNeeds: Object.fromEntries(Object.entries(categories)
        .map(([name, floor]) => [name, { floor, flex: 0 }])) });
    const monthExpenses = { Lebensmittel: -350, Wohnen: -400 };
    const yearWith = last => makeYear(...Array(3).fill(month(monthExpenses)), month(last));
    const before = yearWith(monthExpenses);
    const after = yearWith({ ...monthExpenses, 'Versicherung Erstattung': 1200 });
    const sameCategory = yearWith({ ...monthExpenses, Wohnen: 800 });
    const annualFloor = data => prepareExpensesHistoryMetrics(makeStore(data), 2026, { includeSegments: true })[0].segments.floor;
    const review = data => projectExpenseNeeds({ yearData: data, profileIds: ['a'], floorPlan: 6000, annualBudget: 9000 });
    equal(annualFloor(after), annualFloor(before) - 1200);
    equal(annualFloor(after), annualFloor(sameCategory));
    equal(review(after).months[3].floor, -450);
    equal(review(after).annualForecast.floor, review(before).annualForecast.floor - 1200 * 12 / 4);
    equal(review(after).annualForecast.floor, review(sameCategory).annualForecast.floor);
    const suggestion = annualNeedSuggestions({ inflation: { rate: 2 } }, { needsReview: review(after) }, 'floorBedarf', 6000);
    deepEqual([suggestion.actual, suggestion.fromActual], [5400, 5508]);
    const negativeYear = yearWith({ ...monthExpenses, 'Versicherung Erstattung': 3500 });
    equal(annualFloor(negativeYear), 0);
    equal(review(negativeYear).annualForecast.floor, 0);
});

test('NG-14c: Die Untergrenze für den Jahres-Grundbedarf gilt je Person', () => {
    const yearData = { months: {
        1: { profiles: { a: entry(-100, 0), b: entry(-400, 0) } },
        2: { profiles: { a: entry(300, 0), b: entry(-400, 0) } }
    } };
    deepEqual(computeHouseholdNeedsStats({ yearData }).annualForecast,
        { floor: 4800, flex: 0, total: 3600 });
});

test('Ausgabenmodell und Kategorien', () => {
    const view = projectExpenses({ store, year: 2026, people, now });
    equal(view.months[1].total, -300);
    equal(view.categories[0].amount, 700);
    deepEqual([view.categories[0].floor, view.categories[0].flex], [300, 400]);
});

test('Monatstabelle', () => {
    const cell = () => ({ textContent: '', classList: { add() {}, remove() {} } });
    const person = cell(), household = cell();
    const host = { querySelector: selector => selector.includes('month="2"') && selector.includes('role="value"') ? person
        : selector.includes('month-total="2"') ? household : null };
    refreshExpensesTableValues({ host, yearData, profileIds: ['a'], monthlyBudget: 0, formatCurrency: String });
    deepEqual([person.textContent, household.textContent], ['-300', '-300']);
});

test('Monatslupe', () => {
    const { doc } = createDialogFixture();
    const refs = { detailDialog: doc.createElement('dialog'), detailBody: doc.createElement('div') };
    const show = options => renderExpensesDetails({ refs, monthName: 'Februar', profileName: 'Ada', doc, ...options });
    show({ ...refund, yearData, profileId: 'a' });
    ok(text(refs.detailBody).includes('−300,00'));
    show({ ...entry(600, 400), yearData: makeYear(entry(600, 400)), profileId: 'a' });
    ok(text(refs.detailBody).includes('1.000,00'));
    ok(!text(refs.detailBody).includes('−1.000,00'));
});

test('Jahresdiagramm und Grenzen der Balken', () => {
    const { doc } = createDialogFixture();
    const chart = doc.createElement('div'), table = doc.createElement('div');
    chart.clientWidth = 1100;
    const negative = makeStore(makeYear(entry(-100, 0), refund));
    const mixed = makeStore(makeYear(normal, { categories: { Erstattung: 1400 } }));
    for (const [data, showNeedsSegments, amount] of [[negative, false, 100], [mixed, true, 1100]]) {
        ok(renderBalanceExpensesHistory({ chart, table, isVisible: () => true, showNeedsSegments }, { status: 'ok', store: data }, 2026, 'test', { year: 2026, amount }));
        const bars = [...chart.innerHTML.matchAll(/<rect class="expenses-year-(?:bar|forecast)[^"]*"[^>]* y="([^"]+)"[^>]* height="([^"]+)"/g)];
        ok(bars.length > 0);
        ok((showNeedsSegments ? /[-−]400/ : /[-−]200/).test(table.innerHTML), table.innerHTML);
        ok(bars.every(([, y, height]) => Number(y) >= 50 && Number(height) >= 0 && Number(y) + Number(height) <= 190 + 1e-9));
    }
});

test('Übersicht und Monatsdiagramm', () => {
    const annual = projectOverviewYear({ store, scope, now });
    deepEqual([annual.months[1].spent, annual.months[1].complete, annual.total, annual.forecast], [-300, true, 700, 4200]);
    const { doc } = createDialogFixture();
    for (const id of ['overviewYear', 'overviewMonthChart', 'overviewYearChart', 'overviewYearMetrics', 'overviewYearNote']) {
        const element = doc.createElement('div'); element.id = id; doc.body.append(element);
    }
    renderOverviewYear(doc, { annual, now });
    const markup = doc.getElementById('overviewYearChart').innerHTML;
    ok(/data-overview-year-month="2"[^>]*title="[^"]*[-−]300[^"]*">\s*<div[^>]*><span[^>]*style="height:0%"/u.test(markup), markup.slice(0, 1200));
});

test('Monatsabschluss und Kategorieansicht', () => {
    const expenses = projectFocusExpenses(store, scope, 2026, 2);
    equal(expenses.spent, -300);
    const { doc } = createDialogFixture();
    const view = createOverviewStepContent({ doc, model: { members: people, expenses }, step: { id: 'expenses' }, status: doc.createElement('p') });
    const rows = view.querySelector('tbody').children;
    for (const row of rows) ok(/[-−]300,00/u.test(row.children[1].textContent));
});

test('Tagesgeldziel in Balance und Spielwert in der Übersicht', () => {
    const complete = makeStore(makeYear(normal, refund, ...Array(10).fill(normal)));
    const storage = { getItem: key => key === EXPENSES_STORAGE_KEY ? JSON.stringify(complete) : null };
    const result = personalCashTargets([{ profileId: 'a' }], 1000, 0, { storage, now: new Date(2027, 0, 1) });
    equal(result[0].liquidityTargetBasis.annualExpenses, 10700);
    const cash = calculateCashProposal({ person: { ...people[0], value: 1000 }, data: {}, end: '2026-02-28',
        fallbackStart: '2026-02-01', expenses: complete });
    equal(cash.expenses, -300);
});

test('Positiver Altimport', () => {
    const oldYear = makeYear(entry(600, 400), entry(300, 0));
    const oldView = projectExpenses({ store: makeStore(oldYear), year: 2026, people, now });
    deepEqual([oldView.stats.annualUsed, oldView.categories[0].amount, oldView.needs.annualForecast.floor], [1300, 1300, 5400]);
});

test('Importvorschau ohne und mit Bedarf, Brutto-Schranke und gespeicherter Netto-Saldo', async () => {
    const fixture = balanceStorageFixture('Einzelprofil');
    const id = fixture.scope.ids[0];
    const previous = { version: 1, years: { 2026: { months: { 1: { profiles: { [id]: normal } } } } } };
    const records = { ...fixture.records, [EXPENSES_STORAGE_KEY]: JSON.stringify(previous),
        [PLANNED_EXPENSES_KEY]: JSON.stringify({ version: 1, entries: { [fixture.scope.key]: {
            scope: fixture.scope, items: [{ id: 'p', bezeichnung: 'Muster', monat: '2026-02', betrag: 500 }]
        } } }) };
    P.resetPersistenceForTests({ name: 'NG-14', async loadAll() { return records; }, async saveBatch() {} });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    try {
        for (const split of [false, true]) {
            const { doc } = createDialogFixture();
            const csv = split ? 'Kategorie;Betrag;Bedarf\nAlltag;-400;Floor\nAlltag;1000;Floor\nWohnen;-300;Floor'
                : 'Kategorie;Betrag\nAlltag;-700\nAlltag;1000';
            const result = await importExpenses({ storage: persistenceStorage, controller: null, win: null,
                targets: [{ year: 2026, month: 2, profileId: id, text: async () => csv }],
                confirm: async targets => {
                    const [target] = targets;
                    target.plannedExpenseChoices[0].selected = true;
                    const preview = requestExpensesPreview(targets, { doc });
                    const dialog = doc.getElementById('expensesImportPreview');
                    const shown = text(dialog.querySelector('[data-expenses-preview-category]'));
                    const sum = doc.querySelector('[data-expenses-preview-total]').textContent;
                    const amount = dialog.querySelector('input[type="text"]') ?? dialog.querySelectorAll('input')[1];
                    amount.value = '701';
                    await dialog.querySelector('[data-expenses-preview-accept]').fire('click');
                    const rejected = dialog.open && text(dialog.querySelector('[role="alert"]')).includes('Geplante Ausgaben');
                    amount.value = '500';
                    await dialog.querySelector('[data-expenses-preview-accept]').fire('click');
                    if (dialog.open) await dialog.querySelector('[data-expenses-preview-cancel]').fire('click');
                    const accepted = await preview;
                    ok(shown.includes(split ? '-600,00' : '-300,00'), shown);
                    ok(sum.includes('-300,00'), sum);
                    ok(rejected);
                    return accepted;
                } });
            equal(result.status, 'saved');
            const saved = JSON.parse(persistenceStorage.getItem(EXPENSES_STORAGE_KEY)).years[2026].months[2].profiles[id];
            deepEqual(Object.keys(saved).sort(), (split ? ['categories', 'categoryNeeds', 'plannedExpenses', 'updatedAt'] : ['categories', 'plannedExpenses', 'updatedAt']));
            equal(saved.plannedExpenses[0].amount, 500);
            equal(computeYearStats({ yearData: JSON.parse(persistenceStorage.getItem(EXPENSES_STORAGE_KEY)).years[2026] }).annualUsed, 200);
        }
    } finally {
        P.resetPersistenceForTests();
    }
});

test('Tabellarische Importvorschau formatiert Nullsummen ohne Minuszeichen', async () => {
    const { doc } = createDialogFixture();
    const preview = requestExpensesPreview([{ year: 2026, month: 2, profileId: 'a', direction: -1,
        categories: { Alltag: 0 }, categoryNeeds: { Alltag: { floor: 0, flex: 0 } }, total: -0 }], { doc });
    const dialog = doc.getElementById('expensesImportPreview');
    const amounts = ['[data-expenses-preview-category]', '[data-expenses-preview-sum]']
        .map(selector => dialog.querySelector(selector).children.slice(1).map(cell => cell.textContent));
    await dialog.querySelector('[data-expenses-preview-cancel]').fire('click');
    equal(await preview, false);
    deepEqual(amounts, [['—', '—', '0,00 €'], ['—', '—', '0,00 €']]);
});

test('Speicherprüfung überspringt Nulljahre und Nullmonate', () => {
    const withGaps = { ...store, years: { 2025: null, 2026: { months: { ...yearData.months, 3: null } } } };
    let raw = JSON.stringify(withGaps);
    const storage = { getItem: () => raw, setItem: (key, value) => { equal(key, EXPENSES_STORAGE_KEY); raw = value; } };
    const loaded = loadExpensesStoreResult(storage);
    equal(loaded.status, 'ok');
    const updated = { ...loaded.store, activeYear: 2027 };
    saveExpensesStore(updated, storage);
    deepEqual(JSON.parse(raw), { ...withGaps, activeYear: 2027 });
});

const failures = [];
for (const { name, run } of cases) {
    try { await run(); } catch (error) { failures.push(name + '\n' + error.stack); }
}
assertEqual(failures.join('\n\n'), '', 'NG-14: Vorzeichen und Brutto-Schranke an allen Ausgaben-Konsumenten');
