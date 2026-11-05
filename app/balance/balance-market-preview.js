/** Reine Marktprojektion; Jahresendregel, Tageskurse und Anzeige ohne Speicherwrites. */
/** @import {EngineInput, EngineSuccess} from '../../typcheck/rechenkern.js' */
/** @import {DailyPrices} from '../../typcheck/tranches-history.js' */
import { projectBalanceBudget } from './balance-budget.js';
import { summarizeBalanceAction } from './balance-action-summary.js';
import { historyGaps } from '../tranches/tranchen-history-store.js';

/** @typedef {Required<Pick<EngineInput, 'endeVJ'|'endeVJ_1'|'endeVJ_2'|'endeVJ_3'|'ath'|'jahreSeitAth'>>} AnnualMarketInputs */
/** @typedef {{value: number, origin: 'year_end'|'rule_high'|'stored_ath'|'stored_close', asOf: string|null,
 * coverage?: {first: string|null, last: string|null}, coverageShorterThanAth?: boolean}} PreviewHigh */
/** @typedef {{inputs: AnnualMarketInputs, dailyPrices: DailyPrices|null, today: string,
 * yearEndDate: string, hasAnnualClose: boolean, storedHighAsOf?: string|null,
 * quoteOverride?: {price: number, asOf: string}}} MarketPreviewOptions */
/** @typedef {{withoutQuote: true, withoutQuoteReason: string, quote: null,
 * yearEndDate: null, readingsEqual: true, comparison: ReturnType<typeof unavailableBudgetComparison>}} UnavailableMarketPreview */

/** Identische Verschiebung wie im Jahresabschluss, einschließlich Gleichstand am Hoch.
 * @param {AnnualMarketInputs} oldInputs @param {number} price @returns {AnnualMarketInputs} */
export function deriveYearEndMarketInputs(oldInputs, price) {
    return { endeVJ: price, endeVJ_1: oldInputs.endeVJ, endeVJ_2: oldInputs.endeVJ_1, endeVJ_3: oldInputs.endeVJ_2,
        ath: price > oldInputs.ath ? price : oldInputs.ath,
        jahreSeitAth: price >= oldInputs.ath ? 0 : oldInputs.jahreSeitAth + 1 };
}

/** @param {string} date @returns {number} */
function day(date) {
    const time = Date.parse(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time)
        || new Date(time).toISOString().slice(0, 10) !== date) throw new Error('Ungültiges Datum der Marktvorschau.');
    return time / 86400000;
}
/** @param {number} value @returns {string} */
const dateOf = value => new Date(value * 86400000).toISOString().slice(0, 10);

/** Letzter gespeicherter VWCE.DE-Schluss; bei offenem Abschluss keine Kurse des Folgejahrs.
 * Gleiche Höchstkurse verwenden den jüngsten Tag, also die tatsächliche Zeit seit dem letzten Hoch.
 * @param {MarketPreviewOptions} options */
export function prepareMarketPreview(options) {
    const { inputs, dailyPrices, today, yearEndDate, storedHighAsOf = null } = options;
    const start = day(yearEndDate), closingYear = Number(yearEndDate.slice(0, 4)) + 1;
    const evaluationDay = Math.min(day(today), day(`${closingYear}-12-31`));
    const cutoff = Math.min(evaluationDay, options.quoteOverride ? day(options.quoteOverride.asOf) : Infinity);
    const series = dailyPrices?.symbols['VWCE.DE'];
    const index = series?.currency === 'EUR' ? series.days.findLastIndex(value => value <= cutoff) : -1;
    const candidate = series && index >= 0
        ? options.quoteOverride || { price: series.closes[index], asOf: dateOf(series.days[index]) } : null;
    const quote = candidate && day(candidate.asOf) > start && day(candidate.asOf) <= cutoff ? candidate : null;
    let yearlyHigh = /** @type {{price: number, asOf: string}|null} */ (null);
    if (series && quote) for (let i = 0; i <= index; i++) {
        if (series.days[i] < start) continue;
        const asOf = dateOf(series.days[i]);
        const price = options.quoteOverride?.asOf === asOf ? options.quoteOverride.price : series.closes[i];
        if (!yearlyHigh || price >= yearlyHigh.price) {
            yearlyHigh = { price, asOf };
        }
    }
    const baseYear = Number(yearEndDate.slice(0, 4));
    const highDate = storedHighAsOf || (Number.isInteger(inputs.jahreSeitAth)
        ? `${baseYear - inputs.jahreSeitAth}-12-31` : null);
    const storedHigh = /** @type {PreviewHigh} */ ({ value: inputs.ath, origin: 'year_end', asOf: storedHighAsOf });
    const ruleInputs = quote ? deriveYearEndMarketInputs(inputs, quote.price) : { ...inputs };
    const ruleHigh = /** @type {PreviewHigh} */ (quote && quote.price >= inputs.ath
        ? { value: ruleInputs.ath, origin: 'rule_high', asOf: quote.asOf } : { ...storedHigh });
    const highInputs = { ...ruleInputs };
    const coverage = { first: series && index >= 0 ? dateOf(series.days[0]) : null,
        last: series && index >= 0 ? dateOf(series.days[index]) : null };
    const closeOverrides = yearlyHigh !== null && (yearlyHigh.price > ruleInputs.ath
        || yearlyHigh.price === ruleInputs.ath && (!ruleHigh.asOf || yearlyHigh.asOf >= ruleHigh.asOf));
    const high = /** @type {PreviewHigh} */ (closeOverrides && yearlyHigh
        ? { value: yearlyHigh.price, origin: 'stored_close', asOf: yearlyHigh.asOf, coverage,
            coverageShorterThanAth: coverage.first !== null && (highDate !== null
                ? coverage.first > highDate : (start - day(coverage.first)) / 365.2425 < inputs.jahreSeitAth) }
        : { value: ruleInputs.ath, origin: 'stored_ath', asOf: quote && quote.price >= inputs.ath ? quote.asOf : storedHighAsOf, coverage });
    if (quote && high.value > ruleInputs.ath && high.asOf) {
        highInputs.ath = high.value;
        // Nur ein echt höherer Schluss ändert das Hoch und sein Alter.
        highInputs.jahreSeitAth = (day(quote.asOf) - day(high.asOf)) / 365.2425;
    }
    const unreliableReason = !quote ? 'kein Tageskurs seit Jahresende VJ'
        : evaluationDay - day(quote.asOf) > 10 ? 'letzter Schlusskurs älter als 10 Kalendertage'
            : series && historyGaps(series.days[0], day(quote.asOf), series.queried).length
                ? 'Kursreihe hat ungeprüfte Tage – Kurse auf der Seite Daten & Sicherung holen' : null;
    return { ...options, quote, yearlyHigh, cutoff: dateOf(cutoff), closingYear,
        storedHigh, ruleHigh, high, ruleInputs, highInputs, withoutQuote: quote === null,
        withoutQuoteReason: quote ? null : 'kein Tageskurs seit Jahresende VJ', unreliableReason };
}

/** @param {string} reason */
export function unavailableBudgetComparison(reason) {
    return { state: /** @type {const} */ ('not_reliable'), text: 'Vergleich nicht belastbar verfügbar', reason,
        rule: null, high: null, difference: null, changedParts: [] };
}

/** Lesende Projektion der fertigen Budgetentscheidung, ohne erneute Policyrechnung.
 * @param {EngineSuccess} result */
function budgetVariant(result) {
    const { ui, input } = result, summary = summarizeBalanceAction(ui.action, ui.action);
    const budget = projectBalanceBudget({ ...ui, input }).budget;
    const monthlyBudget = budget === null ? null : Math.round(budget);
    const annualBudget = monthlyBudget === null ? null : monthlyBudget * 12;
    const floor = input.floorBedarf;
    const sources = ui.action.quellen || [];
    const reserveAfterAction = (input.aktuelleLiquiditaet ?? ((input.tagesgeld ?? 0) + (input.geldmarktEtf ?? 0)))
        + (ui.action.verwendungen?.liquiditaet ?? 0)
        - sources.filter(source => source.kind === 'liquiditaet').reduce((sum, source) => sum + source.brutto, 0);
    return { floor, releasedFlex: annualBudget === null ? null : annualBudget - floor, annualBudget, monthlyBudget,
        mainAction: { type: ui.action.type, text: summary.verb, netAmount: summary.amount },
        goldPurchase: ui.action.verwendungen?.gold ?? 0, tax: ui.action.steuer ?? 0, reserveAfterAction };
}

/** @param {number|null|undefined} value */
const euro = value => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN;
/** Verkauf und Umschichtung einschließlich ihrer Quellen und Ziele vergleichen.
 * @param {EngineSuccess} result @param {ReturnType<typeof budgetVariant>} variant */
function actionSignature(result, variant) {
    const action = /** @type {import('../../typcheck/balance-ui.js').Action} */ (result.ui.action);
    return JSON.stringify({ type: variant.mainAction.type, text: variant.mainAction.text,
        net: euro(variant.mainAction.netAmount), tax: euro(variant.tax), reserve: euro(variant.reserveAfterAction),
        sources: (action.quellen || []).map(source => JSON.stringify([source.kind,
            euro(source.brutto), euro(source.netto), euro(source.steuer)])).sort(),
        uses: Object.entries(action.verwendungen || {}).filter(([, value]) => euro(value) !== 0)
            .map(([key, value]) => [key, euro(value)]).sort(),
        transfer: action.internalCashRebalance ? [action.internalCashRebalance.from, action.internalCashRebalance.to,
            euro(action.internalCashRebalance.amount), euro(action.internalCashRebalance.netto)] : null });
}

/** Beide Varianten bleiben zusammen mit Budget, Handlung, Steuer und Reserve zugeordnet.
 * @param {EngineSuccess} ruleResult @param {EngineSuccess} highResult @param {string|null} [reason] */
export function compareMarketBudgets(ruleResult, highResult, reason = null) {
    const rule = budgetVariant(ruleResult), high = budgetVariant(highResult);
    if (reason) return { ...unavailableBudgetComparison(reason), rule, high };
    if ([rule, high].some(value => [value.floor, value.releasedFlex, value.annualBudget, value.monthlyBudget,
        value.tax, value.reserveAfterAction].some(amount => !Number.isFinite(euro(amount))))) {
        return { ...unavailableBudgetComparison('Vorschauergebnis unvollständig'), rule, high };
    }
    const difference = { annualBudget: euro(high.annualBudget) - euro(rule.annualBudget),
        monthlyBudget: euro(high.monthlyBudget) - euro(rule.monthlyBudget),
        floor: euro(high.floor) - euro(rule.floor), releasedFlex: euro(high.releasedFlex) - euro(rule.releasedFlex) };
    const changedParts = [difference.floor !== 0 || (high.annualBudget ?? Infinity) < high.floor ? 'floor' : null,
        difference.releasedFlex !== 0 ? 'flex' : null].filter(Boolean);
    const state = difference.annualBudget < 0 || difference.annualBudget === 0 && difference.monthlyBudget < 0 ? 'budget_lower'
        : difference.annualBudget > 0 || difference.monthlyBudget > 0 ? 'budget_higher'
            : actionSignature(ruleResult, rule) === actionSignature(highResult, high) ? 'same' : 'budget_same_action_differs';
    const texts = { same: 'Keine Auswirkung auf die Planung',
        budget_same_action_differs: 'Budget unverändert · andere Vermögensumschichtung',
        budget_lower: 'Budgetentscheidung vor dem Jahresabschluss prüfen',
        budget_higher: 'Die zweite Variante ergibt ein höheres Budget – kein Anlass zur Kürzung' };
    return { state, text: texts[state], reason: null, rule, high, difference, changedParts };
}

/** @param {AnnualMarketInputs} inputs @param {PreviewHigh} high
 * @param {EngineSuccess} result @param {number|null} yearEndPrice */
function reading(inputs, high, result, yearEndPrice) {
    const market = result.ui.market, threshold = inputs.ath * 0.8;
    const summary = summarizeBalanceAction(result.ui.action, result.ui.action);
    return { inputs: { ...inputs }, index: inputs.endeVJ, high, drawdownPct: market.abstandVomAthProzent,
        changeSinceYearEndPct: yearEndPrice && yearEndPrice > 0 ? (inputs.endeVJ / yearEndPrice - 1) * 100 : null,
        market: { key: market.sKey, text: market.szenarioText },
        deepBear: { threshold, exclusive: true, reached: inputs.endeVJ < threshold,
            remainingDeclinePct: inputs.endeVJ > 0 ? Math.max(0, (inputs.endeVJ - threshold) / inputs.endeVJ * 100) : null },
        monthsSinceHigh: inputs.jahreSeitAth * 12,
        monthlyBudget: projectBalanceBudget({ ...result.ui, input: result.input }).budget,
        mainAction: { type: result.ui.action.type, text: summary.verb, netAmount: summary.amount } };
}

/** Ein Anzeigeobjekt für alle Lesarten; Ergebnisse und Marktlage stammen aus der Engine.
 * @param {ReturnType<typeof prepareMarketPreview>} prepared
 * @param {{stored: EngineSuccess, rule: EngineSuccess, high: EngineSuccess}} results */
export function projectMarketPreview(prepared, results) {
    const stored = reading(prepared.inputs, prepared.storedHigh, results.stored, null);
    const rule = reading(prepared.ruleInputs, prepared.ruleHigh, results.rule, prepared.inputs.endeVJ);
    const high = reading(prepared.highInputs, prepared.high, results.high, prepared.inputs.endeVJ);
    // Die Jahresendregel kann das gespeicherte Hoch nur anheben. Ihre künftige
    // Kürzungsschwelle bleibt deshalb das Hoch vor der Fortschreibung.
    rule.deepBear.threshold = prepared.inputs.ath * 0.8;
    rule.deepBear.reached = rule.index < rule.deepBear.threshold;
    rule.deepBear.remainingDeclinePct = rule.index > 0 ? Math.max(0, (rule.index - rule.deepBear.threshold) / rule.index * 100) : null;
    const series = prepared.dailyPrices?.symbols['VWCE.DE'];
    const closes = series?.currency === 'EUR' ? series.days.flatMap((value, i) => {
        const asOf = dateOf(value);
        return asOf >= prepared.yearEndDate && asOf <= (prepared.quote?.asOf || prepared.cutoff)
            ? [{ asOf, price: series.closes[i] }] : [];
    }) : [];
    const quote = prepared.quote;
    if (quote) {
        const existing = closes.findIndex(point => point.asOf === quote.asOf);
        if (existing >= 0) closes[existing] = { ...quote }; else closes.push({ ...quote });
    }
    return { ticker: 'VWCE.DE', quote: prepared.quote, yearlyHigh: prepared.yearlyHigh, cutoff: prepared.cutoff,
        closes,
        yearEndDate: prepared.yearEndDate, withoutQuote: prepared.withoutQuote, withoutQuoteReason: prepared.withoutQuoteReason,
        withoutAnnualClose: !prepared.hasAnnualClose,
        storedLabel: prepared.hasAnnualClose ? `Plan ${prepared.closingYear} / Januar` : 'Jahresmarktdaten Ende VJ',
        comparison: compareMarketBudgets(results.rule, results.high, prepared.unreliableReason),
        stored, rule, high, readingsEqual: rule.market.key === high.market.key && rule.monthlyBudget === high.monthlyBudget };
}

/** Unter diesem Abstand zum Jahreshoch ist ein Unterschied der Lesarten Grundrauschen: keine Warnung, keine Wahl (FR-71). */
export const MARKET_NOISE_PCT = 10;

/** Gemeinsame Anzeigestufe (FR-71); die Engine-Marktlage bleibt unverändert.
 * Unter 5 % ruhig, unter 10 % höchstens ein Hinweis, ab 10 % mit anderen Folgen eine Warnung mit Wahl.
 * @param {ReturnType<typeof projectMarketPreview>|UnavailableMarketPreview} view
 * @param {ReturnType<typeof compareMarketBudgets>|ReturnType<typeof unavailableBudgetComparison>} [comparison]
 * @returns {{stage: 'calm'|'notice'|'warning'|'not_reliable', gapPct: number, noise: boolean}} */
export function classifyMarketPreview(view, comparison = view.comparison) {
    // Abstand zum höchsten Schluss seit Ende VJ, auch wenn ein älteres gespeichertes Hoch darüber liegt.
    const yearlyHigh = 'yearlyHigh' in view ? view.yearlyHigh : null;
    const gapPct = yearlyHigh && view.quote && yearlyHigh.price > 0
        ? Math.max(0, (yearlyHigh.price - view.quote.price) / yearlyHigh.price * 100) : 0;
    // Die Stufe folgt dem angezeigten Wert mit einer Nachkommastelle: „5,0 %“ ist nie ruhig.
    const shown = Math.round(gapPct * 10) / 10;
    const differs = comparison.state !== 'same' && comparison.state !== 'not_reliable';
    const stage = comparison.state === 'not_reliable' ? 'not_reliable'
        : shown < 5 ? 'calm' : shown < MARKET_NOISE_PCT || !differs ? 'notice' : 'warning';
    // noise: Die Lesarten unterscheiden sich, der Abstand liegt aber im Grundrauschen; es gilt die Jahresendregel.
    return { stage, gapPct, noise: differs && stage !== 'warning' };
}
