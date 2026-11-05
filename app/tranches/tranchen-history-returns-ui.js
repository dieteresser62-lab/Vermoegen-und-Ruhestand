/** @import * as H from "../../typcheck/tranches-history.js" */
import { escapeHtml } from '../shared/security-utils.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { infoPopoverHtml, bindInfoPopovers } from '../shared/designsystem-info-popover.js';
import { prepareProfileHistoryProfiles } from '../profile/profile-wealth-history.js';
import { evaluateHistoryReturns, selectHistoryReturnMetrics } from './tranchen-history-returns.js';
import { historyDate } from './tranchen-history-store.js';
import { renderHistorySparkline, HISTORY_TYPE_LABELS } from './tranchen-history-svg.js';

const number = (value, digits = 1) => formatDisplayNumber(value, { fractionDigits: digits }).replace('-', '−');
const signed = value => (value > 0 ? '+' : '') + number(value);
const percent = value => Number.isFinite(value) ? signed(value * 100) + ' %' : '—';
const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 }).replace('-', '−') : '—';
const signedMoney = value => Number.isFinite(value) ? (value > 0 ? '+' : '') + money(value) : '—';
const date = day => Number.isInteger(day) ? historyDate(day).split('-').reverse().join('.') : '—';
const shortDate = day => date(day).slice(0, 6);
const signClass = value => Number.isFinite(value) && value !== 0 ? value > 0 ? 'history-positive' : 'history-negative' : '';
const unavailable = '<p class="history-note">Noch zu wenig Verlauf für Kennzahlen.</p>';
const incomplete = '<p class="history-note">Kennzahlen nicht bewertbar: Verlaufsdaten unvollständig.</p>';
const coverageText = coverage => {
    const missing = [...new Set(coverage.missing)].join(', ');
    const reason = missing ? ` (${missing} ohne Kurs)` : '';
    return coverage.through !== null
        ? `vorläufig: bis ${date(coverage.through)} – danach nicht bewertbar${reason}`
        : `Noch keine bewertbaren Tage${missing ? `: ${missing} ohne Kurs` : ''}.`;
};
const provisional = (value, coverage) => {
    if (coverage) return `<p class="history-note history-returns-provisional">${escapeHtml(coverageText(coverage))}</p>`;
    return value ? '<small class="history-note history-returns-provisional">vorläufig</small>' : '';
};
const priceReturnNote = 'Kursrendite ohne Ausschüttungen; bei ausschüttenden Fonds zu niedrig';
const title = (text, info = '') => `<div class="ds-card-title"><h2>${text}</h2>${info ? infoPopoverHtml('Erläuterung zu ' + text, info, { handbookAnchor: 'verlauf-depotkennzahlen' }) : ''}</div>`;

/** @param {string} period
 * @returns {string} */
export function historyReturnPeriodsMarkup(period) {
    return `<div class="history-return-periods" role="group" aria-label="Zeitraum für Rendite und Risiko">${[['year', 'Dieses Jahr'], ['12m', '12 Monate'], ['all', 'Seit Beginn']].map(([key, label]) =>
        `<button type="button" class="ds-button ds-button-secondary" data-history-return-period="${key}" aria-pressed="${key === period}">${label}</button>`).join('')}</div>`;
}

/** @param metrics Rendite- und Risikoprojektion oder Ladezustand.
 * @param {string} [period]
 * @returns {string} */
export function historyRiskMarkup(metrics, period = 'year') {
    const periods = historyReturnPeriodsMarkup(period);
    const header = `<header class="history-heading">${title('Rendite und Risiko', 'Die Rendite zählt Anlagen ohne Tagesgeld und ohne Ausschüttungen. Zeitgewichtete Rendite blendet Käufe und Verkäufe aus; der Zinsfuß berücksichtigt ihre Zeitpunkte. Rückgang und Erholung beziehen sich auf die Rendite.')}${periods}</header>`;
    if (metrics.status === 'unavailable') return header + (metrics.coverage ? provisional(true, metrics.coverage) : incomplete);
    if (metrics.status === 'insufficient') return header + unavailable + provisional(false, metrics.coverage);
    const metric = (label, value, note, amount) => `<div class="history-return-metric"><div>${label}</div><div class="history-return-value ${signClass(amount)}">${escapeHtml(value)}</div><div class="history-return-note">${escapeHtml(note)}</div></div>`;
    const twrNote = metrics.annualized !== null ? `insgesamt · ${percent(metrics.annualized)} pro Jahr` : 'ohne Wirkung von Käufen und Verkäufen';
    return header + `<p class="history-return-note">${date(metrics.displayStart ?? metrics.start)}–${date(metrics.end)} · Anlagen ohne Tagesgeld</p>`
        + provisional(false, metrics.coverage) + '<div class="history-return-grid">'
        + metric('Rendite zeitgewichtet', percent(metrics.twr), twrNote + '. ' + priceReturnNote, metrics.twr)
        + metric('Rendite pro Jahr (IZF)', percent(metrics.xirr), metrics.days < 365 ? 'hochgerechnet, Zeitraum unter einem Jahr' : 'mit Zeitpunkt der Käufe und Verkäufe', metrics.xirr)
        + metric('Wertänderung', signedMoney(metrics.change), `Markt ${signedMoney(metrics.market)} · Käufe/Verkäufe ${signedMoney(metrics.netFlows)}`, metrics.change)
        + metric('Größter Rückgang', percent(metrics.drawdown?.value), metrics.drawdown ? metrics.drawdown.value === 0 ? 'Kein Rückgang' : `${date(metrics.drawdown.from)}–${date(metrics.drawdown.to)}` : '', metrics.drawdown?.value)
        + metric('Längste Erholung', metrics.recovery ? `${metrics.recovery.days}${metrics.recovery.open ? '+' : ''} Tage` : '—', metrics.recovery?.open ? 'noch nicht erholt' : 'bis zum neuen Höchststand')
        + metric('Schwankung', Number.isFinite(metrics.volatility) ? number(metrics.volatility * 100) + ' %' : '—', 'pro Jahr, aus Tagesrenditen')
        + '</div>' + provisional(metrics.status === 'provisional' && !metrics.coverage);
}

function heatClass(value, annual = false) {
    if (!Number.isFinite(value) || value === 0) return 'history-heat-neutral';
    const level = Math.min(6, Math.max(1, Math.ceil(Math.abs(value) / (annual ? 0.18 : 0.06) * 6)));
    return `history-heat-${value > 0 ? 'positive' : 'negative'}-${level}`;
}

/** @param {H.MonthlyRows} rows
 * @param {string} label
 * @returns {string} */
export function historyMonthlyTableMarkup(rows, label) {
    const cell = (item, annual = false) => {
        const value = item?.value;
        return `<td class="${heatClass(value, annual)}${item?.partial ? ' history-return-partial' : ''}${annual ? ' history-return-year' : ''}">${item ? Number.isFinite(value) ? (item.partial && !annual ? '(' : '') + number(value * 100) + (item.partial && !annual ? ')' : '') : '—' : ''}</td>`;
    };
    return `<div class="history-return-table-scroll" tabindex="0" role="region" aria-label="Monatsrenditen ${escapeHtml(label)}"><table class="history-return-table"><thead><tr><th scope="col"></th>${['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D', 'Jahr'].map(month => `<th scope="col">${month}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${row.year}</th>${row.months.map(item => cell(item)).join('')}${cell(row, true)}</tr>`).join('')}</tbody></table></div>`;
}

/** @param {H.Returns} result
 * @returns {string} */
export function historyMonthlyMarkup(result) {
    const header = `<header class="history-heading">${title('Monatsrenditen')}<span class="history-return-note">zeitgewichtet, in % · Teilmonate in Klammern</span></header>`;
    if (result.invalid || result.metrics.status === 'unavailable' && !result.coverage) return header + incomplete;
    if (result.series.length < 2) return header + (result.coverage ? provisional(true, result.coverage) : unavailable) + historyReturnGroupsMarkup(result.groups);
    return header + provisional(false, result.coverage) + '<div class="history-return-table-label">Alle Anlagen</div>' + historyMonthlyTableMarkup(result.monthly, 'Alle Anlagen')
        + historyReturnGroupsMarkup(result.groups)
        + provisional(result.provisional && !result.coverage);
}

/** @param {H.Returns["groups"]} groups
 * @returns {string} */
export function historyReturnGroupsMarkup(groups) {
    return `<div class="history-return-groups">${groups.map(group => {
        const usable = !group.invalid && group.series.length >= 2 && group.metrics.status !== 'unavailable';
        const note = group.coverage ? '' : provisional(group.provisional);
        const summary = usable ? group.monthly.map(row => `${row.year}${historyDate(row.firstDay).slice(5) !== '01-01' ? ' ab ' + shortDate(row.firstDay) : ''}: ${percent(row.value)}`).join(' · ') : 'nicht bewertbar';
        const warning = group.coverage ? ' · ' + escapeHtml(coverageText(group.coverage)) : '';
        return `<details class="history-return-group" data-history-return-group="${group.type}"><summary><i class="history-${group.type}" aria-hidden="true"></i><span>${HISTORY_TYPE_LABELS[group.type]}</span><span class="history-return-summary">${summary}${warning}</span><span class="history-return-arrow" aria-hidden="true"></span></summary>${note}${usable ? historyMonthlyTableMarkup(group.monthly, HISTORY_TYPE_LABELS[group.type]) : group.coverage ? provisional(true, group.coverage) : group.metrics.status === 'insufficient' ? unavailable : incomplete}</details>`;
    }).join('')}</div>`;
}

/** @param {H.Returns} result
 * @returns {string} */
export function historyYearsMarkup(result) {
    const header = `<header>${title('Jahresübersicht')}</header>`;
    if (result.invalid || result.metrics.status === 'unavailable' && !result.coverage) return header + incomplete;
    if (result.series.length < 2) return header + (result.coverage ? provisional(true, result.coverage) : unavailable);
    return header + provisional(false, result.coverage) + `<div class="history-return-years">${result.years.map(year => {
        const m = year.metrics, startDate = historyDate(year.start), endDate = historyDate(year.end);
        const note = [startDate.slice(5) !== '01-01' ? 'ab ' + shortDate(year.start) : '', endDate.slice(5) !== '12-31' ? 'bis ' + shortDate(year.end) : ''].filter(Boolean).join(' · ');
        const end = result.series.findLast(p => p.day >= year.start && p.day <= year.end);
        const row = (label, value, amount, extra = '') => `<dt>${label}</dt><dd class="${signClass(amount)} ${extra}">${escapeHtml(value)}</dd>`;
        return `<section class="history-return-year-card" aria-label="Anlagen ${year.year}"><div class="history-return-year-title"><h3>${year.year}</h3><span class="history-return-note">${note}</span></div><div class="history-return-spark">${renderHistorySparkline(year.points, { title: `Anlagenwert ${year.year}`, width: 300, height: 70, kind: 'course' })}</div><dl>`
            + row('Endstand', money(end?.total), undefined, 'history-return-end')
            + row('Veränderung', signedMoney(m.change), m.change)
            + row('davon Käufe/Verkäufe', signedMoney(m.netFlows))
            + row('Rendite zeitgewichtet', percent(m.twr), m.twr) + '</dl></section>';
    }).join('')}</div>` + provisional(result.provisional && !result.coverage);
}

const states = new WeakMap();
/** Keine Rechnung außerhalb des Reiters; Klappen werden beim erneuten Öffnen geschlossen.
 * @param doc Dokument des Managers.
 * @param projection Personen- und Haushaltsprojektion.
 * @param registry Gelesene Registry.
 * @param {string} activeId
 * @param view Ausgewählter Managerbereich.
 * @returns {void} */
export function renderManagerHistoryReturns(doc, projection, registry, activeId, view) {
    const host = doc.getElementById('managerHistoryReturns');
    if (!host) return;
    let state = states.get(doc);
    if (!state) {
        state = { period: 'year', visible: false };
        states.set(doc, state);
        doc.getElementById('managerHistoryRisk').addEventListener('click', event => {
            const period = event.target?.closest?.('[data-history-return-period]')?.dataset.historyReturnPeriod;
            if (!['year', '12m', 'all'].includes(period) || !state.result) return;
            state.period = period;
            drawRisk();
            doc.querySelector(`[data-history-return-period="${period}"]`)?.focus();
        });
    }
    if (view?.kind !== 'history') { state.visible = false; return; }
    const scope = view.historyScope === 'person' ? activeId : null;
    const opened = state.visible && state.scope === scope ? Array.from(host.querySelectorAll('details[open]')).map(detail => detail.querySelector('summary > span')?.textContent) : [];
    state.visible = true; state.scope = scope;
    try {
        state.result = projection.historyContext?.status === 'ready' ? evaluateHistoryReturns({
            ...projection.historyContext, profiles: prepareProfileHistoryProfiles(registry, projection.profiles), profileId: scope
        }) : null;
        const result = state.result;
        const risk = doc.getElementById('managerHistoryRisk'), monthly = doc.getElementById('managerHistoryMonthly'), years = doc.getElementById('managerHistoryYears');
        if (!result) {
            risk.innerHTML = historyRiskMarkup({ status: 'insufficient' }, state.period);
            monthly.innerHTML = title('Monatsrenditen') + unavailable;
            years.innerHTML = title('Jahresübersicht') + unavailable;
        } else {
            drawRisk();
            monthly.innerHTML = historyMonthlyMarkup(result);
            years.innerHTML = historyYearsMarkup(result);
            host.querySelectorAll('details').forEach(detail => { detail.open = opened.includes(detail.querySelector('summary > span')?.textContent); });
        }
        bindInfoPopovers(doc, { root: host });
    } catch {
        state.result = null;
        for (const [id, label] of [['managerHistoryRisk', 'Rendite und Risiko'], ['managerHistoryMonthly', 'Monatsrenditen'], ['managerHistoryYears', 'Jahresübersicht']]) {
            doc.getElementById(id).innerHTML = title(label) + incomplete;
        }
    }
    function drawRisk() {
        const risk = doc.getElementById('managerHistoryRisk');
        risk.innerHTML = historyRiskMarkup(selectHistoryReturnMetrics(state.result, state.period), state.period);
        bindInfoPopovers(doc, { root: risk });
    }
}
