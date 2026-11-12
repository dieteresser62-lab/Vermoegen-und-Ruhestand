/** FR-41/FR-75: deterministische Neuabstimmung von Pflegeeintritt und Fortschritt.
 * node scripts/retune-care-model.mjs [--progression-scale=0.8]
 *
 * Seit FR-75 sinkt die Grundsterblichkeit ohne Pflege so weit, dass die Gesamtsterblichkeit der
 * Zieltafel entspricht. Damit leben Menschen in Pflege länger und die alten Eintrittswerte
 * überschätzen die Pflegequoten. Das Skript rechnet die Abstimmkohorte von
 * `calibrate-care-model.mjs` exakt als Markov-Kette (Startbestand 60–64 bei 65, Periodentafel
 * 2023/25 als Ziel, weil die Pflegestatistik 2023 ein Querschnitt ist, Grundsterblichkeit
 * gesund ab 65) und skaliert je Altersband die Eintrittswahrscheinlichkeit (Grad 1 und 2 im
 * bisherigen Verhältnis), bis die Pflegequote am Jahresende der Destatis-Quote entspricht.
 * Danach werden fallende Eintrittssummen auf das vorige Band angehoben. Der Fortschritt wird
 * mit einem festen Faktor skaliert; ohne Angabe wählt das Skript den Faktor aus 0,50–1,20
 * (Schritt 0,05) mit der kleinsten größten Abweichung der Gradanteile.
 * Die MC-Prüfung bleibt `calibrate-care-model.mjs`.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT as contract } from '../app/simulator/german-demography-care-survivor-contract.js';
import { computeCareAdjustedBaseMortality } from '../app/simulator/target-mortality.js';

const BANDS = [65, 70, 75, 80, 85, 90, 95];
// Vorherige FR-41-Werte (RNG-1) als Ausgangspunkt der Skalierung, unabhängig vom aktuellen Vertrag.
export const PREVIOUS_ENTRY_TOTALS = Object.freeze({
    m: Object.freeze([.01016, .013, .03424, .07015, .18220, .45781, .52408]),
    w: Object.freeze([.009, .015, .04189, .09713, .24528, .55821, .65157])
});
export const PREVIOUS_PROGRESSION = Object.freeze({ 1: 0.6780, 2: 0.2706, 3: 0.1569, 4: 0.1231, 5: 0 });
const GRADE1_SHARE = .5402;
const FACTORS = contract.care.mortalityModel.defaultFactorsByGrade;
const OBSERVED = contract.care.officialObservation.observedPrevalencePctBySexAndAgeBand;
const COUNTS = contract.care.officialObservation.countsByGrade;
const ASSIGNED = Object.values(COUNTS).reduce((sum, count) => sum + count, 0);
const SHARES = contract.care.officialObservation.sharesPctByGrade;

const entryTable = totals => Object.fromEntries(totals.map((total, index) => [BANDS[index],
    { 1: total * GRADE1_SHARE, 2: total * (1 - GRADE1_SHARE) }]));
const bandOf = age => Math.min(95, 65 + 5 * Math.floor((age - 65) / 5));
const bucketOf = age => BANDS.filter(band => age >= band).at(-1);

/** Exakte Abstimmkohorte eines Geschlechts: Prävalenz je Band, Gradbestand, Pflegejahre je Fall. */
export function careCohort(sex, totals, progression) {
    const entryBySex = { m: entryTable(totals.m), w: entryTable(totals.w), d: entryTable(totals.m) };
    const careModel = { acute: false, durations: null, factors: FACTORS, entryBySex, progression };
    const base = computeCareAdjustedBaseMortality({ gender: sex, birthYear: NaN, startAge: 65, careModel }).base;
    const stock = contract.care.entryModel.calibration.initialStock.prevalencePctBySex[sex] / 100;
    let state = [1 - stock, ...[1, 2, 3, 4, 5].map(grade => stock * COUNTS[grade] / ASSIGNED)];
    const bands = Object.fromEntries(BANDS.map(band => [band, { alive: 0, care: 0 }]));
    const grades = [0, 0, 0, 0, 0];
    let careYears = 0, cases = stock;
    for (let age = 65; age <= 110; age++) {
        const next = [state[0], 0, 0, 0, 0, 0];
        for (let grade = 1; grade <= 5; grade++) {
            const p = grade < 5 ? progression[grade] : 0;
            next[grade] += state[grade] * (1 - p);
            if (grade < 5) next[grade + 1] += state[grade] * p;
        }
        const entry = entryBySex[sex][bucketOf(age)];
        next[1] += state[0] * entry[1];
        next[2] += state[0] * entry[2];
        next[0] = state[0] * (1 - entry[1] - entry[2]);
        cases += state[0] * (entry[1] + entry[2]);
        const q = base[age];
        const survivors = [next[0] * (1 - q), ...[1, 2, 3, 4, 5].map(g => next[g] * (1 - Math.min(1, q * FACTORS[g])))];
        // Im Sterbejahr zählt ein halbes Pflegejahr (FR-17), wie im MC-Skript; die Startbestände zählen ab 65.
        careYears += [1, 2, 3, 4, 5].reduce((sum, g) => sum + survivors[g] + .5 * (next[g] - survivors[g]), 0);
        const band = bands[bandOf(age)];
        band.alive += survivors.reduce((sum, value) => sum + value, 0);
        band.care += survivors.slice(1).reduce((sum, value) => sum + value, 0);
        for (let g = 1; g <= 5; g++) grades[g - 1] += survivors[g];
        state = survivors;
    }
    const gradeTotal = grades.reduce((sum, value) => sum + value, 0);
    return {
        prevalencePct: Object.fromEntries(BANDS.map(band => [band, 100 * bands[band].care / bands[band].alive])),
        gradeYears: grades,
        gradeSharesPct: grades.map(value => 100 * value / gradeTotal),
        meanCareYearsPerCase: careYears / cases
    };
}

/** Eintritt je Band sequentiell auf die Destatis-Quote skalieren, dann Monotonie herstellen. */
export function retuneEntry(progression) {
    const totals = { m: [...PREVIOUS_ENTRY_TOTALS.m], w: [...PREVIOUS_ENTRY_TOTALS.w] };
    for (const sex of ['m', 'w']) {
        for (const [index, band] of BANDS.entries()) {
            let low = 0, high = 3;
            for (let iteration = 0; iteration < 60; iteration++) {
                const middle = (low + high) / 2;
                totals[sex][index] = PREVIOUS_ENTRY_TOTALS[sex][index] * middle;
                if (careCohort(sex, totals, progression).prevalencePct[band] > OBSERVED[sex][band]) high = middle; else low = middle;
            }
            totals[sex][index] = PREVIOUS_ENTRY_TOTALS[sex][index] * (low + high) / 2;
        }
        for (let index = 1; index < BANDS.length; index++) {
            totals[sex][index] = Math.max(totals[sex][index], totals[sex][index - 1]);
        }
        totals[sex] = totals[sex].map(total => Number(total.toFixed(5)));
    }
    return totals;
}

export function retuneCareModel({ progressionScale = null } = {}) {
    const scales = progressionScale === null
        ? Array.from({ length: 15 }, (_, index) => Number((0.5 + 0.05 * index).toFixed(2))) : [progressionScale];
    let best = null;
    for (const scale of scales) {
        const progression = Object.fromEntries(Object.entries(PREVIOUS_PROGRESSION)
            .map(([grade, p]) => [grade, Number((p * scale).toFixed(4))]));
        const totals = retuneEntry(progression);
        const cohorts = { m: careCohort('m', totals, progression), w: careCohort('w', totals, progression) };
        const pooled = [0, 1, 2, 3, 4].map(index => cohorts.m.gradeYears[index] + cohorts.w.gradeYears[index]);
        const pooledTotal = pooled.reduce((sum, value) => sum + value, 0);
        const gradeSharesPct = pooled.map(value => 100 * value / pooledTotal);
        const maxGradeDeviationPp = Math.max(...gradeSharesPct.map((share, index) => Math.abs(share - SHARES[index + 1])));
        const candidate = { progressionScale: scale, progression, entryTotals: totals, cohorts, gradeSharesPct, maxGradeDeviationPp };
        if (!best || maxGradeDeviationPp < best.maxGradeDeviationPp - 1e-12) best = candidate;
    }
    return best;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const raw = process.argv.find(arg => arg.startsWith('--progression-scale='))?.split('=')[1];
    const result = retuneCareModel({ progressionScale: raw === undefined ? null : Number(raw) });
    const round = value => Number(value.toFixed(2));
    console.log(JSON.stringify({
        progressionScale: result.progressionScale,
        progression: result.progression,
        entryTotals: result.entryTotals,
        entryScaleVsPrevious: Object.fromEntries(['m', 'w'].map(sex => [sex,
            result.entryTotals[sex].map((total, index) => round(total / PREVIOUS_ENTRY_TOTALS[sex][index]))])),
        prevalencePct: Object.fromEntries(['m', 'w'].map(sex => [sex, Object.fromEntries(BANDS.map(band =>
            [band, [round(result.cohorts[sex].prevalencePct[band]), OBSERVED[sex][band]]]))])),
        gradeSharesPct: result.gradeSharesPct.map((share, index) => [round(share), round(SHARES[index + 1])]),
        meanCareYearsPerCase: { m: round(result.cohorts.m.meanCareYearsPerCase), w: round(result.cohorts.w.meanCareYearsPerCase) }
    }, null, 1));
}
