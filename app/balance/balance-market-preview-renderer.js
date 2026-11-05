/** Gemeinsame Budgetprüfung für Balance und Jahresabschluss; keine Rechnung oder Speicherung. */
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { classifyMarketPreview, MARKET_NOISE_PCT } from './balance-market-preview.js';
import { createMarketHistory } from './balance-market-history.js';

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
/** @param {MarketPreview} view */
const ruleLabel = view => view.withoutAnnualClose ? 'Bisherige Regel (Jahresmarktdaten Ende VJ)' : 'Bisherige Regel';
/** @param {Preview} view */
const sourceLabel = view => `Referenz VWCE.DE · Schlusskurs ${view.quote ? date(view.quote.asOf) : 'nicht verfügbar'}`;

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

/** Kompakter Vergleich der beiden Lesarten; Abweichungen zusätzlich als Wort.
 * @param {Document} doc @param {MarketPreview} view */
function createHighReadingsTable(doc, view) {
    const comparison = view.comparison;
    if (!comparison.rule || !comparison.high) return make(doc, 'div', '');
    const warning = classifyMarketPreview(view).stage === 'warning';
    const values = [
        ['Hoch', price(view.rule.high.value), price(view.high.high.value)],
        ['Abstand zum Hoch', percent(view.rule.drawdownPct), percent(view.high.drawdownPct)],
        ['Marktlage', view.rule.market.text, view.high.market.text],
        [`Monatsbudget ${Number(view.yearEndDate.slice(0, 4)) + 2}`, money(comparison.rule.monthlyBudget), money(comparison.high.monthlyBudget)],
        ['Verkauf', actionText(comparison.rule), actionText(comparison.high)]
    ];
    const fields = values.map(([label, rule, high]) => {
        const cell = make(doc, 'span', high);
        if (high !== rule && warning) {
            cell.dataset.changed = 'true';
            const delta = comparison.difference?.monthlyBudget || 0;
            cell.append(make(doc, 'small', label.startsWith('Monatsbudget') && delta
                ? `${money(Math.abs(delta))} ${delta < 0 ? 'weniger' : 'mehr'}` : 'anders'));
        }
        return /** @type {[string, (string|HTMLElement)[]]} */ ([label, [rule, cell]]);
    });
    return comparisonTable(doc, ['Jahresendregel', `Mit Jahreshoch ${date(view.high.high.asOf)}`], fields, 'Zwei Lesarten des Hochs');
}

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

/** @param {Document} doc @param {Reading} reading @param {string} label */
function distance(doc, reading, label) {
    const line = make(doc, 'div', '', 'balance-preview-distance');
    line.append(make(doc, 'p', reading.deepBear.reached
        ? `„Tiefer Bärenmarkt“ · ${label}: Grenze unterschritten (Index unter ${price(reading.deepBear.threshold)})`
        : `Bis „Tiefer Bärenmarkt“ · ${label}: noch ${percent(reading.deepBear.remainingDeclinePct)} (Index unter ${price(reading.deepBear.threshold)})`));
    const bar = make(doc, 'div', '', 'balance-preview-bar'), fill = make(doc, 'i', '');
    // Geometrie aus dem projizierten Abstand; keine fachliche Einstufung.
    const reference = reading.deepBear.threshold / 0.8;
    fill.style.width = `${reference > 0 ? Math.min(100, Math.max(0, (1 - reading.index / reference) / 0.2 * 100)) : 0}%`;
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${label}: ${reading.deepBear.reached ? 'Grenze unterschritten' : `noch ${percent(reading.deepBear.remainingDeclinePct)}`} bis Tiefer Bärenmarkt`);
    bar.append(fill); line.append(bar); return line;
}

/** @param {Document} doc @param {string} title @param {boolean} open */
function disclosure(doc, title, open) {
    const details = /** @type {HTMLDetailsElement} */ (make(doc, 'details', '', 'balance-preview-details'));
    details.open = open;
    details.append(make(doc, 'summary', title)); return details;
}

/** Derselbe Ergebnisblock in Vorschau und Kursschritt; rendert ausschließlich BP-1-Werte.
 * @param {Document} doc @param {Preview} view */
function createBudgetComparison(doc, view, annual = false) {
    const host = make(doc, 'div', '');
    const comparison = view.comparison;
    host.dataset.budgetComparison = comparison.state;
    const { stage, gapPct, noise } = classifyMarketPreview(view);
    host.dataset.marketStage = stage;
    if (noise) host.dataset.marketNoise = '';
    const result = make(doc, 'div', '', `balance-preview-result balance-preview-result-${stage}`);
    const titles = { calm: noise ? 'Nahe am Jahreshoch – Grundrauschen, es gilt die Jahresendregel' : 'Nahe am Jahreshoch – keine Auswirkung auf die Planung',
        notice: `Der Kurs liegt ${percent(gapPct)} unter dem Jahreshoch`,
        warning: 'Der Markt war in diesem Jahr schon viel heißer', not_reliable: 'Vergleich mit dem Jahreshoch nicht möglich' };
    if (stage !== 'calm') result.append(make(doc, 'span', { notice: 'Hinweis', warning: 'Prüfen', not_reliable: 'Nicht bewertet' }[stage], 'ds-badge'));
    result.append(make(doc, 'strong', titles[stage]));
    host.append(result);
    if (stage === 'not_reliable' || !('rule' in view) || !comparison.rule || !comparison.high) {
        result.append(make(doc, 'p', comparison.reason || 'Schlusskurse fehlen.'));
        const link = make(doc, 'a', 'Kurse auf Daten & Sicherung holen'); link.setAttribute('href', 'Daten-Sicherung.html#kursdienst'); result.append(link);
        if (annual) result.append(make(doc, 'p', 'Der Abschluss läuft nach der Jahresendregel.'));
        for (const label of ['Budget im Vergleich', 'Markt und Umschichtung']) {
            const details = disclosure(doc, label, false);
            details.dataset[label === 'Budget im Vergleich' ? 'budgetComparisonDetails' : 'marketComparisonDetails'] = '';
            details.append(make(doc, 'p', 'Für den Vergleich fehlen belastbare Schlusskurse. Der Plan folgt der Jahresendregel.', 'ds-source'));
            host.append(details);
        }
        return host;
    }
    const year = Number(view.yearEndDate.slice(0, 4)) + 1;
    const high = view.yearlyHigh || view.quote || { price: view.rule.index, asOf: null };
    const today = annual ? `Ende ${year}` : 'Heute';
    const threshold = view.high.deepBear;
    // Liegt ein älteres gespeichertes Hoch über dem Jahreshoch, rechnen beide Lesarten mit diesem Hoch.
    const olderHigh = view.high.high.origin !== 'stored_close' && view.high.high.value > high.price;
    const reference = olderHigh ? `dem gespeicherten Hoch von ${price(view.high.high.value)}` : 'dem Jahreshoch';
    const measured = olderHigh ? `am gespeicherten Hoch von ${price(view.high.high.value)}` : 'am Jahreshoch';
    const ruleSentence = olderHigh
        ? `Das Jahreshoch liegt unter ${reference}. Beide Lesarten rechnen deshalb mit diesem Hoch: „${view.high.market.text}“.`
        : `Die Jahresendregel vergleicht nur Jahresendkurse. Sie sieht ${price(view.stored.index)} → ${price(view.rule.index)} und damit „${view.rule.market.text}“. Gemessen am Jahreshoch: „${view.high.market.text}“.`;
    const reachedSentence = `Der Kurs liegt schon unter der Grenze zum tiefen Bärenmarkt (${price(threshold.threshold)}, 20 % unter ${reference}). Damit rechnet die App bereits.`;
    // FR-71: Unter 10 % Abstand zum Jahreshoch reagiert die App nicht auf andere Folgen der zweiten Lesart.
    const delta = comparison.difference?.monthlyBudget ?? 0;
    const noiseSentence = `Mit dem Jahreshoch wäre ${delta ? `das Monatsbudget ${year + 1} um ${money(Math.abs(delta))} ${delta < 0 ? 'niedriger' : 'höher'}` : 'die Umschichtung anders'}. `
        + `Unter ${MARKET_NOISE_PCT} % Abstand zum Jahreshoch ist das Grundrauschen. Der Plan folgt der Jahresendregel.`;
    if (stage === 'calm') {
        result.append(make(doc, 'p', `Höchster Schlusskurs ${year}: ${price(high.price)} am ${date(high.asOf)}. ${today} ${price(view.quote?.price ?? null)}, also ${percent(gapPct)} darunter.`),
            make(doc, 'p', noise ? noiseSentence : threshold.reached ? `Ob die App das als neues Hoch oder als junge Korrektur liest, ändert hier weder Budget noch Verkauf. ${reachedSentence}`
                : `Ob die App das als neues Hoch oder als junge Korrektur liest, ändert hier weder Budget noch Verkauf. Das Budget sinkt erst unter ${price(threshold.threshold)} (noch ${percent(threshold.remainingDeclinePct)}).`, 'ds-source'));
    } else {
        if (stage === 'warning') {
            const tiles = make(doc, 'div', '', 'ds-kpi-strip balance-preview-tiles');
            for (const [label, value] of [[`Ende ${year - 1}`, view.stored.index], [`Jahreshoch ${date(high.asOf)}`, high.price], [today, view.quote?.price ?? null]]) {
                const tile = make(doc, 'div', '', 'ds-kpi'); tile.append(make(doc, 'small', String(label), 'ds-source'), make(doc, 'strong', price(Number(value)))); tiles.append(tile);
            }
            result.append(tiles, make(doc, 'p', `${percent(gapPct)} unter dem Jahreshoch`));
        } else result.append(make(doc, 'p', `Ende ${year - 1}: ${price(view.stored.index)} · Jahreshoch ${date(high.asOf)}: ${price(high.price)} · ${today.toLowerCase()} ${price(view.quote?.price ?? null)}`));
        result.append(make(doc, 'p', ruleSentence + (stage === 'notice' ? (noise ? ` ${noiseSentence}` : ' Budget und Verkauf bleiben trotzdem gleich.') : '')));
        if (stage === 'notice') result.append(make(doc, 'p', threshold.reached ? reachedSentence
            : `Ab wann es zählt: Fällt der Kurs unter ${price(threshold.threshold)} (noch ${percent(threshold.remainingDeclinePct)}), wäre es gemessen ${measured} ein tiefer Bärenmarkt. Dann sinkt das Budget.`));
    }
    const changedBudget = ['budget_lower', 'budget_higher'].includes(comparison.state);
    if (stage === 'warning' && comparison.difference) {
        const consequences = make(doc, 'div', '', 'balance-preview-consequences');
        consequences.append(make(doc, 'p', delta === 0 ? `Das Monatsbudget ${year + 1} bleibt gleich: ${money(comparison.rule.monthlyBudget)}. Die Umschichtung unterscheidet sich.`
            : `Mit dem Jahreshoch wäre das Monatsbudget ${year + 1} um ${money(Math.abs(delta))} ${delta < 0 ? 'niedriger' : 'höher'}: ${money(comparison.high.monthlyBudget)} statt ${money(comparison.rule.monthlyBudget)}.`));
        if (actionText(comparison.rule) !== actionText(comparison.high)) consequences.append(make(doc, 'p', `Verkauf nach der Jahresendregel: ${actionText(comparison.rule)}. Mit dem Jahreshoch: ${actionText(comparison.high)}.`));
        result.append(consequences);
        if (!annual) result.append(make(doc, 'p', 'Im Jahresabschluss wählst du, welcher Plan gilt: nach der Jahresendregel oder mit dem Jahreshoch.'));
    }
    const history = disclosure(doc, 'Jahresverlauf', stage !== 'calm'); history.dataset.marketHistoryDetails = '';
    history.append(createMarketHistory(doc, view, annual)); host.append(history);
    if (stage !== 'calm') host.append(make(doc, 'h4', 'Zwei Lesarten des Hochs'), createHighReadingsTable(doc, view));
    const columns = [ruleLabel(view), highLabel(view)];
    const budget = disclosure(doc, 'Budget im Vergleich', changedBudget);
    budget.dataset.budgetComparisonDetails = '';
    const variants = [comparison.rule, comparison.high];
    budget.append(comparisonTable(doc, columns, [
        ['Grundbedarf', variants.map(v => money(v.floor))],
        ['Freigegebener Flex', variants.map(v => money(v.releasedFlex))],
        ['Jahresbudget', variants.map(v => money(v.annualBudget))],
        ['Monatsbudget', variants.map(v => money(v.monthlyBudget))]
    ], 'Budget im Vergleich'));
    const market = disclosure(doc, 'Markt und Umschichtung', false);
    market.dataset.marketComparisonDetails = '';
    market.append(createMarketReadingsTable(doc, [
        { label: columns[0], reading: view.rule }, { label: columns[1], reading: view.high }], comparison));
    const distances = make(doc, 'div', '', 'balance-preview-distances');
    distances.append(distance(doc, view.rule, columns[0]), distance(doc, view.high, columns[1]));
    market.append(distances, make(doc, 'p', 'Reserve nach Aktion, vor der Jahresauszahlung.', 'ds-source'));
    host.append(budget, market); return host;
}

/** @param {Document} doc @param {Preview|null} view */
export function createAnnualMarketReadings(doc, view) {
    const host = make(doc, 'section', '', 'balance-market-preview'); host.dataset.annualMarketReadings = '';
    host.hidden = !view;
    if (!view) return host;
    const header = make(doc, 'div', '', 'balance-preview-head');
    header.append(make(doc, 'h4', 'Abschließende Berechnung mit bestätigten Jahresdaten'), make(doc, 'small', sourceLabel(view), 'ds-source'));
    host.append(header, createBudgetComparison(doc, view, true));
    return host;
}

const renderedPreviewBodies = new WeakMap();
const previewDetails = ['[data-budget-comparison-details]', '[data-market-comparison-details]', '[data-market-history-details]'];
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
        if (details && states[index] !== undefined && oldStage !== 'not_reliable' && newStage !== 'not_reliable'
            && (index !== 2 || oldStage === newStage)) details.open = states[index];
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
    const title = doc.getElementById('balanceMarketPreviewTitle');
    if (title) title.textContent = projection ? `Budgetprüfung für ${projection.targetYear || 'das nächste Jahr'}` : 'Budgetprüfung – wenn heute der 31.12. wäre';
    const subtitle = doc.getElementById('balanceMarketPreviewSubtitle');
    if (subtitle) { subtitle.hidden = !projection; subtitle.textContent = 'Projektion mit heutigen Werten'; }
    const reasons = doc.getElementById('balanceBudgetReasons');
    if (reasons) { reasons.hidden = !projection?.rule; reasons.textContent = projection?.rule
        ? `Warum anders als ${projection.closingYear}: ${projectionReasons(projection) || 'Keine Änderungen ab 1 €'}` : ''; }
    const host = doc.getElementById('balanceMarketPreview');
    const ruleSource = doc.getElementById('balanceBudgetRuleSource');
    if (ruleSource) ruleSource.hidden = !view || view.withoutQuote || !view.quote;
    if (!host) return;
    host.hidden = !view;
    const body = doc.getElementById('balanceMarketPreviewBody');
    const header = doc.getElementById('balanceMarketPreviewHead');
    const budget = doc.getElementById('balanceHighBudget'), action = doc.getElementById('balanceHighAction');
    for (const row of [budget, action]) if (row) { row.hidden = true; row.replaceChildren(); }
    if (!body) return;
    if (header) header.hidden = !view;
    updateMarketPreviewBody(body, JSON.stringify([view, projection ? projectionAssumptions(projection) : null]), () => {
        if (!view) return [];
        const contents = [createBudgetComparison(doc, view)];
        if (projection) contents.push(make(doc, 'p', projectionAssumptions(projection), 'ds-source balance-preview-assumptions'));
        return contents;
    });
    if (!view) return;
    const source = doc.getElementById('balanceMarketPreviewSource');
    if (source) source.textContent = sourceLabel(view);
    if (view.comparison.state === 'not_reliable' || !('rule' in view)) return;
    const { comparison } = view;
    if (budget && ['budget_lower', 'budget_higher'].includes(comparison.state) && comparison.high && comparison.difference) {
        budget.hidden = false;
        budget.append(make(doc, 'span', highLabel(view)), make(doc, 'strong', `${money(comparison.high.monthlyBudget)} · ${number(comparison.difference.monthlyBudget, 0, true)} € im Monat`));
    }
    if (action && comparison.rule && comparison.high) {
        const rule = comparison.rule.mainAction, high = comparison.high.mainAction;
        if (high.type !== rule.type || high.text !== rule.text || Math.round(high.netAmount ?? 0) !== Math.round(rule.netAmount ?? 0)) {
            action.hidden = false;
            action.append(make(doc, 'span', highLabel(view)), make(doc, 'strong', `${high.text}${high.netAmount === null ? '' : ` · ${money(high.netAmount)} netto`}`));
        }
    }
}
