import { viridis, computeHeatmapStats, renderHeatmapSVG, renderSweepHeatmapSVG } from '../app/simulator/simulator-heatmap.js';
import { aggregateSweepMetrics } from '../app/simulator/simulator-results.js';

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
    assert(svg.includes('realisierte Entnahmequote ≥ 4,5 % (bin-basiert)'), 'Heatmap header should name realized-rate basis and bin-based >= operator');
    assert(svg.includes('nur eine Berichtsreferenz') && svg.includes('keine Alarm- oder Guardrail-Schwelle'), 'Heatmap should state the reporting-only role visibly');
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

// --- TEST 6: renderSweepHeatmapSVG edge cases ---
{
    // Empty sweep should emit a placeholder message (no grid).
    const empty = renderSweepHeatmapSVG([], 'successProbFloor', 'targetEq', 'runwayMin', [], []);
    assert(empty.includes('Keine Sweep-Ergebnisse'), 'Empty sweep should show placeholder');

    const sweepResults = [
        {
            params: { targetEq: 60, runwayMin: 24 },
            metrics: aggregateSweepMetrics([
                {
                    finalVermoegen: 10000,
                    maxDrawdown: 20,
                    minRunway: 24,
                    failed: false
                }
            ], {
                commonRandomNumbers: true,
                randomPolicyVersion: 'SweepCommonRandomNumbersV2'
            })
        }
    ];
    const svg = renderSweepHeatmapSVG(sweepResults, 'successProbFloor', 'targetEq', 'runwayMin', [60], [24], { showLegend: false });
    const midColor = viridis(0.5);
    assert(svg.includes(midColor), 'Single-value sweep should use mid-color for zero range');
    assert(svg.includes('1 Lauf je Kombination'), 'Sweep heatmap should expose the singular run count');
    assert(svg.includes('Common Random Numbers: aktiv'), 'Sweep heatmap should expose active CRN comparison');
    assert(svg.includes('Quantilrankings sind experimentelle Punktschätzer'), 'Sweep heatmap should expose quantile uncertainty');

    const saturatedOutcomes = Array.from({ length: 200 }, (_, index) => ({
        finalVermoegen: index < 11 ? 0 : 10000,
        maxDrawdown: index < 11 ? 100 : 34,
        minRunway: index < 11 ? 0 : 24,
        failed: index < 11
    }));
    const saturated = renderSweepHeatmapSVG([
        {
            params: { targetEq: 60, runwayMin: 24 },
            metrics: aggregateSweepMetrics(saturatedOutcomes)
        }
    ], 'worst5Drawdown', 'targetEq', 'runwayMin', [60], [24], { showLegend: false });
    assert(
        saturated.includes('Drawdown-P95 ist durch terminale Ruine gesättigt'),
        'Sweep heatmap visibly explains a terminal-ruin-saturated drawdown metric'
    );

    const legacyOnly = renderSweepHeatmapSVG([
        {
            params: { targetEq: 60, runwayMin: 24 },
            metrics: { successProbFloor: 100 }
        }
    ], 'successProbFloor', 'targetEq', 'runwayMin', [60], [24], { showLegend: false });
    assert(
        legacyOnly.includes('veralteten oder unversionierten Ergebnisvertrag'),
        'Sweep heatmap should reject an unversioned metric shape with a migration hint'
    );
}

console.log('✅ Simulator heatmap tests passed');
console.log('--- Simulator Heatmap Tests Completed ---');

// Sonderwerte einzeln: echte Null, Kleinstwert, leere Zelle und Invalidität.
const tiny = renderHeatmapSVG([[1, 1999, 0]], [0, 3, 4.5, 100], 2000, {}, { showFooterStats: false });
assert(tiny.includes('&lt;0,1\u00a0%</text>'), 'Kleinstwert wird deutsch und SVG-sicher beschriftet');
assert(tiny.includes('Anteil: 0,05\u00a0% (1 Läufe)'), 'Tooltip behält zwei Dezimalstellen und die ursprüngliche Laufzahl');
assert(tiny.includes('Anteil: 0,00\u00a0% (0 Läufe)'), 'Echte Null bleibt im Tooltip sichtbar');
assert(tiny.includes('∞\u00a0%'), 'Offene vorhandene Intervallgrenze bleibt unendlich');
assertEqual(renderHeatmapSVG([], [0, 4.5], 0), '', 'Leere Heatmap wird nicht zu einer Nullzelle');
const sweepData = [{ params: { liquidityRunwayYears: 3.5, goldTargetPct: 0 }, metrics: aggregateSweepMetrics([{ finalVermoegen: 0, failed: true, maxDrawdown: 100, minRunway: 0 }]) }];
const beforeSweep = JSON.stringify(sweepData);
const sweepZero = renderSweepHeatmapSVG(sweepData, 'successProbFloor', 'liquidityRunwayYears', 'goldTargetPct', [3.5, 4], [0]);
assert(sweepZero.includes('>0,0\u00a0%</text>'), 'Echte Sweep-Null bleibt numerische Null');
assert(sweepZero.includes('>—</text>') && sweepZero.includes('Keine Daten'), 'Fehlende Sweep-Zelle zeigt keinen kopierten Palettenminimalwert');
assert(sweepZero.includes('>3,5</text>') && sweepZero.includes('Liquiditäts-Runway: 3,5'), 'Achse und Tooltip lokalisieren Parameter ohne neue Rundung');
const invalidSweep = renderSweepHeatmapSVG([{ ...sweepData[0], metrics: { ...sweepData[0].metrics, invalidCombination: true, invalidReason: 'Synthetischer Grund' } }, { ...sweepData[0], params: { liquidityRunwayYears: 4, goldTargetPct: 0 } }], 'successProbFloor', 'liquidityRunwayYears', 'goldTargetPct', [3.5, 4], [0]);
assert(invalidSweep.includes('>N/A</text>') && invalidSweep.includes('Synthetischer Grund'), 'Ungültige Kombination bleibt von fehlend und Null getrennt');
assertEqual(JSON.stringify(sweepData), beforeSweep, 'Beschriftung verändert weder Sweepwerte noch Parameter');

// Native Maße, getrennte Zeilen, HTML-Fußpaare und vorhandene Optionen.
for (const width of [980, 1180]) {
    const matrix = [[1, 1], [0, 2]], bins = [0, 4.5, 10];
    const before = JSON.stringify({ matrix, bins });
    const html = renderHeatmapSVG(matrix, bins, 2, { timeShareQuoteAbove45: .123 }, { width });
    assert(html.includes(`width="${width}" height="420" viewBox="0 0 ${width} 420"`), 'Monte Carlo: native Maße passen zum Koordinatenraum');
    assert(html.includes('chart-title') && html.includes('chart-axis-title') && html.includes('chart-tick-text'), 'Explizite Titel-, Achsen- und Tickrollen');
    assertEqual((html.match(/class="heatmap-footer-pair"/g) || []).length, 3, 'Drei unabhängig umbrechende HTML-Fußpaare');
    assert(html.indexOf('class="heatmap-footer"') > html.indexOf('</svg>') && !html.includes('<tspan'), 'Fußkennzahlen außerhalb des SVG ohne feste x-Positionen');
    assert(html.indexOf('heatmap-subtitle') < html.indexOf('<svg') && html.includes('y="-12" class="col-header'), 'Untertitel im Dokumentfluss, Spaltenwerte in eigener SVG-Zeile');
    assert(html.includes('x="23"') && !html.includes(`x="${width - 70 - 130 + 45}"`), 'Legendentexte relativ zur Legendengruppe');
    const hidden = renderHeatmapSVG(matrix, bins, 2, {}, { width, showFooterStats: false, showLegend: false, showCriticalOverlay: false });
    assert(!hidden.includes('class="heatmap-footer"') && !hidden.includes('class="legend"') && !hidden.includes('class="critical-overlay"'), 'Alle Sichtbarkeitsoptionen bleiben wirksam');
    assert(renderHeatmapSVG(matrix, bins, 2).includes('<strong>N/A</strong>'), 'Fehlendes Zusatz-KPI bleibt N/A');
    const sweep = renderSweepHeatmapSVG(sweepData, 'successProbFloor', 'liquidityRunwayYears', 'goldTargetPct', [3.5, 4], [0], { width });
    assert(sweep.includes(`width="${width}" height="500" viewBox="0 0 ${width} 500"`) && sweep.includes('x="23"'), 'Sweep: native Maße und lokale Legendentexte');
    assertEqual(JSON.stringify({ matrix, bins }), before, 'Heatmaplayout erhält Matrix und Bingrenzen bytegleich');
}
const { HEATMAP_V4_STYLE } = await import('../app/simulator/simulator-heatmap.js');
assert(!/paint-order|stroke-width: 3px|label-bg/.test(HEATMAP_V4_STYLE), 'Öffentlicher Styleexport enthält keinen Halo und keine Labelplatte');
assert(HEATMAP_V4_STYLE.includes('font-size: 13px') && HEATMAP_V4_STYLE.includes('font-variant-numeric: tabular-nums'), 'Ticks und Zellen: 13 Pixel und tabellarische Ziffern');
