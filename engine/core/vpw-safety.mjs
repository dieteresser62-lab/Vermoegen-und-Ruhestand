// @ts-check
/** @import {EngineState,NormalizedEngineInput,Diagnosis,SpendingResult,WithdrawalResolution,VpwDiagnostics} from '../../typcheck/rechenkern' */
import { CONFIG, DYNAMIC_FLEX_SAFETY_DEFAULTS } from '../config.mjs';
import { STRATEGY_OPTIONS } from '../../types/strategy-options.js';
import { _clamp } from './vpw-return.mjs';
/** @type {Record<number,string>} */
const VPW_SAFETY_STAGE_LABELS = {
    0: 'normal',
    1: 'gogo_off',
    2: 'static_flex'
};

/** @param {unknown} value */
function _sanitizeSafetyStage(value) {
    const stage = Number.isFinite(value) ? Math.round(value) : 0;
    const maxStage = Number(CONFIG.SPENDING_MODEL?.DYNAMIC_FLEX_SAFETY?.MAX_STAGE) || DYNAMIC_FLEX_SAFETY_DEFAULTS.MAX_STAGE;
    return _clamp(stage, 0, maxStage);
}

/** @param {EngineState|null|undefined} lastState */
export function _loadVpwSafetyState(lastState) {
    return {
        stage: _sanitizeSafetyStage(lastState?.vpwSafetyStage),
        riskStreak: Math.max(0, Number(lastState?.vpwSafetyRiskStreak) || 0),
        stableStreak: Math.max(0, Number(lastState?.vpwSafetyStableStreak) || 0),
        reentryRemaining: Math.max(0, Number(lastState?.vpwSafetyReentryRemaining) || 0)
    };
}

/** @param {NormalizedEngineInput} input
 * @param {ReturnType<typeof _loadVpwSafetyState>} safetyState */
export function _deriveEffectiveDynamicFlexSettings(input, safetyState) {
    const requestedDynamicFlex = input.dynamicFlex === true;
    const requestedGoGo = input.goGoActive === true;
    const requestedGoGoMultiplier = Number.isFinite(input.goGoMultiplier) ? input.goGoMultiplier : 1.0;
    const goGoAge = Number.isFinite(input.goGoAge)
        ? input.goGoAge
        : Math.max(input.aktuellesAlter || 0, input.partnerAlter || 0);
    const goGoAgeExceeded = goGoAge > 80;
    const stage = _sanitizeSafetyStage(safetyState?.stage);
    const safetyEnabled = (CONFIG.SPENDING_MODEL?.DYNAMIC_FLEX_SAFETY?.ENABLED ?? DYNAMIC_FLEX_SAFETY_DEFAULTS.ENABLED) === true;

    const effective = {
        stage,
        stageLabel: VPW_SAFETY_STAGE_LABELS[stage] || VPW_SAFETY_STAGE_LABELS[0],
        requestedDynamicFlex,
        requestedGoGo,
        requestedGoGoMultiplier,
        effectiveDynamicFlex: requestedDynamicFlex,
        effectiveGoGo: requestedGoGo && !goGoAgeExceeded,
        effectiveGoGoMultiplier: requestedGoGo && !goGoAgeExceeded ? requestedGoGoMultiplier : 1.0,
        goGoSuppressed: requestedGoGo && goGoAgeExceeded,
        dynamicFlexSuppressed: false,
        stageReason: /** @type {string|null} */ (null)
    };

    if (!safetyEnabled || !requestedDynamicFlex) {
        return effective;
    }

    if (stage >= 1 && requestedGoGo) {
        effective.effectiveGoGo = false;
        effective.effectiveGoGoMultiplier = 1.0;
        effective.goGoSuppressed = true;
        effective.stageReason = 'safety_stage_1';
    }

    if (stage >= 2) {
        effective.effectiveDynamicFlex = false;
        effective.effectiveGoGo = false;
        effective.effectiveGoGoMultiplier = 1.0;
        effective.dynamicFlexSuppressed = true;
        effective.goGoSuppressed = requestedGoGo;
        effective.stageReason = 'safety_stage_2';
    }

    return effective;
}

/** @param {import('../../typcheck/rechenkern').SafetySignals} params */
function _buildSafetySignals(params) {
    const {
        alarmActive,
        entnahmequoteDepot,
        realerDepotDrawdown,
        runwayMonate,
        minRunwayMonths,
        kuerzungProzent,
        safetyStage,
        threeBucketActive
    } = params;
    const cfg = { ...DYNAMIC_FLEX_SAFETY_DEFAULTS, ...CONFIG.SPENDING_MODEL?.DYNAMIC_FLEX_SAFETY };
    const hasRunwayCrisis = Number.isFinite(runwayMonate) && Number.isFinite(minRunwayMonths) && runwayMonate < minRunwayMonths;
    const hasCriticalStress = alarmActive || hasRunwayCrisis;
    const stage = _sanitizeSafetyStage(safetyStage);
    const ignoreStage2SelfCut = stage >= 2 && !hasCriticalStress;
    const ignoreStage2DrawdownForRecovery = ignoreStage2SelfCut && threeBucketActive === true;

    let score = 0;
    if (alarmActive) score += 2;
    if (Number.isFinite(entnahmequoteDepot) && entnahmequoteDepot >= CONFIG.THRESHOLDS.CAUTION.withdrawalRate) score += 1;
    if (Number.isFinite(realerDepotDrawdown) && realerDepotDrawdown >= CONFIG.THRESHOLDS.ALARM.realDrawdown) score += 1;
    if (hasRunwayCrisis) score += 1;
    if (!ignoreStage2SelfCut && Number.isFinite(kuerzungProzent) && kuerzungProzent >= (Number(cfg.HARD_CUT_PCT) || DYNAMIC_FLEX_SAFETY_DEFAULTS.HARD_CUT_PCT)) score += 1;

    const badThreshold = Number(cfg.BAD_SCORE_THRESHOLD) || DYNAMIC_FLEX_SAFETY_DEFAULTS.BAD_SCORE_THRESHOLD;
    const severeThreshold = Number(cfg.SEVERE_SCORE_THRESHOLD) || DYNAMIC_FLEX_SAFETY_DEFAULTS.SEVERE_SCORE_THRESHOLD;
    const isBad = score >= badThreshold;
    const isSevere = score >= severeThreshold || (alarmActive && hasRunwayCrisis);

    const runwayHeadroom = Number(cfg.RUNWAY_HEADROOM_MONTHS) || DYNAMIC_FLEX_SAFETY_DEFAULTS.RUNWAY_HEADROOM_MONTHS;
    const goodWithdrawal = Number(cfg.GOOD_WITHDRAWAL_RATE) || DYNAMIC_FLEX_SAFETY_DEFAULTS.GOOD_WITHDRAWAL_RATE;
    const goodDrawdown = Number(cfg.GOOD_DRAWDOWN) || DYNAMIC_FLEX_SAFETY_DEFAULTS.GOOD_DRAWDOWN;
    const goodCut = Number(cfg.GOOD_CUT_PCT) || DYNAMIC_FLEX_SAFETY_DEFAULTS.GOOD_CUT_PCT;
    const hasAcceptableCutForRecovery = ignoreStage2SelfCut ||
        (Number.isFinite(kuerzungProzent) && kuerzungProzent <= goodCut);
    const hasAcceptableDrawdownForRecovery = ignoreStage2DrawdownForRecovery ||
        (Number.isFinite(realerDepotDrawdown) && realerDepotDrawdown <= goodDrawdown);
    const isGood = !alarmActive &&
        Number.isFinite(entnahmequoteDepot) && entnahmequoteDepot <= goodWithdrawal &&
        hasAcceptableDrawdownForRecovery &&
        Number.isFinite(runwayMonate) && Number.isFinite(minRunwayMonths) && runwayMonate >= (minRunwayMonths + runwayHeadroom) &&
        hasAcceptableCutForRecovery;

    return { score, isBad, isSevere, isGood, hasCriticalStress };
}

/** @param {{lastState?:EngineState|null;requestedDynamicFlex?:boolean;signals?:import('../../typcheck/rechenkern').SafetySignals}} args */
function _updateVpwSafetyState(args) {
    const cfg = { ...DYNAMIC_FLEX_SAFETY_DEFAULTS, ...CONFIG.SPENDING_MODEL?.DYNAMIC_FLEX_SAFETY };
    const prev = _loadVpwSafetyState(args?.lastState);
    const requestedDynamicFlex = args?.requestedDynamicFlex === true;
    const safetyEnabled = cfg.ENABLED === true;
    if (!safetyEnabled || !requestedDynamicFlex) {
        return { ...prev, transition: 'none', score: 0 };
    }

    const signals = _buildSafetySignals(args?.signals || {});
    let stage = prev.stage;
    let riskStreak = prev.riskStreak;
    let stableStreak = prev.stableStreak;
    let transition = 'none';

    if (signals.isBad) {
        riskStreak += 1;
        stableStreak = 0;
    } else if (signals.isGood) {
        stableStreak += 1;
        riskStreak = 0;
    } else {
        riskStreak = 0;
        stableStreak = 0;
    }

    const escalateStreak = Math.max(1, Number(cfg.ESCALATE_STREAK_YEARS) || DYNAMIC_FLEX_SAFETY_DEFAULTS.ESCALATE_STREAK_YEARS);
    const deescalateStreak = Math.max(1, Number(cfg.DEESCALATE_STREAK_YEARS) || DYNAMIC_FLEX_SAFETY_DEFAULTS.DEESCALATE_STREAK_YEARS);
    const maxStage = Math.max(0, Number(cfg.MAX_STAGE) || DYNAMIC_FLEX_SAFETY_DEFAULTS.MAX_STAGE);
    const stage2NeedsCriticalStress = cfg.STAGE2_REQUIRE_CRITICAL_STRESS !== false;

    if (signals.isSevere && stage < maxStage) {
        const wantsStage2 = stage === 1;
        if (!wantsStage2 || !stage2NeedsCriticalStress || signals.hasCriticalStress) {
            stage += 1;
            riskStreak = 0;
            stableStreak = 0;
            transition = 'up';
        }
    } else if (riskStreak >= escalateStreak && stage < maxStage) {
        const wantsStage2 = stage === 1;
        if (!wantsStage2 || !stage2NeedsCriticalStress || signals.hasCriticalStress) {
            stage += 1;
            riskStreak = 0;
            stableStreak = 0;
            transition = 'up';
        }
    } else if (stableStreak >= deescalateStreak && stage > 0) {
        stage -= 1;
        riskStreak = 0;
        stableStreak = 0;
        transition = 'down';
    }

    return {
        stage: _sanitizeSafetyStage(stage),
        riskStreak,
        stableStreak,
        transition,
        score: signals.score
    };
}

/** @param {{lastState?:EngineState|null;vpwEffectiveSettings:ReturnType<typeof _deriveEffectiveDynamicFlexSettings>;
 * diagnosis:Diagnosis;safetyRunwayMonths:number;
 * liquidityRunwayPolicy:ReturnType<typeof import('../../types/liquidity-runway-contract.js').deriveLiquidityRunwayPolicy>;
 * spendingResult:SpendingResult;normalizedInput:NormalizedEngineInput;
 * dynamicFlexSafetyCfg:typeof DYNAMIC_FLEX_SAFETY_DEFAULTS;vpwSafetyState:ReturnType<typeof _loadVpwSafetyState>;
 * neuerBedarf:number;plannedWithdrawalResolution:Extract<WithdrawalResolution,{status:'resolved'}>;
 * preTransactionRunwayMonths:number;vpwDiagnostics:VpwDiagnostics|null}} params */
export function completeSafetyDiagnosis({
    lastState, vpwEffectiveSettings, diagnosis,
    safetyRunwayMonths, liquidityRunwayPolicy, spendingResult,
    normalizedInput, dynamicFlexSafetyCfg, vpwSafetyState,
    neuerBedarf, plannedWithdrawalResolution, preTransactionRunwayMonths,
    vpwDiagnostics
}) {
    const safetyUpdate = _updateVpwSafetyState({
        lastState,
        requestedDynamicFlex: vpwEffectiveSettings.requestedDynamicFlex,
        signals: {
            alarmActive: diagnosis?.general?.alarmActive === true,
            entnahmequoteDepot: diagnosis?.keyParams?.entnahmequoteDepot,
            realerDepotDrawdown: diagnosis?.keyParams?.realerDepotDrawdown,
            runwayMonate: safetyRunwayMonths,
            minRunwayMonths: liquidityRunwayPolicy.hardMinimumMonths,
            kuerzungProzent: spendingResult?.kuerzungProzent,
            safetyStage: vpwEffectiveSettings.stage,
            threeBucketActive: normalizedInput.decumulation?.mode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE
        }
    });
    const reentryRampYears = Math.max(1, Number(dynamicFlexSafetyCfg.REENTRY_RAMP_YEARS) || DYNAMIC_FLEX_SAFETY_DEFAULTS.REENTRY_RAMP_YEARS);
    const prevReentryRemaining = Math.max(0, Number(vpwSafetyState?.reentryRemaining) || 0);
    let nextReentryRemaining = prevReentryRemaining;
    if (safetyUpdate.transition === 'up' && safetyUpdate.stage >= 2) {
        nextReentryRemaining = 0;
    } else if (safetyUpdate.transition === 'down' && vpwEffectiveSettings.stage === 2 && safetyUpdate.stage === 1) {
        nextReentryRemaining = reentryRampYears;
    } else if (vpwEffectiveSettings.stage === 1 && prevReentryRemaining > 0) {
        nextReentryRemaining = Math.max(0, prevReentryRemaining - 1);
    } else if (safetyUpdate.stage === 0) {
        nextReentryRemaining = 0;
    }
    diagnosis.general = diagnosis.general || {};
    diagnosis.general.dynamicFlexSafetyStage = vpwEffectiveSettings.stage;
    diagnosis.general.dynamicFlexSafetyLabel = vpwEffectiveSettings.stageLabel;
    diagnosis.general.dynamicFlexSafetyScore = safetyUpdate.score;
    diagnosis.general.dynamicFlexSafetyRiskStreak = safetyUpdate.riskStreak;
    diagnosis.general.dynamicFlexSafetyStableStreak = safetyUpdate.stableStreak;
    diagnosis.general.dynamicFlexSafetyTransition = safetyUpdate.transition;
    diagnosis.general.dynamicFlexSafetyReentryRemaining = nextReentryRemaining;
    diagnosis.general.dynamicFlexSafetyRunwayMonate = safetyRunwayMonths;
    diagnosis.general.dynamicFlexSafetyRunwayBasis = 'pre_policy_annual_net_need';
    diagnosis.general.dynamicFlexSafetyAnnualNeed = neuerBedarf;
    diagnosis.general.plannedAnnualWithdrawalSource = plannedWithdrawalResolution.source;
    diagnosis.general.runwayMonateVorTransaktion = preTransactionRunwayMonths;
    diagnosis.general.dynamicFlexGoGoSuppressed = vpwEffectiveSettings.goGoSuppressed;
    diagnosis.general.dynamicFlexSuppressed = vpwEffectiveSettings.dynamicFlexSuppressed;
    if (safetyUpdate.transition === 'up') {
        diagnosis.decisionTree.push({
            step: 'Dynamic-Flex Safety',
            impact: `Sicherheitsstufe erhöht (${vpwEffectiveSettings.stageLabel} → ${VPW_SAFETY_STAGE_LABELS[safetyUpdate.stage]}).`,
            status: 'active',
            severity: 'guardrail'
        });
    } else if (safetyUpdate.transition === 'down') {
        diagnosis.decisionTree.push({
            step: 'Dynamic-Flex Safety',
            impact: `Sicherheitsstufe reduziert (${vpwEffectiveSettings.stageLabel} → ${VPW_SAFETY_STAGE_LABELS[safetyUpdate.stage]}).`,
            status: 'active',
            severity: 'info'
        });
    } else if (vpwEffectiveSettings.stage > 0 && vpwEffectiveSettings.requestedDynamicFlex) {
        diagnosis.decisionTree.push({
            step: 'Dynamic-Flex Safety',
            impact: `Sicherheitsstufe aktiv (${vpwEffectiveSettings.stageLabel}).`,
            status: 'active',
            severity: 'guardrail'
        });
    }
    if (vpwDiagnostics?.reentryApplied) {
        diagnosis.decisionTree.push({
            step: 'Dynamic-Flex Re-Entry',
            impact: `Stufe-2-Rückkehr wird gedämpft (Blend ${(/** @type {number} */ (vpwDiagnostics.reentryBlendWeight) * 100).toFixed(0)}%).`,
            status: 'active',
            severity: 'guardrail'
        });
    }

    return { safetyUpdate, nextReentryRemaining };
}
