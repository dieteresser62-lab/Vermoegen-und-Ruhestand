// @ts-check

/** Alle Ereignisse verwenden den nullbasierten Simulationsjahr-Index. */
export function createPersonEventYears() {
    return /** @type {{failure: number|null, deathP1: number|null, deathP2: number|null, careP1: number|null, careP2: number|null}} */ ({
        failure: null, deathP1: null, deathP2: null, careP1: null, careP2: null
    });
}

/** @param {ReturnType<typeof createPersonEventYears>} years
 * @param {number} yearIndex
 * @param {number|null|undefined} gradeP1
 * @param {number|null|undefined} gradeP2 */
export function recordPersonCareStarts(years, yearIndex, gradeP1, gradeP2) {
    if ((gradeP1 ?? 0) > 0) years.careP1 ??= yearIndex;
    if ((gradeP2 ?? 0) > 0) years.careP2 ??= yearIndex;
}

/** @param {boolean} hasPartner @param {number} horizonYears */
export function createPersonOutcomeCounts(hasPartner, horizonYears) {
    const people = Array.from({ length: hasPartner ? 2 : 1 }, () => ({
        coveredWhileAlive: 0, partnerDiedByFailure: 0, careStartedByFailure: 0, neitherByFailure: 0,
        coveredForSurvivor: 0, diedFirst: 0,
        survivalYears: new Uint32Array(hasPartner ? horizonYears : 0)
    }));
    return { runs: 0, simultaneousDeaths: 0, people };
}

/** @typedef {ReturnType<typeof createPersonOutcomeCounts>} PersonOutcomeCounts */

/** @param {PersonOutcomeCounts} counts
 * @param {ReturnType<typeof createPersonEventYears>} years
 * @param {number} horizonYears */
export function recordPersonOutcomes(counts, years, horizonYears) {
    counts.runs++;
    const { failure, deathP1, deathP2, careP1, careP2 } = years;
    const lastYear = horizonYears - 1;
    if (deathP1 !== null && deathP1 === deathP2) counts.simultaneousDeaths++;
    for (let index = 0; index < counts.people.length; index++) {
        const person = counts.people[index];
        const death = index === 0 ? deathP1 : deathP2;
        const partnerDeath = index === 0 ? deathP2 : deathP1;
        if (failure === null || failure > (death ?? lastYear)) {
            person.coveredWhileAlive++;
        } else if (counts.people.length === 2) {
            const partnerDied = partnerDeath !== null && partnerDeath <= failure;
            const careStarted = (careP1 !== null && careP1 <= failure) || (careP2 !== null && careP2 <= failure);
            if (partnerDied) person.partnerDiedByFailure++;
            if (careStarted) person.careStartedByFailure++;
            if (!partnerDied && !careStarted) person.neitherByFailure++;
        }
        if (counts.people.length === 2 && death !== null && (partnerDeath === null || death < partnerDeath)) {
            const partnerEnd = partnerDeath ?? lastYear;
            person.diedFirst++;
            person.survivalYears[partnerEnd - death]++;
            if (failure === null || failure > partnerEnd) person.coveredForSurvivor++;
        }
    }
}

/** @param {PersonOutcomeCounts|null} target @param {PersonOutcomeCounts} source */
export function mergePersonOutcomeCounts(target, source) {
    if (!target) return source;
    target.runs += source.runs;
    target.simultaneousDeaths += source.simultaneousDeaths;
    for (let index = 0; index < target.people.length; index++) {
        const person = target.people[index];
        const part = source.people[index];
        person.coveredWhileAlive += part.coveredWhileAlive;
        person.partnerDiedByFailure += part.partnerDiedByFailure;
        person.careStartedByFailure += part.careStartedByFailure;
        person.neitherByFailure += part.neitherByFailure;
        person.coveredForSurvivor += part.coveredForSurvivor;
        person.diedFirst += part.diedFirst;
        for (let year = 0; year < part.survivalYears.length; year++) {
            person.survivalYears[year] += part.survivalYears[year];
        }
    }
    return target;
}

/** @param {Uint32Array} histogram @param {number} count */
function medianSurvivalYears(histogram, count) {
    if (count === 0) return null;
    const lowerRank = Math.ceil(count / 2);
    const upperRank = Math.floor(count / 2) + 1;
    let seen = 0;
    let lower = null;
    for (let years = 0; years < histogram.length; years++) {
        seen += histogram[years];
        if (seen >= lowerRank) lower ??= years;
        if (seen >= upperRank) return ((lower ?? years) + years) / 2;
    }
    return null;
}

/** @param {PersonOutcomeCounts} counts */
export function finalizePersonOutcomeRows({ runs, simultaneousDeaths, people }) {
    return people.map(({ survivalYears, coveredWhileAlive, ...partnerCounts }) => ({
        runs, coveredWhileAlive,
        partner: people.length === 2 ? {
            ...partnerCounts, simultaneousDeaths,
            medianSurvivalYears: medianSurvivalYears(survivalYears, partnerCounts.diedFirst)
        } : null
    }));
}
