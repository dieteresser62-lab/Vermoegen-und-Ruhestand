/** @import {Sampler,SamplingConfig,SamplingPublicContract,SamplingResolution,SamplingDiagnostics,HistoricalYear,SimulatorInputs,SimulationState,Random,StressContext} from '../../../typcheck/rechenkern' */
import { MONTE_CARLO_METHODS, samplingContractError, MONTE_CARLO_SAMPLING_CONTRACT_VERSION } from './schema.js';
import { isStationaryBootstrapMethod, STATIONARY_BOOTSTRAP_METHOD } from '../stationary-bootstrap-contract.js';
import { createStationaryBootstrapSampler, nextYearSample } from '../stationary-bootstrap-sampler.js';

const HISTORICAL_INDEX_BY_YEAR_CACHE = new WeakMap();

/** @param {string} method
 * @param {SamplingResolution} samplingResolution */
function assertSamplingRuntimeContract(method, samplingResolution) {
    if (!MONTE_CARLO_METHODS.has(method)) {
        throw samplingContractError('MC_SAMPLING_METHOD_INVALID', `unsupported method ${String(method)}.`);
    }
    if (samplingResolution?.contract?.schemaVersion !== MONTE_CARLO_SAMPLING_CONTRACT_VERSION
        || samplingResolution.contract.method !== method) {
        throw samplingContractError(
            'MC_SAMPLING_RUNTIME_CONTRACT_MISMATCH',
            'sampling runtime and resolved contract use different methods.'
        );
    }
}

/** @param {{yearData:HistoricalYear;state:SimulationState;samplingResolution:SamplingResolution;annualData:HistoricalYear[]}} options */
function enforceEffectiveYearUniverse({
    yearData,
    state,
    samplingResolution,
    annualData
}) {
    const yearSampling = samplingResolution?.effectiveYearSamplingConfig
        || state?.samplerState?.yearSampling;
    const allowedIndexSet = yearSampling?.allowedIndexSet;
    if (!(allowedIndexSet instanceof Set) || allowedIndexSet.size === 0) {
        return { yearData, usedFallback: false };
    }
    let historicalIndexByYear = HISTORICAL_INDEX_BY_YEAR_CACHE.get(annualData);
    if (!historicalIndexByYear) {
        historicalIndexByYear = new Map(
            annualData.map((entry, index) => [Number(entry?.jahr), index])
        );
        HISTORICAL_INDEX_BY_YEAR_CACHE.set(annualData, historicalIndexByYear);
    }
    const historicalIndex = historicalIndexByYear.get(Number(yearData?.jahr)) ?? -1;
    if (allowedIndexSet.has(historicalIndex)) {
        return { yearData, usedFallback: false };
    }

    throw samplingContractError(
        'MC_SAMPLING_YEAR_OUTSIDE_EFFECTIVE_UNIVERSE',
        'sampled year is outside the prevalidated effective universe.'
    );
}

/**
 * Initializes the method-specific state shared by Monte Carlo and Sweep.
 * The function deliberately does not allocate or advance an RNG stream.
 */
/** @param {{state:SimulationState;method:string;blockSize:number;rand:Random;samplingResolution:SamplingResolution;annualData:HistoricalYear[];startYearIndex:number}} options */
export function initializeMonteCarloSamplingStateV1({
    state,
    method,
    blockSize,
    rand,
    startYearIndex,
    samplingResolution,
    annualData
} = /** @type {NonNullable<Parameters<typeof initializeMonteCarloSamplingStateV1>[0]>} */ ({})) {
    assertSamplingRuntimeContract(method, samplingResolution);
    if (!state?.samplerState || !Array.isArray(annualData) || annualData.length === 0) {
        throw samplingContractError(
            'MC_SAMPLING_RUNTIME_STATE_INVALID',
            'sampling runtime requires initialized state and annual data.'
        );
    }

    const samplerState = state.samplerState;
    if (samplingResolution.effectiveYearSamplingConfig) {
        samplerState.yearSampling = samplingResolution.effectiveYearSamplingConfig;
    }
    if (method === 'block') {
        samplerState.blockStartIndex = startYearIndex;
        samplerState.yearInBlock = 0;
        samplerState.contractInitialStartIndex = startYearIndex;
        samplerState.contractInitialRecordPending = true;
    } else if (method === 'regime_markov' || method === 'regime_iid') {
        samplerState.currentRegime = annualData[startYearIndex]?.regime;
        samplerState.contractInitialStartIndex = startYearIndex;
        samplerState.contractInitialRecordPending = true;
    } else if (isStationaryBootstrapMethod(method)) {
        const startSampler = samplingResolution.blockStartSampler;
        const startIndices = startSampler?.indices;
        samplerState.stationaryBootstrap = /** @type {import('../../../typcheck/rechenkern-integration').CreateStationaryBootstrapSampler} */ (createStationaryBootstrapSampler)({
            annualData,
            blockSize,
            mode: STATIONARY_BOOTSTRAP_METHOD,
            cdf: Array.isArray(startSampler?.cdf) ? startSampler : null,
            startIndices,
            initialStartIndex: startYearIndex
        });
    }
    return state;
}

/**
 * Explicit method dispatch for one historical year draw.
 * Conditional stress keeps its reviewed precedence over the base method.
 */
/** @param {{state:SimulationState;method:string;blockSize:number;rand:Random;samplingResolution:SamplingResolution;annualData:HistoricalYear[];stressContext:StressContext|null;conditionalStressActive?:boolean;sampleNextYearData:(state:SimulationState,method:string,blockSize:number,rand:Random,stress:StressContext|null)=>HistoricalYear}} options */
export function sampleMonteCarloYearV1({
    state,
    method,
    blockSize,
    rand,
    stressContext,
    conditionalStressActive = false,
    samplingResolution,
    annualData,
    sampleNextYearData
} = /** @type {NonNullable<Parameters<typeof sampleMonteCarloYearV1>[0]>} */ ({})) {
    assertSamplingRuntimeContract(method, samplingResolution);
    if (typeof sampleNextYearData !== 'function') {
        throw samplingContractError(
            'MC_SAMPLING_RUNTIME_DELEGATE_INVALID',
            'sampling runtime requires the canonical year-sampling delegate.'
        );
    }

    if (method === 'block'
        && state?.samplerState?.contractInitialRecordPending
        && !conditionalStressActive) {
        const initialIndex = state.samplerState.contractInitialStartIndex;
        if (!Number.isInteger(initialIndex) || !annualData[initialIndex]) {
            throw samplingContractError(
                'MC_SAMPLING_RUNTIME_STATE_INVALID',
                'initial fixed-block start index is missing from the sampling runtime.'
            );
        }
        state.samplerState.blockStartIndex = initialIndex;
        state.samplerState.yearInBlock = 1;
        state.samplerState.contractInitialRecordPending = false;
        return {
            yearData: { ...annualData[initialIndex] },
            source: 'initial_start',
            stationaryRestartReason: null
        };
    }

    if (isStationaryBootstrapMethod(method) && !conditionalStressActive) {
        const stationarySample = /** @type {import('../../../typcheck/rechenkern-integration').NextYearSample} */ (nextYearSample)(/** @type {NonNullable<import('../../../typcheck/rechenkern').SamplerState['stationaryBootstrap']>} */ (state?.samplerState?.stationaryBootstrap), rand);
        return {
            yearData: stationarySample.yearData,
            source: stationarySample.restartReason === 'initial'
                ? 'initial_start'
                : (stationarySample.isRestart ? 'stationary_restart' : 'stationary_continuation'),
            stationaryRestartReason: stationarySample.restartReason || null
        };
    }

    if ((method === 'regime_markov' || method === 'regime_iid')
        && state?.samplerState?.contractInitialRecordPending
        && !conditionalStressActive) {
        const initialIndex = state.samplerState.contractInitialStartIndex;
        if (!Number.isInteger(initialIndex) || !annualData[initialIndex]) {
            throw samplingContractError(
                'MC_SAMPLING_RUNTIME_STATE_INVALID',
                'initial start index is missing from the sampling runtime.'
            );
        }
        state.samplerState.contractInitialRecordPending = false;
        return {
            yearData: { ...annualData[initialIndex] },
            source: 'initial_start',
            stationaryRestartReason: null
        };
    }

    const yearData = sampleNextYearData(state, method, blockSize, rand, stressContext);
    if (conditionalStressActive) {
        return {
            yearData,
            source: 'conditional_stress',
            stationaryRestartReason: null
        };
    }
    if (method === 'block') {
        const isBlockStart = state.samplerState.yearInBlock === 1;
        return {
            yearData,
            source: isBlockStart ? 'fixed_block_restart' : 'fixed_block_continuation',
            stationaryRestartReason: null
        };
    }
    if (method === 'regime_markov' || method === 'regime_iid') {
        const effectiveSample = enforceEffectiveYearUniverse({
            yearData,
            state,
            samplingResolution,
            annualData
        });
        return {
            yearData: effectiveSample.yearData,
            source: effectiveSample.usedFallback ? `${method}_eligible_fallback` : method,
            stationaryRestartReason: null
        };
    }

    // Stationary reaches the delegate only while conditional stress is active.
    throw samplingContractError(
        'MC_SAMPLING_RUNTIME_DISPATCH_INVALID',
        `no base sampling dispatch exists for method ${String(method)}.`
    );
}
