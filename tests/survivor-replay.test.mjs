import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs } from './extended/parity-replay-fixture.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { createStressReplayCaptureRequest, materializeStressReplayPathV1 } from '../app/simulator/stress-replay-path-materializer.js';
import { createStressReplayFingerprint } from '../app/simulator/stress-replay-contract.js';
import { runStressReplayPathV1 } from '../app/simulator/stress-replay-runner.js';

function observeEngine(calls) {
    return { ...EngineAPI, simulateSingleYear(input, previous) {
        calls.push({ flex: input.flexBedarf, minimum: input.minimumFlexAnnual });
        return EngineAPI.simulateSingleYear(input, previous);
    } };
}

for (const deceased of [1, 2]) for (const dynamicFlex of [false, true]) {
    // Am Ende der Sterbetafel ist der Tod sicher; der junge Partner überlebt beim festen Seed.
    const inputs = { ...structuredClone(fixtureInputs), startAlter: deceased === 1 ? 110 : 18,
        partner: { ...fixtureInputs.partner, startAlter: deceased === 2 ? 110 : 18 },
        startFloorBedarf: 20000, startFlexBedarf: 10000, minimumFlexAnnual: 4000,
        survivorFloorPercent: 75, survivorFlexPercent: 50, survivorMinimumFlexPercent: 25,
        pflegefallLogikAktivieren: false, careToday: { grade: 0 }, dynamicFlex,
        accumulationPhase: { enabled: false } };
    inputs.partner.careToday = { grade: 0 };
    const monteCarloParams = { anzahl: 1, maxDauer: 2, methode: 'block', blockSize: 3,
        seed: 12345, rngMode: 'per-run-seed' };
    const sourceCalls = [];
    const source = await runMonteCarloChunk({ inputs, monteCarloParams, widowOptions: inputs.widowOptions,
        runRange: { start: 0, count: 1 }, logIndices: [0], useCapeSampling: false,
        stressReplayCapture: createStressReplayCaptureRequest([0]), engine: observeEngine(sourceCalls) });
    assertEqual(source.technicalInventory.technicalError, 0, 'Todesjahr: normaler MC-Lauf bleibt auswertbar');
    const meta = source.runMeta[0];
    assertEqual(meta.logDataRows.length, 2, 'Todesjahr und erstes volles Hinterbliebenenjahr werden berechnet');
    assertEqual(meta.logDataRows[0].SurvivorDeathYear, true, 'Erstes Jahr ist nachweislich das Todesjahr');
    assertEqual(meta.logDataRows[1].SurvivorDeathYear, false, 'Folgejahr enthält keinen zweiten Todesfall');
    assertEqual(meta.logDataRows[0][`Person${deceased}Alive`], 0, 'Gewählte Todesrichtung wird ausgeführt');
    assertEqual(sourceCalls[0].flex, 7500, 'Todesjahr: Wunsch-Flex mittelt 100 % Paar und 50 % allein');
    assertEqual(sourceCalls[0].minimum, 2500, 'Todesjahr: Mindest-Flex mittelt 100 % Paar und 25 % allein');
    assertEqual(meta.stressReplayCapture.years[0].householdEvents[0].effectiveFlexFactor, .5,
        'Replay-Tape speichert den Ereignisfaktor nach dem Tod ohne Halbjahresmischung');

    // Auch der Lebenshelfer des Schattenpfads liefert denselben ungemischten Ereignisfaktor.
    const rand = () => .999999;
    rand.fork = () => rand;
    const state = initMcRunState(inputs);
    const life = createMonteCarloLifeState(inputs, rand);
    const yearData = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
    const lifeYear = updateMonteCarloLifeEventsForYear(life, inputs, inputs.widowOptions,
        0, yearData, 0, null, false, rand, state);
    assertEqual(lifeYear.effectiveFlexFactor, .5, 'mc-life-events: Todesjahr liefert den Folgejahresfaktor');
    const helperCalls = [];
    const helperYear = simulateOneYear(state, inputs, yearData, 0, life.careMetaP1,
        lifeYear.totalCareFloor, lifeYear.householdContext, lifeYear.effectiveFlexFactor, observeEngine(helperCalls));
    assertEqual(helperYear.kind, 'success', 'Lebenshelfer und Jahresadapter berechnen das Todesjahr');
    assertEqual(JSON.stringify(helperCalls), JSON.stringify([sourceCalls[0]]),
        'Lebenshelfer und normaler Lauf übergeben dieselben Flex-Beträge im Todesjahr');

    const path = materializeStressReplayPathV1({ capture: meta.stressReplayCapture,
        sourceLogRows: meta.logDataRows, sourceRequest: { inputs, monteCarloParams },
        dataFingerprint: createStressReplayFingerprint({ data: 'survivor-replay-fixture' }),
        engineFingerprint: createStressReplayFingerprint({ engine: EngineAPI.getVersion() }),
        scenarioKey: `death-${deceased}-${dynamicFlex}`, selectionMetric: 'nominal_terminal_wealth_eur' });
    const replayCalls = [];
    const replay = runStressReplayPathV1({ path, baselineInputs: inputs, sourceScenarioLog: meta.logDataRows,
        engine: observeEngine(replayCalls), captureTransactions: false });
    assertEqual(replay.technicalError, null, 'Stresspfad-Replay bleibt ohne technischen Fehler');
    assertEqual(replay.reconciliation.matched, true, 'Replay gleicht das Todesjahr und Folgejahr mit dem MC-Pfad ab');
    assertEqual(JSON.stringify(replayCalls), JSON.stringify(sourceCalls),
        'Beide Todesrichtungen mit/ohne Dynamic Flex: Replay und MC erhalten dieselben Wunsch-/Mindest-Flex-Beträge');
}
