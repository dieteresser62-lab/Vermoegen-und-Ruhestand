import { readLE1References } from './helpers/le-1-expectations.mjs';
import { withPreviousRunEvidence } from './helpers/le-1b-expectations.mjs';
const readQSCReferences = value => readPFA1References(beforePFA1QSCReferences(value));
import { readGU1References } from './helpers/gu-1-expectations.mjs';
import { readPFA1References } from './helpers/pfa-1-expectations.mjs';
const readHE4References = value => readPFA1References(beforePFA1References(value));
import { readEV1bReferences as readBeforeHE2References } from './helpers/ev-1b-expectations.mjs';
import { readHE2References } from './helpers/he-2-expectations.mjs';
import { readHE4References as beforePFA1References } from './helpers/he-4-expectations.mjs';
const readEV1bReferences = value => readHE4References(readHE2References(readBeforeHE2References(value)));
const readMD2References = value => readEV1bReferences(readBeforeEV1bReferences(value));
import { readMD2References as readBeforeEV1bReferences } from './helpers/md-2-expectations.mjs';
import { readZG1References as readBeforeMD2References } from './helpers/zg-1-expectations.mjs';
const readZG1References = value => readMD2References(readBeforeMD2References(value));
import { readEV1References as readBeforeZG1References } from './helpers/ev-1-expectations.mjs';
const readEV1References = value => readZG1References(readBeforeZG1References(value));
import { readQSCReferences as beforePFA1QSCReferences } from './helpers/qs-c-expectations.mjs';
import { readVF2BReferences as readBeforePA1References } from './helpers/vf-2b-expectations.mjs';
import { readPA1References } from './helpers/pa-1-expectations.mjs';
const readVF2BReferences = value => readQSCReferences(readPA1References(readBeforePA1References(value)));
import { readAS1Hash } from './helpers/as-1-expectations.mjs';
import { readEP1Hash } from './helpers/ep-1-expectations.mjs';
import { readRNG1Hash as readBeforeEP1Hash } from './helpers/rng-1-expectations.mjs';
import { readPG1bHash } from './helpers/pg-1b-expectations.mjs';
import { readAN1Hash } from './helpers/an-1-expectations.mjs';
import { readNR1Hash } from './helpers/nr-1-expectations.mjs';
import fs from 'node:fs';
import { buildPlanOverview, resolvePlanOverviewRates } from '../app/simulator/simulator-plan-overview.js';
import { GERMAN_CPI_INFLATION_RATES } from '../app/simulator/german-cpi-chain.js';
import { GERMAN_GROSS_WAGE_GROWTH_PCT } from '../app/simulator/german-gross-wage-growth-chain.js';
import { getProtocolColumns } from '../app/simulator/protocol-columns.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { projectScenarioLogV2, serializeScenarioLogExportV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
import { createHistoricalBacktestDownload, captureHistoricalBacktestEngineProvenance } from '../app/simulator/historical-backtest-export.js';
import { EngineAPI } from '../engine/index.mjs';
import { prepareRowsForExport, buildBacktestColumnDefinitions, formatColumnValue } from '../app/simulator/simulator-main-helpers.js';
import { buildAccessibleBacktestTableHtml } from '../app/simulator/historical-backtest-ui.js';
import { measure, hash } from './helpers/ek-1b-measurement.mjs';
import { canonicalizeHistoricalContractValue } from '../app/simulator/historical-backtest-contract.js';

const readRNG1Hash = before => readQSCReferences(readAS1Hash(readEP1Hash(readBeforeEP1Hash(before))));
const same = (actual, expected, label) => assertEqual(canonicalizeHistoricalContractValue(actual), canonicalizeHistoricalContractValue(expected), label);
const rates = resolvePlanOverviewRates();
for (const [rate, series] of [[rates.inflation, GERMAN_CPI_INFLATION_RATES], [rates.wage, GERMAN_GROSS_WAGE_GROWTH_PCT]]) {
    const expected = Array.from({ length: 25 }, (_, i) => series[2001 + i]).reduce((a, b) => a + b, 0) / 25;
    assertClose(rate.value, expected, 1e-12, 'Fehlender Jahreswert verwendet das arithmetische Mittel 2001–2025');
    assert(rate.origin.includes('2001–2025') && rate.origin.includes('kein eigener Wert'), 'Herkunft nennt Zeitraum und fehlende eigene Eingabe');
}
same([resolvePlanOverviewRates({ inflation: 0, lohnWachstum: '0' }).inflation.value,
    resolvePlanOverviewRates({ inflation: 0, lohnWachstum: '0' }).wage.value], [0, 0], 'Ausdrücklich eingegebene Null bleibt Null');
assertEqual(resolvePlanOverviewRates({ lohnWachstum: '  ' }).wage.value, rates.wage.value, 'Leeres Lohnfeld verwendet das Mittel');
assertEqual(resolvePlanOverviewRates({ inflation: '3.25' }).inflation.value, 3.25, 'Eigener Jahreswert hat Vorrang');
const overview = buildPlanOverview({ inputs: { renteMonatlich: 1600, rentAdjMode: 'wage', renteStartOffsetJahre: 0,
    renteStartMonate: 12, startFloorBedarf: 20000, startFlexBedarf: 8000 }, referenceYear: 2026,
    entries: [{ profileId: 'max', name: 'Max', data: { profile_rente_monatlich: '1600' } }] });
assertClose(overview.rows[1].incomes[0], 19200 * (1 + rates.wage.value / 100), 1e-6, 'Rente wie Löhne wächst ohne eigenen Lohnwert mit dem Mittel');
assertClose(overview.rows[1].needs, 28000 * (1 + rates.inflation.value / 100), 1e-6, 'Bedarf verwendet die Verbraucherpreisreihe');

const fields = ['sonstige_einkuenfte', 'sonstige_einkuenfte_personen', 'einkuenfte_gespart', 'einkuenfte_gespart_personen'];
const raw = { jahr: 1, recordType: 'financial_year', financiallyEvaluable: true, renteSum: 12000, zufluss: 5000,
    geplante_ausgaben: 2500, inflation_factor_cum: 1, inflation: 0, entscheidung: { jahresEntnahme: 0 },
    sonstige_einkuenfte: 48000, sonstige_einkuenfte_personen: [{ profileId: 'erika', amount: 36000 }, { profileId: 'max', amount: 12000 }],
    einkuenfte_gespart: 30000, einkuenfte_gespart_personen: [{ profileId: 'max', amount: 10000 }, { profileId: 'erika', amount: 20000 }] };
const before = JSON.stringify(raw);
const inputs = { partner: { aktiv: true }, simulationPeople: [{ profileId: 'max' }, { profileId: 'erika' }] };
const personDisplayContext = { persons: [{ name: 'Max' }, { name: 'Erika' }] };
for (const source of ['mc', 'backtest']) for (const logDetailLevel of ['normal', 'detailed']) {
    const rows = source === 'mc' ? [raw] : [{ jahr: 2000, row: raw, entscheidung: raw.entscheidung }];
    const options = { source, logDetailLevel, rows, inputs, personDisplayContext };
    const columns = getProtocolColumns(options), ids = columns.map(column => column.id);
    same(columns.filter(column => column.group === 'withdrawal').slice(0, logDetailLevel === 'detailed' ? 11 : 2).map(column => column.id),
        ['income-total', 'expense-total', ...(logDetailLevel === 'detailed' ? ['withdrawal', 'rentesum', 'rente1', 'rente2', 'other-income', 'zufluss', 'planned-expenses', 'income-saved', 'widow-income-offset'] : [])], `${source}/${logDetailLevel}: gewünschte Reihenfolge`);
    const other = columns.find(column => column.id === 'other-income');
    if (logDetailLevel === 'detailed') assertEqual(other.extractor(rows[0]), 48000, `${source}: feste sonstige Einkünfte vollständig`);
    const html = renderProtocolTable(rows, options);
    assert(html.includes('Sonstige Einkünfte') && html.includes('Einmalige Einkünfte'), `${source}: echte Protokollanzeige enthält die neuen Texte`);
    assertEqual(ids.includes('income-saved'), logDetailLevel === 'detailed', 'Angelegter Überschuss nur im Detail');
    const personColumns = columns.filter(column => column.id.startsWith('other-income-person-'));
    assertEqual(personColumns.length, logDetailLevel === 'detailed' ? 2 : 0, 'Sonstige Einkünfte je Person nur im Detail');
    for (const column of personColumns) assertEqual(column.extractor(rows[0]), column.header.includes('Erika') ? 36000 : 12000, 'Personenzuordnung folgt der Profilkennung statt der Arrayposition');
    if (logDetailLevel === 'detailed') assert(html.includes('36.000') && html.includes('12.000'), `${source}: Detailtabelle zeigt beide persönlichen Beträge`);
    if (source === 'backtest') {
        const prepared = buildBacktestColumnDefinitions(logDetailLevel, { ...options, display: true });
        const backtestHtml = buildAccessibleBacktestTableHtml(rows, prepared, formatColumnValue, options);
        assertEqual(backtestHtml.includes('data-protocol-column="income-saved"'), logDetailLevel === 'detailed', 'Backtest zeigt Sparbetrag auch über vorbereitete Anzeigespalten');
        if (logDetailLevel === 'detailed') assert(backtestHtml.includes('36.000') && backtestHtml.includes('12.000'), 'Backtest-Spaltenadapter erhält Personenbeträge');
    }
    if (logDetailLevel === 'detailed') assert(Object.hasOwn(prepareRowsForExport(rows, columns)[0], 'Zufluss'), 'Alter JSON-Schlüssel des Anzeigeexports bleibt bestehen');
    for (const amount of [0, undefined, null]) {
        const empty = { ...raw, sonstige_einkuenfte: amount, einkuenfte_gespart: amount, sonstige_einkuenfte_personen: [] };
        const emptyRows = source === 'mc' ? [empty] : [{ row: empty }];
        const absent = getProtocolColumns({ ...options, rows: emptyRows });
        assertEqual(absent.some(column => column.id === 'other-income'), logDetailLevel === 'detailed', `${source}/${logDetailLevel}: Einzelspalten stehen vollständig im Detail`);
        assertEqual(absent.filter(column => column.id.startsWith('other-income-person-')).length, logDetailLevel === 'detailed' ? 2 : 0, 'Detail enthält auch die Nullwerte je Person');
    }
}
assertEqual(JSON.stringify(raw), before, 'Anzeige und Anzeigeexporte verändern keine Jahreswerte');
const strip = value => Object.fromEntries(Object.entries(value).filter(([key]) => ![...fields, 'einnahmen_gesamt', 'ausgaben_gesamt'].includes(key)));
const oldScenario = projectScenarioLogV2([strip(raw)]), scenario = projectScenarioLogV2([raw]);
const exported = JSON.parse(serializeScenarioLogExportV2(scenario)).records[0];
for (const field of fields) same(exported[field], raw[field], 'Szenario-JSON erhält ' + field);
same(Object.keys(strip(exported)).sort(), Object.keys(strip(oldScenario.records[0])).sort(), 'Vorhandene Szenario-JSON-Schlüssel bleiben unverändert');
same(strip(exported), strip(oldScenario.records[0]), 'Vorhandene Szenario-JSON-Werte bleiben unverändert');
const csvHeads = csv => csv.split(/\r?\n/)[0].split(';');
const mcHeads = csvHeads(serializeScenarioLogCsvV2(scenario));
for (const field of fields) assert(mcHeads.includes(field), 'Szenario-CSV enthält ' + field);
same(mcHeads.filter(key => ![...fields, 'einnahmen_gesamt', 'ausgaben_gesamt'].includes(key)), csvHeads(serializeScenarioLogCsvV2(oldScenario)), 'Vorhandene MC-CSV-Spaltennamen bleiben unverändert');
assert(serializeScenarioLogCsvV2(scenario).includes('36000'), 'CSV enthält die vollständigen Personenbeträge');

const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/pv-1-parity.json', import.meta.url)));
const { inputs: measuredInputs, historical, chunk } = await measure(baseline.salary, baseline.count, { historicalSurvivor: true });
assertEqual(hash(measuredInputs), readLE1References(readGU1References(readQSCReferences(readVF2BReferences(readAN1Hash(baseline.inputsHash))))), 'Messinputs bytegleich zur Basis');
assertEqual(hash(historical), readLE1References(readGU1References(readQSCReferences(readVF2BReferences(readAS1Hash(readAN1Hash(readNR1Hash(baseline.backtestHash))))))), 'Vollständiges Backtestergebnis mit belegten NR-1-Anzeigeänderungen');
assertEqual(hash(withPreviousRunEvidence(chunk)), readLE1References(readGU1References(readEV1References(readQSCReferences(readVF2BReferences(readRNG1Hash(readPG1bHash(readAN1Hash(readNR1Hash(baseline.monteCarloHash))))))))), 'Vollständiger MC-Chunk mit festem Seed und belegten NR-1-Anzeigeänderungen');
const forExport = { ...historical, request: { ...historical.request, engine: captureHistoricalBacktestEngineProvenance(EngineAPI,
    { schemaVersion: 'RuntimeBuildProvenanceV1', sourceCommit: 'a'.repeat(40), sourceTreeStatus: 'clean', provider: 'synthetic_fixture' }) } };
const oldHistorical = { ...forExport, rows: historical.rows.map(entry => ({ ...entry, row: strip(entry.row) })) };
const options = { exportedAt: '2026-10-21T00:00:00.000Z' };
const btJson = JSON.parse(createHistoricalBacktestDownload(forExport, 'json', options).content);
same(btJson.result.rows[0].row.sonstige_einkuenfte_personen, historical.rows[0].row.sonstige_einkuenfte_personen, 'Backtest-JSON erhält die vollständigen Personenbeträge');
const btCsv = createHistoricalBacktestDownload(forExport, 'csv', options).content;
for (const field of fields) assert(csvHeads(btCsv).includes(field), 'Backtest-CSV ergänzt ' + field);
same(csvHeads(btCsv).filter(key => ![...fields, 'einnahmen_gesamt', 'ausgaben_gesamt'].includes(key)), csvHeads(createHistoricalBacktestDownload(oldHistorical, 'csv', options).content), 'Alle alten Backtest-CSV-Spalten bleiben in gleicher Reihenfolge');
same(Object.keys(strip(btJson.result.rows[0].row)).filter(key => !['einnahmen_gesamt', 'ausgaben_gesamt'].includes(key)).sort(), Object.keys(strip(oldHistorical.rows[0].row)).sort(), 'Alle alten Backtest-JSON-Schlüssel bleiben erhalten');
