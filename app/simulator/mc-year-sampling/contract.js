/** @import {Sampler,SamplingConfig,SamplingPublicContract,SamplingResolution,SamplingDiagnostics,HistoricalYear,SimulatorInputs,SimulationState,Random,StressContext} from '../../../typcheck/rechenkern' */
import { REGIME_DATA, REGIME_TRANSITIONS, ESTIMATED_HISTORY_CUTOFF_YEAR, STRESS_PRESETS } from '../simulator-data.js';
import { samplingContractError, MONTE_CARLO_METHODS, START_YEAR_MODES, MONTE_CARLO_SAMPLING_CONTRACT_VERSION } from './schema.js';
import { buildYearSamplingConfig, resolveMinStartYearIndex } from './configuration.js';
import { getStartYearCandidates } from '../../shared/cape-utils.js';
import { samplerFromIndices, cloneYearSamplingConfig } from './samplers.js';
import { resolveStressHistoricalPool } from '../simulator-portfolio-stress.js';

/** @param {string} method
 * @param {Sampler|null} initialStartSampler
 * @param {HistoricalYear[]} annualData */
function collectDrawableRegimes(method, initialStartSampler, annualData) {
    if (method === 'regime_iid') {
        return Object.keys(REGIME_DATA);
    }
    if (method !== 'regime_markov') return [];

    const reachable = new Set(
        (initialStartSampler?.indices || [])
            .map(index => annualData[index]?.regime)
            .filter(Boolean)
    );
    const pending = [...reachable];
    while (pending.length > 0) {
        const currentRegime = /** @type {string} */ (pending.shift());
        const transitions = /** @type {Record<string,Record<string,number>>} */ (REGIME_TRANSITIONS)[currentRegime];
        if (!transitions || !Number.isFinite(transitions.total) || transitions.total <= 0) {
            throw samplingContractError(
                'MC_SAMPLING_REGIME_TRANSITIONS_INVALID',
                `transition data for regime ${String(currentRegime)} is missing or empty.`
            );
        }
        for (const [targetRegime, count] of Object.entries(transitions)) {
            if (targetRegime === 'total' || !(Number(count) > 0) || reachable.has(targetRegime)) {
                continue;
            }
            reachable.add(targetRegime);
            pending.push(targetRegime);
        }
    }

    const configuredOrder = Object.keys(REGIME_DATA);
    return [
        ...configuredOrder.filter(regime => reachable.has(regime)),
        ...[...reachable].filter(regime => !configuredOrder.includes(regime)).sort()
    ];
}

/** @param {{method:string;initialStartSampler:Sampler;effectiveYearSamplingConfig:SamplingConfig|null;annualData:HistoricalYear[]}} options */
function assertDrawableRegimePools({
    method,
    initialStartSampler,
    effectiveYearSamplingConfig,
    annualData
}) {
    const drawableRegimes = collectDrawableRegimes(method, initialStartSampler, annualData);
    const missingRegimes = drawableRegimes.filter(regime => {
        const sampler = effectiveYearSamplingConfig?.regimeSamplers?.[regime];
        return !Array.isArray(sampler?.indices) || sampler.indices.length === 0;
    });
    if (missingRegimes.length > 0) {
        throw samplingContractError(
            'MC_SAMPLING_REGIME_POOL_EMPTY',
            `${method} kann Regime ohne zulaessiges Jahr ziehen: ${missingRegimes.join(', ')}.`
        );
    }
    return drawableRegimes;
}

/** @param {{method:string;inputs:SimulatorInputs;annualData:HistoricalYear[];useCapeSampling?:boolean;startYearMode?:string;startYearFilter?:number;startYearHalfLife?:number;blockSize?:number;excludeEstimatedHistory?:boolean;yearSamplingConfig?:SamplingConfig|null}} options
 * @returns {SamplingResolution} */
export function resolveMonteCarloSamplingContractV1({
    method,
    inputs,
    annualData,
    useCapeSampling = false,
    startYearMode = 'UNIFORM',
    startYearFilter = 1970,
    startYearHalfLife = 20,
    blockSize = 1,
    excludeEstimatedHistory = false,
    yearSamplingConfig = null
} = /** @type {NonNullable<Parameters<typeof resolveMonteCarloSamplingContractV1>[0]>} */ ({})) {
    if (!Array.isArray(annualData) || annualData.length === 0) {
        throw samplingContractError('MC_SAMPLING_DATA_EMPTY', 'annualData must not be empty.');
    }
    if (!MONTE_CARLO_METHODS.has(method)) {
        throw samplingContractError('MC_SAMPLING_METHOD_INVALID', `unsupported method ${String(method)}.`);
    }

    const normalizedMode = START_YEAR_MODES.has(startYearMode) ? startYearMode : 'UNIFORM';
    const requestedConfig = yearSamplingConfig || buildYearSamplingConfig(normalizedMode, annualData, {
        startYearFilter,
        startYearHalfLife,
        blockSize,
        excludeEstimatedHistory
    });
    const uniformConfig = normalizedMode === 'UNIFORM'
        ? requestedConfig
        : buildYearSamplingConfig('UNIFORM', annualData, {
            blockSize,
            excludeEstimatedHistory
        });
    if (!uniformConfig?.allowedIndices?.length) {
        throw samplingContractError('MC_SAMPLING_NO_START_CANDIDATES', 'the unweighted start-year universe is empty.');
    }

    const minStartIndex = resolveMinStartYearIndex(annualData, excludeEstimatedHistory);
    const capeValue = Number(inputs?.capeRatio) > 0
        ? Number(inputs.capeRatio)
        : Number(inputs?.marketCapeRatio);
    const capeYears = useCapeSampling === true && Number.isFinite(capeValue) && capeValue > 0
        ? /** @type {import('../../../typcheck/rechenkern-integration').GetStartYearCandidates} */ (getStartYearCandidates)(capeValue, annualData, 0.2, { fallbackToAll: false })
        : [];
    const capeIndices = capeYears
        .map(year => annualData.findIndex(entry => entry?.jahr === year))
        .filter(index => index >= minStartIndex)
        .filter(index => !excludeEstimatedHistory
            || Number(annualData[index]?.jahr) >= ESTIMATED_HISTORY_CUTOFF_YEAR);
    const capeInitialIndices = method === 'block'
        ? capeIndices.filter(index => index <= annualData.length - Math.max(1, Math.round(Number(blockSize) || 1)))
        : capeIndices;
    const capeEffective = useCapeSampling === true && capeInitialIndices.length > 0;

    const baseInitialIndices = method === 'block'
        ? requestedConfig?.blockStartIndices
        : requestedConfig?.allowedIndices;
    if (!capeEffective && (!Array.isArray(baseInitialIndices) || baseInitialIndices.length === 0)) {
        const code = method === 'block'
            ? 'MC_SAMPLING_NO_BLOCK_START_CANDIDATES'
            : 'MC_SAMPLING_NO_START_CANDIDATES';
        throw samplingContractError(code, 'no eligible initial record satisfies the configured sampling method.');
    }

    const baseWeightedSampler = method === 'block'
        ? requestedConfig?.blockSampler
        : requestedConfig?.allSampler;
    const initialStartSampler = capeEffective
        ? samplerFromIndices(capeInitialIndices)
        : samplerFromIndices(baseInitialIndices, baseWeightedSampler);
    if (!initialStartSampler) {
        throw samplingContractError('MC_SAMPLING_NO_START_CANDIDATES', 'no initial start sampler could be constructed.');
    }

    const effectiveYearSamplingConfig = /** @type {SamplingConfig} */ (cloneYearSamplingConfig(
        capeEffective ? uniformConfig : requestedConfig
    ));
    if (method === 'block') {
        effectiveYearSamplingConfig.blockStartIndices = [...initialStartSampler.indices];
        effectiveYearSamplingConfig.blockSampler = initialStartSampler;
    }
    const drawableRegimes = assertDrawableRegimePools({
        method,
        initialStartSampler,
        effectiveYearSamplingConfig,
        annualData
    });
    const stressPresetKey = String(inputs?.stressPreset || 'NONE');
    const stressPreset = STRESS_PRESETS[stressPresetKey];
    const stressPool = resolveStressHistoricalPool(stressPresetKey, annualData);
    const effectiveStressIndices = stressPreset?.type === 'conditional_bootstrap'
        ? stressPool.candidateIndices.filter(/** @param {number} index */ index => effectiveYearSamplingConfig.allowedIndexSet.has(index))
        : [];
    if (stressPreset?.type === 'conditional_bootstrap'
        && effectiveStressIndices.length < stressPool.minimumDistinctYears) {
        const code = effectiveStressIndices.length === 0
            ? 'SIMULATOR_STRESS_EFFECTIVE_POOL_EMPTY'
            : 'SIMULATOR_STRESS_EFFECTIVE_POOL_TOO_SMALL';
        throw samplingContractError(
            code,
            `stress preset ${stressPresetKey} requires at least ${stressPool.minimumDistinctYears} distinct years; `
                + `the effective sampling universe contains ${effectiveStressIndices.length}.`
        );
    }

    const warnings = [];
    if (useCapeSampling === true && !(Number.isFinite(capeValue) && capeValue > 0)) {
        warnings.push('cape_value_unavailable_fallback');
    } else if (useCapeSampling === true && capeInitialIndices.length === 0) {
        warnings.push('cape_candidates_empty_fallback');
    }

    const ignoredOptions = capeEffective && normalizedMode !== 'UNIFORM'
        ? ['startYearMode', normalizedMode === 'FILTER' ? 'startYearFilter' : 'startYearHalfLife']
        : [];
    const startSource = capeEffective ? 'cape' : normalizedMode.toLowerCase();
    const isRegimeMethod = method === 'regime_markov' || method === 'regime_iid';
    const precedence = [
        'estimated_history_exclusion',
        'cape_or_start_weighting',
        'sampling_method',
        ...(isRegimeMethod ? ['effective_year_universe_validation'] : []),
        'conditional_stress_override',
        'tail_risk_overlay'
    ];
    const publicContract = {
        schemaVersion: MONTE_CARLO_SAMPLING_CONTRACT_VERSION,
        method,
        startSource,
        requestedStartYearMode: normalizedMode,
        capeSamplingRequested: useCapeSampling === true,
        capeSamplingEffective: capeEffective,
        excludeEstimatedHistory: excludeEstimatedHistory === true,
        ignoredOptions,
        warnings,
        initialCandidateCount: initialStartSampler.indices.length,
        firstRecordPolicy: 'selected_start_record',
        fixedBlockPolicy: method === 'block' ? 'full_sequential_block_from_selected_start' : 'not_applicable',
        stationaryRestartPolicy: method === 'stationary' ? 'restart_probability_after_initial_record' : 'not_applicable',
        regimePolicy: method === 'regime_markov'
            ? 'initial_record_then_markov_transition'
            : (method === 'regime_iid' ? 'initial_record_then_iid' : 'not_applicable'),
        ...(isRegimeMethod
            ? {
                emptyRegimePoolPolicy: 'reject_request',
                drawableRegimes
            }
            : {}),
        precedence
    };

    return {
        contract: publicContract,
        initialStartSampler,
        blockStartSampler: method === 'block' || method === 'stationary'
            ? initialStartSampler
            : null,
        effectiveYearSamplingConfig
    };
}
