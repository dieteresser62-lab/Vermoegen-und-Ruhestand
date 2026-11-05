import { quantile } from './simulator-utils.js';
import { wealthAllocationText, wealthInfo } from '../shared/wealth-display.js';

/**
 * @param [rows] - Protokollierte Jahreszeilen.
 * @returns Ergebnis der Operation.
 */
export function lastWealthRow(rows = []) {
    const entry = rows.filter(entry => Number.isFinite((entry?.row || entry)?.portfolio_total_end)).at(-1);
    const row = entry?.row || entry || {};
    // Backtests halten die Jahresinflation am Eintrag, MC direkt an der Zeile.
    return entry?.row ? { ...row, inflation: entry.inflationVJ ?? row.inflation } : row;
}
/**
 * @param row - Jahreszeile.
 * @returns {number}
 */
export function rowEndFactor(row) {
    return row.inflation_factor_cum * (1 + row.inflation / 100);
}
/**
 * @param row - Jahreszeile.
 * @param {string} [mode] - Anzeige- oder Berechnungsmodus.
 * @param {number} [factor] - Kontext für factor.
 * @returns Ergebnis der Operation.
 */
export function rowWealthParts(row, mode = 'nominal', factor = rowEndFactor(row)) {
    const divisor = mode === 'real' ? factor : 1;
    if (!(divisor > 0)) return null;
    return { self: (row.immobilien_selbst_end || 0) / divisor, rented: (row.immobilien_vermietet_end || 0) / divisor,
        total: (row.immobilien_wert_end || 0) / divisor };
}
/**
 * @param row - Jahreszeile.
 * @param {string} [mode] - Anzeige- oder Berechnungsmodus.
 * @param {number} [factor] - Kontext für factor.
 * @returns Ergebnis der Operation.
 */
export function rowAllocation(row, mode = 'nominal', factor = rowEndFactor(row)) {
    const divisor = mode === 'real' ? factor : 1;
    const bonds = row.bondBucketAfter ?? row.threeBucket?.bondBucketAfter ?? 0;
    const stocks = row.wertAktienEnthaeltAnleihen ? row.wertAktien - bonds : row.wertAktien;
    const gold = row.wertGold;
    // Der Gesamtbestand enthält die Pflegereserve; auch ihr Geldmarktanteil ist Liquidität.
    const cash = Number.isFinite(row.portfolio_total_end) && Number.isFinite(stocks) && Number.isFinite(gold)
        ? row.portfolio_total_end - stocks - gold - bonds : row.liquiditaet;
    return Object.fromEntries(Object.entries({ cash, aktien: stocks, gold, anleihe: bonds })
        .map(([key, value]) => [key, Number.isFinite(value) && divisor > 0 ? Math.max(0, value) / divisor : NaN]));
}
/**
 * @param row - Jahreszeile.
 * @param mode - Anzeige- oder Berechnungsmodus.
 * @param factor - Kontext für factor.
 * @returns {string}
 */
export function rowWealthInfo(row, mode, factor) { if (!Number.isFinite(row.portfolio_total_end)) return ''; return wealthInfo(rowAllocation(row, mode, factor), rowWealthParts(row, mode, factor)); }
/**
 * @param row - Jahreszeile.
 * @param mode - Anzeige- oder Berechnungsmodus.
 * @param factor - Kontext für factor.
 * @returns {string}
 */
export function rowWealthText(row, mode, factor, withHomes = true) { return wealthAllocationText(rowAllocation(row, mode, factor), withHomes ? rowWealthParts(row, mode, factor) : null); }
/**
 * Aufteilung einer Protokollzeile mit demselben Endfaktor wie die Bestandszelle.
 * @param entry - Protokolleintrag; im Backtest mit Zeile unter `row`.
 * @param {{source?: string, moneyBasis?: string, withHomes?: boolean}} [options]
 * @returns {string}
 */
export function protocolWealthText(entry, { source = 'mc', moneyBasis, withHomes = true } = {}) {
    const row = source === 'backtest' ? entry?.row || {} : entry || {};
    // Backtests halten die Jahresinflation am Eintrag, MC direkt an der Zeile.
    const inflation = source === 'backtest' ? entry?.inflationVJ : row.inflation;
    return rowWealthText(row, moneyBasis, rowEndFactor({ ...row, inflation }), withHomes);
}

/**
 * @param results - Aggregierte Laufdaten.
 * @param {string} [mode] - Anzeige- oder Berechnungsmodus.
 * @returns Ergebnis der Operation.
 */
export function displayFinalOutcomes(results, mode = 'real') {
    return results?.displayWealth?.[mode] || (mode === 'real' ? results?.euroMetrics?.real?.finalOutcomes : results?.finalOutcomes);
}

/** Perzentile der Summen aller beobachteten Läufe, niemals Summe von Perzentilen.
 *
 * @param summaries - Kontext für summaries.
 * @param missingness - Kontext für missingness.
 * @param totalRuns - Zahl der angeforderten Pfade.
 * @param codes - Kontext für codes.
 * @param hasHomes - Kontext für hasHomes.
 * @returns Ergebnis der Operation.
 */
export function aggregateDisplayWealth(summaries, missingness, totalRuns, codes, hasHomes) {
    if (!hasHomes || !summaries?.displayHomeValueNominalEur) return undefined;
    const result = {};
    for (const mode of ['nominal', 'real']) {
        const suffix = mode === 'real' ? 'RealEur' : 'NominalEur';
        const values = [], moneyValues = [], ruinFlags = [], successful = [], withCare = [], noCare = [];
        const pairs = [], successfulPairs = [], withCarePairs = [], noCarePairs = [];
        for (let index = 0; index < totalRuns; index++) {
            if (missingness.path[index] !== codes.OBSERVED) continue;
            const value = summaries[`finalValue${suffix}`][index] + summaries[`displayHomeValue${suffix}`][index];
            const pair = { total: value, money: summaries[`finalValue${suffix}`][index] };
            pairs.push(pair);
            (summaries.careEverActive[index] ? withCarePairs : noCarePairs).push(pair);
            if ([2, 3].includes(summaries.outcomeCode[index])) successfulPairs.push(pair);
            values.push(value);
            moneyValues.push(summaries[`finalValue${suffix}`][index]);
            ruinFlags.push(summaries.outcomeCode[index] === 1);
            (summaries.careEverActive[index] ? withCare : noCare).push(value);
            if ([2, 3].includes(summaries.outcomeCode[index])) successful.push(value);
        }
        const parts = { p10: quantileParts(pairs, .1), p50: quantileParts(pairs, .5), p90: quantileParts(pairs, .9),
            p50_successful: quantileParts(successfulPairs, .5), withCareMedian: quantileParts(withCarePairs, .5), noCareMedian: quantileParts(noCarePairs, .5) };
        result[mode] = { parts, p10: quantile(values, .1), p50: quantile(values, .5), p90: quantile(values, .9),
            p50_successful: successful.length ? quantile(successful, .5) : null,
            withCareMedian: withCare.length ? quantile(withCare, .5) : null, noCareMedian: noCare.length ? quantile(noCare, .5) : null, values, moneyValues, ruinFlags };
    }
    return result;
}

function quantileParts(pairs, p) {
    if (!pairs.length) return null;
    const sorted = [...pairs].sort((a, b) => a.total - b.total), rank = (sorted.length - 1) * p;
    const a = sorted[Math.floor(rank)], b = sorted[Math.ceil(rank)], fraction = rank % 1;
    const total = a.total + fraction * (b.total - a.total), money = a.money + fraction * (b.money - a.money);
    return { money, homes: Math.max(0, total - money) };
}
