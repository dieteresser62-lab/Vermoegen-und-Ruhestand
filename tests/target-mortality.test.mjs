// FR-75: Zieltafel (Kohorte V2), exakte Pflegeabstimmung der Grundsterblichkeit, Simulationsdauer.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GERMAN_COHORT_LIFE_TABLE } from '../app/simulator/german-cohort-life-table.js';
import { GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT as CONTRACT, MORTALITY_TABLE } from '../app/simulator/german-demography-care-survivor-contract.js';
import {
    applyCareTodayMortalityFloor, computeCareAdjustedBaseMortality, resolveBaseMortalityProbability, resolveCareAdjustmentModel,
    resolveCareMortalityFactorsByGrade, resolveInputsPersonBirthYear, resolveTargetMortalityProbability,
    resolveTargetMortalityTable, resolveTargetMortalityReferenceYear
} from '../app/simulator/target-mortality.js';
import { makeDefaultCareMeta, updateCareMeta, computeCareMortalityMultiplier } from '../app/simulator/simulator-engine-helpers.js';
import { rng, makeRunSeed } from '../app/simulator/simulator-utils.js';
import { estimateRemainingLifeYears } from '../app/shared/life-expectancy.js';
import { normalizeMonteCarloParametersV1, resolveMonteCarloDefaultDurationV1 } from '../app/simulator/monte-carlo-parameters.js';
import { readStoredMonteCarloDuration, effectiveMonteCarloDurationValue, syncMonteCarloDurationDefault } from '../app/simulator/monte-carlo-duration.js';

console.log('--- FR-75 Zieltafel und Pflegeabstimmung ---');
const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = CONTRACT.care.entryModel.probabilitiesBySexAndAgeAndInitialGrade;
const PROGRESSION = CONTRACT.care.progressionModel.probabilitiesByCurrentGrade;
const configs = factors => Object.fromEntries(Object.entries(factors).map(([grade, mortalityFactor]) =>
    [grade, { mortalityFactor, flexCut: 1, zusatz: 0 }]));
const DEFAULT_FACTORS = CONTRACT.care.mortalityModel.defaultFactorsByGrade;

// 1. Daten: Prüfung des Bauskripts, Tafel V2, Schwanz ab 100, Lebenserwartung bei 65 wie Destatis.
const verify = spawnSync(process.execPath, ['scripts/build-german-cohort-life-table.mjs', '--verify-only'], { cwd: projectRoot, encoding: 'utf8' });
assertEqual(verify.status, 0, `Kohortentafel lässt sich aus dem Original rekonstruieren: ${verify.stderr}`);
assertEqual(GERMAN_COHORT_LIFE_TABLE.variant.id, 'V2', 'Variante V2 (mittel) fest');
assertEqual(CONTRACT.mortality.target.qxTableHash, GERMAN_COHORT_LIFE_TABLE.hashes.qxTableHash, 'Vertrag nennt den Tafelhash');
assertEqual(resolveTargetMortalityProbability('m', 99, 1960), GERMAN_COHORT_LIFE_TABLE.qx.m[1960][81], 'Alter 99 aus der Quelle');
assertClose(resolveTargetMortalityProbability('w', 104, 1960),
    MORTALITY_TABLE.w[104] * GERMAN_COHORT_LIFE_TABLE.qx.w[1960][81] / MORTALITY_TABLE.w[99], 1e-15, 'Schwanz skaliert');
assertEqual(resolveTargetMortalityProbability('m', 110, 1960), 1, '110 bleibt terminal');
assertEqual(resolveTargetMortalityProbability('x', 70, 1960), 1, 'Unbekanntes Geschlecht wie bisher');
assertEqual(resolveTargetMortalityProbability('m', 70, 1900), resolveTargetMortalityProbability('m', 70, 1926), 'Jahrgang vor 1926 nutzt den Rand');
assertClose(resolveTargetMortalityProbability('d', 70, 1960),
    (resolveTargetMortalityProbability('m', 70, 1960) + resolveTargetMortalityProbability('w', 70, 1960)) / 2, 1e-15, 'divers = Mittel');
assertEqual(resolveTargetMortalityProbability('m', 70), MORTALITY_TABLE.m[70], 'Ohne Geburtsjahr Periodentafel');
assertEqual(resolveTargetMortalityTable('w'), MORTALITY_TABLE.w, 'Lebenserwartung ohne Geburtsjahr bytegleich');
for (const sex of ['m', 'w']) for (const year of [1940, 1956, 1960, 1966, 1975]) {
    let survival = 1, e = 0.5;
    for (let age = 65; age < 110; age++) { survival *= 1 - resolveTargetMortalityProbability(sex, age, year); e += survival; }
    const official = GERMAN_COHORT_LIFE_TABLE.officialLifeExpectancyAt65Years[sex][year - 1926];
    assert(Math.abs(e - official) < 0.1, `${sex}/${year}: e65 ${e.toFixed(2)} gegen Destatis ${official.toFixed(2)}`);
}
assert(estimateRemainingLifeYears('m', 66, 1960) >= estimateRemainingLifeYears('m', 66), 'Kohorte lebt nicht kürzer als die Periode');

// 2. Geburtsjahr und Faktoren wie im Pflegemodell.
assertEqual(resolveInputsPersonBirthYear({ startAlter: 60, geburtsjahr: 1965 }, 0), 1965, 'Geburtsjahr aus dem Profil');
assertEqual(resolveInputsPersonBirthYear({ startAlter: 60 }, 0), resolveTargetMortalityReferenceYear() - 60, 'Fallback Bezugsjahr (App-Uhr) − Startalter');
assertEqual(resolveInputsPersonBirthYear({ partner: { aktiv: true, startAlter: 58, geburtsjahr: 1970 } }, 1), 1970, 'Partner');
for (const inputs of [{}, { pflegeGradeConfigs: configs({ 1: 0, 2: 2.5, 3: '4', 4: null, 5: 7 }) },
    { pflegeGradeConfigs: { 3: { mortalityFactor: 6 } } }, { pflegeStufe1Mortality: 2.2 }]) {
    const factors = resolveCareMortalityFactorsByGrade(inputs);
    for (const grade of [1, 2, 3, 4, 5]) {
        const care = { ...makeDefaultCareMeta(true, 'm'), triggered: true, active: true, grade, currentYearInCare: 0 };
        updateCareMeta(care, { ...inputs, pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch' }, 80, {}, () => 1, {}, 0, true);
        assertEqual(factors[grade], computeCareMortalityMultiplier(care), `Faktor Grad ${grade} wie Laufzeit`);
    }
}
assertEqual(resolveCareAdjustmentModel({ pflegefallLogikAktivieren: false }), null, 'Ohne Pflegelogik keine Absenkung');
assertEqual(resolveBaseMortalityProbability({ startAlter: 70, geschlecht: 'w', geburtsjahr: 1956 }, 0, 'w', 80),
    resolveTargetMortalityProbability('w', 80, 1956), 'Ohne Pflegelogik lebt jede Person wie die Tafel');

// 3. Deterministisch: unabhängige Vorwärtsrechnung der Zustände, Gesamtsterblichkeit = Ziel (|Δ| < 1e-12).
function forwardTotals({ sex, birthYear, startAge, inputs }) {
    const base = Array.from({ length: 111 }, (_, age) => resolveBaseMortalityProbability(inputs, 0, sex, age));
    const factors = resolveCareMortalityFactorsByGrade(inputs);
    const acute = inputs.pflegeModellTyp === 'akut';
    const durations = acute ? Array.from({ length: inputs.pflegeMaxDauer - inputs.pflegeMinDauer + 1 }, (_, k) => inputs.pflegeMinDauer + k) : [Infinity];
    let states = [{ grade: 0, rest: 0, done: false, mass: 1 }];
    let maxError = 0;
    for (let age = startAge; age < 110; age++) {
        const next = [];
        for (const state of states) {
            if (state.grade === 0) {
                const bucket = [95, 90, 85, 80, 75, 70, 65].find(candidate => age >= candidate);
                const entry = !state.done && bucket ? ENTRY[sex][bucket] : { 1: 0, 2: 0 };
                next.push({ ...state, mass: state.mass * (1 - entry[1] - entry[2]) });
                for (const grade of [1, 2]) for (const duration of durations) {
                    const mass = state.mass * entry[grade] / durations.length;
                    next.push(duration <= 0 ? { grade: 0, rest: 0, done: true, mass } : { grade, rest: duration - 1, done: true, mass });
                }
            } else if (state.rest <= 0) next.push({ grade: 0, rest: 0, done: true, mass: state.mass });
            else {
                const p = state.grade < 5 ? PROGRESSION[state.grade] : 0;
                next.push({ grade: state.grade, rest: state.rest - 1, done: true, mass: state.mass * (1 - p) });
                if (p) next.push({ grade: state.grade + 1, rest: state.rest - 1, done: true, mass: state.mass * p });
            }
        }
        const alive = next.reduce((sum, state) => sum + state.mass, 0);
        const qOf = state => Math.min(1, base[age] * (state.grade ? factors[state.grade] : 1));
        const total = next.reduce((sum, state) => sum + state.mass * qOf(state), 0) / alive;
        maxError = Math.max(maxError, Math.abs(total - resolveTargetMortalityProbability(sex, age, birthYear)));
        const merged = new Map();
        for (const state of next) {
            const key = `${state.grade}|${state.rest}|${state.done}`;
            const survivors = state.mass * (1 - qOf(state));
            if (survivors > 0) merged.set(key, { ...state, mass: (merged.get(key)?.mass || 0) + survivors });
        }
        states = [...merged.values()];
    }
    return maxError;
}
let deterministicMax = 0;
for (const sex of ['m', 'w']) for (let startAge = 55; startAge <= 90; startAge += 5) {
    for (const factors of [DEFAULT_FACTORS, { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }, { 1: 3, 2: 4, 3: 6, 4: 8, 5: 10 }]) {
        for (const model of [{ pflegeModellTyp: 'chronisch' }, { pflegeModellTyp: 'akut', pflegeMinDauer: 2, pflegeMaxDauer: 6 }]) {
            const birthYear = 2026 - startAge;
            const inputs = { startAlter: startAge, geschlecht: sex, geburtsjahr: birthYear, pflegefallLogikAktivieren: true, ...model, pflegeGradeConfigs: configs(factors) };
            const error = forwardTotals({ sex, birthYear, startAge, inputs });
            deterministicMax = Math.max(deterministicMax, error);
            assert(error < 1e-12, `${sex}/${startAge}/${JSON.stringify(factors)}/${model.pflegeModellTyp}: |Δ| ${error}`);
        }
    }
}
console.log(`deterministisch: größte Abweichung ${deterministicMax.toExponential(2)}`);

// 4. Stichprobe mit den Laufzeitfunktionen: Lebenserwartung = Zieltafel ± 0,3 Jahre (Periode und Kohorte).
function targetLifeExpectancy(sex, age, birthYear) {
    let survival = 1, e = 0.5;
    for (let a = age; a < 110; a++) { survival *= 1 - resolveTargetMortalityProbability(sex, a, birthYear); e += survival; }
    return e;
}
function sampleLifeExpectancy({ sex, startAge, care, target, persons = 20000, careToday = null }) {
    const birthYear = 2026 - startAge;
    const inputs = { startAlter: startAge, geschlecht: sex, geburtsjahr: birthYear, pflegefallLogikAktivieren: care,
        pflegeModellTyp: 'chronisch', pflegeGradeConfigs: configs(DEFAULT_FACTORS), partner: { aktiv: false } };
    const periodBase = target === 'period'
        ? computeCareAdjustedBaseMortality({ gender: sex, birthYear: NaN, startAge, careModel: resolveCareAdjustmentModel(inputs) }).base : null;
    let sum = 0;
    for (let person = 0; person < persons; person++) {
        const random = rng(makeRunSeed(777, startAge * 10 + (sex === 'm' ? 1 : 2) + (care ? 5 : 0), person));
        const careRandom = random.fork('CARE_P1');
        const meta = makeDefaultCareMeta(care, sex, careToday, startAge, inputs);
        let years = 0;
        for (; years < 120; years++) {
            const age = startAge + years;
            if (meta) updateCareMeta(meta, inputs, age, {}, careRandom, {}, years, true);
            let q = periodBase ? periodBase[Math.min(age, 110)] : resolveBaseMortalityProbability(inputs, 0, sex, age);
            const factor = computeCareMortalityMultiplier(meta);
            if (factor > 1) q = Math.min(1, q * factor);
            if (!periodBase) q = applyCareTodayMortalityFloor(q, meta, inputs, 0, sex, age);
            if (random() < q) break;
        }
        sum += years + 0.5;
    }
    return { simulated: sum / persons, target: targetLifeExpectancy(sex, startAge, target === 'period' ? NaN : birthYear) };
}
let sampleMax = 0;
for (const target of ['cohort', 'period']) for (const sex of ['m', 'w']) for (const startAge of [55, 60, 66, 70, 75, 80, 85, 90]) {
    for (const care of [false, true]) {
        const { simulated, target: expected } = sampleLifeExpectancy({ sex, startAge, care, target, persons: target === 'cohort' ? 20000 : 10000 });
        sampleMax = Math.max(sampleMax, Math.abs(simulated - expected));
        assert(Math.abs(simulated - expected) <= 0.3, `${target}/${sex}/${startAge}/Pflege ${care}: ${simulated.toFixed(2)} gegen ${expected.toFixed(2)}`);
    }
}
console.log(`Stichprobe: größte Abweichung ${sampleMax.toFixed(3)} Jahre`);
// Richtungsprobe: Pflegegrad heute verkürzt das Leben gegenüber der Tafel.
for (const sex of ['m', 'w']) {
    const { simulated, target } = sampleLifeExpectancy({ sex, startAge: 75, care: true, target: 'cohort', persons: 5000, careToday: { grade: 3 } });
    assert(simulated < target - 1, `${sex}: Pflegegrad 3 heute verkürzt (${simulated.toFixed(2)} gegen ${target.toFixed(2)})`);
}
// LE-1b: Mit „langsamer“ und „viel langsamer“ stirbt eine Person mit Pflegegrad heute mindestens wie die Tafel.
// Exakte Rechnung nach den Regeln von updateCareMeta (Fortschritt ab dem zweiten Jahr, gedämpfter Faktor im Ausgangsgrad).
function careTodayLifeExpectancy({ sex, startAge, grade, course }) {
    const birthYear = 2026 - startAge;
    const inputs = { startAlter: startAge, geschlecht: sex, geburtsjahr: birthYear, pflegefallLogikAktivieren: true,
        pflegeModellTyp: 'chronisch', pflegeGradeConfigs: configs(DEFAULT_FACTORS), partner: { aktiv: false } };
    const meta = makeDefaultCareMeta(true, sex, { grade, progression: course }, startAge, inputs);
    const slowdown = meta.initialProgressionFactor;
    let states = new Map([[grade, 1]]), e = 0.5;
    for (let age = startAge; age < 110; age++) {
        if (age > startAge) {
            const next = new Map();
            for (const [current, mass] of states) {
                const p = current < 5 ? PROGRESSION[current] * slowdown : 0;
                next.set(current, (next.get(current) || 0) + mass * (1 - p));
                if (p) next.set(current + 1, (next.get(current + 1) || 0) + mass * p);
            }
            states = next;
        }
        const base = resolveBaseMortalityProbability(inputs, 0, sex, age);
        let alive = 0;
        for (const [current, mass] of states) {
            const factor = computeCareMortalityMultiplier({ ...meta, grade: current, mortalityFactor: DEFAULT_FACTORS[current] });
            const q = applyCareTodayMortalityFloor(Math.min(1, base * factor), meta, inputs, 0, sex, age);
            states.set(current, mass * (1 - q));
            alive += mass * (1 - q);
        }
        e += alive;
    }
    return { exact: e, target: targetLifeExpectancy(sex, startAge, birthYear) };
}
let careTodayClosest = -Infinity;
for (const sex of ['m', 'w']) for (let startAge = 66; startAge <= 90; startAge++) for (const grade of [1, 2, 3, 4, 5]) {
    for (const course of ['normal', 'slower', 'much_slower']) {
        const { exact, target } = careTodayLifeExpectancy({ sex, startAge, grade, course });
        careTodayClosest = Math.max(careTodayClosest, exact - target);
        assert(exact < target, `${sex}/${startAge}/Grad ${grade}/${course}: Pflegegrad heute verkürzt (${exact.toFixed(3)} gegen ${target.toFixed(3)})`);
    }
}
console.log(`Pflegegrad heute: größter Wert Lebenserwartung − Tafel ${careTodayClosest.toFixed(3)} Jahre`);
assertEqual(applyCareTodayMortalityFloor(0.01, { initialGrade: 2, initialProgressionFactor: 1 }, { startAlter: 85, geburtsjahr: 1941 }, 0, 'w', 95), 0.01,
    'Üblicher Verlauf: keine Untergrenze, Rechnung unverändert');
assertEqual(applyCareTodayMortalityFloor(0.01, { initialGrade: 0 }, { startAlter: 85, geburtsjahr: 1941 }, 0, 'w', 95), 0.01, 'Ohne Pflegegrad heute keine Untergrenze');
// Sollfall Gutachten: Frau 85, Grad 2, „viel langsamer“ lebt nicht länger als die Tafel (vorher 7,89 statt 6,96 Jahre).
{
    const sollfall = careTodayLifeExpectancy({ sex: 'w', startAge: 85, grade: 2, course: 'much_slower' });
    assertClose(sollfall.target, 6.96, 0.005, 'Sollfall: Tafelwert Frau 85 (Jahrgang 1941)');
    assertClose(sollfall.exact, 6.56, 0.005, 'Sollfall: Frau 85, Grad 2, viel langsamer, exakt');
    const { simulated, target } = sampleLifeExpectancy({ sex: 'w', startAge: 85, care: true, target: 'cohort', persons: 20000,
        careToday: { grade: 2, progression: 'much_slower' } });
    assert(simulated <= target, `Sollfall mit den Laufzeitfunktionen: ${simulated.toFixed(2)} ≤ ${target.toFixed(2)}`);
    assert(Math.abs(simulated - sollfall.exact) < 0.1, `Laufzeit trifft die exakte Rechnung (${simulated.toFixed(2)} gegen ${sollfall.exact.toFixed(2)})`);
}

// 5. Simulationsdauer: 110 − Alter der jüngsten Person; gespeicherte 35 gilt als automatisch.
assertEqual(resolveMonteCarloDefaultDurationV1({ startAlter: 58, partner: { aktiv: true, startAlter: 56 } }), 54, 'Jüngste Person 56 → 54 Jahre');
assertEqual(resolveMonteCarloDefaultDurationV1({ startAlter: 67, partner: { aktiv: false, startAlter: 30 } }), 43, 'Inaktiver Partner zählt nicht');
assertEqual(resolveMonteCarloDefaultDurationV1({ startAlter: 110 }), 1, 'Mindestens ein Jahr');
assertEqual(resolveMonteCarloDefaultDurationV1(null), 35, 'Ohne Personen feste Vorgabe');
assertEqual(normalizeMonteCarloParametersV1({ maxDauer: '' }, { inputs: { startAlter: 66 } }).maxDauer, 44, 'Leeres Feld = automatisch');
assertEqual(normalizeMonteCarloParametersV1({ maxDauer: '35' }, { inputs: { startAlter: 66 } }).maxDauer, 35, 'Eigener Wert bleibt');
assertEqual(readStoredMonteCarloDuration('35'), '', 'Alte Vorgabe 35 gilt beim Lesen als automatisch');
assertEqual(readStoredMonteCarloDuration('40'), '40', 'Andere gespeicherte Werte bleiben');
const field = { value: '', placeholder: '', dataset: {} };
const hint = { textContent: '' };
const doc = { getElementById: id => ({ mcDauer: field, mcDauerAuto: hint })[id] ?? null };
assertEqual(syncMonteCarloDurationDefault(doc, { startAlter: 58, partner: { aktiv: true, startAlter: 56 } }), 54, 'Anzeige rechnet die Vorgabe');
assertEqual(hint.textContent, 'automatisch: bis Alter 110 der jüngsten Person · 54 Jahre', 'Hinweis zeigt die automatische Dauer');
assertEqual(effectiveMonteCarloDurationValue(field), '54', 'Wirksamer Wert ohne eigenen Wert');
field.value = '30';
syncMonteCarloDurationDefault(doc, { startAlter: 58, partner: { aktiv: true, startAlter: 56 } });
assertEqual(effectiveMonteCarloDurationValue(field), '30', 'Eigener Wert gilt');
assert(hint.textContent.startsWith('eigener Wert'), 'Hinweis nennt den eigenen Wert');
console.log('✅ FR-75 Zieltafel und Pflegeabstimmung');
