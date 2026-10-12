import { createHash } from 'node:crypto';
import { heatmapColor, readChartTokens, parseChartColor, CHART_LABEL, heatmapLabelColor, visibleHeatmapColor } from '../app/shared/designsystem-chart-colors.js';
import * as heatmap from '../app/simulator/simulator-heatmap.js';
import * as visualization from '../app/simulator/simulator-visualization.js';
import { renderThreeBucketPortfolioChart } from '../app/simulator/simulator-portfolio-chart.js';
import { aggregateSweepMetrics } from '../app/simulator/simulator-results.js';
import { readSources, variables, resolveValue, contrast, validateTools, validateFoundation } from './designsystem-source-contract.mjs';

const sources = readSources();
const vars = variables(sources['css/tokens.css']);
const tokens = Object.fromEntries(Object.keys(vars).map(name => [name, resolveValue(vars[name], vars)]));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Projektion bewahrt sämtliche SVG-Koordinaten, Skalen, Titel und normalisierte Zahlentexte. Nur
// Farb-/Typografieattribute, additive Klassen, opake Labelplatten und Scrollkapseln entfallen.
export function chartProjection(html) {
    // Einzig das entfernte dekorative Symbol der Sensitivitätsüberschrift normalisieren;
    // sämtliche Geometrie-/Zahlen-Digests bleiben unverändert.
    html = html.replace(/(<h4\b[^>]*>)\s*Parameter Sensitivity Analysis/, '$1📊 Parameter Sensitivity Analysis');
    // Die erlaubten Anzeigeergänzungen und U+00A0 vor Prozent entfallen; Zahlen werden nur in
    // Textknoten normalisiert, niemals in SVG-Attributen oder Pfadkoordinaten.
    html = html.replace(/<p class="ds-scroll-hint">[\s\S]*?<\/p>/g, '');
    const divs = [];
    html = html.replace(/<div\b[^>]*>|<\/div>/g, tag => {
        if (tag === '</div>') return divs.pop() ? '' : tag;
        const scroll = /class="ds-chart-scroll"/.test(tag);
        divs.push(scroll); return scroll ? '' : tag;
    });
    return html.replace(/>([^<>]*)</g, (_, text) => '>' + text.replace(/(\d),(\d)/g, '$1.$2').replace(/\u00a0(?=%)/g, '').replaceAll('&lt;', '<') + '<')
        .replace(/<style\b[\s\S]*?<\/style>/g, '')
        .replace(/<rect\b[^>]*class="sweep-label-bg"[^>]*\/>/g, '')
        .replace(/\s(?:style|class|fill|stroke|stop-color|stroke-width|opacity|paint-order|font-weight|font-size)="[^"]*"/g, '')
        .replace(/\s+/g, ' ').trim();
}
// Am Basisstand vor der Layoutänderung erfasst; Positionen sind separat geprüft.
function heatmapDataProjection(html) {
    return {
        titles: [...html.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]),
        colors: [...html.matchAll(/(?:stop-color|fill)="([^"]*)"/g)].map(m => m[1]).filter(s => s.startsWith('color-mix') || /var\(--heatmap-|var\(--surface-sunken\)/.test(s)),
        numbers: [...html.matchAll(/<(?:text|tspan|strong)\b[^>]*>([^<>]*)<\/(?:text|tspan|strong)>/g)].map(m => m[1]).filter(s => /^\d|^(?:N\/A|—|⚠|⛔)$/.test(s)).sort()
    };
}
const heatmapBaseline = [{"titles":["Jahr 1 | Realisierte Entnahmequote: 0,0 %-3,0 % | Anteil: 33,33 % (1 Läufe)","Jahr 1 | Realisierte Entnahmequote: 3,0 %-4,5 % | Anteil: 33,33 % (1 Läufe)","Jahr 1 | Realisierte Entnahmequote: 4,5 %-10,0 % | Anteil: 0,00 % (0 Läufe)","Jahr 2 | Realisierte Entnahmequote: 0,0 %-3,0 % | Anteil: 0,00 % (0 Läufe)","Jahr 2 | Realisierte Entnahmequote: 3,0 %-4,5 % | Anteil: 33,33 % (1 Läufe)","Jahr 2 | Realisierte Entnahmequote: 4,5 %-10,0 % | Anteil: 66,67 % (2 Läufe)"],"colors":["color-mix(in srgb, var(--heatmap-mid) 82.35294117647058%, var(--heatmap-high))","color-mix(in srgb, var(--heatmap-mid) 82.35294117647058%, var(--heatmap-high))","var(--heatmap-low)","var(--heatmap-low)","color-mix(in srgb, var(--heatmap-mid) 82.35294117647058%, var(--heatmap-high))","var(--heatmap-high)","var(--heatmap-low)","color-mix(in srgb, var(--heatmap-low) 50%, var(--heatmap-mid))","var(--heatmap-mid)","color-mix(in srgb, var(--heatmap-mid) 50%, var(--heatmap-high))","var(--heatmap-high)"],"numbers":["0,0 %","0,0 %","0,0 %","0,0 %","1","12,3 %","14,2 %","2","28,3 %","3,0 %","33,3 %","33 %","33 %","33 %","4,5 %","42,5 %","56,7 %","66,7 %","67 %"]},{"titles":["Jahr 1 | Realisierte Entnahmequote: 0,0 %-3,0 % | Anteil: 0,00 % (0 Läufe)","Jahr 1 | Realisierte Entnahmequote: 3,0 %-4,5 % | Anteil: 25,00 % (0.25 Läufe)","Jahr 1 | Realisierte Entnahmequote: 4,5 %-10,0 % | Anteil: 75,00 % (0.75 Läufe)"],"colors":["var(--heatmap-low)","color-mix(in srgb, var(--heatmap-low) 28.57142857142857%, var(--heatmap-mid))","var(--heatmap-high)","var(--heatmap-low)","color-mix(in srgb, var(--heatmap-low) 50%, var(--heatmap-mid))","var(--heatmap-mid)","color-mix(in srgb, var(--heatmap-mid) 50%, var(--heatmap-high))","var(--heatmap-high)"],"numbers":["0,0 %","0,0 %","0,0 %","1","17,5 %","25,0 %","25 %","3,0 %","35,0 %","4,5 %","52,5 %","70,0 %","75,0 %","75 %","N/A"]},{"titles":["Liquiditäts-Runway: 3&#10;Gold-Rebal Band: 20&#10;Ungültig: Synthetische Ablehnung","Liquiditäts-Runway: 5&#10;Gold-Rebal Band: 20&#10;Keine Daten","Liquiditäts-Runway: 3&#10;Gold-Rebal Band: 10&#10;Läufe: 1&#10;CRN: nicht belegt&#10;Success Prob: 100,0 %&#10;Wilson 95%-KI: 20,7 % bis 100,0 %&#10;P10 End Wealth: 1k €&#10;Worst 5% DD: 20,0 %&#10;Min Runway: 24,0 Mo&#10;Quantilranking: experimenteller Punktschätzer"],"colors":["var(--surface-sunken)","var(--surface-sunken)","var(--heatmap-low)","var(--heatmap-high)","var(--heatmap-low)","color-mix(in srgb, var(--heatmap-low) 50%, var(--heatmap-mid))","var(--heatmap-mid)","color-mix(in srgb, var(--heatmap-mid) 50%, var(--heatmap-high))","var(--heatmap-high)"],"numbers":["10","1k €","1k €","1k €","20","2k €","2k €","2k €","2k €","3","5","N/A","—","⚠","⛔"]},{"titles":["Liquiditäts-Runway: 3&#10;Gold-Rebal Band: 10&#10;Läufe: 1&#10;CRN: nicht belegt&#10;Success Prob: 100,0 %&#10;Wilson 95%-KI: 20,7 % bis 100,0 %&#10;P10 End Wealth: 1k €&#10;Worst 5% DD: 20,0 %&#10;Min Runway: 24,0 Mo&#10;Quantilranking: experimenteller Punktschätzer"],"colors":["var(--heatmap-mid)","var(--heatmap-low)","color-mix(in srgb, var(--heatmap-low) 50%, var(--heatmap-mid))","var(--heatmap-mid)","color-mix(in srgb, var(--heatmap-mid) 50%, var(--heatmap-high))","var(--heatmap-high)"],"numbers":["10","100,0 %","100,0 %","100,0 %","100,0 %","100,0 %","100,0 %","3"]}];
export const sweepFixture = [
    [3, 10, 1000, false, false], [5, 10, 2000, true, false], [3, 20, 3000, false, true]
].map(([x, y, wealth, warningR2Varies, invalidCombination]) => ({
    params: { liquidityRunwayYears: x, goldRebalancingBand: y },
    metrics: { ...aggregateSweepMetrics([{ finalVermoegen: wealth, failed: false, maxDrawdown: 20, minRunway: 24 }]), warningR2Varies, invalidCombination, invalidReason: invalidCombination ? 'Synthetische Ablehnung' : null }
}));
export function chartFragments(h = heatmap, v = visualization) {
    const matrix = [[1, 1, 0], [0, 1, 2]];
    const bins = [0, 3, 4.5, 10];
    return [
        h.renderHeatmapSVG(matrix, bins, 3, { timeShareQuoteAbove45: .123 }),
        h.renderHeatmapSVG({ schemaVersion: 'SimulatorHeatmapInputV1', valueKind: 'shares', values: [[0, .25, .75]] }, bins, 4, {}, { normalize: 'column', showCriticalOverlay: false }),
        h.renderSweepHeatmapSVG(sweepFixture, 'medianEndWealth', 'liquidityRunwayYears', 'goldRebalancingBand', [3, 5], [10, 20]),
        h.renderSweepHeatmapSVG(sweepFixture.slice(0, 1), 'successProbFloor', 'liquidityRunwayYears', 'goldRebalancingBand', [3], [10]),
        v.renderSensitivityChart(v.calculateSensitivity(sweepFixture, 'medianEndWealth'), 'medianEndWealth'),
        v.renderParetoFrontier(v.calculateParetoFrontier(sweepFixture, 'medianEndWealth', 'worst5Drawdown', true, false), sweepFixture, 'medianEndWealth', 'worst5Drawdown')
    ];
}

// Prüfungen
const oldWindow = globalThis.window, oldDocument = globalThis.document;
globalThis.window = { sweepParamRanges: { liquidityRunwayYears: [3, 5], goldRebalancingBand: [10, 20] } };
try {
    const fragments = chartFragments();
    assertEqual(chartProjection('<svg><text x="1.25">75,0\u00a0%</text></svg>'), '<svg><text x="1.25">75.0%</text></svg>', 'Nur Dezimalzeichen und geschützter Prozentabstand entfallen in Textknoten');
    assertEqual(chartProjection('<svg data-value="75,0\u00a0%"><text>75,0 %; 75,0\u00a0€</text></svg>'), '<svg data-value="75,0 %"><text>75.0 %; 75.0 €</text></svg>', 'Prozentattribute, normale Prozentabstände und andere Einheiten bleiben in der Projektion geschützt');
    for (const [index, label] of [[0, '12,3\u00a0%'], [1, '75,0\u00a0%'], [2, '20,0\u00a0%'], [3, '100,0\u00a0%'], [4, '100\u00a0%']]) {
        assert(fragments[index].includes(label), `Echtes Diagramm ${index} enthält den exakten geschützten Prozenttext ${label}`);
    }
    const { validateScrollableMarkup } = await import('./designsystem-source-contract.mjs');
    for (const html of fragments) assertEqual(validateScrollableMarkup(html).join('\n'), '', 'Alle echten Grafikfragmente liegen in bedienbaren Scrollkapseln');
    // Aus Basis cdef93e7 mit derselben Projektion ermittelt; einzige zusätzliche
    // Displaykorrektur: fehlende Sweepzelle zeigt — statt des Palettenminimums.
    const baseline = ["1cf6af78affb5950e4ed7c5b9712b637a0e6796c8fb20e107329898877be6bb6","992f14c4c9d414e13992666d4975a5e954917d8710cfe77f600fd5e2a28fb88d","676f1ff33e85900e81435ff16d7f223130f071f1b1cb52e318c38df8d314069b","1ed66bdeb4c8293bec4c0853eb4267f80f53de247c144707aec2be4c9c3fceac","6fbaa39388e67256408feb465d8cdcb043acb92be14a0b8703c8eb057440c4c5","6353333392fe40b39d961eebd220c670549d9e423f85bba572069a76013c0033"];
    assertEqual(JSON.stringify(fragments.slice(4).map(html => digest(chartProjection(html)))), JSON.stringify(baseline.slice(4)), 'Pareto und Sensitivität erhalten ihre vollständigen bisherigen Geometrie-/Inhaltsprojektionen');
    assertEqual(JSON.stringify(fragments.slice(0, 4).map(heatmapDataProjection)), JSON.stringify(heatmapBaseline), 'Heatmaps erhalten Tooltip-Laufzahlen, Zahleninhalte und Zell-/Legendenfarben des vor Umsetzung erfassten Standes');
    assertEqual(JSON.stringify(validateTools(sources, fragments)), '[]', 'Alle Werkzeug-/SVG-Quellen und erzeugten Labels verwenden geprüfte Rollen');
    assertEqual(JSON.stringify(validateFoundation(sources)), '[]', 'Werkzeugconsumer sind in Alias- und Grundkontrastprüfung enthalten');
    assertEqual(heatmapColor(0, tokens), 'rgb(244, 245, 241)', 'Heller Palettenanfang aus Tokenquelle');
    assertEqual(heatmapColor(.5, tokens), 'rgb(184, 149, 79)', 'Messingstütze aus Tokenquelle');
    assertEqual(heatmapColor(1, tokens), 'rgb(29, 40, 48)', 'Schieferende aus Tokenquelle');
    assertEqual(heatmapColor(.25, tokens), 'rgb(214, 197, 160)', 'sRGB-Zwischenwert im ersten Segment');
    assertEqual(heatmapColor(.75, tokens), 'rgb(107, 95, 64)', 'sRGB-Zwischenwert im zweiten Segment');
    for (const t of [-1, 0, null, undefined, NaN]) assertEqual(heatmapColor(t, tokens), heatmapColor(0, tokens), 'Null-/fehlende Palettenwerte landen am hellen Ende');
    assertEqual(heatmapColor(2, tokens), heatmapColor(1, tokens), 'Palette bleibt am oberen Ende begrenzt');
    const injected = { '--heatmap-low': '#ffffff', '--heatmap-mid': '#000000', '--heatmap-high': '#ffffff' };
    assertEqual(heatmapColor(.25, injected), 'rgb(128, 128, 128)', 'Injizierte Tokenmap steuert tatsächlich die Interpolation');
    const doc = { documentElement: {}, defaultView: { getComputedStyle: () => ({ getPropertyValue: name => tokens[name] }) } };
    assertEqual(heatmapColor(.25, readChartTokens(doc)), heatmapColor(.25, tokens), 'Dokumentauflösung und injizierte Map sind identisch');
    assertEqual(heatmapColor(.25, {}), 'color-mix(in srgb, var(--heatmap-low) 50%, var(--heatmap-mid))', 'DOM-freie Ausgabe pflegt keine zweite Farbquelle');
    assert(fragments[4].includes('width: 400px'), 'Sensitivitätsbalken behält dieselbe normalisierte Breite');
    const grid = fragments[2];
    assert(grid.includes('stroke="var(--warn)" stroke-width="3"') && grid.includes('stroke="var(--bad)" stroke-width="3"'), 'Warnrand und Invalidrand behalten ihre Bedingungen und Breite');
    assert(grid.includes('fill="var(--surface-sunken)"'), 'Fehlende Sweep-Zelle bekommt die neutrale Unterlage');
    for (const fragment of fragments.slice(0, 4)) assert(!/label-bg|paint-order|<text[^>]*stroke=/.test(fragment), 'Zelltexte ohne Labelplatte und ohne Textstroke');
    const roleColor = fill => parseChartColor(tokens[fill.slice(4, -1)]);
    const toHex = color => '#' + color.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const measuredContrast = (fill, background) => contrast(toHex(roleColor(fill)), toHex(background));
    const expectedBackground = (t, critical) => {
        const raw = parseChartColor(heatmapColor(t, tokens)), bad = parseChartColor(tokens['--bad']);
        return critical ? raw.map((v, index) => v * .88 + bad[index] * .12) : raw;
    };
    assertEqual(vars['--balance-h3'], '18px', 'Diagrammtitel verwendet unveränderte 18-Pixel-Rolle');
    let backgroundsCorrect = true;
    let minimum = Infinity, fallbackMinimum = Infinity, wrongFailures = 0, overlayFailures = 0;
    for (let i = 0; i <= 1000; i++) {
        const t = i / 1000;
        const sweepPoints = [0, t * 1000, 1000].map((value, index) => ({ params: { liquidityRunwayYears: index, goldRebalancingBand: 0 }, metrics: { ...sweepFixture[0].metrics, medianEndWealth: value } }));
        const sweepMarkup = heatmap.renderSweepHeatmapSVG(sweepPoints, 'medianEndWealth', 'liquidityRunwayYears', 'goldRebalancingBand', [0, 1, 2], [0], { chartTokens: tokens });
        const sweepFill = [...sweepMarkup.matchAll(/<text[^>]*fill="([^"]*)" class="sweep-cell-text/g)][1][1];
        minimum = Math.min(minimum, measuredContrast(sweepFill, expectedBackground(t, false)));
        for (const critical of [false, true]) {
            const bg = expectedBackground(t, critical);
            backgroundsCorrect &&= JSON.stringify(visibleHeatmapColor(t, tokens, critical)) === JSON.stringify(bg);
            minimum = Math.min(minimum, measuredContrast(heatmapLabelColor(t, tokens, critical), bg));
            fallbackMinimum = Math.min(fallbackMinimum, measuredContrast(heatmapLabelColor(t, {}, critical), bg));
            if (measuredContrast('var(--chart-label-light)', bg) < 4.5) wrongFailures++;
            if (critical && measuredContrast(heatmapLabelColor(t, tokens, false), bg) < 4.5) overlayFailures++;
            if (i > 0) {
                // Neun volle Zellen halten P90 bei 1; die erste Zelle erreicht exakt t.
                const values = [[critical ? 0 : t, critical ? t : 0], ...Array.from({ length: 9 }, () => [1, 1])];
                const rendered = heatmap.renderHeatmapSVG({ schemaVersion: 'SimulatorHeatmapInputV1', valueKind: 'shares', values }, [0, 4.5, 100], 1000, {}, { chartTokens: tokens });
                const fill = rendered.match(/<text[^>]*fill="([^"]*)" class="cell-label-text/)[1];
                minimum = Math.min(minimum, measuredContrast(fill, bg));
            }
        }
    }
    assert(backgroundsCorrect, 'Kontrasthilfe verwendet unabhängig geprüfte sRGB-Alpha-Komposition mit genau 12 Prozent');
    assert(minimum >= 4.5 && fallbackMinimum >= 4.5, '1001 Palettenpunkte mit/ohne 12-%-Überlagerung: gewählte Renderer- und DOM-freie Textrolle mindestens 4,5:1');
    assert(wrongFailures > 0 && overlayFailures > 0, 'Gegenproben scheitern bei falscher Textfarbe und ignorierter kritischer Überlagerung');
    const specialGrid = heatmap.renderSweepHeatmapSVG(sweepFixture, 'medianEndWealth', 'liquidityRunwayYears', 'goldRebalancingBand', [3, 5], [10, 20], { chartTokens: tokens });
    const checkedGlyphs = new Set();
    for (const cell of specialGrid.matchAll(/<rect[^>]*fill="([^"]*)" stroke=[^>]*><title>[\s\S]*?<\/title><\/rect>([\s\S]*?)(?=<rect|$)/g)) {
        const bg = cell[1].startsWith('var(') ? roleColor(cell[1]) : parseChartColor(cell[1]);
        for (const label of cell[2].matchAll(/<text[^>]*fill="([^"]*)"[^>]*class="sweep-cell-text[^>]*>(.*?)<\/text>/g)) {
            assert(measuredContrast(label[1], bg) >= 4.5, `${label[2]}: Sweeptext auf seiner tatsächlichen Zelle ohne Halo lesbar`);
            checkedGlyphs.add(label[2]);
        }
    }
    assert(['N/A', '—', '⚠', '⛔'].every(glyph => checkedGlyphs.has(glyph)), 'Fehlende/ungültige Zelle und beide Warnzeichen separat gemessen');
    const before = JSON.stringify(sweepFixture);
    chartFragments();
    assertEqual(JSON.stringify(sweepFixture), before, 'Grafikrenderer verändern keine Eingabemetriken oder Parameter');

    const element = tag => ({ tag, attributes: {}, children: [], style: {}, setAttribute(key, value) { this.attributes[key] = value; }, appendChild(child) { this.children.push(child); } });
    globalThis.document = { createElementNS: (_, tag) => element(tag), createElement: element };
    const container = element('div');
    const rows = [{ wertAktien: 100, wertGold: 20, liquiditaet: 30, row: { bondBucketAfter: 40 } }, { wertAktien: 200, wertGold: 40, liquiditaet: 60, row: { bondBucketAfter: 50 } }];
    renderThreeBucketPortfolioChart(container, rows);
    assertEqual(JSON.stringify(container.children[0].children.map(p => p.attributes.d)), "[\"M 28.00 240.00 L 804.00 156.00 L 804.00 296.00 L 28.00 296.00 Z\",\"M 28.00 202.67 L 804.00 109.33 L 804.00 156.00 L 28.00 240.00 Z\",\"M 28.00 184.00 L 804.00 72.00 L 804.00 109.33 L 28.00 202.67 Z\",\"M 28.00 156.00 L 804.00 16.00 L 804.00 72.00 L 28.00 184.00 Z\"]", 'Portfolio-Datenserien und alle Pfadkoordinaten entsprechen dem Basisstand');
    assertEqual(container.children[0].attributes.viewBox, '0 0 820 320', 'Portfolio-Skala bleibt unverändert');
    assertEqual(container.children[0].attributes.width, '820', 'Portfolio verwendet numerische native Breite');
    assertEqual(container.children[0].attributes.height, '320', 'Portfolio verwendet numerische native Höhe');
    assertEqual(JSON.stringify(container.children[0].children.map(p => p.attributes.fill)), JSON.stringify(['var(--chart-1)', 'var(--chart-4)', 'var(--chart-2)', 'var(--chart-3)']), 'Portfolio-Zuordnung ETF, Bonds, Gold, Liquidität ist fest');
    assertEqual(JSON.stringify(container.children[1].children.map(p => p.children[1].textContent)), '["ETF","Bonds/Puffer","Gold","Liquidität"]', 'Serienlegende bleibt in der bisherigen Reihenfolge');
} finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }

{
    const previousDoc = globalThis.document;
    const element = tag => ({ tag, attributes: {}, children: [], style: {}, setAttribute(key, value) { this.attributes[key] = value; }, appendChild(child) { this.children.push(child); } });
    globalThis.document = { createElementNS: (_, tag) => element(tag), createElement: element };
    try {
        const rows = [
            { jahr: 2000, wertAktien: 1000000, wertGold: 0, liquiditaet: 100, row: { bondBucketAfter: 100 } },
            { jahr: 2001, wertAktien: 10000, wertGold: 0, liquiditaet: 0, row: { Regime: 'BANKRUPT' } },
            { jahr: 2002, wertAktien: 999999999, wertGold: 0, liquiditaet: 0, row: {} }
        ];
        const container = element('div');
        renderThreeBucketPortfolioChart(container, rows, { result: { rows, ruinYear: 2001 } });
        const svg = container.children[0];
        const labels = svg.children.filter(node => node.tag === 'text');
        assert(labels.some(node => node.textContent === 2000) && labels.some(node => node.textContent === 2001), 'Backtestachse verwendet echte Kalenderjahre');
        assert(!labels.some(node => node.textContent === 2002), 'Gezeichneter Chart endet bei Ruin statt Nullfortsetzung');
        assert(labels.some(node => String(node.textContent).includes('Mio. €')), 'Euroeinheit passt sich dem dargestellten Vermögen an');
        assert(labels.some(node => node.textContent === 'Dotcom-Crash'), 'Krisenband wird auf den dargestellten Kalenderzeitraum beschnitten');
        assert(labels.every(node => node.attributes['font-size'] === 'var(--balance-help)'), 'Diagrammtexte nutzen den lesbaren vorhandenen Typografietoken');
        assertEqual(variables(sources['css/tokens.css'])['--balance-help'], '14px', 'Native Diagrammschrift liegt über der Mindestgröße 12 px');
        const wide = element('div'); wide.clientWidth = 1500;
        renderThreeBucketPortfolioChart(wide, rows, { result: { rows, ruinYear: 2001 } });
        assertEqual(wide.children[0].attributes.viewBox, '0 0 1500 320', 'Kalenderchart passt den Viewport an die tatsächliche Hostbreite an');
        assert(wide.children[0].attributes.width === '1500' && wide.children[0].attributes.class.includes('ds-portfolio-calendar')
            && sources['simulator.css'].includes('.ds-portfolio-svg.ds-portfolio-calendar { width: auto; max-width: none; height: auto; }'),
            'Kalenderchart hält native Schrift auch nach Verengung lesbar statt SVG-Texte zu schrumpfen');
        assert(sources['simulator.css'].includes('.ds-portfolio-svg.ds-portfolio-calendar { width: 100%; max-width: 100%; }')
            && sources['simulator.css'].split('@media print').at(-1).includes('svg.chart-native-svg.chart-native-svg { width: 100%; height: auto; min-width: 0; max-width: 100%; }'),
            'Druck passt die native Kalenderchartbreite ohne zusätzliche Priorität an die Seite an');
    } finally { globalThis.document = previousDoc; }
}
