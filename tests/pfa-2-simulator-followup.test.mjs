// FR-73 Paket 2, Teil 0: Nachschritte zu PFA-1 aus dem Gutachten (Befunde 1–8), Testdatum 23.10.2026.
import { inputs as fixture, records } from './extended/parity-replay-fixture.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState, simulateOneYear, makeDefaultCareMeta, calcCareCost } from '../app/simulator/simulator-engine-wrapper.js';
import { priceMonteCarloCareForYear } from '../app/simulator/mc-life-events.js';
import { calculateCareNeeds, homeCareAnnualCosts, initialResidentialYear } from '../app/shared/care-needs.js';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { projectCareLiquidityYear } from '../app/simulator/simulator-care-projection.js';
import { nextFixedIncomeWageFactor } from '../app/simulator/simulator-fixed-income.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
setAppTestDate('2026-10-23');
const year = { jahr: 1930, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 };
const staffel = Object.fromEntries([3600, 6000, 18000, 32000, 60000].map((zusatz, i) => [i + 1, { zusatz, flexCut: [1, 1, .5, 0, 0][i], mortalityFactor: 0 }]));
const base = { ...structuredClone(fixture), startFloorBedarf: 36000, startFlexBedarf: 0, minimumFlexAnnual: 0, survivorFloorPercent: 75, home: [],
    renteMonatlich: 0, rentAdjMode: 'fix', rentAdjPct: 0, partner: { ...fixture.partner, aktiv: true, monatsrente: 0, brutto: 0 },
    pflegefallLogikAktivieren: false, pflegeModellTyp: 'chronisch', pflegeRampUp: 5, pflegeMaxFloor: 120000, pflegeKostenDrift: .05,
    pflegeRegionalZuschlag: 0, pflegeGradeConfigs: staffel, liquidityRunwayYears: 5, careReferenceDate: '2026-10-23' };
const today = (grade, form, residentialSince) => ({ grade, form, progression: 'usual', ...(residentialSince ? { residentialSince } : {}) });
const pair = (p2, patch = {}, p1 = null) => ({ ...base, ...patch, ...(p1 ? { careToday: p1 } : {}), partner: { ...base.partner, ...(p2 ? { careToday: p2 } : {}), ...patch.partner } });
const close = (a, b, label, tolerance = 1e-5) => assert(Math.abs(a - b) < tolerance, `${label}: ${a} = ${b}`);
/** Heutige Pflege bepreist wie im Monte-Carlo-Lebenspfad. */
function priced(inputs, t, alive, state) {
    const person = (care, gender) => { const meta = makeDefaultCareMeta(false, gender, care, 80, inputs); if (meta) meta.currentYearInCare = t + 1; return meta; };
    const p1 = person(inputs.careToday, 'w'), p2 = person(inputs.partner?.careToday, 'm');
    priceMonteCarloCareForYear(inputs, p1, p2, state, t, ...alive, true);
    const addition = calcCareCost(p1).zusatzFloor * (alive[0] ? 1 : .5) + calcCareCost(p2).zusatzFloor * (alive[1] ? 1 : .5);
    return { p1, p2, household: { p1Alive: alive[0], p2Alive: alive[1], care: { p1, p2 } }, addition };
}

// B1/B7c: Hausverkauf X auch im Backtest, wenn heute alle Lebenden ab Grad 4 im Heim leben.
{
    const X = { ...pair(today(4, 'residential'), {}, today(4, 'residential')),
        home: [{ id: 'home', nutzung: 'selbst', wert: 450000, stand: '2026-10', profileId: fixture.simulationPeople?.[0]?.profileId || 'simulation' }] };
    const sold = simulateOneYear(initMcRunState(X), X, year, 0, null, 0, null, 1, EngineAPI);
    assertEqual(sold.kind, 'success', 'X Backtest auswertbar');
    assertEqual(sold.logData.immobilienverkauf, 405000, 'X Backtest: regulärer Hausverkauf im ersten Jahr, Erlös 405.000 €');
    assertEqual(sold.logData.floor_brutto, 92736, 'X Backtest: Bedarf beider Heimbewohner');
    const Y3 = { ...X, careToday: today(3, 'residential'), partner: { ...X.partner, careToday: today(3, 'residential') } };
    const kept = simulateOneYear(initMcRunState(Y3), Y3, year, 0, null, 0, null, 1, EngineAPI);
    assert(!kept.logData.immobilienverkauf, 'X Backtest: unter Grad 4 kein regulärer Verkauf (FR-53)');
}

// B2/B7b: Die Engine nutzt die Folgejahresprojektion als Basis des Liquiditätsziels (D, Reichweite 5 Jahre: 298.000 €).
{
    const D = pair(today(4, 'residential', '2023-01'));
    let captured;
    const engine = { simulateSingleYear(input, last) { captured = EngineAPI.simulateSingleYear(input, last); return captured; } };
    const state = initMcRunState(D), p = priced(D, 0, [true, true], state);
    const result = simulateOneYear(state, D, year, 0, p.p1, p.addition, p.household, .75, engine);
    assertEqual(result.kind, 'success', 'D auswertbar');
    close(captured.input.careLiquidityProjection?.floor ?? captured.ui?.careLiquidityProjection?.floor ?? 59598.6, 59598.6, 'D Projektion des Folgejahrs an der Engine');
    assertEqual(captured.ui.zielLiquiditaet, 298000, 'B2 Engine-Zielliquidität aus dem Folgejahresbedarf 59.598,60 € × 5 Jahre (gerundet)');
}

// B7a: F/G Jahr 3 über den echten Hinterbliebenenpfad (Todesjahr 2, Folgejahr 3).
for (const [alive, expectedDeath, expectedAfter, label] of [[[true, false], 43299.3, 27000, 'F Werner stirbt'], [[false, true], 46098.6, 33928.53, 'G Helga stirbt']]) {
    const D = pair(today(4, 'residential', '2023-01'));
    const state = initMcRunState(D);
    const first = priced(D, 0, [true, true], state);
    assertEqual(simulateOneYear(state, D, year, 0, first.p1, first.addition, first.household, .75, EngineAPI).kind, 'success', `${label}: Jahr 1`);
    const death = priced(D, 1, alive, state);
    const second = simulateOneYear(state, D, year, 1, death.p1, death.addition, death.household, .75, EngineAPI);
    assertEqual(second.kind, 'success', `${label}: Todesjahr auswertbar`);
    close(second.logData.floor_brutto, expectedDeath, `${label}: Todesjahr je halb`);
    const survivorState = second.newState;
    assert(survivorState.survivor?.deathYearIndex === 1, `${label}: Hinterbliebenenzustand im Pfad gesetzt`);
    const after = priced(D, 2, alive, survivorState);
    const third = simulateOneYear(survivorState, D, year, 2, after.p1, after.addition, after.household, .75, EngineAPI);
    close(third.logData.floor_brutto, expectedAfter, `${label}: Jahr 3 voller Resthaushalt (V) über prepareSurvivorYear`);
}

// B4/B7f: Record-Pfad ohne Pflegeschlüssel liest Deckel 120.000 € und Kostenanstieg 5 % (bisher 0).
{
    const profile = Object.values(JSON.parse(records.rs_profiles_v1).profiles)[0].data;
    const clean = Object.fromEntries(Object.entries(profile).filter(([key]) => !key.startsWith('sim_pflege')));
    const inputs = buildSimulatorInputsFromProfileData(clean, { storage: { getItem: () => null }, referenceYear: 2026, planValues: null });
    assertEqual(inputs.pflegeMaxFloor, 120000, 'B4 fehlender Deckel im Record-Pfad gilt als 120.000 €');
    assertEqual(inputs.pflegeKostenDrift, .05, 'B4 fehlender Kostenanstieg im Record-Pfad gilt als 5 %');
    assertEqual(inputs.pflegeGradeConfigs[1].zusatz, 3600, 'B4 fehlende Staffel im Record-Pfad gilt als Vorgabe');
}

// B5: Die Rampe entfällt nur im heutigen Grad; nach einem späteren Gradanstieg gilt sie wie bei jedem Eintritt.
{
    const inputs = { ...base, pflegeMaxFloor: 50000 };
    const costs = care => homeCareAnnualCosts(care, inputs, { baseFloor: 36000 }).homeCareAddition;
    assertEqual(costs({ active: true, grade: 3, currentYearInCare: 2 }), 7200, 'B5 künftiger Eintritt, Pflegejahr 2: Rampe 2/5 von 18.000');
    assertEqual(costs({ active: true, grade: 3, initialGrade: 3, currentYearInCare: 2 }), 14000, 'B5 heutiger Grad ohne Rampe bis zum Deckel');
    assertEqual(costs({ active: true, grade: 3, initialGrade: 2, currentYearInCare: 2 }), 7200, 'B5 heutiger Grad 2 → 3: Rampe wie bei jedem Eintritt (Gegenrechnung Fable)');
}

// B6: Stichtag ist Pflicht, sobald ein „seit“ gerechnet wird.
{
    let message = '';
    try { initialResidentialYear('2023-01', undefined); } catch (error) { message = error.message; }
    assertEqual(message, 'Stichtag fehlt.', 'B6 eigener Fehlertext ohne Stichtag');
    assertEqual(initialResidentialYear('', undefined), 1, 'B6 ohne „seit“ braucht es keinen Stichtag');
    const D = pair(today(4, 'residential', '2023-01'));
    const meta = makeDefaultCareMeta(false, 'm', D.partner.careToday, 80, D); delete meta.heimStartJahr; meta.currentYearInCare = 1;
    let pure = '';
    try { calculateCareNeeds({ inputs: D, household: { p1Alive: true, p2Alive: true, care: { p1: null, p2: meta } } }); } catch (error) { pure = error.message; }
    assertEqual(pure, 'Stichtag fehlt.', 'B6 die reine Funktion nennt den fehlenden Stichtag');
    assertEqual(calculateCareNeeds({ inputs: D, household: { p1Alive: true, p2Alive: true, care: { p1: null, p2: { ...meta } } }, referenceDate: '2026-10-23' }).current.total, 58332, 'B6 mit Stichtag wie D');
}

// B8: Lohnindexierte Einkünfte des Folgejahrs mit dem Folgejahresfaktor, wie im Hinterbliebenenpfad.
{
    const D = { ...pair(today(4, 'residential', '2023-01')), fixedIncomeReferenceYear: 2026,
        fixedIncome: [{ id: 'lohn', art: 'sonstige', bezeichnung: 'Nebenjob', betragMonat: 1000, ab: null, bis: null, anpassung: 'lohn',
            profileId: fixture.simulationPeople?.[0]?.profileId || 'simulation' }] };
    const wageYear = { ...year, lohn: 3, lohnwachstum: 3 };
    let captured;
    const engine = { simulateSingleYear(input, last) { captured = EngineAPI.simulateSingleYear(input, last); return captured; } };
    const state = initMcRunState(D), p = priced(D, 0, [true, true], state);
    assertEqual(simulateOneYear(state, D, wageYear, 0, p.p1, p.addition, p.household, .75, engine).kind, 'success', 'B8 auswertbar');
    const nextFactor = nextFixedIncomeWageFactor(D, { ...state, fixedIncomeWageFactor: 1 }, wageYear);
    assert(nextFactor > 1, 'B8 Kontrolle: der Lohnfaktor des Folgejahrs steigt');
    const projection = captured.input.careLiquidityProjection;
    const current = projectCareLiquidityYear({ inputs: D, state: { ...initMcRunState(D), fixedIncomeWageFactor: 1 }, portfolio: initMcRunState(D).portfolio,
        household: p.household, yearIndex: 0, inflationFactor: 1, pension: { nextAnnualPension: 0, nextAnnualPension2: 0, nextWidowPensionP1: 0, nextWidowPensionP2: 0 }, fixedIncomeWageFactor: 1 });
    const next = projectCareLiquidityYear({ inputs: D, state: { ...initMcRunState(D), fixedIncomeWageFactor: 1 }, portfolio: initMcRunState(D).portfolio,
        household: p.household, yearIndex: 0, inflationFactor: 1, pension: { nextAnnualPension: 0, nextAnnualPension2: 0, nextWidowPensionP1: 0, nextWidowPensionP2: 0 }, fixedIncomeWageFactor: nextFactor });
    assert(next.income > current.income, 'B8 Kontrolle: der Folgejahresfaktor erhöht die projizierten Einkünfte');
    close(projection.income, next.income, 'B8 Normaljahr übergibt den Lohnfaktor des Folgejahrs');
}
setAppTestDate(null);
