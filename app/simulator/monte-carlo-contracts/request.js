// @ts-check
/** @import {RunRequestV1,SimulatorInputs,MonteCarloParameters,SamplingDiagnostics,ExecutionContract,Fingerprint,Portable} from '../../../typcheck/rechenkern' */
import { MONTE_CARLO_RUN_REQUEST_VERSION, MONTE_CARLO_SCENARIO_VERSION, MONTE_CARLO_SNAPSHOT_POLICY_VERSION, MONTE_CARLO_FINGERPRINT_ALGORITHM, MONTE_CARLO_SNAPSHOT_POLICY, MONTE_CARLO_LEGACY_READ_ALIASES } from './schema.js';
import { contractError, requireObject, requireInteger, requireString } from './validation-primitives.js';
import { deepFreezeMonteCarloContract, normalizeMonteCarloJsonValue, fingerprintMonteCarloValue, cloneContractValue } from './portable-json.js';
import { annualData, STRESS_PRESETS } from '../simulator-data.js';
import { resolveStressHistoricalPool } from '../simulator-portfolio-stress.js';

const SAMPLING_METHODS = new Set(['block', 'stationary', 'regime_markov', 'regime_iid']);

const RNG_MODES = new Set(['per-run-seed', 'legacy-stream']);

const START_YEAR_MODES = new Set(['UNIFORM', 'FILTER', 'RECENCY']);

/** @param {Fingerprint} fingerprint
 * @param {unknown} basis
 * @param {string} contract
 * @param {string} field */
function assertFingerprint(fingerprint, basis, contract, field) {
    requireObject(fingerprint, contract, field);
    if (fingerprint.algorithm !== MONTE_CARLO_FINGERPRINT_ALGORITHM) {
        throw contractError(contract, 'MC_CONTRACT_FINGERPRINT_ALGORITHM_UNSUPPORTED', `${field}.algorithm is unsupported.`);
    }
    const expected = fingerprintMonteCarloValue(basis).value;
    if (fingerprint.value !== expected) {
        throw contractError(contract, 'MC_CONTRACT_FINGERPRINT_MISMATCH', `${field}.value does not match its canonical payload.`);
    }
}

/** @param {ExecutionContract} execution */
function createExecutionContract(execution = {}) {
    const mode = execution.mode === 'worker' ? 'worker' : 'serial';
    const workerCount = mode === 'worker' ? Number(execution.workerCount) : 0;
    const chunk = execution.chunkConfiguration || {};
    return {
        mode,
        compareModeRequested: execution.compareModeRequested === true,
        workerCount: mode === 'worker' && Number.isSafeInteger(workerCount) && workerCount > 0 ? workerCount : 0,
        timeBudgetMs: mode === 'worker' && Number.isFinite(Number(execution.timeBudgetMs))
            ? Number(execution.timeBudgetMs)
            : null,
        chunkConfiguration: {
            strategy: mode === 'worker' ? 'adaptive-time-budget-v1' : 'single-chunk-v1',
            minChunkRuns: mode === 'worker' ? Number(chunk.minChunkRuns ?? 10) : null,
            baseTimeoutMs: mode === 'worker' ? Number(chunk.baseTimeoutMs ?? 5000) : null,
            stallTimeoutMs: mode === 'worker' ? Number(chunk.stallTimeoutMs ?? 20000) : null
        }
    };
}

/** @param {{inputs:SimulatorInputs;widowOptions:Record<string,unknown>;monteCarloParams:MonteCarloParameters;useCapeSampling?:boolean;samplingDiagnostics:SamplingDiagnostics;dataVersion?:Record<string,unknown>;execution?:ExecutionContract;scenarioKey?:string|null}} options */
export function createMonteCarloRunRequestV1({
    inputs,
    widowOptions,
    monteCarloParams,
    useCapeSampling = false,
    samplingDiagnostics,
    dataVersion,
    execution,
    scenarioKey = null
} = /** @type {NonNullable<Parameters<typeof createMonteCarloRunRequestV1>[0]>} */ ({})) {
    const params = requireObject(monteCarloParams, MONTE_CARLO_RUN_REQUEST_VERSION, 'monteCarloParams');
    const normalizedInputs = normalizeMonteCarloJsonValue(inputs, { path: '$.scenario.normalizedInputs' });
    const normalizedWidowOptions = normalizeMonteCarloJsonValue(widowOptions || {}, { path: '$.scenario.widowOptions' });
    const normalizedDataVersion = normalizeMonteCarloJsonValue(dataVersion || samplingDiagnostics?.dataVersion || {}, {
        path: '$.data.version'
    });
    const samplingContract = normalizeMonteCarloJsonValue(samplingDiagnostics?.contract || {}, {
        path: '$.sampling.effectiveContract'
    });
    const stressPresetKey = String(normalizedInputs?.stressPreset || 'NONE');
    const stressPreset = STRESS_PRESETS[stressPresetKey] || STRESS_PRESETS.NONE;
    const stressPool = resolveStressHistoricalPool(stressPresetKey, annualData);
    const scenario = /** @type {{schemaVersion:string;cacheKey:string|null;normalizedInputs:Portable<SimulatorInputs>;widowOptions:Portable<Record<string,unknown>>;fingerprint:Fingerprint}} */ ({
        schemaVersion: MONTE_CARLO_SCENARIO_VERSION,
        cacheKey: typeof scenarioKey === 'string' && scenarioKey.trim() ? scenarioKey : null,
        normalizedInputs,
        widowOptions: normalizedWidowOptions
    });
    scenario.fingerprint = fingerprintMonteCarloValue({
        schemaVersion: scenario.schemaVersion,
        normalizedInputs: scenario.normalizedInputs,
        widowOptions: scenario.widowOptions
    });

    const request = {
        schemaVersion: MONTE_CARLO_RUN_REQUEST_VERSION,
        parameters: {
            runs: Number(params.anzahl),
            horizonYears: Number(params.maxDauer),
            blockLengthYears: Number(params.blockSize),
            seed: Number(params.seed),
            samplingMethod: String(params.methode || ''),
            rngMode: String(params.rngMode || 'per-run-seed')
        },
        sampling: {
            capeSamplingRequested: useCapeSampling === true,
            startYearMode: String(params.startYearMode || 'UNIFORM'),
            startYearFilter: Number(params.startYearFilter ?? 1970),
            startYearHalfLifeYears: Number(params.startYearHalfLife ?? 20),
            excludeEstimatedHistory: params.excludeEstimatedHistory === true,
            effectiveContract: samplingContract
        },
        stress: {
            preset: stressPresetKey,
            method: 'conditional-preset-then-tail-risk-overlay-v1',
            provenance: normalizeMonteCarloJsonValue(stressPreset.provenance, { path: '$.stress.provenance' }),
            pool: normalizeMonteCarloJsonValue({
                policy: stressPreset.type === 'conditional_bootstrap'
                    ? 'independent_draws_from_filtered_historical_pool'
                    : 'not_applicable',
                minimumDistinctYears: stressPool.minimumDistinctYears,
                rawCandidateCount: stressPool.candidateIndices.length,
                rawCandidateYears: [...stressPool.candidateYears]
            }, { path: '$.stress.pool' })
        },
        scenario,
        data: {
            version: normalizedDataVersion,
            fingerprint: fingerprintMonteCarloValue(normalizedDataVersion)
        },
        execution: createExecutionContract(execution),
        snapshotPolicy: { ...MONTE_CARLO_SNAPSHOT_POLICY }
    };
    validateMonteCarloRunRequestV1(request);
    // Lokalen Objekttyp erhalten, ohne Typinferenz über den Validator.
    return /** @type {typeof request} */ (deepFreezeMonteCarloContract(request));
}

/** @param {RunRequestV1} request */
export function validateMonteCarloRunRequestV1(request) {
    requireObject(request, MONTE_CARLO_RUN_REQUEST_VERSION, 'request');
    if (request.schemaVersion !== MONTE_CARLO_RUN_REQUEST_VERSION) {
        throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_REQUEST_VERSION_UNSUPPORTED', `Unsupported schemaVersion ${String(request.schemaVersion)}.`);
    }
    const parameters = requireObject(request.parameters, MONTE_CARLO_RUN_REQUEST_VERSION, 'parameters');
    requireInteger(parameters.runs, MONTE_CARLO_RUN_REQUEST_VERSION, 'parameters.runs', { min: 1 });
    requireInteger(parameters.horizonYears, MONTE_CARLO_RUN_REQUEST_VERSION, 'parameters.horizonYears', { min: 1 });
    requireInteger(parameters.blockLengthYears, MONTE_CARLO_RUN_REQUEST_VERSION, 'parameters.blockLengthYears', { min: 1 });
    requireInteger(parameters.seed, MONTE_CARLO_RUN_REQUEST_VERSION, 'parameters.seed', { min: Number.MIN_SAFE_INTEGER });
    if (!SAMPLING_METHODS.has(parameters.samplingMethod)) {
        throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_REQUEST_SAMPLING_METHOD_INVALID', 'parameters.samplingMethod is unsupported.');
    }
    if (!RNG_MODES.has(parameters.rngMode)) {
        throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_REQUEST_RNG_MODE_INVALID', 'parameters.rngMode is unsupported.');
    }
    const sampling = requireObject(request.sampling, MONTE_CARLO_RUN_REQUEST_VERSION, 'sampling');
    if (!START_YEAR_MODES.has(sampling.startYearMode)) {
        throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_REQUEST_START_YEAR_MODE_INVALID', 'sampling.startYearMode is unsupported.');
    }
    requireInteger(sampling.startYearFilter, MONTE_CARLO_RUN_REQUEST_VERSION, 'sampling.startYearFilter', { min: Number.MIN_SAFE_INTEGER });
    requireInteger(sampling.startYearHalfLifeYears, MONTE_CARLO_RUN_REQUEST_VERSION, 'sampling.startYearHalfLifeYears', { min: 1 });
    const effectiveSampling = requireObject(sampling.effectiveContract, MONTE_CARLO_RUN_REQUEST_VERSION, 'sampling.effectiveContract');
    if (effectiveSampling.schemaVersion !== 'MonteCarloSamplingContractV1') {
        throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_REQUEST_SAMPLING_CONTRACT_UNSUPPORTED', 'sampling.effectiveContract is missing or incompatible.');
    }
    requireObject(request.stress, MONTE_CARLO_RUN_REQUEST_VERSION, 'stress');
    requireString(request.stress.preset, MONTE_CARLO_RUN_REQUEST_VERSION, 'stress.preset');
    // V1 added provenance and pool metadata additively. New writers always
    // emit both objects; readers keep accepting V1 exports created before the
    // additive fields existed.
    if (request.stress.provenance !== undefined) {
        requireObject(request.stress.provenance, MONTE_CARLO_RUN_REQUEST_VERSION, 'stress.provenance');
        requireString(/** @type {{evidenceKind:unknown}} */ (request.stress.provenance).evidenceKind, MONTE_CARLO_RUN_REQUEST_VERSION, 'stress.provenance.evidenceKind');
        requireString(/** @type {{claimScope:unknown}} */ (request.stress.provenance).claimScope, MONTE_CARLO_RUN_REQUEST_VERSION, 'stress.provenance.claimScope');
    }
    if (request.stress.pool !== undefined) {
        requireObject(request.stress.pool, MONTE_CARLO_RUN_REQUEST_VERSION, 'stress.pool');
    }
    const scenario = requireObject(request.scenario, MONTE_CARLO_RUN_REQUEST_VERSION, 'scenario');
    if (scenario.schemaVersion !== MONTE_CARLO_SCENARIO_VERSION) {
        throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_REQUEST_SCENARIO_VERSION_UNSUPPORTED', 'scenario.schemaVersion is unsupported.');
    }
    requireObject(scenario.normalizedInputs, MONTE_CARLO_RUN_REQUEST_VERSION, 'scenario.normalizedInputs');
    requireObject(scenario.widowOptions, MONTE_CARLO_RUN_REQUEST_VERSION, 'scenario.widowOptions');
    assertFingerprint(scenario.fingerprint, {
        schemaVersion: scenario.schemaVersion,
        normalizedInputs: scenario.normalizedInputs,
        widowOptions: scenario.widowOptions
    }, MONTE_CARLO_RUN_REQUEST_VERSION, 'scenario.fingerprint');
    const data = requireObject(request.data, MONTE_CARLO_RUN_REQUEST_VERSION, 'data');
    requireObject(data.version, MONTE_CARLO_RUN_REQUEST_VERSION, 'data.version');
    requireString(data.version.annualDataHash, MONTE_CARLO_RUN_REQUEST_VERSION, 'data.version.annualDataHash');
    requireString(data.version.regimeHash, MONTE_CARLO_RUN_REQUEST_VERSION, 'data.version.regimeHash');
    assertFingerprint(data.fingerprint, data.version, MONTE_CARLO_RUN_REQUEST_VERSION, 'data.fingerprint');
    const execution = requireObject(request.execution, MONTE_CARLO_RUN_REQUEST_VERSION, 'execution');
    if (!['serial', 'worker'].includes(execution.mode)) {
        throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_REQUEST_EXECUTION_MODE_INVALID', 'execution.mode is unsupported.');
    }
    requireInteger(execution.workerCount, MONTE_CARLO_RUN_REQUEST_VERSION, 'execution.workerCount');
    if (execution.mode === 'worker' && execution.workerCount < 1) {
        throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_REQUEST_WORKER_COUNT_INVALID', 'worker execution requires workerCount >= 1.');
    }
    const chunkConfiguration = requireObject(execution.chunkConfiguration, MONTE_CARLO_RUN_REQUEST_VERSION, 'execution.chunkConfiguration');
    if (execution.mode === 'worker') {
        requireInteger(execution.timeBudgetMs, MONTE_CARLO_RUN_REQUEST_VERSION, 'execution.timeBudgetMs', { min: 1 });
        requireInteger(chunkConfiguration.minChunkRuns, MONTE_CARLO_RUN_REQUEST_VERSION, 'execution.chunkConfiguration.minChunkRuns', { min: 1 });
        requireInteger(chunkConfiguration.baseTimeoutMs, MONTE_CARLO_RUN_REQUEST_VERSION, 'execution.chunkConfiguration.baseTimeoutMs', { min: 1 });
        requireInteger(chunkConfiguration.stallTimeoutMs, MONTE_CARLO_RUN_REQUEST_VERSION, 'execution.chunkConfiguration.stallTimeoutMs', { min: 1 });
    }
    if (request.snapshotPolicy?.schemaVersion !== MONTE_CARLO_SNAPSHOT_POLICY_VERSION) {
        throw contractError(MONTE_CARLO_RUN_REQUEST_VERSION, 'MC_REQUEST_SNAPSHOT_POLICY_UNSUPPORTED', 'snapshotPolicy is missing or incompatible.');
    }
    normalizeMonteCarloJsonValue(request, { path: '$' });
    return request;
}

/** @param {RunRequestV1} request */
export function extractMonteCarloReplayArgsV1(request) {
    validateMonteCarloRunRequestV1(request);
    return deepFreezeMonteCarloContract({
        inputs: cloneContractValue(request.scenario.normalizedInputs, '$.replay.inputs'),
        widowOptions: cloneContractValue(request.scenario.widowOptions, '$.replay.widowOptions'),
        monteCarloParams: {
            anzahl: request.parameters.runs,
            maxDauer: request.parameters.horizonYears,
            blockSize: request.parameters.blockLengthYears,
            seed: request.parameters.seed,
            methode: request.parameters.samplingMethod,
            rngMode: request.parameters.rngMode,
            startYearMode: request.sampling.startYearMode,
            startYearFilter: request.sampling.startYearFilter,
            startYearHalfLife: request.sampling.startYearHalfLifeYears,
            excludeEstimatedHistory: request.sampling.excludeEstimatedHistory
        },
        useCapeSampling: request.sampling.capeSamplingRequested,
        execution: cloneContractValue(request.execution, '$.replay.execution')
    });
}

/** @param {unknown} root
 * @param {string} path
 * @returns {unknown} */
function valueAtPath(root, path) {
    return path.split('.').reduce((value, key) => value == null ? undefined : /** @type {Record<string,unknown>} */ (value)[key], root);
}

/** @param {unknown} document
 * @param {((event:{event:string;alias:string;replacement:string;removalTarget:string})=>void)|null} onTelemetry */
export function collectMonteCarloLegacyAliasTelemetryV1(document, onTelemetry = null) {
    const aliases = MONTE_CARLO_LEGACY_READ_ALIASES.filter(alias => valueAtPath(document, alias.path) !== undefined);
    for (const alias of aliases) {
        if (typeof onTelemetry === 'function') {
            onTelemetry({
                event: 'monte_carlo_deprecated_alias_read',
                alias: alias.path,
                replacement: alias.replacement,
                removalTarget: alias.removalTarget
            });
        }
    }
    return Object.freeze(aliases.map(alias => alias.path));
}
