// @ts-check
import { UIUtils } from './balance-utils.js';
import { formatChartEuro } from './balance-chart-axis.js';
import { bindBalanceDisplaySize, bindBalanceTableOverflow } from './balance-presentation-controls.js';
import { StorageManager } from './balance-storage.js';
import { readWealthHistory } from '../../types/wealth-history-contract.js';
import { prepareWealthHistoryMetrics, prepareWealthHistorySummary, prepareWealthHistoryChart } from './balance-wealth-history-metrics.js';

const EMPTY = 'Noch keine Stände erfasst. Nutzen Sie „Stand jetzt erfassen“. Automatische Jahresabschlussstände beginnen mit dem Abschlussjahr 2026.';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const euro = value => escape(UIUtils.formatBalanceCurrency(value));
const dateLabel = value => value.split('-').reverse().join('.');

function chartMarkup(rows, hostWidth) {
    const { width, baseline, points, ticks, years } = prepareWealthHistoryChart(rows, hostWidth);
    const axis = ticks.map(tick => `<line x1="110" x2="${width - 30}" y1="${tick.y}" y2="${tick.y}" class="wealth-grid"/><text x="100" y="${tick.y + 4}" text-anchor="end">${escape(formatChartEuro(tick.value))}</text>`).join('');
    let lastYearX = -Infinity;
    const yearMarks = years.map(mark => `<line class="wealth-year" x1="${mark.x}" x2="${mark.x}" y1="50" y2="${baseline}"/><text x="${mark.x}" y="${baseline + 22}" text-anchor="middle">${mark.x - lastYearX >= 48 ? (lastYearX = mark.x, mark.year) : ''}</text>`).join('');
    const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    const area = `${line} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
    let lastPeriodRight = -Infinity;
    const markers = points.map(point => {
        const annual = point.reason === 'annual_close';
        const marker = annual
            ? `<rect class="wealth-point" x="${point.x - 4}" y="${point.y - 4}" width="8" height="8" transform="rotate(45 ${point.x} ${point.y})"/>`
            : `<path class="wealth-point" d="M ${point.x} ${point.y - 4} l 4 4 l -4 4 l -4 -4 Z"/>`;
        const nearEnd = point.x > width - 86;
        const labelLeft = point.x - (nearEnd ? 104 : 52);
        const showPeriod = annual && labelLeft >= lastPeriodRight + 8;
        if (showPeriod) lastPeriodRight = point.x + (nearEnd ? 0 : 52);
        const period = showPeriod ? `<text x="${point.x}" y="${baseline + 44}" text-anchor="${nearEnd ? 'end' : 'middle'}">Abschluss ${escape(point.periodId)}</text>` : '';
        return `<g><title>${escape(dateLabel(point.asOf))}: ${point.marker} ${point.label}, Summe ${euro(point.total)}</title>${marker}${period}</g>`;
    }).join('');
    const first = points[0], latest = points[points.length - 1];
    const dates = first.asOf === latest.asOf
        ? `<text x="${latest.x}" y="354" text-anchor="middle">${dateLabel(latest.asOf)}</text>`
        : `<text x="${first.x}" y="354">${dateLabel(first.asOf)}</text><text x="${latest.x}" y="354" text-anchor="end">${dateLabel(latest.asOf)}</text>`;
    const endLabel = `<text x="${latest.x}" y="${latest.y - 12}" text-anchor="end">${escape(formatChartEuro(latest.total))}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 360" width="${width}" height="360" style="width:${width}px;min-width:${width}px;height:360px" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="wealthChartTitle" aria-describedby="wealthChartDesc"><title id="wealthChartTitle">Vermögensverlauf in nominalen Euro</title><desc id="wealthChartDesc">Linie und Fläche zeigen gespeicherte Gesamtsummen aus Tagesgeld, Geldmarkt-ETF und Aktien-ETF mit tatsächlichen Datumsabständen. Jahresabschluss: gefüllte Raute mit Abschlussjahr. Unterjährig: Raute. Keine Zwischenprognose, Rendite oder Realwertberechnung. Alle Werte und beide Teildepots stehen in der folgenden Tabelle.</desc><text x="110" y="20">Euro (€)</text>${axis}${yearMarks}<path class="wealth-area" d="${area}"/><path class="wealth-line" d="${line}"/>${markers}${dates}${endLabel}</svg>`;
}

export function summaryMarkup(rows, { missingComparisonHint = 'Kein zweiter Stand im Jahr erfasst' } = {}) {
    const summary = prepareWealthHistorySummary(rows);
    if (!summary) return '';
    const metric = (label, value, detail) => `<div class="wealth-metric ds-kpi"><div class="expenses-card-label">${escape(label)}</div><div class="expenses-card-value">${value}</div><div class="expenses-card-sub">${escape(detail)}</div></div>`;
    return metric('Zuletzt erfasst', escape(UIUtils.formatBalanceCurrency(summary.latest.total)), dateLabel(summary.latest.asOf))
        + metric(`Bestandsänderung ${summary.year}`, summary.change === null ? '—' : escape(UIUtils.formatBalanceCurrency(summary.change)),
            summary.change === null ? missingComparisonHint : `${dateLabel(summary.firstInYear.asOf)} bis ${dateLabel(summary.latest.asOf)} · einschließlich Entnahmen, keine Rendite`)
        + metric('Höchster Stand', escape(UIUtils.formatBalanceCurrency(summary.highest.total)), dateLabel(summary.highest.asOf));
}

export function tableMarkup(rows) {
    const headers = ['Datum', 'Anlass', 'Liquidität (Tagesgeld)', 'Geldmarkt-ETF', 'Aktien-ETF', 'Alt-Depot', 'Neu-Depot', 'Summe'];
    return `<table class="ds-table"><caption class="balance-table-caption">Erfasste Vermögensstände · nominale Euro</caption><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${[...rows].reverse().map(row => `<tr><th scope="row">${dateLabel(row.asOf)}</th><td>${row.marker} ${row.label}</td>${['tagesgeld', 'geldmarktEtf', 'aktienEtf', 'depotwertAlt', 'depotwertNeu', 'total'].map(key => `<td${key === 'total' ? ' class="wealth-total-value"' : ''}>${euro(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// Sichtbarkeit gehört ausschließlich zum DOM, weder zum Profil noch zum Export.
const displayErrors = new WeakMap();

function clearDetails(dom) {
    if (dom.metrics) dom.metrics.innerHTML = '';
    if (dom.chart) {
        bindBalanceDisplaySize(dom.chart, null);
        dom.chart.innerHTML = '';
    }
    if (dom.table) {
        dom.table.innerHTML = '';
        bindBalanceTableOverflow(dom.table, dom.scrollHint);
    }
    if (dom.hint) dom.hint.textContent = '';
}

export function initializeBalanceWealthHistory(dom, loadState = () => StorageManager.loadState()) {
    if (dom?.status) dom.status.textContent = '';
    return refreshBalanceWealthHistory(dom, loadState);
}

/** Inaktiv nur validieren/zählen/datieren; aktiv jede Datenbasis vollständig ersetzen. */
export function renderBalanceWealthHistory(dom, state, error = null) {
    if (!dom) return false;
    clearDetails(dom);
    if (dom.title) dom.title.textContent = ` · ${dom.profileContext?.textContent?.trim().replace(/^Aktives Profil:\s*/, 'aktives Profil ') || 'aktives Profil'}`;
    if (dom.count) dom.count.textContent = '';
    if (dom.date) dom.date.textContent = '';
    if (dom.status && dom.status.textContent === displayErrors.get(dom)) dom.status.textContent = '';
    displayErrors.delete(dom);
    try {
        if (error) throw error;
        const history = readWealthHistory(state);
        if (dom.count) dom.count.textContent = history.entries.length
            ? `${history.entries.length} ${history.entries.length === 1 ? 'Stand' : 'Stände'}` : '';
        const latest = history.entries.reduce((max, entry) => entry.asOf > max ? entry.asOf : max, '');
        if (dom.date) dom.date.textContent = latest
            ? `Zuletzt erfasst am ${dateLabel(latest)}` : 'Noch keine Stände erfasst';
        if (!dom.panel?.classList.contains('active')) return true;
        const rows = prepareWealthHistoryMetrics(state);
        if (dom.hint) dom.hint.textContent = rows.length ? '' : EMPTY;
        if (rows.length) {
            if (dom.metrics) dom.metrics.innerHTML = summaryMarkup(rows);
            if (dom.chart) bindBalanceDisplaySize(dom.chart, width => {
                dom.chart.innerHTML = chartMarkup(rows, width);
            });
            if (dom.table) {
                dom.table.innerHTML = tableMarkup(rows);
                bindBalanceTableOverflow(dom.table, dom.scrollHint);
            }
        }
        return true;
    } catch (failure) {
        clearDetails(dom);
        if (dom.count) dom.count.textContent = '';
        if (dom.date) dom.date.textContent = '';
        const text = `Vermögensverlauf kann nicht angezeigt werden: ${failure.message || failure}`;
        if (dom.status) dom.status.textContent = text;
        else if (dom.hint) dom.hint.textContent = text;
        displayErrors.set(dom, text);
        return false;
    }
}

export function refreshBalanceWealthHistory(dom, loadState = () => StorageManager.loadState()) {
    try { return renderBalanceWealthHistory(dom, loadState()); }
    catch (error) { return renderBalanceWealthHistory(dom, null, error); }
}
