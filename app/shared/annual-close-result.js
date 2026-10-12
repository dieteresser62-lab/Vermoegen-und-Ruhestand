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
        adjustedFields: [...view.adjustedFields], targetYear };
}

export function createAnnualActionResult({ doc, result }) {
    const node = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
    const root = node('section'); root.dataset.annualActionResult = '';
    root.append(node('h3', `Handlungsanweisung ${result.year} (verbindlich)`), node('p', result.text || result.notice || ANNUAL_ACTION_NOTICE));
    if (!result.action) return root;
    const action = result.action;
    if (action.type !== 'NONE' && action.title !== result.text) root.append(node('p', action.title));
    if (action.type !== 'NONE') {
        const sources = (action.quellen || []).filter(source => source.brutto > 0);
        const uses = Object.entries(action.verwendungen || {}).filter(([, value]) => value > 0);
        if (sources.length) {
            root.append(node('h4', 'Verkäufe / Entnahmen'));
            const list = node('ul');
            for (const source of sources) list.append(node('li', `${names[source.kind] || source.kind}${source.source ? ` (${source.source})` : ''}: ${money(source.brutto)} brutto · ${money(source.netto)} netto · ${money(source.steuer)} Steuer`));
            root.append(list);
        }
        if (uses.length) {
            root.append(node('h4', 'Käufe / Verwendung'));
            const list = node('ul'); for (const [key, value] of uses) list.append(node('li', `${names[key] || key}: ${money(value)}`)); root.append(list);
        }
    }
    root.append(node('h4', 'Steuer'), node('p', Number.isFinite(action.steuer) ? `Steuer gesamt: ${money(action.steuer)}` : 'Keine Steuerinformation im Jahresbeleg.'));
    return root;
}

export function createAnnualPlanResult({ doc, result }) {
    const root = doc.createElement('section'); root.dataset.annualPlanResult = '';
    const title = doc.createElement('h3'); title.textContent = `Verbindlicher Planstand ${result.targetYear ?? result.year - 1} → ${result.year}`; root.append(title);
    if (!result.needs) { const p = doc.createElement('p'); p.textContent = result.notice || ANNUAL_ACTION_NOTICE; root.append(p); return root; }
    const label = doc.createElement('p'); label.textContent = result.planLabel; root.append(label);
    for (const need of result.needs) { const p = doc.createElement('p'); p.textContent = `${need.id === 'floorBedarf' ? 'Grundbedarf' : 'Flex-Bedarf'} jährlich: ${formatAnnualNeed(need, result)}`; root.append(p); }
    return root;
}
