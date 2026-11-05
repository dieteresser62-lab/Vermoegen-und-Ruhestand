// @ts-check
/** @import {SweepParameters,SimulatorInputs} from '../../../typcheck/rechenkern' */
import { deepClone, SWEEP_ALLOWED_KEYS, isBlockedKey } from '../simulator-sweep-utils.js';

const SWEEP_LIMITS = {
    liquidityRunwayYearsMin: 1,
    liquidityRunwayYearsMax: 10,
    goldRebalancingBandMin: 0,
    goldRebalancingBandMax: 100,
    skimMin: 0,
    skimMax: 100,
    refillMin: 0,
    refillMax: 100,
    goldTargetMin: 0,
    goldTargetMax: 30,
    dynamicHorizonMin: 1,
    dynamicHorizonMax: 60,
    dynamicQuantileMin: 0.5,
    dynamicQuantileMax: 0.99,
    dynamicGoGoMultiplierMin: 1.0,
    dynamicGoGoMultiplierMax: 1.5
};

/** @param {unknown} value */
function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

/** @param {SimulatorInputs} baseInputs
 * @param {SweepParameters} params */
export function validateSweepCombination(baseInputs, params) {
    if (!params || typeof params !== 'object') {
        return { valid: false, reason: 'fehlende Parameter' };
    }

    if (!isFiniteNumber(params.liquidityRunwayYears)) {
        return { valid: false, reason: 'Liquiditäts-Runway fehlt' };
    }

    const numericChecks = /** @type {[string,number,number][]} */ ([
        ['liquidityRunwayYears', SWEEP_LIMITS.liquidityRunwayYearsMin, SWEEP_LIMITS.liquidityRunwayYearsMax],
        ['goldRebalancingBand', SWEEP_LIMITS.goldRebalancingBandMin, SWEEP_LIMITS.goldRebalancingBandMax],
        ['maxSkimPct', SWEEP_LIMITS.skimMin, SWEEP_LIMITS.skimMax],
        ['maxBearRefillPct', SWEEP_LIMITS.refillMin, SWEEP_LIMITS.refillMax],
        ['goldTargetPct', SWEEP_LIMITS.goldTargetMin, SWEEP_LIMITS.goldTargetMax]
    ]);
    for (const [key, min, max] of numericChecks) {
        if (params[key] === undefined) continue;
        const value = Number(params[key]);
        if (!Number.isFinite(value) || value < min || value > max) {
            return { valid: false, reason: `${key} außerhalb [${min}, ${max}]` };
        }
    }

    const hasDynamicOverride = (
        params.horizonYears !== undefined ||
        params.survivalQuantile !== undefined ||
        params.goGoMultiplier !== undefined
    );
    if (hasDynamicOverride && baseInputs?.dynamicFlex !== true) {
        return { valid: false, reason: 'Dynamic-Flex-Parameter gesetzt, aber Dynamic Flex ist deaktiviert' };
    }

    if (params.horizonYears !== undefined) {
        const value = Number(params.horizonYears);
        if (!Number.isFinite(value) || value < SWEEP_LIMITS.dynamicHorizonMin || value > SWEEP_LIMITS.dynamicHorizonMax) {
            return { valid: false, reason: `horizonYears außerhalb [${SWEEP_LIMITS.dynamicHorizonMin}, ${SWEEP_LIMITS.dynamicHorizonMax}]` };
        }
    }
    if (params.survivalQuantile !== undefined) {
        const value = Number(params.survivalQuantile);
        if (!Number.isFinite(value) || value < SWEEP_LIMITS.dynamicQuantileMin || value > SWEEP_LIMITS.dynamicQuantileMax) {
            return { valid: false, reason: `survivalQuantile außerhalb [${SWEEP_LIMITS.dynamicQuantileMin}, ${SWEEP_LIMITS.dynamicQuantileMax}]` };
        }
        if ((baseInputs?.horizonMethod || 'survival_quantile') !== 'survival_quantile') {
            return { valid: false, reason: 'survivalQuantile ist nur bei Horizon-Methode survival_quantile zulaessig' };
        }
    }
    if (params.goGoMultiplier !== undefined) {
        const value = Number(params.goGoMultiplier);
        if (!Number.isFinite(value) || value < SWEEP_LIMITS.dynamicGoGoMultiplierMin || value > SWEEP_LIMITS.dynamicGoGoMultiplierMax) {
            return { valid: false, reason: `goGoMultiplier außerhalb [${SWEEP_LIMITS.dynamicGoGoMultiplierMin}, ${SWEEP_LIMITS.dynamicGoGoMultiplierMax}]` };
        }
        if (baseInputs?.goGoActive !== true) {
            return { valid: false, reason: 'goGoMultiplier gesetzt, aber Go-Go ist deaktiviert' };
        }
    }

    return { valid: true, reason: '' };
}

/** @param {SimulatorInputs} baseInputs
 * @param {SweepParameters} params
 * @returns {SimulatorInputs} */
export function buildSweepInputs(baseInputs, params) {
    const inputs = /** @type {SimulatorInputs} */ (deepClone(baseInputs));
    /** @type {Partial<SimulatorInputs>} */
    const caseOverrides = {
        liquidityRunwayYears: params.liquidityRunwayYears,
        rebalancingBand: params.goldRebalancingBand,
        maxSkimPctOfEq: params.maxSkimPct,
        maxBearRefillPctOfEq: params.maxBearRefillPct,
        horizonYears: params.horizonYears,
        survivalQuantile: params.survivalQuantile,
        goGoMultiplier: params.goGoMultiplier
    };
    delete inputs.runwayMinMonths;
    delete inputs.runwayTargetMonths;
    delete inputs.targetEq;

    if (params.goldTargetPct !== undefined) {
        caseOverrides.goldZielProzent = params.goldTargetPct;
        // Gold is implicitly active once a target is set.
        caseOverrides.goldAktiv = params.goldTargetPct > 0;
    }

    // Apply only whitelisted keys and block any partner-specific fields.
    for (const [key, value] of Object.entries(caseOverrides)) {
        if (value === undefined) continue;
        if (isBlockedKey(key)) {
            continue;
        }
        if (SWEEP_ALLOWED_KEYS.size && !SWEEP_ALLOWED_KEYS.has(key)) {
            continue;
        }
        inputs[key] = value;
    }

    return inputs;
}
