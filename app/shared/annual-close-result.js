import { comparisonScopeMatches } from '../profile/household-plan-comparison.js';
import { createPlannedPostsView } from '../balance/balance-planned-posts-renderer.js';
import { formatAnnualNeed, annualNeedRoundedUp } from '../balance/balance-annual-preview.js';
import { formatDisplayNumber } from './designsystem-number-format.js';
import { createCloseTiles } from './close-dialog.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { HOUSEHOLD_PLAN_FIELDS, formatHouseholdPlanValue } from './household-plan-fields.js';
import { annualLiquidityInflowRouting } from '../balance/balance-play-execution.js';
import { annualMarketChoiceLabel } from './annual-market-choice.js';
import { createTodoResult } from './annual-todo-view.js';
import { projectAnnualTodoPlan } from '../balance/annual-todo.js';
import { annualPlanEntryProgress } from '../balance/annual-action-progress.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { persistenceStorage } from './persistence-facade.js';
import { displayMonthlyDown } from './display-rounding.js';

export const ANNUAL_ACTION_NOTICE = 'Für dieses Planjahr und diesen Umfang fehlt eine bestätigte Handlungsanweisung. Bitte den Jahresbeleg in der Sicherung prüfen.';
const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 2 }) : '—';
const wholeMoney = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 }) : '—';
const names = { aktien_alt: 'Aktien (Altbestand)', aktien_neu: 'Aktien (Neubestand)', aktien: 'Aktien', gold: 'Gold',
    anleihe: 'Anleihen', bonds: 'Anleihen', geldmarkt: 'Geldmarkt', liquiditaet: 'Liquidität', cash: 'Tagesgeld' };

/** Nur passende bestätigte Belegdaten, niemals Vorschau oder neue Engineberechnung.
 *
 * @param {{targetYear?: number; confirmed?: boolean; model?: import("../../typcheck/balance-ui.js").OverviewModel; displayPreview?: ReturnType<typeof import("../balance/balance-annual-preview.js").projectAnnualPreview>; storage?: import("../../typcheck/datenvertraege.js").RecordReader; liquidityContext?: Parameters<typeof annualLiquidityInflowRouting>[1]}} [options]
 * @returns Ergebnis der bestehenden Projektion.
 */
export function projectAnnualCloseResult({ targetYear, confirmed, model, displayPreview, storage, liquidityContext } = {}) {
    const view = model?.planComparison;
    const valid = confirmed && view?.recordStatus === 'valid' && view.year === targetYear + 1
        && comparisonScopeMatches(view.scope, model?.scope) && view.confirmedAction && view.confirmedSnapshot;
    if (!valid) return { year: targetYear + 1, notice: ANNUAL_ACTION_NOTICE };
    const action = view.confirmedAction.action, snapshot = view.confirmedSnapshot;
    const before = displayPreview?.targetYear === targetYear ? displayPreview : null;
    // Nur der passende Jahresbeleg belegt die Empfehlung vor einer bewussten Änderung.
    let recommendation = null;
    if (view.adjustedFields?.length) {
        const record = /** @type {import("../../typcheck/profile-ui.js").ReadAnnualPlan} */ (readAnnualPlanRecord)({ year: view.year, scope: view.scope, storage });
        if (record && !record.status && record.committedAt === view.confirmedAction.committedAt)
            recommendation = structuredClone(record.recommended);
    }
    return { year: view.year, text: action.type === 'NONE' ? 'Nichts tun – kein Handlungsbedarf' : view.confirmedAction.text,
        marketReading: snapshot.marketReading || null,
        action: structuredClone(action), planLabel: view.planLabel, liquidityContext,
        ...(Object.hasOwn(view.confirmedAction, 'monthlySaving') ? { monthlySaving: view.confirmedAction.monthlySaving } : {}),
        ...(view.confirmedAction.plannedPosts ? { plannedPosts: structuredClone(view.confirmedAction.plannedPosts) } : {}),
        needs: ['floorBedarf', 'flexBedarf'].map(id => ({ id, before: before?.needs?.find(need => need.id === id)?.before,
            after: snapshot.plan[id] })), inflation: before?.inflation || { rate: snapshot.inflation },
        adjustedFields: [...view.adjustedFields], recommendation, targetYear,
        people: (model.members || []).map(({ id, name }) => ({ id, name })) };
}

/**
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function createAnnualActionResult({ doc, result, compact = false }) {
    const node = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
    const root = node('section'); root.dataset.annualActionResult = '';
    if (compact) root.className = 'ds-card annual-action-result';
    root.append(node('h3', `Handlungsanweisung ${result.year}${result.action ? ' · festgeschrieben' : ''}`));
    if (result.marketReading) { const label = node('p', annualMarketChoiceLabel(result.marketReading)); label.dataset.annualMarketChoiceLabel = ''; root.append(label); }
    const translateAction = text => String(text || '').replaceAll('Profilverbund-Transaktionen', 'Verkäufe und Käufe je Person');
    const instruction = node('p', translateAction(result.text || result.notice || ANNUAL_ACTION_NOTICE));
    if (compact) instruction.className = 'annual-action-instruction';
    const notice = node('p', compact ? 'Die Umsetzung entscheidest du.' : 'Die Umsetzung (Verkäufe, Umbuchungen) entscheidest du.');
    if (compact) { notice.className = 'annual-action-notice'; root.append(instruction, notice); }
    else root.append(notice, instruction);
    if (!result.action) return root;
    if (result.plannedPosts) root.appendChild(createPlannedPostsView(doc, result.plannedPosts));
    const action = result.action;
    const details = node('details'); details.className = 'ds-technical-details'; details.dataset.annualActionDetails = '';
    details.append(node('summary', 'Details'));
    const breakdown = compact ? details : root;
    if (action.type !== 'NONE' && action.title !== result.text) breakdown.append(node('p', translateAction(action.title)));
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
            const list = node('ul');
            const routing = annualLiquidityInflowRouting(action, result.liquidityContext);
            for (const [key, value] of uses) {
                const label = key === 'liquiditaet' && !routing ? 'Liquidität (Tagesgeld bis zum Ziel, Rest Geldmarkt)' : names[key] || key;
                const item = node('li', `${label}: ${money(value)}`);
                if (key === 'liquiditaet' && routing) {
                    const parts = node('ul');
                    parts.append(node('li', `davon Tagesgeld ${money(routing.tagesgeld)}`), node('li', `davon Geldmarkt ${money(routing.geldmarkt)}`));
                    item.append(parts);
                }
                list.append(item);
            }
            breakdown.append(list);
        }
    }
    details.append(node('p', Number.isFinite(action.steuer) ? `Steuer gesamt: ${money(action.steuer)}` : 'Keine Steuerinformation im Jahresbeleg.'));
    root.append(details);
    return root;
}

/**
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function createAnnualPlanResult({ doc, result, model, peoplePreview }) {
    const node = (tag, text, className) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
    const root = doc.createElement('section'); root.dataset.annualPlanResult = '';
    if (model) {
        const lead = node('div', undefined, 'ds-kpi close-dialog-tile annual-result-budget');
        // FR-78: Monatsbudget abgerundet (Monatsstaffel), ohne Cent; der Beleg behält den genauen Wert.
        lead.append(node('span', `Monatsbudget ${result.year}`, 'close-dialog-tile-label'), node('strong', wholeMoney(displayMonthlyDown(model.summary?.monthlyBudget)), 'annual-result-monthly-budget'),
            node('span', `${result.planLabel || `Plan ${result.year} · Festschreibung nicht belegt`}${result.adjustedFields?.length ? ' · im Abschluss bewusst angepasst' : ''}`, 'annual-result-plan-source'));
        root.append(lead);
        if (result.monthlySaving > 0) lead.append(node('span', `${money(result.monthlySaving)} im Monat angelegt · aufs Tagesgeld, dann nach den Regeln der App`, 'annual-result-plan-source'));
        const annual = model.annual || {}, budget = Number.isFinite(annual.budget) ? annual.budget * 12 : null;
        const difference = annual.complete && Number.isFinite(annual.total) && Number.isFinite(budget) ? annual.total - budget : null;
        const deviation = difference === null ? 'Vergleich unvollständig' : difference === 0 ? 'genau im Budget'
            : `${money(Math.abs(difference))} ${difference > 0 ? 'darüber' : 'darunter'}${budget > 0 ? ` · ${formatDisplayNumber(Math.abs(difference) / budget * 100, { fractionDigits: 1 })} %` : ''}`;
        const needs = result.needs || [], total = needs.length === 2 && needs.every(need => Number.isFinite(need.after)) ? needs.reduce((sum, need) => sum + need.after, 0) : null;
        const inflation = result.inflation?.rate;
        const inflationDetail = Number.isFinite(inflation) ? `${inflation > 0 ? '+' : ''}${formatDisplayNumber(inflation, { fractionDigits: 2 })} % Inflation ${result.targetYear ?? result.year - 1}` : 'Inflationsanpassung nicht belegt';
        root.append(createCloseTiles({ doc, items: [
            { label: `Jahresausgaben ${result.targetYear ?? result.year - 1}${annual.complete ? '' : ' bisher'}`, value: money(annual.total), detail: `Budget ${money(budget)} · ${deviation}`, detailTone: difference > 0 ? 'warning' : '' },
            // RD-1c: Der beschlossene Bedarf ist ein Planwert des Belegs und bleibt genau (keine Monatsregel).
            { label: `Bedarf ${result.year}`, value: `${wholeMoney(total)} im Jahr`, detail: inflationDetail + (result.adjustedFields?.some(id => ['floorBedarf', 'flexBedarf'].includes(id)) ? ' · Bedarf angepasst'
                : needs.some(need => annualNeedRoundedUp(need.before, need.after, inflation)) ? ' · aufgerundet auf volle 1.000 €' : '') }
        ] }));
    }
    const details = node('details', undefined, 'close-dialog-derivation'); details.dataset.annualPlanDerivation = '';
    details.append(node('summary', `Herleitung Plan ${result.year}`));
    details.append(node('p', annualMarketChoiceLabel(result.marketReading)));
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

/**
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
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
    const left = node('div', undefined, 'close-dialog-result-main'), right = node('div', undefined, 'close-dialog-result-details');
    left.append(action);
    const budget = annual.querySelector('.annual-result-budget'); if (budget) left.append(budget);
    right.append(annual, december); root.append(banner, left, right);
    return root;
}

/**
 * @param {{doc: Document; text?: string; logButton: HTMLButtonElement}} options
 * @returns {HTMLDetailsElement} Gespeicherter Abschlussbeleg.
 */
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

/** Datenvollständigkeit bleibt vom Besuch und vom gespeicherten Abschluss getrennt.
 *
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
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
    const budget = Number.isFinite(annual.budget) ? annual.budget * 12 : null;
    const difference = annual.complete && Number.isFinite(annual.total) && budget !== null ? annual.total - budget : null;
    root.append(createCloseTiles({ doc, items: [
        { label: `Jahresausgaben ${year}${annual.complete ? '' : ' bisher'}`, value: money(annual.total) },
        { label: 'Jahresbudget', value: money(budget) }
    ] }));
    const needs = model.expenseNeeds;
    if (needs) root.append(createCloseTiles({ doc, items: ['floor', 'flex'].map(key => ({ label: `Jahresdurchschnitt ${key === 'floor' ? 'Floor' : 'Flex'} / Monat`, value: money(needs.avgMonthly?.[key]) })) }));
    if (difference !== null) root.append(node('p', difference === 0 ? 'Genau im Jahresbudget' : `${money(Math.abs(difference))} ${difference > 0 ? 'über' : 'unter'} dem Jahresbudget${budget > 0 ? ` · ${formatDisplayNumber(Math.abs(difference) / budget * 100, { fractionDigits: 1 })} %` : ''}`));
    return root;
}

/** Umsetzungsstand des Plans für das abzuschließende Jahr (FR-77 Punkt 6), aus Beleg und bestätigten Verkäufen; nur gelesen.
 * @param {{model?: any, year: number}} options */
export function readAnnualClosePlanProgress({ model, year }) {
    try {
        const scope = model?.planComparison?.scope, ids = model?.scope?.ids || [];
        if (!scope || !Number.isInteger(year)) return null;
        const entry = readAnnualPlanRecord({ year, scope, storage: persistenceStorage });
        const progress = annualPlanEntryProgress({ entry, year, registry: loadProfileRegistry().value, profileIds: ids });
        return progress?.lines.length ? { ...progress, year } : null;
    } catch { return null; }
}

/** Ergebnis des Jahresabschlusses: der neue Plan in derselben Form wie die Karte „Was zu tun ist“; die Belegdetails zugeklappt. */
export function createAnnualTodoResult(doc, actionResult) {
    const full = createAnnualActionResult({ doc, result: actionResult, compact: true });
    if (!actionResult?.action) return full;
    let routing = null;
    try { routing = annualLiquidityInflowRouting(actionResult.action, actionResult.liquidityContext); } catch { routing = null; }
    const context = actionResult.liquidityContext;
    const plan = projectAnnualTodoPlan({ confirmed: { year: actionResult.year, action: actionResult.action, text: actionResult.text,
        marketReading: actionResult.marketReading }, people: actionResult.people || [], routing,
        cashMonths: context?.input?.liquidityCashMonths ?? context?.entries?.[0]?.input?.liquidityCashMonths ?? null });
    if (!plan) return full;
    const details = full.querySelector('[data-annual-action-details]');
    // WT-1b: „zeigen“/„ausblenden“ hängt das Designsystem an (.ds-technical-details); die Beschriftung bleibt „Details“.
    const summary = details?.querySelector('summary'); if (summary) summary.textContent = 'Details';
    const root = createTodoResult(doc, plan, { details });
    root.dataset.annualActionResult = '';
    return root;
}
