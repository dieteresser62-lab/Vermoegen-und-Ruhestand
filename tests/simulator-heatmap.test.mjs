import { viridis, computeHeatmapStats, renderHeatmapSVG } from '../app/simulator/simulator-heatmap.js';

console.log('--- Simulator Heatmap Tests ---');

// --- TEST 1: freigegebene Palette; öffentlicher Exportname bleibt erhalten ---
{
    assertEqual(viridis(0), 'var(--heatmap-low)', 'Viridis at 0 should use the light token');
    assertEqual(viridis(1), 'var(--heatmap-high)', 'Viridis at 1 should use the slate token');
}

// --- TEST 2: computeHeatmapStats empty ---
{
    // Empty heatmap should short-circuit to zero stats.
    const stats = computeHeatmapStats([], [0, 4.5, 10], 10);
    assertEqual(stats.shares.length, 0, 'Empty heatmap should return empty shares');
    assertEqual(stats.globalP90, 0, 'Empty heatmap should have globalP90=0');
}

// --- TEST 3: computeHeatmapStats single value ---
{
    // One year, two bins: put all mass into bin 0 to get 100% share.
    const heat = [new Uint32Array([2, 0])];
    const stats = computeHeatmapStats(heat, [0, 4.5, 10], 2);
    assertClose(stats.globalP90, 1, 0.0001, 'Single-value heatmap should have globalP90=1');
    assertClose(stats.shares[0][0], 1, 0.0001, 'Share should be 1 for full bin');

    const exactBoundaryBin = computeHeatmapStats([new Uint32Array([0, 1])], [0, 4.5, 10], 1);
    assertClose(exactBoundaryBin.colSharesAbove45[0], 1, 0.0001, 'The bin starting at exactly 4.5 percent belongs to the bin-based >= overlay');
}

// --- TEST 4: renderHeatmapSVG cell mapping ---
{
    // 2 years x 2 bins -> 4 cells.
    const heat = [new Uint32Array([1, 1]), new Uint32Array([0, 2])];
    const bins = [0, 4.5, 10];
    const svg = renderHeatmapSVG(heat, bins, 2, { timeShareQuoteAbove45: 0.1 }, { showLegend: false, showFooterStats: false });
    const cellCount = (svg.match(/class="heatmap-cell"/g) || []).length;
    assertEqual(cellCount, 4, 'Heatmap should render one cell per year/bin');
    assert(svg.includes('realisierte Entnahmequote ≥ 4,5 % (gezählt je Quotenstufe)'), 'Heatmap header should name realized-rate basis and bin-based >= operator');
    assert(svg.includes('nur eine Berichtsreferenz') && svg.includes('keine Alarm- oder Leitplanken-Schwelle'), 'Heatmap should state the reporting-only role visibly');
    assert(svg.includes('Realisierte Entnahmequote:'), 'Heatmap cell tooltip should name the realized withdrawal-rate basis');

    const svgWithFooter = renderHeatmapSVG(heat, bins, 2, { timeShareQuoteAbove45: 0.1 }, { showLegend: false, showFooterStats: true });
    assert(svgWithFooter.includes('realisierte Quote &gt; 4,5 %'), 'Heatmap footer should distinguish the strict overall KPI from the >= bin overlay');
}

// --- TEST 5: count/share input contract ---
{
    const countStats = computeHeatmapStats([new Uint32Array([1, 0])], [0, 4.5, 10], 100);
    assertClose(countStats.shares[0][0], 0.01, 0.0001, 'One heatmap count in 100 runs should render as one percent');

    const shareStats = computeHeatmapStats({
        schemaVersion: 'SimulatorHeatmapInputV1',
        valueKind: 'shares',
        values: [[0.25, 0.75]],
        denominator: null
    }, [0, 4.5, 10], 100);
    assertClose(shareStats.shares[0][0], 0.25, 0.0001, 'Versioned share input should preserve explicit shares');
    assertClose(shareStats.shares[0][1], 0.75, 0.0001, 'Versioned share input should not divide by the run denominator');
}



console.log('✅ Simulator heatmap tests passed');
console.log('--- Simulator Heatmap Tests Completed ---');

// Sonderwerte einzeln: echte Null, Kleinstwert und leere Heatmap.
const tiny = renderHeatmapSVG([[1, 1999, 0]], [0, 3, 4.5, 100], 2000, {}, { showFooterStats: false });
assert(tiny.includes('&lt;0,1\u00a0%</text>'), 'Kleinstwert wird deutsch und SVG-sicher beschriftet');
assert(tiny.includes('Anteil: 0,05\u00a0% (1 Läufe)'), 'Tooltip behält zwei Dezimalstellen und die ursprüngliche Laufzahl');
assert(tiny.includes('Anteil: 0,00\u00a0% (0 Läufe)'), 'Echte Null bleibt im Tooltip sichtbar');
assert(tiny.includes('∞\u00a0%'), 'Offene vorhandene Intervallgrenze bleibt unendlich');
assertEqual(renderHeatmapSVG([], [0, 4.5], 0), '', 'Leere Heatmap wird nicht zu einer Nullzelle');

// Native Maße, getrennte Zeilen, HTML-Fußpaare und vorhandene Optionen.
for (const width of [980, 1180]) {
    const matrix = [[1, 1], [0, 2]], bins = [0, 4.5, 10];
    const before = JSON.stringify({ matrix, bins });
    const html = renderHeatmapSVG(matrix, bins, 2, { timeShareQuoteAbove45: .123 }, { width });
    assert(html.includes(`width="${width}" height="${Math.round(420 * width / 980)}" viewBox="0 0 ${width} ${Math.round(420 * width / 980)}"`), 'Monte Carlo: native Maße passen zum Koordinatenraum');
    assert(html.includes('chart-title') && html.includes('chart-axis-title') && html.includes('chart-tick-text'), 'Explizite Titel-, Achsen- und Tickrollen');
    assertEqual((html.match(/class="heatmap-footer-pair"/g) || []).length, 3, 'Drei unabhängig umbrechende HTML-Fußpaare');
    assert(html.indexOf('class="heatmap-footer"') > html.indexOf('</svg>') && !html.includes('<tspan'), 'Fußkennzahlen außerhalb des SVG ohne feste x-Positionen');
    assert(html.indexOf('heatmap-subtitle') < html.indexOf('<svg') && html.includes('y="-12" class="col-header'), 'Untertitel im Dokumentfluss, Spaltenwerte in eigener SVG-Zeile');
    assert(html.includes('x="23"') && !html.includes(`x="${width - 70 - 130 + 45}"`), 'Legendentexte relativ zur Legendengruppe');
    const hidden = renderHeatmapSVG(matrix, bins, 2, {}, { width, showFooterStats: false, showLegend: false, showCriticalOverlay: false });
    assert(!hidden.includes('class="heatmap-footer"') && !hidden.includes('class="legend"') && !hidden.includes('class="critical-overlay"'), 'Alle Sichtbarkeitsoptionen bleiben wirksam');
    assert(renderHeatmapSVG(matrix, bins, 2).includes('<strong>N/A</strong>'), 'Fehlendes Zusatz-KPI bleibt N/A');
    assertEqual(JSON.stringify({ matrix, bins }), before, 'Heatmaplayout erhält Matrix und Bingrenzen bytegleich');
}
const { HEATMAP_V4_STYLE } = await import('../app/simulator/simulator-heatmap.js');
assert(!/paint-order|stroke-width: 3px|label-bg/.test(HEATMAP_V4_STYLE), 'Öffentlicher Styleexport enthält keinen Halo und keine Labelplatte');
assert(HEATMAP_V4_STYLE.includes('font-size: var(--text-dense)') && HEATMAP_V4_STYLE.includes('font-variant-numeric: tabular-nums'), 'Ticks mit Hilfetext und Zellen mit Lesetext verwenden tabellarische Ziffern');

assert(HEATMAP_V4_STYLE.includes("font-size: var(--text-base)"), "Zellbeschriftungen verwenden die Lesetextgröße");

// Die echte Resize-Bindung zeichnet mit der letzten Matrix neu, ohne Neuberechnung.
const { renderSizedSimulatorChart } = await import('../app/simulator/simulator-heatmap.js');
let resize, observerCount = 0;
const host = { clientWidth: 1400, style: {}, innerHTML: '', ownerDocument: { defaultView: {
    getComputedStyle: () => ({ paddingLeft: '20px', paddingRight: '20px' }),
    ResizeObserver: class { constructor(callback) { resize = callback; observerCount++; } observe() {} }
} } };
const draw = options => renderHeatmapSVG([[1, 2]], [0, 4.5, 10], 3, {}, options);
renderSizedSimulatorChart(host, draw);
assert(host.innerHTML.includes('width="1360" height="583" viewBox="0 0 1360 583"'), 'Heatmap misst die Containerbreite ohne Innenabstand');
assert(!host.innerHTML.includes('class="ds-scroll-hint"'), 'Passende Grafik hat keinen Scrollhinweis');
host.clientWidth = 1800; resize();
assert(host.innerHTML.includes('width="1760" height="754"'), 'Resize vergrößert Raster und Höhe');
host.clientWidth = 740; resize();
assert(host.innerHTML.includes('width="820"') && host.innerHTML.includes('class="ds-scroll-hint"'), 'Nur tatsächliche Überbreite zeigt den Scrollhinweis');
renderSizedSimulatorChart(host, options => renderHeatmapSVG([[2, 1]], [0, 4.5, 10], 3, {}, options));
assertEqual(observerCount, 1, 'Neue Projektion verwendet denselben Resize-Anschluss');
host.clientWidth = 1400; resize();
assert(host.innerHTML.includes('width="1360" height="583"') && host.innerHTML.includes('Anteil: 66,67')
    && !host.innerHTML.includes('class="ds-scroll-hint"'), 'Neue Projektion verwendet die aktuelle Containerbreite und blendet den Scrollhinweis wieder aus');
const beforeResize = host.innerHTML;
resize();
assertEqual(host.innerHTML, beforeResize, 'Unveränderte Breite erhält dieselbe Darstellung');
