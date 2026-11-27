import { heatmapColor, readChartTokens, parseChartColor, CHART_LABEL, heatmapLabelColor, visibleHeatmapColor } from '../app/shared/designsystem-chart-colors.js';
import * as heatmap from '../app/simulator/simulator-heatmap.js';
import { renderThreeBucketPortfolioChart } from '../app/simulator/simulator-portfolio-chart.js';
import { readSources, variables, resolveValue, contrast, validateTools, validateFoundation } from './designsystem-source-contract.mjs';

const sources = readSources();
const vars = variables(sources['css/tokens.css']);
const tokens = Object.fromEntries(Object.keys(vars).map(name => [name, resolveValue(vars[name], vars)]));
// Am Basisstand vor der Layoutänderung erfasst; Positionen sind separat geprüft.
function heatmapDataProjection(html) {
    return {
        titles: [...html.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]),
        colors: [...html.matchAll(/(?:stop-color|fill)="([^"]*)"/g)].map(m => m[1]).filter(s => s.startsWith('color-mix') || /var\(--heatmap-|var\(--surface-sunken\)/.test(s)),
        numbers: [...html.matchAll(/<(?:text|tspan|strong)\b[^>]*>([^<>]*)<\/(?:text|tspan|strong)>/g)].map(m => m[1]).filter(s => /^\d|^(?:N\/A|—|⚠|⛔)$/.test(s)).sort()
    };
}
const heatmapBaseline = [{"titles":["Jahr 1 | Realisierte Entnahmequote: 0,0 %-3,0 % | Anteil: 33,33 % (1 Läufe)","Jahr 1 | Realisierte Entnahmequote: 3,0 %-4,5 % | Anteil: 33,33 % (1 Läufe)","Jahr 1 | Realisierte Entnahmequote: 4,5 %-10,0 % | Anteil: 0,00 % (0 Läufe)","Jahr 2 | Realisierte Entnahmequote: 0,0 %-3,0 % | Anteil: 0,00 % (0 Läufe)","Jahr 2 | Realisierte Entnahmequote: 3,0 %-4,5 % | Anteil: 33,33 % (1 Läufe)","Jahr 2 | Realisierte Entnahmequote: 4,5 %-10,0 % | Anteil: 66,67 % (2 Läufe)"],"colors":["color-mix(in srgb, var(--heatmap-mid) 82.35294117647058%, var(--heatmap-high))","color-mix(in srgb, var(--heatmap-mid) 82.35294117647058%, var(--heatmap-high))","var(--heatmap-low)","var(--heatmap-low)","color-mix(in srgb, var(--heatmap-mid) 82.35294117647058%, var(--heatmap-high))","var(--heatmap-high)","var(--heatmap-low)","color-mix(in srgb, var(--heatmap-low) 50%, var(--heatmap-mid))","var(--heatmap-mid)","color-mix(in srgb, var(--heatmap-mid) 50%, var(--heatmap-high))","var(--heatmap-high)"],"numbers":["0,0 %","0,0 %","0,0 %","0,0 %","1","12,3 %","14,2 %","2","28,3 %","3,0 %","33,3 %","33 %","33 %","33 %","4,5 %","42,5 %","56,7 %","66,7 %","67 %"]},{"titles":["Jahr 1 | Realisierte Entnahmequote: 0,0 %-3,0 % | Anteil: 0,00 % (0 Läufe)","Jahr 1 | Realisierte Entnahmequote: 3,0 %-4,5 % | Anteil: 25,00 % (0.25 Läufe)","Jahr 1 | Realisierte Entnahmequote: 4,5 %-10,0 % | Anteil: 75,00 % (0.75 Läufe)"],"colors":["var(--heatmap-low)","color-mix(in srgb, var(--heatmap-low) 28.57142857142857%, var(--heatmap-mid))","var(--heatmap-high)","var(--heatmap-low)","color-mix(in srgb, var(--heatmap-low) 50%, var(--heatmap-mid))","var(--heatmap-mid)","color-mix(in srgb, var(--heatmap-mid) 50%, var(--heatmap-high))","var(--heatmap-high)"],"numbers":["0,0 %","0,0 %","0,0 %","1","17,5 %","25,0 %","25 %","3,0 %","35,0 %","4,5 %","52,5 %","70,0 %","75,0 %","75 %","N/A"]}];
export function chartFragments(h = heatmap) {
    const matrix = [[1, 1, 0], [0, 1, 2]];
    const bins = [0, 3, 4.5, 10];
    return [
        h.renderHeatmapSVG(matrix, bins, 3, { timeShareQuoteAbove45: .123 }),
        h.renderHeatmapSVG({ schemaVersion: 'SimulatorHeatmapInputV1', valueKind: 'shares', values: [[0, .25, .75]] }, bins, 4, {}, { normalize: 'column', showCriticalOverlay: false })
    ];
}

// Prüfungen
const oldWindow = globalThis.window, oldDocument = globalThis.document;
globalThis.window = {};
try {
    const fragments = chartFragments();
    for (const [index, label] of [[0, '12,3\u00a0%'], [1, '75,0\u00a0%']]) {
        assert(fragments[index].includes(label), `Echtes Diagramm ${index} enthält den exakten geschützten Prozenttext ${label}`);
    }
    const { validateScrollableMarkup } = await import('./designsystem-source-contract.mjs');
    for (const html of fragments) assertEqual(validateScrollableMarkup(html).join('\n'), '', 'Alle echten Grafikfragmente liegen in bedienbaren Scrollkapseln');
    assertEqual(JSON.stringify(fragments.map(heatmapDataProjection)), JSON.stringify(heatmapBaseline), 'Heatmaps erhalten Laufzahlen und Zell-/Legendenfarben; Geldtexte sind gekürzt, Tooltips genau');
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
    for (const fragment of fragments) assert(!/label-bg|paint-order|<text[^>]*stroke=/.test(fragment), 'Zelltexte ohne Labelplatte und ohne Textstroke');
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

    const element = tag => ({ tag, attributes: {}, children: [], style: {}, setAttribute(key, value) { this.attributes[key] = value; }, appendChild(child) { this.children.push(child); } });
    globalThis.document = { createElementNS: (_, tag) => element(tag), createElement: element };
    const container = element('div');
    const rows = [{ wertAktien: 100, wertGold: 20, liquiditaet: 30, row: { bondBucketAfter: 40 } }, { wertAktien: 200, wertGold: 40, liquiditaet: 60, row: { bondBucketAfter: 50 } }];
    renderThreeBucketPortfolioChart(container, rows);
    assertEqual(JSON.stringify(container.children[0].children.map(p => p.attributes.d)), "[\"M 28.00 240.00 L 804.00 156.00 L 804.00 296.00 L 28.00 296.00 Z\",\"M 28.00 202.67 L 804.00 109.33 L 804.00 156.00 L 28.00 240.00 Z\",\"M 28.00 184.00 L 804.00 72.00 L 804.00 109.33 L 28.00 202.67 Z\",\"M 28.00 156.00 L 804.00 16.00 L 804.00 72.00 L 28.00 184.00 Z\"]", 'Portfolio-Datenserien und alle Pfadkoordinaten entsprechen dem Basisstand');
    assertEqual(container.children[0].attributes.viewBox, '0 0 820 320', 'Portfolio-Skala bleibt unverändert');
    assertEqual(container.children[0].attributes.width, '820', 'Portfolio verwendet numerische native Breite');
    assertEqual(container.children[0].attributes.height, '320', 'Portfolio verwendet numerische native Höhe');
    assertEqual(JSON.stringify(container.children[0].children.map(p => p.attributes.fill)), JSON.stringify(['var(--chart-1)', 'var(--chart-4)', 'var(--chart-2)', 'var(--history-cash)']), 'Portfolio-Zuordnung ETF, Bonds, Gold, Liquidität ist fest');
    assertEqual(JSON.stringify(container.children[1].children.map(p => p.children[1].textContent)), '["Aktien","Anleihentopf","Gold","Liquidität"]', 'Serienlegende bleibt in der bisherigen Reihenfolge');
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
