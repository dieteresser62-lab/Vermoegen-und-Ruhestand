// HE-5 B2: Gegenprobe aus dem Gutachten zur letzten Todeszeile im normalen MC-Lauf.
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs } from './extended/parity-replay-fixture.mjs';
import { officialCareCosts } from '../app/shared/household-care-values.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';

const inputs = { ...structuredClone(fixtureInputs), pflegefallLogikAktivieren: true,
    pflegeModellTyp: 'chronisch', pflegeKostenStaffelPreset: 'amtlich' };
const official = officialCareCosts();
for (const grade of [1, 2, 3, 4, 5]) inputs.pflegeGradeConfigs[grade].zusatz = official[grade];
const monteCarloParams = { anzahl: 40, maxDauer: 45, methode: 'block', blockSize: 1, seed: 777, rngMode: 'per-run-seed' };
const source = await runMonteCarloChunk({ inputs, widowOptions: inputs.widowOptions, monteCarloParams,
    useCapeSampling: false, engine: EngineAPI, logIndices: [1] });
const meta = source.runMeta.find(entry => entry.index === 1);
const terminal = meta.logDataRows.at(-1);
assertEqual(terminal.recordType, 'terminal_death', 'B2: Lauf 1 endet durch letzten Tod');
assertEqual(terminal.jahr, 27, 'B2: letzter Tod im Simulationsjahr 27');
assertEqual(terminal.CareP2_Cost, 0, 'B2: ursprünglicher Lauf ohne Jahreskosten');
assertEqual(terminal.pflege_flex_faktor, 1, 'B2: ursprünglicher Lauf ohne Pflege-Flex');
