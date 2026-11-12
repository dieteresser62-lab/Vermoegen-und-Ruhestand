// @ts-check
/** FR-75: Zieltafel der Lebenserwartung und Grundsterblichkeit ohne Pflege.
 *
 * Zieltafel ist die Destatis-Kohortensterbetafel V2 des Geburtsjahrgangs (Alter 18–99),
 * ab 100 der Periodenschwanz, skaliert mit dem Verhältnis Kohorte/Periode bei 99; 110 ist terminal.
 * Ohne Geburtsjahr gilt die Periodentafel 2023/25 (bisheriger Aufrufvertrag).
 *
 * Grundsterblichkeit ohne Pflege (R2): Eine Person, die zum Startalter ohne Pflege ist,
 * lebt im Mittel wie die Zieltafel. Je Alter wird die Grundsterblichkeit q so gewählt, dass
 * Σ Anteil(Zustand) × min(1, q × Faktor(Zustand)) = q_ziel gilt. Die Anteile kommen aus einer
 * exakten Markov-Rechnung des Pflegemodells (Eintritt, Fortschritt, bei „akut“ die Dauer).
 * Die Gleichung ist stückweise linear und wird geschlossen gelöst. Nur abhängig von den
 * erzeugten Datenmodulen, damit Balance und Übersicht keine schweren Simulatormodule laden.
 */
import { GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT as CONTRACT } from './german-demography-care-survivor-contract.js';
import { GERMAN_COHORT_LIFE_TABLE as COHORT } from './german-cohort-life-table.js';
import { appNow } from '../shared/app-clock.js';

const PERIOD = CONTRACT.mortality.table;
const MAX_AGE = CONTRACT.mortality.runtimeAgeRange.endAge;
const MIN_AGE = CONTRACT.mortality.runtimeAgeRange.startAge;
const COHORT_FIRST_AGE = COHORT.ages.first;
const COHORT_LAST_AGE = COHORT.ages.last;
const ENTRY_BY_SEX = CONTRACT.care.entryModel.probabilitiesBySexAndAgeAndInitialGrade;
const PROGRESSION = CONTRACT.care.progressionModel.probabilitiesByCurrentGrade;
const DEFAULT_FACTORS = CONTRACT.care.mortalityModel.defaultFactorsByGrade;
const CARE_GRADES = CONTRACT.care.taxonomy.grades;
const ENTRY_BUCKETS = Object.keys(ENTRY_BY_SEX.d).map(Number).sort((a, b) => a - b);

/** Früheres festes Bezugsjahr des Ersatz-Geburtsjahrs. Seit LE-1b nicht mehr verwendet: Fehlt das Geburtsjahr,
 * gilt das Bezugsjahr der Aufrufstelle, sonst das Jahr der App-Uhr (im Spielbereich das Testdatum).
 * Bleibt als Export für bestehende Aufrufer. */
export const TARGET_MORTALITY_FALLBACK_REFERENCE_YEAR = 2026;

/** Bezugsjahr des Ersatz-Geburtsjahrs: Jahr der App-Uhr, im Spielbereich das Testdatum. */
export function resolveTargetMortalityReferenceYear() {
    return appNow().getFullYear();
}

/** @param {number} birthYear */
function cohortYear(birthYear) {
    return Math.min(COHORT.birthYears.last, Math.max(COHORT.birthYears.first, Math.round(birthYear)));
}

/** @param {'m'|'w'} sex @param {number} age @param {number} birthYear */
function cohortQx(sex, age, birthYear) {
    if (age < MIN_AGE) return 1;
    if (age >= MAX_AGE) return 1;
    const row = COHORT.qx[sex][cohortYear(birthYear)];
    if (age <= COHORT_LAST_AGE) return row[age - COHORT_FIRST_AGE];
    return Math.min(1, PERIOD[sex][age] * row[COHORT_LAST_AGE - COHORT_FIRST_AGE] / PERIOD[sex][COHORT_LAST_AGE]);
}

/** Jährliche Sterbewahrscheinlichkeit der Zieltafel; unbekanntes Geschlecht oder Alter → 1 wie bisher.
 * @param {string} gender @param {number} age @param {number} [birthYear] */
export function resolveTargetMortalityProbability(gender, age, birthYear) {
    const normalizedAge = Number(age);
    const period = PERIOD[gender];
    if (!period || !Number.isSafeInteger(normalizedAge) || normalizedAge < 0) return 1;
    if (!Number.isFinite(birthYear)) {
        const probability = Number(period[normalizedAge]);
        return Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : 1;
    }
    const by = /** @type {number} */ (birthYear);
    if (gender === 'd') return (cohortQx('m', normalizedAge, by) + cohortQx('w', normalizedAge, by)) / 2;
    return cohortQx(/** @type {'m'|'w'} */ (gender), normalizedAge, by);
}

const tableCache = new Map();
/** Zieltafel als Objekt Alter → qx (Alter 18–110) für die Lebenserwartung. Ohne Geburtsjahr
 * die Periodentafel; unbekanntes Geschlecht nutzt wie bisher die Männertafel.
 * @param {string} gender @param {number} [birthYear] @returns {Readonly<Record<number, number>>} */
export function resolveTargetMortalityTable(gender, birthYear) {
    const sex = PERIOD[gender] ? gender : 'm';
    if (!Number.isFinite(birthYear)) return PERIOD[sex];
    const key = `${sex}|${cohortYear(/** @type {number} */ (birthYear))}`;
    let table = tableCache.get(key);
    if (!table) {
        table = {};
        for (let age = MIN_AGE; age <= MAX_AGE; age++) table[age] = resolveTargetMortalityProbability(sex, age, birthYear);
        table = Object.freeze(table);
        tableCache.set(key, table);
    }
    return table;
}

/** Geburtsjahr einer Person: gespeichertes Jahr, sonst Bezugsjahr − Startalter.
 * Ohne Bezugsjahr der Aufrufstelle gilt das Jahr der App-Uhr (LE-1b).
 * @param {unknown} birthYear @param {unknown} startAge @param {number} [referenceYear] */
export function resolveBirthYear(birthYear, startAge, referenceYear) {
    const stored = Number(birthYear);
    if (birthYear !== null && birthYear !== undefined && birthYear !== '' && Number.isSafeInteger(stored)) return stored;
    const year = Number.isSafeInteger(referenceYear) ? /** @type {number} */ (referenceYear) : resolveTargetMortalityReferenceYear();
    return year - Number(startAge);
}

/** @param {any} inputs @param {number} personIndex 0 = P1, 1 = P2 @param {number} [referenceYear] */
export function resolveInputsPersonBirthYear(inputs, personIndex, referenceYear) {
    return personIndex === 0
        ? resolveBirthYear(inputs?.geburtsjahr, inputs?.startAlter, referenceYear)
        : resolveBirthYear(inputs?.partner?.geburtsjahr, inputs?.partner?.startAlter, referenceYear);
}

/** Wirksamer Sterblichkeitsfaktor je Grad, wie `resolveGradeConfig` im Pflegemodell (Werte ≤ 1 neutral).
 * @param {any} inputs @returns {Record<number, number>} */
export function resolveCareMortalityFactorsByGrade(inputs) {
    const configs = inputs?.pflegeGradeConfigs;
    /** @type {Record<number, number>} */
    const factors = {};
    for (const grade of CARE_GRADES) {
        let raw = inputs?.pflegeStufe1Mortality;
        if (configs && configs[grade]) raw = configs[grade].mortalityFactor;
        else if (configs) {
            const fallback = CARE_GRADES.find(candidate => configs[candidate]);
            if (fallback !== undefined) raw = configs[fallback].mortalityFactor;
        }
        const numeric = Number(raw);
        factors[grade] = Math.max(1, Math.max(0, Number.isFinite(numeric) ? numeric : DEFAULT_FACTORS[grade]));
    }
    return factors;
}

/** Verteilung der Akutdauer wie `Math.floor(rand() * (max - min + 1)) + min`.
 * @param {number} min @param {number} max @returns {Array<[number, number]>} */
function acuteDurationDistribution(min, max) {
    const width = max - min + 1;
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(min)) return [[min, 1]];
    const out = [];
    for (let k = 0; k < width; k++) out.push(/** @type {[number, number]} */ ([min + k, (Math.min(k + 1, width) - k) / width]));
    return out;
}

/** Pflegeannahmen der Abstimmung; ohne Pflegelogik `null` (Grundsterblichkeit = Zieltafel).
 * @param {any} inputs */
export function resolveCareAdjustmentModel(inputs) {
    if (!inputs?.pflegefallLogikAktivieren) return null;
    const acute = inputs.pflegeModellTyp === 'akut';
    return {
        acute,
        durations: acute ? acuteDurationDistribution(Number(inputs.pflegeMinDauer), Number(inputs.pflegeMaxDauer)) : null,
        factors: resolveCareMortalityFactorsByGrade(inputs)
    };
}

/** @param {any} entryBySex @param {string} gender @param {number} age */
function entryProbabilities(entryBySex, gender, age) {
    if (age < ENTRY_BUCKETS[0]) return null;
    let bucket = ENTRY_BUCKETS[0];
    for (const candidate of ENTRY_BUCKETS) if (age >= candidate) bucket = candidate;
    const table = (entryBySex[gender] || entryBySex.d)[bucket];
    const p1 = table?.[1] || 0, p2 = table?.[2] || 0;
    return p1 + p2 > 0 ? [p1, p2] : null;
}

/** Löst Σ m_i × min(1, q × f_i) = ziel × Σ m_i geschlossen (stückweise linear, f ≥ 1).
 * @param {number} healthyMass Masse mit Faktor 1 @param {Map<number, number>} massByFactor @param {number} target */
function solveBaseProbability(healthyMass, massByFactor, target) {
    if (target >= 1) return 1;
    if (target <= 0) return 0;
    let alive = healthyMass;
    let slope = healthyMass;
    const groups = [];
    for (const [factor, mass] of massByFactor) {
        alive += mass;
        if (factor > 1) { groups.push([factor, mass]); slope += factor * mass; } else slope += mass;
    }
    if (!(alive > 0)) return target;
    const needed = target * alive;
    let capped = 0;
    groups.sort((a, b) => b[0] - a[0]);
    for (const [factor, mass] of groups) {
        const upper = 1 / factor;
        if (upper * slope + capped >= needed) return (needed - capped) / slope;
        slope -= factor * mass;
        capped += mass;
    }
    return slope > 0 ? Math.min(1, (needed - capped) / slope) : 1;
}

/** Exakte Grundsterblichkeit einer Person ohne Pflege zum Startalter (Referenz R2).
 * `entryBySex`/`progression` ersetzen die Vertragswerte nur im Abstimmskript (FR-41).
 * @param {{gender:string; birthYear:number; startAge:number; careModel:{acute:boolean;durations:Array<[number,number]>|null;factors:Record<number,number>;entryBySex?:any;progression?:Record<number,number>}|null}} params
 * @returns {{base: Float64Array; careShare: Float64Array}} Index = Alter 0–110; vor dem Startalter die Zieltafel. */
export function computeCareAdjustedBaseMortality({ gender, birthYear, startAge, careModel }) {
    const base = new Float64Array(MAX_AGE + 1);
    const careShare = new Float64Array(MAX_AGE + 1);
    for (let age = 0; age <= MAX_AGE; age++) base[age] = resolveTargetMortalityProbability(gender, age, birthYear);
    if (!careModel) return { base, careShare };
    const { acute, durations, factors } = careModel;
    const entryBySex = careModel.entryBySex || ENTRY_BY_SEX;
    const progressionByGrade = careModel.progression || PROGRESSION;
    // Zustand zu Jahresbeginn: gesund (nie Pflege), nach Akutpflege, Pflege je Grad und Restjahren.
    let healthy = 1, after = 0;
    /** @type {Map<string, number>} */
    let care = new Map();
    const key = (/** @type {number} */ grade, /** @type {number} */ rest) => `${grade}|${rest}`;
    for (let age = Math.max(0, Math.floor(startAge)); age < MAX_AGE; age++) {
        // 1. Pflegeupdate: Ende der Akutdauer, Fortschritt bestehender Pflege, dann Eintritt.
        /** @type {Map<string, number>} */
        const next = new Map();
        const add = (/** @type {number} */ grade, /** @type {number} */ rest, /** @type {number} */ mass) => {
            if (mass > 0) next.set(key(grade, rest), (next.get(key(grade, rest)) || 0) + mass);
        };
        let nextAfter = after;
        for (const [stateKey, mass] of care) {
            const [grade, rest] = stateKey.split('|').map(Number);
            if (acute && rest <= 0) { nextAfter += mass; continue; }
            const progression = grade < 5 ? (progressionByGrade[grade] || 0) : 0;
            add(grade, rest - 1, mass * (1 - progression));
            if (grade < 5) add(grade + 1, rest - 1, mass * progression);
        }
        let nextHealthy = healthy;
        const entry = entryProbabilities(entryBySex, gender, age);
        if (entry) {
            nextHealthy = healthy * (1 - entry[0] - entry[1]);
            for (const [index, probability] of entry.entries()) {
                const grade = index + 1;
                if (!acute) { add(grade, Infinity, healthy * probability); continue; }
                for (const [duration, weight] of /** @type {Array<[number, number]>} */ (durations)) {
                    if (duration <= 0) nextAfter += healthy * probability * weight;
                    else add(grade, duration - 1, healthy * probability * weight);
                }
            }
        }
        // 2. Tod: Grundsterblichkeit so, dass die Gesamtsterblichkeit der Zieltafel entspricht.
        /** @type {Map<number, number>} */
        const massByFactor = new Map();
        let careMass = 0;
        for (const [stateKey, mass] of next) {
            const factor = factors[Number(stateKey.split('|')[0])];
            massByFactor.set(factor, (massByFactor.get(factor) || 0) + mass);
            careMass += mass;
        }
        const alive = nextHealthy + nextAfter + careMass;
        const q = solveBaseProbability(nextHealthy + nextAfter, massByFactor, base[age]);
        careShare[age] = alive > 0 ? careMass / alive : 0;
        base[age] = q;
        healthy = nextHealthy * (1 - q);
        after = nextAfter * (1 - q);
        care = new Map();
        for (const [stateKey, mass] of next) {
            care.set(stateKey, mass * (1 - Math.min(1, q * factors[Number(stateKey.split('|')[0])])));
        }
    }
    return { base, careShare };
}

/** Pflegegrad heute verkürzt immer (FR-75 Punkt 3, LE-1b): Die Grundsterblichkeit ist für alle Personen
 * abgesenkt, auch für eine Person mit Pflegegrad heute. Mit dem Verlauf „langsamer“ oder „viel langsamer“
 * ist ihr Faktor im Ausgangsgrad gedämpft (1 + (Faktor − 1) × Verlauf) und gleicht die Absenkung im hohen
 * Alter nicht mehr aus. Ihre Sterbewahrscheinlichkeit ist deshalb ihr Leben lang mindestens die Zieltafel.
 * Mit üblichem Verlauf und ohne Pflegegrad heute bleibt alles unverändert; die Abstimmung nach R2 gilt weiter.
 * @param {number} probability Grundsterblichkeit × Pflegefaktor, gedeckelt bei 1
 * @param {any} careMeta Pflegezustand der Person (`initialGrade`, `initialProgressionFactor`)
 * @param {any} inputs @param {number} personIndex 0 = P1, 1 = P2 @param {string} gender @param {number} age */
export function applyCareTodayMortalityFloor(probability, careMeta, inputs, personIndex, gender, age) {
    if (!(Number(careMeta?.initialGrade) > 0) || !(Number(careMeta.initialProgressionFactor) < 1)) return probability;
    return Math.max(probability, resolveTargetMortalityProbability(gender, Number(age), resolveInputsPersonBirthYear(inputs, personIndex)));
}

const baseCache = new Map();
/** Grundsterblichkeit (ohne Pflegefaktor) einer Person im Monte Carlo.
 * Ohne Pflegelogik ist sie die Zieltafel. Zwischenspeicher je Person und Pflegeannahmen.
 * @param {any} inputs @param {number} personIndex 0 = P1, 1 = P2 @param {string} gender @param {number} age */
export function resolveBaseMortalityProbability(inputs, personIndex, gender, age) {
    const birthYear = resolveInputsPersonBirthYear(inputs, personIndex);
    const careModel = resolveCareAdjustmentModel(inputs);
    const normalizedAge = Number(age);
    if (!careModel || !PERIOD[gender] || !Number.isSafeInteger(normalizedAge) || normalizedAge < 0 || normalizedAge > MAX_AGE) {
        return resolveTargetMortalityProbability(gender, normalizedAge, birthYear);
    }
    const startAge = Number(personIndex === 0 ? inputs?.startAlter : inputs?.partner?.startAlter);
    const factors = careModel.factors;
    const cacheKey = `${gender}|${Number.isFinite(birthYear) ? cohortYear(birthYear) : 'p'}|${startAge}|${careModel.acute
        ? `a${inputs.pflegeMinDauer}-${inputs.pflegeMaxDauer}` : 'c'}|${factors[1]}|${factors[2]}|${factors[3]}|${factors[4]}|${factors[5]}`;
    let base = baseCache.get(cacheKey);
    if (!base) {
        if (baseCache.size > 512) baseCache.clear();
        base = computeCareAdjustedBaseMortality({ gender, birthYear, startAge, careModel }).base;
        baseCache.set(cacheKey, base);
    }
    return base[normalizedAge];
}
