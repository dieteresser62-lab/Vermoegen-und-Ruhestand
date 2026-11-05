import { renderManagerPartnership } from '../app/tranches/tranchen-manager-partnership.js';
import { projectManagerProfiles } from '../app/tranches/tranchen-manager-profiles.js';
import { testamentFields } from '../app/tranches/tranchen-manager-testament.js';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { buildMonteCarloAggregates } from '../app/simulator/monte-carlo-aggregates.js';
import { createMonteCarloChunkAccumulatorV1, mergeMonteCarloChunkResultV1, finalizeMonteCarloChunkAccumulatorV1 } from '../app/simulator/monte-carlo-chunk-result.js';
import { EngineAPI } from '../engine/index.mjs';
import { quantile } from '../app/simulator/simulator-utils.js';
import { lastWealthRow, rowEndFactor, rowAllocation } from '../app/simulator/wealth-display.js';
import { buildSummaryData } from '../app/simulator/results-metrics.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { projectOverview } from '../app/overview/overview-model.js';
import { renderOverview } from '../app/overview/overview-renderer.js';
import { withPropertyHistory } from '../app/shared/wealth-display.js';
import { readPartnership } from '../app/profile/household-partnership.js';
import { renderWealthHistorySvg } from '../app/tranches/tranchen-history-svg.js';

const params = { anzahl: 128, maxDauer: 35, blockSize: 5, seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const inputs = await measurementInputs(0, 'max-erika', '2026-10-23', 'immobilien');
async function run(current, start = 0, count = 128) {
    const chunk = await runMonteCarloChunk({ inputs: current, engine: EngineAPI, monteCarloParams: params,
        widowOptions: current.widowOptions, useCapeSampling: false, runRange: { start, count }, logIndices: Array.from({ length: count }, (_, i) => start + i) });
    assertEqual(chunk.technicalInventory.technicalError, 0, 'Echte Läufe ohne technischen Fehler');
    return chunk;
}
function aggregate(chunk, current) {
    return buildMonteCarloAggregates({ buffers: chunk.buffers, totalRuns: chunk.runRange?.count ?? chunk.totalRuns,
        failCount: chunk.totals.failCount, totals: chunk.totals, lists: chunk.lists,
        heatmap: chunk.heatmap, bins: chunk.bins, pathSummaries: chunk.pathSummaries, pathMissingness: chunk.pathMissingness, inputs: current });
}
const chunk = await run(inputs), results = aggregate(chunk, inputs);
for (const mode of ['nominal', 'real']) {
    const expected = chunk.runMeta.map(run => {
        const row = lastWealthRow(run.logDataRows), divisor = mode === 'real' ? rowEndFactor(row) : 1;
        return (run.endVermoegen + row.immobilien_wert_end) / divisor;
    });
    for (const [key, q] of [['p10', .1], ['p50', .5], ['p90', .9]]) {
        assertClose(results.displayWealth[mode][key], quantile(expected, q), .001, `${mode} ${key}: Gesamtvermögens-Perzentil aus sämtlichen echten Läufen`);
    }
    const cards = buildSummaryData({ results, totalRuns: 128, failCount: chunk.totals.failCount, moneyBasis: mode });
    assert(cards[2].moneyDetail.includes('davon Geldvermögen') && cards[2].description.includes('Summe der Klassen-Perzentile'), 'Kennzahlen erklären Geldanteil und fehlende eindeutige Klassenaufteilung');
}
// Eine reale Verkaufsgegenprobe bei denselben Personen mit kleinem Geldpolster.
const scarce = structuredClone(inputs);

// Die Eingabeportfolios liegen je nach Strategie in eigenen Feldern; hoher Grundbedarf
// erzwingt hier die bestehende Notverkaufsregel ohne einen Eingabevertrag umzubauen.
scarce.startFloorBedarf = 250000;
const sold = await run(scarce), soldResults = aggregate(sold, scarce);
assert(sold.runMeta.some(run => run.logDataRows.some(row => row.immobilienverkauf)), 'Max/Erika: echte Pfade verkaufen Immobilien');
assert(sold.runMeta.some(run => lastWealthRow(run.logDataRows).immobilien_wert_end > 0), 'Gegenprobe enthält auch noch gehaltene Immobilien');
for (const [key, q] of [['p10', .1], ['p50', .5], ['p90', .9]]) {
    const values = sold.runMeta.map(run => { const row = lastWealthRow(run.logDataRows); return run.endVermoegen / rowEndFactor(row) + row.immobilien_wert_end / rowEndFactor(row); });
    assertClose(soldResults.displayWealth.real[key], quantile(values, q), .001, `Verkaufsgegenprobe ${key}: Perzentil aus allen Gesamtsummen`);
}
const moneyValues = Array.from(sold.pathSummaries.finalValueRealEur);
assert(['p10', 'p50', 'p90'].some((key, index) => Math.abs(soldResults.displayWealth.real[key] - (quantile(moneyValues, [.1, .5, .9][index]) + 660000)) > 1), 'Gegenprobe: Gesamtperzentile sind nicht Geldperzentile plus Hauswert');
const acc = createMonteCarloChunkAccumulatorV1(128);
mergeMonteCarloChunkResultV1(acc, await run(inputs, 64, 64));
mergeMonteCarloChunkResultV1(acc, await run(inputs, 0, 64));
const merged = aggregate(finalizeMonteCarloChunkAccumulatorV1(acc), inputs);
assertEqual(JSON.stringify(merged.displayWealth), JSON.stringify(results.displayWealth), 'Worker-Transport/Merge liefert dieselben Gesamtsummen und Perzentile');
const withoutInputs = await measurementInputs(0, 'max-erika', '2026-10-23');
const without = await run(withoutInputs);
assertEqual(aggregate(without, withoutInputs).displayWealth, undefined, 'Ohne Immobilien bleibt die bestehende Ergebnisanzeige erhalten');
assertEqual(without.pathSummaries.displayHomeValueRealEur, undefined, 'Ohne Immobilien bleiben die vollständigen MC-Bytes unverändert');
for (const variant of ['grund', 'immobilien']) {
    const records = createMusterHaushaltRecords('2026-10-23', 'max-erika', variant);
    const model = projectOverview({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile, liveData: records, now: new Date(2026, 9, 23, 12) });
    const nodes = new Map(), doc = { getElementById(id) { if (!['overviewAssets', 'overviewAssetHelp', 'overviewImmobilien', 'overviewPeople'].includes(id)) return null; if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '', dataset: {}, addEventListener() {}, setAttribute() {}, querySelectorAll() { return []; } }); return nodes.get(id); }, addEventListener() {}, querySelectorAll() { return []; } };
    const before = JSON.stringify(model);
    renderOverview(doc, model);
    const total = variant === 'immobilien' ? 660000 : 0;
    assertEqual(Number(doc.getElementById('overviewAssets').textContent.replaceAll('.', '')), Math.round(model.household.assets + total), `${variant}: große Übersichtszahl enthält eigene Immobilienanteile`);
    assertEqual(doc.getElementById('overviewImmobilien').hidden, variant === 'grund', `${variant}: davon-Zeile nur mit Immobilien`);
    assertEqual(doc.getElementById('overviewAssetHelp').innerHTML.includes('Immobilien sind nicht verplant'), variant === 'immobilien', 'Haushaltsinfo erklärt nur vorhandene Immobilien; Aufteilung steht beim Balken');
    assert(doc.getElementById('overviewPeople').innerHTML.includes('ds-wealth-allocation'), 'Personenkarten zeigen die Aufteilung als Liste');
    assertEqual(JSON.stringify(model), before, 'Rendering verändert Modell und Rechengeld nicht');
}
const history = { points: [{ day: 1, date: '2026-09-30', total: 100, allocation: { cash: 100 } }, { day: 2, date: '2026-10-01', total: 110, allocation: { cash: 110 } }], metrics: { change: 10 }, types: ['cash'], events: [], gaps: [], range: { start: 1, end: 2 } };
const annotated = withPropertyHistory(history, [{ values: { immobilien: [{ wert: 600000, nutzung: 'selbst', stand: '2026-10' }] } }]);
assertEqual(annotated.points[0].totalWithHomes, 600100, 'Immobilie erscheint über den ganzen Zeitraum mit heutigem Wert');
assertEqual(annotated.end.totalWithHomes, 600110, 'Gesamtlinie ergänzt konstant den heutigen Immobilienwert');
assertEqual(annotated.metrics, history.metrics, 'Veränderung bleibt Geldvermögen; Anzeigeprojektion ergänzt Immobilien');
assert(renderWealthHistorySvg(annotated).includes('history-property-total'), 'Zusätzliche dünne Gesamtvermögenslinie wird gezeichnet');
assertEqual(JSON.stringify(readPartnership({ schemaVersion: 1, status: 'married', inheritance: {}, testament: { a: {} } })), JSON.stringify(readPartnership({ schemaVersion: 1, status: 'married', inheritance: {} })), 'Leere Testamentregel wird wie fehlende Regel gelesen und nicht gespeichert');

await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
const estateRecords = createMusterHaushaltRecords('2026-10-23', 'martin-petra', 'testament');
const estateProjection = projectManagerProfiles(JSON.parse(estateRecords.rs_profiles_v1), estateRecords.rs_current_profile);
estateProjection.profiles.find(person => person.id === 'muster_petra').values.alter = null;
estateProjection.profiles.find(person => person.id === 'muster_petra').values.geburtsdatum = '';
const estateNodes = new Map(), estateDoc = { addEventListener() {}, querySelectorAll() { return []; },
    getElementById(id) { if (!estateNodes.has(id)) estateNodes.set(id, { hidden: false, innerHTML: '', textContent: '', querySelectorAll() { return []; } }); return estateNodes.get(id); } };
renderManagerPartnership(estateDoc, estateProjection);
assert(estateDoc.getElementById('managerInheritance').innerHTML.includes('Für das Wohnrecht fehlt das Alter von Petra'), 'Fehlendes Alter: Feldhinweis statt Absturz der Testamentkarte');
assert(testamentFields('a', 0, { minimum: 200000 }).includes('value="200.000"'), 'Mindestbetrag zeigt Tausenderpunkte');
assert(testamentFields('a', 0, {}).includes('data-testament="minimumStand" style="text-align:right" disabled'), 'Ohne Mindestbetrag ist der rechtsbündige Stand deaktiviert');
