/** MS-1: Monte-Carlo-Vorgabe alt (regime_markov) gegen neu (Stationary Bootstrap, Blocklänge 5) für die sechs Beispielhaushalte.
 * Synthetische Beispielhaushalte im Grundfall, Handbuchdatum, keine Nutzerdaten.
 * Aufruf: node scripts/measure-ms1.mjs <Code-Wurzel> <regime_markov|stationary> <Ausgabe.json> [Haushalt ...]
 * Die Code-Wurzel erlaubt dieselbe Messung auf einem anderen Stand (etwa einer Kopie vor NG-8/NG-9). */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [root, method, output, ...onlyHouseholds] = process.argv.slice(2);
if (!root || !['regime_markov', 'stationary'].includes(method) || !output) {
    throw new Error('Aufruf: node scripts/measure-ms1.mjs <Code-Wurzel> <regime_markov|stationary> <Ausgabe.json> [Haushalt ...]');
}
const load = file => import(pathToFileURL(resolve(root, file)).href);
const { measurementInputs } = await load('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await load('engine/index.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { quantile } = await load('app/simulator/simulator-utils.js');
const { MUSTER_HAUSHALTE, HANDBOOK_MUSTER_DATE } = await load('app/demo/muster-haushalte.js');

const RUNS = 2000, SEED = 12345, BLOCK_SIZE = 5, CHUNK = 100;
const windows = [
    { id: 'alle', label: 'alle Jahre', startYearMode: 'UNIFORM', useCapeSampling: false },
    { id: '1951', label: 'ab 1951', startYearMode: 'FILTER', startYearFilter: 1951, useCapeSampling: false },
    { id: '1970', label: 'ab 1970', startYearMode: 'FILTER', startYearFilter: 1970, useCapeSampling: false },
    // Nachtrag 3: CAPE nur im Fenster „alle Jahre“.
    { id: 'alle-cape', label: 'alle Jahre, Startjahre nach CAPE', startYearMode: 'UNIFORM', useCapeSampling: true }
];
const households = MUSTER_HAUSHALTE.map(entry => entry.id).filter(id => !onlyHouseholds.length || onlyHouseholds.includes(id));

async function measureCell(inputs, window) {
    const parameters = { anzahl: RUNS, maxDauer: undefined, blockSize: BLOCK_SIZE, seed: SEED, methode: method,
        rngMode: 'per-run-seed', startYearMode: window.startYearMode, startYearFilter: window.startYearFilter ?? 1970,
        startYearHalfLife: 20, excludeEstimatedHistory: false };
    const digest = createHash('sha256');
    const finalReal = [];
    let ruin = 0, allDead = 0, horizon = 0, technical = 0, stage2Years = 0, simulatedYears = 0, withdrawalSum = 0, withdrawalYears = 0;
    const started = performance.now();
    for (let start = 0; start < RUNS; start += CHUNK) {
        const count = Math.min(CHUNK, RUNS - start);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: parameters, widowOptions: inputs.widowOptions,
            useCapeSampling: window.useCapeSampling, runRange: { start, count }, logIndices: Array.from({ length: count }, (_, i) => start + i) });
        if (chunk.batchStatus !== 'completed') throw new Error(`Lauf nicht vollständig: ${chunk.batchStatus}`);
        ruin += chunk.totals.outcomeRuinCount;
        allDead += chunk.totals.outcomeAllDeadCount;
        horizon += chunk.totals.outcomeHorizonExhaustedCount;
        technical += chunk.technicalInventory.technicalError;
        stage2Years += chunk.totals.totalYearsSafetyStage2;
        simulatedYears += chunk.totals.totalSimulatedYears;
        finalReal.push(...chunk.pathSummaries.finalValueRealEur);
        for (const run of chunk.runMeta) {
            for (const row of run.logDataRows || []) {
                if (row.jahr >= 1 && row.jahr <= 10 && row.financiallyEvaluable === true && Number.isFinite(row.jahresentnahme_real)) {
                    withdrawalSum += row.jahresentnahme_real;
                    withdrawalYears += 1;
                }
            }
        }
        digest.update(JSON.stringify({ totals: chunk.totals, pathSummaries: chunk.pathSummaries }));
    }
    const seconds = (performance.now() - started) / 1000;
    const evaluable = finalReal.filter(Number.isFinite);
    return {
        window: window.label,
        floorCoveredPct: technical > 0 ? null : (allDead + horizon) / RUNS * 100,
        ruinPct: ruin / RUNS * 100,
        finalRealP10: quantile(evaluable, 0.1),
        finalRealP50: quantile(evaluable, 0.5),
        safetyStage2YearsPct: simulatedYears > 0 ? stage2Years / simulatedYears * 100 : null,
        withdrawalYears1to10RealMean: withdrawalYears > 0 ? withdrawalSum / withdrawalYears : null,
        technicalErrors: technical,
        seconds,
        outputSha256: digest.digest('hex')
    };
}

const result = { measurement: 'MS-1', method, blockSize: method === 'stationary' ? BLOCK_SIZE : null, runs: RUNS, seed: SEED,
    testDate: HANDBOOK_MUSTER_DATE, variant: 'grund', root: root === '.' ? 'Arbeitsstand' : 'andere Code-Wurzel',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    definitions: {
        floorCoveredPct: 'Grundbedarf gedeckt: Tod aller Personen oder Horizont ohne aufgebrauchtes Vermögen, Anteil an allen Läufen',
        ruinPct: 'Vermögen aufgebraucht: Anteil an allen Läufen',
        finalReal: 'Geldvermögen am Laufende real (Euro von Laufstart), P10 und Median über alle auswertbaren Läufe',
        safetyStage2YearsPct: 'Anteil der simulierten Jahre in Sicherheitsstufe 2',
        withdrawalYears1to10RealMean: 'mittlere reale Jahresentnahme in den Jahren 1 bis 10 über alle auswertbaren Laufjahre'
    },
    households: {} };
for (const id of households) {
    const inputs = await measurementInputs(0, id, HANDBOOK_MUSTER_DATE, 'grund');
    result.households[id] = {};
    for (const window of windows) {
        const cell = await measureCell(inputs, window);
        result.households[id][window.id] = cell;
        console.log(`${id} / ${window.label}: gedeckt ${cell.floorCoveredPct?.toFixed(1)} %, aufgebraucht ${cell.ruinPct.toFixed(1)} %, ${cell.seconds.toFixed(1)} s`);
    }
}
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
