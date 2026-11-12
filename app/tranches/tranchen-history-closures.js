import { propertyParts } from '../shared/wealth-display.js';
import { prepareWealthHistoryMetrics } from '../balance/balance-wealth-history-metrics.js';
import { summaryMarkup, tableMarkup } from '../balance/balance-wealth-history-renderer.js';
import { projectWealthCaptures } from '../profile/profile-wealth-captures.js';
import { WEALTH_CAPTURES_KEY } from '../../types/wealth-capture-contract.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { historyDay, historyDate } from './tranchen-history-store.js';
import { renderWealthHistorySvg, wealthHistoryScale, bindHistoryChartSize, bindHistoryDayInteraction, HISTORY_TYPE_LABELS } from './tranchen-history-svg.js';
import { escapeHtml } from '../shared/security-utils.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { buildHistoryMeasurementHtml } from './tranchen-history-ui.js';
import { projectProfileWealthHistory } from '../profile/profile-wealth-history.js';
import { renderManagerHistoryReturns } from './tranchen-history-returns-ui.js';
import { bindWealthRecords, renderWealthRecords } from './tranchen-history-records.js';

const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 }) : '—';
const signed = value => Number.isFinite(value) ? (value > 0 ? '+' : '') + money(value) : '—';
const percent = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'percent', fractionDigits: 1 }) : 'Prozent nicht verfügbar';
const day = value => Number.isInteger(value) ? historyDate(value).split('-').reverse().join('.') : '—';

/** Tageskennzahlen lesen die ursprüngliche Tagesprojektion, nie die erweiterte Rautenachse.
 * @param history Tagesprojektion mit Geldvermögenskennzahlen.
 * @returns {string} */
export function dailyHistoryMetricsMarkup(history) {
    const m = history?.metrics || {};
    const periodName = { '1m': 'im letzten Monat · ', '1w': 'in der letzten Woche · ' }[history?.range?.period] || '';
    const metric = (label, value, detail, amount) => `<div class="wealth-metric ds-kpi"><div class="expenses-card-label">${escapeHtml(label)}</div><div class="expenses-card-value${amount === undefined ? '' : Number.isFinite(amount) && amount !== 0 ? amount > 0 ? ' history-positive' : ' history-negative' : ' history-neutral'}">${escapeHtml(value)}</div><div class="expenses-card-sub">${escapeHtml(detail)}</div></div>`;
    return metric('Veränderung Geldvermögen', signed(m.change), periodName + percent(m.percent) + ' · nach Entnahmen', m.change ?? null)
        + metric('Entnahmen Geldvermögen', money(m.withdrawals), 'Aus erfassten Tagesgeld-Rückgängen' + (m.withdrawals == null ? ' · Historie fehlt' : ''))
        + metric('Geldvermögen ohne Entnahmen gerechnet', signed(m.adjusted), percent(m.adjustedPercent), m.adjusted ?? null)
        + metric('Höchststand Geldvermögen', money(m.peak?.value), m.peak ? 'am ' + day(m.peak.day) : 'Nicht verfügbar')
        + metric('Größter Rückgang Geldvermögen', m.drawdown ? '−' + percent(m.drawdown.percent) : '—', m.drawdown ? m.drawdown.percent === 0 ? 'Kein Rückgang' : `${day(m.drawdown.from)} bis ${day(m.drawdown.to)}` : 'Nicht verfügbar');
}

function renderDailyHistory(doc, history, context) {
    const set = (id, text, html = false) => { const node = doc.getElementById(id); if (node) node[html ? 'innerHTML' : 'textContent'] = text; };
    set('managerDailyMetrics', dailyHistoryMetricsMarkup(history), true);
    set('managerDailyPeriod', history ? `Zeitraum ${day(history.range.start)} bis ${day(history.range.end)} · `
        + buildHistoryMeasurementHtml(history.measurementStart, history.metrics?.status, history.range.start) : '', true);
    const notes = [];
    if (!history) notes.push(context?.status === 'corrupt' ? `Verlaufsdaten beschädigt: ${context.error}` : 'Noch keine Verlaufshistorie.');
    else {
        if (!history.points.length) notes.push('In diesem Zeitraum liegt noch kein abgeschlossener Tag.');
        if (history.end?.total === null) notes.push(`Teilabdeckung · bekannter Betrag ${money(history.end.known)} · Geldvermögen nicht vollständig bewertbar.`);
        if (history.errors?.length) notes.push('Historische Bewertung unvollständig: ' + history.errors.join(' · '));
        if (history.points.some(point => point.quality.includes('missing-ticker'))) notes.push('Kein Kursverlauf ohne Ticker.');
        if (history.points.some(point => point.quality.includes('unsupported-currency'))) notes.push('Nicht unterstützte Kurswährung: keine EUR-Umrechnung verfügbar.');
        if (history.points.some(point => point.quality.includes('missing-first-price'))) notes.push('Erster Schlusskurs fehlt; unbekannte Abschnitte bleiben ohne Fläche.');
        if (history.gaps.length) notes.push('Ungeprüfte Werktage sind schraffiert. Fehlende Tageskurse werden beim nächsten Start nachgeladen.');
        if (history.points.some(point => point.assumedCash)) notes.push('Tagesgeldbasis vor dem ersten Eintrag rückwirkend angenommen.');
        if (context?.prices) {
            const failures = Object.entries(context.prices.symbols).filter(([, record]) => record.failures >= 3);
            if (failures.length) notes.push('Nach drei erfolglosen Versuchen: ' + failures.map(([symbol, record]) => `${symbol}: ${record.lastError}`).join(' · '));
        }
    }
    set('managerDailyStatus', notes.join(' '));
    set('managerDailyInfo', 'Schlusskurse und bestätigte Bestände zeigen das Geldvermögen; Tagesgeld-Rückgänge können auch Transfers sein. „Ohne Entnahmen gerechnet“ ist keine Rendite. Immobilien werden mit ihrem heutigen Wert für den ganzen Zeitraum ergänzt. <a href="Handbuch.html#vermoegensverlauf">Mehr im Handbuch</a>', true);
    set('managerDailyAllocation', dailyHistoryAllocationMarkup(history), true);
}

/** @param history Tagesprojektion mit Endbestand.
 * @returns {string} */
export function dailyHistoryAllocationMarkup(history) {
    const end = history?.end;
    const types = [...new Set((history?.types || []).map(type => ['aktien_alt', 'aktien_neu'].includes(type) ? 'aktien' : type))];
    const stockTypes = history?.types.filter(type => ['aktien_alt', 'aktien_neu'].includes(type)) || [];
    const stocks = stockTypes.every(type => Number.isFinite(end?.allocation[type])) ? stockTypes.reduce((sum, type) => sum + end.allocation[type], 0) : null;
    const total = end?.totalWithHomes ?? end?.total;
    const row = (label, value) => `<span>${escapeHtml(label)}</span><b class="ds-wealth-amount">${escapeHtml(money(value))}</b><span class="ds-wealth-share">${total > 0 && Number.isFinite(value) ? escapeHtml(percent(value / total * 100)) : ''}</span>`;
    return end ? `<span>Aufteilung am ${escapeHtml(day(end.day))}</span><div class="ds-wealth-allocation">`
        + types.map(type => row(type === 'cash' ? 'Tagesgeld' : type === 'aktien' ? 'Aktien' : HISTORY_TYPE_LABELS[type] || type, type === 'aktien' ? stocks : end.allocation[type])).join('')
        + [['self', 'selbst genutzt'], ['rented', 'vermietet']].filter(([key]) => end.property?.[key] > 0).map(([key, label]) => row(`Immobilien ${label}`, end.property[key])).join('') + '</div>' : '';
}

/** Abschlusswerte erweitern bei Alles die Zeichnungsachse, sonst gilt die Tagesauswahl.
 * @param history Tagesprojektion oder null.
 * @param state Erfasste Vermögensstände.
 * @returns Abschlusszeilen und erweiterte Zeichnungsachse. */
export function projectHistoryClosures(history, state) {
    const rows = prepareWealthHistoryMetrics(state);
    const closures = rows.map(row => ({ ...row, day: historyDay(row.asOf) }))
        .filter(row => !history?.range.period || history.range.period === 'all'
            || row.day >= history.range.start && row.day <= history.range.end);
    const days = closures.map(row => row.day);
    if (history?.points.length) days.push(history.range.start, history.range.end);
    if (!days.length) return { rows, chart: null };
    const start = Math.min(...days), end = Math.max(...days);
    return { rows, chart: { ...(history || { points: [], types: [], events: [], gaps: [] }), closures,
        range: { ...history?.range, start, end, startDate: historyDate(start), endDate: historyDate(end) } } };
}

const displayContexts = new WeakMap();
const periods = new WeakMap();

/** Legende folgt der Zeichnung: bei gekürzter Achse gibt es nur eine Gesamtfläche.
 * @param chart Vorbereitete Zeichnungsprojektion.
 * @returns {string} */
export function managerHistoryLegend(chart) {
    if (!chart) return '';
    const visiblePoints = chart.points.filter(point => Number.isFinite(point.total));
    const entries = [];
    if (visiblePoints.length) {
        const stacked = wealthHistoryScale([...chart.points, ...(chart.closures || [])]).floor === 0;
        if (stacked) for (const type of chart.types) {
            if (visiblePoints.some(point => point.allocation[type] > 0))
                entries.push(`<li><i class="history-${escapeHtml(type)}"></i>${escapeHtml(HISTORY_TYPE_LABELS[type] || type)}</li>`);
        }
        entries.push('<li><i class="history-total-key"></i>Geldvermögen</li>');
    }
    if (chart.hasHomes) {
        for (const [kind, key, label] of [['homeSelf', 'self', 'Immobilien selbst genutzt'], ['homeRented', 'rented', 'Immobilien vermietet']]) {
            if (chart.points.some(point => point.property?.[key] > 0)) entries.push(`<li><i class="history-${kind}"></i>${label}</li>`);
        }
        entries.push('<li><i class="history-property-total-key"></i>Geldvermögen mit heutigem Immobilienwert</li>');
    }
    const events = chart.events.filter(event => visiblePoints.some(point => point.day === event.day));
    if (events.some(event => event.kind === 'buy')) entries.push('<li><i class="history-buy-key"></i>Kauf</li>');
    if (events.some(event => event.kind !== 'buy')) entries.push('<li><i class="history-sell-key"></i>Verkauf</li>');
    if (chart.gaps.length) entries.push('<li><i class="history-gap-key"></i>Ungeprüfte Werktage</li>');
    if (chart.closures?.some(row => row.reason === 'annual_close')) entries.push('<li><span class="manager-closure-key">◆</span> Jahresabschluss</li>');
    if (chart.closures?.some(row => row.reason !== 'annual_close')) entries.push('<li><span class="manager-closure-key">◇</span> Unterjährig</li>');
    return entries.join('');
}

/** @param doc Dokument des Managers.
 * @param projection Personen- und Haushaltsprojektion.
 * @param registry Gelesene Registry.
 * @param {string} activeId
 * @param view Ausgewählter Managerbereich.
 * @param {import("../../typcheck/datenvertraege.js").RecordReader} [storage]
 * @returns {void} */
export function renderManagerWealthHistory(doc, projection, registry, activeId, view, storage = persistenceStorage) {
    renderManagerHistoryReturns(doc, projection, registry, activeId, view);
    const host = doc.getElementById('managerWealthChart');
    if (!host) return;
    const byId = id => doc.getElementById(id);
    if (!periods.has(doc)) {
        const selection = { period: 'all' };
        periods.set(doc, selection);
        byId('managerHistoryPeriods')?.addEventListener('click', event => {
            const period = event.target?.closest?.('[data-manager-history-period]')?.dataset.managerHistoryPeriod;
            if (!['all', 'year', '12m', '1m', '1w'].includes(period)) return;
            selection.period = period;
            selection.render();
        });
    }
    const selection = periods.get(doc);
    selection.render = () => renderManagerWealthHistory(doc, projection, registry, activeId, view);
    doc.querySelectorAll?.('[data-manager-history-period]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.managerHistoryPeriod === selection.period));
    });
    const context = `${activeId}:${view?.kind}:${view?.historyScope || ''}`;
    if (displayContexts.get(doc) !== context) {
        if (byId('managerWealthStatus')) byId('managerWealthStatus').textContent = '';
        displayContexts.set(doc, context);
    }
    const household = view?.kind === 'plan' || view?.kind === 'history' && view.historyScope !== 'person';
    const active = projection.profiles.find(person => person.id === activeId);
    byId('managerWealthContext').textContent = household ? '' : `Vermögensverlauf ${active?.name || activeId}`;
    const history = selection.period !== 'all' && projection.historyContext?.status === 'ready'
        ? projectProfileWealthHistory(registry, projection.profiles, { ...projection.historyContext, period: selection.period,
            profileId: household ? null : activeId })
        : household ? projection.householdHistory : active?.history;
    renderDailyHistory(doc, history, projection.historyContext);
    let chart = null;
    try {
        const captured = projectWealthCaptures(registry, storage.getItem(WEALTH_CAPTURES_KEY), household ? null : activeId);
        const prepared = projectHistoryClosures(history, captured);
        for (const id of ['managerWealthCapturedTitle', 'managerWealthMetrics', 'managerWealthTable']) {
            if (byId(id)) byId(id).hidden = !household && !prepared.rows.length;
        }
        if (byId('managerWealthPersonHint')) byId('managerWealthPersonHint').hidden = household || !captured.hasLegacy;
        if (byId('managerWealthPersonHintText')) byId('managerWealthPersonHintText').textContent = prepared.rows.length
            ? 'Ältere Stände gibt es nur für den Haushalt' : 'Erfasste Stände gibt es für den Haushalt';
        if (household && captured.conflicts.length) {
            const labels = { tagesgeld: 'Tagesgeld', geldmarktEtf: 'Geldmarkt', depotwertAlt: 'Aktien Altbestand', depotwertNeu: 'Aktien Neubestand', aktienEtf: 'Aktien', goldWert: 'Gold', anleihen: 'Anleihen', total: 'Summe' };
            byId('managerWealthContext').textContent += ' Abweichende Stände: ' + captured.conflictDetails.map(detail =>
                detail.asOf.split('-').reverse().join('.') + ': ' + detail.fields.map(({ field, values }) =>
                    `${labels[field]} ${values.map(money).join(' / ')} (angezeigt: ${money(detail.selected[field] ?? 0)})`).join('; ')).join('. ')
                + '. Angezeigt wird die letzte Erfassung nach Zeitstempel, ohne vergleichbare Zeitstempel nach Speicherreihenfolge der Profile und Einträge. Altstände bleiben unverändert. Neue Stände enthalten zusätzlich Gold; Anleihen werden getrennt ausgewiesen.';
        }
        const homes = propertyParts(household ? projection.profiles.filter(p => p.belongs) : active ? [active] : []);
        chart = prepared.chart ? { ...prepared.chart, closures: prepared.chart.closures.map(row => homes.present ? { ...row, totalWithHomes: row.total + homes.total } : row) } : null;
        byId('managerWealthMetrics').innerHTML = summaryMarkup(prepared.rows, { missingComparisonHint: 'Jahresvergleich braucht zwei erfasste Stände', homes });
        byId('managerWealthTable').innerHTML = prepared.rows.length ? tableMarkup(prepared.rows, { homes }) : '';
        // UR-1: Tabelle als Aufklappzeile; ohne Stände entfällt die Zeile.
        bindWealthRecords(doc); renderWealthRecords(doc, prepared.rows);
        byId('managerWealthHint').textContent = !household || prepared.rows.length ? '' : 'Noch keine Stände erfasst. Mit „Stand jetzt erfassen“ legst du den ersten an.';
    } catch (error) {
        byId('managerWealthMetrics').innerHTML = '';
        byId('managerWealthTable').innerHTML = '';
        renderWealthRecords(doc, []);
        byId('managerWealthHint').textContent = `Erfasste Stände können nicht angezeigt werden: ${error.message}`;
        chart = history;
    }
    byId('managerWealthLegend').innerHTML = managerHistoryLegend(chart);
    if (byId('managerWealthBasis')) byId('managerWealthBasis').textContent = chart
        ? `${chart.points.some(point => Number.isFinite(point.total)) ? 'Kurve aus Beständen und Tageskursen' : 'Keine bewertbare Tageskurve'}${chart.closures?.length ? ' · Rauten aus erfassten Ständen' : ''}`
        : '';
    byId('managerWealthDailyNote').textContent = '';
    bindHistoryDayInteraction(host);
    bindHistoryChartSize(host, (value, size) => {
        host.innerHTML = value ? renderWealthHistorySvg(value, size) : '';
    }).update(chart);
}
