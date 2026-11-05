import { plannedExpensesForYear } from '../profile/household-planned-expenses.js';

const amount = value => Number.isFinite(value) ? value : 0;
const householdFlex = row => Number.isFinite(row?.flex_haushalt_erfuellt) ? row.flex_haushalt_erfuellt
    : amount(row?.flex_erfuellt_nominal) + amount(row?.flex_rentenueberschuss);

/** Additive Anzeige-/Exportwerte; der gerechnete Jahresdatensatz bleibt unverändert.
 *
 * @param row - Jahreszeile.
 * @returns Ergebnis der Operation.
 */
export function protocolAnnualTotals(row) {
    if (!row || row.recordType?.startsWith('terminal_')) return { einnahmen_gesamt: null, ausgaben_gesamt: null };
    return {
        einnahmen_gesamt: amount(row.renteSum) + amount(row.sonstige_einkuenfte) + amount(row.zufluss),
        ausgaben_gesamt: amount(row.floor_brutto) + householdFlex(row) + amount(row.geplante_ausgaben) + amount(row.wohnrechtsteuer)
    };
}

/** Aufschlüsselung ausschließlich aus dem gebundenen Lauf, nie aus aktuellen Personenfeldern.
 *
 * @param entry - Protokolleintrag.
 * @param [options] - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function protocolCashflowBreakdown(entry, options = {}) {
    const backtest = options.source === 'backtest', row = backtest ? entry?.row : entry;
    const withdrawal = amount(entry?.entscheidung?.jahresEntnahme ?? row?.entscheidung?.jahresEntnahme)
        + amount(row?.geplante_ausgaben) + amount(row?.wohnrechtsteuer);
    const totals = protocolAnnualTotals(row);
    const incomes = [], expenses = [], inputs = options.inputs || {};
    const add = (list, label, value) => { if (amount(value) !== 0) list.push({ label, amount: value }); };
    const personName = profileId => {
        const index = inputs.simulationPeople?.findIndex(person => person.profileId === profileId) ?? -1;
        return options.personDisplayContext?.persons?.[index]?.name || inputs.simulationPeople?.[index]?.name
            || (index >= 0 ? `Person ${index + 1}` : profileId || 'Person');
    };
    const personAmounts = (list, total, people, label) => {
        let sum = 0;
        for (const person of people || []) {
            add(list, label(person), person.amount);
            sum += amount(person.amount);
        }
        add(list, label(), amount(total) - sum);
    };
    if (row && totals.einnahmen_gesamt !== null) {
        personAmounts(incomes, row.renteSum, [1, 2].map(person => ({ amount: row[`rente${person}`], person })),
            person => person ? `Rente ${options.personDisplayContext?.persons?.[person.person - 1]?.name || `Person ${person.person}`}` : 'Renten');
        personAmounts(incomes, row.pflegegeld, row.pflegegeld_personen,
            person => `Pflegegeld${person ? ` ${personName(person.profileId)}` : ''}`);
        const allowanceByPerson = new Map((row.pflegegeld_personen || []).map(person => [person.profileId, person.amount]));
        personAmounts(incomes, amount(row.sonstige_einkuenfte) - amount(row.pflegegeld),
            row.sonstige_einkuenfte_personen?.map(person => ({ ...person, amount: person.amount - (allowanceByPerson.get(person.profileId) || 0) })),
            person => `Sonstige Einkünfte${person ? ` ${personName(person.profileId)}` : ''}`);
        personAmounts(incomes, row.zufluss, row.zufluss_personen,
            person => `Einmalige Einkünfte${person?.label ? ` (${person.label})` : ''}`);

        // Der effektive Grundbedarf enthält Pflege bereits; Haushalts-Flex enthält
        // sowohl den Einkommensanteil als auch den tatsächlich gezahlten Depotanteil.
        const floor = amount(row.floor_brutto);
        const care = amount(row.pflege_zusatz_floor);
        const rent = amount(row.wohnmiete);
        add(expenses, 'Grundbedarf', floor - care - rent);
        add(expenses, 'Pflege', care);
        add(expenses, 'Miete nach Notverkauf', rent);
        add(expenses, 'Flex', householdFlex(row));
        add(expenses, 'Steuer Wohnrecht (§ 23)', row.wohnrechtsteuer);

        const offset = backtest ? entry.jahr - options.startYear : entry.jahr - 1;
        const year = inputs.plannedExpensesReferenceYear + offset;
        const planned = Number.isInteger(year) && Number.isFinite(row.inflation_factor_cum)
            ? (inputs.plannedExpenses || []).map(item => ({ label: item.bezeichnung,
                amount: plannedExpensesForYear([item], year, row.inflation_factor_cum) })) : [];
        personAmounts(expenses, row.geplante_ausgaben, planned,
            item => `Geplante Ausgaben${item?.label ? ` (${item.label})` : ''}`);
    }
    return { incomes, expenses, totals, saved: amount(row?.einkuenfte_gespart), withdrawal };
}
