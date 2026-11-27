import { EngineAPI } from '../engine/index.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { normalizeWidowOptions } from '../app/simulator/simulator-run-utils.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { initMcRunState, simulateOneYear, makeDefaultCareMeta, endCareForDeceased } from '../app/simulator/simulator-engine-wrapper.js';
import { rng } from '../app/simulator/simulator-utils.js';
import { inputs as fixtureInputs } from './extended/parity-replay-fixture.mjs';

const inputs = { ...structuredClone(fixtureInputs), survivorFloorPercent: 70, survivorFlexPercent: 75, survivorMinimumFlexPercent: 75, startAlter: 85, partner: { ...fixtureInputs.partner, startAlter: 75 },
    rentAdjMode: 'fix', rentAdjPct: 2, pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch',
    pflegeGradeConfigs: Object.fromEntries([1, 2, 3, 4, 5].map(grade => [grade, { zusatz: grade * 2000, flexCut: 1 - grade * .2, mortalityFactor: 0 }])),
    pflegeMaxFloor: 100000, pflegeRampUp: 1, pflegeKostenDrift: 0, pflegeRegionalZuschlag: 0 };
const widowOptions = normalizeWidowOptions(inputs.widowOptions);
// LE-1 (FR-75): Mit der Kohortentafel trifft Lauf 51 das Muster (vorher Lauf 3 von 20): Tod von A in beidseitiger Pflege, B später im Heim.
const monteCarloParams = { anzahl: 60, maxDauer: 12, methode: 'regime_markov', seed: 12345 };
const chunk = await runMonteCarloChunk({ inputs, widowOptions, monteCarloParams, runRange: { start: 51, count: 1 }, logIndices: [51],
    useCapeSampling: false, engine: EngineAPI });
assertEqual(chunk.financialMetricsValid, true, 'Pflegepfad bleibt auswertbar');
const rows = chunk.runMeta[0].logDataRows;
const deathIndex = rows.findIndex((row, index) => index > 0 && rows[index - 1].CareP1_Active && rows[index - 1].CareP2_Active && row.Person1Alive === 0 && row.Person2Alive === 1);
assert(deathIndex >= 1 && rows[deathIndex + 1]?.recordType === 'financial_year', 'Fester Seed: Muster A stirbt während beide Personen gepflegt werden; Muster B lebt weiter');
// FR-72 (HE-2): Muster B kommt nach dem Tod mit Grad 4 ins Heim; der Grundbedarf zu Hause entfällt,
// die Pflegekosten der Person umfassen dann Heimkosten und eigene Ausgaben.
assert(rows.some(row => row.CareP2_HeimJahr >= 1), 'Fester Seed: Muster B lebt später im Heim');
for (const row of rows.filter(row => row.recordType === 'financial_year')) {
    const homeFactor = row.jahr > rows[deathIndex].jahr ? (row.CareP2_HeimJahr >= 1 ? 0 : .7) : row.jahr == rows[deathIndex].jahr ? .85 : 1;
    assertClose(row.floor_brutto, inputs.startFloorBedarf * row.inflation_factor_cum * homeFactor + row.CareP1_Cost + row.CareP2_Cost, 1e-7, 'Grundbedarf enthält die Jahrespflegekosten, im Sterbejahr anteilig');
    assertClose(row.entscheidung.details.minimumFlexHouseholdFlexAnnual, row.flex_brutto_haushalt, 1e-7, 'Engine-Flexbasis entspricht dem Haushaltsflex im Log');
}
assert(rows[deathIndex].CareP1_Cost > 0, 'Sterbejahr enthält die halben Pflegekosten der verstorbenen Person');
for (const row of rows.slice(deathIndex + 1)) {
    assertEqual(row.pflege_aktiv, Boolean(row.CareP2_Active), 'Haushaltspflege zeigt die überlebende Person');
    assertEqual(row.pflege_zusatz_floor + (row.pflege_heimkosten ?? 0) + (row.pflege_heim_eigene_ausgaben ?? 0), row.CareP2_Cost, 'Haushaltspflege enthält nur Kosten der überlebenden Person');
    for (const key of ['CareP1_Cost', 'CareP1_Active']) {
        assertEqual(row[key], 0, `${key}: keine eingefrorenen Pflegewerte`);
    }
    if (!row.CareP2_Active) assertEqual(row.pflege_flex_faktor, 1, 'Ohne aktive Pflege kein eingefrorener Pflegefaktor');
}
// Gegenprobe am gemeinsamen Lebensereignispfad: beide leben.
const state = createMonteCarloLifeState(inputs, rng(42), widowOptions);
for (const [care, grade] of [[state.careMetaP1, 1], [state.careMetaP2, 2]]) Object.assign(care, {
    active: true, triggered: true, grade, currentYearInCare: 0, floorAtTrigger: 30000, flexAtTrigger: 30000, maxFloorAtTrigger: 100000 });
const year = { jahr: 2000, inflation: 2, rendite: .04, gold_eur_perf: 0, zinssatz: 2 };
const lifeYear = updateMonteCarloLifeEventsForYear(state, inputs, widowOptions, 0, year, 0, null, false, () => .999,
    initMcRunState(inputs));
assert(state.p1Alive && state.p2Alive, 'Gegenprobe ohne Tod');
// FR-38: Jahr 1 verwendet wie der Grundbedarf heutige Preise (Index 0).
assertClose(lifeYear.totalCareFloor, 6000, 1e-9, 'Ohne Tod bleiben beide Pflegekosten zu heutigen Preisen erhalten');
const result = simulateOneYear(initMcRunState(inputs), inputs, year, 0, state.careMetaP1,
    lifeYear.totalCareFloor, lifeYear.householdContext, lifeYear.effectiveFlexFactor, EngineAPI);
assertEqual(result.kind, 'success', 'Gemeinsamer Jahreseinstieg rechnet lebenden Haushalt');
assertClose(result.logData.floor_brutto, inputs.startFloorBedarf + 6000, 1e-9, 'Beide Pflegekosten erreichen den Jahreseinstieg');

// FR-40: Auch nach Tod mit PG4 schützt nur FR-26 den gesunden Resthaushalt.
// Großes Vermögen bzw. der alte Sicherheitsboden lassen die Obergrenze greifen.
// FR-88: Mit der vorschüssigen VPW-Rate greift die Obergrenze erst ab 24 statt 25 Jahren Horizont.
const stageInputs = { ...inputs, dynamicFlex: true, horizonYears: 24, startFlexBedarf: 10000, minimumFlexAnnual: 1000,
    renteMonatlich: 0, partner: { ...inputs.partner, monatsrente: 0, brutto: 0, startInJahren: 0, renteStartMonate: 12 } };
for (const stage of [0, 1, 2]) for (const survivorPension of [0, 60000]) {
    const care = { ...makeDefaultCareMeta(true), active: true, grade: 4, flexFactor: 0 };
    endCareForDeceased(care, false);
    assertEqual(JSON.stringify(care), JSON.stringify(makeDefaultCareMeta(true)), 'Nach PG4-Tod bleibt kein eigener Flex-Zustand');
    const stageState = initMcRunState(stageInputs);
    stageState.currentAnnualPension = 0;
    stageState.currentAnnualPension2 = survivorPension;
    stageState.survivor = { deathYearIndex: 0, deceasedProfileId: 'p1', survivorProfileId: 'p2' };
    Object.assign(stageState.lastState, { initialized: true, vpwSafetyStage: stage, vpwSafetyReentryRemaining: stage === 1 ? 3 : 0, vpwLastDynamicFlex: 100000 });
    const neutralState = structuredClone(stageState);
    let capturedInput;
    const engine = { ...EngineAPI, simulateSingleYear(input, lastState) {
        capturedInput = input; return EngineAPI.simulateSingleYear(input, lastState);
    } };
    const survived = simulateOneYear(stageState, stageInputs, year, 1, care, 0,
        { p1Alive: false, p2Alive: true, care: { p1: care, p2: null } }, .75, engine);
    const neutral = simulateOneYear(neutralState, stageInputs, year, 1, null, 0,
        { p1Alive: false, p2Alive: true, care: { p1: null, p2: null } }, .75, EngineAPI);
    assertEqual(survived.kind, 'success', 'Gesunder Haushalt nach PG4-Tod bleibt auswertbar');
    assertEqual(neutral.kind, 'success', 'Gegenprobe nach Tod ohne Pflege bleibt auswertbar');
    assertClose(capturedInput.flexBedarf, 7500, 1e-9, 'Ab Folgejahr gelten 75 % des Paar-Wunschs');
    if (!survivorPension) {
        assertClose(survived.logData.entscheidung.details.minimumFlexHouseholdFlexAnnual, 15000, 1e-9, 'FR-26 begrenzt auf zweimal 7.500 Euro Wunsch-Flex');
        assert(survived.logData.flex_haushalt_erfuellt > 7500, 'Auszahlung darf den einfachen Wunsch überschreiten');
        assert(survived.logData.flex_haushalt_erfuellt <= 15000, 'Auszahlung bleibt unter zweimal Wunsch');
    }
    for (const key of ['flex_brutto_haushalt', 'flex_haushalt_erfuellt', 'floor_brutto', 'renteSum']) {
        assertClose(survived.logData[key], neutral.logData[key], 1e-7, `${key}: PG4-Tod und Tod ohne Pflege haben denselben Rahmen`);
    }
}
// FR-17/23 bleiben: halbe PG4-Kosten, halbjährliche Bedarfs- und Rentenanteile.
{
    const deathInputs = { ...stageInputs, renteMonatlich: 1000, partner: { ...stageInputs.partner, brutto: 24000 } };
    const care = { ...makeDefaultCareMeta(true), active: true, grade: 4, flexFactor: 0,
        zusatzFloorZiel: 12000, zusatzFloorDelta: 12000 };
    let capturedInput;
    const engine = { ...EngineAPI, simulateSingleYear(input, lastState) {
        capturedInput = input; return EngineAPI.simulateSingleYear(input, lastState);
    } };
    const death = simulateOneYear(initMcRunState(deathInputs), deathInputs, { ...year, inflation: 0 }, 0, care, 12000,
        { p1Alive: false, p2Alive: true, care: { p1: care, p2: null } }, .75, engine);
    assertEqual(death.kind, 'success', 'PG4-Sterbejahr bleibt auswertbar');
    assertClose(capturedInput.floorBedarf, deathInputs.startFloorBedarf * .85 + 6000, 1e-7, 'Halber Paar-/Hinterbliebenengrundbedarf plus halbe Pflegekosten');
    assertClose(capturedInput.flexBedarf, 7500, 1e-7, 'Halbjährlicher Pflegefaktor aus PG4-Paar und gesundem Resthaushalt');
    assertClose(death.logData.CareP1_Cost, 6000, 1e-7, 'Sterbejahr loggt halbe Pflegekosten');
    assertClose(death.logData.rente1, 6000, 1e-7, 'Eigene Rente der verstorbenen Person zählt sechs Monate');
    assertClose(death.logData.rente2, 24000, 1e-7, 'Eigene Rente der überlebenden Person zählt zwölf Monate');
}

// Veraltete Ereigniskontexte werden lesend bereinigt; der übergebene Kontext bleibt unverändert.
const staleContext = { p1Alive: false, p2Alive: true, care: { p1: state.careMetaP1, p2: state.careMetaP2 } };
const staleBytes = JSON.stringify(staleContext);
const cleaned = simulateOneYear(initMcRunState(inputs), inputs, year, 0, state.careMetaP1,
    lifeYear.totalCareFloor, staleContext, lifeYear.effectiveFlexFactor, EngineAPI);
assertEqual(cleaned.kind, 'success', 'Gemeinsamer Jahreseinstieg korrigiert auch alte aktive Pflege Verstorbener');
assertClose(cleaned.logData.floor_brutto, inputs.startFloorBedarf * .85 + state.careMetaP1.zusatzFloorZiel * .5 + state.careMetaP2.zusatzFloorZiel, 1e-9, 'Veralteter Kontext zählt im Sterbejahr die halbe Pflege der verstorbenen Person');
assertEqual(cleaned.logData.pflege_zusatz_floor, state.careMetaP1.zusatzFloorZiel * .5 + state.careMetaP2.zusatzFloorZiel, 'Veralteter Kontext zeigt die anteiligen Jahrespflegekosten');
assertEqual(JSON.stringify(staleContext), staleBytes, 'Übergebener Ereigniskontext bleibt unverändert');

// B4: auch ein Ruin ohne Jahreslog behält nur die halben Sterbejahreskosten.
{
    const ruinInputs = { ...structuredClone(fixtureInputs), startAlter: 95,
        partner: { ...fixtureInputs.partner, startAlter: 65, brutto: 0, monatsrente: 0 },
        startVermoegen: 1, depotwertAlt: 0, tagesgeld: 1, geldmarktEtf: 0,
        simulationPeople: undefined, goldStrategyDiagnostics: undefined, detailledTranches: [],
        startFloorBedarf: 24000, startFlexBedarf: 24000, renteMonatlich: 0,
        pflegefallLogikAktivieren: true, pflegeRampUp: 1, pflegeMaxFloor: 100000,
        pflegeModellTyp: 'chronisch', pflegeKostenDrift: 0, pflegeRegionalZuschlag: 0,
        pflegeGradeConfigs: Object.fromEntries([1, 2, 3, 4, 5].map(grade =>
            [grade, { zusatz: 12000, flexCut: .25, mortalityFactor: 1 }])) };
    const ruin = await runMonteCarloChunk({ inputs: ruinInputs, widowOptions: normalizeWidowOptions(ruinInputs.widowOptions),
        monteCarloParams: { anzahl: 1, maxDauer: 1, seed: 33, methode: 'regime_markov', rngMode: 'per-run-seed' },
        runRange: { start: 0, count: 1 }, logIndices: [0], useCapeSampling: false, engine: EngineAPI });
    const [event] = ruin.runMeta[0].logDataRows;
    assert(event.recordType === 'terminal_ruin' && event.Person1Alive === 0 && event.Person2Alive === 1 && !event.CareP2_Active,
        'Fester Seed: P1 stirbt in Pflege, P2 bleibt ohne Pflege');
    const annualCost = 12000; // Erstes Simulationsjahr: heutige Preise, noch keine Inflation.
    assertClose(event.pflege_zusatz_floor, annualCost / 2, 1e-8, 'Ruin-Diagnose verwendet halbe Pflegekosten');
    assertClose(ruin.pathSummaries.p1CareAdditionalNeedNominalEur[0], annualCost / 2, 1e-8, 'Pfadzusammenfassung des Ruins verwendet halbe Pflegekosten');
    assertEqual(event.pflege_flex_faktor, .78125, 'Ruin-Diagnose verwendet den gemittelten Sterbejahresfaktor');
}
