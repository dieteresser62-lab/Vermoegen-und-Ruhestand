// JD-1 Punkt 8 „Jahresneutralität“: Ein erfundenes Datenjahr 2026 wird im Speicher an alle sechs Ketten gehängt und der
// Datenstand im Speicher neu erzeugt. Ohne Codeänderung müssen Vertrag/Provider, Randjahre, Inventar, Regimezählung,
// MC-Schieber, Backtest-Endjahr und Texte das neue Jahr annehmen. Fehlt einer Kette ein Wert, bricht die Erzeugung klar ab.
import { readFileSync } from 'node:fs';
import {
    HISTORICAL_CHAIN_SERIES,
    HistoricalDataGenerationError,
    generateHistoricalData,
    loadHistoricalChains
} from '../scripts/historical-data-generate.mjs';
import { historicalEndYear } from '../scripts/lib/historical-end-year.mjs';
import {
    computeHistoricalDatasetHash,
    createHistoricalBacktestContractProvider,
    validateHistoricalDataManifest
} from '../app/simulator/historical-backtest-contract.js';
import {
    HISTORICAL_DATA,
    HISTORICAL_DATA_MANIFEST,
    HISTORICAL_DATENSTAND,
    REGIME_TRANSITIONS,
    annualData,
    assertHistoricalRegimeContract,
    buildDatasetMeta,
    buildHistoricalDataManifest,
    buildRegimeClassificationThresholds,
    deriveHistoricalAnnualData
} from '../app/simulator/simulator-data.js';
import {
    SIMULATION_DATA_INVENTORY,
    assertSimulationDataValueHash,
    buildSimulationDataInventory,
    validateSimulationDataInventory
} from '../app/simulator/simulation-data-inventory.js';
import {
    MONTE_CARLO_RNG_MODES,
    MONTE_CARLO_SAMPLING_METHODS,
    MONTE_CARLO_START_YEAR_MODES,
    buildMonteCarloParameterLimits
} from '../app/simulator/monte-carlo-parameters.js';
import { applyHistoricalDataYearFields, configureHistoricalBacktestControls } from '../app/simulator/historical-backtest-ui.js';
import { automaticBacktestPeriod } from '../app/simulator/simulator-auto-backtest.js';

console.log('--- Historical Data Year Neutrality Tests ---');

const captureError = callback => { try { callback(); return null; } catch (error) { return error; } };
const NEW_YEAR = HISTORICAL_DATENSTAND.endYear + 1;
const chains = await loadHistoricalChains();
const lastLevel = chains.series.global_equity_research_index.values[NEW_YEAR - 1];
// Plausible erfundene Werte: +7 % Aktien, 2,1 % Inflation, 1,9 % Geldmarkt, 3,0 % Lohn, +8,5 % Gold, CAPE 36,2.
const invented = { global_equity_research_index: lastLevel * 1.07, inflation_de: 2.1, zinssatz_de: 1.9, lohn_de: 3.0, gold_eur_perf: 8.5, cape: 36.2 };
const extendedChains = {
    series: Object.fromEntries(HISTORICAL_CHAIN_SERIES.map(({ seriesId }) => [seriesId,
        { ...chains.series[seriesId], values: { ...chains.series[seriesId].values, [NEW_YEAR]: invented[seriesId] } }])),
    equityReturns: { ...chains.equityReturns, [NEW_YEAR]: 0.07 }
};
const generated = generateHistoricalData({ chains: extendedChains, startYear: HISTORICAL_DATENSTAND.startYear, endYear: NEW_YEAR, revision: 'jd-1-probe.1' });
const stand = generated.datenstand;
const records = generated.records;

console.log('Test 1: Datenstand und Jahressätze im Speicher');
assertEqual(stand.endYear, NEW_YEAR, 'Datenstand reicht bis zum neuen Jahr');
assertEqual(Object.keys(records).length, HISTORICAL_DATA_MANIFEST.period.endYear - HISTORICAL_DATA_MANIFEST.period.startYear + 2, 'Ein Jahressatz mehr');
assert(stand.contentHash !== HISTORICAL_DATENSTAND.contentHash, 'Neuer Gesamthash');
const throughOldEnd = Object.fromEntries(Object.entries(records).filter(([year]) => Number(year) <= HISTORICAL_DATENSTAND.endYear));
assertEqual(computeHistoricalDatasetHash(throughOldEnd), HISTORICAL_DATENSTAND.contentHash, 'Hash über die bisherigen Jahre bleibt gleich');
assertEqual(stand.regimeDistribution.observationCount, HISTORICAL_DATENSTAND.regimeDistribution.observationCount + 1, 'Regimezählung umfasst das neue Jahr');
assertEqual(historicalEndYear(stand), NEW_YEAR, 'Bauskripte lesen das neue Endjahr über den gemeinsamen Helfer');

console.log('Test 2: Vertrag, Provider und Randjahre');
const manifest = buildHistoricalDataManifest(stand);
validateHistoricalDataManifest(manifest);
assertEqual(manifest.period.endYear, NEW_YEAR, 'Manifest übernimmt das Endjahr');
assertEqual(manifest.revision, 'jd-1-probe.1', 'Manifest übernimmt die Revision');
assert(Object.values(manifest.series).every(series => series.period.endYear === NEW_YEAR), 'Jede Reihe deklariert das neue Endjahr');
assertEqual(manifest.series.global_equity_research_index.estimatedSegments.at(-1).endYear, NEW_YEAR, 'Modelliertes Aktiensegment endet am Datenende');
const provider = createHistoricalBacktestContractProvider({ records, manifest });
assertEqual(provider.bounds.endYear, NEW_YEAR, 'Provider nimmt das neue Jahr an');
assertEqual(provider.getRecord(NEW_YEAR)?.year, NEW_YEAR, 'Jahressatz des neuen Jahres ist abrufbar');
assertEqual(provider.preparePeriod({ startYear: 2020, endYear: NEW_YEAR }).status, 'complete', 'Zeitraum bis zum neuen Jahr ist vollständig');
assertEqual(captureError(() => createHistoricalBacktestContractProvider({ records, manifest: HISTORICAL_DATA_MANIFEST }))?.code,
    'HISTORICAL_DATA_HASH_MISMATCH', 'Halber Stand: neue Daten mit altem Datenstand werden abgewiesen');
assertEqual(captureError(() => createHistoricalBacktestContractProvider({ records: HISTORICAL_DATA, manifest }))?.code,
    'HISTORICAL_DATA_HASH_MISMATCH', 'Halber Stand: alter Datenbestand mit neuem Datenstand wird abgewiesen');
const oldPeriod = buildHistoricalDataManifest({ ...stand, endYear: HISTORICAL_DATENSTAND.endYear });
const boundary = captureError(() => createHistoricalBacktestContractProvider({ records, manifest: oldPeriod }));
assertEqual(boundary?.code, 'HISTORICAL_DATASET_INVALID', 'Randjahre ungleich dem Datenstand werden abgewiesen');

console.log('Test 3: Inventar');
const inventory = buildSimulationDataInventory(stand);
validateSimulationDataInventory(inventory, stand);
for (const { seriesId } of HISTORICAL_CHAIN_SERIES) {
    assertEqual(inventory.historicalSeries[seriesId].qualitySegments.at(-1).endYear, NEW_YEAR, `${seriesId}: letztes Qualitätssegment endet am Datenende`);
    const projection = Object.fromEntries(Object.entries(records).map(([year, row]) => [year, row[seriesId]]));
    assertSimulationDataValueHash(seriesId, projection, inventory);
}
const derived = deriveHistoricalAnnualData(records, extendedChains.equityReturns);
assertSimulationDataValueHash('regime_classification_thresholds', buildRegimeClassificationThresholds(stand), inventory);
assertSimulationDataValueHash('regime_transition_matrix', derived.regimeTransitions, inventory);
const limits = buildMonteCarloParameterLimits({ startYear: derived.annualData[0].jahr, endYear: derived.annualData.at(-1).jahr });
assertSimulationDataValueHash('monte_carlo_defaults', { limits, samplingMethods: MONTE_CARLO_SAMPLING_METHODS,
    rngModes: MONTE_CARLO_RNG_MODES, startYearModes: MONTE_CARLO_START_YEAR_MODES }, inventory);
assertEqual(captureError(() => validateSimulationDataInventory(SIMULATION_DATA_INVENTORY, stand))?.code,
    'SIMULATION_DATA_QUALITY_SEGMENTS_INVALID', 'Bisheriges Inventar deckt das neue Jahr nicht ab');

console.log('Test 4: Regimezählung');
// Unabhängig festgehalten: +7 % Aktien bei 2,1 % Inflation liegt zwischen −15 % und +15 % ohne Stagflation, also SIDEWAYS.
const INVENTED_REGIME = 'SIDEWAYS';
const before = HISTORICAL_DATENSTAND.regimeDistribution;
const expectedDistribution = { observationCount: before.observationCount + 1, BULL: before.BULL, BEAR: before.BEAR,
    SIDEWAYS: before.SIDEWAYS + 1, STAGFLATION: before.STAGFLATION };
assertEqual(JSON.stringify(stand.regimeDistribution), JSON.stringify(expectedDistribution), 'Genau eine zusätzliche SIDEWAYS-Beobachtung, übrige Regime unverändert');
assertEqual(derived.annualData.at(-1).regime, INVENTED_REGIME, 'Das erfundene Jahr ist SIDEWAYS');
const lastRegimeBefore = annualData.at(-1).regime;
const expectedTransitions = JSON.parse(JSON.stringify(REGIME_TRANSITIONS));
expectedTransitions[lastRegimeBefore][INVENTED_REGIME] += 1;
expectedTransitions[lastRegimeBefore].total += 1;
assertEqual(JSON.stringify(derived.regimeTransitions), JSON.stringify(expectedTransitions),
    `Genau ein zusätzlicher Übergang ${lastRegimeBefore} → ${INVENTED_REGIME}`);
const expected = buildRegimeClassificationThresholds(stand).reviewedDistribution1925To2025;
assertEqual(assertHistoricalRegimeContract({ ...derived, expected }).distributionMatches, true, 'Regimezählung des neuen Stands passt');
assertEqual(captureError(() => assertHistoricalRegimeContract({ ...derived, expected: HISTORICAL_DATENSTAND.regimeDistribution }))?.code,
    'SIMULATOR_REGIME_DISTRIBUTION_DRIFT', 'Altes Soll mit neuen Daten bleibt als Schutz wirksam');

console.log('Test 5: MC-Schieber, Backtest-Endjahr und Texte');
const element = () => ({ value: '', min: '', max: '', step: '', textContent: '' });
// Wie in der EXE beobachtet: Der Wert steht schon auf dem Minimum, bevor das Maximum ankommt.
const slider = { ...element(), value: '1925' };
const nodes = { mcStartYearFilter: slider, simStartJahr: element(), simEndJahr: element(), backtestDatasetHint: element(), backtestDatasetInfoPop: element() };
const doc = { getElementById: id => nodes[id] || null };
applyHistoricalDataYearFields(doc, { startYearFilterMaximum: limits.startYearFilter.maximum, endYear: manifest.period.endYear });
assertEqual(nodes.mcStartYearFilter.max, String(NEW_YEAR), 'Schieber „Startjahr ab“ reicht bis zum neuen Jahr');
assertEqual(slider.value, '1970', 'Schieber steht nach dem Maximum ausdrücklich auf der Vorgabe 1970');
const html = readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
assert(html.includes(`id="mcStartYearFilter" min="1925" max="${HISTORICAL_DATENSTAND.endYear}"`), 'HTML-Maximum folgt dem heutigen Datenstand');
const html2026 = generateHistoricalData({ chains: extendedChains, startYear: 1925, endYear: NEW_YEAR, revision: 'jd-1-probe.1', simulatorHtml: html }).files['Simulator.html'];
assert(html2026.includes(`id="mcStartYearFilter" min="1925" max="${NEW_YEAR}" value="1970"`), 'Generator trägt das neue Jahr als HTML-Maximum ein');
assert(html2026.includes(`id="simEndJahr" value="${NEW_YEAR}"`), 'Generator trägt das neue Jahr als Backtest-Endjahr ein');
assertEqual(nodes.simEndJahr.value, String(NEW_YEAR), 'Backtest-Endjahr beginnt beim neuen Jahr');
configureHistoricalBacktestControls(doc, provider);
assertEqual(nodes.simEndJahr.max, String(NEW_YEAR), 'Endjahr-Feld erlaubt das neue Jahr');
assertEqual(nodes.backtestDatasetHint.textContent, `Daten 1929–${NEW_YEAR}`, 'Hinweis nennt das neue Endjahr');
assert(nodes.backtestDatasetInfoPop.textContent.includes(`Simulationszeitraum: 1929–${NEW_YEAR}`), 'Erklärung nennt das neue Endjahr');
assertEqual(automaticBacktestPeriod(provider, NEW_YEAR + 1).endYear, NEW_YEAR, 'Automatischer Backtest läuft bis zum neuen Jahr');
const meta = buildDatasetMeta(manifest);
assertEqual(JSON.stringify(meta.historicalData.coverageYears), JSON.stringify([1925, NEW_YEAR]), 'Abdeckung bis zum neuen Jahr');
assert(meta.historicalData.notes.includes(`Equity years 2021-${NEW_YEAR} use observed OECD price components and a modelled dividend component.`), 'Metadatentext nennt das neue Endjahr');
assert(manifest.series.gold_eur_perf.currency.value.endsWith(`EUR 1999-${NEW_YEAR}`), 'Manifesttext Gold nennt das neue Endjahr');
assert(inventory.historicalSeries.lohn_de.source.value.endsWith(`through ${NEW_YEAR}`), 'Inventartext Lohn nennt das neue Endjahr');
assert(manifest.series.inflation_de.source.value.includes('Destatis current annual table (2025)'), 'Quellenabhängiger Text bleibt unverändert');

console.log('Test 6: fehlender Wert in einer Kette');
for (const spec of HISTORICAL_CHAIN_SERIES) {
    const values = { ...extendedChains.series[spec.seriesId].values };
    delete values[NEW_YEAR];
    const broken = { ...extendedChains, series: { ...extendedChains.series, [spec.seriesId]: { ...extendedChains.series[spec.seriesId], values } } };
    const error = captureError(() => generateHistoricalData({ chains: broken, startYear: 1925, endYear: NEW_YEAR, revision: 'jd-1-probe.1' }));
    assert(error instanceof HistoricalDataGenerationError && error.message.includes(`Kette ${spec.label}`) && error.message.includes(String(NEW_YEAR)),
        `${spec.label}: fehlender Wert ${NEW_YEAR} bricht klar ab`);
}

console.log('✅ Historical data year neutrality tests passed');
