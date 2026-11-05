import { createExpenseNeedsLegend } from './balance-expenses-renderer.js';
import { appNow } from '../shared/app-clock.js';
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

function chartMarkup(rows, currentYear, hostWidth = 0, forecast = null) {
    const segmented = rows.some(row => row.segments);
    const labelSpace = segmented ? 230 : 0;
    const width = Math.max(640 + labelSpace, 110 + rows.length * 150 + labelSpace, hostWidth);
    const baseline = 190, height = 140;
    const forecastFor = row => row.isCurrentPartialYear && forecast?.year === row.year
        && Number.isFinite(forecast.amount) && forecast.amount > 0 ? forecast.amount : null;
    const maximum = rows.reduce((max, row) => Math.max(max, row.annualUsed, forecastFor(row) || 0), 1);
    const y = value => baseline - (value / maximum) * height;
    const bars = rows.map((row, index) => {
        const status = yearStatus(row, currentYear);
        const slot = (width - 110 - labelSpace) / rows.length;
        const barWidth = Math.min(64, slot - 20);
        const x = 110 + index * slot + (slot - barWidth) / 2, center = x + barWidth / 2;
        const projected = forecastFor(row);
        const extension = projected > row.annualUsed
            ? `<rect class="expenses-year-forecast" fill="url(#expensesForecastHatch)" x="${x}" y="${y(projected)}" width="${barWidth}" height="${(projected - row.annualUsed) / maximum * height}"/>` : '';
        let actualBar = `<rect class="expenses-year-bar${status.barClass ? ` ${status.barClass}` : ''}" x="${x}" y="${y(row.annualUsed)}" width="${barWidth}" height="${(row.annualUsed / maximum) * height}"/>`;
        let partsDescription = '', partLabels = '';
        if (row.segments) {
            let cumulative = 0;
            const labels = { floor: 'Floor', flex: 'Flex', unallocated: 'ohne Aufteilung' };
            const positions = [];
            actualBar = Object.entries(row.segments).map(([key, amount]) => {
                const bottom = y(cumulative); cumulative += amount; const top = y(cumulative);
                if (amount === 0) return '';
                positions.push({ label: labels[key], amount, at: (top + bottom) / 2 });
                return `<rect class="expenses-year-bar expenses-year-${key}" x="${x}" y="${Math.min(top, bottom)}" width="${barWidth}" height="${Math.abs(bottom - top)}"/>`;
            }).join('');
            partsDescription = Object.entries(row.segments).map(([key, amount]) => `, ${labels[key]} ${euro(amount)}`).join('');
            if (row.year === currentYear) {
                if (extension) positions.push({ label: 'Prognose', amount: projected - row.annualUsed, at: (y(projected) + y(row.annualUsed)) / 2 });
                let previous = 20;
                partLabels = positions.reverse().map(part => {
                    const at = Math.max(previous + 20, Math.min(174, part.at)); previous = at;
                    return `<text class="expenses-year-part-label" x="${x + barWidth + 12}" y="${at}">${part.label} ${euro(part.amount)}</text>`;
                }).join('');
            }
        }
        const valueX = !segmented && extension ? x + barWidth + 8 : center;
        const valueY = y(segmented && extension ? projected : row.annualUsed) - 8;
        return `<g><title>${escape(yearLabel(row, status))}: Ausgaben gesamt ${euro(row.annualUsed)}${partsDescription}, ${row.monthsWithData} Monate mit Daten, Ø pro Monat ${euro(row.avgMonthly)}${projected === null ? '' : `, Hochrechnung ${euro(projected)}`}</title>${actualBar}${extension}<text x="${valueX}" y="${valueY}" text-anchor="${!segmented && extension ? 'start' : 'middle'}">${euro(segmented && extension ? projected : row.annualUsed)}</text>${partLabels}<text class="expenses-year-label" x="${center}" y="212" text-anchor="middle">${row.year}</text><text x="${center}" y="234" text-anchor="middle">${row.monthsWithData} Monate mit Daten</text><text x="${center}" y="254" text-anchor="middle">${status.showLabel ? status.label : ''}</text></g>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 270" width="${width}" height="270" style="width:${width}px;min-width:${width}px;height:270px" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="expensesChartTitle" aria-describedby="expensesChartDesc"><title id="expensesChartTitle">Ausgaben je Jahr in nominalen Euro</title><desc id="expensesChartDesc">Säulen zeigen tatsächliche Jahresausgaben aller gespeicherten Personen.${segmented ? ' Von unten: Floor (dunkles Gold), Flex (helles Gold), ohne oder mit nicht lesbarer Aufteilung (grau). Geplante Ausgaben sind enthalten.' : ''} Laufende Teiljahre sind textlich markiert; die helle Schraffur verlängert bis zur verfügbaren Hochrechnung aus vollständigen, abgelaufenen Monaten. Die folgende Tabelle enthält je Jahr die Ausgaben gesamt, Monate mit Daten und Ø pro Monat. Monate mit Daten sind Monate mit positiven Ausgaben; Nullimporte zählen nicht. Für den Vergleich unvollständiger Jahre dient Ø pro Monat. Historische Jahresbudgets werden nicht gespeichert.</desc><defs><pattern id="expensesForecastHatch" width="6" height="6" patternUnits="userSpaceOnUse"><rect class="expenses-year-forecast-base" width="6" height="6"/><path class="expenses-year-hatch" d="M -1 1 L 1 -1 M 0 6 L 6 0 M 5 7 L 7 5"/></pattern></defs>${bars}</svg>`;
}

function tableMarkup(rows, currentYear) {
    return `<table class="ds-table"><caption class="balance-table-caption">Alle Personen · Beträge ohne Inflationsbereinigung · Ø pro Monat zum Vergleich unvollständiger Jahre</caption><thead><tr>${['Jahr', 'Status', 'Ausgaben gesamt', 'Monate mit Daten', 'Ø pro Monat'].map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${row.year}</th><td>${yearStatus(row, currentYear).label}${row.origin || ''}</td><td>${euro(row.annualUsed)}</td><td>${row.monthsWithData}</td><td>${euro(row.avgMonthly)}</td></tr>`).join('')}</tbody></table>`;
}

export function renderBalanceExpensesHistory(dom, result, currentYear, backend = 'unknown', forecast = null) {
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
    if (dom.legend) { dom.legend.replaceChildren(); dom.legend.hidden = true; }
    if (!(dom.isVisible ? dom.isVisible() : dom.panel?.classList.contains('active'))) return true;
    try {
        if (!result || result.status === 'corrupt') throw new Error('store');
        validateContainers(result.store);
        const rows = prepareExpensesHistoryMetrics(result.store, currentYear, { includeSegments: Boolean(dom.showNeedsSegments) }).map(row => {
            const records = Object.values(result.store.years[row.year]?.months || {}).flatMap(month => Object.values(month.profiles || {}));
            const count = records.filter(record => record.source === 'probelauf-example').length;
            return { ...row, origin: count ? ` · Beispieldaten (Spielbereich)${count < records.length ? ' · gemischte Herkunft' : ''}` : '' };
        });
        if (rows.some(row => !Number.isFinite(row.annualUsed) || !Number.isFinite(row.avgMonthly))) throw new Error('amount');
        if (rows.length) {
            if (dom.legend && dom.showNeedsSegments) {
                dom.legend.append(createExpenseNeedsLegend(dom.legend.ownerDocument, ['floor', 'flex', 'unallocated', 'forecast'])); dom.legend.hidden = false;
            }
            if (dom.chart) bindBalanceDisplaySize(dom.chart, width => {
                dom.chart.innerHTML = chartMarkup(rows, currentYear, width, forecast);
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
            (options.now || appNow)().getFullYear(), backend, options.forecast);
    } catch {
        return renderBalanceExpensesHistory(dom, null, 0, backend);
    }
}
