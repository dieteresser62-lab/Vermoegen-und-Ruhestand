/** @import * as H from "../../typcheck/tranches-history.js" */
// Lesende Depotkennzahlen. Keine DOM-, Speicher-, Netzwerk- oder Engineaufrufe.
import { HISTORY_ASSET_TYPES, evaluateWealthHistory, historyRange, reconstructHistoryShares, historySharesAt, historyPriceAt } from './tranchen-history-model.js';
import { historyDay, historyDate, normalizeHistorySymbol } from './tranchen-history-store.js';

export const RETURN_ASSET_TYPES = HISTORY_ASSET_TYPES.filter(type => type !== 'cash');
const finite = Number.isFinite;

/** ACT/365; Rechnung in log(1+r), damit auch negative Zinsen > −100 % lösbar sind.
 * @param {{day: number; amount: number}[]} flows
 * @returns {number|null} */
export function historyXirr(flows) {
    const cash = new Map();
    for (const { day, amount } of flows) {
        if (!finite(amount) || !Number.isInteger(day)) return null;
        cash.set(day, (cash.get(day) || 0) + amount);
    }
    const entries = [...cash].filter(([, amount]) => amount !== 0).sort((a, b) => a[0] - b[0]);
    if (entries.length < 2 || !entries.some(([, a]) => a < 0) || !entries.some(([, a]) => a > 0)) return null;
    const start = entries[0][0], scale = Math.max(...entries.map(([, a]) => Math.abs(a)));
    const terms = entries.map(([day, amount]) => ({ t: (day - start) / 365, a: amount / scale }));
    const value = x => {
        const shift = Math.max(0, -x * terms.at(-1).t);
        let sum = 0, derivative = 0;
        for (const { t, a } of terms) {
            const v = a * Math.exp(-x * t - shift);
            sum += v; derivative -= t * v;
        }
        return { sum, derivative };
    };
    const result = x => { const r = Math.expm1(x); return finite(r) && r > -1 ? r : null; };
    let x = Math.log1p(0.1);
    for (let i = 0; i < 40; i++) {
        const { sum, derivative } = value(x);
        if (Math.abs(sum) < 1e-12) return result(x);
        if (!finite(derivative) || Math.abs(derivative) < 1e-14) break;
        const next = x - sum / derivative;
        if (!finite(next) || Math.abs(next) > 32 || Math.abs(next - x) > 2) break;
        x = next;
    }
    // Feste, breite Klammern; keine Lösung wird durch einen Schätzwert ersetzt.
    const bounds = [-32, -16, -8, -4, -2, -1, 0, 0.1, 0.5, 1, 2, 4, 8, 16, 32];
    for (let i = 1; i < bounds.length; i++) {
        let lo = bounds[i - 1], hi = bounds[i], left = value(lo).sum, right = value(hi).sum;
        if (left === 0) return result(lo);
        if (right === 0) return result(hi);
        if (Math.sign(left) === Math.sign(right)) continue;
        for (let j = 0; j < 100; j++) {
            const mid = (lo + hi) / 2, current = value(mid).sum;
            if (Math.abs(current) < 1e-12 || hi - lo < 1e-12) return result(mid);
            if (Math.sign(current) === Math.sign(left)) { lo = mid; left = current; }
            else hi = mid;
        }
        return result((lo + hi) / 2);
    }
    return null;
}

/** Tagesrendite: Einzahlung am Tagesbeginn, Auszahlung am Tagesende.
 * @param {number} previous
 * @param {number} current
 * @param {number} [deposit]
 * @param {number} [withdrawal]
 * @returns {number|null} */
export function historyDailyReturn(previous, current, deposit = 0, withdrawal = 0) {
    if (![previous, current, deposit, withdrawal].every(finite) || Math.min(previous, current, deposit, withdrawal) < 0) return null;
    const denominator = previous + deposit;
    if (denominator === 0) return current + withdrawal === 0 ? 0 : null;
    const rate = (current + withdrawal) / denominator - 1;
    return finite(rate) ? rate : null;
}

/** Flüsse werden an den nächsten tatsächlich bewerteten Tag weitergereicht.
 * @param {H.Point[]} points
 * @param events Kauf- und Verkaufsmarkierungen aus der Tagesprojektion.
 * @returns {H.ReturnPoint[]} */
export function buildHistoryReturnSeries(points, events = []) {
    const flows = events.filter(e => ['buy', 'sell'].includes(e.kind)).slice().sort((a, b) => a.day - b.day);
    const series = [];
    let cursor = 0;
    for (const point of points) {
        if (!point.evaluated || !finite(point.total)) continue;
        let deposit = 0, withdrawal = 0;
        while (cursor < flows.length && flows[cursor].day <= point.day) {
            const flow = flows[cursor++];
            if (!finite(flow.amount) || flow.amount < 0) { deposit = NaN; withdrawal = NaN; }
            else if (flow.kind === 'buy') deposit += flow.amount;
            else withdrawal += flow.amount;
        }
        // Der erste bewertete Schlussstand ist die Anfangseinzahlung, keine doppelte Kaufbuchung.
        const previous = series.at(-1);
        const rate = previous ? historyDailyReturn(previous.total, point.total, deposit, withdrawal) : null;
        series.push({ day: point.day, date: point.date || historyDate(point.day), total: point.total, baseline: !previous, deposit: previous ? deposit : 0,
            withdrawal: previous ? withdrawal : 0, rate });
    }
    return series;
}

/** Kennzahlen eines Ausschnitts; ein vorangehender Schlussstand ist die Vergleichsbasis.
 * @param {H.ReturnPoint[]} series
 * @param {{start?: number; end?: number; provisional?: boolean}} [options]
 * @returns Zeitgewichtete Rendite, Zinsfuß und Risikowerte. */
export function historyReturnMetrics(series, { start = series[0]?.day, end = series.at(-1)?.day, provisional = false } = {}) {
    const selected = series.filter(point => point.day >= start && point.day <= end);
    const previous = series.findLast(point => point.day < start);
    const points = previous && selected.length ? [previous, ...selected] : selected;
    const empty = { status: 'insufficient', count: points.length, start: points[0]?.day ?? null, end: points.at(-1)?.day ?? null,
        twr: null, annualized: null, xirr: null, change: null, market: null, netFlows: null, drawdown: null, recovery: null, volatility: null };
    if (points.length < 2) return empty;
    const first = points[0], last = points.at(-1), days = last.day - first.day;
    let factor = 1, peak = 1, peakDay = first.day, mean = 0, m2 = 0, n = 0, deposit = 0, withdrawal = 0;
    let drawdown = { value: 0, from: first.day, to: first.day }, recovery = { days: 0, open: false }, underwater = false;
    const cash = [{ day: first.day, amount: -first.total }];
    for (const point of points.slice(1)) {
        deposit += point.deposit; withdrawal += point.withdrawal;
        if (point.withdrawal !== point.deposit) cash.push({ day: point.day, amount: point.withdrawal - point.deposit });
        if (!finite(point.rate)) return { ...empty, status: 'unavailable' };
        factor *= 1 + point.rate;
        n++;
        const delta = point.rate - mean;
        mean += delta / n; m2 += delta * (point.rate - mean);
        if (factor >= peak - 1e-12 * Math.max(1, peak)) {
            const span = point.day - peakDay;
            if (underwater && span > recovery.days) recovery = { days: span, open: false };
            underwater = false;
            peak = Math.max(peak, factor); peakDay = point.day;
        } else {
            underwater = true;
            const loss = peak > 0 ? factor / peak - 1 : 0;
            if (loss < drawdown.value) drawdown = { value: loss, from: peakDay, to: point.day };
        }
    }
    if (factor < peak - 1e-12 * Math.max(1, peak) && last.day - peakDay >= recovery.days) recovery = { days: last.day - peakDay, open: true };
    cash.push({ day: last.day, amount: last.total });
    const twr = factor - 1, netFlows = deposit - withdrawal, change = last.total - first.total;
    return { status: provisional ? 'provisional' : 'complete', count: points.length, start: first.day, end: last.day, days,
        twr, annualized: days >= 365 ? Math.pow(factor, 365 / days) - 1 : null,
        xirr: historyXirr(cash), change, market: change - netFlows, netFlows, drawdown, recovery,
        volatility: n > 1 ? Math.sqrt(Math.max(0, m2) / (n - 1)) * Math.sqrt(252) : null };
}

/** Je Monat Tagesfaktoren verketten, je Jahr dieselben Monatsfaktoren verketten.
 * @param {H.ReturnPoint[]} series
 * @param {{start: number; end: number; firstHoldingDay?: number; today: string}} options
 * @returns Monatsfaktoren und Jahresrenditen. */
export function historyMonthlyReturns(series, { start, end, firstHoldingDay = start, today }) {
    const buckets = new Map();
    for (const point of series) {
        const date = point.date || historyDate(point.day), year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
        if (!buckets.has(year)) buckets.set(year, Array(12).fill(null));
        const months = buckets.get(year);
        if (!months[month - 1]) months[month - 1] = { factor: 1, count: 0, invalid: false };
        if (!point.baseline) {
            const cell = months[month - 1];
            if (finite(point.rate)) { cell.factor *= 1 + point.rate; cell.count++; }
            else cell.invalid = true;
        }
    }
    const firstDay = Math.max(start, firstHoldingDay ?? start);
    return [...buckets].sort((a, b) => b[0] - a[0]).map(([year, buckets]) => {
        const months = buckets.map((bucket, index) => {
            const monthStart = Date.UTC(year, index, 1) / 86400000;
            const monthEnd = Date.UTC(year, index + 1, 0) / 86400000;
            if (monthEnd < firstDay || monthStart > end) return null;
            const partial = firstDay > monthStart && firstDay <= monthEnd || end < monthEnd && end >= monthStart
                || today.slice(0, 7) === `${year}-${String(index + 1).padStart(2, '0')}`;
            return { value: bucket?.count && !bucket.invalid ? bucket.factor - 1 : null, partial };
        });
        const available = months.filter(cell => cell && finite(cell.value));
        const invalid = months.some(cell => cell && cell.value === null);
        const value = available.length && !invalid ? available.reduce((factor, cell) => factor * (1 + cell.value), 1) - 1 : null;
        return { year, months, value, partial: months.some(cell => cell?.partial), firstDay: Math.max(firstDay, Date.UTC(year, 0, 1) / 86400000) };
    }).filter(row => row.months.some(Boolean));
}

function prepareReturnHistory(history, quoteDays, today, firstHoldingDay, missingAt) {
    const points = history.points.filter(point => firstHoldingDay !== null && point.day >= firstHoldingDay)
        .map(point => ({ ...point, evaluated: !point.gap && finite(point.total)
        && (point.quality.includes('close') || point.total === 0 && quoteDays.has(point.day)) }));
    const provisional = points.some(point => point.gap || !finite(point.total) || point.quality.includes('missing-first-price'));
    const invalid = history.errors.length > 0;
    const series = buildHistoryReturnSeries(points, history.events);
    const tail = points.find(point => point.day > (series.at(-1)?.day ?? -Infinity) && !finite(point.total));
    const coverage = tail && !invalid ? { from: tail.day, through: series.at(-1)?.day ?? null, missing: missingAt(tail.day) } : null;
    const monthly = historyMonthlyReturns(series, { ...history.range, end: series.at(-1)?.day ?? history.range.end, today, firstHoldingDay });
    const metrics = invalid ? historyReturnMetrics([]) : historyReturnMetrics(series, { provisional });
    if (invalid || coverage && !series.length) metrics.status = 'unavailable';
    return { points, series, monthly, events: history.events, provisional, invalid, coverage, firstHoldingDay, range: history.range,
        metrics: { ...metrics, coverage } };
}

/** Eine gemeinsame Projektion für alle Karten und Anlageformen; nur im Verlaufsreiter aufrufen.
 * @param {H.ModelOptions} options
 * @returns Depotkennzahlen für Gesamtbestand und Anlageformen. */
export function evaluateHistoryReturns({ profiles, prices, events = [], startDate, today, profileId = null }) {
    const selected = profiles.filter(profile => profileId ? profile.id === profileId : profile.belongsToHousehold !== false);
    const groups = [], allQuoteDays = new Set();
    const range = historyRange(startDate, today);
    // Cash wird nicht bewertet; seine Renten, Ausgaben und Qualität sind keine Depotflüsse.
    const investments = selected.map(profile => ({ ...profile, currentCash: 0,
        cashHistory: { baselineValue: 0, entries: [] }, lots: profile.lots.filter(lot => (lot.tranche || lot).type !== 'cash') }));
    const base = evaluateWealthHistory({ profiles: investments, prices, events, startDate, today, profileId, includeAssetDetails: true });
    // Nur für den Hinweis am abgeschnittenen Ende prüfen; die Tagesprojektion
    // bleibt die gemeinsame Bewertungsquelle für Gesamtbestand und Anlageformen.
    const missingAt = (day, type = null) => [...new Set(investments.flatMap(profile => profile.lots.flatMap(lot => {
        const tranche = lot.tranche || lot;
        if (type && tranche.type !== type) return [];
        try {
            const chain = reconstructHistoryShares(lot, events.filter(event => event.profileId === profile.id));
            if (historySharesAt(chain, day) === 0) return [];
            const symbol = tranche.ticker ? normalizeHistorySymbol(tranche.ticker) : null;
            if (symbol && finite(historyPriceAt(prices.symbols[symbol], day).value)) return [];
            return [tranche.name || tranche.ticker || tranche.trancheId];
        } catch { return []; }
    })))];
    for (const type of RETURN_ASSET_TYPES) {
        const lots = investments.flatMap(profile => profile.lots).filter(lot => (lot.tranche || lot).type === type);
        if (!lots.some(lot => historyDay((lot.tranche || lot).purchaseDate) <= range.end)) continue;
        const quoteDays = new Set();
        for (const lot of lots) {
            const tranche = lot.tranche || lot;
            try {
                const record = prices.symbols[normalizeHistorySymbol(tranche.ticker)];
                if (record?.currency === 'EUR') for (const day of record.days) { quoteDays.add(day); allQuoteDays.add(day); }
            } catch { /* Das Verlaufsmodell weist fehlende/ungültige Ticker aus. */ }
        }
        const history = { ...base, events: base.events.filter(event => event.assetType === type), points: base.points.map(point => ({
            day: point.day, date: point.date, total: point.quality.includes('invalid-profile') ? null : point.allocation[type], ...point.assetDetails[type]
        })) };
        if (!history.points.some(p => p.total > 0) && !history.events.length && !history.errors.length) continue;
        const firstHoldingDay = Math.max(range.start, Math.min(...lots.map(lot => historyDay((lot.tranche || lot).purchaseDate))));
        const prepared = prepareReturnHistory(history, quoteDays, today, firstHoldingDay, day => missingAt(day, type));
        if (lots.some(lot => lot.manualCorrectionAt)) {
            prepared.provisional = true;
            if (prepared.metrics.status === 'complete') prepared.metrics.status = 'provisional';
        }
        groups.push({ type, ...prepared });
    }
    const history = { ...base, points: base.points.map(point => ({ day: point.day, date: point.date, total: groups.length ? point.total : null,
        quality: point.quality, gap: point.gap })) };
    const firstHoldingDay = groups.length ? Math.min(...groups.map(group => group.firstHoldingDay)) : null;
    const all = prepareReturnHistory(history, allQuoteDays, today, firstHoldingDay, missingAt);
    all.provisional ||= groups.some(group => group.provisional);
    if (all.provisional && all.metrics.status === 'complete') all.metrics.status = 'provisional';
    const years = [];
    for (let year = Number(today.slice(0, 4)); year >= Number(startDate.slice(0, 4)); year--) {
        const start = Math.max(range.start, firstHoldingDay ?? range.start, Date.UTC(year, 0, 1) / 86400000), end = Math.min(range.end, all.coverage ? all.coverage.through ?? range.start - 1 : range.end, Date.UTC(year, 11, 31) / 86400000);
        if (firstHoldingDay === null || end < start) continue;
        const metrics = all.invalid ? { ...historyReturnMetrics([]), status: 'unavailable' } : historyReturnMetrics(all.series, { start, end, provisional: all.provisional });
        years.push({ year, start, end, points: all.points.filter(p => p.day >= start && p.day <= end), metrics });
    }
    return { ...all, groups, years, today };
}

/** @param {H.Returns} result
 * @param {string} [period]
 * @returns Kennzahlen des ausgewählten Zeitraums und Abdeckung. */
export function selectHistoryReturnMetrics(result, period = 'year') {
    const range = historyRange(historyDate(result.range.start), result.today, period);
    const metrics = result.invalid ? { ...historyReturnMetrics([]), status: 'unavailable' }
        : historyReturnMetrics(result.series, { ...range, provisional: result.provisional });
    const coverage = !result.invalid && result.coverage && result.coverage.from <= range.end
        ? { ...result.coverage, through: result.coverage.through >= range.start ? result.coverage.through : null } : null;
    if (coverage && coverage.through === null) metrics.status = 'unavailable';
    return { ...metrics, coverage, displayStart: Math.max(range.start, metrics.start ?? range.start) };
}
