export const HISTORICAL_CRISES = Object.freeze([
    { label: 'Dotcom-Crash', start: 2000, end: 2002 },
    { label: 'Finanzkrise', start: 2008, end: 2009 },
    { label: 'Corona', start: 2020, end: 2020 },
    { label: 'Zinswende', start: 2022, end: 2022 }
]);
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

// Dieselbe Vermögensgrenze für Chart und Krisen: Aktien enthalten den Bondpuffer.
export function portfolioChartPoint(entry) {
    const row = entry?.row || {};
    const equity = finite(entry?.wertAktien ?? row.wertAktien);
    const gold = finite(entry?.wertGold ?? row.wertGold);
    const liq = finite(entry?.liquiditaet ?? row.liquiditaet);
    const bond = finite(row.bondBucketAfter ?? row.threeBucket?.bondBucketAfter) ?? 0;
    return { year: finite(entry?.jahr), etf: equity === null ? null : Math.max(0, equity - bond),
        bond, gold, liq, total: equity === null || gold === null || liq === null ? null : equity + gold + liq };
}

export function backtestChartSeries(result) {
    const series = [];
    for (const entry of result?.rows || []) {
        if (Number.isInteger(result?.ruinYear) && entry.jahr > result.ruinYear) break;
        series.push(portfolioChartPoint(entry));
        if (entry.row?.Regime === 'BANKRUPT') break;
    }
    return series;
}

export function deriveHistoricalCrises(result, { startWithoutReserve = null } = {}) {
    const start = result?.request?.startYear;
    const end = result?.request?.endYear;
    const series = backtestChartSeries(result);
    const allowedBases = new Set(['static_input', 'effective_vpw_plus_pension_surplus']);
    return HISTORICAL_CRISES.filter(crisis => crisis.end >= start && crisis.start <= end).map(crisis => {
        const from = Math.max(start, crisis.start);
        const to = Math.min(end, crisis.end);
        const entries = (result?.rows || []).filter(entry => entry.jahr >= from && entry.jahr <= to
            && (!Number.isInteger(result.ruinYear) || entry.jahr <= result.ruinYear));
        const points = series.filter(point => point.year >= from && point.year <= to);
        const minimum = points.reduce((best, point) => point.total !== null
            && (!best || point.total < best.total) ? point : best, null);
        const reference = from === start ? finite(startWithoutReserve)
            : series.find(point => point.year === from - 1)?.total ?? null;
        const flexRows = entries.filter(entry => !['BANKRUPT', 'accumulation'].includes(entry.row?.Regime));
        const bases = new Set(flexRows.map(entry => entry.row?.flex_haushalt_basis));
        const completeFlex = flexRows.length > 0 && bases.size === 1 && allowedBases.has([...bases][0])
            && flexRows.every(entry => finite(entry.row?.flex_haushalt_kuerzung_pct) !== null);
        const cuts = completeFlex ? flexRows.filter(entry => entry.row.flex_haushalt_kuerzung_pct >= 10).length : null;
        const lowestFlexRate = completeFlex ? Math.min(...flexRows.map(entry => 100 - entry.row.flex_haushalt_kuerzung_pct)) : null;
        const notReached = Number.isInteger(result?.ruinYear) && result.ruinYear < from;
        return { ...crisis, from, to, status: notReached ? 'not_reached' : !minimum ? 'missing'
            : from > crisis.start || to < crisis.end || points.at(-1)?.year < to ? 'partial' : 'complete',
        minimum, changePct: minimum && reference !== null && reference > 0 ? (minimum.total / reference - 1) * 100 : null,
        cuts, lowestFlexRate };
    });
}
