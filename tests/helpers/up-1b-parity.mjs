import { historicalSurvivorInput, historicalSurvivorNeeds } from './historical-survivor-inputs.mjs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function unmarriedParityEvidence(root) {
    const load = file => import(pathToFileURL(resolve(root, file)));
    const { measurementInputs, parameters, backtest } = await load('tests/helpers/ek-1b-measurement.mjs');
    const { EngineAPI } = await load('engine/index.mjs');
    const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
    const { runSweepChunk } = await load('app/simulator/sweep-runner.js');
    const inputs = historicalSurvivorInput(await measurementInputs(0, 'max-erika'));
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const params = { ...parameters, anzahl: 12 };
    const request = { inputs: historicalSurvivorNeeds(inputs), monteCarloParams: params, widowOptions: inputs.widowOptions,
        useCapeSampling: false, logIndices: new Set(Array.from({ length: 12 }, (_, i) => i)), engine: EngineAPI };
    const whole = await runMonteCarloChunk(request), workers = [];
    for (let start = 0; start < 12; start += 4) workers.push(hash(await runMonteCarloChunk({ ...request,
        inputs: historicalSurvivorNeeds(structuredClone(inputs)), runRange: { start, count: 4 } })));
    const sweep = runSweepChunk({ baseInputs: historicalSurvivorNeeds(inputs),
        paramCombinations: [{ liquidityRunwayYears: 3, goldRebalancingBand: 20, maxSkimPct: 10, maxBearRefillPct: 5, goldTargetPct: 0 }],
        sweepConfig: { anzahlRuns: 4, maxDauer: 35, blockSize: 3, baseSeed: 12345, methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' }, engine: EngineAPI });
    const historical = {};
    for (const percent of [0, 100]) {
        const input = { ...inputs, partnership: { schemaVersion: 1, status: 'unmarried',
            inheritance: Object.fromEntries(inputs.simulationPeople.map(person => [person.profileId, percent])) } };
        historical[percent] = hash(backtest(input));
    }
    return { whole: hash(whole), workers, sweep: hash(sweep), historical };
}
