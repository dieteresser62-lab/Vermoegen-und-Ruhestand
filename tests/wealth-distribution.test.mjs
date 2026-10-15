import { buildWealthDistribution, renderWealthDistribution } from '../app/simulator/wealth-distribution.js';
import { ScenarioAnalyzer } from '../app/simulator/scenario-analyzer.js';
import { quantile } from '../app/simulator/simulator-utils.js';
import { formatChartEuro } from '../app/simulator/results-formatting.js';

function result(values, realValues = values, ruin = 0) {
    return { finalOutcomes: { distribution: { values, sampleSize: values.length, requestedRuns: values.length + 2, excludedRuns: 2 }, p10: quantile(values, .1), p25: quantile(values, .25), p50: quantile(values, .5) }, wealthView: { realValues }, outcomeInventory: { ruin } };
}
const values = [0, 0, 10, 30, 70, 90, 100, 150, 1000, 100000];
const results = result(values, [0, 0, 5, 30, 10, 18, 100, 150, 1000, 50000], 1);
const before = JSON.stringify(results);
for (const mode of ['real', 'nominal']) {
    const model = buildWealthDistribution(results, null, mode);
    assert(model.available, `${mode}: vollständige bestehende Beobachtungspopulation ist verfügbar`);
    assert(model.values === (mode === 'real' ? results.wealthView.realValues : values), `${mode}: unveränderte Population, kein Inflationsmittelwert`);
    assertEqual(model.sampleSize, 10, `${mode}: nur zehn Finanzbeobachtungen`);
    assertEqual(model.excludedRuns, 2, `${mode}: technische Fehler bleiben separat ausgeschlossen`);
    assertEqual(model.ruinCount, 1, `${mode}: Ruin stammt aus Outcome`);
    assertEqual(model.successfulZeroCount, 1, `${mode}: erfolgreicher Nullendwert bleibt eigener Finanzwert`);
    assertEqual(model.overflowCount, 1, `${mode}: großer Ausreißer bleibt im oberen Rest`);
    assertEqual(model.bins.reduce((sum, bin) => sum + bin.count, 0) + model.ruinCount + model.overflowCount, 10, `${mode}: kein Fall geht verloren`);
    assert(Math.abs(model.bins.reduce((sum, bin) => sum + bin.sharePct, 0) + model.ruinSharePct + model.overflowSharePct - 100) < 1e-10, `${mode}: Anteile ergeben 100 %`);
    assert(!/NaN|Infinity/.test(renderWealthDistribution(model)), `${mode}: Histogrammkoordinaten sind endlich`);
}
assertEqual(JSON.stringify(results), before, 'Verteilung verändert keine KPIs oder Ausgangsbeobachtungen');
for (const [label, data] of [['leer', result([])], ['ein Lauf', result([12])], ['gleiche Werte', result(Array(20).fill(40))], ['100 % Ruin', result([0, 0, 0], [0, 0, 0], 3)], ['nur erfolgreiche Nullwerte', result([0, 0])], ['Ausreißer', result([0, 1, 2, 1e308])]]) {
    const model = buildWealthDistribution(data, null, 'nominal');
    const html = renderWealthDistribution(model);
    assert(!/NaN|Infinity/.test(html), `${label}: keine ungültige Geometrie`);
    if (model.available) assertEqual(model.bins.reduce((sum, bin) => sum + bin.count, 0) + model.ruinCount + model.overflowCount, data.finalOutcomes.distribution.sampleSize, `${label}: vollständige Fallzählung`);
}
const old = result([1, 2]); delete old.wealthView;
assert(!buildWealthDistribution(old).available, 'Altresultat ohne Realbeobachtungen zeigt vorgesehenen Leerzustand');
assert(buildWealthDistribution(old, null, 'nominal').available, 'Altresultat bleibt nominal lesbar');
assert(!buildWealthDistribution(result([1, 2], [1])).available, 'Abweichende Realpopulation wird nicht als vollständige Verteilung gezeigt');
assert(!buildWealthDistribution(result([1, 2], [1, Infinity])).available, 'Beschädigte Realbeobachtungen werden nicht zu Nullwerten');
assert(!buildWealthDistribution(result([1, 2], [1, 2], 1)).available, 'Unmöglicher Ruinbestand bleibt erklärter Fehlerzustand');

const analyzer = new ScenarioAnalyzer(4);
for (const [index, endVermoegen, factor] of [[0, 10, 1], [1, 20, 1], [2, 30, 10], [3, 40, 1]]) analyzer.addRun({ index, endVermoegen, failed: false, lebensdauer: 1, maxKuerzung: 0, logDataRows: [{ jahr: 1, portfolio_total_end: endVermoegen, inflation_factor_cum: factor }] });
const logs = analyzer.buildScenarioLogs();
const data = result([10, 20, 30, 40], [10, 20, 3, 40]);
const sourcesBefore = JSON.stringify({ data, logs });
const nominal = buildWealthDistribution(data, logs, 'nominal');
const real = buildWealthDistribution(data, logs);
assertEqual(nominal.marks.find(m => m.key === 'p25').value, 17.5, 'P25 ist der interpolierte Verteilungswert, kein ausgewählter Lauf');
assertEqual(nominal.p10, 13, 'Nominales P10 aus allen Endwerten');
assertEqual(nominal.p75, 32.5, 'Nominales P75 aus allen Endwerten');
assertClose(real.p10, 5.1, 1e-12, 'Reales P10 aus unabhängig sortierter Realpopulation');
assertEqual(real.p25, 8.25, 'Reales P25 aus unabhängig sortierter Realpopulation');
assertEqual(real.p75, 25, 'Reales P75 aus unabhängig sortierter Realpopulation');
assertEqual(real.p50, 15, 'Realer Median gehört zur Verteilung statt zum nominalen Medianlauf mit Wert 3');
for (const model of [nominal, real]) {
    assert(model.marks.every((mark, index) => index === 0 || mark.value >= model.marks[index-1].value), 'Alle dargestellten Perzentile sind monoton');
    assert(model.ladder.every(mark => mark.gap === null || mark.gap >= 0), 'Perzentilabstände sind nicht negativ');
    assert(model.marks.every(mark => !Object.hasOwn(mark, 'sourceIdentity')), 'Verteilungskennzahlen behaupten keinen Quelllauf');
}
const realHtml = renderWealthDistribution(real);
for (const [value, expected] of [[1234567.89, '1,2\u00a0Mio. €'], [125000.12, '125\u00a0Tsd. €'], [123.45, '123\u00a0€'], [-1234567.89, '-1,2\u00a0Mio. €'], [0, '0\u00a0€'], [null, '—'], [Infinity, '—']]) {
    assertEqual(formatChartEuro(value), expected, 'Diagrammtexte kürzen Eurobeträge und kennzeichnen fehlende Werte');
}
const millionModel = buildWealthDistribution(result([1000000.12, 1234567.89, 2000000.34]), null, 'nominal');
const millionHtml = renderWealthDistribution(millionModel);
assert(millionHtml.includes('Median <b title="1.234.568\u00a0€">1,2\u00a0Mio. €</b>'), 'Median zuerst gerundet, genauer Betrag im Tooltip');
assert(millionHtml.includes('P25–P75') && !millionHtml.includes('id="wealthShowAllMarks" checked') && !millionHtml.includes('wealth-statistics-details" open'), 'Erster Blick zeigt mittlere Streuung; weitere Marken und genaue Werte starten geschlossen');
assert(renderWealthDistribution(millionModel, { showAllMarks: true, detailsOpen: true }).includes('id="wealthShowAllMarks" checked') && renderWealthDistribution(millionModel, { detailsOpen: true }).includes('wealth-statistics-details" open'), 'Anzeige kann Marken und genaue Details wieder geöffnet übernehmen');
assert(realHtml.includes('Verteilungskennzahlen · heutige Euro') && realHtml.includes('Ausgewählte Szenarien'), 'Verteilung und Einzelpfade sind sichtbar getrennt');
assert(!realHtml.includes('Abstände können negativ sein'), 'Perzentile benötigen keine Erklärung einer abweichenden Szenariorangfolge');
assertEqual(JSON.stringify({ data, logs }), sourcesBefore, 'Anzeige erhält Quellobjekte und nominale Szenarioauswahl');
const fractional = structuredClone(logs);
fractional.characteristic.find(s => s.key === 'p5').endVermoegen = 999;
assertEqual(JSON.stringify(buildWealthDistribution(data, fractional, 'nominal')), JSON.stringify(nominal), 'Szenarioänderung verändert keine Verteilungskennzahl');

// Echter Aggregator: technische Pufferplätze werden ausgeschlossen; Pflegegruppen
// liefern gemeinsam die bestehende Realpopulation, ohne Änderung der Export-KPIs.
const { createMonteCarloBuffers, buildMonteCarloAggregates, attachMonteCarloBatchOutcome } = await import('../app/simulator/monte-carlo-runner.js');
const { MONTE_CARLO_MISSINGNESS_CODE } = await import('../app/simulator/monte-carlo-chunk-result.js');
const { createMonteCarloRunResultV1 } = await import('../app/simulator/monte-carlo-contracts.js');
const buffers = createMonteCarloBuffers(5);
buffers.finalOutcomes.set([0, 0, 100, 400, 0]);
buffers.meanWithdrawalRateMissingness = new Uint8Array(5).fill(MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS);
buffers.meanWithdrawalRateMissingness[4] = MONTE_CARLO_MISSINGNESS_CODE.TECHNICAL_ERROR;
const sourceLists = { endWealthWithCareRealEur: [0, 50], endWealthNoCareRealEur: [0, 100] };
const aggregate = buildMonteCarloAggregates({ inputs: {}, totalRuns: 5, buffers, heatmap: [], totals: { outcomeRuinCount: 1, outcomeAllDeadCount: 1, outcomeHorizonExhaustedCount: 2, shortfallWithCareCount: 0, shortfallNoCareProxyCount: 0 }, lists: sourceLists });
assertEqual(JSON.stringify(aggregate.finalOutcomes.distribution.values), '[0,0,100,400]', 'Nominale Viewpopulation ist exakt die vorhandene Finanzverteilung ohne Technikplatz');
assertEqual(JSON.stringify(aggregate.wealthView.realValues), '[0,50,0,100]', 'Reale Viewpopulation verbindet die beiden vorhandenen Pflegegruppen');
assertEqual(aggregate.finalOutcomes.distribution.excludedRuns, 1, 'Technischer Platz wird ausdrücklich ausgeschlossen');
const attached = attachMonteCarloBatchOutcome(aggregate, { requested: 5, financiallyEvaluable: 4, technicalError: 1, errors: [] });
const snapshot = structuredClone(attached); delete snapshot.wealthView;
assertEqual(JSON.stringify(createMonteCarloRunResultV1({ aggregatedResults: attached })), JSON.stringify(createMonteCarloRunResultV1({ aggregatedResults: snapshot })), 'Zusätzliche Viewdaten verändern die bestehende vollständige Ergebnis-/Exportprojektion nicht');
const exportedBefore = JSON.stringify(createMonteCarloRunResultV1({ aggregatedResults: attached }));
const realModel = buildWealthDistribution(attached);
renderWealthDistribution(realModel);
assertEqual(JSON.stringify(createMonteCarloRunResultV1({ aggregatedResults: attached })), exportedBefore, 'Rendern erhält die vollständige Ergebnis-/Exportprojektion bytegleich');
assert(realModel.available && realModel.sampleSize === 4 && realModel.excludedRuns === 1, 'Echter Aggregator und angehängtes Outcome liefern dieselbe Real-/Nominalpopulation');
assertEqual(JSON.stringify(sourceLists), '{"endWealthWithCareRealEur":[0,50],"endWealthNoCareRealEur":[0,100]}', 'Ansicht ergänzt Daten lesend, ohne Quelllisten zu verändern');

const withSources = buildMonteCarloAggregates({ inputs: {}, totalRuns: 5, buffers, heatmap: [], totals: { outcomeRuinCount: 1, outcomeAllDeadCount: 1, outcomeHorizonExhaustedCount: 2, shortfallWithCareCount: 0, shortfallNoCareProxyCount: 0 }, lists: sourceLists,
    pathSummaries: { finalValueRealEur: new Float64Array([0, 0, 50, 100, 999999]) },
    pathMissingness: { path: new Uint8Array([1, 1, 1, 1, MONTE_CARLO_MISSINGNESS_CODE.TECHNICAL_ERROR]) } });
assertEqual(JSON.stringify(withSources.wealthView.realByRun), '[0,0,50,100,null]', 'Quellindex bleibt global; technischer Pfad kann keine Endmarke liefern');
const earlyDeath = { characteristic: [{ key: 'p50', endVermoegen: 100, sourceIdentity: { absoluteRunIndex: 2 }, logDataRows: [{ jahr: 1, recordType: 'terminal_death' }] }], random: [] };
const earlyDeathView = buildWealthDistribution(withSources, earlyDeath);
assertEqual(earlyDeathView.p50, 25, 'Median verwendet die ganze Realpopulation auch bei einem ausgewählten frühen Todespfad');
assert(!JSON.stringify(withSources.wealthView).includes('realByRun'), 'Flüchtige Quellzuordnung ist kein serialisierter Ergebnis-/Exportvertrag');

// 98 % Outcome-Ruin plus erfolgreiche Nullwerte: nur positive Werte skalieren die Achse.
const ruinHeavy = result([...Array(998).fill(0), 2000, 8000], [...Array(998).fill(0), 1000, 4000], 980);
const heavyBefore = JSON.stringify(ruinHeavy);
for (const [mode, expectedLimit] of [['nominal', 7850], ['real', 3925]]) {
    const model = buildWealthDistribution(ruinHeavy, null, mode);
    assertEqual(model.limit, expectedLimit, `${mode}: P97,5 der beiden positiven Endwerte, nicht der ruinlastigen Population`);
    assertEqual(model.successfulZeroCount, 18, `${mode}: erfolgreiche Nullwerte bleiben Finanzfälle`);
    assertEqual(model.bins[0].count, 18, `${mode}: erfolgreiche Nullwerte liegen im ersten regulären Bin`);
    assertEqual(model.overflowCount, 1, `${mode}: echter Rest oberhalb der positiven Achsengrenze`);
    assertEqual(model.bins.reduce((n, bin) => n + bin.count, 0) + model.ruinCount + model.overflowCount, 1000, `${mode}: alle Fälle gezählt`);
    assertClose(model.bins.reduce((n, bin) => n + bin.sharePct, 0) + model.ruinSharePct + model.overflowSharePct, 100, 1e-10, `${mode}: gleicher Prozentnenner`);
    const html = renderWealthDistribution(model);
    assert(html.includes('Das 10-%-Perzentil des Endvermögens liegt bei 0 €.'), 'Null-P10 verwendet den beauftragten Alltagssatz');
    assert(html.includes('Rest →') && html.includes('Oberhalb '), 'Echter Rest zeigt Balken und Hinweis');
    assert(html.includes('Perzentile über alle auswertbaren Läufe, einschließlich Ruin.'), 'Lesart nennt die gesamte Finanzpopulation');
    assert(html.includes('Ausgewählte Szenarien mit Jahresprotokoll'), 'Einzelpfade werden in ihre eigene Ansicht verwiesen');
    assert(!html.includes('Index floor') && !html.includes('Beobachtungspopulation'), 'Sichtbare Lesart vermeidet technische Begriffe');
}
assertEqual(JSON.stringify(ruinHeavy), heavyBefore, 'Ruinlastige Anzeige erhält Originalresultate und Satzquantile');
for (const [label, data, limit] of [
    ['alle Ruin', result([0, 0], [0, 0], 2), 1000],
    ['erfolgreiche Nullwerte', result([0, 0]), 1000],
    ['ein positiver Lauf', result([12]), 1000],
    ['ein großer positiver Lauf', result([12000]), 12000],
    ['gleiche Werte', result([2000, 2000]), 2000],
    ['maximal endliche Werte', result([Number.MAX_VALUE, Number.MAX_VALUE]), Number.MAX_VALUE]
]) {
    const model = buildWealthDistribution(data, null, 'nominal');
    const html = renderWealthDistribution(model);
    assertEqual(model.limit, limit, `${label}: endliche Achse mit mindestens 1000 Euro`);
    assertEqual(model.overflowCount, 0, `${label}: kein erfundener Rest`);
    assert(!html.includes('Rest →') && !html.includes('Oberhalb '), `${label}: kein leerer Restbalken oder Resthinweis`);
    assert(html.includes(`Erfolgreiche Nullendwerte: ${model.successfulZeroCount}.`), `${label}: Nullwerthinweis bleibt unabhängig vom Rest sichtbar`);
    assert(!/NaN|Infinity/.test(html), `${label}: ausschließlich endliche Geometrie und Texte`);
    if (model.p10 > 0) assert(html.includes('Mit 90 % Wahrscheinlichkeit bleiben mindestens'), `${label}: positive Mindestbetragsaussage erhalten`);
}

assert(renderWealthDistribution(buildWealthDistribution(results)).includes('width="1400" height="355" viewBox="0 0 1400 355"'), 'Histogramm: SVG-Maße entsprechen nativen Pixelkoordinaten');
