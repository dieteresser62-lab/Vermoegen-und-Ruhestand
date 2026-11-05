import { measurementInputs, backtest, hash } from './helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../engine/index.mjs';
import { buildScenarioWealthPath } from '../app/simulator/scenario-wealth-chart.js';
import { createHomeWealthFan, commitHomeWealthFan, mergeHomeWealthFan, homeWealthFanModel } from '../app/simulator/wealth-home-fan.js';
import { createWealthFanPath, recordWealthFanYear } from '../app/simulator/wealth-fan-aggregation.js';
import { buildWealthDistribution } from '../app/simulator/wealth-distribution.js';
import { testamentFields } from '../app/tranches/tranchen-manager-testament.js';
import { renderHistorySparkline } from '../app/tranches/tranchen-history-svg.js';
import { lastWealthRow, rowWealthParts, rowWealthText } from '../app/simulator/wealth-display.js';
import { projectBacktestEuroMetrics } from '../app/simulator/backtest-euro-display.js';
import { projectBacktestOverview } from '../app/simulator/simulator-result-overview.js';
import { renderProtocolSummary } from '../app/simulator/protocol-renderer.js';
import { buildTranchenStatsHtml } from '../app/tranches/tranchen-manager-renderer.js';
import { wealthAllocationText } from '../app/shared/wealth-display.js';

const scenario = { logDataRows: [
    { jahr: 1, portfolio_total_end: 100, immobilien_wert_end: 200, inflation_factor_cum: 1, inflation: 0 },
    { jahr: 2, portfolio_total_end: 270, immobilien_wert_end: 0, inflation_factor_cum: 1, inflation: 0 }
] };
const path = buildScenarioWealthPath(scenario, { mode: 'nominal', initialWealth: 120, initialHomes: 200, displayHomes: true });
assertEqual(JSON.stringify(path.points.map(p => p.value)), '[320,300,270]', 'Verkaufserlös wird im Geld berücksichtigt, nicht nochmals als Immobilie addiert');
assertEqual(JSON.stringify(path.points.map(p => p.money)), '[120,100,270]', 'Geldanteil bleibt für den Tooltip verfügbar');
const spark = renderHistorySparkline([{ day: 1, total: 100, totalWithHomes: 300, property: { total: 200 } },
    { day: 2, total: 120, totalWithHomes: 320, property: { total: 200 } }]);
assert(spark.includes('history-property-area') && spark.includes('Gestapeltes Gesamtvermögen'), 'Auch Mini-Verläufe zeigen Geld- und Immobilienanteil gestapelt');
assert(!testamentFields('a', 1, {}, true).includes('Neue Angaben ersetzen für diese Person die Sonderregel'), 'Gesperrter Bedienweg verspricht keinen konkurrierenden Übergang');
assert(testamentFields('a', 1, {}, true).includes(' disabled>') && testamentFields('a', 1, {}, true).includes('Deine Angaben bleiben gespeichert und gelten nach dem Ausschalten wieder'), 'Testamentfeldgruppe gesperrt mit Grund und erhaltenen Angaben');

const money = createWealthFanPath(2, 120);
recordWealthFanYear(money, 1, 100, 100);
recordWealthFanYear(money, 2, 270, 270);
const homes = { nominal: new Float64Array([200, 200, 0]), real: new Float64Array([200, 200, 0]),
    selfNominal: new Float64Array([120, 120, 0]), selfReal: new Float64Array([120, 120, 0]) };
const fan = createHomeWealthFan(2);
commitHomeWealthFan(fan, money, homes);
const model = homeWealthFanModel(fan, 'nominal');
assert(model.available && model.years[1].quantiles[50].value > 298 && model.years[1].quantiles[50].value < 302, 'Gesamtfächer klassiert die Summe je Pfad');
assertClose(model.years[1].quantiles[50].money, model.years[1].quantiles[50].value / 3, .001, 'Aufteilung liest dieselbe Gesamtvermögensklasse');
assertClose(model.years[1].quantiles[50].homeSelf, model.years[1].quantiles[50].value * .4, .001, 'Selbstnutzung und Mietwohnung stammen aus derselben Klasse und ergeben zusammen den Immobilienanteil');
assert(model.hasHomeSelf && model.hasHomeRented, 'Beide Immobilienfarben erhalten belegte Legenden');
assertClose(model.years[2].quantiles[50].money, model.years[2].quantiles[50].value, .001, 'Nach Verkauf endet der Immobilienanteil auch bei Klassenschätzung vollständig');
const merged = mergeHomeWealthFan(null, fan);
assertEqual(JSON.stringify(merged), JSON.stringify(fan), 'Worker-Merge bewahrt Klassen und Geldanteile');
const ruinedMoney = createWealthFanPath(2, 100);
recordWealthFanYear(ruinedMoney, 1, 0, 0, true);
recordWealthFanYear(ruinedMoney, 2, 0, 0, true);
const retained = createHomeWealthFan(2);
commitHomeWealthFan(retained, ruinedMoney, { nominal: new Float64Array([200, 210, NaN]), real: new Float64Array([200, 200, NaN]) });
const retainedModel = homeWealthFanModel(retained, 'nominal');
assert(retainedModel.years[1].quantiles[50].value > 208 && retainedModel.years[1].quantiles[50].money === 0, 'Geldruin entfernt einen weiter gehaltenen Immobilienbestand nicht aus dem Gesamtfächer');
assertEqual(retainedModel.years[2].quantiles[50].value, retainedModel.years[1].quantiles[50].value, 'Nach Ruin bleibt der letzte beobachtete Immobilienwert ohne weitere Finanzjahre stehen');

const distribution = buildWealthDistribution({ finalOutcomes: { distribution: { values: [0, 10], sampleSize: 2 } },
    outcomeCounts: { ruin: 1 }, displayWealth: { nominal: { values: [50, 210], moneyValues: [0, 10], ruinFlags: [true, false] } } }, null, 'nominal');
assert(distribution.available && distribution.p50 === 130, 'Endverteilung verwendet Gesamtvermögen auch bei erschöpftem Geldvermögen');
assert(distribution.marks[4].money === 5 && distribution.ruinCount === 1, 'Tooltip und Ruin behalten ihre jeweilige Geldbasis');

const inputs = await measurementInputs(0, 'max-erika', '2026-10-23', 'immobilien');
const historical = backtest(inputs), original = hash(historical);
const lastEntry = historical.rows.at(-1), last = lastWealthRow(historical.rows);
assert(!Number.isFinite(lastEntry.row.inflation) && Number.isFinite(lastEntry.inflationVJ), 'Echter Backtest hält Inflation am Eintrag statt an der Finanzzeile');
const factor = lastEntry.row.inflation_factor_cum * (1 + lastEntry.inflationVJ / 100);
const realHomes = rowWealthParts(last, 'real');
assertClose(realHomes.total, lastEntry.row.immobilien_wert_end / factor, .001, 'Reale Immobilien nutzen den vollständigen Jahresendfaktor des Backtests');
assertClose(realHomes.self + realHomes.rented, realHomes.total, .001, 'Immobilienarten ergeben auch real den vollständigen Immobilienwert');
assertClose(projectBacktestOverview(historical, 'real').endWealth, projectBacktestEuroMetrics(historical).real.wealth_end_nominal_eur, .001, 'Ergebniskarte und Backtestkennzahl verwenden dieselbe reale Geldbasis');
const protocol = renderProtocolSummary(historical.rows, { source: 'backtest', moneyBasis: 'real' });
assert(protocol.includes('Gesamtvermögen · real') && !protocol.includes('Immobilien —') && realHomes.total > 0, 'Realer Protokollkopf enthält den Immobilienwert');
assert(rowWealthText(last, 'real').includes('Immobilien selbst genutzt') && rowWealthText(last, 'real').includes('Immobilien vermietet'), 'Reale Aufschlüsselung enthält beide Immobilienarten');
assertEqual(hash(historical), original, 'Sämtliche Anzeigeprojektionen erhalten vollständige Backtestbytes');
const mixedStats = buildTranchenStatsHtml([
    { type: 'aktien_neu', marketValue: 100, costBasis: 90 }, { type: 'geldmarkt', marketValue: 20, costBasis: 20 },
    { type: 'gold', marketValue: 30, costBasis: 25 }, { type: 'anleihe', marketValue: 40, costBasis: 35 }
], { cash: 10, immobilien: [{ nutzung: 'selbst', wert: 200 }] });
assert(mixedStats.includes('400\u00a0€') && mixedStats.indexOf('>Depot</div>') < mixedStats.indexOf('>Depotwert<')
    && mixedStats.indexOf('>Anleihen<') < mixedStats.indexOf('>Depot</div>') && !mixedStats.includes('im Depot enthalten'), 'Additive Bestände ergeben 400 Euro; Depotwert steht gesondert mit den Kennzahlen');
assert(wealthAllocationText({ cash: 100 }, { self: 100, rented: 200 }).includes('Immobilien vermietet 200\u00a0€ (50,0\u00a0%)'), 'Aufteilungsanteile werden als Prozent statt als Hundertstelprozent angezeigt');
const options = { inputs, engine: EngineAPI, monteCarloParams: { anzahl: 8, maxDauer: 4, blockSize: 5, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' },
    widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start: 0, count: 8 } };
const before = await runMonteCarloChunk(options), after = await runMonteCarloChunk({ ...options, collectWealthFan: true });
const financial = value => JSON.stringify(value, (key, item) => key === 'wealthFan' || key.includes('displayHomeValue') ? undefined : item);
assertEqual(financial(after), financial(before), 'Zusätzlicher Gesamtfächer verändert keinerlei Finanz-, Zufalls- oder Protokollbytes');
assert(after.displayHomeValueFan?.fan.validRuns === 8, 'Gesamtfächer erfasst alle auswertbaren Pfade');
