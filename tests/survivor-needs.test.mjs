import nodeAssert from 'node:assert/strict';
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs, records } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear, computeHouseholdFlexFactor } from '../app/simulator/simulator-engine-wrapper.js';
import { resolveSurvivorFlexFactors } from '../app/simulator/simulator-survivor.js';
import { validateSimulatorInputs } from '../app/simulator/simulator-input-validation.js';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';

const assert = Object.assign((value, message) => globalThis.assert(value, message), {
    equal: (actual, expected, message = 'FR-55: Jahresbetrag entspricht der Fachregel') => assertEqual(actual, expected, message),
    deepEqual: (actual, expected, message = 'FR-55: Prozentwerte bleiben exakt') => assertEqual(JSON.stringify(actual), JSON.stringify(expected), message),
    throws: (operation, pattern) => { nodeAssert.throws(operation, pattern); globalThis.assert(true, 'FR-55: ungültiger Hinterbliebenenbedarf wird abgewiesen'); }
});

const inputs = { ...structuredClone(fixtureInputs), survivorFloorPercent: 75, survivorFlexPercent: 50,
    survivorMinimumFlexPercent: 50, startFloorBedarf: 20000, startFlexBedarf: 10000, minimumFlexAnnual: 4000,
    renteMonatlich: 0, startAlter: 70, partner: { ...fixtureInputs.partner, startAlter: 65, monatsrente: 0, brutto: 0 },
    dynamicFlex: false, pflegefallLogikAktivieren: true };
const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const careFor = grade => ({ active: true, grade, flexFactor: ({ 1: 1, 3: .5, 4: 0 })[grade], zusatzFloorZiel: 2000 });
function run(input, household, deathThisYear, careFloor = 2000, index = 1) {
    const state = initMcRunState(input);
    if (!deathThisYear) state.survivor = { deathYearIndex: 0, deceasedProfileId: input.simulationPeople[0].profileId,
        survivorProfileId: input.simulationPeople[1].profileId };
    let captured, decision;
    const engine = { ...EngineAPI, simulateSingleYear(input, previous) {
        captured = input; decision = EngineAPI.simulateSingleYear(input, previous); return decision;
    } };
    const result = simulateOneYear(state, input, year, deathThisYear ? 0 : index, household.care.p1,
        careFloor, household, .75, engine);
    assert.equal(result.kind, 'success');
    return { captured, result, decision };
}
for (const grade of [1, 3, 4]) for (const deceased of [1, 2]) {
    const care = careFor(grade), factor = care.flexFactor;
    const household = { p1Alive: deceased !== 1, p2Alive: deceased !== 2,
        care: { p1: deceased === 2 ? care : null, p2: deceased === 1 ? care : null } };
    const survived = run(inputs, household, false);
    assert.equal(survived.captured.floorBedarf, 17000, '75 % Grundbedarf plus ungekürzte Pflege');
    assert.equal(survived.captured.flexBedarf, 5000 * factor, 'PG1/3/4: Wunsch 50/25/0 % des Paarwerts');
    assert.equal(survived.captured.minimumFlexAnnual, 2000 * factor, 'Mindest-Flex hat denselben zusätzlichen Pflegefaktor');
    const couple = computeHouseholdFlexFactor({ hasPartner: true, p1Alive: true, p2Alive: true,
        careMetaP1: household.care.p1, careMetaP2: household.care.p2 });
    const death = run(inputs, household, true);
    assert.equal(death.captured.floorBedarf, 19500, 'Todesjahr: halber Paar-/Hinterbliebenenbedarf plus Pflege');
    assert.equal(death.captured.flexBedarf, 10000 * (couple + .5 * factor) / 2, 'Todesjahr mittelt mit dem unveränderten Paar-Pflegefaktor');
    assert.equal(death.captured.minimumFlexAnnual, 4000 * (couple + .5 * factor) / 2);
}
const household = { p1Alive: false, p2Alive: true, care: { p1: null, p2: careFor(1) } };
const separate = run({ ...inputs, survivorFlexPercent: 60, survivorMinimumFlexPercent: 25 }, household, false);
assert.equal(separate.captured.flexBedarf, 6000);
assert.equal(separate.captured.minimumFlexAnnual, 1000, 'Mindest-Flex verwendet seinen eigenen Prozentwert');
for (const goGoActive of [false, true]) {
    const dynamic = run({ ...inputs, dynamicFlex: true, goGoActive, goGoMultiplier: 1.5, horizonYears: 20 }, household, false);
    const details = dynamic.decision.ui;
    assert.equal(details.vpw.staticFlexBaseline, 5000, 'S-Kurven-Wunschschutz und Wiedereinstieg verwenden den Hinterbliebenen-Wunsch');
    assert.equal(details.vpw.goGoMultiplier, goGoActive ? 1.5 : 1);
    assert.equal(details.vpw.wishFlexCapAnnual, 10000, 'FR-26 deckelt auch nach Go-Go auf 2 × Hinterbliebenen-Wunsch');
    assert(dynamic.result.logData.flex_haushalt_erfuellt <= 10000);
}
const valid = { ...inputs, survivorFlexPercent: 25, survivorMinimumFlexPercent: 60 };
assert.equal(validateSimulatorInputs(valid), valid, '60 % von 4000 liegt unter 25 % von 10000');
assert.throws(() => validateSimulatorInputs({ ...valid, survivorMinimumFlexPercent: 70 }), /Nach dem Tod einer Person.*Mindest-Flex.*Wunsch-Flex/);
const savedPercentages = { ...inputs, minimumFlexAnnual: 8000,
    survivorFlexPercent: 50, survivorMinimumFlexPercent: 80, pflegefallLogikAktivieren: false };
assert.throws(() => validateSimulatorInputs(savedPercentages), /Nach dem Tod einer Person.*Mindest-Flex.*Wunsch-Flex/);
const profileData = Object.values(JSON.parse(records.rs_profiles_v1).profiles)[0].data;
const defaults = buildSimulatorInputsFromProfileData(profileData, { referenceYear: 2026 });
for (const partner of [undefined, { aktiv: false }]) {
    const single = { ...defaults, partner, minimumFlexAnnual: 8000, startFlexBedarf: 10000,
        survivorFlexPercent: 50, survivorMinimumFlexPercent: 80, pflegefallLogikAktivieren: false };
    assert.equal(validateSimulatorInputs(single), single, 'Einzelperson: gespeicherte 80/50 % blockieren keine ausgeblendeten Hinterbliebenenfelder');
    const singleRun = await runMonteCarloChunk({ inputs: single, engine: EngineAPI,
        widowOptions: { mode: 'stop', percent: 0, marriageOffsetYears: 0, minMarriageYears: 0 },
        monteCarloParams: { anzahl: 1, maxDauer: 1, methode: 'regime_markov', seed: 12345 },
        runRange: { start: 0, count: 1 }, logIndices: [0], useCapeSampling: false });
    assert.equal(singleRun.technicalInventory.technicalError, 0, 'Einzelperson mit gespeicherten 80/50 % rechnet ohne technischen Fehler');
    assert.equal(singleRun.runMeta[0].logDataRows[0].recordType, 'financial_year', 'Einzelperson mit 80/50 % erhält ein berechnetes Finanzjahr');
}
for (const field of ['survivorFlexPercent', 'survivorMinimumFlexPercent']) {
    for (const invalid of [-1, 101, NaN, '']) assert.throws(() => validateSimulatorInputs({ ...inputs, [field]: invalid }));
}
assert.deepEqual([defaults.survivorFloorPercent, defaults.survivorFlexPercent, defaults.survivorMinimumFlexPercent], [75, 50, 50]);
const oldFloorOnly = buildSimulatorInputsFromProfileData({ ...profileData, sim_survivorFloorPercent: '70' }, { referenceYear: 2026 });
assert.deepEqual([oldFloorOnly.survivorFloorPercent, oldFloorOnly.survivorFlexPercent, oldFloorOnly.survivorMinimumFlexPercent], [70, 50, 50], 'FR-55: alte 70 % bleiben, nur fehlende Flex-Anteile erhalten 50 %');
const legacy = buildSimulatorInputsFromProfileData({ ...profileData, sim_survivorFloorPercent: '70', sim_survivorFlexPercent: '75', sim_survivorMinimumFlexPercent: '75' }, { referenceYear: 2026 });
assert.deepEqual([legacy.survivorFloorPercent, legacy.survivorFlexPercent, legacy.survivorMinimumFlexPercent], [70, 75, 75], 'Gespeicherte Werte bleiben exakt');
assert.equal(resolveSurvivorFlexFactors({ ...inputs, partner: { aktiv: false } }, household, false), null, 'Einzelpersonen bleiben unverändert');
const together = { p1Alive: true, p2Alive: true, care: { p1: careFor(3), p2: null } };
const old = run({ ...inputs, survivorFloorPercent: 70, survivorFlexPercent: 75, survivorMinimumFlexPercent: 75 }, together, true);
const current = run(inputs, together, true);
assertEqual(JSON.stringify(old.result), JSON.stringify(current.result), 'Vollständiges Paarjahr bleibt bytegleich');
console.log('FR-55: Pflegegrade, Todesrichtungen, halbjährliche Bedarfe, Dynamic Flex, Validierung und Altbestand geprüft.');

const largerFloor = { ...inputs, survivorFloorPercent: 150 };
assert.equal(run(largerFloor, household, false).captured.floorBedarf, 32000, '150 % Paargrundbedarf plus Pflege');
assert.equal(run(largerFloor, household, true).captured.floorBedarf, 27000, 'Todesjahr mittelt 100 und 150 % plus Pflege');
assert.equal(buildSimulatorInputsFromProfileData({ ...profileData, sim_survivorFloorPercent: '150' }, { referenceYear: 2026 }).survivorFloorPercent, 150, 'Profil liest gespeicherte 150 %');
for (const value of [39, 201]) assert.throws(() => validateSimulatorInputs({ ...inputs, survivorFloorPercent: value }), /40 und 200/);
