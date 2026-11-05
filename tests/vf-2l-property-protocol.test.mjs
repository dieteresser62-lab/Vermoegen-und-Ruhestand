import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { homeValueAtDeath } from '../app/simulator/simulator-inheritance.js';
import { getProtocolColumns, readProtocolValue, formatProtocolValue } from '../app/simulator/protocol-columns.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { projectScenarioLogV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
import { serializeHistoricalBacktestCsv } from '../app/simulator/historical-backtest-export.js';
import { prepareRowsForExport } from '../app/simulator/simulator-main-helpers.js';

const parameters = { anzahl: 16, maxDauer: 35, blockSize: 5, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
async function runs(inputs, indices) {
    const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: parameters,
        widowOptions: inputs.widowOptions, useCapeSampling: false,
        runRange: { start: 0, count: Math.max(...indices) + 1 }, logIndices: indices });
    assertEqual(chunk.technicalInventory.technicalError, 0, 'Echte MC-Pfade ohne technischen Fehler');
    return chunk.runMeta.filter(run => run.logDataRows?.length).map(run => run.logDataRows);
}
const renate = await measurementInputs(0, 'renate', '2026-10-23', 'klein');
renate.home = [{ id: 'wohnung', profileId: renate.simulationPeople[0].profileId,
    wert: 180000, nutzung: 'selbst', stand: '2026-10' }];
const [rows] = await runs(renate, [0]);
const saleIndex = rows.findIndex(row => row.immobilien_notverkauf), sale = rows[saleIndex], before = rows[saleIndex - 1];
assert(saleIndex > 0, 'Renate hat vor dem echten Notverkauf bewertete Jahre');
assert(before.immobilien_wert_end > 0, 'Wohnung vor Verkauf vorhanden');
for (const row of rows.slice(saleIndex).filter(row => row.recordType !== 'terminal_death')) assertEqual(row.immobilien_wert_end, 0, 'Ab Verkaufsjahr bleibt die Wohnung verkauft');
assertClose(before.immobilien_wert_end, sale.immobilienverkauf / .9, .01, 'Verkauf nutzt den vorjährigen Endwert, mit 10 % Abschlag');
const total = row => row.portfolio_total_end + row.immobilien_wert_end;
assert(sale.portfolio_total_end > before.portfolio_total_end, 'Geldvermögen steigt durch den Erlös');
assert(total(sale) < total(before), 'Gesamtvermögen springt durch den Verkauf nicht um den Erlös');
assertClose(total(sale) - total(before), sale.portfolio_total_end - before.portfolio_total_end
    - sale.immobilienverkauf / .9, .01, 'Erlös zählt einmal; Wertverlust und Jahresverbrauch bleiben sichtbar');
assertClose(sale.portfolio_flow_delta, 0, .05, 'Echter Verkauf bilanziert unverändert');

for (const source of ['mc', 'backtest']) for (const moneyBasis of ['nominal', 'real']) for (const logDetailLevel of ['normal', 'detailed']) {
    const entry = source === 'mc' ? before : { jahr: 2025 + before.jahr, row: before, inflationVJ: before.inflation };
    const options = { source, moneyBasis, logDetailLevel, inputs: renate, rows: [entry] };
    const columns = getProtocolColumns(options), index = columns.findIndex(column => column.id === 'total');
    assertEqual(columns.slice(index, index + 3).map(column => column.header).join(','), 'Geldvermögen,Immobilien,Gesamtvermögen', 'Drei benachbarte Jahresendbestände in beiden Ansichten');
    assertEqual(columns[index].exportHeader, 'PortEnd', 'Bisheriger Exportkopf bleibt erhalten');
    assertEqual(readProtocolValue(columns[index + 2], entry, options), total(before), 'Gesamtvermögen addiert die ungerundeten Werte');
    for (const [column, value] of [[columns[index], before.portfolio_total_end], [columns[index + 1], before.immobilien_wert_end], [columns[index + 2], total(before)]]) {
        const factor = moneyBasis === 'real' ? before.inflation_factor_cum * (1 + before.inflation / 100) : 1;
        const expected = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value / factor);
        assertEqual(formatProtocolValue(column, value, entry, options), expected, 'Alle Bestände verwenden den Jahresendfaktor');
    }
    const html = renderProtocolTable([entry], options);
    for (const label of ['Geldvermögen', 'Immobilien', 'Gesamtvermögen']) assert(html.includes(`class="ds-info-button ds-button" aria-label="${label}"`), 'Jeder Jahresendbestand hat sein eigenes Infofeld');
    assert(html.includes('data-protocol-column="home-value"') && html.includes('data-protocol-column="total-with-homes"'), 'Renderer übernimmt beide neuen Spalten');
    assertEqual(prepareRowsForExport([entry], columns)[0].PortEnd, columns[index].valueFormatter(before.portfolio_total_end, entry), 'Anzeigeexport erhält PortEnd');
}
const csv = serializeScenarioLogCsvV2(projectScenarioLogV2(rows));
assert(csv.split('\r\n')[0].endsWith(';Immobilien;Gesamtvermögen'), 'MC-CSV hängt eigene Köpfe an');
assertEqual(projectScenarioLogV2(rows).records[saleIndex].immobilien_wert_end, 0, 'MC-JSON erhält den Anzeigewert');

// Beide Eigentümer sterben in den echten Pfaden 0 und 7 zuerst; die Quote gilt ab Erbjahr.
const pair = await measurementInputs(0, 'martin-petra', '2026-10-23', 'ehe');
for (const person of pair.simulationPeople) pair.partnership.marriedInheritance[person.profileId] = 50;
const pairRows = await runs(pair, [0, 7]);
const deceased = new Set();
for (const path of pairRows) {
    const estate = path.find(row => row.inheritance);
    assert(estate, 'Echter Paarpfad enthält ein Erbjahr');
    deceased.add(estate.inheritance.deceasedProfileId);
    let factor = 1;
    for (const row of path) {
        if (row.recordType === 'terminal_death') { assertEqual(row.immobilien_wert_end, undefined, 'Nach dem Tod beider Personen bleiben alle drei Endbestandsspalten leer'); continue; }
        factor *= 1 + row.inflation / 100;
        const expected = pair.home.reduce((sum, home) => sum + homeValueAtDeath(home, pair, factor)
            * (row.jahr >= estate.jahr && home.profileId === estate.inheritance.deceasedProfileId ? .5 : 1), 0);
        assertClose(row.immobilien_wert_end, expected, .001, 'Werte beider Personen vor/nach 50-%-Erbe mit Jahresend-Inflation');
    }
}
assertEqual(deceased.size, 2, 'Beide Todesreihenfolgen aus echten MC-Läufen geprüft');

// Drei Wohnungen: FR-61 verkauft sie in getrennten Jahren einzeln bis zur Deckung.
const multiple = { ...renate, home: [1, 2, 3].map(id => ({ ...renate.home[0], id: `wohnung-${id}`, wert: 30000, nutzung: 'vermietet' })) };
const [multipleRows] = await runs(multiple, [0]);
let held = 3, factor = 1, saleYears = 0;
for (const row of multipleRows) {
    if (row.recordType === 'terminal_death') continue;
    factor *= 1 + row.inflation / 100;
    if (row.immobilienverkauf) { held -= row.immobilienverkauf_personen.length; saleYears++; }
    assertClose(row.immobilien_wert_end, held * 30000 * factor, .001, 'Jeder Einzelverkauf entfernt genau die verkaufte Immobilie');
}
assert(saleYears >= 2, 'Echter Pfad verkauft mehrere Immobilien nacheinander');

const historical = backtest(renate);
assert(historical.rows.length > 1, 'Echter Backtest enthält Jahreszeilen');
let historicalFactor = 1;
for (const entry of historical.rows) {
    historicalFactor *= 1 + entry.inflationVJ / 100;
    if (entry.row.immobilienverkauf || historical.rows.some(previous => previous.jahr < entry.jahr && previous.row.immobilienverkauf)) continue;
    assertClose(entry.row.immobilien_wert_end, 180000 * historicalFactor, .001, 'Backtest übernimmt bewerteten Jahresendbestand');
}
assert(serializeHistoricalBacktestCsv(historical).split('\n')[0].endsWith(';Immobilien;Gesamtvermögen'), 'Echter Backtest-CSV hängt beide Köpfe an');
const empty = await measurementInputs(0, 'renate', '2026-10-23', 'klein');
const [emptyRows] = await runs(empty, [0]);
for (const source of ['mc', 'backtest']) for (const logDetailLevel of ['normal', 'detailed']) {
    const data = source === 'mc' ? emptyRows : backtest(empty).rows;
    const html = renderProtocolTable(data, { source, logDetailLevel, inputs: empty });
    assert(html.includes('Geldvermögen'), 'Ohne Immobilie heißt der bisherige Bestand Geldvermögen');
    assert(!html.includes('data-protocol-column="home-value"') && !html.includes('data-protocol-column="total-with-homes"'), 'Ohne Immobilie keine leeren Spalten');
}
assert(!serializeScenarioLogCsvV2(projectScenarioLogV2(emptyRows)).split('\r\n')[0].includes('Immobilien'), 'MC ohne Immobilie erhält keine neuen Exportköpfe');
assert(!serializeHistoricalBacktestCsv(backtest(empty)).split('\n')[0].includes('Immobilien'), 'Backtest ohne Immobilie erhält keine neuen Exportköpfe');

// Echte Jahresrechnung für Pflegeverkauf, alte Wertstände und Ansparen.
const calm = { jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 2 };
const nursing = simulateOneYear(initMcRunState(renate), renate, calm, 0, null, 0,
    { p1Alive: true, p2Alive: false, care: { p1: { active: true, grade: 4 } } }, 1, EngineAPI);
assert(nursing.logData.immobilienverkauf > 0 && !nursing.logData.immobilien_notverkauf, 'Echter Pflegeverkauf nach FR-53');
assertEqual(nursing.logData.immobilien_wert_end, 0, 'Auch im Pflegeverkaufsjahr kein Immobilienbestand');
const saving = await measurementInputs(0, 'sophie', '2026-10-23');
saving.home = [{ ...renate.home[0], profileId: saving.simulationPeople[0].profileId, stand: '2024-03' }];
const accumulated = simulateOneYear(initMcRunState(saving), saving, calm, 0, null, 0, null, 1, EngineAPI);
assertEqual(accumulated.kind, 'success', 'Ansparjahr bleibt berechenbar');
assertClose(accumulated.logData.immobilien_wert_end, homeValueAtDeath(saving.home[0], saving, 1.02), .001, 'Ansparjahr bewertet ab älterem Stand bis Jahresende');
