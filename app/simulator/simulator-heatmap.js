"use strict";

import { formatDisplayFixed, formatDisplayScalar } from '../shared/designsystem-number-format.js';
import { formatChartEuro } from './results-formatting.js';
import { formatCurrency } from './simulator-formatting.js';

import { heatmapColor, readChartTokens, heatmapLabelColor, CHART_LABEL } from '../shared/designsystem-chart-colors.js';
import {
    SWEEP_METRICS_VERSION,
    readSweepMetricValue
} from './sweep-metrics-contract.js';

const formatFixed = (value, digits = 1) => formatDisplayFixed(value, digits);
const formatPercent = (value, digits = 1) => `${formatFixed(value, digits)}\u00a0%`;
const formatPercentFromRatio = (value, digits = 1) => formatPercent(value * 100, digits);
const formatMonths = (value, digits = 1) => `${formatFixed(value, digits)}\u00a0Mo`;

const formatHeatmapCellLabel = (pct) => {
    if (pct <= 0) return '0';
    if (pct < 0.1) return '&lt;0,1';
    if (pct < 1) return formatFixed(pct, 1);
    return String(Math.round(pct));
};

/**
 * CSS-Styles für die Heatmap
 */
export const HEATMAP_V4_STYLE = `
<style id="heatmap-v4-style">
    .heatmap-v4-svg {
        background: var(--surface);
        fill: var(--text-main);
        font-family: var(--font-sans);
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        user-select: none;
    }
    .heatmap-v4-svg .axis-label { font-size: var(--balance-help); font-weight: 600; fill: var(--text-main); }
    .heatmap-v4-svg .tick-label, .heatmap-v4-svg .bin-label { fill: var(--text-main); }
    .heatmap-v4-svg .bin-label { text-anchor: end; dominant-baseline: middle; }
    .heatmap-v4-svg .year-label, .heatmap-v4-svg .col-header { text-anchor: middle; }
    .heatmap-v4-svg .col-header { font-weight: 600; }
    .heatmap-v4-svg .heatmap-cell { stroke: var(--surface); stroke-width: 1px; }
    .heatmap-v4-svg .cell-label-text {
        text-anchor: middle;
        dominant-baseline: middle;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        pointer-events: none;
    }
    .heatmap-v4-svg .cell-dot { pointer-events: none; }
    .heatmap-v4-svg .critical-line { stroke: var(--bad); stroke-width: 1.5; stroke-dasharray: 4, 3; }
    .heatmap-v4-svg .critical-overlay { fill: var(--bad); fill-opacity: 0.12; pointer-events: none; }
    .heatmap-v4-svg .legend-text { font-size: 13px; fill: var(--text-main); }
</style>
`;

/** Kompatibler Exportname; die freigegebene Palette ist jetzt Stein & Messing. */
export function viridis(t, tokens) {
    return heatmapColor(t, tokens);
}

/**
 * Berechnet Statistiken für die Heatmap
 */
const HEATMAP_INPUT_SCHEMA_VERSION = 'SimulatorHeatmapInputV1';

function normalizeHeatmapInput(input, totalRuns) {
    if (Array.isArray(input)) {
        return {
            schemaVersion: HEATMAP_INPUT_SCHEMA_VERSION,
            valueKind: 'counts',
            values: input,
            denominator: Math.max(1, Number(totalRuns) || 0)
        };
    }

    if (input?.schemaVersion !== HEATMAP_INPUT_SCHEMA_VERSION
        || !Array.isArray(input.values)
        || !['counts', 'shares'].includes(input.valueKind)) {
        return {
            schemaVersion: HEATMAP_INPUT_SCHEMA_VERSION,
            valueKind: 'counts',
            values: [],
            denominator: Math.max(1, Number(totalRuns) || 0)
        };
    }

    const hasExplicitDenominator = input.denominator !== null && input.denominator !== undefined;
    const explicitDenominator = Number(input.denominator);
    return {
        schemaVersion: HEATMAP_INPUT_SCHEMA_VERSION,
        valueKind: input.valueKind,
        values: input.values,
        denominator: input.valueKind === 'counts'
            ? Math.max(
                1,
                hasExplicitDenominator && Number.isFinite(explicitDenominator)
                    ? explicitDenominator
                    : Number(totalRuns) || 0
            )
            : null
    };
}

export function computeHeatmapStats(heatInput, bins, totalRuns) {
    const heatContract = normalizeHeatmapInput(heatInput, totalRuns);
    const heat = heatContract.values;
    if (heat.length === 0) {
        return {
            shares: [], globalP90: 0, perColP90: [], colSharesAbove45: [],
            shareYear1In_3_to_3_5: 0, shareYear1Above_5_5: 0, criticalRowIndex: bins ? bins.findIndex(b => b === 4.5) : -1,
            inputContract: heatContract
        };
    }

    const shares = heatContract.valueKind === 'shares'
        ? heat.map(col => Array.from(col).map(Number))
        : heat.map(col => Array.from(col).map(count => (Number(count) || 0) / heatContract.denominator));

    const quantileSimple = (arr, q) => {
        if (!arr || arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const pos = (sorted.length - 1) * q;
        const base = Math.floor(pos);
        const rest = pos - base;
        return sorted[base] + (rest * (sorted[base + 1] - sorted[base]) || 0);
    };

    const allSharesFlat = shares.flat().filter(s => s > 1e-6);

    // Fix-Bins fuer die bin-basierte Berichtsreferenz ab 4,5 Prozent.
    const binIdx30 = bins.findIndex(b => b === 3.0);
    const binIdx55 = bins.findIndex(b => b === 5.5);
    const binIdx45 = bins.findIndex(b => b === 4.5);

    const shareYear1In_3_to_3_5 = (binIdx30 !== -1 && shares.length > 0 && shares[0]) ? (shares[0][binIdx30] || 0) : 0;

    let shareYear1Above_5_5 = 0;
    if (binIdx55 !== -1 && shares.length > 0 && shares[0]) {
        for (let i = binIdx55; i < shares[0].length; i++) shareYear1Above_5_5 += shares[0][i];
    }

    const colSharesAbove45 = shares.map(col => {
        let sum = 0;
        if (binIdx45 !== -1) {
            for (let i = binIdx45; i < col.length; i++) sum += col[i];
        }
        return sum;
    });

    const perColP90 = shares.map(col => quantileSimple(col.filter(s => s > 1e-6), 0.9));

    return {
        shares,
        globalP90: quantileSimple(allSharesFlat, 0.90),
        perColP90,
        colSharesAbove45,
        shareYear1In_3_to_3_5,
        shareYear1Above_5_5,
        criticalRowIndex: binIdx45,
        inputContract: heatContract
    };
}

/**
 * Löst den Profilschlüssel auf
 */
/**
 * Löst den Profilschlüssel auf
 * @param {string} raw - Der rohe Profil-Name/Key
 * @param {object} [engine] - Optionale Engine-Instanz (für Headless use). Fallback auf window.Ruhestandsmodell_v30
 */
export function resolveProfileKey(raw, engine) {
    const effectiveEngine = engine || (typeof window !== 'undefined' ? window.Ruhestandsmodell_v30 : null);
    if (!effectiveEngine?.CONFIG?.PROFIL_MAP) return raw;

    const keys = Object.keys(effectiveEngine.CONFIG.PROFIL_MAP || {});
    const norm = s => String(s || "").toLowerCase().replace(/[\s\-_]/g, "");
    const nraw = norm(raw);
    let hit = keys.find(k => norm(k) === nraw);
    if (hit) return hit;
    hit = keys.find(k => nraw.includes(norm(k)) || norm(k).includes(nraw));
    return hit || keys[0];
}

/**
 * Rendert die Heatmap als SVG
 */
export function renderHeatmapSVG(heatInput, bins, totalRuns, extraKPI = {}, options = {}) {
    const heatContract = normalizeHeatmapInput(heatInput, totalRuns);
    const heat = heatContract.values;
    if (!heat || heat.length === 0) return '';

    const opts = Object.assign({
        width: 980, height: 420, normalize: 'global',
        labelThresholdPct: 0.1,
        dotThresholdPct: 0.01,
        palette: 'viridis', showCriticalOverlay: true,
        criticalThreshold: 4.5, showLegend: true, showFooterStats: true
    }, options);

    const stats = computeHeatmapStats(heatContract, bins, totalRuns);
    const { shares, globalP90, perColP90, colSharesAbove45, criticalRowIndex } = stats;

    const margin = { top: 38, right: 130, bottom: 60, left: 70 };
    const numYears = heat.length;
    const numBins = heat[0].length;
    const chartHeight = opts.height - margin.top - margin.bottom;
    const chartWidth = opts.width - margin.left - margin.right;
    const cellHeight = chartHeight / numBins;
    const cellWidth = chartWidth / numYears;

    const chartTokens = opts.chartTokens || readChartTokens();
    const paletteFn = t => viridis(t, chartTokens);

    let cellBackgrounds = '', cellOverlays = '', cellAnnotations = '';

    shares.forEach((yearData, yIdx) => {
        const colNormFactor = Math.max(1e-6, perColP90[yIdx] || 0);
        yearData.forEach((share, bIdx) => {
            const x = yIdx * cellWidth;
            const y = bIdx * cellHeight;
            const pct = share * 100;

            const normFactor = opts.normalize === 'global' ? globalP90 : colNormFactor;
            const t = Math.min(1, share / Math.max(1e-6, normFactor));
            const color = paletteFn(t);
            const critical = opts.showCriticalOverlay && criticalRowIndex !== -1 && bIdx >= criticalRowIndex;
            const textFill = heatmapLabelColor(t, chartTokens, critical);

            const tooltip = `Jahr ${yIdx + 1} | Realisierte Entnahmequote: ${formatFixed(bins[bIdx], 1)}\u00a0%-` +
                `${bins[bIdx + 1] < 100 ? formatFixed(bins[bIdx + 1], 1) : '∞'}\u00a0% | ` +
                `Anteil: ${formatFixed(pct, 2)}\u00a0% (${heat[yIdx][bIdx]} Läufe)`;

            cellBackgrounds += `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${color}" class="heatmap-cell"><title>${tooltip}</title></rect>`;

            if (critical) {
                cellOverlays += `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" class="critical-overlay" />`;
            }

            const showText = (pct > 0) && (cellWidth >= 24 && cellHeight >= 16);
            const labelText = formatHeatmapCellLabel(pct);

            if (showText) {
                cellAnnotations += `<text x="${x + cellWidth / 2}" y="${y + cellHeight / 2}" fill="${textFill}" class="cell-label-text chart-tick-text">${labelText}\u00a0%</text>`;
            } else if (pct >= opts.dotThresholdPct) {
                cellAnnotations += `<circle cx="${x + cellWidth / 2}" cy="${y + cellHeight / 2}" r="1.5" fill="${CHART_LABEL.dotFill}" class="cell-dot" />`;
            }
        });
    });

    const yAxisLabels = bins.slice(0, -1).map((bin, i) => `<text x="-8" y="${i * cellHeight + cellHeight / 2}" class="bin-label chart-tick-text">${formatPercent(bin, 1)}</text>`).join('');
    const xAxisLabels = [...Array(numYears).keys()].map(i => `<text x="${i * cellWidth + cellWidth / 2}" y="${chartHeight + 20}" class="year-label chart-tick-text">${i + 1}</text>`).join('');
    const colHeaders = colSharesAbove45.map((share, i) => `<text x="${i * cellWidth + cellWidth / 2}" y="-12" class="col-header chart-tick-text" fill="var(--bad)">${formatPercentFromRatio(share, 1)}</text>`).join('');

    let legend = '';
    if (opts.showLegend) {
        const legendHeight = chartHeight, legendWidth = 15;
        const stops = [0, 0.25, 0.5, 0.75, 1];
        const legendMaxVal = (opts.normalize === 'global' ? globalP90 : Math.max(...perColP90)) * 100;
        let gradientStops = stops.map(s => `<stop offset="${s * 100}%" stop-color="${paletteFn(s)}" />`).join('');
        let legendLabels = stops.map(s => `<text x="${legendWidth + 8}" y="${legendHeight * (1 - s)}" dominant-baseline="middle" class="legend-text chart-tick-text">${formatPercent(s * legendMaxVal, 1)}</text>`).join('');

        legend = `
            <g class="legend" transform="translate(${chartWidth + 25}, 0)">
                <defs><linearGradient id="heatmapGradV4" x1="0" y1="1" x2="0" y2="0">${gradientStops}</linearGradient></defs>
                <rect x="0" y="0" width="${legendWidth}" height="${legendHeight}" fill="url(#heatmapGradV4)"></rect>
                ${legendLabels}
            </g>`;
    }

    const criticalLine = (criticalRowIndex !== -1)
        ? `<line x1="0" y1="${criticalRowIndex * cellHeight}" x2="${chartWidth}" y2="${criticalRowIndex * cellHeight}" class="critical-line" />`
        : '';

    let footer = '';
    if (opts.showFooterStats) {
        const kpi1 = extraKPI.timeShareQuoteAbove45 !== undefined ? formatPercentFromRatio(extraKPI.timeShareQuoteAbove45, 1) : 'N/A';
        const kpi2 = formatPercentFromRatio(stats.shareYear1In_3_to_3_5, 1);
        const kpi3 = formatPercentFromRatio(stats.shareYear1Above_5_5, 1);
        footer = `<div class="heatmap-footer">
            <div class="heatmap-footer-pair"><span>Gesamt: realisierte Quote &gt; 4,5 %:</span><strong>${kpi1}</strong></div>
            <div class="heatmap-footer-pair"><span>Jahr 1 in 3,0–3,5 %:</span><strong>${kpi2}</strong></div>
            <div class="heatmap-footer-pair"><span>Jahr 1 &gt; 5,5 %:</span><strong>${kpi3}</strong></div>
        </div>`;
    }

    return `
    <div id="heatmap-container" style="text-align:center;">
        <h4 class="chart-title">Verteilung der realisierten Entnahmequote in den ersten 10 Jahren</h4>
        <p class="reporting-reference-note">Die Überlagerung zeigt den bin-basierten Anteil mit realisierter Entnahmequote ≥ 4,5 %. Die 4,5 % sind nur eine Berichtsreferenz und keine Alarm- oder Guardrail-Schwelle.</p>
        <p class="heatmap-subtitle ds-note">Anteil Läufe: realisierte Entnahmequote ≥ 4,5 % (bin-basiert)</p>
        <p class="ds-scroll-hint">Grafik bei Bedarf horizontal scrollen.</p>
        <div class="ds-chart-scroll" role="region" tabindex="0" aria-label="Heatmap horizontal scrollbar">
        <svg class="heatmap-v4-svg chart-native-svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}">
            <defs>${HEATMAP_V4_STYLE}</defs>
            <g transform="translate(${margin.left}, ${margin.top})">
                <text x="${chartWidth / 2}" y="${chartHeight + 48}" text-anchor="middle" class="axis-label chart-axis-title">Simulationsjahr</text>
                <text transform="translate(-50, ${chartHeight / 2}) rotate(-90)" text-anchor="middle" class="axis-label chart-axis-title">Realisierte Entnahmequote</text>

                ${cellBackgrounds}
                ${cellOverlays}
                ${yAxisLabels}
                ${xAxisLabels}
                ${colHeaders}
                ${criticalLine}
                ${cellAnnotations}
                ${legend}
            </g>
        </svg></div>
        ${footer}
    </div>`;
}

/**
 * Rendert die Parameter-Sweep-Heatmap als SVG
 */
export function renderSweepHeatmapSVG(sweepResults, metricKey, xParam, yParam, xValues, yValues, options = {}) {
    if (!sweepResults || sweepResults.length === 0) return '<p>Keine Sweep-Ergebnisse vorhanden.</p>';

    try {

        const opts = Object.assign({
            width: 980, height: 500, showLegend: true
        }, options);

        const paramLabels = {
            liquidityRunwayYears: 'Liquiditäts-Runway',
            goldRebalancingBand: 'Gold-Rebal Band',
            maxSkimPct: 'Max Skim %',
            maxBearRefillPct: 'Max Bear Refill %',
            goldTargetPct: 'Gold Target %',
            horizonYears: 'VPW Horizon',
            survivalQuantile: 'VPW Quantile',
            goGoMultiplier: 'VPW Go-Go Mult'
        };

        const metricLabels = {
            successProbFloor: 'Success Prob Floor (%)',
            p10EndWealth: 'P10 End Wealth (€)',
            p25EndWealth: 'P25 End Wealth (€)',
            medianEndWealth: 'Median End Wealth (€)',
            p75EndWealth: 'P75 End Wealth (€)',
            meanEndWealth: 'Mean End Wealth (€)',
            maxEndWealth: 'Max End Wealth (€)',
            worst5Drawdown: 'Worst 5% Drawdown (%)',
            minRunwayObserved: 'Min Runway Observed (Monate)'
        };

        const heatmapData = new Map();
        for (const result of sweepResults) {
            const key = `${result.params[xParam]}_${result.params[yParam]}`;
            const metricValue = readSweepMetricValue(result, metricKey);
            if (metricValue === null) continue;
            heatmapData.set(key, metricValue);
        }

        const allValues = Array.from(heatmapData.values());
        if (allValues.length === 0) {
            const hasLegacyShape = sweepResults.some(result => (
                result?.metrics && result.metrics.schemaVersion !== SWEEP_METRICS_VERSION
            ));
            return hasLegacyShape
                ? '<p>Die Sweep-Ergebnisse verwenden einen veralteten oder unversionierten Ergebnisvertrag. Bitte den Sweep neu ausführen.</p>'
                : '<p>Keine gültigen Sweep-Ergebnisse für die aktuelle Auswahl vorhanden.</p>';
        }
        const minVal = Math.min(...allValues);
        const maxVal = Math.max(...allValues);
        const range = maxVal - minVal;

        const chartTokens = opts.chartTokens || readChartTokens();
        const getColor = (value) => {
            if (range === 0) return viridis(0.5, chartTokens);
            const t = (value - minVal) / range;
            return viridis(t, chartTokens);
        };

        const formatValue = (value, metric) => {
            const wealthMetrics = ['p10EndWealth', 'p25EndWealth', 'medianEndWealth', 'p75EndWealth', 'meanEndWealth', 'maxEndWealth'];
            if (wealthMetrics.includes(metric)) {
                return formatChartEuro(value);
            } else if (metric === 'successProbFloor' || metric === 'worst5Drawdown') {
                return formatPercent(value, 1);
            } else {
                return formatFixed(value, 1);
            }
        };

        const legendTextWidth = Math.max(...[0, .25, .5, .75, 1].map(stop => formatValue(minVal + stop * range, metricKey).length)) * 8;
        const margin = { top: 60, right: Math.max(120, legendTextWidth + 55), bottom: 60, left: 80 };
        const chartWidth = opts.width - margin.left - margin.right;
        const chartHeight = opts.height - margin.top - margin.bottom;
        const cellWidth = chartWidth / xValues.length;
        const cellHeight = chartHeight / yValues.length;

        let cellsHtml = '';
        for (let yi = 0; yi < yValues.length; yi++) {
            for (let xi = 0; xi < xValues.length; xi++) {
                const xVal = xValues[xi];
                const yVal = yValues[yValues.length - 1 - yi];
                const key = `${xVal}_${yVal}`;
                const hasValue = heatmapData.has(key);
                const value = hasValue ? heatmapData.get(key) : minVal;

                const x = xi * cellWidth;
                const y = yi * cellHeight;
                const color = hasValue ? getColor(value) : 'var(--surface-sunken)';

                const result = sweepResults.find(r => r.params[xParam] === xVal && r.params[yParam] === yVal);
                const hasR2Warning = result && result.metrics && result.metrics.warningR2Varies;
                const isInvalidCombo = result && result.metrics && result.metrics.invalidCombination === true;
                const invalidReason = isInvalidCombo ? (result.metrics.invalidReason || 'ungültige Kombination') : '';
                const comparison = result?.metrics?.comparison;
                const drawdownQuantile = comparison?.drawdownQuantile;
                const successProbability = comparison?.successProbability;
                const successInterval = successProbability?.confidenceInterval95;
                const successValue = readSweepMetricValue(result, 'successProbFloor');
                const p10Value = readSweepMetricValue(result, 'p10EndWealth');
                const drawdownValue = readSweepMetricValue(result, 'worst5Drawdown');
                const runwayValue = readSweepMetricValue(result, 'minRunwayObserved');

                const tooltipLines = result ? [
                    `${paramLabels[xParam]}: ${formatDisplayScalar(xVal)}`,
                    `${paramLabels[yParam]}: ${formatDisplayScalar(yVal)}`,
                    '',
                    isInvalidCombo ? `Ungültig: ${invalidReason}` : `Läufe: ${comparison?.runCount ?? 0}`,
                    isInvalidCombo ? '' : `CRN: ${comparison?.commonRandomNumbers === true ? 'aktiv' : 'nicht belegt'}`,
                    isInvalidCombo || successValue === null ? '' : `Success Prob: ${formatPercent(successValue, 1)}`,
                    isInvalidCombo || !successInterval ? '' : `Wilson 95%-KI: ${formatPercent(successInterval.lowerPct, 1)} bis ${formatPercent(successInterval.upperPct, 1)}`,
                    isInvalidCombo || p10Value === null ? '' : `P10 End Wealth: ${formatCurrency(p10Value)}`,
                    !isInvalidCombo && hasValue && metricKey.endsWith('EndWealth') ? `${metricKey}: ${formatCurrency(value)}` : '',
                    isInvalidCombo || drawdownValue === null ? '' : `Worst 5% DD: ${formatPercent(drawdownValue, 1)}`,
                    isInvalidCombo || runwayValue === null ? '' : `Min Runway: ${formatMonths(runwayValue, 1)}`,
                    isInvalidCombo || !drawdownQuantile?.quantileInTerminalRuinBlock
                        ? ''
                        : `Drawdown-P95 gesättigt: ${formatPercent(drawdownQuantile.terminalRuinSharePct, 1)} terminale Ruine`,
                    isInvalidCombo ? '' : 'Quantilranking: experimenteller Punktschätzer',
                    hasR2Warning ? '\n⚠ Rente 2 variierte im Sweep' : ''
                ].filter(Boolean) : [`${paramLabels[xParam]}: ${formatDisplayScalar(xVal)}`, `${paramLabels[yParam]}: ${formatDisplayScalar(yVal)}`, 'Keine Daten'];

                const tooltip = tooltipLines.join('&#10;');

                // Füge gelben Rand hinzu bei R2-Warnung
                const strokeColor = isInvalidCombo ? 'var(--bad)' : (hasR2Warning ? 'var(--warn)' : 'var(--surface)');
                const strokeWidth = isInvalidCombo ? '3' : (hasR2Warning ? '3' : '1');
                cellsHtml += `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}"><title>${tooltip}</title></rect>`;

                if (cellWidth >= 40 && cellHeight >= 30) {
                    const t = range === 0 ? .5 : (value - minVal) / range;
                    const textColor = heatmapLabelColor(t, chartTokens, false, !hasValue);
                    const yOffset = (hasR2Warning || isInvalidCombo) ? -5 : 0;
                    cellsHtml += `<text x="${x + cellWidth / 2}" y="${y + cellHeight / 2 + yOffset}" text-anchor="middle" dominant-baseline="middle" fill="${textColor}" class="sweep-cell-text chart-tick-text" font-weight="600" pointer-events="none">${isInvalidCombo ? 'N/A' : !hasValue ? '—' : formatValue(value, metricKey)}</text>`;

                    // Warn-Symbol bei R2-Varianz oder invaliden Kombis
                    if (hasR2Warning || isInvalidCombo) {
                        const warnTitle = isInvalidCombo ? 'Ungültige Parameterkombination' : 'Rente 2 variierte im Sweep';
                        const warnGlyph = isInvalidCombo ? '⛔' : '⚠';
                        cellsHtml += `<text x="${x + cellWidth / 2}" y="${y + cellHeight / 2 + 10}" text-anchor="middle" dominant-baseline="middle" fill="${textColor}" class="sweep-cell-text chart-tick-text" pointer-events="none" title="${warnTitle}">${warnGlyph}</text>`;
                    }
                }
            }
        }

        const xAxisLabels = xValues.map((v, i) => `<text x="${i * cellWidth + cellWidth / 2}" y="${chartHeight + 20}" text-anchor="middle" class="tick-label chart-tick-text">${formatDisplayScalar(v)}</text>`).join('');
        const yAxisLabels = yValues.map((v, i) => `<text x="-8" y="${(yValues.length - 1 - i) * cellHeight + cellHeight / 2}" text-anchor="end" dominant-baseline="middle" class="tick-label chart-tick-text">${formatDisplayScalar(v)}</text>`).join('');

        let legend = '';
        if (opts.showLegend) {
            const legendHeight = chartHeight;
            const legendWidth = 15;
            const stops = [0, 0.25, 0.5, 0.75, 1];
            const gradientStops = stops.map(s => `<stop offset="${s * 100}%" stop-color="${viridis(s, chartTokens)}" />`).join('');

            const legendLabels = stops.map(s => {
                const val = minVal + s * range;
                return `<text x="${legendWidth + 8}" y="${legendHeight * (1 - s)}" dominant-baseline="middle" class="legend-text chart-tick-text">${formatValue(val, metricKey)}</text>`;
            }).join('');

            legend = `
            <g class="legend" transform="translate(${chartWidth + 30}, 0)">
                <defs><linearGradient id="sweepGradient" x1="0" y1="1" x2="0" y2="0">${gradientStops}</linearGradient></defs>
                <rect x="0" y="0" width="${legendWidth}" height="${legendHeight}" fill="url(#sweepGradient)"></rect>
                ${legendLabels}
            </g>`;
        }

        const comparison = sweepResults.find(result => readSweepMetricValue(result, metricKey) !== null)
            ?.metrics?.comparison;
        const validMetricResults = sweepResults.filter(result => (
            readSweepMetricValue(result, metricKey) !== null
        ));
        const saturatedDrawdownCount = metricKey === 'worst5Drawdown'
            ? validMetricResults.filter(result => (
                result.metrics?.comparison?.drawdownQuantile?.quantileInTerminalRuinBlock === true
            )).length
            : 0;
        const saturationNotice = saturatedDrawdownCount > 0
            ? `<p class="sweep-saturation-notice ds-note ds-note-warning" style="color:var(--bad); font-size: var(--balance-help);"><strong>Drawdown-P95 ist durch terminale Ruine gesättigt:</strong> ${saturatedDrawdownCount} von ${validMetricResults.length} Kombinationen liegen bei 100 %.${range === 0 ? ' Die Metrik unterscheidet die dargestellten Kombinationen nicht.' : ''}</p>`
            : '';
        const runCountText = comparison?.runCount === 1
            ? '1 Lauf'
            : `${comparison?.runCount ?? 0} Läufe`;
        const comparisonNotice = comparison
            ? `${runCountText} je Kombination · Common Random Numbers: ${comparison.commonRandomNumbers === true ? 'aktiv' : 'nicht belegt'} · Erfolgsquote mit Wilson-95%-KI. Quantilrankings sind experimentelle Punktschätzer ohne Quantil-Konfidenzintervall. Der Sweep-Drawdown enthält terminale Ruine und ist nicht direkt mit der unversionierten Monte-Carlo-Drawdownkennzahl vergleichbar.`
            : 'Vergleichsdiagnostik nicht verfügbar.';

        return `
        ${HEATMAP_V4_STYLE}
        <div style="text-align:center;">
            <h4 class="chart-title">Parameter Sweep: ${metricLabels[metricKey] || metricKey}</h4>
            ${saturationNotice}
            <p class="sweep-comparison-notice ds-note ds-note-warning" style="color:var(--warn); font-size: var(--balance-help);">${comparisonNotice}</p>
            <p class="ds-scroll-hint">Grafik bei Bedarf horizontal scrollen.</p>
        <div class="ds-chart-scroll" role="region" tabindex="0" aria-label="Heatmap horizontal scrollbar">
        <svg class="heatmap-v4-svg chart-native-svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}">
                <g transform="translate(${margin.left}, ${margin.top})">
                    <text x="${chartWidth / 2}" y="-35" text-anchor="middle" class="axis-label chart-axis-title">${paramLabels[xParam] || xParam}</text>
                    <text transform="translate(-60, ${chartHeight / 2}) rotate(-90)" text-anchor="middle" class="axis-label chart-axis-title">${paramLabels[yParam] || yParam}</text>
                    ${cellsHtml}
                    ${xAxisLabels}
                    ${yAxisLabels}
                    ${legend}
                </g>
            </svg></div>
        </div>`;

    } catch (error) {
        console.error('Fehler beim Rendern der Sweep-Heatmap:', error);
        throw error;
    }
}
