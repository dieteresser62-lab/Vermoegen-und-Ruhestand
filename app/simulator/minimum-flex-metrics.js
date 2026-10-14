import { quantile } from './simulator-utils.js';

export const MINIMUM_FLEX_DEFINITION_VERSION = 'MinimumFlexRestrictionV1';

const finiteAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const median = values => values.length ? quantile(values, 0.5) : null;

export function isMinimumFlexFinancialYear(entry) {
    const row = entry?.row ?? entry;
    return !!row
        && row.Regime !== 'accumulation'
        && row.Regime !== 'BANKRUPT'
        && row.financiallyEvaluable !== false
        && !['terminal_death', 'terminal_ruin', 'technical_error'].includes(row.recordType);
}

// Ausschließlich protokollierte Jahresbeträge; keine zweite Inflationsrechnung.
export function readMinimumFlexYear(entry) {
    const row = entry?.row ?? entry;
    if (!isMinimumFlexFinancialYear(entry)) return null;
    const paid = row.flex_haushalt_erfuellt;
    const desired = row.flex_wunsch_haushalt_nominal;
    const minimum = row.minimumFlexAnnual;
    if (![paid, desired, minimum].every(finiteAmount)) return { missing: true };
    return { paid, desired, below: minimum > 0 && paid < minimum };
}

export function createMinimumFlexTracker() {
    return { completedYearCount: 0, paid: [], desired: [], affectedYearCount: 0 };
}

export function recordMinimumFlexYear(tracker, entry) {
    const year = readMinimumFlexYear(entry);
    if (!year) return;
    tracker.completedYearCount++;
    if (year.missing) return;
    tracker.paid.push(year.paid);
    tracker.desired.push(year.desired);
    if (year.below) tracker.affectedYearCount++;
}

export function finalizeMinimumFlexPath(tracker, { technicalError = false, unavailable = false } = {}) {
    const observationCount = tracker.paid.length;
    const missingReason = technicalError ? 'technical_error'
        : unavailable ? 'outcome_not_evaluable'
            : tracker.completedYearCount === 0 ? 'no_observations'
                : observationCount !== tracker.completedYearCount ? 'missing_year_values' : null;
    const available = missingReason === null;
    return {
        completedYearCount: tracker.completedYearCount,
        observationCount,
        affectedYearCount: available ? tracker.affectedYearCount : null,
        yearSharePct: available ? tracker.affectedYearCount / observationCount * 100 : null,
        affected: available ? tracker.affectedYearCount > 0 : null,
        paidMedianNominalEur: available ? median(tracker.paid) : null,
        desiredMedianNominalEur: available ? median(tracker.desired) : null,
        paidMinimumNominalEur: available ? tracker.paid.reduce((a, b) => Math.min(a, b), Infinity) : null,
        missingReason
    };
}

export function deriveMinimumFlexPath(rows, options) {
    const tracker = createMinimumFlexTracker();
    for (const row of rows) recordMinimumFlexYear(tracker, row);
    return finalizeMinimumFlexPath(tracker, options);
}

export function buildMinimumFlexRestriction(paths, startMinimumFlexAnnual = null) {
    const observed = paths.filter(path => path.missingReason === null);
    const missingness = {};
    for (const path of paths) {
        if (path.missingReason) missingness[path.missingReason] = (missingness[path.missingReason] || 0) + 1;
    }
    const missingReason = missingness.technical_error ? 'technical_error_in_batch'
        : observed.length === 0 ? 'no_evaluable_runs' : null;
    const reliable = missingReason === null;
    const affectedRunCount = observed.filter(path => path.affected).length;
    return {
        definitionVersion: MINIMUM_FLEX_DEFINITION_VERSION,
        startMinimumFlexAnnual: finiteAmount(startMinimumFlexAnnual) ? startMinimumFlexAnnual : null,
        priceBasis: 'nominal',
        population: 'completed_decumulation_years',
        comparison: 'paid_household_flex_lt_applied_positive_minimum',
        acrossRunStatistic: 'median_of_path_statistics',
        yearSharePctP50: reliable ? median(observed.map(path => path.yearSharePct)) : null,
        affectedRunSharePct: reliable ? affectedRunCount / observed.length * 100 : null,
        affectedRunCount,
        paidMedianNominalEurP50: reliable ? median(observed.map(path => path.paidMedianNominalEur)) : null,
        desiredMedianNominalEurP50: reliable ? median(observed.map(path => path.desiredMedianNominalEur)) : null,
        paidMinimumNominalEurP50: reliable ? median(observed.map(path => path.paidMinimumNominalEur)) : null,
        requestedRuns: paths.length,
        sampleSize: observed.length,
        excludedRuns: paths.length - observed.length,
        observationCount: {
            requestedPaths: paths.length,
            observedPaths: observed.length,
            observedYears: paths.reduce((sum, path) => sum + path.observationCount, 0),
            completedYears: paths.reduce((sum, path) => sum + path.completedYearCount, 0)
        },
        missingness,
        missingReason
    };
}

// Die Worker übertragen Pfadstatistiken, niemals die gepoolten Jahresserien.
export function summarizeMinimumFlexPaths(summary, missing, totalRuns, codes, startMinimumFlexAnnual) {
    const paths = Array.from({ length: totalRuns }, (_, index) => {
        const state = missing?.minimumFlexRestriction?.[index];
        const missingReason = state === codes.OBSERVED ? null
            : state === codes.TECHNICAL_ERROR ? 'technical_error'
                : state === codes.MISSING_YEAR_VALUES ? 'missing_year_values' : 'no_observations';
        return {
            missingReason,
            completedYearCount: summary?.minimumFlexCompletedYearCount?.[index] ?? 0,
            observationCount: summary?.minimumFlexObservationCount?.[index] ?? 0,
            affectedYearCount: summary?.minimumFlexAffectedYearCount?.[index] ?? 0,
            affected: summary?.minimumFlexAffectedYearCount?.[index] > 0,
            yearSharePct: summary?.minimumFlexYearShareRatio?.[index] * 100,
            paidMedianNominalEur: summary?.minimumFlexPaidMedianNominalEur?.[index],
            desiredMedianNominalEur: summary?.minimumFlexDesiredMedianNominalEur?.[index],
            paidMinimumNominalEur: summary?.minimumFlexPaidMinimumNominalEur?.[index]
        };
    });
    return buildMinimumFlexRestriction(paths, startMinimumFlexAnnual);
}
