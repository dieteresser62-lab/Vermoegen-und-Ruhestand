"use strict";

import { formatCurrencySafe, formatMetricStatus } from './results-formatting.js';
import { renderHeatmapSVG } from './simulator-heatmap.js';
import { escapeBacktestHtml as escape } from './historical-backtest-ui.js';

let nextInfoId = 1;

/** Zwei verständliche Einstiegsantworten vor den unveränderten Kennzahlen. */
export function renderMonteCarloAnswers(container, answers, stale = false) {
    if (!container || !Array.isArray(answers)) return;
    container.innerHTML = answers.map(answer => `<section class="sim-mc-answer ds-card" data-stale="${stale}">
        <h2>${escape(answer.question)}</h2><p class="sim-hero-amount">${escape(answer.value)}</p>
        <p>${escape(answer.text)}</p><p class="ds-hint">${escape(answer.note)}</p>
        ${stale ? '<p class="ds-hint sim-answer-status" role="status">Annahmen seitdem geändert</p>' : ''}</section>`).join('');
}
const popupHosts = new WeakSet();
const popupDocuments = new WeakSet();
function metricInfo(title, text) {
    const id = `mcMetricInfo${nextInfoId++}`;
    return `<span class="ds-info"><button type="button" class="ds-info-button ds-button" aria-label="${escape(title)}" aria-expanded="false" aria-controls="${id}">i</button><span id="${id}" class="ds-info-pop" role="tooltip">${escape(text)}</span></span>`;
}

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
    const description = kpi.description || '';
    const tooltip = kpi.tooltip || description || kpi.title;
    const statusLine = kpi.statusLine
        ? `<div class="kpi-status-line">${escape(formatMetricStatus(kpi.statusLine))}</div>`
        : '';
    const secondaryLine = kpi.secondaryLabel
        ? `<div class="kpi-secondary-value"><span>${kpi.secondaryLabel}</span><strong>${kpi.secondaryValue || '—'}</strong>${kpi.secondaryStatusLine ? `<small>${escape(formatMetricStatus(kpi.secondaryStatusLine))}</small>` : ''}</div>`
        : '';
    return `
    <div class="kpi-card ds-card ds-metric ${toneClass}${layoutClass}">
      <div class="sim-metric-heading"><strong>${kpi.title}</strong>${metricInfo(kpi.title, tooltip)}</div>
      <div class="value-line">${kpi.value}</div>
      ${statusLine}
      ${secondaryLine}
      <div class="kpi-description">${description}</div>
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
        const tooltip = card.tooltip || card.description || card.title;
        const layoutClass = card.layout === 'exact-risk' ? ' summary-exact-value' : '';
        return `<div class="summary-item ds-card ds-metric${mapToneToSummaryClass(card.tone)}${layoutClass}">
            <div class="sim-metric-heading"><strong>${card.title}</strong>${metricInfo(card.title, tooltip)}</div>
            <span>${card.value}</span>${card.statusLine ? `<small class="summary-status-line">${escape(formatMetricStatus(card.statusLine))}</small>` : ''}
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
        container.innerHTML = `<div class="mc-overview-grid">
            <section class="mc-floor-card ds-card ds-metric${mapToneToSummaryClass(floor.tone)}">
                <div class="sim-metric-heading"><strong>${floor.title}</strong>${metricInfo(floor.title, floor.description)}</div>
                <div class="mc-floor-value">${floor.displayValue}</div><div class="mc-floor-interval">${floor.intervalText}</div>
                <div class="mc-outcome-bar" aria-hidden="true">${bars}</div>
                <div class="mc-outcome-legend" aria-label="Endzustände">${legend}${metricInfo(outcomes.title, outcomes.description)}</div>
                <p class="summary-description">${floor.description}</p><p class="summary-description">${outcomes.description}</p>
            </section>
            <section class="mc-final-card ds-card"><div class="mc-final-heading"><h3>Endvermögen</h3><span>nominal, über alle auswertbaren Läufe</span></div>
                <div class="summary-grid">${summaryCards.filter(card => card !== floor && card !== outcomes).map(renderSummaryCard).join('')}</div>
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

    let html = '<section class="ds-card mc-primary-card"><h3 class="unified-kpi-header">Wichtigste Kennzahlen</h3><div class="kpi-grid kpi-grid-primary">';
    html += dashboard.primary.map(renderKpiCard).join('');
    html += '</div></section><section class="ds-card mc-drawdown-card">';

    if (Array.isArray(dashboard.drawdownKpis) && dashboard.drawdownKpis.length > 0) {
        html += '<h4 class="drawdown-pair-heading">Maximum-Drawdown: nominal und real</h4>';
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
export function renderCareSection(summaryBox, container, careMetrics) {
    if (!summaryBox || !container) return;

    if (!careMetrics) {
        container.style.display = 'none';
        return;
    }

    const groups = new Map();
    for (const card of careMetrics.cards) {
        const title = /\bP1\b/.test(card.title) ? 'Person 1' : /\bP2\b/.test(card.title) ? 'Person 2'
            : /bucket|Bucket|Pflegereserve|Reservenutzung|Restreserve|Zieldeckung|Ziellücke/.test(card.title) ? 'Pflegereserve' : 'Haushalt';
        if (!groups.has(title)) groups.set(title, []);
        groups.get(title).push(card);
    }
    const html = Array.from(groups, ([title, cards]) =>
        `<section class="ds-card"><h3>${title}</h3><div class="kpi-grid">${cards.map(renderKpiCard).join('')}</div></section>`).join('');
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
