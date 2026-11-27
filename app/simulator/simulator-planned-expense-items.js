// @ts-check
/** NK-2 (FR-84 Punkte 14 bis 16, Nachtrag 5): Einmalige geplante Ausgaben eines Jahres als einzelne Posten. Jeder Posten wird ganz oder
 * gar nicht bezahlt, in der Reihenfolge des Plans (Datum, dann Eingabe); ein späterer kleinerer Posten kann bezahlt werden, wenn ein
 * früherer größerer entfällt. Grundbedarf und Pflege gehen vor. */
import { isFixedExpense, plannedExpenseOccurrences } from '../profile/household-planned-expenses.js';

/** In diesem Bereich sind die nominalen Eurobeträge feiner als ein Cent auflösbar. */
const MAX_EXPENSE_TOTAL = 2 ** 46 - 1;

/** Einmalige Posten des Simulationsjahrs mit derselben Preisbasis wie `simulatorPlannedExpenseYear`. Stimmt ihre Summe nicht mit
 * `total` überein (etwa bei Altformaten), gilt die Jahressumme als ein Posten.
 * @param {any} inputs @param {number} yearIndex @param {number} inflationFactor @param {number} total Jahressumme der Einmalausgaben.
 * @returns {{label: string, amount: number}[]} */
export function onceExpenseItems(inputs, yearIndex, inflationFactor, total) {
    if (!(total > 0)) return [];
    const items = onceExpenseOccurrences(inputs, yearIndex, inflationFactor).map(({ label, amount }) => ({ label, amount }));
    const sum = items.reduce((value, item) => value + item.amount, 0);
    return items.length && Math.abs(sum - total) <= 0.01 ? items : [{ label: '', amount: total }];
}

/** @param {any} inputs @param {number} yearIndex @param {number} inflationFactor */
function onceExpenseOccurrences(inputs, yearIndex, inflationFactor) {
    const once = (inputs?.plannedExpenses || []).filter((/** @type {any} */ entry) => !isFixedExpense(entry));
    const year = Number(inputs?.plannedExpensesReferenceYear) + yearIndex;
    return Number.isFinite(year) ? plannedExpenseOccurrences(once, year, inflationFactor)
        .sort((a, b) => a.month.localeCompare(b.month)) : [];
}

/** Vor der Finanzierung nur Posten berücksichtigen, die im nominalen Rechenbereich liegen.
 * @param {any} inputs @param {number} yearIndex @param {number} inflationFactor @param {number} total */
export function checkExpenseTotal(inputs, yearIndex, inflationFactor, total) {
    if (total <= MAX_EXPENSE_TOTAL) return null;
    return selectExpenseItems(onceExpenseOccurrences(inputs, yearIndex, inflationFactor), MAX_EXPENSE_TOTAL);
}

/** Posten in Planreihenfolge, solange `budget` reicht; jeder ganz oder gar nicht.
 * @template {{label: string, amount: number}} T
 * @param {T[]} items @param {number} budget
 * @returns {{kept: T[], dropped: T[], total: number, droppedTotal: number}} */
export function selectExpenseItems(items, budget) {
    let left = Math.max(0, budget);
    const kept = [], dropped = [];
    for (const item of items) {
        if (item.amount <= left + 1e-6) { kept.push(item); left -= item.amount; } else dropped.push(item);
    }
    const sum = (/** @type {T[]} */ list) => list.reduce((value, item) => value + item.amount, 0);
    return { kept, dropped, total: sum(kept), droppedTotal: sum(dropped) };
}
