import { calibrateCareModel, assertMonotoneCareEntry, calibrationInitialGrade } from '../scripts/calibrate-care-model.mjs';
import { makeDefaultCareMeta, updateCareMeta, computeCareMortalityMultiplier } from '../app/simulator/simulator-engine-helpers.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { PFLEGE_GRADE_PROBABILITIES_BY_SEX, GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT as contract } from '../app/simulator/simulator-data.js';

assertMonotoneCareEntry();
assertMonotoneCareEntry({ m: { 65: { 1: .01, 2: .01 }, 70: { 1: .01, 2: .01 } } });
const falling = structuredClone(PFLEGE_GRADE_PROBABILITIES_BY_SEX);
falling.m[70] = { 1: 0, 2: 0 };
let rejected = false;
try { assertMonotoneCareEntry(falling); } catch (error) { rejected = error instanceof RangeError; }
assertEqual(rejected, true, 'Abstimmung lehnt fallenden Gesamteintritt als unzulässig ab');
for (const [sex, quota] of [['m', 4.25], ['w', 4.42]]) {
    const grades = [0, 0, 0, 0, 0];
    for (let person = 0; person < 200000; person++) {
        const grade = calibrationInitialGrade(person, 200000, sex);
        if (grade) grades[grade - 1]++;
    }
    const stock = grades.reduce((sum, count) => sum + count, 0);
    assertEqual(stock, 200000 * quota / 100, `${sex}: beobachteter Startbestand 60–64`);
    const counts = contract.care.officialObservation.countsByGrade;
    const assigned = Object.values(counts).reduce((sum, count) => sum + count, 0);
    for (let i = 0; i < 5; i++) assert(Math.abs(grades[i] - stock * counts[i + 1] / assigned) <= 1,
        `${sex}/PG${i + 1}: Startbestand nach zugeordneten Destatis-Graden`);
    const simulatorStart = makeDefaultCareMeta(true, sex);
    assertEqual(simulatorStart.active, false, 'Simulator startet weiter ohne Pflege');
    assertEqual(simulatorStart.triggered, false, 'Kein Startbestand im Simulator');
}

for (const year of [0, 1, 2, 20]) for (const ramp of [1, 5, 100]) {
    assertEqual(computeCareMortalityMultiplier({ active: true, mortalityFactor: 3, currentYearInCare: year }, { pflegeRampUp: ramp }), 3);
}
for (const factor of [-1, 0, .5, 1]) assertEqual(computeCareMortalityMultiplier({ active: true, mortalityFactor: factor }), 1);
assertEqual(computeCareMortalityMultiplier({ active: false, mortalityFactor: 5 }), 1);

const inputs = { pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch', pflegeRampUp: 100,
    geschlecht: 'm', startAlter: 80, pflegeMaxFloor: 100000, startFloorBedarf: 0, pflegeKostenDrift: 0,
    pflegeGradeConfigs: { 1: { mortalityFactor: 1.5 }, 2: { mortalityFactor: 3 } } };
const care = { ...makeDefaultCareMeta(true, 'm'), triggered: true, active: true, grade: 1, currentYearInCare: 1 };
updateCareMeta(care, inputs, 80, {}, () => 0, {}, 0, true);
assertEqual(care.grade, 2);
assertEqual(computeCareMortalityMultiplier(care, inputs), 3, 'Neuer Grad wirkt sofort, auch nach langem Aufenthalt im vorigen Grad');
const random = () => .13; random.fork = () => () => .999;
const life = createMonteCarloLifeState(inputs, random);
Object.assign(life.careMetaP1, { triggered: true, active: true, grade: 2, currentYearInCare: 0 });
updateMonteCarloLifeEventsForYear(life, inputs, { mode: 'stop', percent: 0 }, 0, { jahr: 2000, inflation: 0 }, 0, null, false, random);
assertEqual(life.p1Alive, false, 'Gemeinsamer Sweep-Lebenspfad zieht im ersten Pflegejahr den vollen Faktor');

// Geschlecht stammt aus der Pflegeperson, damit P2 nicht die Eintrittstabelle von P1 nutzt.
for (const sex of ['m', 'w', 'd']) {
    const table = PFLEGE_GRADE_PROBABILITIES_BY_SEX[sex];
    const total = table[80][1] + table[80][2];
    for (const [roll, expected] of [[table[80][1] / 2, 1], [(table[80][1] + total) / 2, 2], [total + .001, null]]) {
        const meta = makeDefaultCareMeta(true, sex);
        updateCareMeta(meta, inputs, 80, {}, () => roll, {}, 0, true);
        assertEqual(meta.grade, expected);
    }
}
const cohort = calibrateCareModel();
assertEqual(cohort.bySex.m.initialCases, 8500);
assertEqual(cohort.bySex.w.initialCases, 8840);
for (const [sex, data] of Object.entries(cohort.bySex)) for (const [age, row] of Object.entries(data.prevalence)) {
    assert(row.alive >= 100, `${sex}/${age}: höchste Altersstufe bleibt beobachtbar`);
    assert(Math.abs(row.modelPct - row.officialPct) <= row.tolerancePp, `${sex}/${age}: ${row.modelPct} gegen ${row.officialPct}`);
}
for (const row of cohort.gradeShares) assert(Math.abs(row.modelPct - row.officialPct) <= 4, `Grad ${row.grade}`);
assertEqual(cohort.passed, true);
