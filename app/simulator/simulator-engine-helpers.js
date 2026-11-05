/**
 * Module: Simulator Engine Helpers
 * Purpose: Shared helper functions for the simulation engine.
 *          Handles MC initialization, market data preparation, care logic updates, and statistics.
 * Usage: Imported by simulator-engine-direct.js and simulator-engine-wrapper.js.
 * Dependencies: simulator-data.js, simulator-portfolio.js
 */
"use strict";

import { HISTORICAL_DATA, PFLEGE_GRADE_PROBABILITIES, PFLEGE_GRADE_LABELS, PFLEGE_GRADE_PROGRESSION_PROBABILITIES, SUPPORTED_PFLEGE_GRADES, annualData, REGIME_DATA, REGIME_TRANSITIONS, MORTALITY_TABLE, simulatorDataContractError } from './simulator-data.js';
import { initializePortfolio, prepareHistoricalData } from './simulator-portfolio.js';
import { estimateRemainingLifeYears } from '../shared/life-expectancy.js';
import { CARE_FLEX_DEFAULT_PERCENT, CARE_MORTALITY_DEFAULT_FACTORS } from './simulator-care-flex.js';
import { PFLEGE_GRADE_PROBABILITIES_BY_SEX } from './simulator-data.js';
import {
    assertRuntimeCumulativeInflationFactor,
    resolveRuntimeCumulativeInflationFactor
} from '../../types/cumulative-inflation-contract.js';

let historicalDataPrepared = false;
export const SIMULATOR_INFLATION_RATE_ERROR_CODE = 'SIMULATOR_INFLATION_RATE_INVALID';

export class SimulatorInflationRateError extends RangeError {
    constructor(value, path = 'inflationPct') {
        super(`${path} muss als endliche Zahl vorliegen.`);
        this.name = 'SimulatorInflationRateError';
        this.code = SIMULATOR_INFLATION_RATE_ERROR_CODE;
        this.path = path;
        this.value = value;
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function hasOwn(value, key) {
    return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Resolves the simulator-owned cumulative inflation factor.
 * The top-level simulator state is canonical; the nested Engine state remains
 * a compatibility fallback for states created before the simulator contract.
 *
 * @param state Zustand des Simulationspfads.
 * @returns {number} Ergebnis der Operation.
 */
export function resolveSimulatorCumulativeInflationFactor(state) {
    if (hasOwn(state, 'cumulativeInflationFactor') && state.cumulativeInflationFactor !== undefined) {
        return assertRuntimeCumulativeInflationFactor(state.cumulativeInflationFactor, {
            path: 'simulatorState.cumulativeInflationFactor'
        });
    }
    if (hasOwn(state?.lastState, 'cumulativeInflationFactor')
        && state.lastState.cumulativeInflationFactor !== undefined) {
        return assertRuntimeCumulativeInflationFactor(state.lastState.cumulativeInflationFactor, {
            path: 'simulatorState.lastState.cumulativeInflationFactor'
        });
    }

    return 1;
}

/**
 * Advances the factor for the next simulator year exactly once.
 * Missing inflation data keeps the current valid factor. Present values must
 * already use the canonical numeric runtime contract.
 *
 * @param currentFactor
 * @param inflationPct
 * @returns {number} Ergebnis der Operation.
 */
export function advanceSimulatorCumulativeInflationFactor(currentFactor, inflationPct) {
    const current = resolveRuntimeCumulativeInflationFactor(currentFactor, {
        path: 'currentCumulativeInflationFactor'
    });
    if (inflationPct === undefined) return current;
    if (typeof inflationPct !== 'number' || !Number.isFinite(inflationPct)) {
        throw new SimulatorInflationRateError(inflationPct);
    }

    const annualFactor = 1 + (inflationPct / 100);
    const next = current * annualFactor;
    return assertRuntimeCumulativeInflationFactor(next, {
        path: 'nextCumulativeInflationFactor'
    });
}

/**
 * @returns {void}
 */
export function prepareHistoricalDataOnce() {
    if (historicalDataPrepared) return;
    prepareHistoricalData();
    historicalDataPrepared = true;
}

function stableStringify(value) {
    const stringify = (val) => {
        if (val === null) return 'null';
        const type = typeof val;
        if (type === 'number') {
            if (Number.isNaN(val)) return '"__NaN__"';
            if (val === Infinity) return '"__Infinity__"';
            if (val === -Infinity) return '"__-Infinity__"';
            return JSON.stringify(val);
        }
        if (type === 'string') return JSON.stringify(val);
        if (type === 'boolean') return val ? 'true' : 'false';
        if (type === 'undefined') return '"__undefined__"';
        if (Array.isArray(val)) {
            return `[${val.map(stringify).join(',')}]`;
        }
        if (type === 'object') {
            const keys = Object.keys(val).sort();
            return `{${keys.map(k => `${JSON.stringify(k)}:${stringify(val[k])}`).join(',')}}`;
        }
        return JSON.stringify(String(val));
    };
    return stringify(value);
}

function hashString(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
}

/**
 * @param inputs Wirksame Simulationseingaben.
 * @param widowOptions
 * @param methode
 * @param useCapeSampling
 * @param stressPreset
 * @returns Ergebnis der Operation.
 */
export function compileScenario(inputs, widowOptions, methode, useCapeSampling, stressPreset) {
    const payload = { inputs, widowOptions, methode, useCapeSampling, stressPreset };
    const key = hashString(stableStringify(payload));
    return {
        scenarioKey: key,
        compiledScenario: payload
    };
}

/**
 * @returns Ergebnis der Operation.
 */
export function getDataVersion() {
    return {
        annualDataHash: hashString(stableStringify(annualData)),
        regimeHash: hashString(stableStringify(REGIME_TRANSITIONS))
    };
}

/**
 * @param yearData Historische Jahresdaten.
 * @param inputs Wirksame Simulationseingaben.
 * @param marketDataHist
 * @returns {number} Ergebnis der Operation.
 */
export function resolveMonteCarloCape(yearData, inputs, marketDataHist) {
    const yearCape = Number(yearData?.capeRatio ?? yearData?.cape);
    if (Number.isFinite(yearCape) && yearCape > 0) return yearCape;
    const inputCape = Number(inputs?.capeRatio);
    if (Number.isFinite(inputCape) && inputCape > 0) return inputCape;
    const legacyCape = Number(inputs?.marketCapeRatio);
    if (Number.isFinite(legacyCape) && legacyCape > 0) return legacyCape;
    const histCape = Number(marketDataHist?.capeRatio);
    if (Number.isFinite(histCape) && histCape > 0) return histCape;
    return 0;
}

/**
 * Hilfsfunktion für CAPE-Ratio Resolution
 */
function resolveCapeRatio(yearSpecificCape, inputCape, historicalCape) {
    if (typeof yearSpecificCape === 'number' && Number.isFinite(yearSpecificCape) && yearSpecificCape > 0) {
        return yearSpecificCape;
    }
    if (typeof inputCape === 'number' && Number.isFinite(inputCape) && inputCape > 0) {
        return inputCape;
    }
    if (typeof historicalCape === 'number' && Number.isFinite(historicalCape) && historicalCape > 0) {
        return historicalCape;
    }
    return 0;
}

/**
 * Initialisiert den Startzustand für einen Monte-Carlo-Lauf
 *
 * @param inputs Wirksame Simulationseingaben.
 * @param startYearIndex
 * @returns Ergebnis der Operation.
 */
export function initMcRunState(inputs, startYearIndex) {
    const startPortfolio = initializePortfolio(inputs);

    const histYears = Object.keys(HISTORICAL_DATA).map(Number).sort((a, b) => a - b);
    const minIndex = 4;
    const maxIndex = Math.max(minIndex, annualData.length - 1);
    const rawIndex = Number.isFinite(startYearIndex) ? Math.round(startYearIndex) : minIndex;
    const effectiveIndex = Math.min(maxIndex, Math.max(minIndex, rawIndex));
    // Startjahr wird aus den historischen Daten gezogen (Index stabilisiert).
    const startJahr = annualData[effectiveIndex].jahr;

    const marketDataHist = {
        endeVJ: HISTORICAL_DATA[startJahr - 1]?.global_equity_research_index || 1000,
        endeVJ_1: HISTORICAL_DATA[startJahr - 2]?.global_equity_research_index || 1000,
        endeVJ_2: HISTORICAL_DATA[startJahr - 3]?.global_equity_research_index || 1000,
        endeVJ_3: HISTORICAL_DATA[startJahr - 4]?.global_equity_research_index || 1000,
        ath: 0,
        jahreSeitAth: 0,
        inflation: HISTORICAL_DATA[startJahr - 1]?.inflation_de || 2.0,
        capeRatio: resolveCapeRatio(undefined, inputs.marketCapeRatio, 0)
    };

    // ATH-Bestimmung über alle Jahre vor Startjahr.
    const pastValues = histYears.filter(y => y < startJahr).map(y => HISTORICAL_DATA[y].global_equity_research_index);
    marketDataHist.ath = pastValues.length > 0 ? Math.max(...pastValues, marketDataHist.endeVJ) : marketDataHist.endeVJ;
    if (marketDataHist.endeVJ < marketDataHist.ath) {
        let lastAthYear = Math.max(...histYears.filter(y => y < startJahr && HISTORICAL_DATA[y].global_equity_research_index >= marketDataHist.ath));
        marketDataHist.jahreSeitAth = (startJahr - 1) - lastAthYear;
    }

    // Ansparphase-Tracking (vor Ruhestand) optional.
    const accumulationState = initialAccumulationState(inputs);

    return {
        portfolio: startPortfolio,
        cumulativeInflationFactor: 1,
        baseFloor: inputs.startFloorBedarf,
        baseFlex: inputs.startFlexBedarf,
        baseMinimumFlexAnnual: inputs.minimumFlexAnnual || 0,
        baseFlexBudgetAnnual: inputs.flexBudgetAnnual || 0,
        baseFlexBudgetRecharge: inputs.flexBudgetRecharge || 0,
        lastState: { taxState: { lossCarry: 0 } },
        // Initialisiere mit Eingabewert (Jahresbasis), damit Indexierung ab Jahr 0 starten kann
        currentAnnualPension: (inputs.renteMonatlich || 0) * 12,
        currentAnnualPension2: (inputs.partner?.brutto || 0),
        marketDataHist: marketDataHist,
        samplerState: {},
        widowPensionP1: 0,
        widowPensionP2: 0,
        accumulationState,
        transitionYear: inputs.transitionYear || 0
    };
}

// Bestehende Importpfade bleiben erhalten.
export { estimateRemainingLifeYears, estimateJointRemainingLifeYears,
    estimateSingleRemainingLifeYearsAtQuantile, estimateJointRemainingLifeYearsAtQuantile
} from '../shared/life-expectancy.js';

/**
 * Erstellt ein Standard-Pflege-Metadata-Objekt
 *
 * @param enabled
 * @param {string} [personGender]
 * @param [careToday]
 * @param {number} [startAge]
 * @param [inputs] Wirksame Simulationseingaben.
 * @returns Ergebnis der Operation.
 */
export function makeDefaultCareMeta(enabled, personGender = 'm', careToday = null, startAge = -1, inputs = {}) {
    const initialGrade = Number(careToday?.grade) || 0;
    if (!enabled && !initialGrade) return null;
    const care = {
        active: false,
        triggered: false,
        startAge: -1,
        durationYears: 0,
        currentYearInCare: 0,
        zusatzFloorZiel: 0,
        zusatzFloorDelta: 0,
        flexFactor: 1.0,
        kumulierteKosten: 0,
        floorAtTrigger: 0,
        flexAtTrigger: 0,
        maxFloorAtTrigger: 0,
        grade: null,
        gradeLabel: '',
        mortalityFactor: 0,
        personGender
    };
    if (initialGrade) {
        const config = resolveGradeConfig(inputs, initialGrade);
        Object.assign(care, { active: true, triggered: true, startAge,
            grade: initialGrade, gradeLabel: PFLEGE_GRADE_LABELS[initialGrade],
            mortalityFactor: config.mortalityFactor, flexFactor: 1,
            initialGrade,
            initialProgressionFactor: careToday.progression === 'slower' ? .5 : careToday.progression === 'much_slower' ? .25 : 1 });
    }
    return care;
}

/** Beendet auch die Diagnosewerte, sobald die Person verstorben ist.
 *
 * @param care
 * @param alive
 * @returns {void}
 */
export function endCareForDeceased(care, alive) {
    if (!care || alive) return;
    const personGender = care.personGender;
    for (const key of Object.keys(care)) delete care[key];
    Object.assign(care, makeDefaultCareMeta(true, personGender));
}

function pickIndexFromSampler(rand, sampler, fallbackIndex = 0) {
    if (sampler && Array.isArray(sampler.indices) && sampler.indices.length > 0) {
        if (Array.isArray(sampler.cdf) && sampler.cdf.length === sampler.indices.length) {
            const r = Math.min(1 - Number.EPSILON, Math.max(0, rand()));
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
            return sampler.indices[low];
        }
        return sampler.indices[Math.floor(rand() * sampler.indices.length)];
    }
    return fallbackIndex;
}

/**
 * Wählt Marktdaten für das nächste Jahr gemäß der MC-Methode aus
 *
 * @param state Zustand des Simulationspfads.
 * @param methode
 * @param blockSize
 * @param rand
 * @param stressCtx
 * @returns Ergebnis der Operation.
 */
export function sampleNextYearData(state, methode, blockSize, rand, stressCtx) {
    if (!Array.isArray(annualData) || annualData.length === 0) {
        throw simulatorDataContractError(
            'SIMULATOR_HISTORICAL_DATA_UNAVAILABLE',
            'Cannot sample a market year without canonical historical data.'
        );
    }
    const samplerState = state.samplerState;
    const yearSampling = samplerState?.yearSampling || null;
    const allowedIndexSet = yearSampling?.allowedIndexSet || null;

    if (stressCtx && stressCtx.type === 'conditional_bootstrap' && stressCtx.remainingYears > 0) {
        const pickable = Array.isArray(stressCtx.pickableIndices) ? stressCtx.pickableIndices : [];
        const filteredPickable = allowedIndexSet
            ? pickable.filter(idx => allowedIndexSet.has(idx))
            : pickable;
        const pool = filteredPickable;
        if (pool.length === 0) {
            throw simulatorDataContractError(
                'SIMULATOR_STRESS_EFFECTIVE_POOL_EMPTY',
                'The stress preset has no observations in the effective sampling universe.'
            );
        }
        const minimumDistinctYears = Math.max(1, Number(stressCtx.minimumDistinctYears) || 1);
        if (pool.length < minimumDistinctYears) {
            throw simulatorDataContractError(
                'SIMULATOR_STRESS_EFFECTIVE_POOL_TOO_SMALL',
                `The effective stress pool requires at least ${minimumDistinctYears} distinct observations.`
            );
        }
        const randomIndex = Math.floor(rand() * pool.length);
        const chosenYearIndex = pool[randomIndex];
        return { ...annualData[chosenYearIndex] };
    }

    if (methode === 'block') {
        if (!samplerState.blockStartIndex || samplerState.yearInBlock >= blockSize) {
            if (yearSampling?.blockSampler) {
                samplerState.blockStartIndex = pickIndexFromSampler(rand, yearSampling.blockSampler, 0);
            } else if (Array.isArray(yearSampling?.blockStartIndices) && yearSampling.blockStartIndices.length > 0) {
                const indices = yearSampling.blockStartIndices;
                samplerState.blockStartIndex = indices[Math.floor(rand() * indices.length)];
            } else {
                const maxIndex = annualData.length - blockSize;
                samplerState.blockStartIndex = Math.floor(rand() * maxIndex);
            }
            samplerState.yearInBlock = 0;
        }
        const data = annualData[samplerState.blockStartIndex + samplerState.yearInBlock];
        samplerState.yearInBlock++;
        return { ...data };
    }

    let regime;
    if (methode === 'regime_iid') {
        const regimes = Object.keys(REGIME_DATA);
        // Häufigkeiten stammen aus denselben Jahrespools wie die anschließende Ziehung.
        // CAPE-/Recency-Gewichte innerhalb eines Pools bleiben unverändert.
        const counts = regimes.map(key => yearSampling
            ? (yearSampling.regimeSamplers?.[key]?.indices?.length || 0)
            : REGIME_DATA[key].length);
        const total = counts.reduce((sum, count) => sum + count, 0);
        if (total === 0) {
            throw simulatorDataContractError(
                'SIMULATOR_REGIME_POOL_EMPTY',
                'No observations exist in the effective regime sampling universe.'
            );
        }
        let remaining = rand() * total;
        for (let i = 0; i < regimes.length; i++) {
            if (remaining < counts[i]) {
                regime = regimes[i];
                break;
            }
            remaining -= counts[i];
        }
    } else {
        if (!samplerState.currentRegime) {
            if (yearSampling?.allSampler) {
                const initialIndex = pickIndexFromSampler(rand, yearSampling.allSampler, 0);
                samplerState.currentRegime = annualData[initialIndex].regime;
            } else if (Array.isArray(yearSampling?.allowedIndices) && yearSampling.allowedIndices.length > 0) {
                const indices = yearSampling.allowedIndices;
                samplerState.currentRegime = annualData[indices[Math.floor(rand() * indices.length)]].regime;
            } else {
                samplerState.currentRegime = annualData[Math.floor(rand() * annualData.length)].regime;
            }
        }

        const transitions = REGIME_TRANSITIONS[samplerState.currentRegime];
        if (!transitions || !Number.isFinite(transitions.total) || transitions.total <= 0) {
            throw simulatorDataContractError(
                'SIMULATOR_REGIME_TRANSITIONS_INVALID',
                `No usable transitions exist for regime ${String(samplerState.currentRegime)}.`
            );
        }
        const r = rand();
        let cumulativeProb = 0;
        let nextRegime = null;
        for (const [targetRegime, count] of Object.entries(transitions)) {
            if (targetRegime === 'total') continue;
            cumulativeProb += (count / transitions.total);
            if (r <= cumulativeProb) {
                nextRegime = targetRegime;
                break;
            }
        }
        if (!nextRegime) {
            throw simulatorDataContractError(
                'SIMULATOR_REGIME_TRANSITION_SELECTION_FAILED',
                `Transition counts do not reconcile for regime ${String(samplerState.currentRegime)}.`
            );
        }
        regime = nextRegime;
        samplerState.currentRegime = nextRegime;
    }

    const samplerForRegime = yearSampling?.regimeSamplers?.[regime];
    if (samplerForRegime && Array.isArray(samplerForRegime.indices) && samplerForRegime.indices.length > 0) {
        const idx = pickIndexFromSampler(rand, samplerForRegime, samplerForRegime.indices[0]);
        return { ...annualData[idx] };
    }

    if (yearSampling) {
        throw simulatorDataContractError(
            'SIMULATOR_REGIME_POOL_EMPTY',
            `No observation for regime ${String(regime)} exists in the effective sampling universe.`
        );
    }

    const possibleYears = REGIME_DATA[regime];
    if (!Array.isArray(possibleYears) || possibleYears.length === 0) {
        throw simulatorDataContractError(
            'SIMULATOR_REGIME_POOL_EMPTY',
            `No canonical historical observations exist for regime ${String(regime)}.`
        );
    }
    const chosenYear = possibleYears[Math.floor(rand() * possibleYears.length)];
    return { ...chosenYear };
}

/**
 * Berechnet Volatilität und maximalen Drawdown aus einer Serie
 *
 * @param series
 * @returns Ergebnis der Operation.
 */
export function computeRunStatsFromSeries(series) {
    if (!Array.isArray(series) || series.length < 2) {
        return { volPct: 0, maxDDpct: 0 };
    }
    const returns = [];
    for (let i = 1; i < series.length; i++) {
        const prev = series[i - 1] || 0;
        const cur = series[i] || 0;
        const r = (prev > 0 && isFinite(prev) && isFinite(cur)) ? (cur / prev - 1) : 0;
        returns.push(r);
    }
    const mu = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length > 1 ? returns.reduce((s, x) => s + (x - mu) * (x - mu), 0) / (returns.length - 1) : 0;
    const volPct = Math.sqrt(Math.max(variance, 0)) * 100;

    let peak = series[0];
    let maxDD = 0;
    for (let i = 1; i < series.length; i++) {
        peak = Math.max(peak, series[i]);
        if (peak > 0) {
            const dd = (series[i] - peak) / peak;
            if (isFinite(dd)) maxDD = Math.min(maxDD, dd);
        }
    }
    const maxDDpct = Math.abs(maxDD) * 100;
    return { volPct, maxDDpct };
}

/**
 * Berechnet die Pflege-Zusatzkosten für Floor und Flex
 *
 * @param careMetaP1
 * @param [careMetaP2]
 * @returns Ergebnis der Operation.
 */
export function calcCareCost(careMetaP1, careMetaP2 = null) {
    let zusatzFloor = 0;
    let flexFactor = 1.0;

    if (careMetaP1?.active) {
        zusatzFloor += careMetaP1.zusatzFloorZiel || 0;
        flexFactor = Math.min(flexFactor, careMetaP1.flexFactor || 1.0);
    }

    if (careMetaP2?.active) {
        zusatzFloor += careMetaP2.zusatzFloorZiel || 0;
        flexFactor = Math.min(flexFactor, careMetaP2.flexFactor || 1.0);
    }

    return { zusatzFloor, flexFactor };
}

/**
 * Computes the effective household flex factor by splitting the flex budget across
 * all living persons and only cutting the portion that belongs to the person in care.
 *
 * @param {object} options
 * @param options.hasPartner
 * @param options.p1Alive
 * @param options.careMetaP1
 * @param options.p2Alive
 * @param options.careMetaP2
 * @returns {number} Ergebnis der Operation.
 */
export function computeHouseholdFlexFactor({
    hasPartner,
    p1Alive,
    careMetaP1,
    p2Alive,
    careMetaP2
}) {
    const f1 = p1Alive ? resolveIndividualFlexFactor(careMetaP1) : 0.0;

    if (hasPartner !== true) {
        return f1;
    }

    const f2 = p2Alive ? resolveIndividualFlexFactor(careMetaP2) : 0.0;
    const householdFactor = (0.5 * Math.max(f1, f2)) + (0.25 * f1) + (0.25 * f2);
    return householdFactor;
}

function resolveIndividualFlexFactor(careMeta) {
    if (!careMeta || !careMeta.active) {
        return 1.0;
    }
    const rawFactor = careMeta.flexFactor;
    if (typeof rawFactor !== 'number' || !Number.isFinite(rawFactor)) {
        return 1.0;
    }
    return Math.min(1, Math.max(0, rawFactor));
}

const CARE_PROBABILITY_BUCKETS = Object.keys(PFLEGE_GRADE_PROBABILITIES).map(Number).sort((a, b) => a - b);

/**
 * Berechnet den Mortalitäts-Multiplikator während eines Pflegefalls.
 *
 * @param careMeta
 * @returns {number} Ergebnis der Operation.
 */
export function computeCareMortalityMultiplier(careMeta) {
    if (!careMeta?.active) {
        return 1;
    }

    const factor = Math.max(1, Number(careMeta.mortalityFactor) || 0);
    return careMeta.initialGrade && careMeta.initialGrade === careMeta.grade
        ? 1 + (factor - 1) * careMeta.initialProgressionFactor : factor;
}

function resolveCareAgeBucket(age) {
    const numericAge = Number(age);
    if (!Number.isFinite(numericAge)) {
        return CARE_PROBABILITY_BUCKETS[0];
    }

    let bucket = CARE_PROBABILITY_BUCKETS[0];
    for (const candidate of CARE_PROBABILITY_BUCKETS) {
        if (numericAge >= candidate) {
            bucket = candidate;
        } else {
            break;
        }
    }
    return bucket;
}

function sampleCareGrade(age, rand, gender) {
    const minBucket = CARE_PROBABILITY_BUCKETS[0];
    if (age < minBucket) {
        return null;
    }

    const bucket = resolveCareAgeBucket(age);
    const probabilities = (PFLEGE_GRADE_PROBABILITIES_BY_SEX[gender] || PFLEGE_GRADE_PROBABILITIES_BY_SEX.d)[bucket];
    if (!probabilities) return null;

    const INITIAL_ENTRY_GRADES = [1, 2];

    const totalProbability = INITIAL_ENTRY_GRADES.reduce((sum, grade) => sum + (probabilities[grade] || 0), 0);
    if (totalProbability <= 0) return null;

    const roll = rand();
    if (roll > totalProbability) {
        return null;
    }

    let cumulative = 0;
    for (const grade of INITIAL_ENTRY_GRADES) {
        const gradeProbability = probabilities[grade] || 0;
        cumulative += gradeProbability;
        if (roll <= cumulative) {
            return { grade, bucket, gradeProbability, totalProbability };
        }
    }
    return null;
}

function normalizeGradeConfig(config, grade) {
    const zusatz = Math.max(0, Number(config?.zusatz) || 0);
    const rawFlex = config?.flexCut;
    const flexCut = Math.min(1, Math.max(0, Number.isFinite(rawFlex) ? rawFlex : CARE_FLEX_DEFAULT_PERCENT[grade] / 100));
    const rawMortality = Number(config?.mortalityFactor);
    const mortalityFactor = Math.max(0, Number.isFinite(rawMortality) ? rawMortality : CARE_MORTALITY_DEFAULT_FACTORS[grade]);
    return { zusatz, flexCut, mortalityFactor };
}

function resolveGradeConfig(inputs, grade) {
    const configs = inputs?.pflegeGradeConfigs;
    if (configs && configs[grade]) {
        return normalizeGradeConfig(configs[grade], grade);
    }
    if (configs) {
        for (const fallbackGrade of SUPPORTED_PFLEGE_GRADES) {
            if (configs[fallbackGrade]) {
                return normalizeGradeConfig(configs[fallbackGrade], grade);
            }
        }
    }
    return normalizeGradeConfig({
        zusatz: inputs?.pflegeStufe1Zusatz,
        flexCut: inputs?.pflegeStufe1FlexCut,
        mortalityFactor: inputs?.pflegeStufe1Mortality
    }, grade);
}

/**
 * Aktualisiert Pflege-Metadaten inklusive grad-spezifischer Kosten.
 * Wie beim Grundbedarf enthält Jahr 0 noch keine Preisfortschreibung.
 * currentState liefert die kumulierte Inflation und die laufenden Bedarfsanker;
 * yearIndex zählt Jahre seit Simulationsstart, currentYearInCare nur die Rampe.
 * Bei deferPricing folgt priceCareMeta nach den Todesziehungen, vor der Jahresrechnung.
 *
 * @param care
 * @param inputs Wirksame Simulationseingaben.
 * @param age
 * @param yearData Historische Jahresdaten.
 * @param rand
 * @param [currentState] Zustand zu Jahresbeginn.
 * @param {number} [yearIndex] Nullbasierter Index des Simulationsjahrs.
 * @param {boolean} [deferPricing]
 * @returns Ergebnis der Operation.
 */
export function updateCareMeta(care, inputs, age, yearData, rand, currentState = {}, yearIndex = 0, deferPricing = false) {
    if (!care || (!inputs.pflegefallLogikAktivieren && !care.initialGrade)) return care;

    if (care.active) {
        if (!care.initialGrade && inputs.pflegeModellTyp === 'akut' && care.currentYearInCare >= care.durationYears) {
            care.active = false;
            care.zusatzFloorDelta = 0;
            care.grade = null;
            care.gradeLabel = '';
            return care;
        }

        if (!care.grade) {
            care.grade = SUPPORTED_PFLEGE_GRADES[0];
            care.gradeLabel = PFLEGE_GRADE_LABELS[care.grade] || `Pflegegrad ${care.grade}`;
        }

        const currentGrade = care.grade;
        // FR-45: Der angenommene Verlauf gilt auch nach einem Gradwechsel.
        const progressionProb = (PFLEGE_GRADE_PROGRESSION_PROBABILITIES[currentGrade] || 0)
            * (care.initialGrade ? care.initialProgressionFactor : 1);

        const canProgressThisYear = (care.currentYearInCare || 0) >= 1;
        // Heutige Pflege: genau eine Fortschrittsziehung je Folgejahr, auch
        // nach Erreichen von PG5. Die Verlaufswahl verbraucht keine Extraziehung.
        const progressionRoll = canProgressThisYear && (currentGrade < 5 || care.initialGrade) ? rand() : 1;
        if (canProgressThisYear && currentGrade < 5 && progressionRoll < progressionProb) {
            const newGrade = currentGrade + 1;
            care.grade = newGrade;
            care.gradeLabel = PFLEGE_GRADE_LABELS[newGrade] || `Pflegegrad ${newGrade}`;
        }

        const gradeConfig = resolveGradeConfig(inputs, care.grade);
        care.mortalityFactor = gradeConfig.mortalityFactor || 0;
        // Das Pflegejahr zählt nur für Dauer und Kostenrampe (FR-41).
        care.currentYearInCare += 1;
        if (!deferPricing) priceCareMeta(care, inputs, currentState, yearIndex);

        return care;
    }

    if (!care.triggered) {
        const sampledGrade = sampleCareGrade(age, rand, care.personGender || inputs.geschlecht);

        if (sampledGrade) {
            care.triggered = true;
            care.active = true;
            care.startAge = age;
            care.currentYearInCare = 0;
            care.grade = sampledGrade.grade;
            care.gradeLabel = PFLEGE_GRADE_LABELS[sampledGrade.grade] || `Pflegegrad ${sampledGrade.grade}`;
            const gradeConfig = resolveGradeConfig(inputs, care.grade);
            care.mortalityFactor = gradeConfig.mortalityFactor || 0;

            if (inputs.pflegeModellTyp === 'akut') {
                const min = inputs.pflegeMinDauer, max = inputs.pflegeMaxDauer;
                care.durationYears = Math.floor(rand() * (max - min + 1)) + min;
            } else {
                const genderForCalc = care.personGender || inputs?.geschlecht || 'm';
                care.durationYears = estimateRemainingLifeYears(genderForCalc, age);
            }

            care.log_grade_bucket = sampledGrade.bucket;
            care.log_grade_probability = sampledGrade.gradeProbability;
            care.log_grade_totalProbability = sampledGrade.totalProbability;

            return updateCareMeta(care, inputs, age, yearData, rand, currentState, yearIndex, deferPricing);
        }
    }

    return care;
}

/** Berechnet nach den Todesereignissen die Preise des bereits gezählten Pflegejahrs.
 *
 * @param care
 * @param inputs Wirksame Simulationseingaben.
 * @param [currentState] Zustand zu Jahresbeginn.
 * @param {number} [yearIndex] Nullbasierter Index des Simulationsjahrs.
 * @param {number} [floorFactor]
 * @returns Ergebnis der Operation.
 */
export function priceCareMeta(care, inputs, currentState = {}, yearIndex = 0, floorFactor = 1) {
    if (!care?.active || (!inputs.pflegefallLogikAktivieren && !care.initialGrade)) return care;
    const gradeConfig = resolveGradeConfig(inputs, care.grade);
    const careYearIndex = care.currentYearInCare;
    // Input readers normalize the persisted/UI percentage exactly once.
    // Runner and worker contracts transport this ratio without rescaling.
    const driftFactor = inputs.pflegeKostenDrift;
    const cumulativeInflationFactor = resolveSimulatorCumulativeInflationFactor(currentState);
    const carePriceFactor = cumulativeInflationFactor * Math.pow(1 + driftFactor, yearIndex);
    const regionalMultiplier = 1 + Math.max(0, inputs?.pflegeRegionalZuschlag || 0);

    const floorAtTriggerAdjusted = (currentState.baseFloor ?? inputs.startFloorBedarf) * floorFactor;
    const flexAtTriggerAdjusted = currentState.baseFlex ?? inputs.startFlexBedarf;
    const maxFloorAdjusted = inputs.pflegeMaxFloor * carePriceFactor;

    if (careYearIndex === 1) {
        care.floorAtTrigger = floorAtTriggerAdjusted;
        care.flexAtTrigger = flexAtTriggerAdjusted;
        care.maxFloorAtTrigger = maxFloorAdjusted;
    }

    const capZusatz = Math.max(0, maxFloorAdjusted - floorAtTriggerAdjusted);

    // FR-45: heutige Pflege steckt bereits in Grundbedarf/Flex. Erst ein höherer Grad ergänzt die volle Staffel.
    const additionalAnnual = care.initialGrade && care.initialGrade === care.grade && !care.familyCareFallback ? 0 : gradeConfig.zusatz;
    const zielRoh = additionalAnnual * carePriceFactor * regionalMultiplier;
    const cappedZiel = Math.min(capZusatz, zielRoh);
    const needsRamp = (zielRoh > capZusatz) && capZusatz > 0;
    let zusatzFloorZielFinal = cappedZiel;
    if (needsRamp) {
        const rampYears = Math.max(1, inputs.pflegeRampUp);
        const rampUpFactor = Math.min(1.0, careYearIndex / rampYears);
        const rampedTarget = Math.min(capZusatz, zielRoh * rampUpFactor);
        zusatzFloorZielFinal = rampedTarget;
    }

    const zusatzFloorDelta = Math.max(0, zusatzFloorZielFinal - care.zusatzFloorZiel);
    care.zusatzFloorDelta = zusatzFloorDelta;
    care.zusatzFloorZiel = zusatzFloorZielFinal;
    // Der eingetragene Flex enthält die heutige Pflege bereits. Weitere
    // Kürzungen beziehen sich auf diesen Ausgangszustand (FR-45).
    const initialFlex = care.initialGrade ? resolveGradeConfig(inputs, care.initialGrade).flexCut : 1;
    care.flexFactor = initialFlex > 0 ? Math.min(1, gradeConfig.flexCut / initialFlex) : 1;

    const flexVerlust = flexAtTriggerAdjusted * (1 - care.flexFactor);
    care.kumulierteKosten += zusatzFloorDelta + flexVerlust;

    care.log_floor_anchor = floorAtTriggerAdjusted;
    care.log_maxfloor_anchor = maxFloorAdjusted;
    care.log_cap_zusatz = capZusatz;
    care.log_delta_flex = flexVerlust;
    care.log_grade = care.grade;
    care.log_grade_label = care.gradeLabel;

    return care;
}

/** Erstes Ansparjahr verwendet die konfigurierte Rate, erst Folgejahre indexieren.
 *
 * @param inputs Wirksame Simulationseingaben.
 * @returns Ergebnis der Operation.
 */
export function initialAccumulationState(inputs) {
    return inputs.accumulationPhase?.enabled ? {
        yearsSaved: 0, totalContributed: 0,
        sparrateThisYear: (Number(inputs.accumulationPhase.sparrate) || 0) * 12
    } : null;
}
