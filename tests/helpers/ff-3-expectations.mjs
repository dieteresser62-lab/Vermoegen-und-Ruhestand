/** Historische Kontrollen ohne die in FF-3 ergänzte synthetische Aufteilung.
 * Die Aufteilung selbst prüft ff-3-examples.test.mjs für alle Muster und Varianten.
 */
export function withoutExampleNeeds(records) {
    const result = { ...records }, expenses = JSON.parse(result.balance_expenses_v1);
    for (const year of Object.values(expenses.years)) for (const month of Object.values(year.months))
        for (const entry of Object.values(month.profiles)) delete entry.categoryNeeds;
    result.balance_expenses_v1 = JSON.stringify(expenses);
    return result;
}
