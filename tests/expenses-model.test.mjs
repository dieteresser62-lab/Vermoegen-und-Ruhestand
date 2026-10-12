import { projectExpenses, expensesDueMonth, readExpensesBudget } from '../app/expenses/expenses-model.js';
import { overviewScope, summaryEntryKey, OVERVIEW_SUMMARY_KEY } from '../app/overview/overview-storage.js';
const people = [{ id: 'a', name: 'Alva' }, { id: 'b', name: 'Bela' }];
const record = categories => ({ categories, importedAt: '2026-10-01T10:00:00Z' });
const store = { years: { 2026: { months: {
    1: { profiles: { a: record({ Wohnen: -100, Erstattung: 20 }), b: record({ Essen: 20 }), outsider: record({ Fremd: -9000 }) } },
    2: { profiles: { a: record({ Essen: 200 }), b: record({ Essen: 0 }) } },
    3: { profiles: { a: record({ Essen: -900 }), b: record({}) } },
    9: { profiles: { a: record({}) } }
} } } };
const before = JSON.stringify(store);
const view = projectExpenses({ store, year: 2026, people, now: new Date(2026, 9, 10), budget: { monthly: 50, status: 'adopted' }, firstPlanningYear: 2026 });
assertEqual(view.stats.annualUsed, 1200, 'Außenstehende Person zählt nicht zur Haushaltssumme');
assertEqual(view.stats.annualRemaining, -600, 'Negativer Rest bleibt erhalten');
assertEqual(view.categories.reduce((sum, category) => sum + category.amount, 0), 1200, 'Saldierte Kategorien entsprechen den Matrixsummen');
assertEqual(view.categories.find(row => row.name === 'Wohnen').amount, 100, 'Negative Banknotation wird pro Record positiv');
assertEqual(view.categories.find(row => row.name === 'Erstattung').amount, -20, 'Erstattung behält relatives Vorzeichen');
assertEqual(view.stats.medianMonthly, 200, 'Hochrechnung nutzt Median statt Durchschnitt');
assertEqual(view.stats.avgMonthly, 400, 'Durchschnitt bleibt unterscheidbar');
assertEqual(view.stats.annualForecast, 2400, 'Bestehende Medianregel bleibt erhalten');
assertEqual(view.due.missing.map(p => p.id).join(','), 'b', 'Teilimport meldet nur fehlende Person');
assertEqual(view.completeMonths, 3, 'Nullimport wird als erfasst gezählt');
assert(view.categories.every(row => Number.isFinite(row.share) && Number.isFinite(row.bar)), 'Endliche Anteile und Balken');
const person = projectExpenses({ store, year: 2026, people, personId: 'a', now: new Date(2026, 9, 10) });
assertEqual(person.stats.annualUsed, 1180, 'Personenfilter enthält genau diese Person');
assertEqual(person.annualBudget, null, 'Kein erfundenes Personenbudget');
assertEqual(person.due.missing[0].id, 'b', 'Hinweis bleibt vom Filter unabhängig');
const empty = projectExpenses({ store, year: 2027, people, now: new Date(2026, 9, 10) });
assertEqual(empty.hasData, false, 'Leeres Jahr enthält keine erfundenen Ausgaben');
assertEqual(empty.due.year, 2026, 'Historische oder zukünftige Ansicht verändert fachliches Importjahr nicht');
assertEqual(expensesDueMonth(2025, new Date(2026, 0, 4)), 12, 'Vergangenes Jahr hat zwölf fällige Monate');
assertEqual(expensesDueMonth(2026, new Date(2026, 0, 4)), 0, 'Januar hat im aktuellen Jahr keine fälligen Monate');
assertEqual(expensesDueMonth(2027, new Date(2026, 9, 4)), 0, 'Zukünftiges Jahr bleibt neutral');
assertEqual(expensesDueMonth(2025, new Date(2026, 9, 4), 2026), 0, 'Kein Auftrag vor Planungsbeginn');
const january = projectExpenses({ store, year: 2028, people, now: new Date(2027, 0, 5), firstPlanningYear: 2026 });
assertEqual(`${january.due.year}-${january.due.month}`, '2026-12', 'Januarhinweis zielt auf Dezember des Vorjahres');
assertEqual(JSON.stringify(store), before, 'Alle Projektionen erhalten Originalrecords');
const scope = overviewScope('household', ['a', 'b']);
const summary = { year: 2026, scope, monthlyBudget: 100, monthlyWithdrawal: 100, createdAt: '2026-01-01T00:00:00Z' };
const raw = JSON.stringify({ version: 1, entries: { [summaryEntryKey(2026, scope)]: summary } });
const registry = { profiles: { a: { data: {} }, b: { data: { [OVERVIEW_SUMMARY_KEY]: raw } } } };
const storage = { getItem: key => key === OVERVIEW_SUMMARY_KEY ? raw : null };
assertEqual(readExpensesBudget({ year: 2026, scope, registry, activeId: 'a', storage }).monthly, 100, 'Passende gemeinsame Zusammenfassung wird vorläufig gelesen');
assertEqual(readExpensesBudget({ year: 2025, scope, registry, activeId: 'a', storage }).monthly, null, 'Fremde Budgetperiode bleibt ausgeschlossen');
assertEqual(readExpensesBudget({ year: 2026, scope: overviewScope('single', ['a']), registry, activeId: 'a', storage }).monthly, null, 'Haushaltsbudget wird nicht zum Personenbudget');
assertEqual(readExpensesBudget({ year: 2026, scope, registry, activeId: 'a', storage: { getItem: key => key === 'annual_plan_record_v1' ? '{broken' : raw } }).status, 'invalid', 'Beschädigter Beleg erlaubt keinen Zusammenfassungsfallback');

const { buildAnnualPlanRecord } = await import('../app/profile/annual-plan-record.js');
const { PLAN_DEFAULTS } = await import('../app/profile/household-plan.js');
const outcome = { monthlyWithdrawal: 900, monthlyBudget: 70, liquidityBefore: 2, liquidityAfter: 2,
    flexRate: 0, marketPhase: 'Normal', action: { type: 'NONE', title: 'Keine Transaktion' } };
const adopted = { ...outcome, snapshot: { inflation: 2, ageByPerson: { a: 67, b: 66 }, plan: structuredClone(PLAN_DEFAULTS) } };
const receipt = buildAnnualPlanRecord(null, { targetYear: 2025, scope, committedAt: '2026-01-02T12:00:00Z', recommended: outcome, adopted }).raw;
const withReceipt = { getItem: key => key === 'annual_plan_record_v1' ? receipt : storage.getItem(key) };
assertEqual(readExpensesBudget({ year: 2026, scope, registry, activeId: 'a', storage: withReceipt }).monthly, 70, 'Übernommener Jahresbeleg hat Vorrang vor vorläufiger Zusammenfassung');
assertEqual(readExpensesBudget({ year: 2025, scope, registry, activeId: 'a', storage: withReceipt }).monthly, null, 'Beleg eines fremden Jahres wird nicht übernommen');
assertEqual(readExpensesBudget({ year: 2026, scope: overviewScope('single', ['a']), registry, activeId: 'a', storage: withReceipt }).monthly, null, 'Haushaltsbeleg wird nicht als Personenbeleg angezeigt');
const zero = projectExpenses({ store: { years: { 2026: { months: { 1: { profiles: { a: record({}) } } } } } }, year: 2026, people: [people[0]], now: new Date(2026, 1, 3), budget: { monthly: 0, status: 'adopted' } });
assertEqual(zero.annualBudget, 0, 'Belegtes Nullbudget bleibt gültig');
assertEqual(zero.completeMonths, 1, 'Nullimport hat Importpräsenz');
assertEqual(zero.stats.monthsWithData, 0, 'Nullimport erfindet keinen positiven Prognosemonat');
assertEqual(zero.due.missing.length, 0, 'Nullimport löst keinen Fehlmonatauftrag aus');
const netZero = projectExpenses({ store: { years: { 2026: { months: { 1: { profiles: { a: record({ Ausgabe: -10, Erstattung: 10 }) } } } } } }, year: 2026, people: [people[0]], now: new Date(2026, 1, 3) });
assert(netZero.categories.every(category => Number.isFinite(category.share) && Number.isFinite(category.bar)), 'Nullnettosumme hat endliche Kategorieanteile und Balken');
