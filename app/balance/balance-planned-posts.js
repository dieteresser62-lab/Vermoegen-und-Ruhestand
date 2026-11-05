import { readPlannedExpenses, plannedExpenseOccurrences } from '../profile/household-planned-expenses.js';
import { incomeFromRecord } from '../profile/profile-income.js';
import { loadExpensesStore } from './balance-expenses-storage.js';
import { withPlannedExpensePrices } from './balance-inflation-source.js';

/** @param {Pick<import('../../typcheck/datenvertraege.js').ExpensePayment, "scopeKey"|"id"|"month">} item @returns {string} */
export const expensePaymentKey = item => JSON.stringify([item.scopeKey, item.id, item.month]);

/** Bestätigte Importzuordnungen gelten haushaltsweit, unabhängig vom Zahlenden. */
/** @param {import('../../typcheck/datenvertraege.js').ExpensesStoreAlt} store @param {number} year @returns {import('../../typcheck/datenvertraege.js').ExpensePayment[]} */
export function expensePayments(store, year) {
    return Object.values(store?.years?.[year]?.months || {}).flatMap(month =>
        Object.values(month.profiles || {}).flatMap(record => record.plannedExpenses || []));
}

/** @param {{items: import('../../typcheck/datenvertraege.js').PlannedExpense[], year: number, scope: import('../../typcheck/datenvertraege.js').PlanScope, people?: import('../../typcheck/balance-ui.js').PersonEntry[], store: import('../../typcheck/datenvertraege.js').ExpensesStoreAlt}} options @returns {import('../../typcheck/datenvertraege.js').PlannedPosts} */
export function projectPlannedPosts({ items, year, scope, people = [], store }) {
    const payments = new Map(expensePayments(store, year).map(item => [expensePaymentKey(item), item]));
    const expenses = plannedExpenseOccurrences(items, year).map(item => {
        const paid = payments.get(expensePaymentKey({ ...item, scopeKey: scope.key }));
        return { ...item, kind: 'expense', paid: Boolean(paid), paidAmount: paid?.amount ?? 0 };
    });
    const income = people.flatMap(person => incomeFromRecord(person.data).filter(entry => !entry.art && Number(entry.monat.slice(0, 4)) === year)
        .map(entry => ({ id: entry.id, month: entry.monat, label: entry.bezeichnung, amount: entry.betrag,
            kind: 'income', person: person.name || person.profileId })));
    return { year, reserve: expenses.filter(item => !item.paid).reduce((sum, item) => sum + item.amount, 0),
        expenseTotal: expenses.reduce((sum, item) => sum + item.amount, 0),
        items: [...expenses, ...income].sort((a, b) => a.month.localeCompare(b.month)) };
}

/** @param {import('../../typcheck/balance-ui.js').PlannedPostsOptions} options @returns {import('../../typcheck/datenvertraege.js').PlannedPosts|null} */
export function readBalancePlannedPosts({ storage, scope, year, people }) {
    if (!scope) return null;
    const items = withPlannedExpensePrices(readPlannedExpenses({ storage, scope }), { storage, scope, referenceYear: year });
    const posts = projectPlannedPosts({ items, year, scope, people, store: items.length ? loadExpensesStore(storage) : null });
    return posts.items.length ? posts : null;
}

/** Vorschläge sind unbestätigt. Ein Reimport darf die eigene Zuordnung ersetzen. */
/** @param {import('../../typcheck/balance-ui.js').PlannedImportOptions} options @returns {import('../../typcheck/balance-ui.js').PaymentChoice[]} */
export function plannedExpenseImportChoices({ storage, scope, year, month, profileId, store }) {
    if (!scope?.ids.includes(profileId)) return [];
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const own = store?.years?.[year]?.months?.[month]?.profiles?.[profileId]?.plannedExpenses || [];
    const payments = expensePayments(store, year);
    const choices = plannedExpenseOccurrences(withPlannedExpensePrices(readPlannedExpenses({ storage, scope }), { storage, scope, referenceYear: year }), year)
        .filter(item => item.month === monthKey).flatMap(item => {
            const key = expensePaymentKey({ ...item, scopeKey: scope.key });
            const previous = own.find(paid => expensePaymentKey(paid) === key);
            if (!previous && payments.some(paid => expensePaymentKey(paid) === key)) return [];
            return [{ ...item, scopeKey: scope.key, selected: Boolean(previous), amount: previous?.amount ?? item.amount }];
        });
    // Zahlungsnachweise bleiben auch nach Löschen, Verschieben oder Bereichswechsel
    // des Planpostens erhalten, bis sie im Reimport ausdrücklich abgewählt werden.
    for (const previous of own) if (!choices.some(item => expensePaymentKey(item) === expensePaymentKey(previous))) {
        choices.push({ ...previous, selected: true });
    }
    return choices;
}

/** @param {{plannedExpenseChoices?: import('../../typcheck/balance-ui.js').PaymentChoice[], total: number}} target @returns {import('../../typcheck/datenvertraege.js').ExpensePayment[]} */
export function selectedExpensePayments(target) {
    const payments = (target.plannedExpenseChoices || []).filter(item => item.selected).map(({ id, month, label, amount, scopeKey }) => ({ id, month, label, amount, scopeKey }));
    if (payments.some(item => !Number.isFinite(item.amount) || item.amount <= 0)
        || payments.reduce((sum, item) => sum + item.amount, 0) > target.total + 0.01) throw new Error('Geplante Ausgaben: Zugeordnete Beträge müssen positiv sein und dürfen die Importsumme nicht übersteigen.');
    return payments;
}
