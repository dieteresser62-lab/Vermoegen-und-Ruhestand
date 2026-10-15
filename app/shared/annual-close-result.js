import { comparisonScopeMatches } from '../profile/household-plan-comparison.js';
import { formatAnnualNeed } from '../balance/balance-annual-preview.js';
import { formatDisplayNumber } from './designsystem-number-format.js';
import { createCloseTiles } from './close-dialog.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { HOUSEHOLD_PLAN_FIELDS, formatHouseholdPlanValue } from './household-plan-fields.js';

export const ANNUAL_ACTION_NOTICE = 'Für dieses Planjahr und diesen Umfang fehlt eine bestätigte Handlungsanweisung. Bitte den Jahresbeleg in der Sicherung prüfen.';
const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 2 }) : '—';
const names = { aktien_alt: 'Aktien (Altbestand)', aktien_neu: 'Aktien (Neubestand)', aktien: 'Aktien', gold: 'Gold',
    anleihe: 'Anleihen', bonds: 'Anleihen', geldmarkt: 'Geldmarkt', liquiditaet: 'Tagesgeld', cash: 'Tagesgeld' };

/** Nur passende bestätigte Belegdaten, niemals Vorschau oder neue Engineberechnung. */
export function projectAnnualCloseResult({ targetYear, confirmed, model, displayPreview, storage } = {}) {
    const view = model?.planComparison;
    const valid = confirmed && view?.recordStatus === 'valid' && view.year === targetYear + 1
        && comparisonScopeMatches(view.scope, model?.scope) && view.confirmedAction && view.confirmedSnapshot;
    if (!valid) return { year: targetYear + 1, notice: ANNUAL_ACTION_NOTICE };
    const action = view.confirmedAction.action, snapshot = view.confirmedSnapshot;
    const before = displayPreview?.targetYear === targetYear ? displayPreview : null;
    // Nur der passende Jahresbeleg belegt die Empfehlung vor einer bewussten Änderung.
    let recommendation = null;
    if (view.adjustedFields?.length) {
        const record = readAnnualPlanRecord({ year: view.year, scope: view.scope, storage });
        if (record && !record.status && record.committedAt === view.confirmedAction.committedAt)
            recommendation = structuredClone(record.recommended);
    }
    return { year: view.year, text: action.type === 'NONE' ? 'Nichts tun – kein Handlungsbedarf' : view.confirmedAction.text,
        action: structuredClone(action), planLabel: view.planLabel,
        needs: ['floorBedarf', 'flexBedarf'].map(id => ({ id, before: before?.needs?.find(need => need.id === id)?.before,
            after: snapshot.plan[id] })), inflation: before?.inflation || { rate: snapshot.inflation },
        adjustedFields: [...view.adjustedFields], recommendation, targetYear,
        people: (model.members || []).map(({ id, name }) => ({ id, name })) };
}

export function createAnnualActionResult({ doc, result, compact = false }) {
    const node = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
    const root = node('section'); root.dataset.annualActionResult = '';
    if (compact) root.className = 'ds-card annual-action-result';
    root.append(node('h3', `Handlungsanweisung ${result.year}${result.action ? ' · festgeschrieben' : ''}`));
    const instruction = node('p', result.text === 'Profilverbund-Transaktionen' ? 'Vorgeschlagene Verkäufe nach Person' : result.text || result.notice || ANNUAL_ACTION_NOTICE);
    if (compact) instruction.className = 'annual-action-instruction';
    const notice = node('p', compact ? 'Die Umsetzung entscheidest du.' : 'Die Umsetzung (Verkäufe, Umbuchungen) entscheidest du.');
    if (compact) { notice.className = 'annual-action-notice'; root.append(instruction, notice); }
    else root.append(notice, instruction);
    if (!result.action) return root;
    const action = result.action;
    const details = node('details'); details.dataset.annualActionDetails = '';
    details.append(node('summary', 'Details'));
    const breakdown = compact ? details : root;
    if (action.type !== 'NONE' && action.title !== result.text && action.title !== 'Profilverbund-Transaktionen') breakdown.append(node('p', action.title));
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
                breakdown.append(node('h4', 'Vorgeschlagene Verkäufe nach Person'));
                const table = node('table'); table.className = 'ds-table annual-action-sales'; table.dataset.annualActionSales = '';
                const head = node('thead'), headings = node('tr');
                for (const label of ['Person', 'Wertpapier', 'Empfohlener Nettoerlös']) {
                    const cell = node('th', label); cell.setAttribute('scope', 'col'); headings.append(cell);
                }
                head.append(headings); const body = node('tbody');
                for (const source of sales) {
                    const row = node('tr'); row.append(node('td', person(source)), node('td', security(source)), node('td', money(source.netto))); body.append(row);
                }
                table.append(head, body); breakdown.append(table);
            }
            const cash = sources.filter(source => ['liquiditaet', 'cash'].includes(source.kind));
            if (cash.length) {
                breakdown.append(node('h4', 'Vorgeschlagene Entnahmen aus Tagesgeld'));
                const list = node('ul');
                for (const source of cash) list.append(node('li', `${person(source)}: ${money(source.netto)} netto`));
                breakdown.append(list);
            }
            const list = node('ul');
            for (const source of sources) list.append(node('li', `${person(source)} · ${security(source)}${source.source ? ` (${source.source})` : ''}: ${money(source.brutto)} brutto · ${money(source.steuer)} Steuer`));
            details.append(list);
        }
        if (uses.length) {
            breakdown.append(node('h4', 'Käufe / Verwendung'));
            const list = node('ul'); for (const [key, value] of uses) list.append(node('li', `${names[key] || key}: ${money(value)}`)); breakdown.append(list);
        }
    }
    details.append(node('p', Number.isFinite(action.steuer) ? `Steuer gesamt: ${money(action.steuer)}` : 'Keine Steuerinformation im Jahresbeleg.'));
    root.append(details);
    return root;
}

export function createAnnualPlanResult({ doc, result, model, peoplePreview }) {
    const node = (tag, text, className) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
    const root = doc.createElement('section'); root.dataset.annualPlanResult = '';
    if (model) {
        const lead = node('div', undefined, 'ds-kpi close-dialog-tile annual-result-budget');
        lead.append(node('span', `Monatsbudget ${result.year}`, 'close-dialog-tile-label'), node('strong', money(model.summary?.monthlyBudget), 'annual-result-monthly-budget'),
            node('span', `${result.planLabel || `Plan ${result.year} · Festschreibung nicht belegt`}${result.adjustedFields?.length ? ' · im Abschluss bewusst angepasst' : ''}`, 'annual-result-plan-source'));
        root.append(lead);
        const annual = model.annual || {}, budget = Number.isFinite(annual.budget) ? annual.budget * 12 : null;
        const difference = annual.complete && Number.isFinite(annual.total) && Number.isFinite(budget) ? annual.total - budget : null;
        const deviation = difference === null ? 'Vergleich unvollständig' : difference === 0 ? 'genau im Budget'
            : `${money(Math.abs(difference))} ${difference > 0 ? 'darüber' : 'darunter'}${budget > 0 ? ` · ${formatDisplayNumber(Math.abs(difference) / budget * 100, { fractionDigits: 1 })} %` : ''}`;
        const needs = result.needs || [], total = needs.length === 2 && needs.every(need => Number.isFinite(need.after)) ? needs.reduce((sum, need) => sum + need.after, 0) : null;
        const inflation = result.inflation?.rate;
        const inflationDetail = Number.isFinite(inflation) ? `${inflation > 0 ? '+' : ''}${formatDisplayNumber(inflation, { fractionDigits: 2 })} % Inflation ${result.targetYear ?? result.year - 1}` : 'Inflationsanpassung nicht belegt';
        root.append(createCloseTiles({ doc, items: [
            { label: `Jahresausgaben ${result.targetYear ?? result.year - 1}${annual.complete ? '' : ' bisher'}`, value: money(annual.total), detail: `Budget ${money(budget)} · ${deviation}`, detailTone: difference > 0 ? 'warning' : '' },
            { label: `Bedarf ${result.year}`, value: `${money(total)} im Jahr`, detail: inflationDetail + (result.adjustedFields?.some(id => ['floorBedarf', 'flexBedarf'].includes(id)) ? ' · Bedarf angepasst' : '') }
        ] }));
    }
    const details = node('details', undefined, 'close-dialog-derivation'); details.dataset.annualPlanDerivation = '';
    details.append(node('summary', `Herleitung Plan ${result.year}`));
    if (!result.needs) details.append(node('p', result.notice || ANNUAL_ACTION_NOTICE));
    else {
        for (const need of result.needs) details.append(node('p', `${need.id === 'floorBedarf' ? 'Grundbedarf' : 'Flex-Bedarf'} jährlich: ${formatAnnualNeed(need, result)}`));
        if (result.adjustedFields?.length) {
            details.append(node('h4', 'Empfehlung der App und beschlossener Plan'));
            for (const id of result.adjustedFields) {
                const field = HOUSEHOLD_PLAN_FIELDS.find(field => field.path === id);
                const label = field?.label || id;
                const get = plan => id.split('.').reduce((value, key) => value?.[key], plan);
                const recommended = get(result.recommendation?.snapshot?.plan);
                const adopted = result.needs.find(need => need.id === id)?.after ?? get(model?.planComparison?.confirmedSnapshot?.plan);
                const value = input => input === undefined ? 'nicht belegt' : formatHouseholdPlanValue(input, id);
                details.append(node('p', `${label}: Empfehlung ${value(recommended)} → beschlossen ${value(adopted)}`));
            }
            if (result.recommendation) details.append(node('p', `Monatsbudget: Empfehlung ${money(result.recommendation.monthlyBudget)} → beschlossen ${money(model?.summary?.monthlyBudget)}`));
        }
    }
    for (const person of peoplePreview?.people || []) {
        details.append(node('h4', person.name), node('p', person.error || `${person.startAlter} Jahre am 01.01.${result.year} · Rente: ${money(person.renteMonatlich)} monatlich · ${person.monateImJahr} Bezugsmonate · ${money(person.renteImJahr)} im Planungsjahr.`));
    }
    if (model) details.append(createAnnualExpenseStatus({ doc, model, targetYear: result.targetYear ?? result.year - 1 }));
    root.append(details);
    return root;
}

export function createAnnualCombinedResult({ doc, result, data, annual, action, targetYear }) {
    const node = (tag, text, className) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
    const root = node('section', undefined, 'close-dialog-result annual-combined-result'); root.dataset.annualCombinedResult = 'C';
    const banner = node('div', undefined, 'close-dialog-success'); banner.setAttribute('role', 'status');
    const check = node('span', '✓', 'close-dialog-success-symbol'); check.setAttribute('aria-hidden', 'true');
    const message = node('span'); message.append(node('strong', 'Alles gespeichert.'), node('span', ` ${data.month} und ${targetYear} sind abgeschlossen${result.action ? `, Plan ${result.year} ist festgeschrieben.` : '.'}`));
    banner.append(check, message);
    const december = node('details', undefined, 'close-dialog-derivation'); december.dataset.annualDecember = '';
    const summary = node('summary', data.month);
    summary.append(node('span', `${data.expensesAmount} · ${data.budgetComparison} · ${data.people.map(person => `Tagesgeld ${person.name} ${person.value}`).join(' · ')}`, 'annual-december-summary'));
    const facts = node('dl', undefined, 'close-dialog-facts'); facts.dataset.closeDialogResultMonth = '';
    const fact = (label, value) => facts.append(node('dt', label), node('dd', value));
    fact(`Ausgaben ${data.month}`, `${data.expenses} · ${data.budgetComparison}`);
    for (const person of data.people) fact(`Tagesgeld ${person.name}`, `${person.value} · ${person.status}`);
    fact('Tagesgeld gesamt', `Cashsumme: ${data.cashTotal}`);
    fact(`Monatsbetrag ${data.nextMonth}`, `${data.withdrawal} · ${data.withdrawalDetail}`);
    december.append(summary, facts);
    root.append(banner, action, annual, december);
    return root;
}

export function createAnnualReceiptCard({ doc, text, logButton }) {
    const card = doc.createElement('details');
    card.className = 'close-dialog-derivation'; card.dataset.annualReceiptDetails = '';
    const summary = doc.createElement('summary'); summary.textContent = 'Abschlussbeleg';
    card.append(summary);
    if (text) {
        const note = doc.createElement('p'); note.className = 'annual-receipt-note'; note.textContent = text;
        card.append(note);
    }
    card.append(logButton);
    card.hidden = !text && logButton.hidden;
    return card;
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
