// @ts-check
/** @import {EngineInput,VpwReturnContext} from '../../typcheck/rechenkern' */
import { CONFIG } from '../config.mjs';
import { deriveVpwExpectedRealReturn } from '../planners/vpw-return-policy.mjs';
/** @param {number} value
 * @param {number} min
 * @param {number} max */
export function _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}


/** @param {number} realeRendite
 * @param {number} horizontJahre */
export const _berechneEntnahmeRate = (realeRendite, horizontJahre) => {
    const laufzeitJahre = Math.max(1, Number(horizontJahre) || 1);
    const rendite = Number(realeRendite) || 0;
    if (Math.abs(rendite) < 0.001) {
        return 1 / laufzeitJahre;
    }
    return rendite / (1 - Math.pow(1 + rendite, -laufzeitJahre));
};

/** @param {VpwReturnContext & {lastExpectedRealReturn?:number|null;expectedReturnCape?:number;inflation?:number}} params */
export function _calculateExpectedRealReturn(params) {
    const cfg = CONFIG.SPENDING_MODEL.DYNAMIC_FLEX;
    const policyResult = deriveVpwExpectedRealReturn(params);
    const clampedReal = policyResult.expectedRealReturn;
    const prior = Number.isFinite(params?.lastExpectedRealReturn)
        ? params.lastExpectedRealReturn
        // Erstjahr: kein Vorwert vorhanden -> direkte Uebernahme des geclampten Werts.
        : clampedReal;
    const alpha = _clamp(cfg.EXPECTED_RETURN_SMOOTHING_ALPHA, 0, 1);
    const smoothedReal = prior + alpha * (clampedReal - prior);
    return {
        ...policyResult,
        expectedRealReturnBeforeSmoothing: clampedReal,
        expectedRealReturn: smoothedReal,
        smoothingAlpha: alpha
    };
}

/** @param {EngineInput} input
 * @param {number|null} effectiveHorizon */
export function _buildLongevityDiagnostics(input, effectiveHorizon) {
    const source = (input?.longevityHorizonDiagnostics && typeof input.longevityHorizonDiagnostics === 'object')
        ? input.longevityHorizonDiagnostics
        : null;
    const mode = typeof input?.longevityMode === 'string' ? input.longevityMode : (source?.longevityMode || 'none');
    const rawHorizon = Number.isFinite(source?.horizonYearsRaw)
        ? source.horizonYearsRaw
        : effectiveHorizon;
    return {
        horizonYearsRaw: rawHorizon,
        longevityMode: mode,
        longevityApplied: source ? source.longevityApplied === true : false,
        longevityAppliedShift: Number.isFinite(source?.longevityAppliedShift) ? source.longevityAppliedShift : 0,
        longevityAppliedBufferYears: Number.isFinite(source?.longevityAppliedBufferYears) ? source.longevityAppliedBufferYears : 0,
        longevityRelativePct: Number.isFinite(source?.longevityRelativePct) ? source.longevityRelativePct : 0,
        longevityClampReason: source?.longevityClampReason || null,
        survivalQuantileRaw: Number.isFinite(source?.survivalQuantileRaw) ? source.survivalQuantileRaw : null,
        survivalQuantileAdjusted: Number.isFinite(source?.survivalQuantileAdjusted) ? source.survivalQuantileAdjusted : null,
        longevityTransitionSmoothingApplied: source?.longevityTransitionSmoothingApplied === true,
        longevityTransitionSmoothingFloor: Number.isFinite(source?.longevityTransitionSmoothingFloor)
            ? source.longevityTransitionSmoothingFloor
            : null
    };
}
