// FR-73: Sollwerte aus auftrag/FR-73.md, Testdatum 23.10.2026; keine abgeleiteten Erwartungen.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const load = file => import(pathToFileURL(resolve(process.env.PFA_BASE || '.', file)));
const { inputs: fixture, records } = await load('tests/extended/parity-replay-fixture.mjs');
const { EngineAPI } = await load('engine/index.mjs');
const { initMcRunState, simulateOneYear, makeDefaultCareMeta, calcCareCost } = await load('app/simulator/simulator-engine-wrapper.js');
const { priceMonteCarloCareForYear } = await load('app/simulator/mc-life-events.js');
const { fixedCareTodayForYear } = await load('app/simulator/simulator-care-today.js');
const { composeYearNeed } = await load('app/simulator/simulator-survivor.js');
const { calculateFixedIncomeForYear } = await load('app/simulator/simulator-fixed-income.js');
const { setAppTestDate } = await load('app/shared/app-clock.js');
const { unmarriedYearShares } = await load('app/simulator/simulator-unmarried.js');
const { readCareInputs } = await load('app/simulator/simulator-input-care.js');
const { buildSimulatorInputsFromProfileData } = await load('app/simulator/simulator-profile-inputs.js');
setAppTestDate('2026-10-23');
const year = { jahr: 1930, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const staffel = Object.fromEntries([3600, 6000, 18000, 32000, 60000].map((zusatz, i) => [i + 1,
    { zusatz, flexCut: [1, 1, .5, 0, 0][i], mortalityFactor: 0 }]));
const base = { ...structuredClone(fixture), startFloorBedarf: 36000, startFlexBedarf: 0, minimumFlexAnnual: 0,
    survivorFloorPercent: 75, home: [], renteMonatlich: 0, rentAdjMode: 'fix', rentAdjPct: 0,
    partner: { ...fixture.partner, aktiv: true, monatsrente: 0, brutto: 0 },
    pflegefallLogikAktivieren: false, pflegeModellTyp: 'chronisch', pflegeRampUp: 5,
    pflegeMaxFloor: 120000, pflegeKostenDrift: .05, pflegeRegionalZuschlag: 0, pflegeGradeConfigs: staffel };
const today = (grade, form, residentialSince) => ({ grade, form, progression: 'usual', ...(residentialSince ? { residentialSince } : {}) });
const pair = (p2, patch = {}, p1 = null) => ({ ...base, ...patch, ...(p1 ? { careToday: p1 } : {}),
    partner: { ...base.partner, ...(p2 ? { careToday: p2 } : {}), ...patch.partner } });
function priced(inputs, t = 0, alive = [true, inputs.partner?.aktiv === true], state = initMcRunState(inputs)) {
    const person = (care, gender) => {
        const meta = makeDefaultCareMeta(false, gender, care, 80, inputs);
        if (meta) meta.currentYearInCare = t + 1;
        return meta;
    };
    const p1 = person(inputs.careToday, 'w'), p2 = person(inputs.partner?.careToday, 'm');
    priceMonteCarloCareForYear(inputs, p1, p2, state, t, ...alive, true);
    const household = { p1Alive: alive[0], p2Alive: alive[1], care: { p1, p2 } };
    const death = inputs.partner?.aktiv && alive[0] !== alive[1] && !state.survivor;
    const addition = calcCareCost(p1).zusatzFloor * (alive[0] ? 1 : death ? .5 : 0)
        + calcCareCost(p2).zusatzFloor * (alive[1] ? 1 : death ? .5 : 0);
    const need = composeYearNeed({ inputs, baseFloor: state.baseFloor, household, deathThisYear: !!death, careFloorAddition: addition });
    return { p1, p2, household, state, need };
}
const close = (a, b, label) => assert(Math.abs(a - b) < .00001, `${label}: ${a} = ${b}`);
function check(label, inputs, expected, t = 0, alive, state) {
    const p = priced(inputs, t, alive, state);
    close(p.need.total, expected, `${label} MC`);
    if (!alive) {
        const fixed = fixedCareTodayForYear(inputs, p.state, t);
        const n = composeYearNeed({ inputs, baseFloor: p.state.baseFloor, household: fixed.householdContext,
            deathThisYear: false, careFloorAddition: fixed.careFloorAddition });
        close(n.total, expected, `${label} Backtest (historischer Marktjahrgang ohne Einfluss)`);
    }
    return p;
}
const A = pair(today(3, 'home-support'));
check('A', A, 54000);
const B = pair(today(2, 'family'));
const b = check('B', B, 42000);
const income = p => calculateFixedIncomeForYear({ inputs: p.inputs, state: p.state, household: p.household,
    care: p.household.care, yearIndex: 0, inflationFactor: 1, deathThisYear: false });
close(income({ ...b, inputs: B }).total, 4164, 'B Pflegegeld getrennte Einkunft');
const C = pair(today(4, 'residential'));
check('C', C, 73368);
const D = pair(today(4, 'residential', '2023-01'));
const d = check('D', D, 58332);
check('E', D, 59598.6, 1);
check('F Todesjahr', D, 43299.3, 1, [true, false]);
check('G Todesjahr', D, 46098.6, 1, [false, true]);
const after = initMcRunState(D);
after.survivor = { deathYearIndex: 1 };
check('F Folgejahr / V', D, 27000, 2, [true, false], after);
check('G Folgejahr / V', D, 33928.53, 2, [false, true], after);
check('H', pair(null, { startFloorBedarf: 24000, partner: { aktiv: false } }, today(4, 'residential')), 46368);
check('I elf Monate', pair(today(4, 'residential', '2025-11')), 73368);
check('I zwölf Monate', pair(today(4, 'residential', '2025-10')), 69612);
check('M Amtlich Heimjahr 1', { ...C, pflegeKostenStaffelPreset: 'amtlich' }, 73368);
check('M Amtlich Heimjahr 4', { ...D, pflegeKostenStaffelPreset: 'amtlich' }, 58332);
const N = { ...A, pflegeKostenStaffelPreset: 'amtlich' };
const n = check('N Amtlich zu Hause', N, 36000);
close(income({ ...n, inputs: N })?.total || 0, 0, 'N kein Pflegegeld');
check('O Deckel ohne Rampe', { ...A, pflegeMaxFloor: 40000 }, 40000);
check('O Deckel je Person', pair(today(3, 'home-support'), { pflegeMaxFloor: 40000 }, today(3, 'home-support')), 44000);
for (const [p1, p2, wish, minimum] of [[null, today(3, 'home-support'), 10500, 5250],
    [null, today(4, 'residential'), 9000, 4500], [today(4, 'residential'), today(4, 'residential'), 0, 0]]) {
    const inputs = pair(p2, { startFlexBedarf: 12000, minimumFlexAnnual: 6000 }, p1);
    const fixed = fixedCareTodayForYear(inputs, initMcRunState(inputs), 0);
    close(12000 * fixed.temporaryFlexFactor, wish, 'P Wunsch-Flex');
    close(6000 * fixed.temporaryFlexFactor, minimum, 'P Mindest-Flex');
    close(2 * 12000 * fixed.temporaryFlexFactor, 2 * wish, 'Q Dynamic-Flex-Obergrenze aus wirksamem Wunsch-Flex');
}
const R = pair(today(2, 'family'), {}, today(3, 'home-support'));
const r = check('R Angehörigenausfall', R, 60000);
close(income({ ...r, inputs: R })?.total || 0, 0, 'R Pflegegeld nach Angehörigenausfall');
const alone = pair(null, { partner: { aktiv: false } }, today(2, 'family'));
const solo = priced(alone);
close(income({ ...solo, inputs: alone }).total, 4164, 'R alleinstehend behält Pflegegeld');
const S = pair(today(4, 'residential'), {}, today(4, 'residential'));
const s = check('S beide heute Grad 4 im Heim', S, 92736);
close(s.need.homeFloor, 0, 'S Grundbedarf zu Hause 0');
check('T Grad 1 im Heim', pair(null, { startFloorBedarf: 24000, partner: { aktiv: false } }, today(1, 'residential')), 50124);
check('W Regionalzuschlag nur Pflegekosten', { ...D, pflegeRegionalZuschlag: .1 }, 60865.2);
const U = { ...C, partnership: { status: 'unmarried' }, simulationPeople: [{ profileId: 'a' }, { profileId: 'b' }] };
const u = priced(U, 0, undefined, initMcRunState(C));
const shares = unmarriedYearShares({ personAccounts: [{ profileId: 'a', tagesgeld: 600000 }, { profileId: 'b', tagesgeld: 400000 }] },
    U, u.household.care, false, u.household, 46368);
close(shares[0].share * 27000 + shares[0].care, 16200, 'U persönlicher Anteil zu Hause');
close(shares[1].share * 27000 + shares[1].care, 57168, 'U persönlicher Anteil im Heim');
const X = { ...S, home: [{ id: 'home', nutzung: 'selbst', wert: 450000, stand: '2026-10', profileId: fixture.simulationPeople?.[0]?.profileId || 'simulation' }] };
const x = priced(X);
const sold = simulateOneYear(x.state, X, year, 0, x.p1, 0, x.household, 0, EngineAPI);
assertEqual(sold.kind, 'success', 'X auswertbar');
close(sold.logData.immobilienverkauf, 405000, 'X Hausverkauf im ersten Jahr');
const Y = pair(null, { startFloorBedarf: 90000, partner: { aktiv: false } }, today(5, 'home-support'));
const ys = initMcRunState(Y);
ys.baseFloor = 91800; ys.cumulativeInflationFactor = 1.02;
check('Y Deckel-Fortschreibung', Y, 128520, 1, undefined, ys);
{
    const old = { sim_pflegeStufe1Zusatz: '6000', sim_pflegeStufe2Zusatz: '12000', sim_pflegeKostenDrift: '3.5' };
    let writes = 0;
    const storage = { getItem: key => old[key] ?? null, setItem() { writes++; }, removeItem() { writes++; } };
    const doc = { getElementById: id => old[`sim_${id}`] == null ? null : { value: old[`sim_${id}`], dataset: {} } };
    const profile = Object.values(JSON.parse(records.rs_profiles_v1).profiles)[0].data;
    for (const input of [readCareInputs({ doc, storage }), buildSimulatorInputsFromProfileData({ ...profile, ...old }, { storage, referenceYear: 2026, planValues: null })]) {
        assertEqual(input.pflegeGradeConfigs[1].zusatz, 3600, 'K Grad 1 alte Vorgabe lesend neu');
        assertEqual(input.pflegeGradeConfigs[2].zusatz, 6000, 'K Grad 2 alte Vorgabe lesend neu');
        assertEqual(input.pflegeKostenDrift, .05, 'K Kostenanstieg alte Vorgabe lesend neu');
    }
    assertEqual(writes, 0, 'K Lesen schreibt nie');
}
setAppTestDate(null);
