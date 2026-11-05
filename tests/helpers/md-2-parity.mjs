import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { EngineAPI } from '../../engine/index.mjs';

globalThis.window = { EngineAPI, addEventListener() {}, removeEventListener() {} };
const { prepareHistoricalDataOnce } = await import('../../app/simulator/simulator-engine-helpers.js');
prepareHistoricalDataOnce();
const { runMonteCarloChunk } = await import('../../app/simulator/monte-carlo-runner.js');
const { ScenarioAnalyzer } = await import('../../app/simulator/scenario-analyzer.js');

export const parityParams = { anzahl: 50, maxDauer: 35, blockSize: 5, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };

export function parityInputs(withHome = false) {
    const inputs = JSON.parse(readFileSync(new URL('../fixtures/pe-1-max-erika.json', import.meta.url), 'utf8'));
    if (withHome) {
        inputs.home = [{ id: 'haus', profileId: 'muster_a', bezeichnung: 'Haus', nutzung: 'selbst',
            wert: 800000, stand: '2026-10', mieteNetto: 0, anpassung: 'keine' }];
        inputs.homeReferenceYear = 2026;
    }
    return inputs;
}

export async function parityChunk(method, withHome = false, logIndices) {
    const inputs = parityInputs(withHome);
    return runMonteCarloChunk({ inputs, engine: EngineAPI,
        monteCarloParams: { ...parityParams, methode: method }, widowOptions: inputs.widowOptions,
        useCapeSampling: false, runRange: { start: 0, count: 50 }, logIndices });
}

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function resultHashes(chunk) {
    const fields = ['totals', 'lists', 'pathSummaries', 'heatmap'];
    return { ...Object.fromEntries(fields.map(key => [key, hash(chunk[key])])),
        combined: hash(fields.map(key => chunk[key])) };
}

export function characteristicIndices(meta) {
    const analyzer = new ScenarioAnalyzer(meta.length);
    meta.forEach(run => analyzer.addRun(run));
    return analyzer.getCharacteristicIndices();
}

// Capture before editing product modules; the fixture contains only hashes and run indices.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const cases = {};
    for (const home of [false, true]) for (const method of ['block', 'regime_markov', 'regime_iid', 'stationary']) {
        if (home && method === 'stationary') continue; // Previously DataCloneError.
        const chunk = await parityChunk(method, home);
        if (chunk.technicalInventory.technicalError) throw new Error('Technical error in baseline.');
        cases[`${method}/${home ? 'home' : 'no-home'}`] = {
            hashes: resultHashes(chunk), characteristicIndices: characteristicIndices(chunk.runMeta)
        };
    }
    writeFileSync(process.argv[2], JSON.stringify({ runtime: { node: process.version, platform: process.platform },
        params: parityParams, cases }, null, 2) + '\n');
}
