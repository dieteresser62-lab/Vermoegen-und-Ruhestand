import { buildWealthFanModel } from './wealth-fan-aggregation.js';
import { escapeProtocolHtml as escape } from './protocol-renderer.js';
import { formatCurrency } from './simulator-utils.js';

export function renderWealthFanBands(model, { x, y, background = false }) {
    if (!model.available) return '';
    const path = (low, high) => {
        // Fehlende/überlaufbetroffene Quantile erzeugen eine Lücke, keine Ersatzwerte.
        const segments = []; let segment = [];
        for (const row of model.years) {
            if (row.quantiles[low].value === null || row.quantiles[high].value === null) {
                if (segment.length) segments.push(segment); segment = [];
            } else segment.push(row);
        }
        if (segment.length) segments.push(segment);
        return segments.map(rows => `M${rows.map(row => `${x(row.year)},${y(row.quantiles[high].value)}`).join(' L')} L${[...rows].reverse().map(row => `${x(row.year)},${y(row.quantiles[low].value)}`).join(' L')} Z`).join(' ');
    };
    let connected = false;
    const median = model.years.map(row => {
        const value = row.quantiles[50].value;
        if (value === null) { connected = false; return ''; }
        const command = connected ? 'L' : 'M'; connected = true;
        return `${command}${x(row.year)},${y(value)}`;
    }).join(' ');
    return `<g class="wealth-fan-bands" data-fan-background="${background}" aria-hidden="true"><path class="wealth-fan-outer" d="${path(5, 95)}"/><path class="wealth-fan-inner" d="${path(25, 75)}"/>${background ? '' : `<path class="wealth-fan-median" d="${median}"/>`}</g>`;
}

export function renderWealthFanChart(fan, options = {}) {
    const model = buildWealthFanModel(fan, options.mode || 'real');
    if (!model.available) return '<p class="ds-note">Für diesen Lauf liegen keine Jahresbänder vor. Die Endvermögensverteilung nutzt die vorhandenen Endbeobachtungen.</p>';
    const maxValue = Math.max(1, ...model.years.flatMap(row => Object.values(row.quantiles).map(q => q.value || 0)));
    const x = year => 90 + year / model.horizonYears * 1160;
    const y = value => 360 - value / maxValue * 330;
    const startValue = Number.isFinite(options.initialWealth) ? options.initialWealth : model.years[0].quantiles[50].value || 0;
    const ticks = Array.from({ length: 5 }, (_, i) => {
        const value = maxValue * i / 4;
        return `<line x1="90" x2="1250" y1="${y(value)}" y2="${y(value)}" class="wealth-grid"/><text x="80" y="${y(value) + 4}" text-anchor="end">${escape(formatCurrency(value))}</text>`;
    }).join('');
    const years = Array.from({ length: 6 }, (_, i) => {
        const year = Math.round(model.horizonYears * i / 5);
        const label = Number.isInteger(options.startYear) ? `${options.startYear + year}${Number.isFinite(options.startAge) ? ` · ${options.startAge + year}` : ''}` : `Jahr ${year}`;
        return `<text x="${x(year)}" y="382" text-anchor="middle">${escape(label)}</text>`;
    }).join('');
    const last = model.years.at(-1);
    const marks = [95, 75, 50, 25, 5].filter(p => last.quantiles[p].value !== null)
        .map(p => ({ p, position: y(last.quantiles[p].value) }));
    for (let i = 1; i < marks.length; i++) marks[i].position = Math.max(marks[i].position, marks[i - 1].position + 18);
    if (marks.length) {
        marks.at(-1).position = Math.min(360, marks.at(-1).position);
        for (let i = marks.length - 2; i >= 0; i--) marks[i].position = Math.min(marks[i].position, marks[i + 1].position - 18);
    }
    const endLabels = marks.map(({ p, position }) =>
        `<line class="wealth-fan-end-guide" x1="${x(last.year)}" x2="${x(last.year) + 6}" y1="${y(last.quantiles[p].value)}" y2="${position}"/><text class="wealth-fan-end-label" x="${x(last.year) + 8}" y="${position}">${p === 50 ? 'Median' : `P${p}`} · ${escape(formatCurrency(last.quantiles[p].value))}</text>`).join('');
    const barWidth = 1160 / (model.horizonYears + 1);
    const bars = model.years.map(row => `<g><title>Jahr ${row.year}: ${row.alive} lebende Haushalte, davon ${row.ruined} ruiniert; ${row.missing} fehlende ${model.mode === 'nominal' ? 'nominale' : 'reale'} Messungen</title><rect class="wealth-fan-alive" x="${x(row.year) - barWidth / 2}" y="${440 - row.alivePct * 0.48}" width="${barWidth}" height="${row.alivePct * 0.48}"/><rect class="wealth-fan-ruined" x="${x(row.year) - barWidth / 2}" y="${440 - row.ruined / model.validRuns * 48}" width="${barWidth}" height="${row.ruined / model.validRuns * 48}"/></g>`).join('');
    const missing = model.years.reduce((sum, row) => sum + row.missing, 0);
    const bounded = model.years.some(row => Object.values(row.quantiles).some(q => ['overflow', 'underflow'].includes(q.status)));
    return `<p class="wealth-population">Vermögensfächer aller im jeweiligen Jahr noch lebenden fachlich gültigen Haushalte · ${model.mode === 'nominal' ? 'nominale Euro' : 'heutige Euro'} · ${model.validRuns.toLocaleString('de-DE')} gültige Läufe</p><div class="scenario-chart-scroll ds-chart-scroll" role="region" tabindex="0" aria-label="Vermögensfächer, horizontal scrollbar"><svg class="wealth-fan-svg chart-native-svg" width="1400" height="490" viewBox="0 0 1400 490" role="img" aria-labelledby="wealthFanTitle wealthFanDescription"><title id="wealthFanTitle">Wie sich das Vermögen über die Jahre entwickelt</title><desc id="wealthFanDescription">P5 bis P95, mittlere Hälfte P25 bis P75 und Median. Jahresendwerte einschließlich lebender ruinierter Haushalte mit Nullvermögen. Start ist eine getrennte Anfangsbeobachtung. Keine Finanzwerte nach Haushaltstod. Der Fächer endet strikt unter fünf Prozent lebenden Haushalten.</desc>${ticks}${renderWealthFanBands(model, { x, y })}<line class="wealth-fan-start" x1="90" x2="1250" y1="${y(startValue)}" y2="${y(startValue)}"/><text x="96" y="${y(startValue) - 8}">Start · ${escape(formatCurrency(startValue))}</text>${endLabels}${years}<text x="90" y="466">Lebende Haushalte · Ruin rot · Anteil am gültigen Ausgangsbestand</text>${bars}</svg></div><div class="wealth-fan-legend"><span><i class="wealth-fan-outer"></i>90 % der Läufe (P5–P95)</span><span><i class="wealth-fan-inner"></i>mittlere Hälfte (P25–P75)</span><span><i class="wealth-fan-median"></i>Median</span></div><p class="ds-note">Feste Klassen: 1 % Breite von 1 Euro bis etwa 1 Billion Euro. Quantile sind Klassenschätzungen mit interpolierten Ranggrenzen. Die Bänder enden unter 5 % lebenden Haushalten; genau 5 % bleiben sichtbar. ${missing ? `${missing} fehlende Jahresmessungen werden aus dem jeweiligen Quantilnenner ausgeschlossen. ` : ''}${model.technicalErrors ? `${model.technicalErrors} technisch fehlgeschlagene Läufe sind ausgeschlossen. ` : ''}${bounded ? 'Unter-/Überlauf: betroffene Quantile sind nicht schätzbar; keine behauptete 1-%-Genauigkeit. ' : ''}Die Lebens-/Ruinleiste ist getrennt von fehlenden Finanzmessungen.</p>`;
}
