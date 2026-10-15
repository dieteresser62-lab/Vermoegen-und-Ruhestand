import { appNow } from '../shared/app-clock.js';
// @ts-check
import { bindBalanceDisplaySize, bindBalanceTableOverflow } from './balance-presentation-controls.js';
import { UIUtils } from './balance-utils.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';
import { loadExpensesStoreResult } from './balance-expenses-storage.js';
import { prepareExpensesHistoryMetrics } from './balance-expenses-metrics.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const euro = value => escape(UIUtils.formatBalanceCurrency(value));
const yearLabel = (row, status) => `${row.year} – ${status.label}${row.origin || ''}`;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const diagnoses = {
    'expenses-store-read-failed': 'Der gespeicherte Ausgabenbereich konnte nicht gelesen werden.',
    'expenses-store-json-invalid': 'Die gespeicherten Ausgabendaten enthalten kein gueltiges JSON.',
    'expenses-store-root-invalid': 'Die gespeicherten Ausgabendaten haben keinen gueltigen Objektaufbau.',
    'expenses-store-version-unsupported': 'Die gespeicherten Ausgabendaten verwenden eine nicht unterstuetzte Version.',
    'expenses-store-years-invalid': 'Die gespeicherten Ausgabenjahre haben keinen gueltigen Objektaufbau.'
};

// Die Speicherprüfung erkennt Wurzelfehler; Untercontainer hier ausschließlich lesen.
function validateContainers(store) {
    if (!isRecord(store?.years)) throw new Error('structure');
    for (const year of Object.values(store.years)) {
        if (!isRecord(year) || (year.months !== undefined && !isRecord(year.months))) throw new Error('structure');
        for (const month of Object.values(year.months || {})) {
            if (!isRecord(month) || (month.profiles !== undefined && !isRecord(month.profiles))) throw new Error('structure');
            for (const profile of Object.values(month.profiles || {})) {
                if (!isRecord(profile) || !isRecord(profile.categories)
                    || Object.values(profile.categories).some(value =>
                        !['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)))) throw new Error('structure');
            }
        }
    }
}

function yearStatus(row, currentYear) {
    if (row.year > currentYear) return { label: 'zukünftiges Jahr', barClass: '', showLabel: true };
    if (row.year < currentYear) return { label: 'abgeschlossenes Kalenderjahr', barClass: 'expenses-year-complete', showLabel: false };
    return { label: row.isCurrentPartialYear ? 'laufendes Teiljahr' : 'laufendes Jahr', barClass: 'expenses-year-current', showLabel: row.isCurrentPartialYear };
}

function chartMarkup(rows, currentYear, hostWidth = 0) {
    const width = Math.max(640, 110 + rows.length * 150, hostWidth);
    const baseline = 190, height = 140;
    const maximum = rows.reduce((max, row) => Math.max(max, row.annualUsed), 1);
    const y = value => baseline - (value / maximum) * height;
    const bars = rows.map((row, index) => {
        const status = yearStatus(row, currentYear);
        const slot = (width - 110) / rows.length;
        const barWidth = Math.min(64, slot - 20);
        const x = 110 + index * slot + (slot - barWidth) / 2, center = x + barWidth / 2;
        return `<g><title>${escape(yearLabel(row, status))}: Ausgaben gesamt ${euro(row.annualUsed)}, ${row.monthsWithData} Monate mit Daten, Ø pro Monat ${euro(row.avgMonthly)}</title><rect class="expenses-year-bar${status.barClass ? ` ${status.barClass}` : ''}" x="${x}" y="${y(row.annualUsed)}" width="${barWidth}" height="${(row.annualUsed / maximum) * height}"/><text x="${center}" y="${y(row.annualUsed) - 8}" text-anchor="middle">${euro(row.annualUsed)}</text><text class="expenses-year-label" x="${center}" y="212" text-anchor="middle">${row.year}</text><text x="${center}" y="234" text-anchor="middle">${row.monthsWithData} Monate mit Daten</text><text x="${center}" y="254" text-anchor="middle">${status.showLabel ? status.label : ''}</text></g>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 270" width="${width}" height="270" style="width:${width}px;min-width:${width}px;height:270px" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="expensesChartTitle" aria-describedby="expensesChartDesc"><title id="expensesChartTitle">Ausgaben je Jahr in nominalen Euro</title><desc id="expensesChartDesc">Säulen zeigen tatsächliche Jahresausgaben aller gespeicherten Profile. Laufende Teiljahre sind textlich markiert. Die folgende Tabelle enthält je Jahr die Ausgaben gesamt, Monate mit Daten und Ø pro Monat. Monate mit Daten sind Monate mit positiven Ausgaben; Nullimporte zählen nicht. Für den Vergleich unvollständiger Jahre dient Ø pro Monat, ohne Hochrechnung. Historische Jahresbudgets werden nicht gespeichert.</desc>${bars}</svg>`;
}

function singleYearMarkup(row, currentYear) {
    return `<div class="expenses-year-summary"><div><strong>${row.year}</strong><span>${escape(yearStatus(row, currentYear).label + (row.origin || ''))}</span></div><div><span>Ausgegeben</span><b>${euro(row.annualUsed)}</b></div><div><span>Monate mit Daten</span><b>${row.monthsWithData}</b></div><div><span>Ø pro Monat</span><b>${euro(row.avgMonthly)}</b></div></div>`;
}

function tableMarkup(rows, currentYear) {
    return `<table class="ds-table"><caption class="balance-table-caption">Alle gespeicherten Profile · Ausgaben je Jahr in nominalen Euro – Ø pro Monat zum Vergleich unvollständiger Jahre</caption><thead><tr>${['Jahr', 'Status', 'Ausgaben gesamt', 'Monate mit Daten', 'Ø pro Monat'].map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${row.year}</th><td>${yearStatus(row, currentYear).label}${row.origin || ''}</td><td>${euro(row.annualUsed)}</td><td>${row.monthsWithData}</td><td>${euro(row.avgMonthly)}</td></tr>`).join('')}</tbody></table>`;
}

export function renderBalanceExpensesHistory(dom, result, currentYear, backend = 'unknown') {
    if (!dom) return false;
    if (dom.chart) {
        bindBalanceDisplaySize(dom.chart, null);
        dom.chart.innerHTML = '';
    }
    if (dom.table) {
        dom.table.innerHTML = '';
        bindBalanceTableOverflow(dom.table, dom.scrollHint);
    }
    if (dom.hint) dom.hint.textContent = '';
    if (!(dom.isVisible ? dom.isVisible() : dom.panel?.classList.contains('active'))) return true;
    try {
        if (!result || result.status === 'corrupt') throw new Error('store');
        validateContainers(result.store);
        const rows = prepareExpensesHistoryMetrics(result.store, currentYear).map(row => {
            const records = Object.values(result.store.years[row.year]?.months || {}).flatMap(month => Object.values(month.profiles || {}));
            const count = records.filter(record => record.source === 'probelauf-example').length;
            return { ...row, origin: count ? ` · Beispieldaten (Spielbereich)${count < records.length ? ' · gemischte Herkunft' : ''}` : '' };
        });
        if (rows.some(row => !Number.isFinite(row.annualUsed) || !Number.isFinite(row.avgMonthly))) throw new Error('amount');
        if (rows.length) {
            if (dom.chart && rows.length === 1) dom.chart.innerHTML = singleYearMarkup(rows[0], currentYear);
            else if (dom.chart) bindBalanceDisplaySize(dom.chart, width => {
                dom.chart.innerHTML = chartMarkup(rows, currentYear, width);
            });
            if (dom.table) {
                dom.table.innerHTML = tableMarkup(rows, currentYear);
                bindBalanceTableOverflow(dom.table, dom.scrollHint);
            }
        } else if (dom.hint) dom.hint.textContent = 'Noch keine Ausgabendaten vorhanden.';
        return true;
    } catch {
        // Keine Fehlermeldung aus JSON/Finanzrohdaten in die Oberfläche übernehmen.
        const diagnosis = Object.hasOwn(diagnoses, result?.error?.code)
            ? diagnoses[result.error.code] : 'Die gespeicherten Ausgabendaten sind beschädigt oder nicht lesbar.';
        if (dom.hint) dom.hint.textContent = `Ausgaben je Jahr können nicht angezeigt werden. Betroffener Datenbereich: Ausgaben-Check. Backend: ${backend}. ${diagnosis} Bitte die Recovery im Ausgaben-Check verwenden; hier werden keine Daten zurückgesetzt.`;
        return false;
    }
}

export function refreshBalanceExpensesHistory(dom, options = {}) {
    if (!dom) return false;
    let backend = 'unknown';
    try { backend = String((options.getPersistenceStatus || (() => PersistenceFacade.getPersistenceStatus()))()?.backend || 'unknown'); } catch { /* Diagnose bleibt lesbar. */ }
    try {
        return renderBalanceExpensesHistory(dom,
            (options.loadStore || (() => loadExpensesStoreResult(options.storage)))(),
            (options.now || appNow)().getFullYear(), backend);
    } catch {
        return renderBalanceExpensesHistory(dom, null, 0, backend);
    }
}
