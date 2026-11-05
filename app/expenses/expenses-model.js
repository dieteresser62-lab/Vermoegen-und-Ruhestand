import { projectExpenseNeeds, projectCategoryNeeds } from './expenses-needs.js';
import { computeSpent, computeBudgetSpent, computeYearStats, hasExpenseImport } from '../balance/balance-expenses-metrics.js';
export { hasExpenseImport } from '../balance/balance-expenses-metrics.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { overviewScope, readOverviewSummary, OVERVIEW_SUMMARY_KEY } from '../overview/overview-storage.js';

/**
 * @param year Kalenderjahr der Projektion.
 * @param now Lokaler Bezugszeitpunkt.
 * @param firstPlanningYear Erstes durch Quellen belegtes Planungsjahr.
 * @returns Letzter fälliger Monat des Anzeigejahrs.
 */
export function expensesDueMonth(year, now, firstPlanningYear = null) {
    if (firstPlanningYear && year < firstPlanningYear || year > now.getFullYear()) return 0;
    return year < now.getFullYear() ? 12 : now.getMonth();
}

/** Nur lesend: ein Personenbudget wird niemals aus einem Haushaltsbudget aufgeteilt. */
/**
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Passendes Monatsbudget und Herkunftsstatus.
 */
export function readExpensesBudget({ year, scope, receiptScope = scope, registry, activeId, storage }) {
    if (!scope) return { monthly: null, status: 'missing' };
    const sources = scope.ids.map(id => ({ getItem: key => id === activeId
        ? storage.getItem(key) : registry?.profiles?.[id]?.data?.[key] ?? null }));
    const record = /** @type {import("../../typcheck/profile-ui.js").ReadAnnualPlan} */ (readAnnualPlanRecord)({ year, scope: receiptScope, storage });
    if (record?.status === 'invalid') return { monthly: null, status: 'invalid' };
    if (record) return { monthly: record.adopted.monthlyBudget, status: 'adopted' };
    const summaries = sources.map(source => readOverviewSummary(source.getItem(OVERVIEW_SUMMARY_KEY), year, scope));
    if (summaries.length && summaries.every(item => item && item.monthlyBudget >= 0
        && JSON.stringify(item) === JSON.stringify(summaries[0]))) return { monthly: summaries[0].monthlyBudget, status: 'provisional' };
    return { monthly: null, status: 'missing' };
}

/**
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Lesende Monats-, Jahres- und Kategorienprojektion.
 */
export function projectExpenses({ store, year, people, personId = null, budget = { monthly: null, status: 'missing' }, needsPlan = null, now, firstPlanningYear }) {
    const selected = personId ? people.filter(person => person.id === personId) : people;
    const ids = selected.map(person => person.id);
    const dueMonth = expensesDueMonth(year, now, firstPlanningYear);
    const yearData = { months: {} };
    const categoryTotals = new Map();
    const months = Array.from({ length: 12 }, (_, index) => {
        const month = index + 1, profiles = {};
        const missing = [];
        for (const person of selected) {
            const record = store?.years?.[year]?.months?.[month]?.profiles?.[person.id];
            if (!hasExpenseImport(record)) { if (month <= dueMonth) missing.push(person); continue; }
            profiles[person.id] = record;
            const { sum } = computeSpent(record.categories);
            // Saldierung pro Importrecord: Erstattungen behalten ihr relatives Vorzeichen.
            const direction = sum < 0 ? -1 : 1;
            for (const [name, raw] of Object.entries(record.categories)) categoryTotals.set(name, (categoryTotals.get(name) || 0) + Number(raw) * direction);
        }
        yearData.months[month] = { profiles };
        return { month, profiles, missing, due: month <= dueMonth, total: Object.values(profiles).reduce((sum, record) => sum + computeBudgetSpent(record).spent, 0),
            complete: ids.length > 0 && Object.keys(profiles).length === ids.length };
    });
    const annualBudget = budget.monthly === null ? null : budget.monthly * 12;
    const forecastMonths = months.filter(month => month.complete && month.due).map(month => month.month);
    const stats = computeYearStats({ yearData, monthlyBudget: budget.monthly, annualBudget, forecastMonths });
    const needs = personId ? null : projectExpenseNeeds({ yearData, profileIds: ids, forecastMonths, floorPlan: needsPlan?.floorBedarf, annualBudget });
    const categoryNeeds = personId ? null : projectCategoryNeeds(yearData, ids);
    const hasData = months.some(month => Object.keys(month.profiles).length);
    const actualTotal = [...categoryTotals.values()].reduce((sum, amount) => sum + amount, 0);
    const categories = [...categoryTotals].map(([name, amount]) => ({ name, amount, ...(categoryNeeds?.get(name) || {}),
        share: actualTotal > 0 ? amount / actualTotal * 100 : 0,
        bar: actualTotal > 0 ? Math.min(100, Math.max(0, amount / actualTotal * 100)) : 0 })).sort((a, b) => b.amount - a.amount);
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const due = { year: previous.getFullYear(), month: previous.getMonth() + 1, missing: [] };
    if (!firstPlanningYear || due.year >= firstPlanningYear) due.missing = people.filter(person => !hasExpenseImport(store?.years?.[due.year]?.months?.[due.month]?.profiles?.[person.id]));
    return { year, personId, needs, needsWish: needsPlan?.flexBedarf ?? null, selected, ids, months, categories, stats, annualBudget, budget, hasData, dueMonth, due,
        pastYear: year < now.getFullYear(),
        remainingCalendarMonths: year < now.getFullYear() ? 0 : year > now.getFullYear() ? 12 : 12 - now.getMonth(),
        missingMonths: months.filter(month => month.due && !month.complete).map(month => month.month),
        completeMonths: months.filter(month => month.complete).length,
        scope: overviewScope(personId || people.length === 1 ? 'single' : 'household', ids) };
}
