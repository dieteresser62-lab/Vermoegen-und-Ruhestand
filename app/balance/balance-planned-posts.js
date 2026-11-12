import { readPlannedExpenses, plannedExpenseOccurrences, plannedExpenseSplitForYear } from '../profile/household-planned-expenses.js';
import { incomeFromRecord } from '../profile/profile-income.js';
import { loadExpensesStore } from './balance-expenses-storage.js';
import { withPlannedExpensePrices } from './balance-inflation-source.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';

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
    // FR-43 (11.11.2026): Feste Ausgaben zählen zum Grundbedarf; Reserve und Jahressumme gelten nur für einmalige.
    const once = expenses.filter(item => !item.fixed);
    return { year, reserve: once.filter(item => !item.paid).reduce((sum, item) => sum + item.amount, 0),
        expenseTotal: once.reduce((sum, item) => sum + item.amount, 0),
        items: [...expenses, ...income].sort((a, b) => a.month.localeCompare(b.month)) };
}

/** FR-43: Summe der festen geplanten Ausgaben des Planungsjahres, die im Grundbedarf stecken.
 * @param {import('../../typcheck/datenvertraege.js').PlannedPosts|null|undefined} posts @returns {number} */
export function fixedPlannedTotal(posts) {
    return (posts?.items || []).filter(item => item.kind === 'expense' && item.fixed).reduce((sum, item) => sum + item.amount, 0);
}

/** FR-43: Tag der Regeländerung; frühere Beschlüsse kannten feste Ausgaben nur außerhalb des Budgets. */
export const FIXED_EXPENSES_RULE_DATE = '2026-11-11';

/** FR-43 (N4): Jahresbeleg mit alter Bedeutung: feste Posten in expenseTotal oder, auch ohne feste Posten, vor dem
 * 11.11.2026 beschlossen. Das Beschlussdatum ist das einzige Merkmal, das jeder Beleg trägt.
 * @param {any} receipt Ergebnis von readAnnualPlanRecord. @returns {boolean} */
export function isLegacyReceipt(receipt) {
    return Boolean(receipt?.adopted) && receipt.status !== 'invalid'
        && (isLegacyPlannedPosts(receipt.adopted.plannedPosts) || String(receipt.committedAt ?? '') < FIXED_EXPENSES_RULE_DATE);
}

/** FR-43: Belege vor dem 11.11.2026 zählten feste Posten in Reserve und expenseTotal, nicht im Budget.
 * @param {import('../../typcheck/datenvertraege.js').PlannedPosts|null|undefined} posts @returns {boolean} */
export function isLegacyPlannedPosts(posts) {
    const expenses = (posts?.items || []).filter(item => item.kind === 'expense');
    const onceTotal = expenses.filter(item => !item.fixed).reduce((sum, item) => sum + item.amount, 0);
    return expenses.some(item => item.fixed) && Math.abs((posts?.expenseTotal ?? 0) - onceTotal) > 0.01;
}

/** FR-43: Feste Ausgaben, die im Budget eines Beschlusses für dieses Jahr stecken; null ohne solche (auch bei Altbelegen).
 * @param {import('../../typcheck/datenvertraege.js').PlannedPosts|null|undefined} posts @param {number} year
 * @returns {{total: number, months: number[]}|null} Jahressumme und zwölf Monatsbeträge. */
export function fixedExpensesInBudget(posts, year) {
    const fixed = posts?.year === year ? (posts.items || []).filter(item => item.kind === 'expense' && item.fixed) : [];
    if (!fixed.length || isLegacyPlannedPosts(posts)) return null;
    return { total: fixedPlannedTotal(posts), months: Array.from({ length: 12 }, (_, index) => fixed
        .filter(item => item.month === `${year}-${String(index + 1).padStart(2, '0')}`).reduce((sum, item) => sum + item.amount, 0)) };
}

/** FR-43: Monatsbudget = (Jahresbudget − feste Ausgaben des Jahres) / 12 + feste Ausgaben des Monats.
 * Ohne feste Posten null; die Summe der Monate bleibt das Jahresbudget.
 * @param {number} monthlyBudget Jahresbudget / 12 aus dem Beschluss.
 * @param {import('../../typcheck/datenvertraege.js').PlannedPosts|null|undefined} posts Geplante Posten desselben Beschlusses.
 * @param {number} year Kalenderjahr. @returns {number[]|null} Zwölf Monatswerte. */
export function monthlyBudgetsWithFixedExpenses(monthlyBudget, posts, year) {
    const fixed = fixedExpensesInBudget(posts, year);
    if (!fixed || !Number.isFinite(monthlyBudget)) return null;
    return fixed.months.map(amount => monthlyBudget - fixed.total / 12 + amount);
}

/** @param {import('../../typcheck/balance-ui.js').PlannedPostsOptions} options @returns {import('../../typcheck/datenvertraege.js').PlannedPosts|null} */
export function readBalancePlannedPosts({ storage, scope, year, people }) {
    if (!scope) return null;
    const items = withPlannedExpensePrices(readPlannedExpenses({ storage, scope }), { storage, scope, referenceYear: year });
    const posts = projectPlannedPosts({ items, year, scope, people, store: items.length ? loadExpensesStore(storage) : null });
    return posts.items.length ? posts : null;
}

/** FR-43: Feste geplante Ausgaben des Folgejahrs für die Pflegeprojektion, mit derselben Preisbasis wie der Simulator.
 * @param {{storage: import('../../typcheck/datenvertraege.js').RecordReader, scope: import('../../typcheck/datenvertraege.js').PlanScope|null, year: number, priceFactor: number}} options
 * @returns {number} Euro im Folgejahr. */
export function readNextYearFixedExpenses({ storage, scope, year, priceFactor }) {
    if (!scope) return 0;
    const items = readPlannedExpenses({ storage, scope });
    return items.length ? plannedExpenseSplitForYear(withPlannedExpensePrices(items, { storage, scope, referenceYear: year }), year + 1, priceFactor).fixed : 0;
}

/** Vorschläge sind unbestätigt. Ein Reimport darf die eigene Zuordnung ersetzen. */
/** @param {import('../../typcheck/balance-ui.js').PlannedImportOptions} options @returns {import('../../typcheck/balance-ui.js').PaymentChoice[]} */
export function plannedExpenseImportChoices({ storage, scope, year, month, profileId, store }) {
    if (!scope?.ids.includes(profileId)) return [];
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const own = store?.years?.[year]?.months?.[month]?.profiles?.[profileId]?.plannedExpenses || [];
    const payments = expensePayments(store, year);
    const receipt = /** @type {import('../../typcheck/profile-ui.js').ReadAnnualPlan} */ (readAnnualPlanRecord)({ year, scope, storage });
    const legacyYear = isLegacyReceipt(receipt);
    const choices = plannedExpenseOccurrences(withPlannedExpensePrices(readPlannedExpenses({ storage, scope }), { storage, scope, referenceYear: year }), year)
        // FR-43: Feste Ausgaben sind normale Ausgaben des Monats und werden nicht mehr zugeordnet; im Jahr eines
        // Altbelegs (feste Posten außerhalb des Budgets beschlossen) bleibt die Zuordnung wie vorher.
        .filter(item => item.month === monthKey && (!item.fixed || legacyYear)).flatMap(item => {
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
