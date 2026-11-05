import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, makeDefaultCareMeta, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { createStressReplayCaptureRequest } from '../app/simulator/stress-replay-path-materializer.js';
import { rng } from '../app/simulator/simulator-utils.js';

const inputs = { ...structuredClone(fixtureInputs), startAlter: 85, startFloorBedarf: 40000,
    partner: { ...fixtureInputs.partner, startAlter: 75 }, survivorFloorPercent: 70,
    pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch', pflegeRampUp: 1,
    pflegeMaxFloor: 100000, pflegeKostenDrift: 0, pflegeRegionalZuschlag: 0,
    pflegeGradeConfigs: Object.fromEntries([1, 2, 3, 4, 5].map(grade =>
        [grade, { zusatz: 1000000, flexCut: 1, mortalityFactor: 3 }])) };
const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const activeCare = () => ({ ...makeDefaultCareMeta(true), active: true, triggered: true, grade: 2 });

// Beide Todesrichtungen: die gepflegte Person überlebt, der andere Partner stirbt.
// Sweep und Auto-Optimize verwenden genau diesen Lebensereignispfad.
for (const deceased of [0, 1, 2]) {
    const life = createMonteCarloLifeState(inputs, rng(42));
    const care = deceased === 1 ? life.careMetaP2 : life.careMetaP1;
    Object.assign(care, activeCare());
    life.rngCareP1 = life.rngCareP2 = () => .999999;
    let state = initMcRunState(inputs), draws = 0;
    const lifeYear = updateMonteCarloLifeEventsForYear(life, inputs, inputs.widowOptions,
        0, year, 0, null, false, () => ++draws === deceased ? 0 : .999999, state);
    assertEqual(draws, 2, 'Pflegeabschluss fügt keine Sterblichkeitsziehungen hinzu');
    assertEqual(care.currentYearInCare, 1, 'Sterblichkeitsrampe zählt das laufende Pflegejahr einmal');
    const factor = deceased ? .85 : 1;
    assertEqual(care.log_floor_anchor, 40000 * factor, 'Deckel verwendet den echten Grundbedarf im Paar-/Sterbejahr');
    assertEqual(care.log_cap_zusatz, 100000 - 40000 * factor, 'Zusatzdeckel: Paar 60.000, Sterbejahr 66.000');
    assertEqual(care.zusatzFloorZiel, care.log_cap_zusatz, 'Hoher Zusatzbedarf schöpft den Deckel aus');
    const first = simulateOneYear(state, inputs, year, 0, lifeYear.householdContext.care.p1,
        lifeYear.totalCareFloor, lifeYear.householdContext, lifeYear.effectiveFlexFactor, EngineAPI);
    assertEqual(first.kind, 'success', 'Synthetisches Deckeljahr bleibt auswertbar');
    assertEqual(first.logData.floor_brutto, 100000, 'Haushalt erreicht den maximalen Pflege-Floor');
    assertEqual(first.logData.pflege_floor_anchor, 40000 * factor, 'Diagnosefeld zeigt den korrigierten Jahresanker');
    assertEqual(first.logData.pflege_cap_zusatz, 100000 - 40000 * factor, 'Diagnosefeld zeigt den korrigierten Deckel');
    state = first.newState;
    if (!deceased) continue;
    const next = updateMonteCarloLifeEventsForYear(life, inputs, inputs.widowOptions,
        1, year, 0, null, true, () => .999999, state);
    assertEqual(care.log_floor_anchor, 28000, 'Hinterbliebenenjahr verwendet 70 % von 40.000');
    assertEqual(care.zusatzFloorZiel, 72000, 'Hinterbliebenenjahr: Deckel 100.000 minus 28.000');
    assertEqual(care.zusatzFloorDelta, 6000, 'Nur die neue Deckeldifferenz erhöht den kumulierten Zusatz');
    assertEqual(care.kumulierteKosten, 72000, 'Keine doppelte Kostenbuchung durch den Preisabschluss');
    const result = simulateOneYear(state, inputs, year, 1, next.householdContext.care.p1,
        next.totalCareFloor, next.householdContext, next.effectiveFlexFactor, EngineAPI);
    assertEqual(result.logData.floor_brutto, 100000, 'Hinterbliebenenhaushalt erreicht den maximalen Pflege-Floor');
}

// Echter MC einschließlich Replay-Schattenpfad nach Ruin: Jahresanker folgt dem
// Personenstatus. Im Schatten fehlt der finanzielle Zustand, nicht die Lebenshistorie.
for (const ruin of [false, true]) {
    const runInputs = { ...inputs, ...(ruin ? { startVermoegen: 150000, depotwertAlt: 150000,
        einstandAlt: 150000, tagesgeld: 0, geldmarktEtf: 0, detailledTranches: [],
        simulationPeople: undefined, goldStrategyDiagnostics: undefined, renteMonatlich: 0,
        partner: { ...inputs.partner, monatsrente: 0 }, startFlexBedarf: 0, minimumFlexAnnual: 0 } : {}) };
    const chunk = await runMonteCarloChunk({ inputs: runInputs, widowOptions: inputs.widowOptions,
        monteCarloParams: { anzahl: 20, maxDauer: 12, methode: 'regime_markov', seed: 12345 },
        logIndices: Array.from({ length: 20 }, (_, i) => i),
        stressReplayCapture: createStressReplayCaptureRequest(Array.from({ length: 20 }, (_, i) => i)),
        useCapeSampling: false, engine: EngineAPI });
    assertEqual(chunk.financialMetricsValid, true, 'MC-Deckelprobe bleibt auswertbar');
    let survivorCareYears = 0, deathCareYears = 0, shadowCareYears = 0;
    for (const meta of chunk.runMeta) {
        let previouslyJointAlive = true, factor = 1;
        for (const record of meta.stressReplayCapture.years) {
            const event = record.householdEvents[0];
            const singleAlive = event.p1Alive !== event.p2Alive;
            const floorFactor = singleAlive ? previouslyJointAlive ? .85 : .7 : 1;
            if (event.p1Alive || event.p2Alive) for (const care of [event.careMetaP1, event.careMetaP2]) {
                if (!care?.active) continue;
                assertClose(care.log_floor_anchor, 40000 * factor * floorFactor, 2,
                    'MC und Schattenpfad verwenden den Jahresbedarf; Euro-Rundung bleibt erhalten');
                assertClose(care.log_cap_zusatz, Math.max(0, 100000 * factor - care.log_floor_anchor), 1e-6,
                    'Deckel und Diagnose nutzen dieselbe tatsächliche Preisbasis');
                if (singleAlive) {
                    if (previouslyJointAlive) deathCareYears++; else survivorCareYears++;
                    if (record.continuation) shadowCareYears++;
                }
            }
            previouslyJointAlive = event.p1Alive && event.p2Alive;
            factor *= 1 + record.inflationPct / 100;
        }
    }
    assert(deathCareYears > 0 && survivorCareYears > 0, 'Fester Seed belegt Sterbejahr und Hinterbliebenenpflege');
    if (ruin) assert(shadowCareYears > 0, 'Deckelprobe erreicht die Hinterbliebenenpflege nach Ruin');
}
