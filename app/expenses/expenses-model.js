import { computeSpent, computeYearStats } from '../balance/balance-expenses-metrics.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { overviewScope, readOverviewSummary, OVERVIEW_SUMMARY_KEY } from '../overview/overview-storage.js';

export function hasExpenseImport(record) {
    const categories = record?.categories;
    return categories && typeof categories === 'object' && !Array.isArray(categories)
        && Object.values(categories).every(value => ['number', 'string'].includes(typeof value) && Number.isFinite(Number(value)));
}

export function expensesDueMonth(year, now, firstPlanningYear = null) {
    if (firstPlanningYear && year < firstPlanningYear || year > now.getFullYear()) return 0;
    return year < now.getFullYear() ? 12 : now.getMonth();
}

/** Nur lesend: ein Personenbudget wird niemals aus einem Haushaltsbudget aufgeteilt. */
export function readExpensesBudget({ year, scope, receiptScope = scope, registry, activeId, storage }) {
    if (!scope) return { monthly: null, status: 'missing' };
    const sources = scope.ids.map(id => ({ getItem: key => id === activeId
        ? storage.getItem(key) : registry?.profiles?.[id]?.data?.[key] ?? null }));
    const record = readAnnualPlanRecord({ year, scope: receiptScope, storage });
    if (record?.status === 'invalid') return { monthly: null, status: 'invalid' };
    if (record) return { monthly: record.adopted.monthlyBudget, status: 'adopted' };
    const summaries = sources.map(source => readOverviewSummary(source.getItem(OVERVIEW_SUMMARY_KEY), year, scope));
    if (summaries.length && summaries.every(item => item && item.monthlyBudget >= 0
        && JSON.stringify(item) === JSON.stringify(summaries[0]))) return { monthly: summaries[0].monthlyBudget, status: 'provisional' };
    return { monthly: null, status: 'missing' };
}

export function projectExpenses({ store, year, people, personId = null, budget = { monthly: null, status: 'missing' }, now, firstPlanningYear }) {
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
        return { month, profiles, missing, due: month <= dueMonth, total: Object.values(profiles).reduce((sum, record) => sum + computeSpent(record.categories).spent, 0),
            complete: ids.length > 0 && Object.keys(profiles).length === ids.length };
    });
    const annualBudget = budget.monthly === null ? null : budget.monthly * 12;
    const stats = computeYearStats({ yearData, monthlyBudget: budget.monthly, annualBudget });
    const hasData = months.some(month => Object.keys(month.profiles).length);
    const categories = [...categoryTotals].map(([name, amount]) => ({ name, amount,
        share: stats.annualUsed > 0 ? amount / stats.annualUsed * 100 : 0,
        bar: stats.annualUsed > 0 ? Math.min(100, Math.max(0, amount / stats.annualUsed * 100)) : 0 })).sort((a, b) => b.amount - a.amount);
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const due = { year: previous.getFullYear(), month: previous.getMonth() + 1, missing: [] };
    if (!firstPlanningYear || due.year >= firstPlanningYear) due.missing = people.filter(person => !hasExpenseImport(store?.years?.[due.year]?.months?.[due.month]?.profiles?.[person.id]));
    return { year, personId, selected, ids, months, categories, stats, annualBudget, budget, hasData, dueMonth, due,
        pastYear: year < now.getFullYear(),
        remainingCalendarMonths: year < now.getFullYear() ? 0 : year > now.getFullYear() ? 12 : 12 - now.getMonth(),
        missingMonths: months.filter(month => month.due && !month.complete).map(month => month.month),
        completeMonths: months.filter(month => month.complete).length,
        scope: overviewScope(personId || people.length === 1 ? 'single' : 'household', ids) };
}
