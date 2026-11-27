/** Reine Marktprojektion: ein Allzeithoch aus gespeichertem Hoch, Stichtagskurs und Tagesschlüssen (FR-89); ohne Speicherwrites. */
/** @import {EngineInput, EngineSuccess} from '../../typcheck/rechenkern.js' */
/** @import {DailyPrices, PriceRecord} from '../../typcheck/tranches-history.js' */
import { historyGaps } from '../tranches/tranchen-history-store.js';
import { CONFIG } from '../../engine/config.mjs';
import { athDistancePct, athNoiseBandApplies } from './balance-ath-noise.js';

/** @typedef {Required<Pick<EngineInput, 'endeVJ'|'endeVJ_1'|'endeVJ_2'|'endeVJ_3'|'ath'|'jahreSeitAth'>>} AnnualMarketInputs */
/** `stored`: gespeichertes Hoch (`dated` = Datum belegt, sonst abgeleitet); `quote`: Stichtagskurs; `daily_close`: gespeicherter Tagesschluss.
 * Anzeige (ATH-1b): `source` Tagesschluss, Jahresschluss oder gespeicherter Wert; `splitAsOf` beim gespeicherten Hoch vor einem Split.
 * @typedef {{value: number, asOf: string|null, origin: 'stored'|'quote'|'daily_close', dated: boolean,
 * source?: 'daily'|'year_end'|'stored', splitAsOf?: string|null}} MarketHigh */
/** ATH-1b: vom Nutzer als „nicht verwenden“ markierte Tage und der Tag des letzten eingetragenen Splits.
 * @typedef {{ignoredCloses?: string[], splitFrom?: string|null}} HighCorrections */
/** @typedef {{inputs: AnnualMarketInputs, dailyPrices: DailyPrices|null, today: string,
 * yearEndDate: string, hasAnnualClose: boolean, storedHighAsOf?: string|null, ageUntil?: string,
 * corrections?: HighCorrections, yearEndAsOf?: string|null, historyStart?: string|null, quoteOverride?: {price: number, asOf: string}}} MarketPreviewOptions */
/** @typedef {{withoutQuote: true, withoutQuoteReason: string, unreliableReason: string, quote: null, yearEndDate: null}} UnavailableMarketPreview */

/** Jahresendregel: Verschiebung der Jahresendstände, Gleichstand am Hoch setzt das Alter auf 0.
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

/** Gespeichertes Hoch: belegtes Datum, sonst die bisherige Ableitung `<Jahr − jahreSeitAth>-12-31`.
 * @param {AnnualMarketInputs} inputs @param {string|null} storedHighAsOf @param {string} yearEndDate @returns {MarketHigh} */
export function storedMarketHigh(inputs, storedHighAsOf, yearEndDate) {
    const derived = Number.isInteger(inputs.jahreSeitAth) && inputs.jahreSeitAth >= 0
        ? `${Number(yearEndDate.slice(0, 4)) - inputs.jahreSeitAth}-12-31` : null;
    return { value: inputs.ath, asOf: storedHighAsOf || derived, origin: 'stored', dated: Boolean(storedHighAsOf) };
}

/** Gültige EUR-Tagesschlüsse für das Hoch bis `end` (Tagesnummer): ohne markierte Tage, nicht vor dem letzten Split (ATH-1b).
 * Der Stichtagskurs ersetzt den gespeicherten Schluss seines Tages.
 * @param {PriceRecord|null|undefined} series @param {number} end @param {HighCorrections} corrections
 * @param {{price: number, asOf: string}|null} [quote] @returns {{asOf: string, price: number}[]} */
function usableCloses(series, end, corrections, quote = null) {
    if (series?.currency !== 'EUR') return [];
    const ignored = new Set(corrections.ignoredCloses || []), splitFrom = corrections.splitFrom || null;
    return series.days.flatMap((value, index) => {
        const asOf = dateOf(value);
        if (value > end || ignored.has(asOf) || splitFrom && asOf < splitFrom) return [];
        return [{ asOf, price: quote?.asOf === asOf ? quote.price : series.closes[index] }];
    });
}

/** FR-89: ein Allzeithoch für Vorschau und Jahresabschluss. Es ist der höchste Wert aus gespeichertem Hoch, Stichtagskurs und
 * allen gespeicherten EUR-Tagesschlüssen bis zum Stichtag, auch vor dem letzten 31.12.; bei Gleichstand gilt der jüngste Tag.
 * Das Hoch sinkt nie. Bleibt es beim Stichtagskurs, ist das Alter 0; beim gespeicherten Hoch ohne belegtes Datum gilt die
 * Jahresendregel +1. Ein Tagesschluss und ein gespeichertes Hoch mit belegtem Datum zählen ihr Alter in Bruchjahren bis
 * `ageUntil` (Vorschau: Kursdatum, Abschluss: 31.12.; ATH-1b, Gutachten P2-3).
 * ATH-1b: Als „nicht verwenden“ markierte Tage und Schlüsse vor dem letzten Split zählen nicht; es gibt keinen automatischen Filter.
 * @param {{inputs: AnnualMarketInputs, quote: {price: number, asOf: string}, yearEndDate: string,
 * storedHighAsOf?: string|null, series?: PriceRecord|null, ageUntil: string, corrections?: HighCorrections}} options
 * @returns {{inputs: AnnualMarketInputs, high: MarketHigh}} */
export function deriveMarketHigh({ inputs, quote, yearEndDate, storedHighAsOf = null, series = null, ageUntil, corrections = {} }) {
    const ruleInputs = deriveYearEndMarketInputs(inputs, quote.price);
    const ruleHigh = /** @type {MarketHigh} */ (quote.price >= inputs.ath
        ? { value: quote.price, asOf: quote.asOf, origin: 'quote', dated: true }
        : storedMarketHigh(inputs, storedHighAsOf, yearEndDate));
    let high = ruleHigh;
    for (const { asOf, price } of usableCloses(series, day(quote.asOf), corrections, quote)) {
        if (price > high.value || price === high.value && (high.asOf === null || asOf > high.asOf)) {
            high = { value: price, asOf, origin: 'daily_close', dated: true };
        }
    }
    if (high === ruleHigh && !(high.origin === 'stored' && high.dated)) return { inputs: ruleInputs, high };
    return { inputs: { ...ruleInputs, ath: high.value,
        jahreSeitAth: Math.max(0, (day(ageUntil) - day(/** @type {string} */ (high.asOf))) / 365.2425) }, high };
}

/** ATH-1b: Warnhinweise zum Hoch, die nichts verwerfen. Ausreißer-Verdacht: Der Tag des Hochs liegt mehr als 5 % über beiden
 * Nachbartagen bzw. über dem Vortag, wenn der Folgetag fehlt. Split- oder Fehlerverdacht: ein Tagesschluss mehr als 30 % unter dem
 * Vortag, gesucht vom Hoch bis zum Stichtag. Nachbarn sind die gültigen Schlüsse (ohne markierte Tage, nicht vor dem Split).
 * @param {{series?: PriceRecord|null, high: MarketHigh, quote: {price: number, asOf: string}, corrections?: HighCorrections}} options */
export function marketHighWarnings({ series, high, quote, corrections = {} }) {
    const closes = usableCloses(series, day(quote.asOf), corrections, quote);
    if (!closes.some(close => close.asOf === quote.asOf)) closes.push({ ...quote });
    let outlier = null, drop = null;
    if (high.origin !== 'stored' && high.asOf) {
        const previous = closes.filter(close => close.asOf < /** @type {string} */ (high.asOf)).at(-1);
        const next = closes.find(close => close.asOf > /** @type {string} */ (high.asOf));
        if (previous && high.value > previous.price * (1 + OUTLIER_SHARE) && (!next || high.value > next.price * (1 + OUTLIER_SHARE))) {
            outlier = { asOf: high.asOf, pctOverPrevious: (high.value / previous.price - 1) * 100 };
        }
    }
    for (let index = 1; index < closes.length && !drop; index++) {
        const previous = closes[index - 1], current = closes[index];
        if (high.asOf && current.asOf <= high.asOf) continue;
        if (current.price < previous.price * (1 - DROP_SHARE)) drop = { asOf: current.asOf, pctDrop: (1 - current.price / previous.price) * 100 };
    }
    return { outlier, drop };
}
/** Ausreißer-Verdacht ab 5 % über den Nachbartagen, Split- oder Fehlerverdacht ab 30 % Tagesrückgang (FR-89, Ergänzung 2). */
const OUTLIER_SHARE = 0.05, DROP_SHARE = 0.3;

/** Letzter gültiger VWCE.DE-Schluss als Stichtagskurs; bei offenem Abschluss keine Kurse des Folgejahrs.
 * @param {MarketPreviewOptions} options */
export function prepareMarketPreview(options) {
    const { inputs, dailyPrices, today, yearEndDate, storedHighAsOf = null, corrections = {} } = options;
    const start = day(yearEndDate), closingYear = Number(yearEndDate.slice(0, 4)) + 1;
    const evaluationDay = Math.min(day(today), day(`${closingYear}-12-31`));
    const cutoff = Math.min(evaluationDay, options.quoteOverride ? day(options.quoteOverride.asOf) : Infinity);
    const series = dailyPrices?.symbols['VWCE.DE'];
    const ignored = new Set(corrections.ignoredCloses || []);
    const index = series?.currency === 'EUR' ? series.days.findLastIndex(value => value <= cutoff
        && !ignored.has(dateOf(value)) && !(corrections.splitFrom && dateOf(value) < corrections.splitFrom)) : -1;
    // Ein Abschlusskurs gilt auch ohne Tagesreihe; das Hoch kommt dann aus gespeichertem Hoch und Kurs (Gutachten P2-1).
    const candidate = options.quoteOverride || (series && index >= 0 ? { price: series.closes[index], asOf: dateOf(series.days[index]) } : null);
    const quote = candidate && day(candidate.asOf) > start && day(candidate.asOf) <= cutoff ? candidate : null;
    const market = quote ? deriveMarketHigh({ inputs, quote, yearEndDate, storedHighAsOf, corrections,
        series: series?.currency === 'EUR' ? series : null, ageUntil: options.ageUntil ?? quote.asOf }) : null;
    // WT-1c (Gutachten WT1B-FABLE Befund 1): Ohne Kurs seit dem Jahresende gibt es in den ersten 10 Tagen nichts zu prüfen.
    // Danach nennt der Grund, ob ein älterer Kurs vorliegt oder gar keiner.
    const lastClose = series && index >= 0 ? series.days[index] : null;
    // Gutachten P3-1: Lücken zählen ab Historienstart, auch vor dem ersten gespeicherten Schluss (dort fehlt sonst ein früheres Hoch).
    const gapFrom = Math.min(options.historyStart ? day(options.historyStart) : Infinity, series?.days[0] ?? Infinity);
    const unreliableReason = !quote ? evaluationDay - start <= 10 ? PRICE_REASONS.yearStart
        : lastClose !== null && evaluationDay - lastClose > 10 ? PRICE_REASONS.missingStale : PRICE_REASONS.missing
        : evaluationDay - day(quote.asOf) > 10 ? PRICE_REASONS.stale
            : gapFrom <= day(quote.asOf) && historyGaps(gapFrom, day(quote.asOf), series?.queried ?? []).length
                ? PRICE_REASONS.gaps : null;
    const used = market ? market.high : storedMarketHigh(inputs, storedHighAsOf, yearEndDate);
    // Herkunft für die Anzeige: Tagesschluss, Jahresschluss (Abschlusskurs oder gespeichertes Jahreshoch) oder gespeicherter Wert.
    const source = used.origin === 'daily_close' ? 'daily' : used.origin === 'quote' ? options.quoteOverride ? 'year_end' : 'daily'
        : !used.dated ? 'stored' : used.asOf === options.yearEndAsOf ? 'year_end' : 'daily';
    const splitAsOf = used.origin === 'stored' && corrections.splitFrom && (!used.asOf || used.asOf < corrections.splitFrom) ? corrections.splitFrom : null;
    const high = /** @type {MarketHigh} */ ({ ...used, source, splitAsOf });
    return { ...options, quote, cutoff: dateOf(cutoff), closingYear, marketInputs: market ? market.inputs : { ...inputs }, high,
        warnings: quote ? marketHighWarnings({ series, high, quote, corrections }) : { outlier: null, drop: null },
        withoutQuote: quote === null, withoutQuoteReason: quote ? null : PRICE_REASONS.missing, unreliableReason };
}

/** Vorschau ohne Kurs oder Rechnung; der Grund steht als Kursgrund und als Grund der fehlenden Vorschau.
 * @param {string} reason @returns {UnavailableMarketPreview} */
export function unavailableMarketPreview(reason) {
    return { withoutQuote: true, withoutQuoteReason: reason, unreliableReason: reason, quote: null, yearEndDate: null };
}

/** Marktlagen, in denen die Engine den Flex kürzt (FLEX_BUDGET.ACTIVE_REGIMES). */
const FLEX_CUT_REGIMES = /** @type {string[]} */ (CONFIG.SPENDING_MODEL.FLEX_BUDGET.ACTIVE_REGIMES);
/** Tiefer Bär: mehr als 20 % unter dem Hoch (Marktphasen der Engine). */
const DEEP_BEAR_SHARE = 0.8;

/** Kursschwelle „tiefer Bär“ zum verwendeten Hoch, Restabstand des Index und ob die Engine den Flex schon kürzt.
 * @param {{ath: number, endeVJ: number}} inputs @param {string|null|undefined} marketKey */
export function deepBearThreshold(inputs, marketKey) {
    const threshold = inputs.ath * DEEP_BEAR_SHARE;
    return { threshold, reached: inputs.endeVJ < threshold, cutActive: FLEX_CUT_REGIMES.includes(String(marketKey)),
        remainingDeclinePct: inputs.endeVJ > 0 ? Math.max(0, (inputs.endeVJ - threshold) / inputs.endeVJ * 100) : null };
}

/** Ein Anzeigeobjekt für Vorschau und Jahresabschluss; Marktlage und Abstand stammen aus der Engine.
 * @param {ReturnType<typeof prepareMarketPreview>} prepared @param {EngineSuccess} result */
export function projectMarketPreview(prepared, result) {
    const inputs = prepared.marketInputs, market = result.ui.market;
    return { ticker: 'VWCE.DE', quote: prepared.quote, cutoff: prepared.cutoff, yearEndDate: prepared.yearEndDate,
        withoutQuote: prepared.withoutQuote, withoutQuoteReason: prepared.withoutQuoteReason, unreliableReason: prepared.unreliableReason,
        stored: { inputs: { ...prepared.inputs }, index: prepared.inputs.endeVJ },
        inputs: { ...inputs }, index: inputs.endeVJ, high: { ...prepared.high }, warnings: structuredClone(prepared.warnings),
        // Im Grundrauschen rechnet die Engine am Hoch; angezeigt wird der echte Abstand (FR-89, Ergänzung 3).
        drawdownPct: athNoiseBandApplies(inputs) ? athDistancePct(inputs) : market.abstandVomAthProzent, yearsSinceHigh: inputs.jahreSeitAth,
        market: { key: market.sKey, text: market.szenarioText }, deepBear: deepBearThreshold(inputs, market.sKey) };
}

/** Gründe, aus denen die Kurse das Hoch nicht tragen (zu alt, lückenhaft, fehlend).
 * `yearStart` (WT-1c): noch kein Kurs seit dem Jahresende, das höchstens 10 Tage zurückliegt; dann gibt es nichts zu prüfen. */
const PRICE_REASONS = Object.freeze({ missing: 'kein Tageskurs seit Jahresende VJ', stale: 'letzter Schlusskurs älter als 10 Kalendertage',
    missingStale: 'kein Tageskurs seit Jahresende VJ, letzter Schlusskurs älter als 10 Kalendertage',
    gaps: 'Kursreihe hat ungeprüfte Tage – Kurse auf der Seite Daten & Sicherung holen',
    yearStart: 'noch kein Tageskurs seit Jahresende VJ, Jahresende höchstens 10 Tage her' });

/** FR-89: „nicht belastbar“, wenn Kurse alt, lückenhaft oder fehlend sind und es auf sie ankäme. Kürzt die Engine schon, kann ein
 * fehlender Kurs das Hoch nur anheben und ändert nichts.
 * @param {ReturnType<typeof projectMarketPreview>|UnavailableMarketPreview|null|undefined} view */
export function highCheckUnreliable(view) {
    if (!view || !view.unreliableReason && view.withoutQuote !== true) return false;
    return !('market' in view && view.market && FLEX_CUT_REGIMES.includes(String(view.market.key)));
}

/** WT-1c: Grund der Kurszeile. `stale`, wenn der letzte Kurs älter als 10 Tage ist; `missing`, wenn Kurse fehlen oder lückenhaft
 * sind; `null` ohne Kursgrund, bei anderen Gründen einer fehlenden Vorschau und in den ersten 10 Tagen nach dem Jahresende.
 * @param {ReturnType<typeof projectMarketPreview>|UnavailableMarketPreview|null|undefined} view @returns {'stale'|'missing'|null} */
export function highPriceProblem(view) {
    if (!highCheckUnreliable(view)) return null;
    const reasons = [view?.unreliableReason, view?.withoutQuoteReason].map(reason => String(reason ?? ''));
    if (reasons.some(reason => reason.startsWith(PRICE_REASONS.yearStart))) return null;
    if (reasons.some(reason => reason.startsWith(PRICE_REASONS.stale) || reason.startsWith(PRICE_REASONS.missingStale))) return 'stale';
    const missing = [PRICE_REASONS.missing, PRICE_REASONS.gaps.split(' – ')[0]];
    return reasons.some(reason => missing.some(start => reason.startsWith(start))) ? 'missing' : null;
}
