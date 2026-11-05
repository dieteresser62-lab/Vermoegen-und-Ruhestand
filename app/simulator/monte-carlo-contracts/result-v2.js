// @ts-check
/** @import {RunResultV2,RunResultV1} from '../../../typcheck/rechenkern' */
/** @typedef {ReturnType<typeof import('./kpi-projection.js').projectMonteCarloKpis>} RunKpisBase */
/** @typedef {Omit<RunKpisBase,'maximumDrawdownPct'|'maximumDrawdownRealPct'|'timeShareWithdrawalRateAbove45Ratio'|'stress'> & Partial<Pick<RunKpisBase,'maximumDrawdownPct'|'maximumDrawdownRealPct'|'timeShareWithdrawalRateAbove45Ratio'>> & {maximumDrawdownNominalPct?:RunKpisBase['maximumDrawdownPct'];timeShareRealizedWithdrawalRateAbove45Ratio?:RunKpisBase['timeShareWithdrawalRateAbove45Ratio'];stress:Omit<RunKpisBase['stress'],'timeShareWithdrawalRateAbove45Ratio'> & {timeShareWithdrawalRateAbove45Ratio?:RunKpisBase['stress']['timeShareWithdrawalRateAbove45Ratio'];timeShareRealizedWithdrawalRateAbove45Ratio?:RunKpisBase['stress']['timeShareWithdrawalRateAbove45Ratio']}}} V2KpisProjection */
import { MONTE_CARLO_RUN_RESULT_V2_VERSION, MONTE_CARLO_UNIT_CONTRACT_V2_VERSION, BATCH_STATUSES } from './schema.js';
import { contractError, requireObject, requireInteger } from './validation-primitives.js';
import { deepFreezeMonteCarloContract, normalizeMonteCarloJsonValue, cloneContractValue } from './portable-json.js';
import { createMonteCarloRunResultV1, validateMonteCarloRunResultV1 } from './result-v1.js';
import { assertObservationCountObject, assertEveryObservationCountV2, assertDrawdownDistributionV2, buildHeatmapIntervalsV2, createMonteCarloUnitContractV2 } from './measurement-v2.js';
import { validateEuroAggregates } from '../mc-euro-metrics.js';
import { MC_HEATMAP_BINS } from '../monte-carlo-runner-utils.js';

/** @param {RunResultV1} resultV1 */
export function projectMonteCarloRunResultV2(resultV1) {
    validateMonteCarloRunResultV1(resultV1);
    const heatmap = buildHeatmapIntervalsV2(
        resultV1.diagnostics?.withdrawalRateHeatmap?.bins,
        resultV1.diagnostics?.withdrawalRateHeatmap?.countsByPlanYear
    );
    const sourceKpis = /** @type {V2KpisProjection} */ (cloneContractValue(resultV1.kpis, '$.resultV2.kpis'));
    const nominalDrawdown = /** @type {RunKpisBase['maximumDrawdownPct'] & {distribution:RunKpisBase['maximumDrawdownPct']['distribution'] & {observationCount?:Record<string,number>}}} */ (sourceKpis.maximumDrawdownPct);
    const realDrawdown = sourceKpis.maximumDrawdownRealPct;
    delete sourceKpis.maximumDrawdownPct;
    delete sourceKpis.maximumDrawdownRealPct;
    if (!nominalDrawdown.distribution.observationCount) {
        nominalDrawdown.distribution.observationCount = {
            requestedPaths: nominalDrawdown.distribution.requestedRuns,
            observedPaths: nominalDrawdown.distribution.sampleSize
        };
    }
    sourceKpis.maximumDrawdownNominalPct = nominalDrawdown;
    sourceKpis.maximumDrawdownRealPct = realDrawdown;
    sourceKpis.timeShareRealizedWithdrawalRateAbove45Ratio = sourceKpis.timeShareWithdrawalRateAbove45Ratio;
    delete sourceKpis.timeShareWithdrawalRateAbove45Ratio;
    if (sourceKpis.stress) {
        sourceKpis.stress.timeShareRealizedWithdrawalRateAbove45Ratio = sourceKpis.stress.timeShareWithdrawalRateAbove45Ratio;
        delete sourceKpis.stress.timeShareWithdrawalRateAbove45Ratio;
    }
    const result = {
        schemaVersion: MONTE_CARLO_RUN_RESULT_V2_VERSION,
        batchStatus: resultV1.batchStatus,
        financialMetricsValid: resultV1.financialMetricsValid,
        sampleSize: cloneContractValue(resultV1.sampleSize, '$.resultV2.sampleSize'),
        technicalErrorCount: resultV1.technicalErrorCount,
        outcomeInventory: cloneContractValue(resultV1.outcomeInventory, '$.resultV2.outcomeInventory'),
        kpis: sourceKpis,
        uncertainty: cloneContractValue(resultV1.uncertainty, '$.resultV2.uncertainty'),
        missingness: cloneContractValue(resultV1.missingness, '$.resultV2.missingness'),
        diagnostics: {
            sampling: cloneContractValue(resultV1.diagnostics.sampling, '$.resultV2.diagnostics.sampling'),
            execution: cloneContractValue(resultV1.diagnostics.execution, '$.resultV2.diagnostics.execution'),
            technicalErrors: cloneContractValue(resultV1.diagnostics.technicalErrors, '$.resultV2.diagnostics.technicalErrors'),
            withdrawalRateHeatmap: heatmap
        },
        warnings: cloneContractValue(resultV1.warnings, '$.resultV2.warnings'),
        unitContract: createMonteCarloUnitContractV2()
    };
    validateMonteCarloRunResultV2(result);
    // Lokalen Objekttyp erhalten, ohne Typinferenz über den Validator.
    return /** @type {typeof result} */ (deepFreezeMonteCarloContract(result));
}

/** @param {Parameters<typeof createMonteCarloRunResultV1>[0]} args */
export function createMonteCarloRunResultV2(args = /** @type {NonNullable<Parameters<typeof createMonteCarloRunResultV2>[0]>} */ ({})) {
    return projectMonteCarloRunResultV2(createMonteCarloRunResultV1(args));
}

/** @param {RunResultV2} result */
export function validateMonteCarloRunResultV2(result) {
    requireObject(result, MONTE_CARLO_RUN_RESULT_V2_VERSION, 'result');
    if (result.schemaVersion !== MONTE_CARLO_RUN_RESULT_V2_VERSION) {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_VERSION_UNSUPPORTED', `Unsupported schemaVersion ${String(result.schemaVersion)}.`);
    }
    if (!BATCH_STATUSES.has(result.batchStatus)) {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_BATCH_STATUS_INVALID', 'batchStatus is unsupported.');
    }
    const sampleSize = requireObject(result.sampleSize, MONTE_CARLO_RUN_RESULT_V2_VERSION, 'sampleSize');
    requireInteger(sampleSize.requestedRuns, MONTE_CARLO_RUN_RESULT_V2_VERSION, 'sampleSize.requestedRuns', { min: 1 });
    requireInteger(sampleSize.financiallyEvaluableRuns, MONTE_CARLO_RUN_RESULT_V2_VERSION, 'sampleSize.financiallyEvaluableRuns');
    requireInteger(sampleSize.technicalErrorRuns, MONTE_CARLO_RUN_RESULT_V2_VERSION, 'sampleSize.technicalErrorRuns');
    requireInteger(result.technicalErrorCount, MONTE_CARLO_RUN_RESULT_V2_VERSION, 'technicalErrorCount');
    if (sampleSize.financiallyEvaluableRuns + sampleSize.technicalErrorRuns !== sampleSize.requestedRuns
        || sampleSize.technicalErrorRuns !== result.technicalErrorCount) {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_SAMPLE_SIZE_INCONSISTENT', 'sampleSize must classify every requested run exactly once.');
    }
    const outcomes = requireObject(result.outcomeInventory, MONTE_CARLO_RUN_RESULT_V2_VERSION, 'outcomeInventory');
    for (const field of ['ruin', 'all_dead', 'horizon_exhausted', 'technical_error']) {
        requireInteger(outcomes[field], MONTE_CARLO_RUN_RESULT_V2_VERSION, `outcomeInventory.${field}`);
    }
    if (outcomes.ruin + outcomes.all_dead + outcomes.horizon_exhausted + outcomes.technical_error !== sampleSize.requestedRuns) {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_OUTCOME_INVENTORY_INCONSISTENT', 'outcome inventory is inconsistent.');
    }
    if (outcomes.requestedRuns !== sampleSize.requestedRuns
        || outcomes.inventorySum !== sampleSize.requestedRuns
        || outcomes.technical_error !== result.technicalErrorCount) {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_OUTCOME_INVENTORY_INCONSISTENT', 'outcome inventory totals are inconsistent.');
    }
    if ((result.batchStatus === 'completed' && (result.technicalErrorCount !== 0 || result.financialMetricsValid !== true))
        || (result.batchStatus === 'technical_error' && (result.technicalErrorCount < 1 || result.financialMetricsValid !== false))) {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_BATCH_VALIDITY_INCONSISTENT', 'batchStatus, technical errors and financialMetricsValid are inconsistent.');
    }
    const kpis = requireObject(result.kpis, MONTE_CARLO_RUN_RESULT_V2_VERSION, 'kpis');
    validateEuroAggregates(kpis.euroMetrics);
    assertDrawdownDistributionV2(kpis.maximumDrawdownNominalPct, 'kpis.maximumDrawdownNominalPct');
    assertDrawdownDistributionV2(kpis.maximumDrawdownRealPct, 'kpis.maximumDrawdownRealPct');
    assertObservationCountObject(kpis.realWithdrawalP10RealEur?.observationCount, 'kpis.realWithdrawalP10RealEur.observationCount');
    assertObservationCountObject(kpis.maximumDrawdownRealPct?.observationCount, 'kpis.maximumDrawdownRealPct.observationCount');
    const heatmap = requireObject(result.diagnostics?.withdrawalRateHeatmap, MONTE_CARLO_RUN_RESULT_V2_VERSION, 'diagnostics.withdrawalRateHeatmap');
    if (heatmap.basisField !== 'realizedWithdrawalRatePct' || !Array.isArray(heatmap.bins)
        || heatmap.bins.length !== MC_HEATMAP_BINS.length - 1
        || !Array.isArray(heatmap.countsByPlanYear)) {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_HEATMAP_INVALID', 'Heatmap metadata is missing.');
    }
    for (const [rowIndex, row] of heatmap.countsByPlanYear.entries()) {
        if (!Array.isArray(row) || row.length !== heatmap.bins.length) {
            throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_HEATMAP_LENGTH_INVALID', `Heatmap row ${rowIndex} does not match bins.`);
        }
        for (const [columnIndex, count] of row.entries()) {
            requireInteger(count, MONTE_CARLO_RUN_RESULT_V2_VERSION, `diagnostics.withdrawalRateHeatmap.countsByPlanYear[${rowIndex}][${columnIndex}]`);
        }
    }
    let heatmapTotal = 0;
    for (const [index, bin] of heatmap.bins.entries()) {
        requireObject(bin, MONTE_CARLO_RUN_RESULT_V2_VERSION, `diagnostics.withdrawalRateHeatmap.bins[${index}]`);
        const isOpenEnded = index === heatmap.bins.length - 1;
        const expectedUpper = isOpenEnded ? null : MC_HEATMAP_BINS[index + 1];
        if (bin.index !== index
            || bin.lowerBoundPct !== MC_HEATMAP_BINS[index]
            || bin.upperBoundPct !== expectedUpper
            || bin.lowerInclusive !== true
            || bin.upperExclusive !== true
            || bin.openEnded !== isOpenEnded) {
            throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_HEATMAP_INTERVAL_INVALID', `Heatmap interval ${index} is invalid.`);
        }
        assertObservationCountObject(bin.observationCount, `diagnostics.withdrawalRateHeatmap.bins[${index}].observationCount`);
        const columnTotal = heatmap.countsByPlanYear.reduce((sum, row) => sum + row[index], 0);
        if (bin.observationCount.total !== columnTotal) {
            throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_HEATMAP_COUNT_INVALID', `Heatmap interval ${index} count is inconsistent.`);
        }
        heatmapTotal += columnTotal;
    }
    assertObservationCountObject(heatmap.observationCount, 'diagnostics.withdrawalRateHeatmap.observationCount');
    if (heatmap.observationCount.total !== heatmapTotal) {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_HEATMAP_COUNT_INVALID', 'Heatmap total observation count is inconsistent.');
    }
    const unit = requireObject(result.unitContract, MONTE_CARLO_RUN_RESULT_V2_VERSION, 'unitContract');
    if (unit.schemaVersion !== MONTE_CARLO_UNIT_CONTRACT_V2_VERSION
        || unit.currency !== 'EUR'
        || unit.nominalMoneyFieldSuffix !== 'NominalEur'
        || unit.realMoneyFieldSuffix !== 'RealEur'
        || unit.percentagePointFieldSuffix !== 'Pct'
        || unit.ratioFieldSuffix !== 'Ratio'
        || unit.withdrawalRates?.realizedWithdrawalRatePct?.unit !== 'percentage_points'
        || unit.withdrawalRates?.realizedWithdrawalRatePct?.numerator !== 'actual_effective_annual_withdrawal'
        || unit.withdrawalRates?.realizedWithdrawalRatePct?.denominator !== 'equity_bond_and_gold_tranches_excluding_liquidity_and_health_bucket'
        || unit.withdrawalRates?.realizedWithdrawalRatePct?.measurementTime !== 'after_policy_transaction_and_actual_payout'
        || unit.withdrawalRates?.preDecisionWithdrawalRatePct?.unit !== 'percentage_points'
        || unit.withdrawalRates?.preDecisionWithdrawalRatePct?.numerator !== 'preliminary_withdrawal_based_on_previous_year_flex_rate'
        || unit.withdrawalRates?.preDecisionWithdrawalRatePct?.denominator !== 'equity_bond_and_gold_tranches_excluding_liquidity_and_health_bucket'
        || unit.withdrawalRates?.preDecisionWithdrawalRatePct?.measurementTime !== 'before_transaction_and_payout'
        || unit.withdrawalRateHeatmap?.basisField !== 'realizedWithdrawalRatePct'
        || unit.withdrawalRateHeatmap?.interval !== 'lower_inclusive_upper_exclusive'
        || unit.withdrawalRateHeatmap?.thresholdPct !== 4.5
        || unit.withdrawalRateHeatmap?.comparison !== 'greater_than_or_equal_at_bin_resolution'
        || unit.withdrawalRateHeatmap?.thresholdRole !== 'reporting_reference_not_guardrail_trigger'
        || unit.timeShareRealizedWithdrawalRateAbove45Ratio?.comparison !== 'strictly_greater_than'
        || unit.timeShareRealizedWithdrawalRateAbove45Ratio?.basisField !== 'realizedWithdrawalRatePct'
        || unit.timeShareRealizedWithdrawalRateAbove45Ratio?.unit !== 'ratio'
        || unit.timeShareRealizedWithdrawalRateAbove45Ratio?.thresholdPct !== 4.5
        || unit.timeShareRealizedWithdrawalRateAbove45Ratio?.thresholdRole !== 'reporting_reference_not_guardrail_trigger'
        || unit.drawdowns?.maximumDrawdownNominalPct?.unit !== 'percentage_points_positive_loss_magnitude'
        || unit.drawdowns?.maximumDrawdownNominalPct?.domain?.minimumInclusive !== 0
        || unit.drawdowns?.maximumDrawdownNominalPct?.domain?.maximumInclusive !== 100
        || unit.drawdowns?.maximumDrawdownNominalPct?.priceBasis !== 'nominal'
        || unit.drawdowns?.maximumDrawdownRealPct?.unit !== 'percentage_points_positive_loss_magnitude'
        || unit.drawdowns?.maximumDrawdownRealPct?.domain?.minimumInclusive !== 0
        || unit.drawdowns?.maximumDrawdownRealPct?.domain?.maximumInclusive !== 100
        || unit.drawdowns?.maximumDrawdownRealPct?.priceBasis !== 'simulation-start-prices'
        || unit.drawdowns?.maximumDrawdownRealPct?.missingInflationPolicy !== 'null_with_reason_and_observation_count') {
        throw contractError(MONTE_CARLO_RUN_RESULT_V2_VERSION, 'MC_RESULT_V2_UNIT_CONTRACT_INVALID', 'V2 measurement contract is incompatible.');
    }
    assertEveryObservationCountV2(result);
    normalizeMonteCarloJsonValue(result, { path: '$.resultV2' });
    return result;
}
