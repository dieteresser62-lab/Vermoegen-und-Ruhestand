// @ts-check
/** @import {EngineInput,NormalizedEngineInput} from '../../typcheck/rechenkern' */
import { CONFIG } from '../config.mjs';
import { STRATEGY_OPTIONS } from '../../types/strategy-options.js';
import { resolveLiquidityRunwayYears } from '../../types/liquidity-runway-contract.js';
const DYNAMIC_FLEX_ALLOWED_HORIZON_METHODS = new Set(['mean', 'survival_quantile']);
const LEGACY_STANDARD_MODES = new Set(['dynamic_flex', 'vpw', 'guardrails', 'fixed_real', 'none']);
/** @param {EngineInput} input */
function _coalesceCapeRatio(input) {
    if (Number.isFinite(input?.capeRatio) && input.capeRatio > 0) {
        return input.capeRatio;
    }
    if (Number.isFinite(input?.marketCapeRatio) && input.marketCapeRatio > 0) {
        return input.marketCapeRatio;
    }
    return undefined;
}

/** @param {EngineInput} rawInput
 * @returns {NormalizedEngineInput} */
export function _normalizeEngineInput(rawInput) {
    const input = /** @type {NormalizedEngineInput} */ ({ ...(rawInput || {}) });
    const liquidityRunwayResolution = resolveLiquidityRunwayYears(rawInput || {});

    /** @param {unknown} val */
    const normalizeNum = (val, fallback = 0) => {
        const n = Number(val);
        return Number.isFinite(n) ? n : fallback;
    };

    input.depotwertAlt = normalizeNum(input.depotwertAlt, 0);
    input.depotwertNeu = normalizeNum(input.depotwertNeu, 0);
    input.goldWert = normalizeNum(input.goldWert, 0);
    input.tagesgeld = normalizeNum(input.tagesgeld, 0);
    input.geldmarktEtf = normalizeNum(input.geldmarktEtf, 0);
    input.costBasisAlt = normalizeNum(input.costBasisAlt, 0);
    input.costBasisNeu = normalizeNum(input.costBasisNeu, 0);
    input.goldCost = normalizeNum(input.goldCost, 0);
    input.sparerPauschbetrag = normalizeNum(input.sparerPauschbetrag, 0);
    input.kirchensteuerSatz = normalizeNum(input.kirchensteuerSatz, 0);

    // Optional simulator/test override: absent values retain the legacy
    // tagesgeld + geldmarktEtf fallback; explicit values stay raw for validation.
    if (input.aktuelleLiquiditaet == null) {
        delete input.aktuelleLiquiditaet;
    }

    input.aktuellesAlter = normalizeNum(input.aktuellesAlter, 65);
    input.startAlter = normalizeNum(input.startAlter, input.aktuellesAlter);
    input.inflation = normalizeNum(input.inflation, 0);
    input.liquidityRunwayYears = liquidityRunwayResolution.years;
    delete input.runwayMinMonths;
    delete input.runwayTargetMonths;
    delete input.targetEq;
    input.rebalancingBand = input.rebalancingBand == null
        ? 35
        : Number(input.rebalancingBand);
    delete input.rebalBand;
    input.maxSkimPctOfEq = normalizeNum(input.maxSkimPctOfEq, 0);
    input.maxBearRefillPctOfEq = normalizeNum(input.maxBearRefillPctOfEq, 0);

    const capeRatio = _coalesceCapeRatio(input);
    if (capeRatio !== undefined) {
        input.capeRatio = capeRatio;
    }

    // Dynamic-Flex contract defaults (T01). T02 will consume these fields.
    input.dynamicFlex = input.dynamicFlex === true;
    input.horizonMethod = DYNAMIC_FLEX_ALLOWED_HORIZON_METHODS.has(input.horizonMethod)
        ? input.horizonMethod
        : 'survival_quantile';
    if (!Number.isFinite(input.survivalQuantile)) {
        input.survivalQuantile = 0.85;
    }
    /** @type {('longevityQuantileShift'|'longevityRelativePct'|'longevityBufferYears')[]} */ (['longevityQuantileShift', 'longevityRelativePct', 'longevityBufferYears']).forEach(field => {
        if (input[field] != null) {
            const normalized = Number(input[field]);
            input[field] = Number.isFinite(normalized) ? normalized : input[field];
        }
    });
    input.goGoActive = input.goGoActive === true;
    if (!Number.isFinite(input.goGoMultiplier)) {
        input.goGoMultiplier = 1.0;
    }
    const minimumFlexAnnualRaw = /** @type {unknown} */ (input.minimumFlexAnnual);
    if (minimumFlexAnnualRaw == null || minimumFlexAnnualRaw === '') {
        input.minimumFlexAnnual = 0;
    } else {
        let minimumFlexAnnual = Number.NaN;
        try {
            minimumFlexAnnual = Number(minimumFlexAnnualRaw);
        } catch {
            // Preserve the invalid value so InputValidator can reject it with field context.
        }
        input.minimumFlexAnnual = Number.isFinite(minimumFlexAnnual)
            ? minimumFlexAnnual
            : /** @type {number} */ (minimumFlexAnnualRaw);
    }

    const decumulationRaw = /** @type {Partial<import('../../typcheck/rechenkern').StrategyOptions>} */ ((input.decumulation && typeof input.decumulation === 'object')
        ? input.decumulation
        : {});
    const modeRaw = String(decumulationRaw.mode || '').trim().toLowerCase();
    const mode = (modeRaw === STRATEGY_OPTIONS.THREE_BUCKET_JILGE)
        ? STRATEGY_OPTIONS.THREE_BUCKET_JILGE
        : ((modeRaw === STRATEGY_OPTIONS.STANDARD || LEGACY_STANDARD_MODES.has(modeRaw) || modeRaw === '')
            ? STRATEGY_OPTIONS.STANDARD
            : STRATEGY_OPTIONS.STANDARD);
    let drawdownTrigger = Number(decumulationRaw.drawdownTrigger);
    if (!Number.isFinite(drawdownTrigger)) {
        drawdownTrigger = Number(CONFIG.SPENDING_MODEL?.THREE_BUCKET?.DEFAULT_DRAWDOWN_TRIGGER);
    }
    if (Number.isFinite(drawdownTrigger) && drawdownTrigger > 0) {
        drawdownTrigger = -drawdownTrigger;
    }
    const bondTargetFactor = Number(decumulationRaw.bondTargetFactor);
    const bondRefillThreshold = Number(decumulationRaw.bondRefillThreshold);
    input.decumulation = {
        mode,
        bondTargetFactor: Number.isFinite(bondTargetFactor)
            ? Math.max(0, bondTargetFactor)
            : Number(CONFIG.SPENDING_MODEL?.THREE_BUCKET?.DEFAULT_BOND_TARGET_FACTOR),
        drawdownTrigger: Number.isFinite(drawdownTrigger)
            ? drawdownTrigger
            : Number(CONFIG.SPENDING_MODEL?.THREE_BUCKET?.DEFAULT_DRAWDOWN_TRIGGER),
        bondRefillThreshold: Number.isFinite(bondRefillThreshold)
            ? Math.max(0, bondRefillThreshold)
            : CONFIG.SPENDING_MODEL?.THREE_BUCKET?.DEFAULT_BOND_REFILL_THRESHOLD
    };

    return input;
}
