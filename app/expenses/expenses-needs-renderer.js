import { createCloseTiles } from '../shared/close-dialog.js';
import { expenseDeviation } from './expenses-needs.js';
import { EXPENSE_MONTHS } from '../balance/balance-expenses-renderer.js';
import { UIUtils } from '../balance/balance-utils.js';
const money = value => Number.isFinite(value) ? UIUtils.formatBalanceCurrency(value).replace(/^-/, '−') : '—';
const signed = value => Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}` : '—';
const monthCount = count => `${count} ${count === 1 ? 'Monat' : 'Monaten'}`;

/**
 * @param doc Zieldokument der Seite.
 * @param view Bereits berechnete Anzeigeprojektion.
 * @param available Ob die Datenquelle lesbar ist.
 * @returns Kein Rückgabewert; rendert den Haushaltsvergleich von Floor und Flex.
 */
export function renderExpenseNeeds(doc, view, available) {
    const card = doc.getElementById('expensesNeeds');
    if (!card) return;
    card.replaceChildren();
    card.hidden = !available || Boolean(view.personId);
    if (card.hidden) return;
    const node = (tag, text, className = '') => { const el = doc.createElement(tag); el.textContent = text; el.className = className; return el; };
    const needs = view.needs;
    const heading = node('div', '', 'expenses-card-head'); heading.append(node('h2', `Floor und Flex ${view.year}`)); card.append(heading);
    for (const { month, profileId } of needs?.invalidBreakdowns || []) {
        const person = view.selected.find(person => person.id === profileId);
        card.append(node('p', `Aufteilung für ‹${EXPENSE_MONTHS[month - 1]}› von ‹${person?.name || profileId}› nicht lesbar – Monat neu importieren.`, 'expenses-note'));
    }
    if (!needs?.monthsWithBreakdown) {
        const hint = node('p', 'Importiere eine Kategorien-CSV mit der Spalte „Bedarf“ (Floor oder Flex), um die Aufteilung zu sehen. ');
        const link = node('a', 'Mehr im Handbuch'); link.href = 'Handbuch.html#ausgaben'; hint.append(link); card.append(hint);
    } else {
        const without = needs.monthsWithoutBreakdown;
        heading.append(node('small', `hochgerechnet: Mittelwert aus ${monthCount(needs.monthsWithBreakdown)} mit Aufteilung × 12${without ? ` · ${without} ${without === 1 ? 'Monat' : 'Monate'} ohne Aufteilung` : ''}`, 'expenses-note'));
        const labels = { floor: 'Grundbedarf (Floor)', flex: 'Flex', total: 'Gesamt' };
        const details = {
            floor: `Plan ${view.year}: ${money(needs.plans.floor)}`,
            flex: `Flex ${view.year} nach Regeln: ${money(needs.plans.flex)} (Wunsch ${money(view.needsWish)})`,
            total: `Jahresbudget: ${money(view.annualBudget)}`
        };
        const hints = { floor: 'Bleibt der Floor dauerhaft darüber, ist der Plan zu knapp.', flex: 'Vergleich mit dem Flex, den die Jahresplanung freigibt.',
            total: `= Hochrechnung oben.${without ? ` Floor und Flex aus ${monthCount(needs.monthsWithBreakdown)} mit Aufteilung (von ${needs.monthsWithBreakdown + without} gezählten).` : ''}` };
        const keys = ['floor', 'flex', 'total'];
        const tiles = createCloseTiles({ doc, items: keys.map(key => ({ label: labels[key],
            value: money(needs.annualForecast[key]), detail: details[key], tone: needs.comparisons[key].difference > 0 ? 'warning' : '' })) });
        [...tiles.children].forEach((tile, index) => {
            const key = keys[index], reference = key === 'flex' ? `Flex ${view.year}` : key === 'total' ? 'Budget' : 'Plan';
            tile.append(node('p', expenseDeviation(needs.annualForecast[key], needs.plans[key], money, reference)), node('small', hints[key], 'expenses-note'));
        }); card.append(tiles);
    }
    if (!needs?.months.length) return;
    // Native, flüchtige Klappe: jeder neu geladene Stand beginnt geschlossen.
    const tableHost = node('details', ''); tableHost.id = 'expensesNeedsMonths'; tableHost.open = false;
    tableHost.append(node('summary', 'Monate mit Floor und Flex anzeigen'));
    const table = node('table', '', 'ds-table'); table.setAttribute('aria-label', 'Floor und Flex im Haushalt');
    const head = node('thead', ''), header = node('tr', '');
    for (const text of ['Monat', 'Floor', 'gegen Plan', 'Flex', 'gegen Plan']) { const cell = node('th', text); cell.scope = 'col'; header.append(cell); }
    head.append(header); table.append(head);
    const body = node('tbody', '');
    const floorPlan = needs.plans.floor === null ? null : needs.plans.floor / 12;
    const flexPlan = needs.plans.flex === null ? null : needs.plans.flex / 12;
    const delta = (value, plan) => Number.isFinite(value) && Number.isFinite(plan) ? signed(value - plan) : '—';
    const append = (label, floor, flex, className = '', plan = false) => {
        const row = node('tr', '', className), name = node('th', label); name.scope = 'row'; row.append(name);
        for (const value of [money(floor), plan ? '' : delta(floor, floorPlan), money(flex), plan ? '' : delta(flex, flexPlan)]) row.append(node('td', value));
        body.append(row);
    };
    for (const month of needs.months) {
        if (month.withBreakdown) append(EXPENSE_MONTHS[month.month - 1], month.floor, month.flex);
        else {
            const row = node('tr', ''), name = node('th', EXPENSE_MONTHS[month.month - 1]); name.scope = 'row';
            const hint = node('td', 'ohne Aufteilung importiert – zählt nur im Gesamt', 'expenses-note'); hint.colSpan = 4;
            row.append(name, hint); body.append(row);
        }
    }
    append('Ø Monat mit Aufteilung', needs.avgMonthly.floor, needs.avgMonthly.flex, 'expenses-needs-average');
    append('Plan je Monat', floorPlan, flexPlan, 'expenses-needs-plan', true);
    table.append(body);
    const scroll = node('div', '', 'expenses-table-region'); scroll.tabIndex = 0; scroll.append(table); tableHost.append(scroll);
    tableHost.append(node('p', 'Nur Monate mit Daten. Gesamt, Budget und Abweichung je Monat stehen oben in „Monate“.', 'expenses-note'));
    card.append(tableHost);
}
