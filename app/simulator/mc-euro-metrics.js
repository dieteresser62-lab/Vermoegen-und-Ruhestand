import { quantile } from './simulator-utils.js';
import { readMinimumFlexYear } from './minimum-flex-metrics.js';

// Zusätzliche Pfadskalare reisen über denselben typisierten Worker-Vertrag.
export const EURO_PATH_FIELDS = Object.freeze(Object.fromEntries([
    'taxPaidRealEur', 'taxSavedRealEur', 'withdrawalP10NominalEur', 'stressWithdrawalP10NominalEur',
    'minimumFlexPaidMedianRealEur', 'minimumFlexDesiredMedianRealEur', 'minimumFlexPaidMinimumRealEur',
    'healthBucketUsedRealEur', 'healthBucketEndRealEur', 'healthBucketTargetGapRealEur'
].map(field => [field, Float64Array])));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const q = (values, fraction = 0.5) => values.length ? quantile(values, fraction) : null;

export function createEuroPathTracker(stressYears = 0) {
    return { stressYears, valid: true, taxPaidRealEur: 0, taxSavedRealEur: 0,
        healthBucketUsedRealEur: 0, healthBucketEndRealEur: 0, healthBucketTargetGapRealEur: 0,
        withdrawals: [], stressWithdrawals: [], paid: [], desired: [] };
}
/** Ausgaben am Jahresbeginn, Bestände am Jahresende: wie der vorhandene Runner. */
export function recordEuroFinancialYear(tracker, row, taxes, yearIndex, endFactor) {
    const startFactor = row.inflation_factor_cum;
    const valid = finite(startFactor) && startFactor > 0 && finite(endFactor) && endFactor > 0;
    tracker.valid &&= valid;
    if (valid) {
        tracker.taxPaidRealEur += taxes / startFactor;
        tracker.taxSavedRealEur += (Number(row.taxSavedByLossCarry) || 0) / startFactor;
        tracker.healthBucketUsedRealEur += (Number(row.health_bucket_used) || 0) / startFactor;
        tracker.healthBucketEndRealEur = (Number(row.health_bucket_end) || 0) / endFactor;
        tracker.healthBucketTargetGapRealEur = (Number(row.health_bucket_target_gap) || 0) / endFactor;
    }
    if (row.Regime !== 'accumulation' && finite(row.entnahme_effektiv)) {
        tracker.withdrawals.push(row.entnahme_effektiv);
        if (yearIndex < tracker.stressYears) tracker.stressWithdrawals.push(row.entnahme_effektiv);
    }
    const minimum = readMinimumFlexYear(row);
    if (minimum && !minimum.missing && valid) {
        tracker.paid.push(minimum.paid / startFactor);
        tracker.desired.push(minimum.desired / startFactor);
    }
}
export function recordEuroZeroWithdrawal(tracker, yearIndex) {
    tracker.withdrawals.push(0);
    if (yearIndex < tracker.stressYears) tracker.stressWithdrawals.push(0);
}
export function finalizeEuroPath(tracker) {
    return { ...Object.fromEntries(Object.keys(EURO_PATH_FIELDS).map(field => [field, tracker[field] ?? 0])),
        valid: tracker.valid, withdrawalP10NominalEur: q(tracker.withdrawals, 0.1) ?? 0,
        stressWithdrawalP10NominalEur: q(tracker.stressWithdrawals, 0.1) ?? 0,
        minimumFlexPaidMedianRealEur: q(tracker.paid) ?? 0,
        minimumFlexDesiredMedianRealEur: q(tracker.desired) ?? 0,
        minimumFlexPaidMinimumRealEur: tracker.paid.length ? Math.min(...tracker.paid) : 0 };
}

/** Quantile immer aus Pfadwerten je Basis; niemals ein nominales Quantil deflationieren. */
export function buildEuroAggregates(summary, missing, totalRuns, codes) {
    if (!summary || !missing) return null;
    const paths = Array.from({ length: totalRuns }, (_, index) => index).filter(index => missing.path[index] === codes.OBSERVED);
    const measured = paths.filter(index => missing.euroMetrics?.[index] === codes.OBSERVED);
    const real = measured.filter(index => missing.euroRealAmounts?.[index] === codes.OBSERVED);
    const values = (indices, field) => indices.map(index => summary[field][index]);
    const median = (indices, field) => q(values(indices, field));
    const withdrawal = (indices, field, stateField) => {
        const observed = indices.filter(index => missing[stateField][index] === codes.OBSERVED);
        const list = values(observed, field);
        return { p10: q(list, 0.1), p50: q(list), sampleSize: list.length,
            missingness: list.length ? null : 'no_observations' };
    };
    const care = basis => {
        const suffix = basis === 'real' ? 'RealEur' : 'NominalEur';
        const indices = basis === 'real' ? real : measured;
        const withCare = indices.filter(index => summary.careEverActive[index] === 1);
        const noCare = indices.filter(index => summary.careEverActive[index] !== 1);
        const endField = basis === 'real' ? 'finalValueRealEur' : 'finalValueNominalEur';
        const withMedian = median(withCare, endField), noMedian = median(noCare, endField);
        return {
            p1: { additionalNeedEurP50: median(indices.filter(index => missing.p1CareEntryAge[index] === codes.OBSERVED), `p1CareAdditionalNeed${suffix}`) },
            p2: { additionalNeedEurP50: median(indices.filter(index => missing.p2CareEntryAge[index] === codes.OBSERVED), `p2CareAdditionalNeed${suffix}`) },
            household: { totalAdditionalNeedEurP50: median(withCare, `totalCareAdditionalNeed${suffix}`),
                maxAnnualAdditionalNeedEurP50: median(withCare, `maxAnnualCareAdditionalNeed${suffix}`),
                endWealthWithCareEurP50: withMedian, endWealthNoCareEurP50: noMedian },
            comparison: { endWealthNoCareMinusCareEur: withMedian === null || noMedian === null ? null : noMedian - withMedian }
        };
    };
    const finals = values(real, 'finalValueRealEur');
    const successful = real.filter(index => [2, 3].includes(summary.outcomeCode[index]));
    const minimum = real.filter(index => missing.minimumFlexRestriction[index] === codes.OBSERVED);
    const bucket = real.filter(index => summary.healthBucketEnabled[index] === 1);
    const used = bucket.filter(index => summary.healthBucketUsedEur[index] > 0);
    const savings = values(real, 'taxSavedRealEur');
    return { schemaVersion: 'MonteCarloEuroMetricsV1',
        priceTiming: { annualPayments: 'year_start', balances: 'year_end' },
        quantileMethod: 'linear_interpolation_at_(n_minus_1)_q',
        nominal: { withdrawalP10: withdrawal(measured, 'withdrawalP10NominalEur', 'realWithdrawalP10RealEur'),
            stressWithdrawalP10: withdrawal(measured, 'stressWithdrawalP10NominalEur', 'stressRealWithdrawalP10RealEur'),
            pflege: care('nominal') },
        real: {
            finalOutcomes: { p10: q(finals, 0.1), p25: q(finals, 0.25), p50: q(finals), p90: q(finals, 0.9),
                p50_successful: median(successful, 'finalValueRealEur'), successfulCount: successful.length,
                distribution: { values: finals, sampleSize: finals.length, excludedRuns: totalRuns - finals.length },
                missingness: finals.length ? null : 'no_observations' },
            taxOutcomes: { p50: median(real, 'taxPaidRealEur') },
            lossCarryTaxSavings: { perRunMean: savings.length ? savings.reduce((sum, value) => sum + value, 0) / savings.length : null },
            minimumFlexAmounts: { paidMedianRealEurP50: median(minimum, 'minimumFlexPaidMedianRealEur'),
                desiredMedianRealEurP50: median(minimum, 'minimumFlexDesiredMedianRealEur'),
                paidMinimumRealEurP50: median(minimum, 'minimumFlexPaidMinimumRealEur') },
            healthBucket: { usedMedian: used.length ? median(used, 'healthBucketUsedRealEur') : bucket.length ? 0 : null,
                usedP90: used.length ? q(values(used, 'healthBucketUsedRealEur'), 0.9) : bucket.length ? 0 : null,
                endMedian: median(bucket, 'healthBucketEndRealEur'), targetGapMedian: median(bucket, 'healthBucketTargetGapRealEur') },
            pflege: care('real')
        }
    };
}

/** Optionaler V2-Zusatz: alte Exporte brauchen diesen Block nicht. */
export function validateEuroAggregates(block) {
    if (block === undefined) return;
    if (!block || block.schemaVersion !== 'MonteCarloEuroMetricsV1'
        || !block.nominal || !block.real || block.priceTiming?.annualPayments !== 'year_start'
        || block.priceTiming?.balances !== 'year_end') throw new TypeError('Invalid MonteCarloEuroMetricsV1.');
    const visit = value => {
        if (value === null || finite(value)) return;
        if (typeof value === 'string' && ['no_observations', 'missing_inflation', 'technical_error'].includes(value)) return;
        if (!value || typeof value !== 'object') throw new TypeError('Euro metrics must contain finite numbers or explicit missing values.');
        for (const child of Object.values(value)) visit(child);
    };
    visit(block.nominal); visit(block.real);
}
