import { prepareWealthHistoryMetrics } from '../balance/balance-wealth-history-metrics.js';
import { summaryMarkup, tableMarkup } from '../balance/balance-wealth-history-renderer.js';
import { loadStoredBalanceStateFromData } from '../profile/profile-state.js';
import { historyDay, historyDate } from './tranchen-history-store.js';
import { renderWealthHistorySvg, bindHistoryChartSize, bindHistoryDayInteraction, HISTORY_TYPE_LABELS } from './tranchen-history-svg.js';
import { escapeHtml } from '../shared/security-utils.js';

/** Abschlusswerte erweitern nur die Zeichnungsachse, niemals die Tagesreihe. */
export function projectHistoryClosures(history, state) {
    const rows = prepareWealthHistoryMetrics(state);
    const closures = rows.map(row => ({ ...row, day: historyDay(row.asOf) }));
    const days = closures.map(row => row.day);
    if (history?.points.length) days.push(history.range.start, history.range.end);
    if (!days.length) return { rows, chart: null };
    const start = Math.min(...days), end = Math.max(...days);
    return { rows, chart: { ...(history || { points: [], types: [], events: [], gaps: [] }), closures,
        range: { ...history?.range, start, end, startDate: historyDate(start), endDate: historyDate(end) } } };
}

const displayContexts = new WeakMap();

export function renderManagerWealthHistory(doc, projection, registry, activeId, view) {
    const host = doc.getElementById('managerWealthChart');
    if (!host) return;
    const byId = id => doc.getElementById(id);
    const context = `${activeId}:${view?.kind}:${view?.historyScope || ''}`;
    if (displayContexts.get(doc) !== context) {
        if (byId('managerWealthStatus')) byId('managerWealthStatus').textContent = '';
        displayContexts.set(doc, context);
    }
    const household = view?.kind === 'plan' || view?.kind === 'history' && view.historyScope !== 'person';
    const active = projection.profiles.find(person => person.id === activeId);
    byId('managerWealthContext').textContent = `Erfasste Stände sind bei ${active?.name || activeId} gespeichert. Der damalige Umfang kann vom heutigen Haushalt abweichen.`;
    const history = household ? projection.householdHistory : active?.history;
    let chart = null;
    try {
        const loaded = loadStoredBalanceStateFromData(registry.profiles[activeId]?.data || {});
        if (['corrupt', 'unavailable'].includes(loaded.status)) throw loaded.error || new Error('Abschlussstände nicht lesbar.');
        const prepared = projectHistoryClosures(history, loaded.value || {});
        chart = prepared.chart;
        byId('managerWealthMetrics').innerHTML = summaryMarkup(prepared.rows);
        byId('managerWealthTable').innerHTML = prepared.rows.length ? tableMarkup(prepared.rows) : '';
        byId('managerWealthHint').textContent = prepared.rows.length ? '' : 'Noch keine Stände erfasst. Mit „Stand jetzt erfassen“ legst du den ersten an.';
    } catch (error) {
        byId('managerWealthMetrics').innerHTML = '';
        byId('managerWealthTable').innerHTML = '';
        byId('managerWealthHint').textContent = `Erfasste Stände können nicht angezeigt werden: ${error.message}`;
        chart = history;
    }
    byId('managerWealthLegend').innerHTML = (history?.types || []).map(type => `<li><i class="history-${escapeHtml(type)}"></i>${escapeHtml(HISTORY_TYPE_LABELS[type] || type)}</li>`).join('') + '<li>◆ Jahresabschluss · ◇ Unterjährig</li>';
    byId('managerWealthDailyNote').textContent = `${household ? 'Tageslinie des Haushalts' : `Tageslinie ${active?.name || ''}`} · ${history?.points.some(point => Number.isFinite(point.total)) ? 'aus Beständen und Tageskursen bis zum letzten abgeschlossenen Tag.' : 'noch nicht bewertbar; gespeicherte Stände bleiben sichtbar.'}`;
    bindHistoryDayInteraction(host);
    bindHistoryChartSize(host, (value, size) => {
        host.innerHTML = value ? renderWealthHistorySvg(value, size) : '';
    }).update(chart);
}
