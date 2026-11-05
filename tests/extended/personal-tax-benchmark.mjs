/** Compare the complete PA-A6 source copy with the current personal-tax path. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runMonteCarloChunk } from '../../app/simulator/monte-carlo-runner.js';
import { runSweepChunk } from '../../app/simulator/sweep-runner.js';
import { EngineAPI } from '../../engine/index.mjs';
import { normalizeWidowOptions } from '../../app/simulator/simulator-sweep-utils.js';
import { inputs } from './parity-replay-fixture.mjs';

const baselineRoot = process.env.PERSONAL_TAX_BASELINE_DIR;
assert(baselineRoot, 'PERSONAL_TAX_BASELINE_DIR must name a private copy of PA-A6 app/, engine/, types/, workers/, data/ and package.json');
const baselineMc = await import(pathToFileURL(join(resolve(baselineRoot), 'app/simulator/monte-carlo-runner.js')));
const baselineSweep = await import(pathToFileURL(join(resolve(baselineRoot), 'app/simulator/sweep-runner.js')));
const params = { anzahl: 12, maxDauer: 12, blockSize: 3, seed: 12345, methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const mcOptions = { inputs, monteCarloParams: params, widowOptions: normalizeWidowOptions(inputs.widowOptions), useCapeSampling: true, engine: EngineAPI };
const sweepOptions = { baseInputs: inputs, paramCombinations: [{ liquidityRunwayYears: 3 }, { liquidityRunwayYears: 5 }],
    sweepConfig: { ...params, anzahl: 6, useCapeSampling: true }, engine: EngineAPI };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const jobs = [
    { name: 'MC, 12 × maximal 12 Jahre', old: () => baselineMc.runMonteCarloChunk(mcOptions), current: () => runMonteCarloChunk(mcOptions),
        check: value => assert.equal(value.financialMetricsValid, true) },
    { name: 'Sweep, 2 × 6 × maximal 12 Jahre', old: () => baselineSweep.runSweepChunk(sweepOptions), current: () => runSweepChunk(sweepOptions),
        check: value => assert.equal(value.results.length, 2) }
];
const measurements = [];
for (const job of jobs) {
    for (let warm = 0; warm < 3; warm++) { job.check(await job.old()); job.check(await job.current()); }
    const times = { old: [], current: [] };
    for (let round = 0; round < 7; round++) {
        for (const mode of round % 2 ? ['current', 'old'] : ['old', 'current']) {
            const start = performance.now();
            for (let iteration = 0; iteration < 3; iteration++) job.check(await job[mode]());
            times[mode].push((performance.now() - start) / 3);
        }
    }
    const oldMs = median(times.old), currentMs = median(times.current);
    measurements.push({ name: job.name, oldMs, currentMs, deltaMs: currentMs - oldMs,
        deltaPct: 100 * (currentMs / oldMs - 1), samples: times });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, seed: params.seed,
    warmups: 3, rounds: 7, repetitions: 3, collector: false, measurements }, null, 2));
