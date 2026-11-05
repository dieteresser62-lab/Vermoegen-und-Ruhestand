import { readFileSync } from 'node:fs';
import * as facade from '../app/simulator/monte-carlo-runner.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner/chunk.js';
import { runMonteCarloSimulation } from '../app/simulator/monte-carlo-runner/simulation.js';
import { MONTE_CARLO_HOUSEHOLD_LIFE_CONTRACT_VERSION, createDemographyCareSurvivorDiagnosticsV1,
    createMonteCarloTechnicalInventory, mergeMonteCarloTechnicalInventory,
    attachMonteCarloBatchOutcome } from '../app/simulator/monte-carlo-runner/batch.js';
import { MC_HEATMAP_BINS, pickWorstRun, createMonteCarloBuffers } from '../app/simulator/monte-carlo-runner-utils.js';
import { buildMonteCarloAggregates } from '../app/simulator/monte-carlo-aggregates.js';
import { buildStartYearCdf, pickStartYearIndex } from '../app/simulator/mc-year-sampling.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { EngineAPI } from '../engine/index.mjs';

const expected = { MC_HEATMAP_BINS, pickWorstRun, createMonteCarloBuffers, buildMonteCarloAggregates,
    buildStartYearCdf, pickStartYearIndex, MONTE_CARLO_HOUSEHOLD_LIFE_CONTRACT_VERSION,
    createDemographyCareSurvivorDiagnosticsV1, createMonteCarloTechnicalInventory,
    mergeMonteCarloTechnicalInventory, attachMonteCarloBatchOutcome, runMonteCarloSimulation,
    runMonteCarloChunk };
assertEqual(JSON.stringify(Object.keys(facade).sort()), JSON.stringify(Object.keys(expected).sort()),
    'Die Runnerfassade erhält genau die bisherigen öffentlichen Namen');
for (const [name, value] of Object.entries(expected)) {
    assert(facade[name] === value, `${name}: Fassade und Definitionsmodul teilen dieselbe Bindung`);
}

// Beim Übergeben an den Chunkkontext bleiben Callbacks freie Funktionsaufrufe.
prepareHistoricalDataOnce();
const inputs = JSON.parse(readFileSync(new URL('./fixtures/pe-1-max-erika.json', import.meta.url), 'utf8'));
const progress = [];
const chunk = await facade.runMonteCarloChunk({ inputs, engine: EngineAPI,
    monteCarloParams: { anzahl: 1, maxDauer: 2, blockSize: 1, seed: 12345,
        methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' },
    widowOptions: inputs.widowOptions, useCapeSampling: false, logIndices: [],
    onProgress: function (pct, detail) {
        progress.push({ receiver: this, pct, completedRuns: detail?.completedRuns });
    }
});
assertEqual(chunk.technicalInventory.technicalError, 0, 'Callbackgegenprobe rechnet einen gültigen Pfad');
assertEqual(JSON.stringify(progress.map(({ pct }) => pct)), '[0,0,90]',
    'Vorbereitung, Pfadfortschritt und Chunkabschluss behalten ihre Reihenfolge');
assert(progress.every(({ receiver }) => receiver === undefined),
    'Alle Fortschrittscallbacks behalten undefined als this');
assertEqual(progress.at(-1).completedRuns, 1, 'Chunkabschluss meldet den vollständig gerechneten Pfad');
