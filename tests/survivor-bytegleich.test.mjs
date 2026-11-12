import { readLE1References } from './helpers/le-1-expectations.mjs';
import { readGU1References } from './helpers/gu-1-expectations.mjs';
import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readVF2BReferences } from './helpers/vf-2b-expectations.mjs';
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { readRNG1Hash } from './helpers/rng-1-expectations.mjs';
import { readAN1Hash } from './helpers/an-1-expectations.mjs';
import { readEK1dHash } from './helpers/ek-1d-expectations.mjs';
import { readJB2Hash } from './helpers/jb-2-expectations.mjs';
import { createHash } from 'node:crypto';
import { inputs, runFixture } from './extended/parity-replay-fixture.mjs';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { normalizeWidowOptions } from '../app/simulator/simulator-sweep-utils.js';
import { EngineAPI } from '../engine/index.mjs';

// BK-2-Referenz: vollständige Jahreslogs mit Notlage, Obergrenze und Zinskorrektur,
// Backtest 2000–2025 und MC-Pfad 0, Seed 12345, zwölf Jahre ohne Todesfall.
const expected = {
  "off": {
    "backtest": "de3154e6a31ea76ed33d63292233d18b1d34a066d6c427b66dd7f48eb7ac037a",
    "mc": "c62491e699031112494865b45786c72243c4fe181a6f23d677e40b330cd114e5"
  },
  "konservativ": {
    "backtest": "7d0a65e64151400ddbb2ec73f52fa4d8154514650a0ff7ec17c30ee3a7cafeb3",
    "mc": "08a334d52850ea84df0d87a129275be7848fecb67c4096210a3516c96dbd1900"
  },
  "ausgewogen": {
    "backtest": "704fd1d6c74c4c837f6929f858e542e759eb8adb19cd52c42ad8cc56989af8e7",
    "mc": "5eee5e0dc349f6fd7cf47964de91dedfb0f532b8105b1a7f81d648c5a844df37"
  },
  "offensiv": {
    "backtest": "76416f21306bd6ab1206261cc870deeb98a4e071e948758bd8f87592fef73c41",
    "mc": "c2d8834af97b8ab1e1b486dd6701722d3de290ba3b7ec04930d8cebe9b31e065"
  }
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
for (const preset of ['off', 'konservativ', 'ausgewogen', 'offensiv']) {
    const input = { ...structuredClone(inputs), ...dynamicFlexPresetPatch(preset), pflegefallLogikAktivieren: false };
    const bt = runFixture({ input, selectedPeriod: { startYear: 2000, endYear: 2025 } });
    const mc = await runMonteCarloChunk({ inputs: input, widowOptions: normalizeWidowOptions(input.widowOptions),
        monteCarloParams: { anzahl: 1, maxDauer: 12, methode: 'regime_markov', seed: 12345 },
        runRange: { start: 0, count: 1 }, logIndices: [0], useCapeSampling: false, engine: EngineAPI });
    const rows = mc.runMeta[0].logDataRows;
    assertEqual(mc.financialMetricsValid, true, `${preset}: MC auswertbar`);
    assertEqual(rows.length, 12, `${preset}: vollständiger MC-Pfad`);
    assert(rows.every(row => row.Person1Alive === 1 && row.Person2Alive === 1), `${preset}: nachweislich ohne Tod`);
    if (preset === 'off') {
        // LE-1b (Gutachten P3-9): Der Anker ohne Dynamic Flex bleibt unübersetzt. FR-75 ändert nur den Horizont
        // des Dynamic Flex; ohne Dynamic Flex und ohne Todesfall rechnen Backtest und MC bytegleich zum Stand davor.
        const prior = value => readGU1References(readQSCReferences(readVF2BReferences(readGL1References(value))));
        const backtestBefore = prior(readAN1Hash(readJB2Hash(expected.off.backtest)));
        const mcBefore = prior(readRNG1Hash(readAN1Hash(readEK1dHash(readJB2Hash(expected.off.mc)))));
        assertEqual(readLE1References(backtestBefore), backtestBefore, 'off: Backtest-Anker ohne LE-1-Übersetzung');
        assertEqual(readLE1References(mcBefore), mcBefore, 'off: MC-Anker ohne LE-1-Übersetzung');
    }
    assertEqual(hash({ rows: bt.rows, outcome: bt.outcome }), readLE1References(readGU1References(readQSCReferences(readVF2BReferences(readGL1References(readAN1Hash(readJB2Hash(expected[preset].backtest))))))), `${preset}: Backtest ohne Tod entspricht BK-2-Referenz`);
    assertEqual(hash(rows), readLE1References(readGU1References(readQSCReferences(readVF2BReferences(readGL1References(readRNG1Hash(readAN1Hash(readEK1dHash(readJB2Hash(expected[preset].mc))))))))), `${preset}: MC ohne Tod entspricht BK-2-Referenz`);
}
