/** @import {Sampler,SamplingConfig,SamplingPublicContract,SamplingResolution,SamplingDiagnostics,HistoricalYear,SimulatorInputs,SimulationState,Random,StressContext} from '../../../typcheck/rechenkern' */
import { MIN_START_YEAR_INDEX, START_YEAR_MODES } from './schema.js';
import { ESTIMATED_HISTORY_CUTOFF_YEAR } from '../simulator-data.js';
import { buildCdfFromIndices } from './samplers.js';

/** @param {HistoricalYear[]} data */
export function resolveMinStartYearIndex(data, excludeEstimatedHistory = false) {
    const safeFallback = Math.max(0, Math.min(MIN_START_YEAR_INDEX, data.length - 1));
    if (!excludeEstimatedHistory) return safeFallback;
    const idx = data.findIndex(entry => (entry?.jahr ?? 0) >= ESTIMATED_HISTORY_CUTOFF_YEAR);
    return idx >= 0 ? idx : safeFallback;
}

/** @param {string} mode
 * @param {HistoricalYear[]} data
 * @returns {SamplingConfig|null} */
export function buildYearSamplingConfig(mode, data, { startYearFilter = 1970, startYearHalfLife = 20, blockSize = 1, excludeEstimatedHistory = false } = {}) {
    if (!Array.isArray(data) || data.length === 0) return null;

    const cutoff = Number.isFinite(startYearFilter) ? startYearFilter : 1970;
    const halfLife = Number.isFinite(startYearHalfLife) && startYearHalfLife > 0 ? startYearHalfLife : 20;
    const minStartIndex = resolveMinStartYearIndex(data, excludeEstimatedHistory);
    // Recency-Mode: Exponentielles Abklingen mit Halbwertszeit (halfLife).
    const currentYear = data[data.length - 1]?.jahr ?? new Date().getFullYear();

    const allowedIndices = [];
    const weightsByIndex = new Array(data.length).fill(0);
    for (let i = minStartIndex; i < data.length; i++) {
        const year = data[i].jahr;
        if (excludeEstimatedHistory && year < ESTIMATED_HISTORY_CUTOFF_YEAR) continue;
        if (mode === 'FILTER' && year < cutoff) continue;
        allowedIndices.push(i);
        if (mode === 'RECENCY') {
            const age = currentYear - year;
            weightsByIndex[i] = Math.pow(0.5, age / halfLife);
        } else {
            weightsByIndex[i] = 1;
        }
    }

    if (allowedIndices.length === 0) return null;

    const allowedIndexSet = new Set(allowedIndices);
    const allSampler = (mode === 'FILTER' || mode === 'RECENCY')
        ? buildCdfFromIndices(allowedIndices, weightsByIndex)
        : null;

    // Block-Sampling: Der letzte Index data.length - blockSize ist noch ein
    // vollstaendiger Blockstart und muss deshalb eingeschlossen bleiben.
    const normalizedBlockSize = Math.max(1, Math.round(Number(blockSize) || 1));
    const maxStartIndex = data.length - normalizedBlockSize;
    const blockStartIndices = allowedIndices.filter(idx => idx <= maxStartIndex);
    const blockSampler = (mode === 'FILTER' || mode === 'RECENCY')
        ? buildCdfFromIndices(blockStartIndices, weightsByIndex)
        : null;

    const regimeSamplers = /** @type {Record<string,number[]>} */ ({});
    for (const idx of allowedIndices) {
        const regime = data[idx].regime;
        if (!regimeSamplers[regime]) regimeSamplers[regime] = [];
        regimeSamplers[regime].push(idx);
    }
    const regimeSamplerMap = /** @type {Record<string,Sampler|null>} */ ({});
    for (const [regime, indices] of Object.entries(regimeSamplers)) {
        regimeSamplerMap[regime] = (mode === 'FILTER' || mode === 'RECENCY')
            ? buildCdfFromIndices(indices, weightsByIndex)
            : { indices, cdf: null };
    }

    return {
        mode: START_YEAR_MODES.has(mode) ? mode : 'UNIFORM',
        allowedIndices,
        allowedIndexSet,
        allSampler,
        blockSampler,
        blockStartIndices,
        maxStartIndex,
        regimeSamplers: regimeSamplerMap,
        weightsByIndex
    };
}

/** @param {string} mode
 * @param {HistoricalYear[]} data */
export function buildStartYearCdf(mode, data, { startYearFilter = 1970, startYearHalfLife = 20, excludeEstimatedHistory = false } = {}) {
    if (!Array.isArray(data) || data.length === 0) return null;
    if (mode !== 'FILTER' && mode !== 'RECENCY') return null;

    const currentYear = data[data.length - 1]?.jahr ?? new Date().getFullYear();
    const halfLife = Number.isFinite(startYearHalfLife) && startYearHalfLife > 0 ? startYearHalfLife : 20;
    const cutoff = Number.isFinite(startYearFilter) ? startYearFilter : 1970;
    const minStartIndex = resolveMinStartYearIndex(data, excludeEstimatedHistory);

    const weights = data.map((entry, index) => {
        if (index < minStartIndex) return 0;
        if (excludeEstimatedHistory && entry.jahr < ESTIMATED_HISTORY_CUTOFF_YEAR) return 0;
        if (mode === 'FILTER') {
            return entry.jahr >= cutoff ? 1 : 0;
        }
        const age = currentYear - entry.jahr;
        return Math.pow(0.5, age / halfLife);
    });

    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    if (totalWeight <= 0) return null;

    let cumulative = 0;
    const cdf = weights.map(weight => {
        cumulative += weight / totalWeight;
        return cumulative;
    });
    cdf[cdf.length - 1] = 1;
    return cdf;
}
