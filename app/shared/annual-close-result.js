import { comparisonScopeMatches } from '../profile/household-plan-comparison.js';
import { formatAnnualNeed } from '../balance/balance-annual-preview.js';
import { formatDisplayNumber } from './designsystem-number-format.js';

export const ANNUAL_ACTION_NOTICE = 'Für dieses Planjahr und diesen Umfang fehlt eine bestätigte Handlungsanweisung. Bitte den Jahresbeleg in der Sicherung prüfen.';
const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 2 }) : '—';
const names = { aktien_alt: 'Aktien (Altbestand)', aktien_neu: 'Aktien (Neubestand)', aktien: 'Aktien', gold: 'Gold',
    anleihe: 'Anleihen', bonds: 'Anleihen', geldmarkt: 'Geldmarkt', liquiditaet: 'Tagesgeld', cash: 'Tagesgeld' };

/** Nur passende bestätigte Belegdaten, niemals Vorschau oder neue Engineberechnung. */
export function projectAnnualCloseResult({ targetYear, confirmed, model, displayPreview } = {}) {
    const view = model?.planComparison;
    const valid = confirmed && view?.recordStatus === 'valid' && view.year === targetYear + 1
        && comparisonScopeMatches(view.scope, model?.scope) && view.confirmedAction && view.confirmedSnapshot;
    if (!valid) return { year: targetYear + 1, notice: ANNUAL_ACTION_NOTICE };
    const action = view.confirmedAction.action, snapshot = view.confirmedSnapshot;
    const before = displayPreview?.targetYear === targetYear ? displayPreview : null;
    return { year: view.year, text: action.type === 'NONE' ? 'Nichts tun – kein Handlungsbedarf' : view.confirmedAction.text,
        action: structuredClone(action), planLabel: view.planLabel,
        needs: ['floorBedarf', 'flexBedarf'].map(id => ({ id, before: before?.needs?.find(need => need.id === id)?.before,
            after: snapshot.plan[id] })), inflation: before?.inflation || { rate: snapshot.inflation },
        adjustedFields: [...view.adjustedFields], targetYear,
        people: (model.members || []).map(({ id, name }) => ({ id, name })) };
}

export function createAnnualActionResult({ doc, result }) {
    const node = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
    const root = node('section'); root.dataset.annualActionResult = '';
    root.append(node('h3', `Handlungsanweisung ${result.year}${result.action ? ' · festgeschrieben' : ''}`),
        node('p', 'Die Umsetzung (Verkäufe, Umbuchungen) entscheidest du.'),
        node('p', result.text === 'Profilverbund-Transaktionen' ? 'Vorgeschlagene Verkäufe nach Person' : result.text || result.notice || ANNUAL_ACTION_NOTICE));
    if (!result.action) return root;
    const action = result.action;
    if (action.type !== 'NONE' && action.title !== result.text && action.title !== 'Profilverbund-Transaktionen') root.append(node('p', action.title));
    const details = node('details'); details.dataset.annualActionDetails = '';
    details.append(node('summary', 'Details'));
    if (action.type !== 'NONE') {
        const sources = (action.quellen || []).filter(source => source.brutto > 0);
        const uses = Object.entries(action.verwendungen || {}).filter(([, value]) => value > 0);
        const person = source => source.sourceProfileName || result.people?.find(entry => entry.id === source.sourceProfileId)?.name
            || (!source.sourceProfileId && result.people?.length === 1 ? result.people[0].name : 'Im Beleg nicht zugeordnet');
        const security = source => [source.name || names[source.kind] || source.kind,
            source.isin && source.isin !== source.name ? source.isin : null].filter(Boolean).join(' · ');
        if (sources.length) {
            const sales = sources.filter(source => !['liquiditaet', 'cash'].includes(source.kind));
            if (sales.length) {
                root.append(node('h4', 'Vorgeschlagene Verkäufe nach Person'));
                const table = node('table'); table.className = 'ds-table annual-action-sales'; table.dataset.annualActionSales = '';
                const head = node('thead'), headings = node('tr');
                for (const label of ['Person', 'Wertpapier', 'Empfohlener Nettoerlös']) {
                    const cell = node('th', label); cell.setAttribute('scope', 'col'); headings.append(cell);
                }
                head.append(headings); const body = node('tbody');
                for (const source of sales) {
                    const row = node('tr'); row.append(node('td', person(source)), node('td', security(source)), node('td', money(source.netto))); body.append(row);
                }
                table.append(head, body); root.append(table);
            }
            const cash = sources.filter(source => ['liquiditaet', 'cash'].includes(source.kind));
            if (cash.length) {
                root.append(node('h4', 'Vorgeschlagene Entnahmen aus Tagesgeld'));
                const list = node('ul');
                for (const source of cash) list.append(node('li', `${person(source)}: ${money(source.netto)} netto`));
                root.append(list);
            }
            const list = node('ul');
            for (const source of sources) list.append(node('li', `${person(source)} · ${security(source)}${source.source ? ` (${source.source})` : ''}: ${money(source.brutto)} brutto · ${money(source.steuer)} Steuer`));
            details.append(list);
        }
        if (uses.length) {
            root.append(node('h4', 'Käufe / Verwendung'));
            const list = node('ul'); for (const [key, value] of uses) list.append(node('li', `${names[key] || key}: ${money(value)}`)); root.append(list);
        }
    }
    details.append(node('p', Number.isFinite(action.steuer) ? `Steuer gesamt: ${money(action.steuer)}` : 'Keine Steuerinformation im Jahresbeleg.'));
    root.append(details);
    return root;
}

export function createAnnualPlanResult({ doc, result }) {
    const root = doc.createElement('section'); root.dataset.annualPlanResult = '';
    const title = doc.createElement('h3'); title.textContent = `${result.needs ? 'Festgeschriebener Planstand' : 'Planstand'} ${result.targetYear ?? result.year - 1} → ${result.year}`; root.append(title);
    if (!result.needs) { const p = doc.createElement('p'); p.textContent = result.notice || ANNUAL_ACTION_NOTICE; root.append(p); return root; }
    const label = doc.createElement('p'); label.textContent = result.planLabel; root.append(label);
    for (const need of result.needs) { const p = doc.createElement('p'); p.textContent = `${need.id === 'floorBedarf' ? 'Grundbedarf' : 'Flex-Bedarf'} jährlich: ${formatAnnualNeed(need, result)}`; root.append(p); }
    return root;
}

/** Datenvollständigkeit bleibt vom Besuch und vom gespeicherten Abschluss getrennt. */
export function createAnnualExpenseStatus({ doc, model, targetYear }) {
    const node = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
    const root = node('section'); root.dataset.annualExpenseStatus = '';
    const expenses = model.expenses || {}, annual = model.annual || {};
    const month = new Date(expenses.year ?? model.occasion?.previousYear, (expenses.month ?? model.occasion?.previousMonth ?? 12) - 1, 1).toLocaleDateString('de-DE', { month: 'long' });
    const monthMissing = (model.members || []).filter(person => !expenses.rows?.some(row => row.id === person.id && row.present));
    root.append(node('p', expenses.complete ? `${month} vollständig` : `${month} noch unvollständig${monthMissing.length ? ' · Ausgaben fehlen: ' + monthMissing.map(person => person.name).join(', ') : ''}`));
    const year = annual.year ?? targetYear;
    const status = node('p', annual.complete ? `Jahr ${year} vollständig` : `Jahr ${year} noch unvollständig`);
    if (!annual.complete) status.className = 'close-dialog-result-warning';
    root.append(status);
    if (!annual.complete) {
        const missing = (annual.months || []).filter(row => row.month <= (annual.lastMonth ?? 12) && !row.complete);
        const names = ids => ids.map(id => model.members?.find(person => person.id === id)?.name || 'Unbenannte Person').join(', ');
        root.append(node('p', missing.length ? 'Ausgaben fehlen: ' + missing.map(row =>
            `${new Date(year, row.month - 1, 1).toLocaleDateString('de-DE', { month: 'long' })}${row.missingPersonIds?.length ? ' (' + names(row.missingPersonIds) + ')' : ''}`).join('; ') + '.'
            : 'Die Jahresausgaben sind noch nicht vollständig belegt.'));
    }
    root.append(node('p', `Jahresausgaben ${year}${annual.complete ? '' : ' bisher'}: ${money(annual.total)} · Jahresbudget: ${money(Number.isFinite(annual.budget) ? annual.budget * 12 : null)}`));
    return root;
}
