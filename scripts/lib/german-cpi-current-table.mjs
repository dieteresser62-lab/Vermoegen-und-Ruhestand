/**
 * Inflationskette: Raten der Jahre nach dem Ende der Destatis-Langreihe bis einschließlich Endjahr kommen aus der
 * aktuellen Jahrestabelle. Jedes dieser Jahre wird auf Plausibilität und gegen die Änderung der Jahresdurchschnitte
 * geprüft; der Vorjahrespegel des ersten Folgejahrs stammt aus der Langreihe, danach aus der Jahrestabelle.
 */

/** Plausibler Rahmen statt fester Erwartungswerte: Index (2020=100) und Vorjahresrate in Prozent. */
export const CURRENT_TABLE_PLAUSIBLE = Object.freeze({ levelMin: 80, levelMax: 250, rateMin: -10, rateMax: 25 });

function defaultFail(message, details = undefined) {
    const error = new Error(message);
    if (details !== undefined) error.details = details;
    throw error;
}

/**
 * @param {{longSeriesLastYear: number, longSeriesLastLevel: number, endYear: number,
 *   readLevel: (year: number) => number, readRate: (year: number) => number, tolerancePp: number,
 *   fail?: (message: string, details?: object) => never}} input
 * @returns {Record<number, number>} Veröffentlichte Vorjahresraten je Folgejahr.
 */
export function currentTableAnnualRates({ longSeriesLastYear, longSeriesLastLevel, endYear, readLevel, readRate, tolerancePp, fail = defaultFail }) {
    if (!Number.isInteger(endYear) || endYear <= longSeriesLastYear) {
        fail('The data end year must follow the Destatis long series', { longSeriesLastYear, endYear });
    }
    const rates = {};
    let previousYear = longSeriesLastYear;
    let previousLevel = longSeriesLastLevel;
    for (let year = longSeriesLastYear + 1; year <= endYear; year += 1) {
        const currentLevel = readLevel(year);
        const currentRate = readRate(year);
        const { levelMin, levelMax, rateMin, rateMax } = CURRENT_TABLE_PLAUSIBLE;
        if (!(currentLevel > levelMin && currentLevel < levelMax) || !(currentRate > rateMin && currentRate < rateMax)) {
            fail('Destatis current values are implausible', { year, currentLevel, currentRate });
        }
        if (Math.abs((((currentLevel / previousLevel) - 1) * 100) - currentRate) > tolerancePp) {
            fail(`Destatis ${year} published rate is inconsistent with the annual-average levels`, {
                previousYear,
                previousLevel,
                currentLevel,
                currentRate
            });
        }
        rates[year] = currentRate;
        previousYear = year;
        previousLevel = currentLevel;
    }
    return rates;
}

/** Text der Segmentkonstruktion für die Jahre aus der aktuellen Jahrestabelle. */
export function currentTableConstruction(longSeriesLastYear, endYear) {
    return endYear === longSeriesLastYear + 1
        ? `Published Destatis annual change, checked against the ${longSeriesLastYear} and ${endYear} annual-average levels.`
        : `Published Destatis annual changes, each checked against the consecutive annual-average levels from ${longSeriesLastYear} to ${endYear}.`;
}
