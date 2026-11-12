/** Jahreshoch in Balance und Jahresabschluss (FR-77 Punkt 5: nur bei verdecktem Bärenmarkt); keine Rechnung oder Speicherung. */
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { isHiddenBearMarket, hiddenBearCheckUnreliable, hiddenBearPriceProblem } from './balance-market-preview.js';
import { createHiddenBearBlock } from '../shared/annual-todo-view.js';
import { displayMonthlyDown } from '../shared/display-rounding.js';

/** @typedef {ReturnType<typeof import('./balance-market-preview.js').projectMarketPreview>} MarketPreview */
/** @typedef {MarketPreview|import('./balance-market-preview.js').UnavailableMarketPreview} Preview */
/** @typedef {MarketPreview['rule']} Reading */
/** @typedef {ReturnType<typeof import('./balance-next-year-budget.js').projectNextYearBudget>} Projection */
/** @param {string|null} value */
const date = value => value ? value.split('-').reverse().join('.') : 'Datum nicht belegt';
/** @param {number|null} value @param {number} digits @param {boolean} [signed] */
const number = (value, digits, signed = false) => `${signed && value !== null && value > 0 ? '+' : value !== null && value < 0 ? '−' : ''}${formatDisplayNumber(value === null ? null : Math.abs(value), { fractionDigits: digits })}`;
/** @param {number|null} value */
const price = value => `${number(value, 2)} €`;
/** @param {number|null} value */
const money = value => `${number(value, 0)} €`;
/** @param {number|null} value */
const percent = value => `${number(value, 1)} %`;
/** @param {Document} doc @param {string} tag @param {string} text @param {string} [className] */
const make = (doc, tag, text, className = '') => {
    const node = doc.createElement(tag); node.textContent = text; node.className = className; return node;
};
/** @param {Reading} reading */
const highOrigin = reading => reading.high.origin === 'stored_close'
    ? `höchster gespeicherter Schlusskurs am ${date(reading.high.asOf)}${reading.high.coverageShorterThanAth ? ` (gespeicherte Kurse seit ${date(reading.high.coverage?.first ?? null)})` : ''}`
    : reading.high.origin === 'rule_high' ? 'neues Hoch nach Regel'
        : `Hoch aus Jahresmarktdaten${reading.high.asOf ? ` am ${date(reading.high.asOf)}` : ' · Datum nicht belegt'}`;
/** @param {MarketPreview} view */
const highLabel = view => view.high.high.asOf ? `Mit Hoch vom ${date(view.high.high.asOf)}` : 'Mit Hoch (Datum nicht belegt)';

/** @param {Document} doc @param {string[]} columns
 * @param {[string, (string|HTMLElement)[]][]} fields @param {string} label */
function comparisonTable(doc, columns, fields, label) {
    const scroll = make(doc, 'div', '', 'ds-table-scroll');
    scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', label);
    const table = make(doc, 'table', '', 'ds-table balance-preview-table');
    const head = make(doc, 'thead', ''), headings = make(doc, 'tr', '');
    for (const text of ['', ...columns]) {
        const th = make(doc, 'th', text); th.setAttribute('scope', 'col'); headings.append(th);
    }
    head.append(headings);
    const rows = make(doc, 'tbody', '');
    for (const [label, values] of fields) {
        const row = make(doc, 'tr', ''), th = make(doc, 'th', label); th.setAttribute('scope', 'row'); row.append(th);
        for (const value of values) {
            const td = make(doc, 'td', '');
            if (typeof value !== 'string' && value.dataset.changed === 'true') td.className = 'balance-preview-cell-warning';
            td.append(typeof value === 'string' ? doc.createTextNode(value) : value); row.append(td);
        }
        rows.append(row);
    }
    table.append(head, rows); scroll.append(table); return scroll;
}

/** @param {NonNullable<MarketPreview['comparison']['rule']>} variant */
export const actionText = variant => `${variant.mainAction.text}${variant.mainAction.netAmount === null ? '' : ` · ${money(variant.mainAction.netAmount)} netto`}${variant.goldPurchase > 0 ? `, davon ${money(variant.goldPurchase)} in Gold` : ', kein Gold-Kauf'}`;

/** Marktwerte stammen aus der fertigen Projektion, Beträge aus ihrem Vergleichsobjekt.
 * @param {Document} doc @param {{label: string, reading: Reading}[]} columns
 * @param {MarketPreview['comparison']} [comparison] */
export function createMarketReadingsTable(doc, columns, comparison) {
    const readings = columns.map(column => column.reading);
    /** @type {[string, (string|HTMLElement)[]][]} */
    const fields = [
        ['Indexstand heute', readings.map(r => price(r.index))],
        ['Hoch', readings.map(r => { const cell = make(doc, 'span', price(r.high.value)); cell.append(make(doc, 'small', highOrigin(r), 'ds-source')); return cell; })],
        ['Abstand zum Hoch', readings.map(r => percent(r.drawdownPct))],
        ['Marktlage', readings.map(r => r.market.text)]
    ];
    if (comparison?.rule && comparison.high) {
        const variants = [comparison.rule, comparison.high];
        fields.push(['Hauptaktion / Verkauf', variants.map(v => `${v.mainAction.text}${v.mainAction.netAmount === null ? '' : ` · ${money(v.mainAction.netAmount)} netto`}`)],
            ['Steuer', variants.map(v => money(v.tax))],
            ['Reserve nach Aktion', variants.map(v => money(v.reserveAfterAction))]);
    }
    return comparisonTable(doc, columns.map(column => column.label), fields, 'Markt und Umschichtung im Vergleich');
}

/** Jahresabschluss, Schritt Marktdaten (FR-77 Punkt 5): Vom Jahreshoch steht hier nur „nicht belastbar“, wenn die Kurse für
 * die Prüfung fehlen und es auf sie ankäme. Den verdeckten Bärenmarkt samt Wahl zeigt der Schritt „Plan“.
 * @param {Document} doc @param {Preview|null} view */
export function createAnnualMarketReadings(doc, view) {
    const host = make(doc, 'section', '', 'balance-market-preview'); host.dataset.annualMarketReadings = '';
    host.hidden = !view || !hiddenBearCheckUnreliable(view);
    if (host.hidden || !view) return host;
    const result = make(doc, 'div', '', 'balance-preview-result balance-preview-result-not_reliable');
    result.dataset.marketStage = 'not_reliable';
    result.append(make(doc, 'span', 'Nicht bewertet', 'ds-badge'), make(doc, 'strong', 'Vergleich mit dem Jahreshoch nicht möglich'),
        make(doc, 'p', view.comparison.reason || 'Schlusskurse fehlen.'));
    const link = make(doc, 'a', 'Kurse auf Daten & Sicherung holen'); link.setAttribute('href', 'Daten-Sicherung.html#kursdienst');
    result.append(link, make(doc, 'p', 'Der Abschluss läuft nach der Jahresendregel.'));
    host.append(result);
    return host;
}

/** „Kurse älter als 10 Tage – verdeckter Bärenmarkt nicht prüfbar · Kurse holen →“ (WT-1b, vorläufige Entscheidung der Steuerung).
 * WT-1c: Fehlen Kurse oder sind sie lückenhaft, heißt es „Kurse fehlen oder sind lückenhaft – …“.
 * @param {Document} doc @param {'stale'|'missing'} problem */
function hiddenBearStaleLine(doc, problem) {
    const reason = problem === 'stale' ? 'Kurse älter als 10 Tage' : 'Kurse fehlen oder sind lückenhaft';
    const line = make(doc, 'p', `${reason} – verdeckter Bärenmarkt nicht prüfbar · `, 'ds-source todo-bear-stale');
    line.dataset.hiddenBearStale = '';
    const link = make(doc, 'a', 'Kurse holen →'); link.setAttribute('href', 'Daten-Sicherung.html#kursdienst');
    line.append(link);
    return line;
}

const renderedPreviewBodies = new WeakMap();
const previewDetails = ['[data-market-history-details]'];
/** Ergebniswechsel erhalten die Bedienauswahl; gleiche Ergebnisse behalten ihre DOM-Knoten.
 * @param {HTMLElement} host @param {string} signature @param {()=>HTMLElement[]} render */
function updateMarketPreviewBody(host, signature, render) {
    if (renderedPreviewBodies.get(host) === signature) return;
    const states = previewDetails.map(selector => /** @type {HTMLDetailsElement|null} */ (host.querySelector(selector))?.open);
    const contents = render();
    const oldStage = host.querySelector('[data-market-stage]')?.getAttribute('data-market-stage');
    const newStage = contents.map(content => content.querySelector('[data-market-stage]')).find(Boolean)?.getAttribute('data-market-stage');
    previewDetails.forEach((selector, index) => {
        const details = /** @type {HTMLDetailsElement|undefined} */ (contents.map(content => content.querySelector(selector)).find(Boolean));
        if (details && states[index] !== undefined && oldStage !== 'not_reliable' && newStage !== 'not_reliable') details.open = states[index];
    });
    host.replaceChildren(...contents);
    renderedPreviewBodies.set(host, signature);
}

/** @param {Document} doc @param {HTMLElement} host @param {Preview|null} view */
export function renderAnnualMarketReadings(doc, host, view) {
    updateMarketPreviewBody(host, JSON.stringify(view), () => [createAnnualMarketReadings(doc, view)]);
}

/** @param {Projection} projection */
export function projectionAssumptions(projection) {
    const find = (/** @type {string} */ kind) => projection.assumptions.find(item => item.kind === kind);
    const inflation = find('inflation'), wealth = find('wealth'), quote = find('quote'), cape = find('cape');
    return `Annahmen: Inflation ${number(inflation?.value ?? null, 2)} % (${inflation?.source || 'nicht verfügbar'}) · Vermögen Stand ${date(wealth?.asOf ?? null)} und Kurs Stand ${date(quote?.asOf ?? null)} · Restentnahmen bis Dezember ${find('remaining_withdrawals')?.applied ? 'abgezogen' : 'nicht abgezogen'} · CAPE ${number(cape?.value ?? null, 2)} (Stand ${date(cape?.asOf ?? null)})`;
}

/** Verschiedene Wirkungsarten bleiben einzeln benannt, ohne Gesamtsumme.
 * @param {Projection} projection */
export function projectionReasons(projection) {
    const effects = { need: 'Bedarf', income: 'Einkünfte', planned_flows: 'geplante Zahlungen', budget: 'Budget' };
    return (projection.rule?.reasons || []).map((/** @type {import('./balance-next-year-budget.js').ChangeReason} */ reason) => `${reason.text} ${number(reason.effect === 'planned_flows' ? -reason.amount : reason.amount, 0, true)} € ${effects[reason.effect]}`).join(' · ');
}

/** @param {Document} doc @param {Preview|null} view @param {Projection|null} [projection] */
export function renderBalanceMarketPreview(doc, view, projection = null) {
    if (!doc?.getElementById) return;
    if (projection) view = projection.marketPreview || { withoutQuote: true, withoutQuoteReason: projection.reason,
        quote: null, yearEndDate: null, readingsEqual: true,
        comparison: /** @type {import('./balance-market-preview.js').UnavailableMarketPreview['comparison']} */ (projection.comparison) };
    const reasons = doc.getElementById('balanceBudgetReasons');
    if (reasons) { reasons.hidden = !projection?.rule; reasons.textContent = projection?.rule
        ? `Warum anders als ${projection.closingYear}: ${projectionReasons(projection) || 'Keine Änderungen ab 1 €'}` : ''; }
    const host = doc.getElementById('balanceMarketPreview');
    const ruleSource = doc.getElementById('balanceBudgetRuleSource');
    if (ruleSource) ruleSource.hidden = !view || view.withoutQuote || !view.quote;
    // FR-77 Punkt 5: Das Jahreshoch erscheint nur bei verdecktem Bärenmarkt; alle übrigen Stufen zeigt die App nicht mehr.
    const hidden = view && 'rule' in view && isHiddenBearMarket(view) ? /** @type {MarketPreview} */ (view) : null;
    const budget = doc.getElementById('balanceHighBudget');
    if (budget) { budget.hidden = true; budget.replaceChildren(); }
    if (!host) return;
    // WT-1b (Soll 6): Tragen die Kurse die Prüfung nicht, steht genau eine kleine Zeile mit dem Weg zu frischen Kursen.
    const stale = hidden ? null : hiddenBearPriceProblem(view);
    host.hidden = !hidden && !stale;
    host.setAttribute?.('aria-label', stale ? 'Prüfung auf verdeckten Bärenmarkt' : 'Bärenmarkt, den die Jahresregel nicht sieht');
    const body = doc.getElementById('balanceMarketPreviewBody');
    if (!body) return;
    updateMarketPreviewBody(body, JSON.stringify(hidden || stale), () => hidden ? [createHiddenBearBlock(doc, hidden)] : stale ? [hiddenBearStaleLine(doc, stale)] : []);
    if (!hidden) return;
    const { comparison } = hidden;
    if (budget && ['budget_lower', 'budget_higher'].includes(comparison.state) && comparison.high && comparison.difference) {
        budget.hidden = false;
        // FR-78: Monatsbudget abgerundet; der Unterschied ergibt sich aus den gezeigten Beträgen.
        const shownHigh = displayMonthlyDown(comparison.high.monthlyBudget), shownRule = displayMonthlyDown(comparison.rule?.monthlyBudget);
        const shownDifference = Number.isFinite(shownHigh) && Number.isFinite(shownRule) ? shownHigh - shownRule : comparison.difference.monthlyBudget;
        budget.append(make(doc, 'span', highLabel(hidden)), make(doc, 'strong', `${money(shownHigh)} · ${number(shownDifference, 0, true)} € im Monat`));
    }
}
