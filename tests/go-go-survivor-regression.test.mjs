import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { rng } from '../app/simulator/simulator-utils.js';
import { householdInput, marketYear } from './helpers/ff-c-scenarios.mjs';
import { ffgInput } from './helpers/ff-g-scenarios.mjs';

// Synthetischer Nullrenditepfad: keine Pflege/Rente, lange Restdauer und hohes
// CAPE. Die Sicherheitsstufe bleibt 0, damit allein die Altersgrenze entscheidet.
function runCouple(olderPerson, withDeath, usePreviousAgeRule = false) {
    const inputs = { ...householdInput(100000, 100000), survivorFloorPercent: 70, survivorFlexPercent: 75, survivorMinimumFlexPercent: 75,
        startAlter: olderPerson === 1 ? 79 : 73,
        partner: { aktiv: true, startAlter: olderPerson === 2 ? 79 : 73,
            geschlecht: 'w', brutto: 0, monatsrente: 0 },
        startFloorBedarf: 24000, startFlexBedarf: 120000, minimumFlexAnnual: 0,
        dynamicFlex: true, goGoActive: true, goGoMultiplier: 1.2,
        horizonYears: 50, capeRatio: 40, marketCapeRatio: 40 };
    const widow = { mode: 'none', percent: 0 };
    const life = createMonteCarloLifeState(inputs, rng(12345), widow);
    let state = initMcRunState(inputs), captured;
    const engine = { ...EngineAPI, simulateSingleYear(input, lastState) {
        captured = structuredClone(input);
        const engineInput = { ...input };
        if (usePreviousAgeRule) delete engineInput.goGoAge;
        return EngineAPI.simulateSingleYear(engineInput, lastState);
    } };
    const years = [];
    for (let yearIndex = 0; yearIndex <= 8; yearIndex++) {
        let draw = 0;
        const events = updateMonteCarloLifeEventsForYear(life, inputs, widow, yearIndex,
            marketYear, yearIndex, null, false,
            () => withDeath && yearIndex === 0 && ++draw === olderPerson ? 0 : .999999);
        const result = simulateOneYear(state, inputs, marketYear, yearIndex, null, 0,
            events.householdContext, events.effectiveFlexFactor, engine);
        assertEqual(result.kind, 'success', 'FR-31: vollständiges Simulatorjahr auswertbar');
        assertEqual(result.ui.vpw.safetyStage, 0, 'Altersprobe bleibt ohne zusätzliche Safety-Sperre');
        assertEqual(captured.aktuellesAlter, inputs.startAlter + yearIndex,
            'Das normale Fortschreibungsalter bleibt auch nach dem Tod erhalten');
        if (withDeath) {
            assertEqual(life.p1Alive, olderPerson !== 1, 'Lebensereignis erhält den Status der Hauptperson');
            assertEqual(life.p2Alive, olderPerson !== 2, 'Lebensereignis erhält den Status der zweiten Person');
            assertEqual(captured.goGoAge, 73 + yearIndex, 'Nur die lebende Person bestimmt das Go-Go-Alter');
        } else {
            assert(!Object.hasOwn(captured, 'goGoAge'), 'Ohne Todesfall bleibt der bisherige Eingabevertrag erhalten');
        }
        const active = withDeath && !usePreviousAgeRule ? yearIndex <= 7 : yearIndex <= 1;
        assertEqual(result.ui.vpw.goGoActive, active, 'Go-Go gilt bis einschließlich Alter 80 der ältesten lebenden Person');
        assertEqual(result.ui.vpw.goGoSuppressed, !active, 'Diagnose folgt derselben Altersgrenze');
        years.push({ input: captured, result });
        state = result.newState;
    }
    return years;
}

for (const olderPerson of [1, 2]) {
    const survivor = runCouple(olderPerson, true);
    const previous = runCouple(olderPerson, true, true);
    runCouple(olderPerson, false);
    const year = survivor[2];
    assertEqual(year.result.logData.entnahme_effektiv, 60000,
        'Im Nullrenditepfad erhält die überlebende Person mit 75 Jahren 60.000 Euro');
    assertEqual(previous[2].result.logData.entnahme_effektiv, 50400,
        'Die bisherige Altersprüfung zahlt mit Ehe-Erbschaftsteuer im Nullrenditepfad nur 50.400 Euro');
    for (const stage of [1, 2]) {
        const safety = EngineAPI.simulateSingleYear(year.input, { vpwSafetyStage: stage });
        assert(!safety.error, 'Safety-Gegenprobe ist auswertbar');
        assertEqual(safety.ui.vpw.goGoActive, false, 'Sicherheitsstufen unterdrücken Go-Go weiterhin');
        assertEqual(safety.ui.vpw.goGoSuppressed, true, 'Safety-Sperre bleibt in der Diagnose sichtbar');
    }
}

for (const [age1, age2, p2Alive] of [[81, null, false], [81, null, true], [81, 75, false], [75, 81, false]]) {
    const inputs = { ...householdInput(100000, 100000), survivorFloorPercent: 70, survivorFlexPercent: 75, survivorMinimumFlexPercent: 75, startAlter: age1,
        partner: { aktiv: age2 !== null, startAlter: age2, geschlecht: 'w', brutto: 0, monatsrente: 0 },
        startFloorBedarf: 24000, startFlexBedarf: 120000, minimumFlexAnnual: 0,
        dynamicFlex: true, goGoActive: true, goGoMultiplier: 1.2,
        horizonYears: 50, capeRatio: 40, marketCapeRatio: 40 };
    let captured;
    const engine = { ...EngineAPI, simulateSingleYear(input, lastState) {
        captured = structuredClone(input);
        return EngineAPI.simulateSingleYear(input, lastState);
    } };
    const result = simulateOneYear(initMcRunState(inputs), inputs, marketYear, 0, null, 0,
        { p1Alive: false, p2Alive }, 1, engine);
    assertEqual(result.kind, 'success', 'Direkter Jahresaufruf ohne lebende Haushaltsperson ist auswertbar');
    assert(!Object.hasOwn(captured, 'goGoAge'), 'Ohne lebende Person wird kein Go-Go-Alter 0 übergeben');
    assertEqual(captured.aktuellesAlter, age1, 'Auch ohne lebende Person bleibt das Fortschreibungsalter erhalten');
    assertEqual(result.ui.vpw.safetyStage, 0, 'Die Gegenprobe sperrt Go-Go allein durch das Alter');
    assertEqual(result.ui.vpw.goGoActive, false, 'Ohne lebende Person aktiviert Alter 0 Go-Go nicht erneut');
    assertEqual(result.ui.vpw.goGoSuppressed, true, 'Der direkte Aufruf verwendet die bisherige Altersgrenze');
}

for (const [age1, age2] of [[81, 75], [75, 81], [80, 74], [74, 80]]) {
    for (const goGoAge of [undefined, null, NaN, Infinity]) {
        const result = EngineAPI.simulateSingleYear({ ...ffgInput,
            aktuellesAlter: age1, partnerAlter: age2, goGoAge }, null);
        assert(!result.error, 'Engine-Fallback ohne endliche eigene Altersangabe ist auswertbar');
        assertEqual(result.ui.vpw.goGoActive, Math.max(age1, age2) <= 80,
            'Balance und Altinputs verwenden weiterhin das Maximum beider Alter');
    }
}
