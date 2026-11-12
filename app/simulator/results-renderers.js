/** @import * as AnalysisTypes from '../../typcheck/simulator-analysis.js' */
"use strict";

import { formatCurrencySafe, formatMetricStatus, formatChartEuro } from './results-formatting.js';
import { renderHeatmapSVG, renderSizedSimulatorChart } from './simulator-heatmap.js';
import { escapeBacktestHtml as escape } from './historical-backtest-ui.js';
import { installInfoPlacement } from '../shared/designsystem-info-popover.js';

let nextInfoId = 1;

/**
 * @param id - Kennung.
 * @param title - Kontext für title.
 * @param text - Kontext für text.
 * @returns {string}
 */
export const info = (id, title, text) => `<span class="ds-info"><button class="ds-info-button" type="button" aria-label="${escape(title)}" aria-expanded="false" aria-controls="${escape(id)}">i</button><span class="ds-info-pop" id="${escape(id)}" role="tooltip">${Array.isArray(text) ? text.filter(Boolean).map(paragraph => `<p>${escape(paragraph)}</p>`).join('') : escape(text)}</span></span>`;

const renderMetricPair = metrics => `<div class="sim-answer-pair">${metrics.map(metric => `<div><p class="sim-answer-metric-label">${escape(metric.label)}</p><p class="sim-answer-metric-value">${escape(metric.value)}</p>${metric.detail ? `<p class="ds-hint">${escape(metric.detail)}</p>` : ''}</div>`).join('')}</div>`;

/** Zwei verständliche Einstiegsantworten vor den unveränderten Kennzahlen.
 *
 * @param container - Kontext für container.
 * @param answers - Kontext für answers.
 * @param {boolean} [stale] - Kontext für stale.
 * @returns {void}
 */
export function renderMonteCarloAnswers(container, answers, stale = false) {
    if (!container || !Array.isArray(answers)) return;
    container.innerHTML = answers.map((answer, index) => `<section class="sim-mc-answer ${answer.kind === 'coverage' ? 'sim-coverage-answer ' : ''}ds-card" data-stale="${stale}">
        ${answer.kind === 'coverage' ? renderCoverageBody(container.id || 'monteCarloAnswers', answer, index) : `${answer.tooltip ? `<div class="sim-card-heading"><h2>${escape(answer.question)}</h2>${info(`${container.id || 'monteCarloAnswers'}Info${index + 1}`, `Erläuterung zu „${answer.question}“`, answer.value === '—' ? `${answer.text} ${answer.tooltip}` : answer.tooltip)}</div>` : `<h2>${escape(answer.question)}</h2>`}
        ${answer.subtitle ? `<p class="ds-hint sim-answer-subtitle">${escape(answer.subtitle)}</p>` : ''}
        ${answer.metrics ? renderMetricPair(answer.metrics) : `<p class="sim-hero-amount">${escape(answer.value)}</p>`}
        ${answer.countText ? `<p class="sim-answer-count">${escape(answer.countText)}</p>` : ''}
        <p>${escape(answer.text)}</p>${answer.desiredFlex ? `<div class="sim-flex-wish ds-hint"><span>${escape(answer.desiredFlex.label)} ${info(`${container.id || 'monteCarloAnswers'}WishInfo${index + 1}`, answer.desiredFlex.label, answer.desiredFlex.tooltip)}: <strong>${escape(answer.desiredFlex.value)}</strong></span><span title="Wunsch-Flex pro Jahr zum Laufstart, in heutiger Kaufkraft">Plan: ${escape(answer.desiredFlex.plan)}</span></div>` : ''}
        ${answer.note ? `<p class="ds-hint${answer.compactNote ? ' sim-flex-note' : ''}"${answer.compactNote ? ` title="${escape(answer.note)}"` : ''}>${escape(answer.desiredFlex?.note || answer.note)}</p>` : ''}`}
        ${stale ? '<p class="ds-hint sim-answer-status" role="status">Annahmen seitdem geändert</p>' : ''}</section>`).join('');
    bindResultInfoPopups(container.ownerDocument || globalThis.document);
}
// SE-1: Deckung als schmaler Balken statt Punktraster; Endvermögen P10 · Median · P90 nebeneinander.
function renderCoverageBody(hostId, answer, index) {
    const end = answer.endWealth;
    const available = answer.value !== '—';
    const width = Number.isFinite(answer.coveragePct) ? Math.min(answer.uncoveredHint ? 99 : 100, Math.max(0, answer.coveragePct)) : 0;
    const line = [answer.interval, answer.note, answer.uncoveredHint].filter(Boolean).join(' · ');
    return `<div class="sim-card-heading"><h2>${escape(answer.question)}</h2>${info(`${hostId}Info${index + 1}`, 'Erläuterung: Grundbedarf gedeckt', available ? answer.tooltip : `${answer.text} ${answer.tooltip}`)}</div>
        ${available ? `<p class="sim-answer-metric-label">${escape(answer.label)}</p>
        <div class="sim-coverage-figure"><p class="sim-hero-amount">${escape(answer.value)}</p>${answer.countText ? `<p class="sim-answer-count">${escape(answer.countText)}</p>` : ''}</div>
        <div class="sim-coverage-bar" role="img" aria-label="${escape(`${answer.value} der Läufe gedeckt`)}"><span style="width:${width}%"></span></div>`
        : `<p class="sim-hero-amount">${escape(answer.value)}</p><p>${escape(answer.text)}</p>${answer.technicalRuns ? `<p>Finanziell nicht auswertbar · technische Läufe: ${escape(answer.technicalRuns)}</p>` : ''}`}
        ${line ? `<p class="ds-help">${escape(line)}</p>` : ''}
        ${end ? `<div class="sim-end-wealth"><div class="sim-card-heading"><p class="sim-answer-metric-label">${escape(end.label)}</p>${end.partsTooltip ? info(`${hostId}Parts${index + 1}`, 'Aufteilung der Perzentile', end.partsTooltip) : ''}</div>
            <div class="sim-end-wealth-values">${end.values.map(item => `<div><p class="ds-help">${escape(item.label)}</p><p class="sim-answer-metric-value">${escape(item.value)}</p></div>`).join('')}</div>
            ${end.parts ? `<p class="ds-help">${escape(end.parts)}</p>` : ''}<p class="ds-help sim-price-basis">${escape(end.basis)}</p></div>` : ''}`;
}

const popupHosts = new WeakSet();
const popupDocuments = new WeakSet();
function metricInfo(title, text) {
    const id = `mcMetricInfo${nextInfoId++}`;
    return `<span class="ds-info"><button type="button" class="ds-info-button ds-button" aria-label="${escape(title)}" aria-expanded="false" aria-controls="${id}">i</button><span id="${id}" class="ds-info-pop" role="tooltip">${escape(text)}</span></span>`;
}

const metricValueTitle = kpi => kpi.displayValue !== undefined ? ` title="${escape(kpi.value)}"` : '';
const metricTooltip = kpi => `${kpi.tooltip || kpi.description || kpi.title}${kpi.displayValue !== undefined && kpi.value !== '—' ? ` Genauer Wert: ${kpi.value}` : ''}`;

/** Neue Renderknoten binden; vollständige kanonische Erklärungen bleiben erhalten.
 *
 * @param {Document} [documentRef] - Dokument der Simulatorseite.
 * @returns {void}
 */
export function bindResultInfoPopups(documentRef = globalThis.document) {
    if (!documentRef?.querySelectorAll) return;
    installInfoPlacement(documentRef);
    const hosts = () => /** @type {NodeListOf<HTMLElement & {closeInfo?: () => void}>} */ (documentRef.querySelectorAll('#tab-montecarlo .ds-info'));
    for (const host of hosts()) {
        if (popupHosts.has(host)) continue;
        const button = /** @type {HTMLButtonElement} */ (host.querySelector('.ds-info-button'));
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
        host.addEventListener('focusout', event => { if (!host.contains(/** @type {Node} */ (event.relatedTarget))) host.closeInfo(); });
        button.addEventListener('click', () => { pinned = !pinned; show(pinned); });
        host.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); button.focus(); host.closeInfo(); }
        });
    }
    if (popupDocuments.has(documentRef)) return;
    popupDocuments.add(documentRef);
    documentRef.addEventListener?.('click', event => {
        for (const host of hosts()) if (!host.contains(/** @type {Node} */ (event.target))) host.closeInfo?.();
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
      ${kpi.moneyDetail ? `<small class="sim-money-detail">${escape(kpi.moneyDetail)}</small>` : ''}
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
        ${kpi.moneyDetail ? `<small class="sim-money-detail">${escape(kpi.moneyDetail)}</small>` : ''}
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

 *
 * @returns {void}
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
            ${card.moneyDetail ? `<small class="sim-money-detail">${escape(card.moneyDetail)}</small>` : ''}
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
            <section class="mc-final-card ds-card"><div class="mc-final-heading"><h3>Gesamtvermögen und Steuern</h3><span>${escape(wealthCards[0]?.priceBasis || 'nominale Euro')}</span></div>
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
 * @param {AnalysisTypes.KpiDashboard} dashboard - Struktur aus dem Logikmodul.

 *
 * @param [riskContainer] - Kontext für riskContainer.
 * @returns {void}
 */
export function renderKpiDashboard(container, dashboard, riskContainer = null, riskOptions = {}) {
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
    if (riskContainer) renderRiskDetails(riskContainer, dashboard, riskOptions);
    html += `<details class="mc-more-metrics ds-disclosure"><summary>Weitere Kennzahlen <small>operativ · Risiko · Tail-Risk</small></summary>${referenceLine}${detailHtml}</details></section>`;
    container.innerHTML = html;
    bindResultInfoPopups();
    container.style.display = 'block';
}

const plainText = value => String(value ?? '—').replace(/<[^>]*>/g, '');
const kpiSentence = kpis => kpis.slice(0, 3).map(kpi => `${kpi.title} ${plainText(kpi.value)}`).join(' · ');
const riskRow = (key, title, summary, body, open) => `<details class="household-plan-more sim-risk-row" data-risk-row="${key}"${open ? ' open' : ''}>`
    + `<summary class="household-plan-summary-toggle"><span><strong>${escape(title)}</strong><span class="household-plan-summary">${escape(summary)}</span></span>`
    + `<span class="household-plan-disclosure-action"><span>▸ zeigen</span><span>▾ ausblenden</span></span></summary><div class="sim-risk-row-body">${body}</div></details>`;

/** SE-2: „Weitere Kennzahlen“ der Risikoansicht als Aufklappzeilen; Inhalt jeder Zeile sind die bisherigen Kennzahlkarten.
 *
 * @param {HTMLElement} container - Host `#riskKpiDashboard`.
 * @param {AnalysisTypes.KpiDashboard} dashboard - Struktur aus dem Logikmodul.
 * @param {{stressMetrics?: {presetLabel: string; years: number} | null}} [options] - Stress-Ergebnis des Laufs.
 * @returns {void}
 */
export function renderRiskDetails(container, dashboard, { stressMetrics = null } = {}) {
    if (!container || !dashboard) return;
    const previous = new Map([.../** @type {NodeListOf<HTMLDetailsElement>} */ (container.querySelectorAll?.('[data-risk-row]') || [])]
        .map(row => [row.dataset.riskRow, row.open]));
    const wasOpen = (key, fallback = false) => previous.has(key) ? previous.get(key) : fallback;
    // H-SE2-STRESS: Wechselt der Lauf zwischen ohne und mit Stress, gilt die Vorgabe eines ersten Laufs.
    const stressState = stressMetrics ? 'aktiv' : 'aus', stressChanged = container.dataset?.riskStress !== stressState;
    const section = title => dashboard.detailSections.find(item => item.title === title);
    const cards = item => `<div class="kpi-grid">${item.kpis.map(renderKpiCard).join('')}</div>`;
    const operative = section('Operative Details'), risk = section('Risiko-Details'), tail = section('Tail-Risk-Overlay');
    const reference = dashboard.reportingReferenceNotice
        ? `<p class="reporting-reference-note ds-note"><span>Entnahmequote: Berichtsreferenz</span>${metricInfo('Entnahmequote: Berichtsreferenz', dashboard.reportingReferenceNotice)}<span class="kpi-description">${dashboard.reportingReferenceNotice}</span></p>` : '';
    const known = new Set(['Operative Details', 'Risiko-Details', 'Tail-Risk-Overlay']);
    const rows = [
        operative ? riskRow('operativ', operative.title, kpiSentence(operative.kpis), cards(operative), wasOpen('operativ')) : '',
        risk ? riskRow('risiko', risk.title, kpiSentence(risk.kpis), cards(risk) + reference, wasOpen('risiko'))
            : reference ? riskRow('risiko', 'Risiko-Details', 'Entnahmequote: Berichtsreferenz', reference, wasOpen('risiko')) : '',
        tail ? riskRow('tail', tail.title, kpiSentence(tail.kpis), cards(tail), wasOpen('tail'))
            : riskRow('tail', 'Tail-Risk-Overlay', 'Aus · keine zusätzlichen Krisenjahre eingespielt', '<p class="ds-help">Das Tail-Risk-Overlay ist für diesen Lauf ausgeschaltet. Einschalten in den Monte-Carlo-Einstellungen.</p>', wasOpen('tail')),
        ...dashboard.detailSections.filter(item => !known.has(item.title)).map((item, index) => riskRow(`extra${index}`, item.title, kpiSentence(item.kpis), cards(item), wasOpen(`extra${index}`))),
        riskRow('stress', 'Stress-Szenario', stressMetrics ? `${stressMetrics.presetLabel} · betrifft die ersten ${stressMetrics.years} Jahre` : 'Kein Stress-Szenario gewählt · in den Monte-Carlo-Einstellungen',
            stressMetrics ? '<div class="sim-risk-stress-anchor" hidden></div>' : '<p class="ds-help">Für diesen Lauf ist kein Stress-Szenario gewählt.</p>', stressChanged ? Boolean(stressMetrics) : wasOpen('stress', Boolean(stressMetrics)))
    ].join('');
    if (container.dataset) container.dataset.riskStress = stressState;
    container.innerHTML = `<div class="sim-card-heading"><h2>Weitere Kennzahlen</h2><button type="button" class="ds-text-link" data-risk-all aria-expanded="false">▸ Alle Details zeigen</button></div><div class="sim-risk-rows">${rows}</div>`;
    container.style.display = 'block';
    const all = /** @type {HTMLButtonElement | null} */ (container.querySelector?.('[data-risk-all]'));
    const details = () => /** @type {HTMLDetailsElement[]} */ ([...(container.querySelectorAll?.('[data-risk-row]') || [])]);
    const sync = () => {
        if (!all) return;
        const open = details().length > 0 && details().every(row => row.open);
        all.textContent = open ? '▾ Alle Details ausblenden' : '▸ Alle Details zeigen';
        all.setAttribute('aria-expanded', String(open));
    };
    all?.addEventListener('click', () => {
        const open = !details().every(row => row.open);
        for (const row of details()) row.open = open;
        sync();
    });
    for (const row of details()) row.addEventListener?.('toggle', sync);
    sync();
    bindResultInfoPopups();
}

/** SE-2: Kennzahlleiste der Risikoansicht aus vorhandener Verteilung und Drawdown-Kennzahlen; keine neue Rechnung.
 *
 * @param {HTMLElement | null} host - Host `#riskKeyFigures`.
 * @param distribution - Ergebnis von buildWealthDistribution.
 * @param {AnalysisTypes.KpiDashboard} dashboard - Struktur aus dem Logikmodul.
 * @returns {void}
 */
export function renderRiskKeyFigures(host, distribution, dashboard) {
    if (!host) return;
    const euro = value => Number.isFinite(value) ? formatChartEuro(value) : '—';
    const exact = value => Number.isFinite(value) ? formatCurrencySafe(value) : '';
    const available = distribution?.available === true;
    const drawdownReal = dashboard?.drawdownKpis?.find(kpi => kpi.title === 'Max. Drawdown real (Median)');
    const drawdownNominal = dashboard?.drawdownKpis?.find(kpi => kpi.title === 'Max. Drawdown nominal (Median)');
    const share = dashboard?.detailSections?.flatMap(item => item.kpis).find(kpi => kpi.title.startsWith('Zeitanteil realisierte Entnahmequote'));
    const basis = distribution?.mode === 'nominal' ? 'nominale Euro' : 'heutige Euro';
    const figure = (label, value, help, title = '') => `<div class="sim-risk-figure"><span class="sim-risk-figure-label">${escape(label)}</span><strong class="sim-risk-figure-value"${title ? ` title="${escape(title)}"` : ''}>${escape(value)}</strong><span class="ds-help">${escape(help)}</span></div>`;
    host.innerHTML = figure('Gesamtvermögen am Laufende · Median', available ? euro(distribution.p50) : '—',
        available ? `mittlere Hälfte ${euro(distribution.p25)}–${euro(distribution.p75)} · ${basis}` : plainText(distribution?.reason || 'Endwertverteilung fehlt'), available ? exact(distribution.p50) : '')
        + figure('Schwache Läufe · P10', available ? euro(distribution.p10) : '—', '9 von 10 Läufen enden darüber', available ? exact(distribution.p10) : '')
        + figure('Größter Vermögensrückgang · Median', plainText(drawdownReal?.value), `real · nominal ${plainText(drawdownNominal?.value)}`)
        + figure('Zeit mit Entnahmequote über 4,5 %', plainText(share?.value), 'aller Entnahmejahre · Berichtsreferenz');
    host.hidden = false;
}

/**
 * Rendert die Stress-KPI-Sektion direkt unterhalb eines Bezugscontainers.
 *
 * @param {HTMLElement} referenceContainer - Container, unter dem die Stress-KPI-Sektion eingefügt wird.
 * @param {Object|null} stressMetrics - Von buildStressMetrics erzeugte Struktur.

 *
 * @returns {void}
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
 * @param {{tall?: boolean}} [options] - Höhere Darstellung in der Risikoansicht.
 * @returns {void}
 */
export function renderHeatmap(container, heatmapData, { tall = false } = {}) {
    if (!container || !heatmapData) return;

    // SE-2: In der Risikoansicht steht die Heatmap neben „Weitere Kennzahlen“ und bekommt mehr Höhe je Breite.
    renderSizedSimulatorChart(container, options => renderHeatmapSVG(
        heatmapData.heatmap, heatmapData.bins, heatmapData.totalRuns, heatmapData.extraKPI,
        tall && options.containerWidth > 0 ? { ...options, height: Math.max(460, Math.round(Math.max(820, options.containerWidth) * 0.62)) } : options
    ));
}

/**
 * Rendert die Pflege-KPIs oder blendet den Abschnitt aus, wenn keine vorliegen.
 *
 * @param {HTMLElement} summaryBox - Container für die KPI-Karten.
 * @param {HTMLElement} container - Gesamter Pflegebereich, der ein-/ausgeblendet wird.
 * @param {Object|null} careMetrics - Struktur aus buildCareMetrics.

 *
 * @param [personDisplayContext] - Kontext für personDisplayContext.
 * @returns {void}
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
