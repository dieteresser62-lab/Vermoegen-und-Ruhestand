// FR-72 Teil 4 (HE-4): Miete im Todesjahr (H-HE2-1), Netto-Kennzahl „Pflege-Mehrbedarf“ und gespeicherte
// Pflegeform im Protokoll. Ohne Inflation, Pflege-Kostenanstieg und Regionalzuschlag; Grundbedarf 36.000 €,
// Hinterbliebenenanteil 75 %, eigene Ausgaben 500 €/Monat. Heimjahr 1/2: 40.368 / 36.612 €.
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear, makeDefaultCareMeta, calcCareCost } from '../app/simulator/simulator-engine-wrapper.js';
import { priceMonteCarloCareForYear } from '../app/simulator/mc-life-events.js';
import { savedHomeFloorShares } from '../app/simulator/simulator-survivor.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';

const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const staffel = { 1: { zusatz: 6000, flexCut: 1, mortalityFactor: 0 }, 2: { zusatz: 12000, flexCut: 1, mortalityFactor: 0 },
    3: { zusatz: 18000, flexCut: .5, mortalityFactor: 0 }, 4: { zusatz: 32000, flexCut: 0, mortalityFactor: 0 },
    5: { zusatz: 60000, flexCut: 0, mortalityFactor: 0 } };
const couple = { ...structuredClone(fixtureInputs), startFloorBedarf: 36000, survivorFloorPercent: 75, home: [],
    renteMonatlich: 0, rentAdjMode: 'fix', rentAdjPct: 0, partner: { ...fixtureInputs.partner, monatsrente: 0, brutto: 0 },
    pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch', pflegeRampUp: 1, pflegeMaxFloor: 120000,
    pflegeKostenDrift: 0, pflegeRegionalZuschlag: 0, pflegeGradeConfigs: structuredClone(staffel) };
const single = { ...couple, startFloorBedarf: 24000, partner: { aktiv: false } };

const careMeta = (grade, extra = {}) => Object.assign(makeDefaultCareMeta(true, 'm'), { active: true, triggered: true,
    grade, gradeLabel: `Pflegegrad ${grade}`, currentYearInCare: 0 }, extra);
const homeCare = () => makeDefaultCareMeta(true, 'w');

/** Ein Jahr wie im Monte-Carlo-Lauf (siehe he-2-heimpflege), optional mit Miete nach Notverkauf. */
function runYear(inputs, { p1, p2 = null, yearIndex, p1Alive = true, p2Alive = inputs.partner?.aktiv === true,
    previouslyJointAlive = inputs.partner?.aktiv === true, state = initMcRunState(inputs), rent = 0 }) {
    for (const care of [p1, p2]) if (care?.active) care.currentYearInCare += 1;
    priceMonteCarloCareForYear(inputs, p1, p2, state, yearIndex, p1Alive, p2Alive, previouslyJointAlive);
    const yearCare = { p1: p1 ? { ...p1 } : null, p2: p2 ? { ...p2 } : null };
    const total = calcCareCost(yearCare.p1, null).zusatzFloor + (yearCare.p2 ? calcCareCost(yearCare.p2, null).zusatzFloor : 0);
    if (rent) state = { ...state, portfolio: { ...state.portfolio, homeRent: { amount: rent, inflationFactor: 1, startYear: 2026, active: true } } };
    const result = simulateOneYear(state, inputs, year, yearIndex, yearCare.p1, total, { p1Alive, p2Alive, care: yearCare }, 1, EngineAPI);
    assertEqual(result.kind, 'success', `Jahr ${yearIndex + 1} auswertbar`);
    return result;
}

// Punkt 7 (H-HE2-1): Nach einem Notverkauf wohnen beide im Heim, eine Person stirbt. Die Miete lebt im
// Todesjahr nicht für ein halbes Jahr wieder auf (bisher 6.000 €).
{
    const p1 = careMeta(4), p2 = careMeta(4);
    const first = runYear(couple, { p1, p2, yearIndex: 0, rent: 12000 });
    assertEqual(first.logData.wohnmiete, 0, 'Miete: beide im Heim, keine Miete');
    const death = runYear(couple, { p1, p2, yearIndex: 1, p1Alive: false, p2Alive: true, previouslyJointAlive: true, rent: 12000 });
    assertEqual(death.logData.wohnmiete, 0, 'Miete: im Todesjahr 0 €, beide lebten vorher im Heim');
    assertEqual(death.logData.floor_brutto, 63918, 'Miete: Bedarf wie Sollfall I ohne Miete');
}
// Ohne Heim unverändert: P1 im Heim, P2 zu Hause; stirbt P2, zählt die Miete halb, danach endet sie.
{
    const p1 = careMeta(4), p2 = homeCare();
    runYear(couple, { p1, p2, yearIndex: 0, rent: 12000 });
    const death = runYear(couple, { p1, p2, yearIndex: 1, p1Alive: true, p2Alive: false, previouslyJointAlive: true, rent: 12000 });
    assertEqual(death.logData.wohnmiete, 6000, 'Miete: P2 lebte zu Hause, im Todesjahr die Hälfte');
    const both = runYear(couple, { p1: careMeta(3), p2: homeCare(), yearIndex: 0, rent: 12000 });
    assertEqual(both.logData.wohnmiete, 12000, 'Miete: ohne Heim volle Miete');
}

// Punkt 4: eingesparter Grundbedarf je Person für die Netto-Kennzahl.
{
    const shares = (inputs, care, alive = {}, death = false) => savedHomeFloorShares(inputs, inputs.startFloorBedarf,
        { p1Alive: alive.p1 ?? true, p2Alive: alive.p2 ?? inputs.partner?.aktiv === true, care }, death);
    const p1 = careMeta(4), p2 = careMeta(4), atHome = homeCare();
    p1.currentYearInCare = p2.currentYearInCare = 1;
    priceMonteCarloCareForYear(couple, p1, p2, {}, 0, true, true, true);
    assertEqual(shares(couple, { p1, p2 }).join('/'), '18000/18000', 'B: beide im Heim sparen den ganzen Grundbedarf');
    priceMonteCarloCareForYear(couple, p1, atHome, {}, 0, true, true, true);
    assertEqual(shares(couple, { p1, p2: atHome }).join('/'), '9000/0', 'A: einer im Heim spart 25 %');
    assertEqual(shares(couple, { p1, p2: atHome }, { p1: false }, true).join('/'), '4500/0', 'F: Tod im Heim, Mischung 87,5 % gegen 75 %');
    assertEqual(shares(couple, { p1, p2: atHome }, { p2: false }, true).join('/'), '18000/0', 'H: Tod zu Hause, 87,5 % gegen 37,5 %');
    const q1 = careMeta(4), q2 = careMeta(4);
    q1.currentYearInCare = q2.currentYearInCare = 1;
    priceMonteCarloCareForYear(couple, q1, q2, {}, 0, true, true, true);
    assertEqual(shares(couple, { p1: q1, p2: q2 }, { p1: false }, true).join('/'), '10500/21000', 'I: Verstorbene zählt halb');
    const s1 = careMeta(4);
    s1.currentYearInCare = 1;
    priceMonteCarloCareForYear(single, s1, null, {}, 0, true, false, false);
    assertEqual(shares(single, { p1: s1, p2: null }).join('/'), '24000/0', 'C: allein im Heim spart den ganzen Grundbedarf');
    const noHome = careMeta(3);
    noHome.currentYearInCare = 1;
    priceMonteCarloCareForYear(couple, noHome, atHome, {}, 0, true, true, true);
    assertEqual(shares(couple, { p1: noHome, p2: atHome }).join('/'), '0/0', 'Ohne Heim nichts eingespart');
}

// Punkt 4: „Pflege-Mehrbedarf“ eines echten Monte-Carlo-Laufs ist netto. Allein, jede Pflege im Heim:
// je Jahr Heimkosten und eigene Ausgaben minus Grundbedarf (Deckelanker), negative Jahre zählen 0.
{
    const inputs = { ...structuredClone(fixtureInputs), partner: { aktiv: false }, startAlter: 84, pflegefallLogikAktivieren: true,
        pflegeModellTyp: 'chronisch' };
    for (const grade of [1, 2, 3, 4, 5]) inputs.pflegeGradeConfigs[grade] = { ...inputs.pflegeGradeConfigs[grade], careForm: 'residential' };
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: { anzahl: 24, maxDauer: 12, methode: 'block', blockSize: 1, seed: 4711 },
        logIndices: new Set(Array.from({ length: 24 }, (_, i) => i)), widowOptions: inputs.widowOptions, useCapeSampling: false, engine: EngineAPI });
    let heimRuns = 0;
    for (const run of chunk.runMeta.filter(item => !item.failed)) {
        let net = 0, gross = 0;
        for (const row of run.logDataRows.filter(item => item.recordType === 'financial_year' && item.CareP1_Active)) {
            const saved = row.CareP1_HeimJahr > 0 ? row.pflege_floor_anchor : 0;
            net += Math.max(0, row.CareP1_Cost - saved) / row.inflation_factor_cum;
            gross += row.CareP1_Cost / row.inflation_factor_cum;
        }
        if (gross - net > 1) heimRuns++;
        assertClose(run.totalCareAdditionalNeedRealEur, net, 1e-6, `Lauf ${run.index}: Pflege-Mehrbedarf netto (brutto wären ${Math.round(gross)} €)`);
    }
    assert(heimRuns >= 3, `Mehrere Läufe mit Heim zeigen den Abzug (${heimRuns})`);
}
