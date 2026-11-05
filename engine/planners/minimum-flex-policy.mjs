/** @import {Needs, EngineInput, EngineState, SpendingParameters, Market, RunwayProfile, AddDecision, Trace, AlarmStatus, PlannerState, KeyParams} from '../../typcheck/rechenkern' */
import { CONFIG } from '../config.mjs';
import {
    deriveLiquidityRunwayPolicy,
    resolveLiquidityRunwayYears
} from '../../types/liquidity-runway-contract.js';

/** @param {unknown} value */
function clampRate(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
}

/** @param {unknown} flex
 * @param {unknown} rate */
function effectiveFlexAmount(flex, rate) {
    return Math.max(0, Number(flex) || 0) * (clampRate(rate) / 100);
}

/** @param {Partial<EngineInput>} input */
function readMinimumFlexAnnual(input) {
    const value = Number(input?.minimumFlexAnnual ?? 0);
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError('minimumFlexAnnual muss eine gueltige nicht-negative Zahl sein.');
    }
    return value;
}

/** @param {import('../../typcheck/rechenkern').MinimumFlexContext} context */
function resolvePensionFlexContribution(context) {
    const input = /** @type {Partial<EngineInput>} */ (context.input || {});
    const annualPension = Number(context.renteJahr);
    const grossFloor = Number(input.floorBedarf);
    const grossFlex = Number(input.flexBedarf);
    if (
        !Number.isFinite(annualPension)
        || !Number.isFinite(grossFloor)
        || !Number.isFinite(grossFlex)
    ) {
        return 0;
    }
    const pensionSurplus = Math.max(0, annualPension - Math.max(0, grossFloor));
    return Math.min(Math.max(0, grossFlex), pensionSurplus);
}

/** @param {import('../../typcheck/rechenkern').MinimumFlexContext} context
 * @param {number} minimumFlexDepotAnnual */
function evaluateEmergencyBlock(context, minimumFlexDepotAnnual) {
    const inflatedBedarf = /** @type {Partial<Needs>} */ (context.inflatedBedarf || {});
    const input = /** @type {Partial<EngineInput>} */ (context.input || {});
    const alarmStatus = context.alarmStatus || {};
    const floor = Math.max(0, Number(inflatedBedarf.floor) || 0);
    const floorPlusMinimumFlex = floor + minimumFlexDepotAnnual;
    const totalWealthRaw = Number(context.gesamtwert);
    const totalWealth = Number.isFinite(totalWealthRaw) ? Math.max(0, totalWealthRaw) : Infinity;
    const minRunwayMonths = deriveLiquidityRunwayPolicy(resolveLiquidityRunwayYears(input).years).hardMinimumMonths;
    const minRunwayReserve = minRunwayMonths > 0
        ? (floorPlusMinimumFlex / 12) * minRunwayMonths
        : 0;
    const requiredWealthForRunway = floorPlusMinimumFlex + minRunwayReserve;

    if (alarmStatus.active === true) {
        return {
            blocked: true,
            reason: 'alarm_active',
            floorPlusMinimumFlex,
            minRunwayMonths,
            requiredWealthForRunway,
            totalWealth
        };
    }

    if (floorPlusMinimumFlex > 0 && totalWealth + 0.01 < floorPlusMinimumFlex) {
        return {
            blocked: true,
            reason: 'floor_minimum_flex_not_covered',
            floorPlusMinimumFlex,
            minRunwayMonths,
            requiredWealthForRunway,
            totalWealth
        };
    }

    if (minRunwayReserve > 0 && totalWealth + 0.01 < requiredWealthForRunway) {
        return {
            blocked: true,
            reason: 'minimum_runway_not_restorable',
            floorPlusMinimumFlex,
            minRunwayMonths,
            requiredWealthForRunway,
            totalWealth
        };
    }

    return {
        blocked: false,
        reason: null,
        floorPlusMinimumFlex,
        minRunwayMonths,
        requiredWealthForRunway,
        totalWealth
    };
}

// Geschützte offene Mindestentnahme für FR-32; Rentenüberschuss
// deckt zuerst den Mindest-Flex, bevor das Depot dafür belastet wird.
/** @param {import('../../typcheck/rechenkern').MinimumFlexContext} context */
export function resolveMinimumFlexNeed(context = {}) {
    const minimumFlexAnnual = readMinimumFlexAnnual(context.input || {});
    const pensionFlexContributionAnnual = resolvePensionFlexContribution(context);
    return { minimumFlexAnnual, pensionFlexContributionAnnual,
        minimumFlexDepotAnnual: Math.max(0, minimumFlexAnnual - pensionFlexContributionAnnual) };
}

/** @param {import('../../typcheck/rechenkern').MinimumFlexContext} params */
export function evaluateProtectedPortfolioWithdrawal(params, minimumFlexResult = resolveMinimumFlexNeed(params)) {
    const floorAnnual = Number(params?.inflatedBedarf?.floor);
    const minimumFlexDepotAnnual = Number(minimumFlexResult?.minimumFlexDepotAnnual);
    const totalWealth = Number(params?.gesamtwert);
    const criticalRate = Number(CONFIG.SPENDING_MODEL?.WEALTH_ADJUSTED_REDUCTION?.FULL_WITHDRAWAL_RATE);

    if (!Number.isFinite(floorAnnual) || floorAnnual < 0) {
        throw new RangeError('Netto-Floor muss fuer das Safety-Gate als nicht-negative endliche Zahl vorliegen.');
    }
    if (!Number.isFinite(minimumFlexDepotAnnual) || minimumFlexDepotAnnual < 0) {
        throw new RangeError('Offener Mindest-Flex muss fuer das Safety-Gate als nicht-negative endliche Zahl vorliegen.');
    }
    if (!Number.isFinite(totalWealth) || totalWealth < 0) {
        throw new RangeError('Aktives Gesamtvermoegen muss fuer das Safety-Gate als nicht-negative endliche Zahl vorliegen.');
    }
    if (!Number.isFinite(criticalRate) || criticalRate <= 0 || criticalRate > 1) {
        throw new RangeError('Kritische geschuetzte Entnahmequote fuer das Safety-Gate ist ungueltig.');
    }

    const annual = floorAnnual + minimumFlexDepotAnnual;
    const rate = annual <= 0
        ? 0
        : (totalWealth > 0 ? annual / totalWealth : 1);

    return {
        annual,
        rate,
        criticalRate,
        capacityCritical: rate >= criticalRate
    };
}



/** @param {number} flexRate
 * @param {import('../../typcheck/rechenkern').MinimumFlexContext} context
 * @param {AddDecision} addDecision
 * @returns {import('../../typcheck/rechenkern').MinimumFlexResult} */
export function applyMinimumFlexFloor(flexRate, context = {}, addDecision = () => {}) {
    const inflatedBedarf = /** @type {Partial<Needs>} */ (context.inflatedBedarf || {});
    const input = /** @type {Partial<EngineInput>} */ (context.input || {});
    const flex = Math.max(0, Number(inflatedBedarf.flex) || 0);
    const { minimumFlexAnnual, pensionFlexContributionAnnual, minimumFlexDepotAnnual } = resolveMinimumFlexNeed(context);
    const householdFlexAnnual = pensionFlexContributionAnnual + flex;
    const initialRate = clampRate(flexRate);
    const effectiveFlexBefore = pensionFlexContributionAnnual + effectiveFlexAmount(flex, initialRate);

    const baseResult = {
        rate: initialRate,
        applied: false,
        status: 'inactive_zero',
        minimumFlexAnnual,
        minimumFlexDepotAnnual,
        pensionFlexContributionAnnual,
        householdFlexAnnual,
        flexAnnual: flex,
        requiredRate: 0,
        requiredRateUnbounded: 0,
        targetUnattainableAtFullFlex: false,
        effectiveFlexBefore,
        effectiveFlexAfter: effectiveFlexBefore,
        blockReason: null
    };

    if (minimumFlexAnnual <= 0) {
        return baseResult;
    }

    if (minimumFlexDepotAnnual <= 0) {
        return {
            ...baseResult,
            status: 'not_needed',
            blockReason: flex <= 0 ? 'covered_by_pension_surplus' : null
        };
    }

    if (flex <= 0) {
        return {
            ...baseResult,
            status: 'limited_by_available_flex',
            targetUnattainableAtFullFlex: true,
            blockReason: 'no_open_depot_flex_need'
        };
    }

    const requiredRateUnbounded = (minimumFlexDepotAnnual / flex) * 100;
    const requiredRate = clampRate(requiredRateUnbounded);
    const targetUnattainableAtFullFlex = requiredRateUnbounded > 100 + 0.01;
    if (effectiveFlexBefore + 0.01 >= minimumFlexAnnual || initialRate >= requiredRate) {
        return {
            ...baseResult,
            status: 'not_needed',
            requiredRate,
            requiredRateUnbounded,
            targetUnattainableAtFullFlex
        };
    }

    const emergency = evaluateEmergencyBlock(context, minimumFlexDepotAnnual);
    if (emergency.blocked) {
        addDecision(
            'Mindest-Flex blockiert',
            `Mindest-Flex nicht angehoben (${emergency.reason}).`,
            'blocked',
            'warn'
        );
        return {
            ...baseResult,
            status: 'blocked_emergency',
            requiredRate,
            requiredRateUnbounded,
            targetUnattainableAtFullFlex,
            blockReason: emergency.reason,
            emergency
        };
    }

    const rate = Math.max(initialRate, requiredRate);
    const effectiveFlexAfter = pensionFlexContributionAnnual + effectiveFlexAmount(flex, rate);
    addDecision(
        'Mindest-Flex',
        `Flex-Rate auf ${rate.toFixed(1)}% angehoben, um Mindest-Flex ${minimumFlexAnnual.toFixed(0)}€ p.a. zu erreichen.`,
        'active',
        'guardrail'
    );

    return {
        ...baseResult,
        rate,
        applied: true,
        status: 'applied',
        requiredRate,
        requiredRateUnbounded,
        targetUnattainableAtFullFlex,
        effectiveFlexBefore,
        effectiveFlexAfter,
        blockReason: null,
        emergency
    };
}


/** @param {PlannerState} state
 * @param {import('../../typcheck/rechenkern').MinimumFlexResult} result
 * @param {string|null} statusOverride */
export function writeMinimumFlexDiagnostics(state, result, statusOverride = null) {
    if (!state?.keyParams || !result) return;
    const minimumFlexAnnual = Number.isFinite(result.minimumFlexAnnual) ? result.minimumFlexAnnual : 0;
    const flexAnnual = Number.isFinite(result.flexAnnual) ? Math.max(0, result.flexAnnual) : 0;
    const pensionFlexContributionAnnual = Number.isFinite(result.pensionFlexContributionAnnual)
        ? Math.max(0, result.pensionFlexContributionAnnual)
        : 0;
    const householdFlexAnnual = Number.isFinite(result.householdFlexAnnual)
        ? Math.max(0, result.householdFlexAnnual)
        : pensionFlexContributionAnnual + flexAnnual;
    const applicable = minimumFlexAnnual > 0;
    const effectiveFinal = applicable
        ? Math.min(
            householdFlexAnnual,
            pensionFlexContributionAnnual + effectiveFlexAmount(flexAnnual, result.rate)
        )
        : 0;
    const shortfallAnnual = applicable
        ? Math.max(0, minimumFlexAnnual - effectiveFinal)
        : 0;
    state.keyParams.minimumFlexStatus = statusOverride || result.status;
    state.keyParams.minimumFlexAnnual = minimumFlexAnnual;
    state.keyParams.minimumFlexDepotAnnual = Number.isFinite(result.minimumFlexDepotAnnual)
        ? Math.max(0, result.minimumFlexDepotAnnual)
        : Math.max(0, minimumFlexAnnual - pensionFlexContributionAnnual);
    state.keyParams.minimumFlexPensionContributionAnnual = pensionFlexContributionAnnual;
    state.keyParams.minimumFlexHouseholdFlexAnnual = householdFlexAnnual;
    state.keyParams.minimumFlexApplicable = applicable;
    state.keyParams.minimumFlexBlockReason = result.blockReason || null;
    state.keyParams.minimumFlexRequiredRate = Number.isFinite(result.requiredRate) ? result.requiredRate : 0;
    state.keyParams.minimumFlexRequiredRateUnbounded = Number.isFinite(result.requiredRateUnbounded)
        ? result.requiredRateUnbounded
        : 0;
    state.keyParams.minimumFlexTargetUnattainableAtFullFlex = result.targetUnattainableAtFullFlex === true;
    state.keyParams.minimumFlexEffectiveBefore = Number.isFinite(result.effectiveFlexBefore) ? result.effectiveFlexBefore : 0;
    state.keyParams.minimumFlexEffectiveAfter = Number.isFinite(result.effectiveFlexAfter) ? result.effectiveFlexAfter : 0;
    state.keyParams.minimumFlexEffectiveFinal = effectiveFinal;
    state.keyParams.minimumFlexShortfallAnnual = shortfallAnnual;
    state.keyParams.minimumFlexFulfilled = !applicable || shortfallAnnual <= 0.01;
    if (result.emergency) {
        state.keyParams.minimumFlexEmergencyTotalWealth = Number.isFinite(result.emergency.totalWealth)
            ? result.emergency.totalWealth
            : null;
        state.keyParams.minimumFlexEmergencyRequiredWealth = Number.isFinite(result.emergency.requiredWealthForRunway)
            ? result.emergency.requiredWealthForRunway
            : null;
        state.keyParams.minimumFlexEmergencyFloorPlusMinimumFlex = Number.isFinite(result.emergency.floorPlusMinimumFlex)
            ? result.emergency.floorPlusMinimumFlex
            : null;
        state.keyParams.minimumFlexEmergencyMinRunwayMonths = Number.isFinite(result.emergency.minRunwayMonths)
            ? result.emergency.minRunwayMonths
            : null;
    }
}

/** @param {PlannerState} state
 * @param {number} finalEffectiveFlex */
export function finalizeMinimumFlexDiagnostics(state, finalEffectiveFlex) {
    if (!state?.keyParams) return;
    const applicable = state.keyParams.minimumFlexApplicable === true;
    const target = Number.isFinite(state.keyParams.minimumFlexAnnual)
        ? state.keyParams.minimumFlexAnnual
        : 0;
    const pensionFlexContributionAnnual = Number.isFinite(state.keyParams.minimumFlexPensionContributionAnnual)
        ? Math.max(0, state.keyParams.minimumFlexPensionContributionAnnual)
        : 0;
    const householdFlexAnnual = Number.isFinite(state.keyParams.minimumFlexHouseholdFlexAnnual)
        ? Math.max(0, state.keyParams.minimumFlexHouseholdFlexAnnual)
        : Number.POSITIVE_INFINITY;
    const effectiveFinal = applicable && Number.isFinite(finalEffectiveFlex)
        ? Math.min(
            householdFlexAnnual,
            pensionFlexContributionAnnual + Math.max(0, finalEffectiveFlex)
        )
        : 0;
    const shortfallAnnual = applicable ? Math.max(0, target - effectiveFinal) : 0;

    state.keyParams.minimumFlexEffectiveFinal = effectiveFinal;
    state.keyParams.minimumFlexShortfallAnnual = shortfallAnnual;
    state.keyParams.minimumFlexFulfilled = !applicable || shortfallAnnual <= 0.01;

    if (
        shortfallAnnual > 0.01
        && (state.keyParams.minimumFlexStatus === 'applied' || state.keyParams.minimumFlexStatus === 'not_needed')
    ) {
        state.keyParams.minimumFlexStatus = 'limited_by_final_quantization';
    }
}
