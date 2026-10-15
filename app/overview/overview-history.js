import { escapeHtml } from '../shared/security-utils.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { historyDate, readDailyPrices, WEALTH_HISTORY_START_KEY } from '../tranches/tranchen-history-store.js';
import { renderWealthHistorySvg, wealthHistoryScale, bindHistoryDayInteraction, bindHistoryChartSize, HISTORY_TYPE_LABELS } from '../tranches/tranchen-history-svg.js';
import { buildHistoryMeasurementHtml } from '../tranches/tranchen-history-ui.js';
import { overviewHistoryView } from './overview-model.js';
const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 }) : '—';
const signed = value => Number.isFinite(value) ? (value > 0 ? '+' : '') + money(value) : '—';
const percent = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'percent', fractionDigits: 1 }) : 'Prozent nicht verfügbar';
const day = value => Number.isInteger(value) ? historyDate(value).split('-').reverse().join('.') : '';
function historyMetric(label, value, detail, amount) {
    const sign = amount === undefined ? 'plain' : Number.isFinite(amount) ? amount > 0 ? 'positive' : amount < 0 ? 'negative' : 'zero' : 'missing';
    return `<div class="history-metric"><span>${escapeHtml(label)}</span><strong data-history-sign="${sign}">${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`;
}
export function renderOverviewHistory(doc, model) {
    const history = model.history, host = doc.getElementById('overviewHistoryChart');
    if (!host) return;
    const set = (id, text) => { const node = doc.getElementById(id); if (node) node.textContent = text; };
    doc.querySelectorAll?.('[data-history-period]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.historyPeriod === (model.historyPeriod || 'all')));
    });
    const ready = history?.status === 'ready';
    const view = ready ? overviewHistoryView(history) : null;
    set('overviewHistoryStand', ready ? `Tagesabschluss bis ${day(history.range.end)} · Verlauf ab ${history.startDate.split('-').reverse().join('.')}` : 'Tagesabschluss noch nicht verfügbar');
    const running = model.historyReport?.status === 'running';
    const notes = [];
    if (running) notes.push('Tageskurse werden nachgeladen. Bereits gespeicherte Werte bleiben sichtbar.');
    if (!ready) notes.push(history?.status === 'corrupt' ? `Verlaufsdaten beschädigt: ${history.error}` : 'Noch keine Verlaufshistorie. Sie wird nach der Kursaktualisierung vorbereitet.');
    else {
        if (!history.points.length) notes.push('In diesem Zeitraum liegt noch kein abgeschlossener Tag.');
        if (history.end?.total === null) notes.push(`Teilabdeckung · bekannter Betrag ${money(history.end.known)} · Gesamtwert nicht vollständig bewertbar.`);
        if (history.errors.length) notes.push('Historische Bewertung unvollständig: ' + history.errors.join(' · '));
        if (history.points.some(point => point.quality.includes('missing-ticker'))) notes.push('Kein Kursverlauf ohne Ticker.');
        if (history.points.some(point => point.quality.includes('unsupported-currency'))) notes.push('Nicht unterstützte Kurswährung: keine EUR-Umrechnung verfügbar.');
        if (history.points.some(point => point.quality.includes('missing-first-price'))) notes.push('Erster Schlusskurs fehlt; unbekannte Abschnitte bleiben ohne Fläche.');
        if (history.gaps.length) notes.push('Ungeprüfte Werktage sind schraffiert. Fehlende Tageskurse werden beim nächsten Start nachgeladen.');
        if (history.points.some(point => point.assumedCash)) notes.push('Tagesgeldbasis vor dem ersten Eintrag rückwirkend angenommen.');
        if (history.hints.length) notes.push('Nach drei erfolglosen Versuchen: ' + history.hints.join(' · '));
    }
    if (model.historyReport?.status === 'cancelled') notes.push('Nachladen abgebrochen; bestätigte Kurse bleiben erhalten.');
    if (model.historyReport?.status === 'budget-ended') notes.push('Nachladen wird beim nächsten Start fortgesetzt.');
    if (['unavailable', 'storage-error'].includes(model.historyReport?.status)) notes.push('Kursverlauf konnte nicht vollständig geladen oder gespeichert werden.');
    const status = doc.getElementById('overviewHistoryStatus');
    if (status) status.innerHTML = (ready ? buildHistoryMeasurementHtml(history.measurementStart, history.metrics.status, history.range.start) : '')
        + (notes.length ? `<span class="history-status-notes">${escapeHtml(notes.join(' '))}</span>` : '');
    bindHistoryDayInteraction(host);
    bindHistoryChartSize(host, (projection, size) => {
        host.innerHTML = projection ? renderWealthHistorySvg(projection, size) : '';
    }).update(ready && history.points.length ? view : null);
    const legend = doc.getElementById('overviewHistoryLegend');
    const cropped = ready && wealthHistoryScale(view.points).floor > 0;
    if (legend) legend.innerHTML = ready ? (cropped ? '' : view.types.filter(type => view.points.some(point => point.allocation[type] > 0)).map(type => `<span><i class="history-${type}"></i>${escapeHtml(HISTORY_TYPE_LABELS[type] || type)}</span>`).join(''))
        + '<span><i class="history-total-key"></i>Gesamtwert</span><span><i class="history-buy-key"></i>Kauf</span><span><i class="history-sell-key"></i>Verkauf</span>' + (history.gaps.length ? '<span><i class="history-gap-key"></i>Ungeprüfte Werktage</span>' : '') : '';
    const metrics = doc.getElementById('overviewHistoryMetrics');
    const m = ready ? history.metrics : {};
    const qualifier = m.status === 'provisional' || m.status === 'complete' ? '' : ' · nicht vollständig bewertbar';
    const period = ready && Number.isInteger(history.measurementStart) ? `seit ${day(history.measurementStart)} bis ${day(history.range.end)} · ` : 'Noch keine bewertbare Vergleichsbasis · ';
    if (metrics) metrics.innerHTML = historyMetric('Letzter Tagesabschluss', money(history?.end?.total), ready ? `am ${day(history.range.end)} · aus Beständen und Tageskursen` : 'Nicht verfügbar')
        + historyMetric('Veränderung', signed(m.change), period + percent(m.percent) + ' · nach Entnahmen' + qualifier, m.change ?? null);
    set('overviewHistorySource', 'Schlusskurse und bestätigte Bestände; Tagesgeld aus erfassten Ständen.'
        + (history?.cashPlayValues ? ' Enthält Tagesgeld-Spielwerte aus dem Spielbereich.' : ''));
}

const bindings = new WeakMap();
export function bindOverviewHistory({ doc, win, refresh, storage }) {
    if (bindings.has(doc)) return bindings.get(doc);
    const state = { period: 'all', report: null };
    const buttons = doc.getElementById('overviewHistoryPeriods');
    buttons?.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-history-period]');
        if (!button || !['all', 'year', '12m'].includes(button.dataset.historyPeriod)) return;
        state.period = button.dataset.historyPeriod; refresh();
    });
    // Der bestehende Abrufjob bietet Abschlussberichte. Währenddessen werden ausschließlich
    // bestätigte Kursrecords gelesen: readDailyPrices verbirgt noch nicht geflushte Kandidaten.
    state.watch = task => {
        state.report = { status: 'running' }; refresh();
        let previous = null;
        const timer = win.setInterval?.(() => {
            const prices = readDailyPrices(storage), start = storage.getItem(WEALTH_HISTORY_START_KEY);
            const fingerprint = start + '\n' + prices.raw;
            if (fingerprint !== previous) { previous = fingerprint; refresh(); }
        }, 500);
        const clear = () => win.clearInterval?.(timer);
        win.addEventListener?.('pagehide', clear, { once: true });
        Promise.resolve(task).then(report => { state.report = report || null; refresh(); }, () => {
            state.report = { status: 'unavailable' }; refresh();
        }).finally(() => { clear(); win.removeEventListener?.('pagehide', clear); });
    };
    bindings.set(doc, state);
    return state;
}
