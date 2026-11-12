import { readLE1References } from './helpers/le-1-expectations.mjs';
import { readGU1References } from './helpers/gu-1-expectations.mjs';
import { readPFA1References } from './helpers/pfa-1-expectations.mjs';
// FR-72 Teil 2 (HE-2): Heimpflege ersetzt den Grundbedarf in Monte Carlo.
// Sollfälle A–K aus FR-72, ohne Inflation, Pflege-Kostenanstieg und Regionalzuschlag; Grundbedarf
// 36.000 €, Hinterbliebenenanteil 75 %, eigene Ausgaben 500 €/Monat. Heimjahr 1/2/3/4:
// 40.368 / 36.612 / 31.596 / 25.332 €. Die Werte sind von Hand hergeleitet und stehen in FR-72.
// Die Sollfälle verwenden nur bereits vorhandene Einstiege; die neuen Hilfen folgen weiter unten.
import { createHash } from 'node:crypto';
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs, runFixture } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear, makeDefaultCareMeta, calcCareCost } from '../app/simulator/simulator-engine-wrapper.js';
import { priceMonteCarloCareForYear, createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { normalizeWidowOptions } from '../app/simulator/simulator-sweep-utils.js';
import { homeRentForYear } from '../app/simulator/simulator-home-sale.js';
import { unmarriedYearShares } from '../app/simulator/simulator-unmarried.js';
import { rng } from '../app/simulator/simulator-utils.js';

const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const staffel = { 1: { zusatz: 6000, flexCut: 1, mortalityFactor: 0 }, 2: { zusatz: 12000, flexCut: 1, mortalityFactor: 0 },
    3: { zusatz: 18000, flexCut: .5, mortalityFactor: 0 }, 4: { zusatz: 32000, flexCut: 0, mortalityFactor: 0 },
    5: { zusatz: 60000, flexCut: 0, mortalityFactor: 0 } };
const couple = { ...structuredClone(fixtureInputs), startFloorBedarf: 36000, survivorFloorPercent: 75, home: [],
    renteMonatlich: 0, rentAdjMode: 'fix', rentAdjPct: 0, partner: { ...fixtureInputs.partner, monatsrente: 0, brutto: 0 },
    pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch', pflegeRampUp: 1, pflegeMaxFloor: 120000,
    pflegeKostenDrift: 0, pflegeRegionalZuschlag: 0, pflegeGradeConfigs: structuredClone(staffel) };
const single = { ...couple, startFloorBedarf: 24000, partner: { aktiv: false } };
const HEIM = [40368, 36612, 31596, 25332];

const careMeta = (grade, extra = {}) => Object.assign(makeDefaultCareMeta(true, 'm'), { active: true, triggered: true,
    grade, gradeLabel: `Pflegegrad ${grade}`, currentYearInCare: 0 }, extra);
const todayCare = (inputs, today) => makeDefaultCareMeta(true, 'm', today, 80, inputs);
const homeCare = () => makeDefaultCareMeta(true, 'w');

/** Ein Jahr wie im Monte-Carlo-Lauf: Pflegejahr zählen, Preise nach den Todesziehungen, Jahresrechnung. */
function runYear(inputs, { p1, p2 = null, yearIndex, p1Alive = true, p2Alive = inputs.partner?.aktiv === true,
    previouslyJointAlive = inputs.partner?.aktiv === true, state = initMcRunState(inputs) }) {
    for (const care of [p1, p2]) if (care?.active) care.currentYearInCare += 1;
    priceMonteCarloCareForYear(inputs, p1, p2, state, yearIndex, p1Alive, p2Alive, previouslyJointAlive);
    const yearCare = { p1: p1 ? { ...p1 } : null, p2: p2 ? { ...p2 } : null };
    const total = calcCareCost(yearCare.p1, null).zusatzFloor + (yearCare.p2 ? calcCareCost(yearCare.p2, null).zusatzFloor : 0);
    const context = { p1Alive, p2Alive, care: yearCare };
    const result = simulateOneYear(state, inputs, year, yearIndex, yearCare.p1, total, context, 1, EngineAPI);
    assertEqual(result.kind, 'success', `Jahr ${yearIndex + 1} auswertbar`);
    return result;
}

// A: P2 ohne Pflege zu Hause, P1 kommt künftig mit Grad 4 ins Heim.
{
    const p1 = careMeta(4), p2 = homeCare();
    [73368, 69612, 64596, 58332, 58332].forEach((expected, yearIndex) => {
        const result = runYear(couple, { p1, p2, yearIndex });
        assertEqual(result.logData.floor_brutto, expected, `A: Heimjahr ${yearIndex + 1} = 27.000 + Heimkosten + 6.000`);
    });
    assertEqual(p1.heimJahr, 5, 'A: Heimjahr zählt ab dem ersten Heimjahr');
    assertEqual(p1.zusatzFloorZiel, 0, 'A: kein Staffelzusatz im Heim');
}

// B: beide kommen im selben Jahr mit Grad 4 ins Heim (bisher 100.000 €).
{
    const p1 = careMeta(4), p2 = careMeta(4);
    [92736, 85224, 75192, 62664, 62664].forEach((expected, yearIndex) => {
        const result = runYear(couple, { p1, p2, yearIndex });
        assertEqual(result.logData.floor_brutto, expected, `B: Heimjahr ${yearIndex + 1} ohne Grundbedarf`);
        if (yearIndex === 0) {
            assertEqual(result.logData.grundbedarf_zu_hause, 0, 'B: verbleibender Grundbedarf 0');
            assertEqual(result.logData.pflege_heimkosten, 2 * HEIM[0], 'B: Heimkosten getrennt protokolliert');
            assertEqual(result.logData.pflege_heim_eigene_ausgaben, 12000, 'B: eigene Ausgaben getrennt protokolliert');
            assertEqual(result.logData.pflege_zusatz_floor, 0, 'B: kein Pflegezusatz zu Hause');
            assertEqual(result.logData.CareP1_HeimZuschuss, .15, 'B: Zuschussstufe im ersten Heimjahr');
            assertEqual(result.logData.CareP2_HeimJahr, 1, 'B: Heimjahr je Person');
            assertEqual(result.logData.CareP1_Cost, HEIM[0] + 6000, 'B: Pflegekosten der Person umfassen die Heimposten');
        }
    });
}

// C: alleinstehend, Grundbedarf 24.000 €, künftig Grad 4 im Heim, Heimjahr 1.
{
    const result = runYear(single, { p1: careMeta(4), yearIndex: 0 });
    assertEqual(result.logData.floor_brutto, 46368, 'C: Alleinstehend im Heim ohne Grundbedarf');
}

// D: alleinstehend, Grad 1 im Heim (Zeile 1 „im Heim“), ohne Zuschuss in jedem Jahr.
{
    const inputs = { ...single, pflegeGradeConfigs: { ...structuredClone(staffel), 1: { ...staffel[1], careForm: 'residential' } } };
    const p1 = careMeta(1);
    for (const yearIndex of [0, 1, 2, 3, 4]) {
        assertEqual(runYear(inputs, { p1, yearIndex }).logData.floor_brutto, 50124, `D: Grad 1 im Heim, Jahr ${yearIndex + 1}`);
    }
}

// E: heute Grad 4 im Heim, Fortschritt auf Grad 5: kein Zusatz, keine eigenen Ausgaben, Form bleibt Heim.
{
    const inputs = { ...couple, careToday: { grade: 4, form: 'residential', progression: 'usual' } };
    const p1 = todayCare(inputs, inputs.careToday), p2 = homeCare();
    const before = runYear(inputs, { p1, p2, yearIndex: 0 });
    assertEqual(before.logData.floor_brutto, 73368, 'FR-73: heutige Heimpflege ersetzt den Grundbedarf');
    p1.grade = 5;
    p1.gradeLabel = 'Pflegegrad 5';
    const after = runYear(inputs, { p1, p2, yearIndex: 1 });
    assertEqual(after.logData.floor_brutto, 69612, 'FR-73: Gradwechsel setzt Heimjahr nicht zurück');
    assertEqual(after.logData.CareP1_Cost, 42612, 'FR-73: Heimkosten und eigene Ausgaben');
    assertEqual(after.logData.CareP1_Form, 'residential', 'E: Form bleibt Heim');
    assertEqual(after.logData.CareP1_HeimJahr, 2, 'FR-73: kein neuer heimBestand');
}

// F: wie A, P1 stirbt im Heimjahr 2 (bisherige FR-55-Mischung 52.806 €).
{
    const p1 = careMeta(4), p2 = homeCare();
    runYear(couple, { p1, p2, yearIndex: 0 });
    const death = runYear(couple, { p1, p2, yearIndex: 1, p1Alive: false, p2Alive: true, previouslyJointAlive: true });
    assertEqual(death.logData.floor_brutto, 48306, 'F: 27.000 + (36.612 + 6.000) / 2');
}

// H: wie A, aber P2 (zu Hause) stirbt im Heimjahr 2.
{
    const p1 = careMeta(4), p2 = homeCare();
    runYear(couple, { p1, p2, yearIndex: 0 });
    const death = runYear(couple, { p1, p2, yearIndex: 1, p1Alive: true, p2Alive: false, previouslyJointAlive: true });
    assertEqual(death.logData.floor_brutto, 56112, 'H: 27.000 / 2 + 36.612 + 6.000');
}

// I: beide im Heim, eine Person stirbt im Heimjahr 2.
{
    const p1 = careMeta(4), p2 = careMeta(4);
    runYear(couple, { p1, p2, yearIndex: 0 });
    const death = runYear(couple, { p1, p2, yearIndex: 1, p1Alive: false, p2Alive: true, previouslyJointAlive: true });
    assertEqual(death.logData.floor_brutto, 63918, 'I: 42.612 + 42.612 / 2');
}

// J: Bestand 70.000 € (P1 heute im Heim), P2 kommt künftig ins Heim, dessen Heimjahr 1.
{
    const inputs = { ...couple, startFloorBedarf: 70000, careToday: { grade: 4, form: 'residential', progression: 'usual' } };
    const result = runYear(inputs, { p1: todayCare(inputs, inputs.careToday), p2: careMeta(4), yearIndex: 0 });
    assertEqual(result.logData.floor_brutto, 92736, 'FR-73: beide im Heim ersetzen den ganzen Grundbedarf');
}

// K: Altwert von Hand 4.000 €/Monat; die Bestandteile werden mit k = 4.000 / 3.363,80 skaliert.
{
    const careValues = structuredClone((await import('../app/shared/household-care-values.js')).DEFAULT_CARE_VALUES);
    careValues.residential = { ...careValues.residential, monthly: 4000, origin: 'von Hand' };
    delete careValues.residential.components;
    const inputs = { ...single, startFloorBedarf: 24000, careValues };
    const p1 = careMeta(4);
    [4000, 3628, 3131, 2510].forEach((monthly, yearIndex) => {
        assertEqual(runYear(inputs, { p1, yearIndex }).logData.floor_brutto, monthly * 12 + 6000, `K: Heimjahr ${yearIndex + 1} ${monthly} €/Monat`);
    });
}

// G: Rücklage „Nur Pflege-Mehrkosten“, Fall B Heimjahr 1: Deckungsgrenze 80.736 € (ohne eigene Ausgaben).
{
    // Nur Tagesgeld: die Rücklage stammt daraus, der Rest bestimmt die Finanzierungslücke.
    const reserve = (tagesgeld, initialAmount) => ({ ...couple, startVermoegen: tagesgeld, depotwertAlt: 0, einstandAlt: 0,
        tagesgeld, geldmarktEtf: 0, detailledTranches: [], simulationPeople: undefined, goldStrategyDiagnostics: undefined,
        startFlexBedarf: 0, minimumFlexAnnual: 0, goldAktiv: false, goldWert: 0,
        healthBucket: { enabled: true, initialAmount, triggerMinGrade: 4, triggerMode: 'OR',
            coverageMode: 'care_additional_floor_only', returnMode: 'cash_return' } });
    const large = runYear(reserve(115000, 100000), { p1: careMeta(4), p2: careMeta(4), yearIndex: 0 });
    assertEqual(large.logData.health_bucket_triggered, true, 'G: Auslöser erfüllt');
    assertEqual(large.logData.health_bucket_eligible_need, 80736, 'G: Deckungsgrenze 2 × 40.368');
    assertEqual(large.logData.health_bucket_used, 80736, 'G: Auszahlung bis zur Deckungsgrenze');
    const small = runYear(reserve(160000, 100000), { p1: careMeta(4), p2: careMeta(4), yearIndex: 0 });
    // Lücke: 92.736 Entnahme + 7.728 Monatspuffer − 60.000 Tagesgeld = 40.464 €.
    assertEqual(small.logData.health_bucket_eligible_need, 40464, 'G: kleinere Lücke begrenzt die Auszahlung');
    assertEqual(small.logData.health_bucket_used, small.logData.health_bucket_eligible_need, 'G: Auszahlung höchstens bis zur Lücke');
}

// Gemeinsamer Lebensereignispfad (Sweeps, Fortsetzung nach Ruin) rechnet dasselbe wie der Hauptlauf.
{
    const options = normalizeWidowOptions(couple.widowOptions);
    const life = createMonteCarloLifeState(couple, rng(12345), options);
    Object.assign(life.careMetaP1, careMeta(4));
    // Feste Ziehungen: kein Fortschritt, kein neuer Pflegefall, kein Tod.
    life.rngCareP1 = life.rngCareP2 = /** @type {any} */ (() => .999999);
    const state = initMcRunState(couple);
    [73368, 69612].forEach((expected, yearIndex) => {
        const lifeYear = updateMonteCarloLifeEventsForYear(life, couple, options, yearIndex, year, 0, null, false, () => .999999, state);
        const result = simulateOneYear(state, couple, year, yearIndex, life.careMetaP1, lifeYear.totalCareFloor,
            lifeYear.householdContext, lifeYear.effectiveFlexFactor, EngineAPI);
        assertEqual(result.logData.floor_brutto, expected, `Lebensereignispfad: Heimjahr ${yearIndex + 1} wie Sollfall A`);
    });
}

// Haushalt ohne Heim: Bedarf exakt wie bisher (Grundbedarf × FR-55-Faktor + Zusatz zu Hause).
{
    const p1 = careMeta(3), p2 = homeCare();
    const result = runYear(couple, { p1, p2, yearIndex: 0 });
    assertEqual(result.logData.floor_brutto, 36000 + 18000, 'Ohne Heim: Grad 3 zu Hause wie bisher');
    assert(!Object.hasOwn(p1, 'heimJahr') && !Object.hasOwn(result.logData, 'grundbedarf_zu_hause'), 'Ohne Heim: kein Heimzustand');
    const death = runYear(couple, { p1, p2, yearIndex: 1, p1Alive: true, p2Alive: false, previouslyJointAlive: true });
    assertEqual(death.logData.floor_brutto, 36000 * (1 + .75) / 2 + 18000, 'Ohne Heim: Todesjahr nach FR-55');
    const amtlich = { ...couple, pflegeKostenStaffelPreset: 'amtlich' };
    const official = careMeta(4);
    const officialResult = runYear(amtlich, { p1: official, p2: homeCare(), yearIndex: 0 });
    assertEqual(officialResult.logData.floor_brutto, 36000 + 32000, 'Amtlich ohne gezogene Zahl (Backtest, ältere Replays): wie bisher, keine Ersatzrechnung');
    assert(!Object.hasOwn(official, 'heimJahr'), 'Amtlich ohne gezogene Zahl: kein Heimzustand');
}

// Heimjahr idempotent: ein doppelter Preisaufruf im selben Jahr zählt nicht weiter.
{
    const p1 = careMeta(4), p2 = homeCare(), state = initMcRunState(couple);
    for (const yearIndex of [0, 1]) {
        priceMonteCarloCareForYear(couple, p1, p2, state, yearIndex, true, true, true);
        const first = JSON.stringify([p1.heimJahr, p1.heimKosten, p1.heimEigeneAusgaben, p1.heimZuschuss]);
        priceMonteCarloCareForYear(couple, p1, p2, state, yearIndex, true, true, true);
        assertEqual(JSON.stringify([p1.heimJahr, p1.heimKosten, p1.heimEigeneAusgaben, p1.heimZuschuss]), first, `Doppelter Preisaufruf im Jahr ${yearIndex + 1}`);
    }
    assertEqual(p1.heimJahr, 2, 'Heimjahr nach zwei Jahren');
    // Replay: die gespeicherte Form gilt ohne neue Ziehung.
    const replayed = JSON.parse(JSON.stringify({ p1, p2 }));
    const replay = simulateOneYear(state, couple, year, 1, replayed.p1, 0, { p1Alive: true, p2Alive: true, care: replayed }, 1, EngineAPI);
    assertEqual(replay.logData.floor_brutto, 69612, 'Replay übernimmt Heimjahr und Kosten aus dem gespeicherten Zustand');
}

// Punkt 15: Endet akute Pflege, gilt der Grundbedarf zu Hause wieder.
{
    const p1 = careMeta(4), p2 = homeCare();
    runYear(couple, { p1, p2, yearIndex: 0 });
    Object.assign(p1, { active: false, grade: null, gradeLabel: '' });
    const result = runYear(couple, { p1, p2, yearIndex: 1 });
    assertEqual(result.logData.floor_brutto, 36000, 'Ende akuter Pflege: Heimposten enden');
    assert(!Object.hasOwn(p1, 'heimJahr'), 'Ende akuter Pflege: Heimzustand gelöscht');
}

// Punkt 14: Miete nach Notverkauf endet, wenn alle Lebenden im Heim sind, auch bei Grad 3.
{
    const inputs = { ...couple, pflegeGradeConfigs: { ...structuredClone(staffel), 3: { ...staffel[3], careForm: 'residential' } } };
    const rent = () => ({ homeRent: { amount: 12000, inflationFactor: 1, startYear: 2026, active: true } });
    const p1 = careMeta(3), p2 = careMeta(3);
    priceMonteCarloCareForYear(inputs, p1, p2, {}, 0, true, true, true);
    assertEqual(homeRentForYear(rent(), inputs, { p1Alive: true, p2Alive: true, care: { p1, p2 } }, 1), 0, 'Miete endet bei Grad 3 im Heim');
    const atHome = homeCare();
    priceMonteCarloCareForYear(inputs, p1, atHome, {}, 0, true, true, true);
    assertEqual(homeRentForYear(rent(), inputs, { p1Alive: true, p2Alive: true, care: { p1, p2: atHome } }, 1), 12000, 'Miete bleibt, solange jemand zu Hause lebt');
    const backtestCare = { p1: careMeta(3), p2: careMeta(3) };
    assertEqual(homeRentForYear(rent(), inputs, { p1Alive: true, p2Alive: true, care: backtestCare }, 1), 12000, 'Ohne Heimzustand (Backtest) bisherige Gradgrenze');
}

// Punkt 10: Unverheiratete tragen Heimposten persönlich; die Ersparnis bleibt im gemeinsamen Bedarf.
{
    const p1 = careMeta(4), p2 = careMeta(3);
    p1.currentYearInCare = p2.currentYearInCare = 1;
    priceMonteCarloCareForYear(couple, p1, p2, {}, 0, true, true, true);
    const portfolio = { personAccounts: [{ profileId: 'a', tagesgeld: 100000 }, { profileId: 'b', tagesgeld: 100000 }] };
    const inputs = { ...couple, simulationPeople: [{ profileId: 'a' }, { profileId: 'b' }] };
    const shares = unmarriedYearShares(portfolio, inputs, { p1, p2 }, false, { p1Alive: true, p2Alive: true }, HEIM[0] + 6000 + 18000);
    assertEqual(shares[0].care, 46368, 'Unverheiratet: Heimkosten und eigene Ausgaben bei der Person im Heim');
    assertEqual(shares[1].care, 18000, 'Unverheiratet: Person zu Hause trägt nur ihren Pflegezusatz');
    assertEqual(shares[0].share, .5, 'Unverheiratet: gemeinsamer Bedarf weiter nach Vermögensanteil');
}

// Backtest mit heutigem Grad „im Heim“: Ergebnisbytes wie vor HE-2 (Stand 6db1c695).
{
    const inputs = { ...structuredClone(fixtureInputs), careToday: { grade: 4, form: 'residential', progression: 'usual', additionalMonthly: null, allowanceAsIncome: false },
        pflegeGradeConfigs: structuredClone(staffel), pflegeMaxFloor: 120000, pflegeRampUp: 1 };
    const bytes = JSON.stringify(runFixture({ input: inputs }));
    assertEqual(createHash('sha256').update(bytes).digest('hex'), readLE1References(readGU1References(readPFA1References('a009df6f52d67541ad51378408de54fe29afd7d23d2e653b217c83d58ba56769'))),
        'FR-73: Backtest rechnet heutige Heimpflege automatisch');
}

// Neue Hilfen: Zusammensetzung, Liquiditätsziel des Folgejahrs, Eingaben.
{
    const { composeYearNeed } = await import('../app/simulator/simulator-survivor.js');
    const { nextYearResidentialNeed, residentialOwnExpensesInputPatch } = await import('../app/simulator/simulator-residential-care.js');
    const p1 = careMeta(4), p2 = homeCare();
    priceMonteCarloCareForYear(couple, p1, p2, {}, 0, true, true, true);
    const need = composeYearNeed({ inputs: couple, baseFloor: 36000, careFloorAddition: 0,
        household: { p1Alive: true, p2Alive: true, care: { p1, p2 } }, deathThisYear: false });
    assertEqual(JSON.stringify([need.homeFloor, need.homeCareAddition, need.residentialCosts, need.residentialOwnExpenses, need.total]),
        JSON.stringify([27000, 0, 40368, 6000, 73368]), 'Punkt 0: getrennte Bestandteile, Summe wie Sollfall A');
    assertEqual(nextYearResidentialNeed({ p1, p2: null }, couple, 1, 1), 36612 + 6000, 'Punkt 17: Folgejahr mit nächster Zuschussstufe');
    assertEqual(p1.heimJahr, 1, 'Punkt 17: Vorschau ändert den Heimzähler nicht');
    const own = { ...couple, pflegeHeimEigeneAusgaben: 650 };
    const q1 = careMeta(4);
    priceMonteCarloCareForYear(own, q1, homeCare(), {}, 0, true, true, true);
    assertEqual(q1.heimEigeneAusgaben, 7800, 'Punkt 3: eigenes Feld €/Monat × 12');
    assertEqual(JSON.stringify(residentialOwnExpensesInputPatch(500)), '{}', 'Vorgabe ergänzt keine Eingabe');
    assertEqual(residentialOwnExpensesInputPatch('650').pflegeHeimEigeneAusgaben, 650, 'Abweichung wird übergeben');
}

// Punkt 3: Das Feld erreicht Monte Carlo aus der Seite und aus dem Profil; die Vorgabe bleibt unsichtbar.
{
    const { readCareInputs } = await import('../app/simulator/simulator-input-care.js');
    const { buildSimulatorInputsFromProfileData } = await import('../app/simulator/simulator-profile-inputs.js');
    const { records } = await import('./extended/parity-replay-fixture.mjs');
    const storage = { getItem: () => null };
    const page = value => ({ getElementById: id => id === 'pflegeHeimEigeneAusgaben' ? { value, dataset: {} } : null });
    assertEqual(readCareInputs({ doc: page('650'), storage }).pflegeHeimEigeneAusgaben, 650, 'Seite: abweichender Wert wird Eingabe');
    assert(!Object.hasOwn(readCareInputs({ doc: page('500'), storage }), 'pflegeHeimEigeneAusgaben'), 'Seite: Vorgabe ergänzt kein Feld');
    const profile = Object.values(JSON.parse(records.rs_profiles_v1).profiles)[0].data;
    const read = data => buildSimulatorInputsFromProfileData(data, { referenceYear: 2026, planValues: null, storage });
    assertEqual(read({ ...profile, sim_pflegeHeimEigeneAusgaben: '650' }).pflegeHeimEigeneAusgaben, 650, 'Profil: gespeicherter Wert wird Eingabe');
    assert(!Object.hasOwn(read(profile), 'pflegeHeimEigeneAusgaben'), 'Profil: ohne Wert gilt die Vorgabe');
}
