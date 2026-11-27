// JD-1: Datenstand und HISTORICAL_DATA sind erzeugte Module. Sie müssen zu den sechs Ketten-Ausgaben passen.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
    DATENSTAND_PATH,
    EQUITY_RETURN_SERIES,
    HISTORICAL_CHAIN_SERIES,
    HistoricalDataGenerationError,
    RECORDS_PATH,
    SIMULATOR_HTML_PATH,
    buildHistoricalRecords,
    renderSimulatorHtmlYears,
    generateFromRepository,
    loadHistoricalChains
} from '../scripts/historical-data-generate.mjs';
import { computeHistoricalDatasetHash } from '../app/simulator/historical-backtest-contract.js';
import { HISTORICAL_DATA, HISTORICAL_DATENSTAND } from '../app/simulator/simulator-data.js';

console.log('--- Historical Data Generate Tests ---');

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const captureError = callback => { try { callback(); return null; } catch (error) { return error; } };
// JD-2a: Endjahr aus dem Datenstand; ein Jahr danach bleibt außen vor (jahresrobust).
const END_YEAR = HISTORICAL_DATENSTAND.endYear;

console.log('Test 1: beide Module entsprechen genau der Erzeugung aus den Ketten');
const generated = await generateFromRepository();
assertEqual(generated.files[DATENSTAND_PATH], read(DATENSTAND_PATH), 'Datenstand-Modul ist aktuell erzeugt');
assertEqual(generated.files[RECORDS_PATH], read(RECORDS_PATH), 'Datenmodul HISTORICAL_DATA ist aktuell erzeugt');
assertEqual(generated.files[SIMULATOR_HTML_PATH], read(SIMULATOR_HTML_PATH), 'Jahresattribute in Simulator.html sind aktuell erzeugt');
const simulatorHtml = read(SIMULATOR_HTML_PATH);
assert(simulatorHtml.includes(`id="mcStartYearFilter" min="1925" max="${HISTORICAL_DATENSTAND.endYear}" value="1970"`), 'Schieber trägt das Maximum schon beim Parsen');
assert(simulatorHtml.includes(`id="simEndJahr" value="${HISTORICAL_DATENSTAND.endYear}"`), 'Backtest-Endjahr trägt das Endjahr schon beim Parsen');
const missingMax = simulatorHtml.replace(/(id="mcStartYearFilter" min="1925") max="\d{4}"/, '$1');
assert(captureError(() => renderSimulatorHtmlYears(missingMax, { endYear: 2025 })) instanceof HistoricalDataGenerationError, 'Fehlendes Maximum bricht die Erzeugung ab');
for (const file of [DATENSTAND_PATH, RECORDS_PATH]) {
    assert(read(file).startsWith('/**\n * Erzeugt von scripts/historical-data-generate.mjs – nicht von Hand ändern.'), `${file} trägt die Kopfzeile des Generators`);
}
assertEqual(generated.notes.length, 0, 'Keine Kette liefert Jahre nach dem Endjahr');

console.log('Test 2: Jahressätze und Datenstand stimmen mit Laufzeit und Ketten überein');
const chains = await loadHistoricalChains();
assertEqual(JSON.stringify(generated.records), JSON.stringify(HISTORICAL_DATA), 'Erzeugte Jahressätze gleichen HISTORICAL_DATA');
assertEqual(JSON.stringify(generated.datenstand), JSON.stringify(HISTORICAL_DATENSTAND), 'Erzeugter Datenstand gleicht dem eingebetteten');
assertEqual(computeHistoricalDatasetHash(HISTORICAL_DATA), HISTORICAL_DATENSTAND.contentHash, 'Inhaltshash des Datenstands passt zu HISTORICAL_DATA');
const years = Object.keys(HISTORICAL_DATA).map(Number);
assertEqual(years[0], HISTORICAL_DATENSTAND.startYear, 'Erstes Jahr laut Datenstand');
assertEqual(years.at(-1), HISTORICAL_DATENSTAND.endYear, 'Letztes Jahr laut Datenstand');
assertEqual(years.length, HISTORICAL_DATENSTAND.endYear - HISTORICAL_DATENSTAND.startYear + 1, 'Lückenlos vom Start- bis zum Endjahr');
for (const { seriesId } of HISTORICAL_CHAIN_SERIES) {
    assert(years.every(year => HISTORICAL_DATA[year][seriesId] === chains.series[seriesId].values[year]), `${seriesId}: jeder Wert stammt aus der Kette`);
    assertEqual(HISTORICAL_DATENSTAND.seriesHashes[seriesId].rawDataHash, chains.series[seriesId].rawDataHash, `${seriesId}: Rohdaten-Hash aus der Kette`);
}

console.log('Test 3: fehlende Werte brechen klar ab, spätere Jahre bleiben mit Hinweis außen vor');
const withoutValue = (values, year) => Object.fromEntries(Object.entries(values).filter(([key]) => Number(key) !== year));
for (const spec of HISTORICAL_CHAIN_SERIES) {
    const broken = { ...chains, series: { ...chains.series, [spec.seriesId]: { ...chains.series[spec.seriesId], values: withoutValue(chains.series[spec.seriesId].values, 1990) } } };
    const error = captureError(() => buildHistoricalRecords(broken, { startYear: 1925, endYear: END_YEAR }));
    assert(error instanceof HistoricalDataGenerationError, `${spec.label}: Abbruch mit eigenem Fehler`);
    assert(error?.message.includes(`Kette ${spec.label} (${spec.exportName}) liefert für 1990 keinen Wert`), `${spec.label}: Meldung nennt Kette und Jahr`);
}
const brokenReturns = captureError(() => buildHistoricalRecords({ ...chains, equityReturns: withoutValue(chains.equityReturns, END_YEAR) }, { startYear: 1925, endYear: END_YEAR }));
assert(brokenReturns?.message.includes(`Kette ${EQUITY_RETURN_SERIES.label}`) && brokenReturns.message.includes(String(END_YEAR)), 'Fehlende Aktienrendite bricht ebenfalls ab');
const nonFinite = { ...chains, series: { ...chains.series, cape: { ...chains.series.cape, values: { ...chains.series.cape.values, 2000: Number.NaN } } } };
assert(captureError(() => buildHistoricalRecords(nonFinite, { startYear: 1925, endYear: END_YEAR })) instanceof HistoricalDataGenerationError, 'Nicht endlicher Wert bricht ab');
const later = { ...chains, series: { ...chains.series, gold_eur_perf: { ...chains.series.gold_eur_perf, values: { ...chains.series.gold_eur_perf.values, [END_YEAR + 1]: 4.2 } } } };
const ignored = buildHistoricalRecords(later, { startYear: 1925, endYear: END_YEAR });
assertEqual(JSON.stringify(ignored.records), JSON.stringify(HISTORICAL_DATA), 'Jahr nach dem Endjahr ändert die Jahressätze nicht');
assertEqual(ignored.notes.length, 1, 'Ein Hinweis für die eine Kette mit späterem Jahr');
assert(ignored.notes[0].startsWith('Hinweis: Kette Gold') && ignored.notes[0].includes(String(END_YEAR + 1)), 'Hinweis nennt Kette und Jahr');

console.log('Test 4: Prüflauf des Skripts');
const verify = spawnSync(process.execPath, ['scripts/historical-data-generate.mjs', '--verify-only'], { cwd: new URL('.', root), encoding: 'utf8' });
assertEqual(verify.status, 0, `--verify-only meldet aktuellen Stand: ${verify.stderr}`);
assert(verify.stdout.includes(`Inhaltshash ${HISTORICAL_DATENSTAND.contentHash}`), 'Prüflauf nennt den Inhaltshash');

console.log('✅ Historical data generate tests passed');
