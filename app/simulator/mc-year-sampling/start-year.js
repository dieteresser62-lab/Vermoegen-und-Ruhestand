/** @import {Sampler,SamplingConfig,SamplingPublicContract,SamplingResolution,SamplingDiagnostics,HistoricalYear,SimulatorInputs,SimulationState,Random,StressContext} from '../../../typcheck/rechenkern' */
import { MIN_START_YEAR_INDEX } from './schema.js';
import { pickFromSampler } from './samplers.js';
import { getStartYearCandidates } from '../../shared/cape-utils.js';
import { ESTIMATED_HISTORY_CUTOFF_YEAR } from '../simulator-data.js';

/** @param {(()=>number)|null|undefined} rand
 * @param {HistoricalYear[]} data
 * @param {number[]|null|undefined} cdf */
export function pickStartYearIndex(rand, data, cdf, minIndex = MIN_START_YEAR_INDEX) {
    if (!Array.isArray(data) || data.length === 0) return 0;
    const sample = rand ? rand() : Math.random();
    const r = Math.min(1 - Number.EPSILON, Math.max(0, Number.isFinite(sample) ? sample : 0));
    if (!cdf || cdf.length !== data.length) {
        // Gleichverteilung als Fallback, wenn kein CDF vorhanden ist.
        const min = Math.max(0, Math.min(minIndex, data.length - 1));
        const span = Math.max(1, data.length - min);
        return Math.min(data.length - 1, min + Math.floor(r * span));
    }
    let low = 0;
    let high = cdf.length - 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (r < cdf[mid]) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    return low;
}

/** @param {{rand:Random;inputs:SimulatorInputs;annualData:HistoricalYear[];useCapeSampling:boolean;excludeEstimatedHistory?:boolean;yearSamplingConfig?:SamplingConfig|null;startYearCdf?:number[]|null;minStartYearIndex?:number;samplingContract?:SamplingResolution|null}} options */
export function pickMonteCarloStartYearIndex({
    rand,
    inputs,
    annualData,
    useCapeSampling,
    excludeEstimatedHistory = false,
    yearSamplingConfig = null,
    startYearCdf = null,
    minStartYearIndex = MIN_START_YEAR_INDEX,
    samplingContract = null
}) {
    if (samplingContract?.initialStartSampler) {
        return pickFromSampler(rand, samplingContract.initialStartSampler, minStartYearIndex);
    }
    const inputCapeForSampling = Number(inputs.capeRatio) > 0 ? Number(inputs.capeRatio) : Number(inputs.marketCapeRatio);
    if (useCapeSampling && inputCapeForSampling > 0) {
        const candidates = /** @type {import('../../../typcheck/rechenkern-integration').GetStartYearCandidates} */ (getStartYearCandidates)(inputCapeForSampling, annualData, 0.2, { fallbackToAll: false })
            .filter(year => !excludeEstimatedHistory || year >= ESTIMATED_HISTORY_CUTOFF_YEAR);
        if (candidates.length > 0) {
            const chosenYear = candidates[Math.floor(rand() * candidates.length)];
            const idx = annualData.findIndex(d => d.jahr === chosenYear);
            return idx === -1
                ? pickStartYearIndex(rand, annualData, null, minStartYearIndex)
                : idx;
        }
        return pickStartYearIndex(rand, annualData, null, minStartYearIndex);
    }

    return yearSamplingConfig?.allSampler
        ? pickFromSampler(rand, yearSamplingConfig.allSampler, minStartYearIndex)
        : pickStartYearIndex(rand, annualData, startYearCdf, minStartYearIndex);
}
