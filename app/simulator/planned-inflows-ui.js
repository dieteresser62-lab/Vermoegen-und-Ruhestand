import { plannedInflowsSummary } from '../profile/profile-planned-inflows.js';

import { simulatorOneTimeIncome } from '../profile/profile-income.js';

const documents = new WeakMap();
const money = value => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);

/**
 * @param referenceYear - Bezugsjahr der Rechnung.
 * @param {Document} [doc] - Dokument der Simulatorseite.
 * @returns Ergebnis der Operation.
 */
export function readDocumentPlannedInflows(referenceYear, doc = globalThis.document) {
    const state = documents.get(doc);
    if (!state?.rows.length) return {};
    return { plannedInflows: state.rows.map(row => ({ ...row })), plannedInflowsReferenceYear: referenceYear ?? state.referenceYear };
}

/**
 * @param entries - Kontext für entries.
 * @param referenceYear - Bezugsjahr der Rechnung.
 * @param {Document} [doc] - Dokument der Simulatorseite.
 * @returns {void}
 */
export function initializePlannedInflows(entries, referenceYear, doc = globalThis.document) {
    const people = entries.map(entry => ({ ...entry, inflows: simulatorOneTimeIncome(entry.data) }));
    const rows = people.flatMap(person => person.inflows.map(row => ({ ...row, profileId: person.profileId })));
    documents.set(doc, { referenceYear, rows });
    const host = doc.getElementById('plannedInflowsRows');
    if (!host) return;
    host.replaceChildren();
    if (!rows.length) {
        const empty = doc.createElement('p'); empty.className = 'ds-note'; empty.textContent = 'Keine einmaligen Einkünfte eingetragen';
        host.appendChild(empty);
    }
    for (const person of people.filter(person => person.inflows.length)) {
        const group = doc.createElement('div'); group.className = 'sim-inflow-person';
        const name = doc.createElement('h3'); name.textContent = person.name;
        group.appendChild(name);
        for (const entry of person.inflows) {
            const line = doc.createElement('p'); line.className = 'ds-readonly-value';
            line.textContent = `${entry.year} · ${money(entry.amount)}${entry.label ? ` · ${entry.label}` : ''}`;
            group.appendChild(line);
        }
        if (person.inflows.length > 1) {
            const total = doc.createElement('p'); total.className = 'sim-inflow-person-total';
            total.textContent = `Zusammen ${money(plannedInflowsSummary(person.inflows).amount)}`;
            group.appendChild(total);
        }
        host.appendChild(group);
    }
    const summary = doc.getElementById('plannedInflowsSummary');
    const total = plannedInflowsSummary(rows);
    if (summary) summary.textContent = total ? `${total.count} ${total.count === 1 ? 'einmalige Einkunft' : 'einmalige Einkünfte'} · zusammen ${money(total.amount)} · ${total.from === total.to ? total.from : `${total.from}–${total.to}`}` : '';
}
