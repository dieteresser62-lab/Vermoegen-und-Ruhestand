import strict from 'node:assert/strict';
import { parseCategoryCsv, EXPENSE_CSV_CATEGORY_NEEDS } from '../app/balance/balance-expenses-csv.js';
import { computeHouseholdNeedsStats, computeYearStats, hasCategoryNeeds } from '../app/balance/balance-expenses-metrics.js';
import { loadExpensesStoreResult, saveExpensesStore, setExpensesActiveYear } from '../app/balance/balance-expenses-storage.js';
import { requestExpensesPreview } from '../app/balance/balance-expenses-import.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { previewPersonExport, confirmPersonExport, previewPersonImport, importPersonFile, normalizePersonFile } from '../app/profile/profile-person-file.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { projectExpenses } from '../app/expenses/expenses-model.js';
import { readCloseExpenseNeeds } from '../app/expenses/expenses-needs.js';
import { renderExpenseNeeds } from '../app/expenses/expenses-needs-renderer.js';
import { annualNeedsComparison } from '../app/shared/annual-needs-review.js';
import { createOverviewStepContent } from '../app/overview/overview-month-confirmation.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';

const failures = [];
async function probe(name, run) {
    try { await run(); console.log(`FF-1b grün: ${name}`); }
    catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FF-1b rot: ${name}: ${error.message}`); }
}
const entry = (floor, flex) => ({ categories: { Alltag: -floor - flex }, categoryNeeds: { Alltag: { floor: -floor, flex: -flex } } });
const people = [{ id: 'a', name: 'Max' }, { id: 'b', name: 'Erika' }];
const text = node => [node.textContent, ...Array.from(node.children).map(text)].join(' ');
const walk = node => [node, ...Array.from(node.children).flatMap(walk)];

await probe('1 / I3: Export und zweifacher Reimport lassen Ausgaben bytegleich', async () => {
    const records = createMusterHaushaltRecords('2026-10-30');
    P.resetPersistenceForTests({ name: 'FF-1b', async loadAll() { return { ...records }; },
        async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete records[key]); Object.assign(records, Object.fromEntries(upserts)); } });
    try {
        await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const before = records.balance_expenses_v1;
        const file = await confirmPersonExport(await previewPersonExport(records.rs_current_profile));
        // I3 wirklich bis zum Doppelimport ausführen, auch gegen den alten Exportvertrag.
        for (let repeat = 0; repeat < 2; repeat++) strict.equal((await importPersonFile(await previewPersonImport(file))).status, 'imported');
        strict.equal(records.balance_expenses_v1, before, 'Doppelimport lässt den Ausgabenstore bytegleich');
        strict.equal(Object.hasOwn(file, 'expenses'), false, 'Export enthält keine Ausgaben');
        // Zwischenstandsdateien werden angenommen, ihr Zusatzfeld wird unabhängig vom Inhalt ignoriert.
        for (const expenses of [JSON.parse(before), { version: 2, years: 'unlesbar' }]) {
            const oldFile = { ...file, expenses };
            strict.equal(Object.hasOwn(normalizePersonFile(oldFile), 'expenses'), false);
            strict.equal((await importPersonFile(await previewPersonImport(oldFile))).status, 'imported');
            strict.equal(records.balance_expenses_v1, before, 'Reimport schreibt den Ausgabenstore nicht');
        }
    } finally { P.resetPersistenceForTests(); }
});

await probe('2 / G1/G2: ungültige Aufteilung überlebt Laden, Jahreswahl und Speichern', () => {
    for (const invalid of [null, { Alltag: { floor: '12', flex: 0 } }, { Alltag: { floor: -99, flex: 0 } }]) {
        const original = { ...entry(100, 20), categoryNeeds: invalid };
        let raw = JSON.stringify({ version: 1, activeYear: 2026, years: { 2026: { months: { 1: { profiles: { a: original } } } } } });
        const storage = { getItem: () => raw, setItem: (key, value) => { raw = value; } };
        const loaded = loadExpensesStoreResult(storage);
        strict.equal(loaded.status, 'ok'); strict.equal(loaded.diagnostics.length, 1);
        const afterLoad = structuredClone(loaded.store.years[2026].months[1].profiles.a);
        strict.equal(hasCategoryNeeds(original), false);
        setExpensesActiveYear(2025, storage);
        saveExpensesStore(loadExpensesStoreResult(storage).store, storage);
        strict.deepEqual([afterLoad, JSON.parse(raw).years[2026].months[1].profiles.a], [original, original]);
    }
});

await probe('2 / Hinweis: Monat und Person bei ungültiger Aufteilung sichtbar', () => {
    const { doc } = createDialogFixture();
    for (const id of ['expensesNeeds']) { const node = doc.createElement('section'); node.id = id; doc.body.append(node); }
    const view = projectExpenses({ store: { years: { 2026: { months: { 1: { profiles: {
        a: { ...entry(100, 20), categoryNeeds: null }, b: entry(100, 20) } } } } } }, year: 2026, people, now: new Date(2026, 9, 30) });
    renderExpenseNeeds(doc, view, true);
    strict.match(text(doc.getElementById('expensesNeeds')), /Aufteilung für ‹Januar› von ‹Max› nicht lesbar – Monat neu importieren\./);
});

await probe('3 / B2/B3: alte Kategorie-/Betrag-Köpfe und exakt Bedarf', () => {
    for (const header of ['Bedarfskategorie;Betrag', 'Kategorie;Betrag Kategorie']) {
        strict.deepEqual({ ...parseCategoryCsv(`${header}\nAlltag;-12`) }, { Alltag: -12 });
    }
    strict.equal(parseCategoryCsv('Kategorie;Betrag;Art\nAlltag;-12;Flex')[EXPENSE_CSV_CATEGORY_NEEDS], undefined);
    const categories = parseCategoryCsv('Bedarfsart;Kategorie;Betrag; BeDaRf \nFlex;Alltag;-12;Floor');
    strict.deepEqual(categories[EXPENSE_CSV_CATEGORY_NEEDS].Alltag, { floor: -12, flex: 0 });
});

const yearData = { months: {
    1: { profiles: { a: entry(800, 200), b: entry(100, 100) } },
    2: { profiles: { a: entry(1000, 0) } }, // F4: fehlender Import bei Erika
    3: { profiles: { a: entry(0, 0), b: entry(0, 0) } }, // wie Gesamt: Nullmonat zählt nicht
    4: { profiles: { a: entry(100, 100), b: { categories: { Alltag: -400 } } } },
    12: { profiles: { a: entry(9000, 1000), b: entry(9000, 1000) } } // F9: künftig
} };
const args = { store: { years: { 2026: yearData } }, year: 2026, people, now: new Date(2026, 9, 30) };
await probe('4 / F4: ein fehlender Personenimport zählt nicht', () => {
    const stats = computeHouseholdNeedsStats({ yearData: { months: { 1: yearData.months[1], 2: yearData.months[2] } }, profileIds: ['a', 'b'] });
    strict.equal(stats.monthsWithBreakdown, 1);
    strict.equal(stats.months[1].withBreakdown, false);
});
await probe('4 / F9: ein künftiger Monat zählt nicht', () => {
    const stats = computeHouseholdNeedsStats({ yearData: { months: { 1: yearData.months[1], 12: yearData.months[12] } }, profileIds: ['a', 'b'], forecastMonths: [1] });
    strict.equal(stats.monthsWithBreakdown, 1);
    strict.equal(stats.annualForecast.total, 14400);
});
await probe('4 / F4/F9: vollständige, abgelaufene positive Monate wie Gesamt', () => {
    const stats = computeHouseholdNeedsStats({ yearData, profileIds: ['a', 'b'], forecastMonths: [1, 3, 4] });
    strict.deepEqual([stats.monthsWithBreakdown, stats.monthsWithoutBreakdown], [1, 1]);
    const total = computeYearStats({ yearData, forecastMonths: [1, 3, 4] });
    strict.equal(stats.annualForecast.total, total.annualForecast);
    strict.equal(stats.annualForecast.floor, 10800); strict.equal(stats.annualForecast.flex, 3600);
    const view = projectExpenses(args);
    strict.equal(view.stats.annualForecast, 10800);
    strict.equal(view.needs.annualForecast.total, view.stats.annualForecast);
    strict.deepEqual([view.stats.monthsWithData, view.needs.monthsWithBreakdown, view.needs.monthsWithoutBreakdown], [2, 1, 1]);
    const review = readCloseExpenseNeeds({ scope: view.scope, members: people, now: args.now }, 2026, null,
        { getItem: key => key === 'balance_expenses_v1' ? JSON.stringify({ version: 1, ...args.store }) : null });
    strict.equal(review.annualForecast.total, 10800, 'Abschluss nutzt dieselbe Hochrechnung');
    strict.equal(annualNeedsComparison({ needs: [] }, { needsReview: review }).expenses, 10800, 'Ist J nutzt Gesamthochrechnung');
    const { doc } = createDialogFixture();
    for (const id of ['expensesNeeds']) { const node = doc.createElement('section'); node.id = id; doc.body.append(node); }
    renderExpenseNeeds(doc, view, true);
    const card = text(doc.getElementById('expensesNeeds'));
    strict.match(card, /= Hochrechnung oben\. Floor und Flex aus 1 Monat mit Aufteilung \(von 2 gezählten\)\./);
    strict.equal(card.includes('Floor + Flex = Hochrechnung oben.'), false);
    const monthly = createOverviewStepContent({ doc, model: { scope: view.scope, expenseNeeds: review,
        expenses: { year: 2026, month: 1, complete: true, spent: 1200 }, occasion: { previousYear: 2026, previousMonth: 1 }, expenseBudget: null },
        step: { id: 'budget', done: false, result: '' } });
    strict.match(text(monthly), /Floor und Flex aus 1 von 2 Monaten mit Aufteilung\./);
    const allSplit = projectExpenses({ ...args, store: { years: { 2026: { months: { 1: yearData.months[1] } } } } });
    renderExpenseNeeds(doc, allSplit, true);
    strict.match(text(doc.getElementById('expensesNeeds')), /= Hochrechnung oben\./);
    strict.equal(text(doc.getElementById('expensesNeeds')).includes('0 Monate ohne Aufteilung'), false);
    strict.equal(allSplit.needs.annualForecast.floor + allSplit.needs.annualForecast.flex, allSplit.stats.annualForecast);
});

await probe('5 / Vorschau: leere Anteile als Strich, Summe bleibt Betrag', async () => {
    const { doc } = createDialogFixture();
    const categories = { Alltag: -120 }, categoryNeeds = { Alltag: { floor: -120, flex: 0 } };
    const pending = requestExpensesPreview([{ profileId: 'a', year: 2026, month: 1, categories, categoryNeeds, total: 120 }], { doc });
    const dialog = doc.getElementById('expensesImportPreview');
    try {
        const row = walk(dialog).find(node => Object.hasOwn(node.dataset, 'expensesPreviewCategory'));
        strict.equal(row.children[2].textContent, '—');
        strict.match(row.children[3].textContent, /120,00/);
    } finally { await walk(dialog).find(node => Object.hasOwn(node.dataset, 'expensesPreviewCancel')).fire('click'); await pending; }
});

assert(failures.length === 0, failures.join('\n') || 'FF-1b: alle Gegenproben grün');
