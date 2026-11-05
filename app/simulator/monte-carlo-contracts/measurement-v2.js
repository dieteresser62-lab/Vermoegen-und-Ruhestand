// @ts-check
import { MONTE_CARLO_RUN_RESULT_V2_VERSION, MONTE_CARLO_UNIT_CONTRACT_V2_VERSION } from './schema.js';
import { contractError, requireObject, requireInteger } from './validation-primitives.js';
import { MC_HEATMAP_BINS } from '../monte-carlo-runner-utils.js';
import { projectHeatmapBins } from './kpi-projection.js';

/** @param {unknown} value
 * @param {string} field */
export function assertObservationCountObject(value, field) {
    requireObject(value, MONTE_CARLO_RUN_RESULT_V2_VERSION, field);
    let leafCount = 0;
    /** @param {object} node
 * @param {string} path
 * @returns {void} */
    const visit = (node, path) => {
        for (const [key, child] of Object.entries(node)) {
            const childPath = `${path}.${key}`;
            if (child && typeof child === 'object' && !Array.isArray(child)) {
                visit(child, childPath);
            } else {
                requireInteger(child, MONTE_CARLO_RUN_RESULT_V2_VERSION, childPath);
                leafCount++;
            }
        }
    };
    visit(/** @type {object} */ (value), field);
    if (leafCount === 0) {
        throw contractError(
            MONTE_CARLO_RUN_RESULT_V2_VERSION,
            'MC_RESULT_V2_OBSERVATION_COUNT_EMPTY',
            `${field} must contain at least one integer leaf.`
        );
    }
    return value;
}

/** @param {unknown} value
 * @returns {void} */
export function assertEveryObservationCountV2(value, path = '$.resultV2') {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((child, index) => assertEveryObservationCountV2(child, `${path}[${index}]`));
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (key === 'observationCount') {
            assertObservationCountObject(child, `${path}.observationCount`);
        } else {
            assertEveryObservationCountV2(child, `${path}.${key}`);
        }
    }
}

/** @param {unknown} value
 * @param {string} field */
export function assertDrawdownDistributionV2(value, field) {
    const metric = requireObject(value, MONTE_CARLO_RUN_RESULT_V2_VERSION, field);
    for (const quantileField of ['p50', 'p90']) {
        const scalar = metric[quantileField];
        if (scalar !== null && (!Number.isFinite(scalar) || scalar < 0 || scalar > 100)) {
            throw contractError(
                MONTE_CARLO_RUN_RESULT_V2_VERSION,
                'MC_RESULT_V2_DRAWDOWN_DOMAIN_INVALID',
                `${field}.${quantileField} must be null or a positive loss magnitude inside 0..100.`
            );
        }
    }
    const distribution = requireObject(metric.distribution, MONTE_CARLO_RUN_RESULT_V2_VERSION, `${field}.distribution`);
    if (!Array.isArray(distribution.values)) {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_DRAWDOWN_VALUES_INVALID', `${field}.distribution.values must be an array.`);
    }
    for (const drawdown of distribution.values) {
        if (!Number.isFinite(drawdown) || drawdown < 0 || drawdown > 100) {
            throw contractError(
                MONTE_CARLO_RUN_RESULT_V2_VERSION,
                'MC_RESULT_V2_DRAWDOWN_DOMAIN_INVALID',
                `${field}.distribution contains a drawdown outside 0..100.`
            );
        }
    }
    requireInteger(distribution.requestedRuns, MONTE_CARLO_RUN_RESULT_V2_VERSION, `${field}.distribution.requestedRuns`);
    requireInteger(distribution.sampleSize, MONTE_CARLO_RUN_RESULT_V2_VERSION, `${field}.distribution.sampleSize`);
    requireInteger(distribution.excludedRuns, MONTE_CARLO_RUN_RESULT_V2_VERSION, `${field}.distribution.excludedRuns`);
    if (distribution.sampleSize !== distribution.values.length
        || distribution.sampleSize + /** @type {number} */ (distribution.excludedRuns) !== distribution.requestedRuns) {
        throw contractError(
            MONTE_CARLO_RUN_RESULT_V2_VERSION,
            'MC_RESULT_V2_DRAWDOWN_SAMPLE_INVALID',
            `${field}.distribution sample inventory is inconsistent.`
        );
    }
    assertObservationCountObject(distribution.observationCount, `${field}.distribution.observationCount`);
}

/** @param {ReturnType<typeof projectHeatmapBins>} legacyBins
 * @param {number[][]} countsByPlanYear */
export function buildHeatmapIntervalsV2(legacyBins, countsByPlanYear) {
    if (!Array.isArray(legacyBins) || legacyBins.length !== MC_HEATMAP_BINS.length || !Array.isArray(countsByPlanYear)) {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_HEATMAP_INVALID', 'Heatmap boundaries or counts are missing.');
    }
    const boundaries = legacyBins.map((bin, index) => {
        const value = bin?.openEnded === true ? Infinity : bin?.upperBoundPct;
        if (typeof value !== 'number' || Number.isNaN(value)) {
            throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_HEATMAP_BOUNDARY_INVALID', `Heatmap boundary ${index} is invalid.`);
        }
        return value;
    });
    if (boundaries.some((boundary, index) => boundary !== MC_HEATMAP_BINS[index])) {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_HEATMAP_BOUNDARY_INVALID', 'Heatmap boundaries do not match the V2 contract.');
    }
    const intervalCount = boundaries.length - 1;
    const normalizedCounts = countsByPlanYear.map((row, rowIndex) => {
        if (!Array.isArray(row) || row.length !== intervalCount) {
            throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_HEATMAP_LENGTH_INVALID', `Heatmap row ${rowIndex} must contain ${intervalCount} counts.`);
        }
        return row.map((count, columnIndex) => requireInteger(
            count,
            MONTE_CARLO_RUN_RESULT_V2_VERSION,
            `diagnostics.withdrawalRateHeatmap.countsByPlanYear[${rowIndex}][${columnIndex}]`
        ));
    });
    const bins = [];
    for (let index = 0; index < intervalCount; index++) {
        const observationTotal = normalizedCounts.reduce((total, row) => total + row[index], 0);
        bins.push({
            index,
            lowerBoundPct: boundaries[index],
            upperBoundPct: Number.isFinite(boundaries[index + 1]) ? boundaries[index + 1] : null,
            lowerInclusive: true,
            upperExclusive: true,
            openEnded: boundaries[index + 1] === Infinity,
            observationCount: { total: observationTotal }
        });
    }
    const byPlanYear = /** @type {Record<string,number>} */ ({});
    let total = 0;
    for (let index = 0; index < normalizedCounts.length; index++) {
        const count = normalizedCounts[index].reduce((sum, value) => sum + value, 0);
        byPlanYear[String(index + 1)] = count;
        total += count;
    }
    return {
        basisField: 'realizedWithdrawalRatePct',
        bins,
        countsByPlanYear: normalizedCounts,
        observationCount: { total, byPlanYear }
    };
}

export function createMonteCarloUnitContractV2() {
    return {
        schemaVersion: MONTE_CARLO_UNIT_CONTRACT_V2_VERSION,
        currency: 'EUR',
        nominalMoneyFieldSuffix: 'NominalEur',
        realMoneyFieldSuffix: 'RealEur',
        realPriceBasis: 'simulation-start-prices',
        percentagePointFieldSuffix: 'Pct',
        ratioFieldSuffix: 'Ratio',
        observedZero: 0,
        missingValue: null,
        withdrawalRates: {
            realizedWithdrawalRatePct: {
                unit: 'percentage_points',
                numerator: 'actual_effective_annual_withdrawal',
                denominator: 'equity_bond_and_gold_tranches_excluding_liquidity_and_health_bucket',
                measurementTime: 'after_policy_transaction_and_actual_payout'
            },
            preDecisionWithdrawalRatePct: {
                unit: 'percentage_points',
                numerator: 'preliminary_withdrawal_based_on_previous_year_flex_rate',
                denominator: 'equity_bond_and_gold_tranches_excluding_liquidity_and_health_bucket',
                measurementTime: 'before_transaction_and_payout',
                description: 'vorlaeufige Entnahme auf Basis der Vorjahres-Flexrate, vor Transaktions- und Auszahlungsphase; Nenner Depot ohne Liquiditaet und Health-Bucket'
            }
        },
        withdrawalRateHeatmap: {
            basisField: 'realizedWithdrawalRatePct',
            interval: 'lower_inclusive_upper_exclusive',
            thresholdPct: 4.5,
            comparison: 'greater_than_or_equal_at_bin_resolution',
            thresholdRole: 'reporting_reference_not_guardrail_trigger'
        },
        timeShareRealizedWithdrawalRateAbove45Ratio: {
            basisField: 'realizedWithdrawalRatePct',
            unit: 'ratio',
            thresholdPct: 4.5,
            comparison: 'strictly_greater_than',
            thresholdRole: 'reporting_reference_not_guardrail_trigger'
        },
        drawdowns: {
            maximumDrawdownNominalPct: {
                unit: 'percentage_points_positive_loss_magnitude',
                domain: { minimumInclusive: 0, maximumInclusive: 100 },
                priceBasis: 'nominal'
            },
            maximumDrawdownRealPct: {
                unit: 'percentage_points_positive_loss_magnitude',
                domain: { minimumInclusive: 0, maximumInclusive: 100 },
                priceBasis: 'simulation-start-prices',
                missingInflationPolicy: 'null_with_reason_and_observation_count'
            }
        }
    };
}
