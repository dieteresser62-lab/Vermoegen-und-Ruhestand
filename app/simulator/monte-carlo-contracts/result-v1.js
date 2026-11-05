// @ts-check
/** @import {RunResultV1,SamplingDiagnostics,DeepPartial,AggregateMetrics,TechnicalPathError,TechnicalInventory} from '../../../typcheck/rechenkern' */
import { MONTE_CARLO_RUN_RESULT_VERSION, BATCH_STATUSES } from './schema.js';
import { contractError, requireObject, requireInteger } from './validation-primitives.js';
import { deepFreezeMonteCarloContract, redactLocalPaths, normalizeMonteCarloJsonValue, cloneContractValue } from './portable-json.js';
import { projectMonteCarloKpis, buildMissingness, projectHeatmapBins } from './kpi-projection.js';

/** @param {TechnicalPathError[]|undefined} errors */
function sanitizeTechnicalErrors(errors) {
    return (Array.isArray(errors) ? errors : []).slice(0, 20).map(error => ({
        runIndex: Number.isSafeInteger(error?.runIndex) ? error.runIndex : null,
        simulationYearIndex: Number.isSafeInteger(error?.simulationYearIndex) ? error.simulationYearIndex : null,
        code: typeof error?.code === 'string' && error.code.trim() ? error.code.trim() : 'MC_TECHNICAL_ERROR_UNSPECIFIED',
        message: redactLocalPaths(typeof error?.message === 'string'
            ? error.message
            : 'Ein Simulationspfad wurde technisch abgebrochen.')
    }));
}

/** @param {AggregateMetrics} aggregated
 * @param {DeepPartial<SamplingDiagnostics>|null|undefined} samplingDiagnostics
 * @param {number} technicalErrorCount */
function buildWarnings(aggregated, samplingDiagnostics, technicalErrorCount) {
    const warnings = [];
    const uncertaintyWarning = aggregated?.outcomeInventory?.floorCoverageEstimate?.uncertaintyWarning;
    if (uncertaintyWarning) warnings.push({
        source: 'floor_coverage',
        code: String(uncertaintyWarning.code || 'uncertainty_warning'),
        message: String(uncertaintyWarning.message || 'Die Schaetzerunsicherheit ist erhoeht.')
    });
    for (const warning of samplingDiagnostics?.contract?.warnings || []) {
        warnings.push({ source: 'sampling', code: String(warning), message: null });
    }
    if (technicalErrorCount > 0) {
        warnings.push({
            source: 'batch',
            code: 'technical_errors_present',
            message: 'Finanzielle Batch-KPIs sind wegen technischer Pfadfehler fail-closed.'
        });
    }
    return warnings;
}

/** @param {{aggregatedResults:AggregateMetrics;samplingDiagnostics?:DeepPartial<SamplingDiagnostics>;executionDiagnostics?:unknown;requestedRuns?:number|null}} options */
export function createMonteCarloRunResultV1({
    aggregatedResults,
    samplingDiagnostics,
    executionDiagnostics,
    requestedRuns = null
} = /** @type {NonNullable<Parameters<typeof createMonteCarloRunResultV1>[0]>} */ ({})) {
    const aggregated = requireObject(aggregatedResults, MONTE_CARLO_RUN_RESULT_VERSION, 'aggregatedResults');
    const outcomeInventory = cloneContractValue(aggregated.outcomeInventory, '$.result.outcomeInventory');
    const technicalInventory = /** @type {Partial<TechnicalInventory>} */ (aggregated.technicalInventory || {});
    const requested = requestedRuns ?? outcomeInventory?.requestedRuns ?? technicalInventory.requested;
    const technicalErrorCount = Number(outcomeInventory?.technical_error ?? technicalInventory.technicalError) || 0;
    const kpis = projectMonteCarloKpis(aggregated);
    const sampling = cloneContractValue(samplingDiagnostics || {}, '$.result.diagnostics.sampling');
    const execution = cloneContractValue(executionDiagnostics || {}, '$.result.diagnostics.execution');
    const result = {
        schemaVersion: MONTE_CARLO_RUN_RESULT_VERSION,
        batchStatus: String(aggregated.batchStatus || (technicalErrorCount > 0 ? 'technical_error' : 'completed')),
        financialMetricsValid: aggregated.financialMetricsValid === true,
        sampleSize: {
            requestedRuns: Number(requested),
            financiallyEvaluableRuns: Number(technicalInventory.financiallyEvaluable ?? (Number(requested) - technicalErrorCount)),
            technicalErrorRuns: technicalErrorCount
        },
        technicalErrorCount,
        outcomeInventory,
        kpis,
        uncertainty: {
            floorCoverage: cloneContractValue(outcomeInventory?.floorCoverageEstimate || null, '$.result.uncertainty.floorCoverage'),
            realWithdrawalP10RealEur: cloneContractValue(kpis.realWithdrawalP10RealEur.uncertainty, '$.result.uncertainty.realWithdrawalP10RealEur'),
            stressRealWithdrawalP10RealEur: cloneContractValue(kpis.stress.realWithdrawalP10RealEur.uncertainty, '$.result.uncertainty.stressRealWithdrawalP10RealEur')
        },
        missingness: buildMissingness(kpis),
        diagnostics: {
            sampling,
            execution,
            technicalErrors: sanitizeTechnicalErrors(technicalInventory.errors),
            withdrawalRateHeatmap: {
                bins: projectHeatmapBins(aggregated.bins),
                countsByPlanYear: cloneContractValue(aggregated.heatmap || [], '$.result.diagnostics.withdrawalRateHeatmap.countsByPlanYear')
            }
        },
        warnings: buildWarnings(aggregated, samplingDiagnostics, technicalErrorCount),
        unitContract: {
            currency: 'EUR',
            nominalMoneyFieldSuffix: 'NominalEur',
            realMoneyFieldSuffix: 'RealEur',
            realPriceBasis: 'simulation-start-prices',
            percentages: 'percentage-points',
            ratios: 'unitless-ratio',
            observedZero: '0',
            missingValue: null
        }
    };
    validateMonteCarloRunResultV1(result);
    // Lokalen Objekttyp erhalten, ohne Typinferenz über den Validator.
    return /** @type {typeof result} */ (deepFreezeMonteCarloContract(result));
}

/** @param {RunResultV1} result */
export function validateMonteCarloRunResultV1(result) {
    requireObject(result, MONTE_CARLO_RUN_RESULT_VERSION, 'result');
    if (result.schemaVersion !== MONTE_CARLO_RUN_RESULT_VERSION) {
        throw contractError(MONTE_CARLO_RUN_RESULT_VERSION, 'MC_RESULT_VERSION_UNSUPPORTED', `Unsupported schemaVersion ${String(result.schemaVersion)}.`);
    }
    if (!BATCH_STATUSES.has(result.batchStatus)) {
        throw contractError(MONTE_CARLO_RUN_RESULT_VERSION, 'MC_RESULT_BATCH_STATUS_INVALID', 'batchStatus is unsupported.');
    }
    const sampleSize = requireObject(result.sampleSize, MONTE_CARLO_RUN_RESULT_VERSION, 'sampleSize');
    requireInteger(sampleSize.requestedRuns, MONTE_CARLO_RUN_RESULT_VERSION, 'sampleSize.requestedRuns', { min: 1 });
    requireInteger(sampleSize.financiallyEvaluableRuns, MONTE_CARLO_RUN_RESULT_VERSION, 'sampleSize.financiallyEvaluableRuns');
    requireInteger(sampleSize.technicalErrorRuns, MONTE_CARLO_RUN_RESULT_VERSION, 'sampleSize.technicalErrorRuns');
    requireInteger(result.technicalErrorCount, MONTE_CARLO_RUN_RESULT_VERSION, 'technicalErrorCount');
    if (sampleSize.financiallyEvaluableRuns + sampleSize.technicalErrorRuns !== sampleSize.requestedRuns
        || sampleSize.technicalErrorRuns !== result.technicalErrorCount) {
        throw contractError(MONTE_CARLO_RUN_RESULT_VERSION, 'MC_RESULT_SAMPLE_SIZE_INCONSISTENT', 'sampleSize must classify every requested run exactly once.');
    }
    const outcomes = requireObject(result.outcomeInventory, MONTE_CARLO_RUN_RESULT_VERSION, 'outcomeInventory');
    for (const field of ['ruin', 'all_dead', 'horizon_exhausted', 'technical_error']) {
        requireInteger(outcomes[field], MONTE_CARLO_RUN_RESULT_VERSION, `outcomeInventory.${field}`);
    }
    if (outcomes.ruin + outcomes.all_dead + outcomes.horizon_exhausted + outcomes.technical_error !== sampleSize.requestedRuns
        || outcomes.technical_error !== result.technicalErrorCount
        || outcomes.requestedRuns !== sampleSize.requestedRuns
        || outcomes.inventorySum !== sampleSize.requestedRuns) {
        throw contractError(MONTE_CARLO_RUN_RESULT_VERSION, 'MC_RESULT_OUTCOME_INVENTORY_INCONSISTENT', 'outcomeInventory must classify every requested run exactly once.');
    }
    if ((result.batchStatus === 'completed' && (result.technicalErrorCount !== 0 || result.financialMetricsValid !== true))
        || (result.batchStatus === 'technical_error' && (result.technicalErrorCount < 1 || result.financialMetricsValid !== false))) {
        throw contractError(MONTE_CARLO_RUN_RESULT_VERSION, 'MC_RESULT_BATCH_VALIDITY_INCONSISTENT', 'batchStatus, technical errors and financialMetricsValid are inconsistent.');
    }
    requireObject(result.kpis, MONTE_CARLO_RUN_RESULT_VERSION, 'kpis');
    requireObject(result.uncertainty, MONTE_CARLO_RUN_RESULT_VERSION, 'uncertainty');
    requireObject(result.missingness, MONTE_CARLO_RUN_RESULT_VERSION, 'missingness');
    requireObject(result.diagnostics, MONTE_CARLO_RUN_RESULT_VERSION, 'diagnostics');
    if (!Array.isArray(result.warnings)) {
        throw contractError(MONTE_CARLO_RUN_RESULT_VERSION, 'MC_RESULT_WARNINGS_INVALID', 'warnings must be an array.');
    }
    requireObject(result.unitContract, MONTE_CARLO_RUN_RESULT_VERSION, 'unitContract');
    if (result.unitContract.nominalMoneyFieldSuffix !== 'NominalEur'
        || result.unitContract.realMoneyFieldSuffix !== 'RealEur') {
        throw contractError(MONTE_CARLO_RUN_RESULT_VERSION, 'MC_RESULT_UNIT_CONTRACT_INVALID', 'money suffixes must be explicit.');
    }
    normalizeMonteCarloJsonValue(result, { path: '$.result' });
    return result;
}
