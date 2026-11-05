import { readEV1bReferences } from './helpers/ev-1b-expectations.mjs';
const readZG1References = value => readEV1bReferences(readBeforeEV1bReferences(value));
import { readZG1References as readBeforeEV1bReferences } from './helpers/zg-1-expectations.mjs';
import { readEV1References as readBeforeZG1References } from './helpers/ev-1-expectations.mjs';
const readEV1References = value => readZG1References(readBeforeZG1References(value));
import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readVF2BReferences } from './helpers/vf-2b-expectations.mjs';
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { historicalSurvivorNeeds } from './helpers/historical-survivor-inputs.mjs';
import { readEP1Hash } from './helpers/ep-1-expectations.mjs';
import { readRNG1Hash as readBeforeEP1Hash } from './helpers/rng-1-expectations.mjs';
import { readAN1Hash } from './helpers/an-1-expectations.mjs';
import { readEK1dHash } from './helpers/ek-1d-expectations.mjs';
import { readJB2Hash } from './helpers/jb-2-expectations.mjs';
import { createHash } from 'node:crypto';
import { inputs, runFixture } from './extended/parity-replay-fixture.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';
import { normalizeWidowOptions } from '../app/simulator/simulator-sweep-utils.js';
import { annualData } from '../app/simulator/simulator-data.js';
import { EngineAPI } from '../engine/index.mjs';

// BK-2-Referenz mit FR-20/25/26 und korrigierten Protokollfeldern. Vollständige Jahreslogs,
// keine Zeitmessungen/Herkunftshashes. MC enthält Todesfälle: ab FF-C gelten
// dort FR-21–24/27; household-payout-regression prüft zusätzlich einen unbetroffenen Haushalt. Synthetischer Haushalt ohne Kirchensteuer/Pflege;
// Backtest 2000–2010, MC-Pfad 0 mit Seed 12345 und 35 Jahren. Nur nichtnegative
// Lohn-/Inflationsjahre im MC-Pool; Originaldaten nach der Prüfung restaurieren.
const readRNG1Hash = before => readQSCReferences(readEP1Hash(readBeforeEP1Hash(before)));
const expected = {
    "off": {
        "backtest": "45ae2f53206bc15a2fcf0009e857baf17599299524ccfab7d2310220e305784a",
        "mc": "f0699f824b64f8805b61f60ac81c0f10172c735d84dbb5ef84cf3ae4e31d626c"
    },
    "konservativ": {
        "backtest": "3c899d209af6ad92de14835ffe2d90802263fb683fc448d80a131aab22aa27e7",
        "mc": "14f03874592824cdf9e6ec2c12c4a788e8a3549039df3ec4426afe0aa8c4690d"
    },
    "ausgewogen": {
        "backtest": "300fabbc3f356446e0f995eb0d7e30f5a1854916e7dfae026bcf20ee2d6d3394",
        "mc": "badf26bf44d38482926b7311512ec15ed5d6c3ca566f335bbbc3c3620a467bb7"
    },
    "offensiv": {
        "backtest": "c98b25cddd68435147a39527b7ac37779f2d9c7e85a8756fa45d53cd89ec456f",
        "mc": "65fce7e847ba6fa96e7256fd8ecbea698f349855e475f99849761a511adb2600"
    }
};
const original = annualData.slice();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
    annualData.splice(0, annualData.length, ...original.map(year => ({ ...year,
        lohn: Math.max(0, year.lohn), inflation: Math.max(0, year.inflation) })));
    for (const preset of ['off', 'konservativ', 'ausgewogen', 'offensiv']) {
        const input = { ...structuredClone(inputs), ...dynamicFlexPresetPatch(preset), rentAdjMode: 'wage', rentAdjPct: 2,
            pflegefallLogikAktivieren: false, kirchensteuerSatz: 0, stressPreset: 'NONE' };
        const backtest = runFixture({ input, selectedPeriod: { startYear: 2000, endYear: 2010 } });
        const mc = await runMonteCarloChunk({ inputs: historicalSurvivorNeeds(input), widowOptions: normalizeWidowOptions(input.widowOptions),
            monteCarloParams: { anzahl: 1, maxDauer: 35, methode: 'regime_markov', seed: 12345 },
            runRange: { start: 0, count: 1 }, logIndices: [0], useCapeSampling: false, engine: EngineAPI });
        assertEqual(mc.financialMetricsValid, true, `${preset}: MC auswertbar`);
        assertEqual(hash({ rows: backtest.rows, outcome: backtest.outcome }), readQSCReferences(readVF2BReferences(readGL1References(readAN1Hash(readJB2Hash(expected[preset].backtest))))), `${preset}: Backtest entspricht BK-2-Referenz`);
        assertEqual(hash(mc.runMeta[0].logDataRows), readEV1References(readQSCReferences(readVF2BReferences(readGL1References(readRNG1Hash(readAN1Hash(readEK1dHash(readJB2Hash(expected[preset].mc)))))))), `${preset}: MC-Pfad 0 mit FR-21–24/27`);
    }
} finally {
    annualData.splice(0, annualData.length, ...original);
}
