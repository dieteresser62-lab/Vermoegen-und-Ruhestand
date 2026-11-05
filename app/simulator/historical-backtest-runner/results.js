"use strict";

import { BACKTEST_OUTCOME_KINDS } from './schema.js';
import { deepFreeze } from './run-values.js';
import { deriveHistoricalBacktestMetrics, HISTORICAL_BACKTEST_METRICS_SCHEMA_VERSION } from '../historical-backtest-metrics.js';

export function normalizeTechnicalError(error, fallbackCode) {
    const code = typeof error?.code === 'string' && error.code.trim()
        ? error.code.trim()
        : fallbackCode;
    const providedMessage = typeof error?.message === 'string' ? error.message.trim() : '';
    const message = providedMessage.includes(code)
        ? providedMessage
        : `Der Backtest wurde wegen eines technischen Fehlers beendet (${code}).`;
    return { code, message };
}

export function buildIncompleteOutcome(reason) {
    const missingYears = Number.isInteger(reason?.year) ? [reason.year] : [];
    const missingFields = Array.isArray(reason?.missingFields)
        ? reason.missingFields.map(String)
        : (missingYears.length > 0 ? ['historicalYearRecord'] : []);
    return {
        kind: BACKTEST_OUTCOME_KINDS.INCOMPLETE,
        lastCompletedYear: null,
        missingYears,
        missingFields,
        exclusionReason: reason?.code || 'historical_data_incomplete'
    };
}

function buildHealthBucketSummary(rows) {
    for (let index = rows.length - 1; index >= 0; index--) {
        const row = rows[index]?.row;
        if (!row || row.health_bucket_enabled !== true) continue;
        return {
            enabled: true,
            end: Number(row.health_bucket_end) || 0,
            realCoveragePct: Number.isFinite(Number(row.health_bucket_real_coverage_pct))
                ? Number(row.health_bucket_real_coverage_pct)
                : null,
            targetGap: Number(row.health_bucket_target_gap) || 0
        };
    }
    return { enabled: false, end: 0, realCoveragePct: null, targetGap: 0 };
}

export function buildSummary({
    rows,
    portfolioStart,
    portfolioEnd,
    completedYears,
    totalWithdrawal,
    maxReductionStreak,
    reductionYears,
    totalTaxes
}) {
    return {
        startWealth: portfolioStart,
        endWealth: portfolioEnd,
        totalWithdrawal,
        maxReductionStreak,
        reductionYears,
        reductionDenominator: completedYears,
        totalTaxes,
        healthBucket: buildHealthBucketSummary(rows)
    };
}

export function attachCanonicalMetrics(result) {
    const metrics = deriveHistoricalBacktestMetrics(result);
    const values = metrics.values;
    return deepFreeze({
        ...result,
        metrics,
        minimumFlexRestriction: metrics.minimumFlexRestriction,
        summary: {
            ...result.summary,
            startWealth: values.wealth_start_nominal_eur ?? result.summary.startWealth,
            endWealth: values.wealth_end_nominal_eur ?? result.summary.endWealth,
            totalWithdrawal: values.withdrawal_total_nominal_eur ?? result.summary.totalWithdrawal,
            maxReductionStreak: values.flex_reduction_longest_streak_gte_10_pct
                ?? result.summary.maxReductionStreak,
            reductionYears: values.flex_reduction_years_gte_10_pct ?? result.summary.reductionYears,
            totalTaxes: values.tax_total_nominal_eur ?? result.summary.totalTaxes,
            metricSchemaVersion: HISTORICAL_BACKTEST_METRICS_SCHEMA_VERSION,
            metrics: values
        }
    });
}
