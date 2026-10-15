import { buildComparisonContext, scenarioComparisonMetrics, renderScenarioComparison, COMPARISON_DEFAULT, comparisonEntries } from '../app/simulator/scenario-comparison.js';
import { buildScenarioEntries, renderScenarioWealthChart } from '../app/simulator/scenario-wealth-chart.js';
import { buildMinimumFlexRestriction, deriveMinimumFlexPath } from '../app/simulator/minimum-flex-metrics.js';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';

const financial = (jahr, ratio = 0) => ({ jahr, recordType: 'financial_year', financiallyEvaluable: true,
    NominalReturnEquityPct: ratio, portfolio_total_end: 100, inflation: 2, inflation_factor_cum: 1,
    minimumFlexAnnual: 20, flex_haushalt_erfuellt: 20, flex_wunsch_haushalt_nominal: 40 });
const rows = [financial(1, -.5), financial(2, 1), financial(3, .1), financial(4, -.2), financial(5, .25)];
const scenario = { key: 'p10', label: '<Pfad>', sourceIdentity: { absoluteRunIndex: 22, displayRunNumber: 23 },
    endVermoegen: 123456, failed: false, logDataRows: rows };
const before = JSON.stringify(scenario);
const metrics = scenarioComparisonMetrics(scenario);
assertClose(metrics.firstFiveReturnPct, 10, 1e-10, 'Fünf Rendite-Ratios verketten sich zu +10 Prozent; keine Summe und keine Prozentdivision');
assertEqual(metrics.withdrawalYears, 5, 'Abgeschlossene Entnahmejahre zählen');
assertEqual(metrics.runNumber, 23, 'Pfadnummer aus der Quellidentität');
assertEqual(metrics.endNominal, 123456, 'Nominaler Endwert unverändert');
for (const type of ['terminal_death', 'terminal_ruin', 'technical_error']) {
    const terminal = { ...scenario, logDataRows: [...rows, { ...financial(6, 999), recordType: type }, financial(7)] };
    assertEqual(scenarioComparisonMetrics(terminal).withdrawalYears, 5, type + ': Terminal- und Schattenjahre entfallen');
    assertClose(scenarioComparisonMetrics(terminal).firstFiveReturnPct, 10, 1e-10, type + ': keine künstliche Rendite');
}
for (const logDataRows of [rows.slice(0, 4), rows.map((row, index) => index === 1 ? { ...row, NominalReturnEquityPct: null } : row),
    rows.map((row, index) => index === 1 ? { ...row, jahr: 7 } : row), rows.map(row => ({ ...row, NominalReturnEquityPct: -.999 - .01 })),
    rows.map((row, index) => index === 2 ? { ...row, recordType: 'terminal_death' } : row)]) {
    assertEqual(scenarioComparisonMetrics({ ...scenario, logDataRows }).firstFiveReturnPct, null, 'Unvollständige oder ungültige erste fünf Jahre bleiben unbekannt');
}
assertEqual(scenarioComparisonMetrics({ ...scenario, logDataRows: rows.map(row => ({ ...row, NominalReturnEquityPct: 0 })) }).firstFiveReturnPct, 0, 'Nullrendite ist bekannt');
assertEqual(scenarioComparisonMetrics({ ...scenario, logDataRows: rows.map(row => ({ ...row, NominalReturnEquityPct: -1 })) }).firstFiveReturnPct, -100, 'Totalverlust ist gültig');
assertEqual(scenarioComparisonMetrics(null).withdrawalYears, null, 'Kein Log erfindet keine Entnahmejahre');
assertEqual(scenarioComparisonMetrics({ logDataRows: [{ jahr: 1, recordType: 'terminal_death' }] }).withdrawalYears, 0, 'Tod vor erster Entnahme: null Entnahmejahre');
assertEqual(scenarioComparisonMetrics({ ...scenario, sourceIdentity: null }).runNumber, null, 'Quellidentität wird nicht aus Name oder Rang geraten');
assertEqual(JSON.stringify(scenario), before, 'Kennzahlen lesen den Pfad ohne Mutation');

const path = deriveMinimumFlexPath(rows);
const affected = deriveMinimumFlexPath(rows.map((row, index) => ({ ...row, flex_haushalt_erfuellt: index === 0 ? 19 : 20 })));
const restriction = buildMinimumFlexRestriction([path, affected], 20);
const results = { minimumFlexRestriction: restriction, outcomeInventory: { schemaVersion: 'MonteCarloOutcomeInventoryV1', requestedRuns: 2,
    ruin: 0, floorCoveredCount: 2, floorCoverageMissingnessReason: null, technical_error: 0 } };
const context = buildComparisonContext({ results, totalRuns: 999, failCount: 99,
    inputs: { ...dynamicFlexPresetPatch('ausgewogen'), pflegefallLogikAktivieren: false } });
assertEqual(context.sourceLine, '2 Pfade · Ausgewogen', 'Herkunft aus Laufaggregat und Laufinputs ohne feste Geldbasis');
assertEqual(context.chips[0].text, 'Grundbedarf in allen 2 Pfaden gedeckt', 'Inventar hat Vorrang vor Legacyzählern');
assertEqual(context.chips[1].text, '1 von 2 Pfaden zeitweise unter Mindest-Flex', 'FR-6-Aggregat zählt Pfade; Gleichheit zählt nicht als Unterschreitung');
assertEqual(context.chips[2].text, 'Pflege nicht simuliert', 'Pflegeannahme aus Laufinputs');
assert(buildComparisonContext({ results: { ...results, outcomeInventory: { ...results.outcomeInventory, ruin: 1, floorCoveredCount: 1 } } }).chips[0].text.includes('Ruin in 1 von 2 Pfaden'), 'Ruinanteil nennt Zähler und Nenner');
const missing = buildComparisonContext();
assert(missing.chips.every(chip => chip.text.includes('unbekannt')), 'Fehlende Aggregate und Pflegeannahme bleiben unbekannt');
assert(missing.sourceLine.includes('Voreinstellung unbekannt'), 'Kein aktuelles Formular ersetzt die Voreinstellung des Laufs');
const technical = buildComparisonContext({ results: { ...results, financialMetricsValid: false } });
assert(technical.chips.slice(0, 2).every(chip => chip.text.includes('unbekannt')), 'Technische Fehler werden nicht als erfolgreiche oder ruinierte Pfade umgedeutet');
const partial = buildMinimumFlexRestriction([path, affected, { ...path, missingReason: 'no_observations' }], 20);
assert(buildComparisonContext({ results: { minimumFlexRestriction: partial }, totalRuns: 3, failCount: 0 }).chips[1].text.includes('1 von 2 auswertbaren Pfaden zeitweise unter Mindest-Flex · 1 unbekannt'), 'Teilpopulation nennt ihren eigenen Nenner und unbekannte Pfade');
const zero = buildMinimumFlexRestriction([deriveMinimumFlexPath(rows.map(row => ({ ...row, minimumFlexAnnual: 0 })))], 0);
assert(buildComparisonContext({ results: { minimumFlexRestriction: zero }, totalRuns: 1, failCount: 0 }).chips[1].text.startsWith('0 von 1'), 'Minimum null Euro erzeugt keine Unterschreitung');
assertEqual(buildComparisonContext({ inputs: { pflegefallLogikAktivieren: true } }).chips[2].text, 'Pflege simuliert', 'Simulation von Pflege unabhängig von beobachtetem Pflegeeintritt');

const logs = { characteristic: ['worst', 'p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'best', 'worstCare', 'longestCare', 'highestCareNeed', 'earliestCareP1', 'earliestCareP2', 'longestLife', 'maxCut'].map(key => ({ ...scenario, key, label: key })), random: [{ ...scenario, key: 'sample' }] };
const entries = buildScenarioEntries(logs);
const html = renderScenarioComparison(entries, COMPARISON_DEFAULT, { context });
assertEqual(comparisonEntries(entries).length, 16, 'Alle vorhandenen charakteristischen Pfade einschließlich fünf Pflegefälle auswählbar');
assertEqual((html.match(/<select /g) || []).length, 3, 'Drei echte native Auswahlen');
assertEqual((html.match(/<option /g) || []).length, 48, 'Jede Spalte enthält alle vorhandenen charakteristischen Pfade');
assert(!html.includes('rand_sample'), 'Stichproben sind keine charakteristischen Pfade');
assertEqual((html.match(/ selected>/g) || []).length, 3, 'P10, Median, P90 sind voreingestellt');
assertEqual((html.match(/Gleicher Quellpfad wie Spalte/g) || []).length, 3, 'Identische Quellpfade werden sichtbar bezeichnet');
assert(html.includes('Was hier auffällt →') && html.includes('Die Pfade enden zu verschiedenen Zeitpunkten.'), 'Links und Einordnung wie im Entwurf');
assert(html.includes('ds-info-button') && html.includes('keine Ursachen'), 'Erläuterung und Grenze des Vergleichs sichtbar erreichbar');
assertEqual((renderScenarioComparison([], COMPARISON_DEFAULT).match(/Pfad nicht vorhanden/g) || []).length, 3, 'Fehlende Auswahl erhält keinen Ersatzpfad');
const dangerous = renderScenarioComparison(buildScenarioEntries({ characteristic: [{ ...scenario, key: 'care', label: '<img src=x onerror=alert(1)>' }] }), ['char_care', 'char_care', 'char_care']);
assert(dangerous.includes('&lt;img') && !dangerous.includes('<img'), 'Pfadnamen bleiben Text');
const comparisonChart = renderScenarioWealthChart(entries.slice(0, 3), { comparison: true, mode: 'nominal' });
assertEqual((comparisonChart.match(/class="scenario-line /g) || []).length, 3, 'Vergleich zeigt genau die drei gewählten Linien');
assert(comparisonChart.includes('scenarioWealthTitleComparison') && comparisonChart.includes('Vermögen der drei Pfade'), 'Zweite Grafik hat eigene Titelkennungen');
assert(!comparisonChart.includes('scenario-outliers') && !/NaN|Infinity/.test(comparisonChart), 'Vergleich umfasst ganze Pfade im eigenen Maßstab ohne ungültige Koordinaten');
