import { isFixedExpense, plannedExpensesForYear } from '../profile/household-planned-expenses.js';
import { CARE_FORMS, careFormForPerson } from '../shared/care-benefits.js';

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
    // H-HE2-6: Rundungsreste unter 0,50 € (etwa „-0 €“ beim Grundbedarf zu Hause, wenn alle im Heim leben) sind keine Zeile.
    // Gutachten PFA-3, Befund 3: Die Grenze gilt für den Betrag in der gewählten Eurobasis; die Rohwerte bleiben nominal.
    const divisor = protocolMoneyDivisor(entry, options);
    const add = (list, label, value) => { if (Math.abs(amount(value)) / divisor >= 0.5) list.push({ label, amount: value }); };
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
        // FR-72: Im Heim ersetzen Heimkosten und eigene Ausgaben den Anteil am Grundbedarf.
        const floor = amount(row.floor_brutto);
        const care = amount(row.pflege_zusatz_floor);
        const residential = amount(row.pflege_heimkosten);
        const ownExpenses = amount(row.pflege_heim_eigene_ausgaben);
        const rent = amount(row.wohnmiete);
        add(expenses, residential ? 'Grundbedarf zu Hause' : 'Grundbedarf', floor - care - residential - ownExpenses - rent);
        const offset = backtest ? entry.jahr - options.startYear : entry.jahr - 1;
        const year = inputs.plannedExpensesReferenceYear + offset;
        const priced = Number.isInteger(year) && Number.isFinite(row.inflation_factor_cum);
        // FR-43: Feste geplante Ausgaben stecken im Grundbedarf; die Zeile nennt nur ihren Anteil.
        const fixedPlanned = priced ? plannedExpensesForYear((inputs.plannedExpenses || []).filter(isFixedExpense), year, row.inflation_factor_cum) : 0;
        if (Math.abs(fixedPlanned) / divisor >= 0.5) expenses.push({ label: 'davon feste geplante Ausgaben', amount: fixedPlanned, detail: true });
        add(expenses, residential ? 'Pflege zu Hause' : 'Pflege', care);
        add(expenses, 'Heimkosten', residential);
        add(expenses, 'Eigene Ausgaben im Heim', ownExpenses);
        add(expenses, 'Miete nach Notverkauf', rent);
        add(expenses, 'Flex', householdFlex(row));
        add(expenses, 'Steuer Wohnrecht (§ 23)', row.wohnrechtsteuer);

        const planned = priced
            ? (inputs.plannedExpenses || []).filter(item => !isFixedExpense(item)).map(item => ({ label: item.bezeichnung,
                amount: plannedExpensesForYear([item], year, row.inflation_factor_cum) })) : [];
        personAmounts(expenses, row.geplante_ausgaben, planned,
            item => `Geplante Ausgaben${item?.label ? ` (${item.label})` : ''}`);
    }
    return { incomes, expenses, totals, saved: amount(row?.einkuenfte_gespart), withdrawal };
}

/** Teiler von nominal zu heutigen Euro für Jahresflüsse, wie ihn die Geldspalten des Protokolls verwenden
 * (`protocol-columns.js`: Monte Carlo kumulierte Inflation zu Jahresbeginn, Backtest einschließlich des Jahres).
 * In nominaler Anzeige 1.
 *
 * @param entry - Protokolleintrag.
 * @param [options] - Optionen des Aufrufers mit `moneyBasis` und `source`.
 * @returns {number} Teiler größer 0.
 */
export function protocolMoneyDivisor(entry, options = {}) {
    if (options.moneyBasis !== 'real') return 1;
    const backtest = options.source === 'backtest', row = (backtest ? entry?.row : entry) || {};
    const start = row.inflation_factor_cum, inflation = backtest ? entry?.inflationVJ : row.inflation;
    const factor = backtest ? Number.isFinite(inflation) ? start * (1 + inflation / 100) : NaN : start;
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/** FR-72 Punkt 18: Bedeutung der Pflegespalten im Protokoll; die Rohfelder stehen in DATENVERTRAEGE. */
export const CARE_COLUMN_EXPLANATIONS = Object.freeze({
    'floor-brutto': 'Jahresbedarf vor Einkünften: verbleibender Grundbedarf zu Hause mit festen geplanten Ausgaben, Pflegezusatz zu Hause, Heimkosten, eigene Ausgaben im Heim und Miete nach Notverkauf, in nominalen Euro.',
    'pflege-zusatz-floor': 'Pflegezusatz zu Hause aller Personen nach Staffel, Deckel und Rampe, in nominalen Euro. Im Heim 0; die Heimkosten stehen bei den Pflegekosten je Person.',
    'pflege-zusatz-floor-delta': 'Anstieg des Pflegezusatzes zu Hause gegenüber dem Vorjahr, in nominalen Euro, nie negativ. Heimkosten sind nicht enthalten; ihre Änderung, auch nach unten, steht im ⓘ bei „Ausgaben“.',
    'pflege-cap-zusatz': 'Deckel für den Pflegezusatz zu Hause: maximaler Pflege-Floor minus Grundbedarf, je Person, in nominalen Euro. Heimkosten sind nicht gedeckelt.',
    pflege: 'Summe der Pflegekosten beider Personen in nominalen Euro: Zusatz zu Hause, im Heim Heimkosten und eigene Ausgaben. Der eingesparte Grundbedarf ist nicht abgezogen.',
    'carep1-cost': 'Pflegekosten von Person 1 in nominalen Euro: Zusatz zu Hause, im Heim Heimkosten und eigene Ausgaben; im Todesjahr die Hälfte. Der eingesparte Grundbedarf ist nicht abgezogen.',
    'carep2-cost': 'Pflegekosten von Person 2 in nominalen Euro: Zusatz zu Hause, im Heim Heimkosten und eigene Ausgaben; im Todesjahr die Hälfte. Der eingesparte Grundbedarf ist nicht abgezogen.'
});

const careRow = (entry, options) => (options.source === 'backtest' ? entry?.row : entry) || {};

/** FR-72 Punkt 18: Grad, Form, Heimjahr und Zuschuss einer Person aus dem gespeicherten Jahreszustand.
 * Monte Carlo legt die Form im Heim und bei „Amtlich“ ab. Sonst folgt sie aus heutiger Form, Staffel und
 * Angehörigenausfall; ältere „Amtlich“-Läufe ohne gezogene Form bleiben ohne Form.
 *
 * @param entry - Protokolleintrag.
 * @param {number} index 0 für Person 1, 1 für Person 2.
 * @param [options] - Optionen des Aufrufers.
 * @returns {{grade: number, form: string|null, heimJahr: number|undefined, subsidy: number|undefined, bestand: boolean}|null} Zustand oder null ohne Pflege.
 */
export function protocolCareState(entry, index, options = {}) {
    const row = careRow(entry, options), inputs = options.inputs || {}, key = `CareP${index + 1}`;
    const backtest = options.source === 'backtest', today = index === 0 ? inputs.careToday : inputs.partner?.careToday;
    const grade = row[`${key}_Active`] ? row[`${key}_Grade`] : backtest ? today?.grade : 0;
    if (!grade) return null;
    const form = row[`${key}_Form`] ?? (row[`${key}_FamilyFallback`] ? 'home-support'
        : inputs.pflegeKostenStaffelPreset === 'amtlich' && !backtest ? null : careFormForPerson(inputs, grade, index));
    return { grade, form, heimJahr: row[`${key}_HeimJahr`], subsidy: row[`${key}_HeimZuschuss`],
        bestand: row[`${key}_HeimBestand`] === true || (backtest && form === 'residential' && !row[`${key}_HeimJahr`]) };
}

/** FR-72 Punkt 18: Änderung der Heimkosten einer Person gegenüber der Vorjahreszeile, in der gewählten Euro-Basis;
 * negativ, wenn der Zuschuss der Kasse steigt. Ohne Vorjahr im Heim gibt es keine Änderung.
 *
 * @param entry - Protokolleintrag.
 * @param {number} index 0 für Person 1, 1 für Person 2.
 * @param [options] - Optionen des Aufrufers mit allen Zeilen des Protokolls.
 * @returns {number|null} Euro.
 */
export function protocolResidentialCostChange(entry, index, options = {}) {
    const rows = options.rows || [], position = rows.indexOf(entry), key = `CareP${index + 1}_HeimKosten`;
    const row = careRow(entry, options), previous = position > 0 ? careRow(rows[position - 1], options) : null;
    if (!previous || previous.jahr !== row.jahr - 1 || !Number.isFinite(row[key]) || !Number.isFinite(previous[key])) return null;
    const scale = value => options.moneyBasis === 'real' ? value.amount / value.factor : value.amount;
    const current = scale({ amount: row[key], factor: row.inflation_factor_cum || 1 });
    return current - scale({ amount: previous[key], factor: previous.inflation_factor_cum || 1 });
}

/** Ausgaben-ⓘ: je Person Grad, Form, Heimjahr und Zuschussstufe, im Heim mit der Änderung der Heimkosten.
 *
 * @param entry - Protokolleintrag.
 * @param [options] - Optionen des Aufrufers.
 * @param {(value: number) => string} [money] - Formatierer für Euro ohne weitere Umrechnung.
 * @returns {string[]} Ein Satz je Person mit Pflege.
 */
export function protocolCareNotes(entry, options = {}, money = value => `${Math.round(value)} €`) {
    const inputs = options.inputs || {}, notes = [];
    for (const index of inputs.partner?.aktiv ? [0, 1] : [0]) {
        const care = protocolCareState(entry, index, options);
        if (!care) continue;
        const name = options.personDisplayContext?.persons?.[index]?.name || inputs.simulationPeople?.[index]?.name || `Person ${index + 1}`;
        const percent = `${Math.round(amount(care.subsidy) * 100)}\u00a0%`, change = protocolResidentialCostChange(entry, index, options);
        const form = care.form !== 'residential' ? care.form ? CARE_FORMS[care.form] : 'Form im amtlichen Durchschnitt enthalten'
            : care.bestand ? 'heute schon im Heim, die Heimkosten stecken im Grundbedarf'
                : Number(care.heimJahr) > 0 ? `im Heim, Heimjahr ${care.heimJahr}, ${amount(care.subsidy) > 0 ? `Zuschuss der Kasse ${percent} auf den Pflegeanteil` : 'ohne Zuschuss der Kasse'}` : 'im Heim';
        notes.push(`${name}: Grad ${care.grade}, ${form}${change === null ? '' : `, Heimkosten ${change > 0 ? '+' : ''}${money(change)} gegenüber dem Vorjahr`}.`);
    }
    return notes;
}
