/** @import {Sampler,SamplingConfig,SamplingPublicContract,SamplingResolution,SamplingDiagnostics,HistoricalYear,SimulatorInputs,SimulationState,Random,StressContext} from '../../../typcheck/rechenkern' */

/** @param {number[]|null|undefined} indices
 * @param {Sampler|null|undefined} weightedSampler */
export function samplerFromIndices(indices, weightedSampler = null) {
    if (!Array.isArray(indices) || indices.length === 0) return null;
    if (weightedSampler?.indices?.length === indices.length
        && weightedSampler.indices.every((value, index) => value === indices[index])) {
        return weightedSampler;
    }
    return { indices: [...indices], cdf: null };
}

/** @param {Sampler|null|undefined} sampler */
function cloneSampler(sampler) {
    if (!sampler || !Array.isArray(sampler.indices)) return null;
    return {
        indices: [...sampler.indices],
        cdf: Array.isArray(sampler.cdf) ? [...sampler.cdf] : null
    };
}

/** @param {SamplingConfig|null|undefined} config */
export function cloneYearSamplingConfig(config) {
    if (!config) return null;
    return {
        ...config,
        allowedIndices: [...(config.allowedIndices || [])],
        allowedIndexSet: new Set(config.allowedIndexSet || []),
        allSampler: cloneSampler(config.allSampler),
        blockSampler: cloneSampler(config.blockSampler),
        blockStartIndices: [...(config.blockStartIndices || [])],
        regimeSamplers: Object.fromEntries(
            Object.entries(config.regimeSamplers || {})
                .map(([regime, sampler]) => [regime, cloneSampler(sampler)])
        ),
        weightsByIndex: [...(config.weightsByIndex || [])]
    };
}

/** @param {number[]|null|undefined} indices
 * @param {number[]|null|undefined} weightsByIndex */
export function buildCdfFromIndices(indices, weightsByIndex) {
    if (!Array.isArray(indices) || indices.length === 0) return null;
    let total = 0;
    for (const idx of indices) {
        const weight = weightsByIndex ? (weightsByIndex[idx] || 0) : 1;
        total += weight;
    }
    if (total <= 0) return null;
    let cumulative = 0;
    // CDF: monoton wachsend, letzter Wert wird auf 1 geklemmt.
    const cdf = indices.map(idx => {
        const weight = weightsByIndex ? (weightsByIndex[idx] || 0) : 1;
        cumulative += weight / total;
        return cumulative;
    });
    cdf[cdf.length - 1] = 1;
    return { indices, cdf };
}

/** @param {(()=>number)|null|undefined} rand
 * @param {Sampler|null|undefined} sampler */
export function pickFromSampler(rand, sampler, fallbackIndex = 0) {
    if (!sampler || !Array.isArray(sampler.indices) || sampler.indices.length === 0) {
        return fallbackIndex;
    }
    const sample = rand ? rand() : Math.random();
    const r = Math.min(1 - Number.EPSILON, Math.max(0, Number.isFinite(sample) ? sample : 0));
    if (!Array.isArray(sampler.cdf) || sampler.cdf.length !== sampler.indices.length) {
        const offset = Math.floor(r * sampler.indices.length);
        return sampler.indices[Math.min(sampler.indices.length - 1, offset)] ?? fallbackIndex;
    }
    // Binäre Suche im CDF für O(log n) Sampling.
    let low = 0;
    let high = sampler.cdf.length - 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (r < sampler.cdf[mid]) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    return sampler.indices[low] ?? fallbackIndex;
}
