/** @import {VpwReturnContext} from '../../typcheck/rechenkern' */
import { CONFIG } from '../config.mjs';
import { netEquityReturn } from './equity-cost.mjs';

const POLICY_LEGACY_STEP = 'legacy_step';
const POLICY_CAPE_CONTINUOUS = 'cape_continuous';

/** @param {number} value
 * @param {number} min
 * @param {number} max */
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/** @param {unknown} value
 * @returns {value is number} */
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/** @param {unknown} value
 * @param {number} fallbackPct */
function normalizeWeightPct(value, fallbackPct) {
    const pct = finiteNumber(value) ? value : fallbackPct;
    return clamp(pct / 100, 0, 1);
}

function resolveCapeConfig(config = CONFIG) {
    return {
        ...CONFIG.CAPE_CONTINUOUS,
        ...(config?.CAPE_CONTINUOUS || {})
    };
}

function resolveDynamicFlexConfig(config = CONFIG) {
    return {
        ...CONFIG.SPENDING_MODEL.DYNAMIC_FLEX,
        ...(config?.SPENDING_MODEL?.DYNAMIC_FLEX || {})
    };
}

/** @param {unknown} capeInput
 * @param {typeof CONFIG.CAPE_CONTINUOUS} options */
function normalizeCape(capeInput, options) {
    const defaultCape = finiteNumber(options.DEFAULT_CAPE) && options.DEFAULT_CAPE > 0
        ? options.DEFAULT_CAPE
        : CONFIG.MARKET_VALUATION.DEFAULT_CAPE;
    const minCape = finiteNumber(options.MIN_CAPE) ? options.MIN_CAPE : 0;
    const maxCape = finiteNumber(options.MAX_CAPE) ? options.MAX_CAPE : 100;

    if (capeInput === null || capeInput === undefined || capeInput === '') {
        return { capeRatioUsed: defaultCape, capeInputStatus: 'fallback_missing' };
    }
    if (!finiteNumber(capeInput) || capeInput <= minCape || capeInput > maxCape) {
        return { capeRatioUsed: defaultCape, capeInputStatus: 'fallback_invalid' };
    }
    return { capeRatioUsed: capeInput, capeInputStatus: 'valid' };
}

/** @param {VpwReturnContext} context
 * @param {Partial<typeof CONFIG.SPENDING_MODEL.DYNAMIC_FLEX>} dynamicFlexCfg
 * @param {Partial<typeof CONFIG.CAPE_CONTINUOUS>} capeCfg */
function resolveSafeRealReturn(context = {}, dynamicFlexCfg = {}, capeCfg = {}) {
    if (finiteNumber(context.safeRealReturn)) {
        return { safeRealReturn: context.safeRealReturn, safeRealReturnSource: 'context' };
    }
    if (capeCfg.SAFE_REAL_RETURN_MODE === 'config_or_zero' && finiteNumber(dynamicFlexCfg.SAFE_ASSET_REAL_RETURN)) {
        return { safeRealReturn: dynamicFlexCfg.SAFE_ASSET_REAL_RETURN, safeRealReturnSource: 'config_dynamic_flex' };
    }
    return { safeRealReturn: 0, safeRealReturnSource: 'fallback_zero' };
}

/** @param {VpwReturnContext} context
 * @param {Partial<typeof CONFIG.SPENDING_MODEL.DYNAMIC_FLEX>} dynamicFlexCfg */
function resolveGoldRealReturn(context = {}, dynamicFlexCfg = {}) {
    if (finiteNumber(context.goldRealReturn)) {
        return { goldRealReturn: context.goldRealReturn, goldRealReturnSource: 'context' };
    }
    if (finiteNumber(dynamicFlexCfg.GOLD_REAL_RETURN)) {
        return { goldRealReturn: dynamicFlexCfg.GOLD_REAL_RETURN, goldRealReturnSource: 'config_dynamic_flex' };
    }
    return { goldRealReturn: 0, goldRealReturnSource: 'fallback_zero' };
}

/** @param {VpwReturnContext} input */
export function normalizeVpwReturnPolicyOptions(input = {}, config = CONFIG) {
    const dynamicFlexCfg = resolveDynamicFlexConfig(config);
    const capeCfg = resolveCapeConfig(config);
    const returnPolicy = input.returnPolicy || dynamicFlexCfg.RETURN_POLICY || POLICY_LEGACY_STEP;
    return {
        returnPolicy: returnPolicy === POLICY_CAPE_CONTINUOUS ? POLICY_CAPE_CONTINUOUS : POLICY_LEGACY_STEP,
        dynamicFlex: dynamicFlexCfg,
        capeContinuous: capeCfg
    };
}

/** @param {unknown} cape
 * @param {VpwReturnContext} options */
export function deriveCAPEContinuousReturn(cape, options = {}, config = CONFIG) {
    const normalized = normalizeVpwReturnPolicyOptions({ ...options, returnPolicy: POLICY_CAPE_CONTINUOUS }, config);
    const dynamicFlexCfg = normalized.dynamicFlex;
    const capeCfg = {
        ...normalized.capeContinuous,
        ...options
    };
    const { capeRatioUsed, capeInputStatus } = normalizeCape(cape, capeCfg);
    const earningsYield = 1 / capeRatioUsed;
    const equityRiskPremium = finiteNumber(capeCfg.EQUITY_PREMIUM_ADJUSTMENT) ? capeCfg.EQUITY_PREMIUM_ADJUSTMENT : 0;
    const rawEquityRealReturn = earningsYield + equityRiskPremium;
    const equityRealReturn = clamp(
        rawEquityRealReturn,
        capeCfg.MIN_EQUITY_REAL_RETURN,
        capeCfg.MAX_EQUITY_REAL_RETURN
    );
    // FR-76: Fondskosten mindern die erwartete Aktienrendite einmal, nach der Bandbreite des Marktmodells.
    const equityRealReturnNet = netEquityReturn(equityRealReturn, options.equityCostPct);
    const eqPct = normalizeWeightPct(options.equityWeightPct, 60);
    const goldPctRaw = options.goldAktiv === true
        ? normalizeWeightPct(options.goldWeightPct, 0)
        : 0;
    const goldPct = clamp(goldPctRaw, 0, Math.max(0, 1 - eqPct));
    const safePct = Math.max(0, 1 - eqPct - goldPct);
    const { goldRealReturn, goldRealReturnSource } = resolveGoldRealReturn(options, dynamicFlexCfg);
    const { safeRealReturn, safeRealReturnSource } = resolveSafeRealReturn(options, dynamicFlexCfg, capeCfg);
    const goldContribution = goldPct > 0 ? (goldPct * goldRealReturn) : 0;
    const safeContribution = safePct > 0 ? (safePct * safeRealReturn) : 0;
    const expectedRealReturnRaw = (eqPct * equityRealReturnNet) +
        goldContribution +
        safeContribution;
    const expectedRealReturnClamped = clamp(
        expectedRealReturnRaw,
        capeCfg.MIN_REAL_RETURN,
        capeCfg.MAX_REAL_RETURN
    );

    return {
        returnPolicy: POLICY_CAPE_CONTINUOUS,
        expectedReturnSource: capeInputStatus === 'valid' ? 'cape_continuous' : 'fallback',
        capeRatioUsed,
        capeInputStatus,
        earningsYield,
        equityRiskPremium,
        rawEquityRealReturn,
        equityRealReturn,
        equityRealReturnClamped: equityRealReturn,
        safeRealReturn,
        safeRealReturnSource,
        goldRealReturn,
        goldRealReturnSource,
        equityWeight: eqPct,
        goldWeight: goldPct,
        safeWeight: safePct,
        equityContribution: eqPct * equityRealReturnNet,
        goldContribution,
        safeContribution,
        expectedRealReturnRaw,
        expectedRealReturnClamped,
        expectedRealReturn: expectedRealReturnClamped,
        clamped: equityRealReturn !== rawEquityRealReturn || expectedRealReturnClamped !== expectedRealReturnRaw
    };
}

/** @param {VpwReturnContext} context */
export function deriveCAPELegacyStepReturn(context = {}, config = CONFIG) {
    const normalized = normalizeVpwReturnPolicyOptions({ ...context, returnPolicy: POLICY_LEGACY_STEP }, config);
    const cfg = normalized.dynamicFlex;
    const inflRate = cfg.LONG_TERM_INFLATION;
    const cape = finiteNumber(context.capeRatio) && context.capeRatio > 0
        ? context.capeRatio : context.marketCapeRatio;
    const valuation = { ...CONFIG.MARKET_VALUATION, ...(config?.MARKET_VALUATION || {}) };
    const equityNominal = interpolateCapeNominalReturn(
        finiteNumber(cape) && cape > 0 ? cape : valuation.DEFAULT_CAPE,
        valuation.EXPECTED_RETURN_CAPE_POINTS
    );
    // FR-76: Die erwartete nominale Aktienrendite nach Fondskosten, (1 + e) × (1 − k) − 1; ER(CAPE) bleibt die Marktannahme.
    const equityNominalNet = netEquityReturn(equityNominal, context.equityCostPct);
    const eqPct = normalizeWeightPct(context.equityWeightPct, 60);
    const goldPctRaw = context.goldAktiv === true ? normalizeWeightPct(context.goldWeightPct, 0) : 0;
    const goldPct = clamp(goldPctRaw, 0, Math.max(0, 1 - eqPct));
    const safePct = Math.max(0, 1 - eqPct - goldPct);
    const { goldRealReturn, goldRealReturnSource } = resolveGoldRealReturn(context, cfg);
    const { safeRealReturn, safeRealReturnSource } = resolveSafeRealReturn(
        context,
        cfg,
        { SAFE_REAL_RETURN_MODE: 'config_or_zero' }
    );
    const goldContribution = goldPct > 0 ? (goldPct * goldRealReturn) : 0;
    const safeContribution = safePct > 0 ? (safePct * safeRealReturn) : 0;
    const expectedRealReturnRaw = (eqPct * (equityNominalNet - inflRate)) +
        goldContribution +
        safeContribution;
    const expectedRealReturnClamped = clamp(expectedRealReturnRaw, cfg.MIN_REAL_RETURN, cfg.MAX_REAL_RETURN);

    return {
        returnPolicy: POLICY_LEGACY_STEP,
        expectedReturnSource: 'legacy_cape_linear',
        expectedReturnCape: equityNominal,
        expectedRealReturnRaw,
        expectedRealReturnClamped,
        expectedRealReturn: expectedRealReturnClamped,
        equityWeight: eqPct,
        goldWeight: goldPct,
        safeWeight: safePct,
        safeRealReturn,
        safeRealReturnSource,
        goldRealReturn,
        goldRealReturnSource,
        equityContribution: eqPct * (equityNominalNet - inflRate),
        goldContribution,
        safeContribution,
        clamped: expectedRealReturnClamped !== expectedRealReturnRaw
    };
}

/** @param {number} cape
 * @param {[number,number][]} points */
function interpolateCapeNominalReturn(cape, points) {
    if (cape <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
        const [x, y] = points[i];
        const [previousX, previousY] = points[i - 1];
        if (cape <= x) return previousY + (y - previousY) * (cape - previousX) / (x - previousX);
    }
    return /** @type {[number,number]} */ (points.at(-1))[1];
}


/** @param {VpwReturnContext} context
 * @param {typeof CONFIG} config
 * @returns {import('../../typcheck/rechenkern').VpwReturnAssessment} */
export function deriveVpwExpectedRealReturn(context = {}, config = CONFIG) {
    const normalized = normalizeVpwReturnPolicyOptions(context, config);
    if (normalized.returnPolicy === POLICY_CAPE_CONTINUOUS) {
        const capeInput = finiteNumber(context.capeRatio) && context.capeRatio > 0
            ? context.capeRatio
            : context.marketCapeRatio;
        return deriveCAPEContinuousReturn(capeInput, context, config);
    }
    return deriveCAPELegacyStepReturn(context, config);
}
