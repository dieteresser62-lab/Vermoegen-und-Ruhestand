/** FR-41: reproduzierbare Kohorte ab 65 mit beobachtetem Startbestand.
 * node scripts/calibrate-care-model.mjs [--persons=200000] [--seed=4102026] [--birth-year=1961]
 * FR-75: Todesziehung mit der Grundsterblichkeit ohne Pflege (gesund ab 65) × Pflegefaktor.
 * Ziel ist die Periodentafel 2023/25, weil die Pflegestatistik 2023 ein Querschnitt ist;
 * `--birth-year` rechnet zur Information mit der Kohortentafel dieses Jahrgangs.
 * Prävalenz/Gradbestand: überlebende Personenjahre am Jahresende, ab 95 gepoolt.
 * Dauer: volle Pflegejahre, im Sterbejahr ein halbes Jahr (FR-17).
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT as contract } from '../app/simulator/simulator-data.js';
import { makeDefaultCareMeta, updateCareMeta, computeCareMortalityMultiplier } from '../app/simulator/simulator-engine-helpers.js';
import { computeCareAdjustedBaseMortality, resolveCareAdjustmentModel } from '../app/simulator/target-mortality.js';
import { rng, makeRunSeed } from '../app/simulator/simulator-utils.js';

// Harte Nebenbedingung: ein unzulässiger Parametersatz wird nicht abgestimmt.
export function assertMonotoneCareEntry(tables = contract.care.entryModel.probabilitiesBySexAndAgeAndInitialGrade) {
    for (const [sex, table] of Object.entries(tables)) {
        let previous = 0;
        for (const age of Object.keys(table).map(Number).sort((a, b) => a - b)) {
            const total = table[age][1] + table[age][2];
            if (!Number.isFinite(total) || total < previous || total > 1 || table[age][1] < 0 || table[age][2] < 0) {
                throw new RangeError(`Pflegeeintritt muss nicht fallend sein: ${sex}/${age}.`);
            }
            previous = total;
        }
    }
}

export function calibrationInitialGrade(person, persons, sex) {
    const stock = Math.round(persons * contract.care.entryModel.calibration.initialStock.prevalencePctBySex[sex] / 100);
    if (person >= stock) return null;
    const counts = contract.care.officialObservation.countsByGrade;
    const assigned = Object.values(counts).reduce((sum, count) => sum + count, 0);
    let cumulative = 0;
    for (let grade = 1; grade <= 5; grade++) {
        cumulative += counts[grade];
        if (person < Math.round(stock * cumulative / assigned)) return grade;
    }
    return 5;
}

export function calibrateCareModel({ persons = 200000, seed = 4102026, birthYear = NaN } = {}) {
    if (!Number.isSafeInteger(persons) || persons < 1 || !Number.isSafeInteger(seed) || seed === 0) {
        throw new RangeError('Positive Personenzahl und fester Seed ungleich 0 erforderlich.');
    }
    assertMonotoneCareEntry();
    const inputs = { pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch',
        pflegeGradeConfigs: Object.fromEntries(Object.entries(contract.care.mortalityModel.defaultFactorsByGrade)
            .map(([grade, mortalityFactor]) => [grade, { mortalityFactor, flexCut: 1, zusatz: 0 }])) };
    const bySex = {}, grades = [0, 0, 0, 0, 0];
    for (const [sexIndex, sex] of ['m', 'w'].entries()) {
        const base = computeCareAdjustedBaseMortality({ gender: sex, birthYear, startAge: 65,
            careModel: resolveCareAdjustmentModel(inputs) }).base;
        const bands = Object.fromEntries([65, 70, 75, 80, 85, 90, 95].map(age => [age, { alive: 0, care: 0 }]));
        let cases = 0, deathsInCare = 0, careYears = 0, initialCases = 0;
        for (let person = 0; person < persons; person++) {
            const random = rng(makeRunSeed(seed, sexIndex, person));
            const careRandom = random.fork('CARE_P1');
            const care = makeDefaultCareMeta(true, sex);
            const initialGrade = calibrationInitialGrade(person, persons, sex);
            if (initialGrade) {
                initialCases++;
                Object.assign(care, { triggered: true, active: true, grade: initialGrade, currentYearInCare: 1 });
            }
            for (let age = 65; age <= 110; age++) {
                // Wie in MC/Sweep: Pflegeupdate vor Todesziehung; keine Preisrechnung nötig.
                updateCareMeta(care, inputs, age, {}, careRandom, {}, age - 65, true);
                const died = random() < Math.min(1, base[age] * computeCareMortalityMultiplier(care, inputs));
                if (care.active) careYears += died ? .5 : 1;
                if (died) { if (care.triggered) cases++; if (care.active) deathsInCare++; break; }
                const band = bands[Math.min(95, 65 + 5 * Math.floor((age - 65) / 5))];
                band.alive++;
                if (care.active) { band.care++; grades[care.grade - 1]++; }
            }
        }
        bySex[sex] = { initialCases, initialPrevalencePct: 100 * initialCases / persons,
            cases, careYears, meanCareYearsPerCase: careYears / cases,
            deathsInCarePct: 100 * deathsInCare / persons,
            prevalence: Object.fromEntries(Object.entries(bands).map(([age, counts]) => [age, {
                ...counts, modelPct: 100 * counts.care / counts.alive,
                officialPct: contract.care.officialObservation.observedPrevalencePctBySexAndAgeBand[sex][age],
                tolerancePp: Number(age) < 90 ? 3 : 5
            }])) };
    }
    const gradeYears = grades.reduce((a, b) => a + b, 0);
    const gradeShares = grades.map((count, index) => ({ grade: index + 1, count,
        modelPct: 100 * count / gradeYears,
        officialPct: contract.care.officialObservation.sharesPctByGrade[index + 1], tolerancePp: 4 }));
    const checks = [...Object.values(bySex).flatMap(sex => Object.values(sex.prevalence)), ...gradeShares];
    return { personsPerSex: persons, seed, mortalityTarget: Number.isFinite(birthYear) ? `cohort_V2_${birthYear}` : 'period_2023_2025',
        observation: 'year-end surviving person-years; observed stock at 65; chronic care; base mortality without care (healthy from 65) times care factor (FR-75); care duration counted from age 65 only',
        initialStock: contract.care.entryModel.calibration.initialStock,
        gradeReference: contract.care.mortalityModel.gradeReference, bySex, gradeShares,
        passed: checks.every(row => Number.isFinite(row.modelPct) && Math.abs(row.modelPct - row.officialPct) <= row.tolerancePp) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const option = (name, fallback) => Number(process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
    const result = calibrateCareModel({ persons: option('persons', 200000), seed: option('seed', 4102026), birthYear: option('birth-year', NaN) });
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
}
