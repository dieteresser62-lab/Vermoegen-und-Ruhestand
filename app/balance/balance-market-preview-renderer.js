/** Allzeithoch in Balance und Jahresabschluss (FR-89): Hoch mit Datum, Abstand, Marktlage, Kursschwelle; keine Rechnung oder Speicherung. */
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { highCheckUnreliable, highPriceProblem, deepBearThreshold } from './balance-market-preview.js';
import { ATH_NOISE_BAND_TEXT, athDistancePct, athNoiseBandApplies } from './balance-ath-noise.js';

/** @typedef {ReturnType<typeof import('./balance-market-preview.js').projectMarketPreview>} MarketPreview */
/** @typedef {MarketPreview|import('./balance-market-preview.js').UnavailableMarketPreview} Preview */
/** @typedef {ReturnType<typeof import('./balance-next-year-budget.js').projectNextYearBudget>} Projection */
/** @param {string|null} value */
const date = value => value ? value.split('-').reverse().join('.') : 'Datum nicht belegt';
/** @param {number|null} value @param {number} digits @param {boolean} [signed] */
const number = (value, digits, signed = false) => `${signed && value !== null && value > 0 ? '+' : value !== null && value < 0 ? '−' : ''}${formatDisplayNumber(value === null ? null : Math.abs(value), { fractionDigits: digits })}`;
/** @param {number|null} value */
const price = value => `${number(value, 2)} €`;
/** @param {number|null} value */
const percent = value => `${number(value, 1)} %`;
/** @param {Document} doc @param {string} tag @param {string} text @param {string} [className] */
const make = (doc, tag, text, className = '') => {
    const node = doc.createElement(tag); node.textContent = text; node.className = className; return node;
};

/** Herkunft des Allzeithochs (ATH-1b): „Tagesschluss vom …“, „Jahresschluss vom …“ oder „gespeicherter Wert“, nach einem Split
 * mit „nach Split am …“. @param {MarketPreview['high']} high */
export function marketHighSource(high) {
    const source = high.source ?? (high.dated ? 'daily' : 'stored');
    const text = source === 'stored' || !high.asOf ? 'gespeicherter Wert'
        : `${source === 'year_end' ? 'Jahresschluss' : 'Tagesschluss'} vom ${date(high.asOf)}`;
    return high.splitAsOf ? `${text} · nach Split am ${date(high.splitAsOf)}` : text;
}

/** Wo sich ein Tageskurs ausnehmen oder ein Split eintragen lässt. */
export const ATH_CORRECTION_PLACE = 'Balance › „Alle Parameter“ › „Marktdaten-Korrektur“';
/** Warnhinweise zum Hoch (ATH-1b); sie verwerfen nichts. @param {MarketPreview['warnings']|undefined} warnings @returns {string[]} */
export function marketHighWarningTexts(warnings) {
    return [warnings?.outlier ? `Ausreißer-Verdacht – Kurs prüfen: Der Tagesschluss vom ${date(warnings.outlier.asOf)} liegt ${percent(warnings.outlier.pctOverPrevious)} über dem Vortag. Ist er falsch, markiere ihn unter ${ATH_CORRECTION_PLACE} als „nicht verwenden“.` : null,
        warnings?.drop ? `Möglicher Split oder Datenfehler: Am ${date(warnings.drop.asOf)} liegt der Tagesschluss ${percent(warnings.drop.pctDrop)} unter dem Vortag. Einen Split trägst du unter ${ATH_CORRECTION_PLACE} ein.` : null]
        .filter(text => text !== null);
}

/** Kursschwelle „tiefer Bär“ mit Restabstand; kürzt die Engine schon, „Kürzung aktiv“.
 * @param {MarketPreview['deepBear']} deepBear */
export function deepBearText(deepBear) {
    return deepBear.cutActive ? `unter ${price(deepBear.threshold)} · Kürzung aktiv`
        : `unter ${price(deepBear.threshold)} · noch ${percent(deepBear.remainingDeclinePct)} Abstand`;
}

/** Marktkachel der Diagnose (FR-89): stellt den Zeilen Abstand, Seit dem Hoch, … das Allzeithoch mit Herkunft voran und die
 * Kursschwelle „tiefer Bär“ hinter „Seit dem Hoch“. Werte der Rechnung, die die Kachel zeigt; ohne Hoch bleiben beide Zeilen leer.
 * @param {{ath?: number, endeVJ?: number}} input @param {string|undefined} marketKey @param {Preview|null|undefined} preview
 * @param {[string, string|null, ...unknown[]][]} rows */
export function withMarketHighRows(input, marketKey, preview, rows) {
    const known = typeof input.ath === 'number' && Number.isFinite(input.ath) && input.ath > 0;
    const source = preview && 'high' in preview && preview.high.value === input.ath ? marketHighSource(preview.high) : 'aus den Jahresmarktdaten';
    const bear = known && typeof input.endeVJ === 'number' && Number.isFinite(input.endeVJ)
        ? deepBearText(deepBearThreshold(/** @type {{ath: number, endeVJ: number}} */ (input), marketKey)) : null;
    const [distance, since, ...rest] = rows, noise = athNoiseBandApplies(input);
    // Im Grundrauschen rechnet die Engine am Hoch; die Kachel nennt das und den echten Abstand (FR-89, Ergänzung 3).
    return [['Allzeithoch', known ? `${price(/** @type {number} */ (input.ath))} · ${source}${noise ? ` · ${ATH_NOISE_BAND_TEXT}` : ''}` : null],
        noise ? [distance[0], formatDisplayNumber(athDistancePct(input), { unit: 'percent' })] : distance, since, ['Tiefer Bär', bear], ...rest];
}

/** Zeilen zum Allzeithoch für den Jahresabschluss; die Marktkachel der Balance zeigt dieselben Werte in ihren Zeilen.
 * @param {MarketPreview} view @returns {[string, string][]} */
export function marketHighRows(view) {
    return [['Allzeithoch', `${price(view.high.value)} · ${marketHighSource(view.high)}${athNoiseBandApplies(view.inputs) ? ` · ${ATH_NOISE_BAND_TEXT}` : ''}`],
        [view.quote ? `Abstand am ${date(view.quote.asOf)}` : 'Abstand zum Allzeithoch', percent(view.drawdownPct)],
        ['Marktlage', view.market.text], ['Tiefer Bär', deepBearText(view.deepBear)]];
}

/** Jahresabschluss, Schritt Marktdaten: Allzeithoch, Abstand, Marktlage und Kursschwelle. Fehlen Kurse und käme es auf sie an,
 * steht darunter „nicht belastbar“ mit dem Weg zu frischen Kursen.
 * @param {Document} doc @param {Preview|null} view */
export function createAnnualMarketReadings(doc, view) {
    const host = make(doc, 'section', '', 'balance-market-preview'); host.dataset.annualMarketReadings = '';
    host.hidden = !view;
    if (!view) return host;
    if ('market' in view && view.market) {
        host.append(make(doc, 'h4', 'Allzeithoch und Marktlage'));
        for (const [label, value] of marketHighRows(view)) {
            const row = make(doc, 'div', '', 'balance-row ds-row');
            row.append(make(doc, 'span', label), make(doc, 'strong', value));
            host.append(row);
        }
        for (const text of marketHighWarningTexts(view.warnings)) {
            const note = make(doc, 'p', text, 'ds-note ds-note-warning'); note.dataset.athWarning = ''; host.append(note);
        }
        if (view.high.origin === 'daily_close') host.append(make(doc, 'p', `Ist dieser Tagesschluss falsch, markierst du ihn unter ${ATH_CORRECTION_PLACE} als „nicht verwenden“; die App bestimmt das Hoch dann neu.`, 'ds-source'));
    }
    if (!highCheckUnreliable(view)) return host;
    const result = make(doc, 'div', '', 'balance-preview-result balance-preview-result-not_reliable');
    result.dataset.marketStage = 'not_reliable';
    result.append(make(doc, 'span', 'Nicht belastbar', 'ds-badge'), make(doc, 'strong', 'Allzeithoch nur aus den bekannten Kursen'),
        make(doc, 'p', view.unreliableReason || view.withoutQuoteReason || 'Schlusskurse fehlen.'));
    const link = make(doc, 'a', 'Kurse auf Daten & Sicherung holen'); link.setAttribute('href', 'Daten-Sicherung.html#kursdienst');
    result.append(link, make(doc, 'p', 'Der Abschluss rechnet mit dem höchsten bekannten Wert.'));
    host.append(result);
    return host;
}

/** „Kurse älter als 10 Tage – Allzeithoch nicht belastbar · Kurse holen →“; fehlen Kurse oder sind sie lückenhaft,
 * „Kurse fehlen oder sind lückenhaft – …“ (WT-1b, WT-1c).
 * @param {Document} doc @param {'stale'|'missing'} problem */
function highStaleLine(doc, problem) {
    const reason = problem === 'stale' ? 'Kurse älter als 10 Tage' : 'Kurse fehlen oder sind lückenhaft';
    const line = make(doc, 'p', `${reason} – Allzeithoch nicht belastbar · `, 'ds-source');
    line.dataset.highStale = '';
    const link = make(doc, 'a', 'Kurse holen →'); link.setAttribute('href', 'Daten-Sicherung.html#kursdienst');
    line.append(link);
    return line;
}

const renderedPreviewBodies = new WeakMap();
/** Gleiche Ergebnisse behalten ihre DOM-Knoten. @param {HTMLElement} host @param {string} signature @param {()=>HTMLElement[]} render */
function updateMarketPreviewBody(host, signature, render) {
    if (renderedPreviewBodies.get(host) === signature) return;
    host.replaceChildren(...render());
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
    return (projection.plan?.reasons || []).map((/** @type {import('./balance-next-year-budget.js').ChangeReason} */ reason) => `${reason.text} ${number(reason.effect === 'planned_flows' ? -reason.amount : reason.amount, 0, true)} € ${effects[reason.effect]}`).join(' · ');
}

/** Balance, Karte „Was zu tun ist“: Tragen die Kurse das Allzeithoch nicht, steht dort genau eine kleine Zeile mit dem Weg zu
 * frischen Kursen (WT-1b Soll 6). Hoch, Abstand, Marktlage und Kursschwelle stehen in der Marktkachel der Diagnose.
 * @param {Document} doc @param {Preview|null} view @param {Projection|null} [projection] */
export function renderBalanceMarketPreview(doc, view, projection = null) {
    if (!doc?.getElementById) return;
    if (projection) view = projection.marketPreview || { withoutQuote: true, withoutQuoteReason: projection.reason || '',
        unreliableReason: projection.reason || '', quote: null, yearEndDate: null };
    const reasons = doc.getElementById('balanceBudgetReasons');
    if (reasons) { reasons.hidden = !projection?.plan; reasons.textContent = projection?.plan
        ? `Warum anders als ${projection.closingYear}: ${projectionReasons(projection) || 'Keine Änderungen ab 1 €'}` : ''; }
    const host = doc.getElementById('balanceMarketPreview');
    if (!host) return;
    const stale = highPriceProblem(view);
    host.hidden = !stale;
    const body = doc.getElementById('balanceMarketPreviewBody');
    if (!body) return;
    updateMarketPreviewBody(body, JSON.stringify(stale), () => stale ? [highStaleLine(doc, stale)] : []);
}
