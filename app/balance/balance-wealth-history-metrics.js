// @ts-check
import { readWealthHistory } from '../../types/wealth-history-contract.js';
import { prepareChartAxis } from './balance-chart-axis.js';

/** Reine Projektion: Teildepots bleiben Details der einzigen Aktiengruppe. */
export function prepareWealthHistoryMetrics(state) {
    return [...readWealthHistory(state).entries]
        .sort((a, b) => a.asOf.localeCompare(b.asOf)
            || (a.reason === 'annual_close' ? 0 : 1) - (b.reason === 'annual_close' ? 0 : 1)
            || a.id.localeCompare(b.id))
        .map(entry => ({
            ...entry,
            label: entry.reason === 'annual_close' ? 'Jahresabschluss' : 'Unterjährig',
            marker: entry.reason === 'annual_close' ? '◆' : '◇',
            segments: [
                { key: 'tagesgeld', label: 'Liquidität (Tagesgeld)', value: entry.tagesgeld, lower: 0, upper: entry.tagesgeld },
                { key: 'geldmarktEtf', label: 'Geldmarkt-ETF', value: entry.geldmarktEtf, lower: entry.tagesgeld, upper: entry.tagesgeld + entry.geldmarktEtf },
                { key: 'aktienEtf', label: 'Aktien-ETF', value: entry.aktienEtf, lower: entry.tagesgeld + entry.geldmarktEtf, upper: entry.tagesgeld + entry.geldmarktEtf + entry.aktienEtf }
            ]
        }));
}

/** Nur Bestandsdifferenzen; weder Rendite noch Kaufkraftprojektion. */
export function prepareWealthHistorySummary(rows) {
    if (!rows.length) return null;
    const latest = rows[rows.length - 1];
    const year = latest.asOf.slice(0, 4);
    const yearRows = rows.filter(row => row.asOf.startsWith(`${year}-`));
    const highest = rows.reduce((max, row) => row.total > max.total ? row : max);
    return { latest, highest, year,
        change: yearRows.length > 1 ? latest.total - yearRows[0].total : null,
        firstInYear: yearRows[0] };
}

/** Glatte 1/2/5-Achsteilung, normierte Koordinaten für sehr große Beträge. */
export function prepareWealthHistoryChart(rows, hostWidth = 0) {
    const width = Math.max(640, 110 + rows.length * 100, Number.isFinite(hostWidth) ? hostWidth : 0);
    if (!rows.length) return { width, baseline: 290, points: [], ticks: [], years: [] };
    const axis = prepareChartAxis(rows.map(row => row.total));
    const baseline = 290;
    const y = value => baseline - axis.position(value) * 240;
    const start = Date.parse(`${rows[0].asOf}T00:00:00Z`);
    const end = Date.parse(`${rows[rows.length - 1].asOf}T00:00:00Z`);
    const x = date => end === start ? (110 + width - 30) / 2
        : 110 + ((Date.parse(`${date}T00:00:00Z`) - start) / (end - start)) * (width - 140);
    const points = rows.map(row => ({ ...row, x: x(row.asOf), y: y(row.total) }));
    const ticks = axis.ticks.map(value => ({ value, y: y(value) }));
    const years = [];
    for (let year = Number(rows[0].asOf.slice(0, 4)); year <= Number(rows[rows.length - 1].asOf.slice(0, 4)); year++) {
        const date = `${String(year).padStart(4, '0')}-01-01`;
        if (date >= rows[0].asOf && date <= rows[rows.length - 1].asOf) years.push({ year, x: x(date) });
    }
    return { width, baseline, points, ticks, years };
}
