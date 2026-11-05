import { historicalSurvivorNeeds } from './historical-survivor-inputs.mjs';
import { inputs, runFixture } from '../extended/parity-replay-fixture.mjs';
import { EngineAPI } from '../../engine/index.mjs';
import { runMonteCarloChunk } from '../../app/simulator/monte-carlo-runner.js';
import { annualData } from '../../app/simulator/simulator-data.js';
import { normalizeWidowOptions } from '../../app/simulator/simulator-sweep-utils.js';
import { dynamicFlexPresetPatch } from '../../app/shared/dynamic-flex-presets.js';

export const kg1Parameters = Object.freeze({
    household: 'Max und Erika Mustermann', period: '2000–2025', preset: 'offensiv',
    paths: 100, years: 30, seed: 12345, method: 'regime_markov',
    rngMode: 'per-run-seed', capeSampling: false,
    mcPool: 'Historische Inflation und Lohnänderung jeweils mindestens null, wie rechenregeln-bytegleich.'
});

export async function kg1Samples({ onEngineResult = () => {} } = {}) {
    const input = { ...structuredClone(inputs), ...dynamicFlexPresetPatch('offensiv'),
        rentAdjMode: 'wage', rentAdjPct: 2, pflegefallLogikAktivieren: false,
        kirchensteuerSatz: 0, stressPreset: 'NONE' };
    const engine = { ...EngineAPI, simulateSingleYear(...args) {
        const result = EngineAPI.simulateSingleYear(...args);
        onEngineResult(result);
        return result;
    } };
    const backtest = runFixture({ input, engine,
        selectedPeriod: { startYear: 2000, endYear: 2025 } });
    const original = annualData.slice();
    try {
        annualData.splice(0, annualData.length, ...original.map(year => ({ ...year,
            lohn: Math.max(0, year.lohn), inflation: Math.max(0, year.inflation) })));
        const mc = await runMonteCarloChunk({ inputs: historicalSurvivorNeeds(input), engine,
            widowOptions: normalizeWidowOptions(input.widowOptions), useCapeSampling: false,
            monteCarloParams: { anzahl: kg1Parameters.paths, maxDauer: kg1Parameters.years,
                methode: kg1Parameters.method, seed: kg1Parameters.seed, rngMode: kg1Parameters.rngMode },
            runRange: { start: 0, count: kg1Parameters.paths },
            logIndices: Array.from({ length: kg1Parameters.paths }, (_, i) => i) });
        return { backtest: { rows: backtest.rows, outcome: backtest.outcome }, mc };
    } finally {
        annualData.splice(0, annualData.length, ...original);
    }
}
