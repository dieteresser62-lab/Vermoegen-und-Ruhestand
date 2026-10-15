"use strict";

import { formatCurrencySafe, formatMetricStatus } from './results-formatting.js';
import { renderHeatmapSVG } from './simulator-heatmap.js';
import { escapeBacktestHtml as escape } from './historical-backtest-ui.js';

let nextInfoId = 1;

export const info = (id, title, text) => `<span class="ds-info"><button class="ds-info-button" type="button" aria-label="${escape(title)}" aria-expanded="false" aria-controls="${escape(id)}">i</button><span class="ds-info-pop" id="${escape(id)}" role="tooltip">${Array.isArray(text) ? text.filter(Boolean).map(paragraph => `<p>${escape(paragraph)}</p>`).join('') : escape(text)}</span></span>`;

const renderMetricPair = metrics => `<div class="sim-answer-pair">${metrics.map(metric => `<div><p class="sim-answer-metric-label">${escape(metric.label)}</p><p class="sim-answer-metric-value">${escape(metric.value)}</p>${metric.detail ? `<p class="ds-hint">${escape(metric.detail)}</p>` : ''}</div>`).join('')}</div>`;

/** Zwei verständliche Einstiegsantworten vor den unveränderten Kennzahlen. */
export function renderMonteCarloAnswers(container, answers, stale = false) {
    if (!container || !Array.isArray(answers)) return;
    container.innerHTML = answers.map((answer, index) => `<section class="sim-mc-answer ds-card" data-stale="${stale}">
        ${answer.tooltip ? `<div class="sim-card-heading"><h2>${escape(answer.question)}</h2>${info(`${container.id || 'monteCarloAnswers'}Info${index + 1}`, `Erläuterung zu „${answer.question}“`, answer.value === '—' ? `${answer.text} ${answer.tooltip}` : answer.tooltip)}</div>` : `<h2>${escape(answer.question)}</h2>`}
        ${answer.subtitle ? `<p class="ds-hint sim-answer-subtitle">${escape(answer.subtitle)}</p>` : ''}
        ${answer.metrics ? renderMetricPair(answer.metrics) : `<p class="sim-hero-amount">${escape(answer.value)}</p>`}
        ${answer.countText ? `<p class="sim-answer-count">${escape(answer.countText)}</p>` : ''}
        <p>${escape(answer.text)}</p>${answer.note ? `<p class="ds-hint${answer.compactNote ? ' sim-flex-note' : ''}"${answer.compactNote ? ` title="${escape(answer.note)}"` : ''}>${escape(answer.note)}</p>` : ''}
        ${stale ? '<p class="ds-hint sim-answer-status" role="status">Annahmen seitdem geändert</p>' : ''}</section>`).join('');
    bindResultInfoPopups(container.ownerDocument || globalThis.document);
}
const popupHosts = new WeakSet();
const popupDocuments = new WeakSet();
function metricInfo(title, text) {
    const id = `mcMetricInfo${nextInfoId++}`;
    return `<span class="ds-info"><button type="button" class="ds-info-button ds-button" aria-label="${escape(title)}" aria-expanded="false" aria-controls="${id}">i</button><span id="${id}" class="ds-info-pop" role="tooltip">${escape(text)}</span></span>`;
}

const metricValueTitle = kpi => kpi.displayValue !== undefined ? ` title="${escape(kpi.value)}"` : '';
const metricTooltip = kpi => `${kpi.tooltip || kpi.description || kpi.title}${kpi.displayValue !== undefined && kpi.value !== '—' ? ` Genauer Wert: ${kpi.value}` : ''}`;

/** Neue Renderknoten binden; vollständige kanonische Erklärungen bleiben erhalten. */
export function bindResultInfoPopups(documentRef = globalThis.document) {
    if (!documentRef?.querySelectorAll) return;
    const hosts = () => documentRef.querySelectorAll('#tab-montecarlo .ds-info');
    for (const host of hosts()) {
        if (popupHosts.has(host)) continue;
        const button = host.querySelector('.ds-info-button');
        if (!button) continue;
        popupHosts.add(host);
        let pinned = false;
        const show = visible => {
            host.dataset.visible = String(visible);
            button.setAttribute('aria-expanded', String(visible));
        };
        host.closeInfo = () => { pinned = false; show(false); };
        host.addEventListener('mouseenter', () => show(true));
        host.addEventListener('mouseleave', () => { if (!pinned && !host.contains(documentRef.activeElement)) show(false); });
        host.addEventListener('focusin', () => show(true));
        host.addEventListener('focusout', event => { if (!host.contains(event.relatedTarget)) host.closeInfo(); });
        button.addEventListener('click', () => { pinned = !pinned; show(pinned); });
        host.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); button.focus(); host.closeInfo(); }
        });
    }
    if (popupDocuments.has(documentRef)) return;
    popupDocuments.add(documentRef);
    documentRef.addEventListener?.('click', event => {
        for (const host of hosts()) if (!host.contains(event.target)) host.closeInfo?.();
    });
}

/**
 * Erstellt eine KPI-Karte als HTML-String.
 *
 * @param {import('./results-metrics.js').KpiDescriptor} kpi - Beschreibungsobjekt der Kennzahl.
 * @returns {string} HTML-Fragment der KPI-Karte.
 */
export function renderKpiCard(kpi) {
    const toneClass = mapToneToClass(kpi.tone);
    const layoutClass = kpi.layout === 'exact-risk' ? ' kpi-exact-value' : '';
    const roleClass = kpi.displayRole?.startsWith('withdrawal') ? ' kpi-withdrawal' : '';
    const description = kpi.description || '';
    const tooltip = kpi.tooltip || description || kpi.title;
    const statusLine = kpi.statusLine
        ? `<div class="kpi-status-line">${escape(formatMetricStatus(kpi.statusLine))}</div>`
        : '';
    const secondaryLine = kpi.secondaryLabel
        ? `<div class="kpi-secondary-value"><span>${kpi.secondaryLabel}</span><strong>${kpi.secondaryValue || '—'}</strong>${kpi.secondaryStatusLine ? `<small>${escape(formatMetricStatus(kpi.secondaryStatusLine))}</small>` : ''}</div>`
        : '';
    return `
    <div class="kpi-card ds-card ds-metric ${toneClass}${layoutClass}${roleClass}">
      <div class="sim-metric-heading"><strong>${kpi.title}</strong>${metricInfo(kpi.title, tooltip)}</div>
      ${kpi.pairedMetrics ? renderMetricPair(kpi.pairedMetrics) : `<div class="value-line">${kpi.value}</div>`}
      ${kpi.otherBasisLine ? `<p class="ds-hint sim-other-basis">${escape(kpi.otherBasisLine)}</p>` : ''}
      ${kpi.priceBasis ? `<p class="ds-hint sim-price-basis">${escape(kpi.priceBasis)}</p>` : ''}
      ${statusLine}
      ${secondaryLine}
      <div class="kpi-description">${description}</div>
    </div>`;
}

/** Ergänzende Werte mit denselben Angaben und Erklärungen als ruhige Zeilen. */
function renderMetricRow(kpi) {
    return `<div class="sim-metric-row summary-item kpi-card ds-card ds-metric ${mapToneToClass(kpi.tone)}">
        <div class="sim-metric-heading"><strong>${escape(kpi.title)}</strong>${metricInfo(kpi.title, metricTooltip(kpi))}</div>
        ${kpi.pairedMetrics ? renderMetricPair(kpi.pairedMetrics) : `<div class="value-line"${metricValueTitle(kpi)}>${kpi.displayValue ?? kpi.value}</div>`}
        ${kpi.priceBasis ? `<small class="sim-price-basis">${escape(kpi.priceBasis)}</small>` : ''}
        ${kpi.statusLine ? `<small class="kpi-status-line">${escape(formatMetricStatus(kpi.statusLine))}</small>` : ''}
        <div class="kpi-description summary-description">${kpi.description || ''}</div>
    </div>`;
}

/**
 * Rendert die Summary-KPIs in den übergebenen Container.
 *
 * @param {HTMLElement} container - Ziel-Container im DOM.
 * @param {Array<import('./results-metrics.js').KpiDescriptor>} summaryCards - Zusammenfassende KPIs.
 */
export function renderSummary(container, summaryCards) {
    if (!container || !Array.isArray(summaryCards)) return;

    // Alle Kennzahlen bleiben auch im einfachen Anzeigemodus erreichbar.
    const renderSummaryCard = card => {
        const tooltip = metricTooltip(card);
        const layoutClass = card.layout === 'exact-risk' ? ' summary-exact-value' : '';
        return `<div class="summary-item ds-card ds-metric${mapToneToSummaryClass(card.tone)}${layoutClass}">
            <div class="sim-metric-heading"><strong>${card.title}</strong>${metricInfo(card.title, tooltip)}</div>
            <span${metricValueTitle(card)}>${card.displayValue ?? card.value}</span>${card.statusLine ? `<small class="summary-status-line">${escape(formatMetricStatus(card.statusLine))}</small>` : ''}
            ${card.otherBasisLine ? `<small class="sim-other-basis">${escape(card.otherBasisLine)}</small>` : ''}
            <small class="summary-description">${card.description || ''}</small></div>`;
    };
    const floor = summaryCards.find(card => card.displayRole === 'floor');
    const outcomes = summaryCards.find(card => card.displayRole === 'outcomes');
    if (floor && outcomes) {
        const legend = outcomes.outcomes.map(outcome => `<span><i class="mc-outcome-${outcome.kind}"></i>${outcome.label} ${new Intl.NumberFormat('de-DE').format(outcome.count)}</span>`).join('');
        const bars = outcomes.outcomes.map(outcome => {
            const width = outcomes.requestedRuns > 0 ? Math.min(100, Math.max(0, outcome.count / outcomes.requestedRuns * 100)) : 0;
            return `<span class="mc-outcome-${outcome.kind}" style="width:${width}%"></span>`;
        }).join('');
        const wealthCards = summaryCards.filter(card => card !== floor && card !== outcomes);
        container.innerHTML = `<div class="mc-overview-grid">
            <section class="mc-final-card ds-card"><div class="mc-final-heading"><h3>Endvermögen und Steuern</h3><span>${escape(wealthCards[0]?.priceBasis || 'nominale Euro')}</span></div>
                <div class="mc-wealth-summary">${wealthCards.slice(0, 1).map(renderSummaryCard).join('')}<div class="sim-metric-list">${wealthCards.slice(1).map(renderMetricRow).join('')}</div></div>
            </section>
            <section class="mc-floor-card ds-card ds-metric sim-run-summary${mapToneToSummaryClass(floor.tone)}">
                <div class="sim-metric-heading"><strong>${floor.title}</strong>${metricInfo(floor.title, floor.description)}</div>
                <div class="mc-floor-interval">${floor.intervalText}</div>
                <div class="mc-outcome-bar" aria-hidden="true">${bars}</div>
                <div class="mc-outcome-legend" aria-label="Endzustände">${legend}${metricInfo(outcomes.title, outcomes.description)}</div>
                <p class="summary-description">${floor.description}</p><p class="summary-description">${outcomes.description}</p>
            </section></div>`;
    } else {
        container.innerHTML = `<div class="summary-grid">${summaryCards.map(renderSummaryCard).join('')}</div>`;
    }
    bindResultInfoPopups();
}

/**
 * Rendert das KPI-Dashboard (Primär- und Detail-Karten) in den Container.
 *
 * @param {HTMLElement} container - Ziel-Container im DOM.
 * @param {{ primary: Array, detailSections: Array<{title: string, kpis: Array}> }} dashboard - Struktur aus dem Logikmodul.
 */
export function renderKpiDashboard(container, dashboard, riskContainer = null) {
    if (!container || !dashboard) return;

    const main = dashboard.primary.filter(card => card.displayRole === 'withdrawal');
    const supplementary = dashboard.primary.filter(card => !main.includes(card) && card.displayRole !== 'restriction');
    let html = '<section class="ds-card mc-primary-card"><h3 class="unified-kpi-header">Entnahmen</h3><div class="kpi-grid kpi-grid-primary">';
    html += main.map(renderKpiCard).join('');
    html += `</div><div class="sim-metric-list">${supplementary.map(renderMetricRow).join('')}</div></section><section class="ds-card mc-drawdown-card">`;

    if (Array.isArray(dashboard.drawdownKpis) && dashboard.drawdownKpis.length > 0) {
        html += '<h4 class="drawdown-pair-heading">Größter Vermögensrückgang</h4><p class="ds-hint sim-price-basis">Prozentuale Verluste: nominal und in heutiger Kaufkraft.</p>';
        html += '<div class="kpi-grid kpi-grid-pair">';
        html += dashboard.drawdownKpis.map(renderKpiCard).join('');
        html += '</div>';
    }

    const referenceLine = dashboard.reportingReferenceNotice
        ? `<p class="reporting-reference-note ds-note"><span>Entnahmequote: Berichtsreferenz</span>${metricInfo('Entnahmequote: Berichtsreferenz', dashboard.reportingReferenceNotice)}<span class="kpi-description">${dashboard.reportingReferenceNotice}</span></p>` : '';

    const detailHtml = dashboard.detailSections.map(section =>
        `<section class="ds-card"><h3>${section.title}</h3><div class="kpi-grid">${section.kpis.map(renderKpiCard).join('')}</div></section>`).join('');
    if (riskContainer) {
        riskContainer.innerHTML = detailHtml;
        riskContainer.style.display = 'block';
    }
    html += `<details class="mc-more-metrics ds-disclosure"><summary>Weitere Kennzahlen <small>operativ · Risiko · Tail-Risk</small></summary>${referenceLine}${detailHtml}</details></section>`;
    container.innerHTML = html;
    bindResultInfoPopups();
    container.style.display = 'block';
}

/**
 * Rendert die Stress-KPI-Sektion direkt unterhalb eines Bezugscontainers.
 *
 * @param {HTMLElement} referenceContainer - Container, unter dem die Stress-KPI-Sektion eingefügt wird.
 * @param {Object|null} stressMetrics - Von buildStressMetrics erzeugte Struktur.
 */
export function renderStressSection(referenceContainer, stressMetrics) {
    if (!referenceContainer) return;

    const existing = document.getElementById('stressKpiResults');
    if (existing) existing.remove();

    if (!stressMetrics) return;

    const newContainer = document.createElement('div');
    newContainer.id = 'stressKpiResults';
    newContainer.className = 'ds-card';

    const { presetLabel, years, kpis } = stressMetrics;
    let html = `
        <h3 class="unified-kpi-header">Ergebnisse des Stress-Szenarios</h3>
        <div class="ds-note">
            <strong>${presetLabel}</strong> (betrifft die ersten ${years} Jahre)
        </div>
        <div class="kpi-grid">`;
    html += kpis.slice(0, 3).map(renderKpiCard).join('');
    html += '</div><div class="kpi-grid" style="margin-top:15px;">';
    html += kpis.slice(3).map(renderKpiCard).join('');
    html += '</div>';

    newContainer.innerHTML = html;
    referenceContainer.parentNode.insertBefore(newContainer, referenceContainer.nextSibling);
    bindResultInfoPopups();
}

/**
 * Rendert den Heatmap-Bereich basierend auf den vorbereiteten Daten.
 *
 * @param {HTMLElement} container - Ziel-Container.
 * @param {Object} heatmapData - Objekt mit Heatmap-Daten und Metadaten.
 */
export function renderHeatmap(container, heatmapData) {
    if (!container || !heatmapData) return;

    // Fixed dimensions keep the SVG layout consistent across renders.
    container.innerHTML = renderHeatmapSVG(
        heatmapData.heatmap,
        heatmapData.bins,
        heatmapData.totalRuns,
        heatmapData.extraKPI,
        { width: 980, height: 420 }
    );
    container.style.display = 'block';
}

/**
 * Rendert die Pflege-KPIs oder blendet den Abschnitt aus, wenn keine vorliegen.
 *
 * @param {HTMLElement} summaryBox - Container für die KPI-Karten.
 * @param {HTMLElement} container - Gesamter Pflegebereich, der ein-/ausgeblendet wird.
 * @param {Object|null} careMetrics - Struktur aus buildCareMetrics.
 */
export function renderCareSection(summaryBox, container, careMetrics, personDisplayContext = {}) {
    if (!summaryBox || !container) return;

    if (!careMetrics) {
        container.style.display = 'none';
        return;
    }

    const groups = new Map();
    const personRows = new Map();
    const persons = new Set();
    const name = person => personDisplayContext.persons?.[person - 1]?.name || `Person ${person}`;
    const named = text => text.replace(/\bP1 \+ P2\b/g, () => persons.has(2) ? `${name(1)} + ${name(2)}` : name(1))
        .replace(/\bP([12])\b/g, (_, person) => name(Number(person)));
    for (const card of careMetrics.cards) {
        const person = card.title.match(/\bP([12])\b/);
        if (person) {
            const index = Number(person[1]);
            const label = card.title.replace(/\s+P[12]\b/, '');
            persons.add(index);
            if (!personRows.has(label)) personRows.set(label, new Map());
            personRows.get(label).set(index, card);
            continue;
        }
        const title = /bucket|Bucket|Pflegereserve|Reservenutzung|Restreserve|Zieldeckung|Ziellücke/.test(card.title) ? 'Pflegereserve' : 'Haushalt';
        if (!groups.has(title)) groups.set(title, []);
        groups.get(title).push(card);
    }
    const columns = Array.from(persons).sort();
    const comparison = columns.length ? `<section class="ds-card"><h3>Pflege im Vergleich</h3><div class="sim-care-comparison-scroll"><table class="ds-table sim-care-comparison"><thead><tr><th scope="col">Kennzahl</th>${columns.map(person => `<th scope="col">${escape(name(person))}</th>`).join('')}</tr></thead><tbody>${Array.from(personRows, ([label, values]) => `<tr><th scope="row">${escape(label)}${values.values().next().value?.priceBasis ? `<small class="sim-price-basis">${escape(values.values().next().value.priceBasis)}</small>` : ''}</th>${columns.map(person => {
        const card = values.get(person);
        return `<td>${card ? `<div class="sim-care-value"><strong>${card.value}</strong>${metricInfo(`${label} · ${name(person)}`, named(card.tooltip || card.description || label))}</div><p class="kpi-description">${escape(named(card.description || ''))}</p>` : '—'}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div></section>` : '';
    const html = comparison + Array.from(groups, ([title, cards]) =>
        `<section class="ds-card"><h3>${title}</h3><div class="sim-metric-list">${cards.map(card => renderMetricRow({ ...card,
            tooltip: named(card.tooltip || card.description || card.title), description: escape(named(card.description || '')) })).join('')}</div></section>`).join('');
    summaryBox.innerHTML = html;
    bindResultInfoPopups();
    container.style.display = 'block';
}

/**
 * Hilfsfunktion: mappt die semantische Tonalität auf CSS-Klassen.
 *
 * @param {('default'|'success'|'warning'|'danger')} tone - Kennzeichnet die Tonalität.
 * @returns {string} CSS-Klasse.
 */
function mapToneToClass(tone) {
    switch (tone) {
        case 'success':
            return 'is-green';
        case 'warning':
            return 'is-amber';
        case 'danger':
            return 'is-red';
        default:
            return '';
    }
}

/**
 * Übersetzt die Tonalität auf Summary-spezifische Klassen.
 *
 * @param {('default'|'success'|'warning'|'danger')} tone - Tonalität der Karte.
 * @returns {string} CSS-Klasse für Summary-Elemente.
 */
function mapToneToSummaryClass(tone) {
    if (tone === 'success') return ' is-success';
    if (tone === 'warning') return ' is-warning';
    if (tone === 'danger') return ' is-danger';
    return '';
}

// Re-Export für bestehende Stellen, die Währungs-KPIs mit Abkürzung benötigen.
export const formatCurrency = formatCurrencySafe;
