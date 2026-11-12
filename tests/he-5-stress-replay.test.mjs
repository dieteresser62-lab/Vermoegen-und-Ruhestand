// HE-5 B2: vollständige Gegenprobe aus dem Gutachten, einschließlich letzter Todeszeile.
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs } from './extended/parity-replay-fixture.mjs';
import { officialCareCosts } from '../app/shared/household-care-values.js';
import { getDataVersion } from '../app/simulator/simulator-engine-helpers.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { createStressReplayCaptureRequest, materializeStressReplayPathV1 } from '../app/simulator/stress-replay-path-materializer.js';
import { createStressReplayFingerprint } from '../app/simulator/stress-replay-contract.js';
import { runStressReplayPathV1 } from '../app/simulator/stress-replay-runner.js';

const inputs = { ...structuredClone(fixtureInputs), pflegefallLogikAktivieren: true,
    pflegeModellTyp: 'chronisch', pflegeKostenStaffelPreset: 'amtlich' };
const official = officialCareCosts();
for (const grade of [1, 2, 3, 4, 5]) inputs.pflegeGradeConfigs[grade].zusatz = official[grade];
const monteCarloParams = { anzahl: 40, maxDauer: 45, methode: 'block', blockSize: 1, seed: 777, rngMode: 'per-run-seed' };
const source = await runMonteCarloChunk({ inputs, widowOptions: inputs.widowOptions, monteCarloParams,
    useCapeSampling: false, engine: EngineAPI, logIndices: [1], stressReplayCapture: createStressReplayCaptureRequest([1]) });
const meta = source.runMeta.find(entry => entry.index === 1);
const terminal = meta.logDataRows.at(-1);
assertEqual(terminal.recordType, 'terminal_death', 'B2: Lauf 1 endet durch letzten Tod');
assertEqual(terminal.jahr, 27, 'B2: letzter Tod im Simulationsjahr 27');
assertEqual(terminal.CareP2_Cost, 0, 'B2: ursprünglicher Lauf ohne Jahreskosten');
assertEqual(terminal.pflege_flex_faktor, 1, 'B2: ursprünglicher Lauf ohne Pflege-Flex');
const captureBytes = JSON.stringify(meta.stressReplayCapture);
const path = materializeStressReplayPathV1({ capture: meta.stressReplayCapture, sourceLogRows: meta.logDataRows,
    sourceRequest: { schemaVersion: 'StressReplayE2ESourceRequestV1', inputs, widowOptions: inputs.widowOptions, monteCarloParams, useCapeSampling: false },
    dataFingerprint: createStressReplayFingerprint({ dataVersion: getDataVersion() }),
    engineFingerprint: createStressReplayFingerprint({ engineVersion: EngineAPI.version || 'EngineAPI' }),
    scenarioKey: 'he-5-letzter-tod', selectionMetric: 'nominal_terminal_wealth_eur' });
const replay = runStressReplayPathV1({ path, baselineInputs: inputs, sourceScenarioLog: meta.logDataRows, engine: EngineAPI });
assertEqual(replay.reconciliation.matched, true, 'B2: vollständiger Basisabgleich besteht');
const replayTerminal = replay.scenarioLog.records.at(-1);
const careFields = row => Object.fromEntries(Object.entries(row).filter(([key]) => key.startsWith('CareP') || key.startsWith('pflege_')));
assertEqual(JSON.stringify(careFields(replayTerminal)), JSON.stringify(careFields(terminal)), 'B2: sämtliche Pflegefelder der Todeszeile bytegleich');
assertEqual(replayTerminal.floor_brutto, 0, 'B2: Replay beendet vor der Jahresrechnung');
assertEqual(JSON.stringify(meta.stressReplayCapture), captureBytes, 'B2: Replay ändert gespeicherte Ereignisse nicht');
