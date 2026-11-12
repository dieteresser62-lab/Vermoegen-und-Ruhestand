import { readLE1References } from './helpers/le-1-expectations.mjs';
import { withPreviousRunEvidence } from './helpers/le-1b-expectations.mjs';
import { readGU1References } from './helpers/gu-1-expectations.mjs';
import { readPFA1References } from './helpers/pfa-1-expectations.mjs';
import { readPFA2References } from './helpers/pfa-2-expectations.mjs';
const readHE4References = value => readPFA1References(beforePFA1References(value));
// FR-72 Teil 3 (HE-3): „Amtlicher Durchschnitt“ zieht in Monte Carlo die Pflegeform.
// Jede Person erhält einmal U aus dem eigenen Strom `CARE_FORM`; bei Grad g gilt Heim, wenn U kleiner als
// der Destatis-Heimanteil 2023 ist. Sollfall L aus FR-72; ohne Inflation, Kostenanstieg und Regionalzuschlag,
// Grundbedarf 24.000 € allein und 36.000 € als Paar (Hinterbliebenenanteil 75 %), eigene Ausgaben 500 €/Monat.
// Heimjahr 1/2: 40.368 / 36.612 €. Die Staffel trägt wie aus Seite und Profil die amtlichen Durchschnittswerte.
// Alle Personen und Beträge sind erfunden. Die erwarteten Bytes von Backtest, Lebenspfad und Monte Carlo
// ohne „Amtlich“ stammen aus dem Stand vor HE-3 (8dc432d6).
import { createHash } from 'node:crypto';
import { readHE4References as beforePFA1References } from './helpers/he-4-expectations.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs, runFixture } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear, makeDefaultCareMeta, calcCareCost } from '../app/simulator/simulator-engine-wrapper.js';
import { getDataVersion } from '../app/simulator/simulator-engine-helpers.js';
import { priceMonteCarloCareForYear, createMonteCarloLifeState, createMonteCarloPostRuinLifeState,
    updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { normalizeWidowOptions } from '../app/simulator/simulator-sweep-utils.js';
import { allLivingInExternalCare, homeRentForYear, sellHomesForExternalCare } from '../app/simulator/simulator-home-sale.js';
import { careFormForPerson, isInResidentialCare } from '../app/shared/care-benefits.js';
import { officialCareCosts } from '../app/shared/household-care-values.js';
import { livesInResidentialCare } from '../app/simulator/simulator-residential-care.js';
import { rng } from '../app/simulator/simulator-utils.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { createStressReplayCaptureRequest, materializeStressReplayPathV1 } from '../app/simulator/stress-replay-path-materializer.js';
import { createStressReplayFingerprint } from '../app/simulator/stress-replay-contract.js';
import { runStressReplayPathV1 } from '../app/simulator/stress-replay-runner.js';
import { runDecisionComparison } from '../app/simulator/decision-comparison.js';
import { measurementInputs, parameters } from './helpers/ek-1b-measurement.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Unabhängiges Orakel: Destatis 22421-01, Heim (I34:I38) / insgesamt (C34:C38) je Grad 1–5.
const DESTATIS = { 1: 4344 / 785822, 2: 132378 / 2300753, 3: 297955 / 1686286, 4: 248626 / 669263, 5: 114191 / 244252 };
const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const official = officialCareCosts();
const staffel = Object.fromEntries([1, 2, 3, 4, 5].map(grade => [grade, { zusatz: official[grade], flexCut: 1, mortalityFactor: 0 }]));
const couple = { ...structuredClone(fixtureInputs), startFloorBedarf: 36000, survivorFloorPercent: 75, home: [],
    renteMonatlich: 0, rentAdjMode: 'fix', rentAdjPct: 0, partner: { ...fixtureInputs.partner, monatsrente: 0, brutto: 0 },
    pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch', pflegeRampUp: 1, pflegeMaxFloor: 120000,
    pflegeKostenDrift: 0, pflegeRegionalZuschlag: 0, pflegeKostenStaffelPreset: 'amtlich', pflegeGradeConfigs: structuredClone(staffel) };
const single = { ...couple, startFloorBedarf: 24000, partner: { aktiv: false } };
const custom = inputs => { const copy = { ...inputs }; delete copy.pflegeKostenStaffelPreset; return copy; };

const careMeta = (grade, draw, extra = {}) => Object.assign(makeDefaultCareMeta(true, 'm'), { active: true, triggered: true,
    grade, gradeLabel: `Pflegegrad ${grade}`, currentYearInCare: 0, heimZufall: draw }, extra);
const setGrade = (care, grade) => Object.assign(care, { grade, gradeLabel: `Pflegegrad ${grade}` });

/** Ein Jahr wie im Monte-Carlo-Lauf: Pflegejahr zählen, Form und Preise nach den Todesziehungen, Jahresrechnung. */
function runYear(inputs, { p1, p2 = null, yearIndex, p1Alive = true, p2Alive = inputs.partner?.aktiv === true,
    previouslyJointAlive = inputs.partner?.aktiv === true, state = initMcRunState(inputs) }) {
    for (const care of [p1, p2]) if (care?.active) care.currentYearInCare += 1;
    priceMonteCarloCareForYear(inputs, p1, p2, state, yearIndex, p1Alive, p2Alive, previouslyJointAlive);
    const yearCare = { p1: p1 ? { ...p1 } : null, p2: p2 ? { ...p2 } : null };
    const total = calcCareCost(yearCare.p1, null).zusatzFloor + (yearCare.p2 ? calcCareCost(yearCare.p2, null).zusatzFloor : 0);
    const result = simulateOneYear(state, inputs, year, yearIndex, yearCare.p1, total, { p1Alive, p2Alive, care: yearCare }, 1, EngineAPI);
    assertEqual(result.kind, 'success', `Jahr ${yearIndex + 1} auswertbar`);
    return result;
}

// Sollfall L, U = 0,30: Grad 3 zu Hause (17,7 %), ab Grad 4 Heim (37,1 %), bei Grad 5 bleibt das Heim.
{
    const p1 = careMeta(3, .30);
    const home = runYear(single, { p1, yearIndex: 0 });
    assertEqual(home.logData.floor_brutto, 24000, 'L: U 0,30, Grad 3 zu Hause ohne Zusatz (bisher 31.100 €)');
    assertEqual(home.logData.pflege_zusatz_floor, 0, 'L: zu Hause kein amtlicher Durchschnittszusatz');
    assertEqual(home.logData.pflegegeld ?? 0, 0, 'L: zu Hause kein Pflegegeld (Netto-Konvention)');
    // HE-4 (Gutachten HE-3, B3): Die gezogene Form steht auch zu Hause im Jahreszustand.
    assert(home.logData.CareP1_Form === 'home-support' && !Object.hasOwn(home.logData, 'CareP1_HeimJahr') && !Object.hasOwn(p1, 'heimJahr'), 'L: Grad 3 zu Hause, ohne Heimzustand');
    const heim = runYear(single, { p1: setGrade(p1, 4), yearIndex: 1 });
    assertEqual(heim.logData.floor_brutto, 46368, 'L: ab Grad 4 Heim, Heimjahr 1: 40.368 + 6.000 (bisher 39.000 €)');
    assertEqual(heim.logData.CareP1_Form, 'residential', 'L: Grad 4 im Heim protokolliert');
    assertEqual(heim.logData.CareP1_HeimJahr, 1, 'L: Heimjahr beginnt mit dem ersten Jahr im Heim');
    assertEqual(heim.logData.pflege_zusatz_floor, 0, 'L: im Heim kein zusätzlicher Durchschnittszusatz');
    assertEqual(heim.logData.CareP1_Cost, 40368 + 6000, 'L: Pflegekosten der Person sind nur die Heimposten');
    const later = runYear(single, { p1: setGrade(p1, 5), yearIndex: 2 });
    assertEqual(later.logData.floor_brutto, 42612, 'L: Grad 5 bleibt im Heim, Heimjahr 2: 36.612 + 6.000');
    assertEqual(later.logData.CareP1_HeimJahr, 2, 'L: Gradwechsel im Heim setzt das Heimjahr nicht zurück');
    assertEqual(p1.heimZufall, .30, 'L: die Zufallszahl bleibt über alle Jahre gleich');
}

// Sollfall L, U = 0,50: auch Grad 5 (46,8 %) zu Hause.
{
    const p1 = careMeta(3, .50);
    [[3, 31100], [4, 39000], [5, 42900]].forEach(([grade, before], yearIndex) => {
        const result = runYear(single, { p1: setGrade(p1, grade), yearIndex });
        assertEqual(result.logData.floor_brutto, 24000, `L: U 0,50, Grad ${grade} zu Hause ohne Zusatz (bisher ${before} €)`);
        assert(result.logData.CareP1_Form === 'home-support' && !Object.hasOwn(result.logData, 'CareP1_HeimJahr'), `L: U 0,50, Grad ${grade} zu Hause, ohne Heimzustand`);
    });
}

// Paar: P1 kommt mit U 0,30 und Grad 4 ins Heim, P2 lebt ohne Pflege zu Hause (wie Sollfall A).
{
    const p1 = careMeta(4, .30), p2 = Object.assign(makeDefaultCareMeta(true, 'w'), { heimZufall: .01 });
    const result = runYear(couple, { p1, p2, yearIndex: 0 });
    assertEqual(result.logData.floor_brutto, 73368, 'L Paar: 27.000 + 40.368 + 6.000');
    assertEqual(result.logData.grundbedarf_zu_hause, 27000, 'L Paar: Hinterbliebenenanteil für P2 zu Hause');
    assert(!Object.hasOwn(p2, 'heimJahr'), 'L Paar: ohne aktive Pflege kein Heim, auch bei kleinem U');
}

// Hausverkauf (FR-53), Wohnrecht und Miete nach Notverkauf folgen der gezogenen Form.
{
    const profileId = fixtureInputs.simulationPeople[0].profileId;
    const inputs = { ...single, home: [{ profileId, id: 'haus', wert: 800000, nutzung: 'selbst', stand: '2026-10' }], homeReferenceYear: 2026 };
    for (const [draw, sold] of [[.30, true], [.50, false]]) {
        const household = { p1Alive: true, p2Alive: false, care: { p1: careMeta(4, draw) } };
        assertEqual(allLivingInExternalCare(inputs, household), sold, `FR-53: Grad 4 mit U ${draw} ${sold ? 'im Heim' : 'zu Hause'}`);
        assertEqual(isInResidentialCare(inputs, 0, household), sold, `Wohnrecht: Grad 4 mit U ${draw} folgt der gezogenen Form`);
        const result = runYear(inputs, { p1: careMeta(4, draw), yearIndex: 0 });
        assertEqual(result.logData.immobilienverkauf > 0, sold, `FR-53 im Jahreslauf: Verkauf nur bei tatsächlichem Heim (U ${draw})`);
    }
    const backtest = { p1Alive: true, p2Alive: false, care: { p1: { active: true, grade: 4 } } };
    assertEqual(allLivingInExternalCare(inputs, backtest), true, 'Ohne Zufallszahl (Backtest) gilt Grad 4 wie bisher als Heim');
    const state = initMcRunState(inputs);
    assert(Boolean(sellHomesForExternalCare({ portfolio: structuredClone(state.portfolio), state, inputs, household: backtest,
        yearIndex: 0, inflationFactor: 1 })), 'Ohne Zufallszahl verkauft Grad 4 wie bisher');
    const rent = () => ({ homeRent: { amount: 12000, inflationFactor: 1, startYear: 2026, active: true } });
    const rentFor = (grade, draw) => {
        const care = draw == null ? { active: true, grade } : careMeta(grade, draw);
        if (draw != null) priceMonteCarloCareForYear(single, care, null, {}, 0, true, false, false);
        return homeRentForYear(rent(), single, { p1Alive: true, p2Alive: false, care: { p1: care } }, 1);
    };
    assertEqual(rentFor(3, .10), 0, 'Miete endet bei Grad 3, wenn U 0,10 das Heim ergibt');
    assertEqual(rentFor(4, .50), 12000, 'Miete bleibt bei Grad 4 zu Hause (bisher endete sie)');
    assertEqual(rentFor(4, .30), 0, 'Miete endet bei Grad 4 im Heim');
    assertEqual(rentFor(4, null), 0, 'Ohne Zufallszahl bisherige Gradgrenze');
}

// Vorrang der heutigen Form: Sie legt fest, auf welcher Seite des heutigen Heimanteils U liegt.
{
    const options = normalizeWidowOptions(single.widowOptions);
    const todayHeim = { ...single, careToday: { grade: 3, form: 'residential', progression: 'usual' } };
    const todayHome = { ...single, careToday: { grade: 4, form: 'family', progression: 'usual' } };
    let below = 0, above = 0;
    for (let seed = 1; seed <= 200; seed++) {
        if (createMonteCarloLifeState(todayHeim, rng(seed), options).careMetaP1.heimZufall < DESTATIS[3]) below++;
        if (createMonteCarloLifeState(todayHome, rng(seed), options).careMetaP1.heimZufall >= DESTATIS[4]) above++;
    }
    assertEqual(below, 200, 'Heute im Heim: U liegt immer unter dem Heimanteil des heutigen Grads');
    assertEqual(above, 200, 'Heute zu Hause: U liegt immer auf oder über dem Heimanteil des heutigen Grads');

    const bestand = createMonteCarloLifeState(todayHeim, rng(7), options).careMetaP1;
    const first = runYear(todayHeim, { p1: bestand, yearIndex: 0 });
    assertEqual(first.logData.floor_brutto, 46368, 'FR-73: heute im Heim ersetzt den Grundbedarf');
    assertEqual(first.logData.CareP1_HeimJahr, 1, 'FR-73: heutiger Heimfall mit Heimjahr');
    const progressed = runYear(todayHeim, { p1: setGrade(bestand, 4), yearIndex: 1 });
    assertEqual(progressed.logData.floor_brutto, 42612, 'FR-73: heutiger Heimfall zählt Heimjahr weiter');
    assertEqual(progressed.logData.CareP1_Form, 'residential', 'Heute im Heim: Heim bleibt nach dem Gradwechsel');

    for (const [draw, heim] of [[.40, true], [.60, false]]) {
        const p1 = makeDefaultCareMeta(true, 'm', todayHome.careToday, 80, todayHome);
        p1.heimZufall = draw;
        const today = runYear(todayHome, { p1, yearIndex: 0 });
        assertEqual(today.logData.floor_brutto, 24000, `Heute zu Hause (U ${draw}): Grad 4 bleibt zu Hause`);
        assertEqual(careFormForPerson(todayHome, 4, 0, { care: { p1 } }), 'family', 'Heute zu Hause: bekannte Form gilt beim heutigen Grad');
        const next = runYear(todayHome, { p1: setGrade(p1, 5), yearIndex: 1 });
        assertEqual(next.logData.floor_brutto, heim ? 46368 : 24000,
            `Heute zu Hause, Grad 5 mit U ${draw}: ${heim ? 'Heim' : 'zu Hause'} (bisher 42.900 €)`);
    }
}

// Heimanteile je Grad über viele Personen, gemessen im Lebensereignispfad vor jeder Auswahl überlebender Pfade.
// Jede Person zählt einmal je Grad, im ersten Jahr mit diesem Grad, auch wenn sie im selben Jahr stirbt.
// U ist von Grad und Tod unabhängig; die Zählung ist daher binomial mit p = Heimanteil. Toleranz: 4 Standardfehler,
// sqrt(p(1-p)/n). Bei festem Seed ist das Ergebnis fest; 4 SE lassen Spielraum für künftige Änderungen der Grad- und
// Sterbetafeln, eine Ziehung bei jedem Gradwechsel (Gutachten B14: Grad 4 rund 51,5 % statt 37,1 %) fiele weit heraus.
{
    const inputs = { ...couple, startAlter: 67, partner: { ...couple.partner, aktiv: true, startAlter: 64 } };
    const options = normalizeWidowOptions(inputs.widowOptions);
    const counts = Object.fromEntries([1, 2, 3, 4, 5].map(grade => [grade, { persons: 0, heim: 0 }]));
    let leftHeim = 0;
    // LE-1 (FR-41 neu abgestimmt, Fortschritt × 0,75): 30.000 statt 20.000 Läufe, damit Grad 5 über 4.000 Personen bleibt.
    for (let run = 0; run < 30000; run++) {
        const rand = rng(500000 + run), life = createMonteCarloLifeState(inputs, rand, options);
        const seen = { p1: new Set(), p2: new Set() }, wasHeim = { p1: false, p2: false };
        for (let n = 0; n < 45 && !life.runEndedBecauseAllDied; n++) {
            const lifeYear = updateMonteCarloLifeEventsForYear(life, inputs, options, n, year, 0, null, false, rand, {});
            for (const key of /** @type {const} */ (['p1', 'p2'])) {
                const care = lifeYear.householdContext.care[key];
                if (!care?.active) continue;
                const heim = livesInResidentialCare(care);
                if (wasHeim[key] && !heim) leftHeim++;
                wasHeim[key] ||= heim;
                if (seen[key].has(care.grade)) continue;
                seen[key].add(care.grade);
                counts[care.grade].persons++;
                if (heim) counts[care.grade].heim++;
            }
        }
    }
    assertEqual(leftHeim, 0, 'Ein erreichtes Heim bleibt bei weiteren Gradwechseln erhalten');
    for (const grade of [1, 2, 3, 4, 5]) {
        const { persons, heim } = counts[grade], p = DESTATIS[grade], measured = heim / persons;
        const tolerance = 4 * Math.sqrt(p * (1 - p) / persons);
        assert(persons > 4000, `Messung Grad ${grade}: genug Personen (${persons})`);
        assert(Math.abs(measured - p) <= tolerance, `Heimanteil Grad ${grade}: ${(measured * 100).toFixed(2)} % bei ${persons} Personen, `
            + `Destatis ${(p * 100).toFixed(2)} %, Toleranz ±${(tolerance * 100).toFixed(2)} Prozentpunkte`);
    }
}

// Markt-, Grad- und Todesziehungen bleiben bei gleichem Seed gleich; der neue Strom verschiebt keinen alten.
{
    const options = normalizeWidowOptions(couple.widowOptions);
    for (let seed = 1; seed <= 40; seed++) {
        const randA = rng(seed), randB = rng(seed);
        const a = createMonteCarloLifeState(couple, randA, options), b = createMonteCarloLifeState(custom(couple), randB, options);
        const trace = (life, inputs, rand) => Array.from({ length: 40 }, (_, n) => {
            const lifeYear = updateMonteCarloLifeEventsForYear(life, inputs, options, n, year, 0, null, false, rand, {});
            return [life.p1Alive, life.p2Alive, lifeYear.householdContext.care.p1?.grade ?? 0, lifeYear.householdContext.care.p2?.grade ?? 0];
        });
        assertEqual(JSON.stringify(trace(a, couple, randA)), JSON.stringify(trace(b, custom(couple), randB)), `Seed ${seed}: gleiche Grade und Todesfälle mit und ohne Amtlich`);
        assertEqual(JSON.stringify([randA(), a.rngCareP1(), a.rngCareP2()]), JSON.stringify([randB(), b.rngCareP1(), b.rngCareP2()]),
            `Seed ${seed}: Haupt- und Pflegeströme stehen danach an derselben Stelle`);
    }
    // Vollständiger Lauf mit hoher Rente (kein Ruin, also gleiche Marktziehungen): Marktjahr, Tod und Grad je Jahr.
    const rich = { ...structuredClone(fixtureInputs), pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch', renteMonatlich: 30000 };
    for (const grade of [1, 2, 3, 4, 5]) rich.pflegeGradeConfigs[grade].zusatz = official[grade];
    const params = { anzahl: 40, maxDauer: 35, methode: 'block', blockSize: 1, seed: 4242 };
    const lifePath = async inputs => {
        const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: params, logIndices: new Set(Array.from({ length: 40 }, (_, i) => i)),
            widowOptions: inputs.widowOptions, useCapeSampling: false, engine: EngineAPI });
        assertEqual(chunk.totals.outcomeRuinCount, 0, 'Lebenspfad-Vergleich ohne Ruin');
        const rows = chunk.runMeta.flatMap(meta => meta.logDataRows);
        return { residentialRows: rows.filter(row => row.CareP1_Form === 'residential' || row.CareP2_Form === 'residential').length,
            path: hash(chunk.runMeta.map(meta => meta.logDataRows.map(row => [row.jahr, row.histJahr, row.inflation, row.Person1Alive,
                row.Person2Alive, row.CareP1_Grade, row.CareP2_Grade]))) };
    };
    const officialPath = await lifePath({ ...rich, pflegeKostenStaffelPreset: 'amtlich' }), customPath = await lifePath(rich);
    assertEqual(officialPath.path, readLE1References('b2b9e0931dd4fcd19c574945f5fde3af4c894022b6b9175c3dc072ed28f04ca6'), 'Amtlich: Marktjahre, Tode und Grade wie vor HE-3');
    assertEqual(customPath.path, officialPath.path, 'Ohne Amtlich derselbe Lebenspfad');
    assert(officialPath.residentialRows > 0, `Amtlich: gezogene Heimjahre im Lauf (${officialPath.residentialRows} Jahre)`);
}

// Replay, Fortsetzung nach Ruin und Wiederholung übernehmen die gespeicherte Zahl ohne neue Ziehung.
{
    const p1 = careMeta(4, .30), p2 = makeDefaultCareMeta(true, 'w'), state = initMcRunState(couple);
    for (const yearIndex of [0, 1]) {
        priceMonteCarloCareForYear(couple, p1, p2, state, yearIndex, true, true, true);
        priceMonteCarloCareForYear(couple, p1, p2, state, yearIndex, true, true, true);
    }
    assertEqual(p1.heimJahr, 2, 'Wiederholter Preisaufruf zählt nicht weiter und zieht nicht neu');
    const replayed = JSON.parse(JSON.stringify({ p1, p2 }));
    const replay = simulateOneYear(state, couple, year, 1, replayed.p1, 0, { p1Alive: true, p2Alive: true, care: replayed }, 1, EngineAPI);
    assertEqual(replay.logData.floor_brutto, 69612, 'Replay aus der JSON-Kopie: Heimjahr 2 aus dem gespeicherten Zustand');
    assertEqual(replayed.p1.heimZufall, .30, 'Replay-Kopie trägt die Zufallszahl');
    const options = normalizeWidowOptions(couple.widowOptions);
    const shadow = createMonteCarloPostRuinLifeState(couple, rng(99), { widowOptions: options, careMetaP1: p1, careMetaP2: p2 });
    const fresh = createMonteCarloLifeState(couple, rng(99), options);
    assertEqual(shadow.careMetaP1.heimZufall, .30, 'Fortsetzung nach Ruin übernimmt U der Person');
    assert(fresh.careMetaP1.heimZufall !== .30, 'Der Schattenstrom hätte eine andere Zahl gezogen');
    assertEqual(shadow.careMetaP1.heimJahr, 2, 'Fortsetzung nach Ruin übernimmt das Heimjahr');
}

// Stress-Replay eines echten Laufs mit gezogenem Heim: gleiche Jahreswerte aus den gespeicherten Pflegedaten.
{
    const inputs = { ...structuredClone(fixtureInputs), pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch', pflegeKostenStaffelPreset: 'amtlich' };
    for (const grade of [1, 2, 3, 4, 5]) inputs.pflegeGradeConfigs[grade].zusatz = official[grade];
    const monteCarloParams = { anzahl: 40, maxDauer: 25, methode: 'block', blockSize: 1, seed: 777, rngMode: 'per-run-seed' };
    const args = { inputs, widowOptions: inputs.widowOptions, monteCarloParams, useCapeSampling: false, engine: EngineAPI };
    const all = await runMonteCarloChunk({ ...args, logIndices: Array.from({ length: 40 }, (_, i) => i) });
    const heimRow = row => row.CareP1_Form === 'residential' || row.CareP2_Form === 'residential';
    const selected = all.runMeta.find(meta => meta.logDataRows.length === monteCarloParams.maxDauer && meta.logDataRows.some(heimRow));
    assert(Boolean(selected), 'Replay: ein Lauf erreicht das Heim und den Horizont');
    const source = await runMonteCarloChunk({ ...args, logIndices: [selected.index], stressReplayCapture: createStressReplayCaptureRequest([selected.index]) });
    const meta = source.runMeta.find(entry => entry.index === selected.index);
    const draws = meta.stressReplayCapture.years.flatMap(entry => entry.householdEvents.flatMap(event => [event.careMetaP1?.heimZufall, event.careMetaP2?.heimZufall]))
        .filter(value => value !== undefined);
    assert(draws.length > 0 && draws.every(value => typeof value === 'number'), 'Replay-Aufzeichnung speichert U im Personenzustand');
    const path = materializeStressReplayPathV1({ capture: meta.stressReplayCapture, sourceLogRows: meta.logDataRows,
        sourceRequest: { schemaVersion: 'StressReplayE2ESourceRequestV1', inputs, widowOptions: inputs.widowOptions, monteCarloParams, useCapeSampling: false },
        dataFingerprint: createStressReplayFingerprint({ dataVersion: getDataVersion() }),
        engineFingerprint: createStressReplayFingerprint({ engineVersion: EngineAPI.version || 'EngineAPI' }),
        scenarioKey: 'he-3-amtlich', selectionMetric: 'nominal_terminal_wealth_eur' });
    const replay = runStressReplayPathV1({ path, baselineInputs: inputs, sourceScenarioLog: meta.logDataRows, engine: EngineAPI });
    assertEqual(replay.reconciliation.matched, true, 'Stress-Replay stimmt mit dem Monte-Carlo-Lauf überein');
    const fields = row => [row.floor_brutto, row.CareP1_Form, row.CareP1_HeimJahr, row.CareP2_Form, row.CareP2_HeimJahr, row.pflege_heimkosten];
    assert(replay.scenarioLog.records.filter(heimRow).length > 0, 'Stress-Replay: Heimjahre vorhanden');
    assertEqual(JSON.stringify(replay.scenarioLog.records.filter(heimRow).map(fields)), JSON.stringify(meta.logDataRows.filter(heimRow).map(fields)),
        'Stress-Replay: Heimjahre und Beträge wie im Lauf');
}

// Entscheidungsvergleich: Die Variante spielt die aufgezeichneten Ziehungen ab, auch U aus CARE_FORM.
{
    const inputs = await measurementInputs(0, 'max-erika');
    Object.assign(inputs, { pflegefallLogikAktivieren: true, pflegeKostenStaffelPreset: 'amtlich' });
    for (const grade of [1, 2, 3, 4, 5]) inputs.pflegeGradeConfigs[grade].zusatz = official[grade];
    const zero = await runDecisionComparison({ inputs, monteCarloParams: { ...parameters, anzahl: 50 }, useCapeSampling: false,
        engine: EngineAPI, diagnosticRuns: 50, captureLogs: true, change: { kind: 'budget', monthly: 0 } });
    assertEqual(JSON.stringify(zero.variant.chunk), JSON.stringify(zero.baseline.chunk), 'Vergleich ohne Änderung: gleiche Pfade mit gezogener Form');
}

// Ohne „Amtlich“ exakt die bisherigen Ergebnisse; Backtest mit „Amtlich“ unverändert (Bytes von 8dc432d6).
{
    const options = normalizeWidowOptions(couple.widowOptions);
    const life = createMonteCarloLifeState(custom(couple), rng(5), options);
    assert(!Object.hasOwn(life.careMetaP1, 'heimZufall') && !Object.hasOwn(life.careMetaP2, 'heimZufall'), 'Ohne Amtlich keine Zufallszahl');
    const profileId = fixtureInputs.simulationPeople[0].profileId;
    const withCare = { ...structuredClone(fixtureInputs), pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch',
        careToday: { grade: 2, form: 'family', progression: 'usual' }, home: [{ profileId, id: 'haus', wert: 600000, nutzung: 'selbst', stand: '2026-10' }],
        homeReferenceYear: 2026 };
    const chunk = await runMonteCarloChunk({ inputs: withCare, monteCarloParams: { anzahl: 12, maxDauer: 30, methode: 'block', blockSize: 1, seed: 31 },
        logIndices: new Set(Array.from({ length: 12 }, (_, i) => i)), widowOptions: withCare.widowOptions, useCapeSampling: false, engine: EngineAPI });
    // HE-4: Die Pflegekennzahl ist netto; mit abgeschalteter Netto-Kennzahl wieder der Hash von 8dc432d6.
    assertEqual(hash(withPreviousRunEvidence(chunk)), readLE1References(readGU1References(readHE4References('d5ecdf599d9cb8fe91f6789bb9d7d64443e96f59609743df238037629b302688'))), 'Ohne Amtlich: vollständiges Monte-Carlo-Ergebnis wie vor HE-3, Pflegekennzahl netto (Laufbeleg wie vor LE-1b)');
    const backtestInputs = { ...withCare, pflegeKostenStaffelPreset: 'amtlich', careToday: { grade: 4, form: 'residential', progression: 'usual' },
        partner: { ...withCare.partner, careToday: { grade: 4, progression: 'usual' } } };
    for (const grade of [1, 2, 3, 4, 5]) backtestInputs.pflegeGradeConfigs[grade].zusatz = official[grade];
    assertEqual(hash(runFixture({ input: backtestInputs, selectedPeriod: { startYear: 2000, endYear: 2011 } })),
        readLE1References(// FR-73 Paket 2: beide heute Grad 4 im Heim, der Backtest verkauft das Haus im ersten Jahr wie Monte Carlo.
        readGU1References(readPFA2References(readPFA1References('7ff82ffb654eb2363b5f9315114d1adec70f1502d924afcaf1029224253b542e')))), 'Backtest mit Amtlich: Bytes wie vor HE-3');
}

// Neue Hilfen: Heimanteile ungerundet, eigener Strom CARE_FORM (P1 zieht zuerst), Staffel außerhalb von Monte Carlo.
{
    const { officialResidentialShare, residentialMonthly } = await import('../app/shared/household-care-values.js');
    for (const grade of [1, 2, 3, 4, 5]) assertEqual(officialResidentialShare(grade), DESTATIS[grade], `Heimanteil Grad ${grade} aus Zähler und Nenner`);
    assertEqual(officialResidentialShare(0), 0, 'Ohne Grad kein Heimanteil');
    const options = normalizeWidowOptions(couple.widowOptions);
    const life = createMonteCarloLifeState(couple, rng(12345), options), stream = rng(12345).fork('CARE_FORM');
    assertEqual(JSON.stringify([life.careMetaP1.heimZufall, life.careMetaP2.heimZufall]), JSON.stringify([stream(), stream()]),
        'U je Person aus dem eigenen Strom CARE_FORM, P1 zuerst');
    const components = { care: 2500, board: 1200, invest: 600 }, monthly = residentialMonthly(components);
    const values = { residential: { monthly, components } };
    assertEqual(officialCareCosts(values)[4], Math.round(DESTATIS[4] * monthly * 12 / 100) * 100,
        'Außerhalb von Monte Carlo: Staffel aus dem gerundeten ersten Heimjahr der drei Bestandteile');
}
