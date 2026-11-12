// GA-2 / FR-43 (11.11.2026): Feste geplante Ausgaben zählen in ihren Monaten zum Grundbedarf.
// Sollfälle S1–S3 von Hand hergeleitet; S4/S5 stehen in balance-planned-posts.test.mjs.
import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { rng } from '../app/simulator/simulator-utils.js';
import { householdInput, marketYear } from './helpers/ff-c-scenarios.mjs';

const loan = { id: 'kredit', bezeichnung: 'Kredit', betragMonat: 1000, ab: '2027-07', bis: '2028-06', anpassung: 'keine' };
const withLoan = inputs => ({ ...inputs, plannedExpensesReferenceYear: 2027, plannedExpenses: [loan] });
const single = { ...householdInput(100000, 100000), startAlter: 70, partner: { aktiv: false },
    startFloorBedarf: 24000, startFlexBedarf: 20000, minimumFlexAnnual: 0, dynamicFlex: false, horizonYears: 30 };

/** Drei Jahre ab 2027; liefert die Jahreszeilen. */
function run(inputs, { death = false } = {}) {
    const widow = { mode: 'none', percent: 0 };
    const life = death ? createMonteCarloLifeState(inputs, rng(12345), widow) : null;
    let state = initMcRunState(inputs);
    const rows = [];
    for (let yearIndex = 0; yearIndex < 3; yearIndex++) {
        let draw = 0;
        const events = life ? updateMonteCarloLifeEventsForYear(life, inputs, widow, yearIndex, marketYear, yearIndex, null, false,
            () => yearIndex === 0 && ++draw === 2 ? 0 : .999999) : null;
        const result = simulateOneYear(state, inputs, { ...marketYear, inflation: 2 }, yearIndex, null, 0,
            events?.householdContext ?? null, events?.effectiveFlexFactor ?? 1, EngineAPI);
        assertEqual(result.kind, 'success', 'Jahr ist auswertbar');
        rows.push(result.logData);
        state = result.newState;
    }
    return { rows, life };
}

// S1: floor_brutto = F_t + 6.000 € in 2027 und 2028, = F_t in 2029; keine geplante Ausgabe als eigene Zahlung.
{
    const plain = run(single).rows, fixed = run(withLoan(single)).rows;
    [6000, 6000, 0].forEach((extra, index) => {
        assertClose(fixed[index].floor_brutto, plain[index].floor_brutto + extra, 1e-6, `S1: floor_brutto ${2027 + index} = F + ${extra}`);
        assertEqual(fixed[index].geplante_ausgaben || 0, 0, `S1: geplante_ausgaben ${2027 + index} ist 0`);
    });
}

// S2: eine von zwei Personen stirbt 2027; die feste Ausgabe zählt 2027 und 2028 voll (ohne Hinterbliebenenfaktor).
{
    const couple = { ...single, survivorFloorPercent: 70, survivorFlexPercent: 75, survivorMinimumFlexPercent: 75,
        partner: { aktiv: true, startAlter: 70, geschlecht: 'w', brutto: 0, monatsrente: 0 } };
    const plain = run(couple, { death: true }), fixed = run(withLoan(couple), { death: true });
    assertEqual(fixed.life.p2Alive, false, 'S2: Testpfad enthält den Todesfall');
    assert(plain.rows[1].floor_brutto < plain.rows[0].floor_brutto, 'S2: Hinterbliebenenfaktor senkt den übrigen Grundbedarf');
    [6000, 6000, 0].forEach((extra, index) => assertClose(fixed.rows[index].floor_brutto - plain.rows[index].floor_brutto, extra, 1e-6,
        `S2: feste Ausgabe ${2027 + index} ungekürzt im Grundbedarf`));
}

// S3: Dynamic Flex = VPW-Gesamtbetrag T − (F + X); ohne Deckel bleibt das Gesamtbudget T, mit Deckel (FR-26) gilt der Deckel.
for (const [startFlexBedarf, capped] of [[100000, false], [20000, true]]) {
    const dynamic = { ...single, dynamicFlex: true, startFlexBedarf, capeRatio: 20, marketCapeRatio: 20 };
    const year = inputs => simulateOneYear(initMcRunState(inputs), inputs, marketYear, 0, null, 0, null, 1, EngineAPI);
    const plain = year(dynamic), fixed = year(withLoan(dynamic));
    const T = plain.ui.vpw.vpwTotal, F = plain.logData.floor_brutto;
    assertClose(fixed.ui.vpw.vpwTotal, T, 1e-6, 'S3: VPW-Gesamtbetrag hängt nicht an der festen Ausgabe');
    assertClose(fixed.logData.floor_brutto, F + 6000, 1e-6, 'S3: Grundbedarf F + X');
    assertClose(fixed.ui.vpw.rawDynamicFlex, T - (F + 6000), 1e-6, 'S3: Flex = T − (F + X)');
    assertEqual(fixed.ui.vpw.wishFlexCapApplied === true, capped, 'S3: Deckel wie im Testfall vorgesehen');
    if (capped) assertClose(fixed.ui.vpw.dynamicFlex, plain.ui.vpw.dynamicFlex, 1e-6, 'S3: Deckel nach FR-26 gilt wie bisher');
    else assertClose(fixed.logData.floor_brutto + fixed.ui.vpw.dynamicFlex, T, 1e-6, 'S3: Gesamtbudget bleibt T');
}
