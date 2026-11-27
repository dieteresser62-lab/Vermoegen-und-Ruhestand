// JD-2a, Nachtrag 2, Befund 6: Der ausgelieferte Stand selbst – Revision, Inhaltshash und Manifest – ohne
// Grundbestandssicht. Die historischen Belegtests Slice 14/15 prüfen über den Import-Adapter den validierten
// Grundbestand; dieser Test prüft, was die App tatsächlich lädt, gegen die bei der Übernahme neu erzeugte Kennung.
import { readFileSync } from 'node:fs';
import { HISTORICAL_DATA, HISTORICAL_DATA_MANIFEST, HISTORICAL_DATENSTAND } from '../app/simulator/simulator-data.js';
import { canonicalizeHistoricalContractValue, computeHistoricalDatasetHash, createHistoricalBacktestContractProvider, sha256Hex } from '../app/simulator/historical-backtest-contract.js';
import { GRUNDBESTAND, grundbestandRecords } from '../scripts/lib/jahresdaten/grundbestand.mjs';

console.log('--- Jahresdaten: ausgelieferter Stand ---');

const kennung = JSON.parse(readFileSync(new URL('./fixtures/live-sollwerte.json', import.meta.url), 'utf8')).datenstand;
const { startYear, endYear, revision, contentHash } = HISTORICAL_DATENSTAND;

console.log('Test 1: Revision, Inhaltshash und Manifest sind in sich stimmig');
assertEqual(HISTORICAL_DATA_MANIFEST.revision, revision, 'Manifest trägt die Revision des Datenstands');
assertEqual(computeHistoricalDatasetHash(HISTORICAL_DATA), contentHash, 'Jahressätze ergeben den Inhaltshash des Datenstands');
assertEqual(HISTORICAL_DATA_MANIFEST.contentHash.value, contentHash, 'Manifest trägt denselben Inhaltshash');
assertEqual(JSON.stringify([HISTORICAL_DATA_MANIFEST.period.startYear, HISTORICAL_DATA_MANIFEST.period.endYear]), JSON.stringify([startYear, endYear]), 'Manifestzeitraum wie im Datenstand');
const jahre = Object.keys(HISTORICAL_DATA).map(Number);
assertEqual(JSON.stringify([jahre[0], jahre.at(-1), jahre.length]), JSON.stringify([startYear, endYear, endYear - startYear + 1]), 'Jahressätze lückenlos bis zum Endjahr');
assertEqual(createHistoricalBacktestContractProvider().bounds.endYear, endYear, 'Backtest-Provider reicht bis zum Endjahr');

console.log('Test 2: Kennung gleich der bei der Übernahme neu erzeugten');
assertEqual(revision, kennung.revision, 'Revision wie in den Live-Sollwerten');
assertEqual(contentHash, kennung.contentHash, 'Inhaltshash wie in den Live-Sollwerten');
assertEqual(endYear, kennung.endYear, 'Endjahr wie in den Live-Sollwerten');
assertEqual(sha256Hex(canonicalizeHistoricalContractValue(HISTORICAL_DATA_MANIFEST)), kennung.manifestHash, 'Manifesthash wie in den Live-Sollwerten');

console.log('Test 3: Grundbestand bleibt Teil des ausgelieferten Stands');
assertEqual(computeHistoricalDatasetHash(grundbestandRecords(HISTORICAL_DATA)), GRUNDBESTAND.contentHash, 'Jahre 1925–2025 unverändert');
if (endYear === GRUNDBESTAND.endYear) assertEqual(revision, GRUNDBESTAND.revision, 'Ohne angehängtes Jahr: Revision des Grundbestands');
else assert(new RegExp(`^${endYear}-[1-9]\\d*$`).test(revision), 'Nach einer Übernahme: Revision <Endjahr>-<lfd>');

console.log('✅ Jahresdaten ausgelieferter Stand tests passed');
