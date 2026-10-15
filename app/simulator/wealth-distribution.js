import { quantile } from './simulator-utils.js';
import { formatWholeEuro as formatCurrency } from './results-formatting.js';
import { escapeProtocolHtml as escape } from './protocol-renderer.js';
import { WEALTH_SCENARIO_COLORS } from './scenario-wealth-chart.js';
import { formatChartEuro } from './results-formatting.js';

const percentilePoints = [['min', 'Minimum', 0], ['p5', 'P5', .05], ['p10', 'P10', .1], ['p25', 'P25', .25],
    ['p50', 'Median', .5], ['p75', 'P75', .75], ['p90', 'P90', .9], ['p95', 'P95', .95], ['max', 'Maximum', 1]];

/** Alle beobachteten Endwerte; Outcome-Ruin ist eine eigene Klasse, kein Nulltest. */
export function buildWealthDistribution(results, _logs, mode = 'real') {
    const nominal = results?.finalOutcomes?.distribution;
    const values = mode === 'nominal' ? nominal?.values : results?.wealthView?.realValues;
    const excludedRuns = nominal?.excludedRuns || 0;
    const available = Array.isArray(values) && values.length === nominal?.sampleSize
        && values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    if (!available || !values.length) return { available: false, mode, excludedRuns, reason: available ? 'Keine beobachteten Endwerte.' : mode === 'real' ? 'Reale Endbeobachtungen fehlen. Bitte Monte-Carlo neu rechnen oder Nominal wählen.' : 'Endwertverteilung fehlt. Bitte Monte-Carlo neu rechnen.' };
    const ruinCount = results.outcomeInventory?.ruin ?? results.outcomeCounts?.ruin;
    if (!Number.isSafeInteger(ruinCount) || ruinCount < 0 || ruinCount > values.length
        || values.filter(value => value === 0).length < ruinCount) {
        return { available: false, mode, excludedRuns, reason: 'Outcome und Endwertpopulation passen nicht zusammen.' };
    }
    // Ruinwerte sind nach dem bestehenden Endwertvertrag exakt null. Die übrigen
    // Nullwerte bleiben als erfolgreiche Finanzendwerte im ersten regulären Bin.
    let remainingRuin = ruinCount;
    const financial = values.filter(value => {
        if (value === 0 && remainingRuin > 0) { remainingRuin--; return false; }
        return true;
    });
    // Nur die Achse nutzt positive Endwerte; Population und Satzquantile bleiben vollständig.
    const limit = Math.max(1000, quantile(financial.filter(value => value > 0), .975));
    const bins = Array.from({ length: 36 }, (_, index) => ({ index, lower: limit * (index / 36), upper: limit * ((index + 1) / 36), count: 0 }));
    let overflowCount = 0;
    for (const value of financial) {
        if (value > limit) overflowCount++;
        else bins[Math.min(35, Math.floor((value / limit) * 36))].count++;
    }
    for (const bin of bins) bin.sharePct = bin.count / values.length * 100;
    // Sämtliche Perzentile beziehen sich auf dieselbe Endwertgröße und Population.
    // Nominal ausgewählte Einzelpfade gehören ausschließlich zur Szenarioansicht.
    const marks = percentilePoints.map(([key, label, percentile], index) => ({
        key, label, value: quantile(values, percentile), color: WEALTH_SCENARIO_COLORS[index]
    }));
    const ladder = marks.map((mark, index) => ({ ...mark, gap: index > 0 && mark.value !== null && marks[index - 1].value !== null ? mark.value - marks[index - 1].value : null }));
    return { available: true, mode, excludedRuns, values, sampleSize: values.length, ruinCount,
        ruinSharePct: ruinCount / values.length * 100, successfulZeroCount: financial.filter(value => value === 0).length,
        limit, bins, overflowCount, overflowSharePct: overflowCount / values.length * 100,
        p10: marks[2].value, p25: marks[3].value, p50: marks[4].value,
        p75: marks[5].value, marks, ladder };
}

export function renderWealthDistribution(model, { showAllMarks = false, detailsOpen = false } = {}) {
    if (!model.available) return `<p class="ds-note" role="status">${escape(model.reason)} Technische Fehler ausgeschlossen: ${model.excludedRuns}.</p>`;
    const x = value => 150 + Math.min(1, value / model.limit) * 1120;
    const maxCount = Math.max(1, model.ruinCount, model.overflowCount, ...model.bins.map(bin => bin.count));
    const height = count => count / maxCount * 185;
    const textValue = value => value === null ? 'Messung fehlt' : formatCurrency(value);
    const summaryValue = value => `<b title="${escape(textValue(value))}">${escape(formatChartEuro(value))}</b>`;
    const bars = model.bins.map(bin => {
        const middle = (bin.lower / 2 + bin.upper / 2);
        const central = middle >= model.p25 && middle <= model.p75;
        return `<rect x="${150 + bin.index * (1120 / 36)}" y="${290 - height(bin.count)}" width="28" height="${height(bin.count)}" class="wealth-bin${central ? ' wealth-bin-middle' : ''}"><title>${escape(`${formatCurrency(bin.lower)} bis ${formatCurrency(bin.upper)}: ${bin.count} Läufe · ${bin.sharePct.toFixed(2)} %`)}</title></rect>`;
    }).join('');
    const markers = model.marks.filter(mark => mark.value !== null).map(mark => {
        const index = model.marks.indexOf(mark);
        const position = x(mark.value);
        const central = ['p25', 'p50', 'p75'].includes(mark.key);
        return `<g data-wealth-mark="${mark.key}"${central ? '' : ' class="wealth-marker-extra"'}><title>${escape(`${mark.label}: ${textValue(mark.value)}`)}</title><line x1="${position}" x2="${position}" y1="${32 + index % 3 * 20}" y2="290" stroke="${mark.color}" stroke-width="${mark.key === 'p50' ? 2.5 : 1.5}"${mark.key === 'p50' ? '' : ' stroke-dasharray="5 4"'}/><text x="${position}" y="${26 + index % 3 * 20}" text-anchor="${mark.value > model.limit ? 'end' : 'middle'}" fill="${mark.color}">${escape(mark.value > model.limit ? `${mark.label} ${formatChartEuro(mark.value)} →` : mark.label)}</text></g>`;
    }).join('');
    const ladder = model.ladder.map(mark => `<div class="wealth-rung ${['p25', 'p50', 'p75'].includes(mark.key) ? ' wealth-rung-middle' : ''}"><strong>${mark.label}</strong><span>${escape(textValue(mark.value))}</span><small>${mark.gap === null ? '—' : `${mark.gap >= 0 ? '+' : ''}${escape(formatCurrency(mark.gap))} Abstand`}</small></div>`).join('');
    const ticks = Array.from({ length: 6 }, (_, index) => `<text x="${150 + index / 5 * 1120}" y="314" text-anchor="middle"><title>${escape(textValue(model.limit * (index / 5)))}</title>${escape(formatChartEuro(model.limit * (index / 5)))}</text>`).join('');
    const overflowBar = model.overflowCount > 0 ? `<rect x="1320" y="${290 - height(model.overflowCount)}" width="30" height="${height(model.overflowCount)}" class="wealth-bin"/><text x="1335" y="314" text-anchor="middle">Rest →</text>` : '';
    const overflowNote = model.overflowCount > 0 ? `Oberhalb <span title="${escape(textValue(model.limit))}">${escape(formatChartEuro(model.limit))}</span>: ${model.overflowCount} Läufe (${model.overflowSharePct.toFixed(1).replace('.', ',')} %). ` : '';
    const p10Sentence = model.p10 === 0 ? 'Das 10-%-Perzentil des Endvermögens liegt bei 0 €.' : `Mit 90 % Wahrscheinlichkeit bleiben mindestens <b>${escape(textValue(model.p10))}</b>.`;
    return `<div class="wealth-distribution-view"><p class="wealth-population">${model.sampleSize.toLocaleString('de-DE')} beobachtete Läufe · ${model.mode === 'nominal' ? 'nominale Euro' : 'heutige Euro'} · ${model.excludedRuns} technische Fehler ausgeschlossen</p>
        <p class="wealth-sentence">Median ${summaryValue(model.p50)}. Die mittlere Hälfte der Läufe endet zwischen ${summaryValue(model.p25)} und ${summaryValue(model.p75)} (P25–P75).</p>
        <label class="wealth-marker-toggle"><input type="checkbox" id="wealthShowAllMarks"${showAllMarks ? ' checked' : ''}>Weitere Marken zeigen (Minimum, P5, P10, P90, P95, Maximum)</label>
        <div class="ds-chart-scroll" role="region" tabindex="0" aria-label="Endvermögenshistogramm, horizontal scrollbar"><svg class="wealth-distribution-svg chart-native-svg" width="1400" height="355" viewBox="0 0 1400 355" role="img" aria-labelledby="wealthDistributionTitle wealthDistributionDescription"><title id="wealthDistributionTitle">Histogramm des Endvermögens</title><desc id="wealthDistributionDescription">${model.sampleSize} Läufe; Ruin ${model.ruinCount}; erfolgreicher Nullendwert ${model.successfulZeroCount}; oberer Rest ${model.overflowCount}. Marken zeigen Perzentile derselben Endwertverteilung.</desc>
        <rect x="${x(model.p25)}" y="90" width="${Math.max(0, x(model.p75) - x(model.p25))}" height="200" class="wealth-middle-band"/>
        <line x1="90" x2="1360" y1="290" y2="290" class="wealth-grid"/>
        <rect x="94" y="${290 - height(model.ruinCount)}" width="32" height="${height(model.ruinCount)}" class="wealth-ruin"><title>${model.ruinCount} Ruinläufe · ${model.ruinSharePct.toFixed(2)} %</title></rect><text x="110" y="${282 - height(model.ruinCount)}" text-anchor="middle">${model.ruinSharePct > 0 && model.ruinSharePct < .1 ? '&lt; 0,1' : model.ruinSharePct.toFixed(1).replace('.', ',')} %</text><text x="110" y="332" text-anchor="middle">Ruin</text>${bars}${markers}${ticks}
        ${overflowBar}</svg></div>
        <p class="ds-note">${overflowNote}Erfolgreiche Nullendwerte: ${model.successfulZeroCount}.</p>
        <details class="ds-disclosure wealth-statistics-details"${detailsOpen ? ' open' : ''}><summary>Verteilungskennzahlen · ${model.mode === 'real' ? 'heutige Euro' : 'nominal'} · genaue Werte</summary><p>${p10Sentence}</p><div class="wealth-ladder">${ladder}</div></details>
        <p class="ds-note wealth-reading">Perzentile über alle auswertbaren Läufe, einschließlich Ruin. Ausgewählte Szenarien mit Jahresprotokoll findest du unter „Szenario-Logs“.</p></div>`;
}
