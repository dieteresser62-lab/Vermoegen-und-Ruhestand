import { UIUtils } from './balance-utils.js';
const formatCurrency = UIUtils.formatBalanceCurrency;

function annualRows(items) {
    const rows = [];
    for (const item of items) {
        const previous = item.fixed && rows.find(row => row.fixed && row.id === item.id && row.kind === item.kind && row.person === item.person);
        if (previous) {
            previous.amount += item.amount; previous.count++;
            previous.endMonth = item.month;
            previous.paidAmount += item.paidAmount;
            previous.paidCount += Number(item.paid);
            previous.paid = previous.paid && item.paid;
        } else rows.push({ ...item, count: 1, endMonth: item.month, monthlyAmount: item.amount, paidCount: Number(item.paid) });
    }
    return rows;
}

/** Vorschau und Jahresbeleg verwenden dieselbe Monatsliste. */
/** @param {Document} doc @param {import('../../typcheck/datenvertraege.js').PlannedPosts} posts @returns {HTMLElement} */
export function createPlannedPostsView(doc, posts) {
    const root = doc.createElement('section'); root.dataset.plannedPosts = '';
    if (!posts?.items?.length) return root;
    root.className = 'balance-planned-posts';
    const heading = doc.createElement('h4'); heading.textContent = `Geplante Posten ${posts.year}`;
    const note = doc.createElement('p'); note.className = 'ds-help';
    note.textContent = `Zusätzlich zum Liquiditätsziel bereithalten: ${formatCurrency(posts.reserve)}. Einmalige Einkünfte zählen erst nach Eingang im bestätigten Tagesgeldstand. Grundbedarf, Flex und Monatsbudget bleiben unverändert.`;
    const table = doc.createElement('table'); table.className = 'ds-table';
    const head = doc.createElement('thead'), headings = doc.createElement('tr');
    for (const label of ['Monat', 'Geplanter Posten', 'Betrag', 'Berücksichtigung']) {
        const cell = doc.createElement('th'); cell.scope = 'col'; cell.textContent = label; headings.appendChild(cell);
    }
    head.appendChild(headings); table.appendChild(head);
    const body = doc.createElement('tbody');
    for (const item of annualRows(posts.items)) {
        const row = doc.createElement('tr'); row.dataset.postKind = item.kind;
        const status = item.kind === 'income' ? `${item.person} · Eingang im Tagesgeld bestätigen`
            : item.paid ? `bezahlt · ${formatCurrency(item.paidAmount)}` : item.paidCount > 0
                ? `${item.paidCount} von ${item.count} bezahlt · ${formatCurrency(item.paidAmount)}; Rest reservieren` : 'bis zur Zahlung reservieren';
        const period = item.count > 1 ? `${item.month.slice(5)}.–${item.endMonth.slice(5)}.${posts.year}` : `${item.month.slice(5)}.${item.month.slice(0, 4)}`;
        const label = item.label || (item.kind === 'income' ? 'Einmalige Einkünfte' : 'Geplante Ausgaben');
        for (const text of [period, label,
            `${item.kind === 'income' ? '+' : '−'}${formatCurrency(item.amount)}`, status]) {
            const cell = doc.createElement('td'); cell.textContent = text; row.appendChild(cell);
        }
        if (item.fixed) {
            const installments = doc.createElement('small');
            installments.textContent = `${item.count} × ${formatCurrency(item.monthlyAmount)}`;
            row.children[2].appendChild(installments);
        }
        body.appendChild(row);
    }
    table.appendChild(body); root.append(heading, note, table); return root;
}
