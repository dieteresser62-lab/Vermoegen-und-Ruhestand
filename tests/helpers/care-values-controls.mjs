import { withPreviousRunEvidence } from './le-1b-expectations.mjs';
import { historicalSurvivorNeeds } from './historical-survivor-inputs.mjs';
import { createHash } from 'node:crypto';
import { withoutExampleNeeds } from './ff-3-expectations.mjs';

/** Vollständige Ergebnisse des Ausgangsstands, synthetische Daten und fester Seed. */
export async function careValueControls(root = new URL('../../', import.meta.url), patch = {}) {
    const load = file => import(new URL(file, root));
    const { inputs, runFixture, source, records } = await load('tests/extended/parity-replay-fixture.mjs');
    const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
    const { createParityReplayCollector } = await load('app/simulator/parity-replay-collector.js');
    const { EngineAPI } = await load('engine/index.mjs');
    const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const results = {};
    for (const scenario of ['no-care', 'family', 'official']) {
        const input = { ...structuredClone(inputs), ...patch };
        if (scenario !== 'no-care') {
            input.careToday = { grade: 2, progression: 'usual' }; input.pflegefallLogikAktivieren = true;
            if (scenario === 'official') {
                input.pflegeKostenStaffelPreset = 'amtlich';
                for (const [grade, amount] of Object.entries({ 1: 200, 2: 2300, 3: 7100, 4: 15000, 5: 18900 })) input.pflegeGradeConfigs[grade].zusatz = amount;
            }
        }
        const collector = createParityReplayCollector({ source, initialRecords: withoutExampleNeeds(records) });
        const backtest = runFixture({ input, collector });
        const mc = await runMonteCarloChunk({ inputs: historicalSurvivorNeeds(input), monteCarloParams: { anzahl: 8, maxDauer: 8, methode: 'block', blockSize: 1, seed: 12345 },
            logIndices: new Set([0, 1, 2, 3, 4, 5, 6, 7]), widowOptions: input.widowOptions, useCapeSampling: false, engine: EngineAPI });
        // LE-1b: Laufbeleg der Sterbetafel wie vor LE-1b; alle übrigen MC-Bytes bleiben im Vergleich.
        results[scenario] = { backtest: digest(backtest), parity: digest(collector.toLog()), mc: digest(withPreviousRunEvidence(mc)) };
    }
    return results;
}
