/** @import {Needs, EngineInput, EngineState, SpendingParameters, Market, RunwayProfile, AddDecision, Trace, AlarmStatus, PlannerState, KeyParams} from '../../typcheck/rechenkern' */
import { CONFIG } from '../config.mjs';
import {
    deriveLiquidityRunwayPolicy,
    resolveLiquidityRunwayYears
} from '../../types/liquidity-runway-contract.js';

/** @param {RunwayProfile} profil
 * @param {Market} market
 * @param {EngineInput} input */
export function resolveRunwayTarget(profil, market, input) {
    const policy = deriveLiquidityRunwayPolicy(resolveLiquidityRunwayYears(input || {}).years);
    return {
        targetMonths: policy.targetMonths,
        hardMinimumMonths: policy.hardMinimumMonths,
        source: 'input:liquidityRunwayYears'
    };
}


/** @param {{decisionTree?:import('../../typcheck/rechenkern').Decision[];state:PlannerState;alarmStatus:AlarmStatus;params:SpendingParameters;guardrailDiagnostics?:import('../../typcheck/rechenkern').GuardrailDiagnostics;policyDiagnostics?:Partial<import('../../typcheck/rechenkern').PolicyResult>;diagnosisMetrics:{flexRate:number;kuerzungProzent:number;jahresentnahme:number}}} options
 * @returns {import('../../typcheck/rechenkern').Diagnosis} */
export function buildSpendingDiagnosis({
    decisionTree = [],
    state,
    alarmStatus,
    params,
    guardrailDiagnostics = {},
    policyDiagnostics = {},
    diagnosisMetrics
}) {
    const { market, runwayMonate, profil, input } = params;
    const runwayTargetInfo = resolveRunwayTarget(profil, market, input);

    const guardrailEntries = [
        {
            name: 'Entnahmequote',
            value: state.keyParams.entnahmequoteDepot,
            threshold: CONFIG.THRESHOLDS.ALARM.withdrawalRate,
            type: 'percent',
            rule: 'max'
        },
        {
            name: 'Realer Drawdown (Gesamt)',
            value: state.keyParams.realerDepotDrawdown,
            threshold: CONFIG.THRESHOLDS.ALARM.realDrawdown,
            type: 'percent',
            rule: 'max'
        },
        {
            name: 'Runway (vs. Min)',
            value: runwayMonate,
            threshold: runwayTargetInfo.hardMinimumMonths,
            type: 'months',
            rule: 'min'
        }
    ];

    if (runwayTargetInfo.targetMonths && runwayTargetInfo.targetMonths > 0) {
        guardrailEntries.push({
            name: 'Runway (vs. Ziel)',
            value: runwayMonate,
            threshold: runwayTargetInfo.targetMonths,
            type: 'months',
            rule: 'min'
        });
    }

    if (guardrailDiagnostics.cautionBudgetFloor) {
        guardrailEntries.push({
            name: 'Vorsicht beim Budget-Floor',
            ...guardrailDiagnostics.cautionBudgetFloor
        });
    }

    if (guardrailDiagnostics.budgetFloor) {
        guardrailEntries.push({
            name: 'Budget-Floor Deckung',
            ...guardrailDiagnostics.budgetFloor
        });
    }

    // PE-1/MP-1: Schleifenkopie vermeidet den generischen Spread-Pfad für
    // diesen großen internen Record; Feldreihenfolge und Werte bleiben gleich.
    const keyParams = /** @type {KeyParams} */ ({});
    for (const key of Object.keys(state.keyParams)) keyParams[key] = state.keyParams[key];
    keyParams.aktuelleFlexRate = diagnosisMetrics.flexRate;
    keyParams.kuerzungProzent = diagnosisMetrics.kuerzungProzent;
    keyParams.jahresentnahme = diagnosisMetrics.jahresentnahme;

    return {
        decisionTree,
        guardrails: guardrailEntries,
        keyParams,
        general: {
            marketSKey: market.sKey,
            marketSzenario: market.szenarioText,
            alarmActive: alarmStatus.active,
            safetyCapActive: policyDiagnostics.safetyCapActive === true,
            safetyCapFlexRatePct: Number.isFinite(policyDiagnostics.safetyCapFlexRatePct)
                ? policyDiagnostics.safetyCapFlexRatePct
                : null,
            safetyCapEffectiveFlexRatePct: Number.isFinite(policyDiagnostics.safetyCapEffectiveFlexRatePct)
                ? policyDiagnostics.safetyCapEffectiveFlexRatePct
                : null,
            safetyCapRawCandidateFlexRatePct: Number.isFinite(policyDiagnostics.safetyCapRawCandidateFlexRatePct)
                ? policyDiagnostics.safetyCapRawCandidateFlexRatePct
                : null,
            safetyCapSource: policyDiagnostics.safetyCapSource || null,
            safetyCapAnchorStage: policyDiagnostics.safetyCapAnchorStage || null,
            safetyCapBinding: policyDiagnostics.safetyCapBinding || null,
            safetyCapDeferredByRateLimit: policyDiagnostics.safetyCapDeferredByRateLimit === true,
            severeFlexEmergencyActive: policyDiagnostics.severeFlexEmergencyActive === true,
            marketExtremeBear: policyDiagnostics.marketExtremeBear === true,
            realTotalWealthDrawdownRatio: Number.isFinite(policyDiagnostics.realTotalWealthDrawdownRatio)
                ? policyDiagnostics.realTotalWealthDrawdownRatio
                : null,
            realTotalWealthDrawdownThresholdRatio: Number.isFinite(policyDiagnostics.realTotalWealthDrawdownThresholdRatio)
                ? policyDiagnostics.realTotalWealthDrawdownThresholdRatio
                : null,
            minimumFlexOverrideAllowed: policyDiagnostics.minimumFlexOverrideAllowed === true,
            alarmActiveDiagnostic: policyDiagnostics.alarmActive === true,
            withdrawalBurdenFactor: Number.isFinite(policyDiagnostics.withdrawalBurdenFactor)
                ? policyDiagnostics.withdrawalBurdenFactor
                : null,
            alarmWealthSufficient: typeof policyDiagnostics.alarmWealthSufficient === 'boolean'
                ? policyDiagnostics.alarmWealthSufficient
                : null,
            alarmWealthSufficientThreshold: Number.isFinite(policyDiagnostics.alarmWealthSufficientThreshold)
                ? policyDiagnostics.alarmWealthSufficientThreshold
                : null,
            withdrawalBurdenGateRole: policyDiagnostics.withdrawalBurdenGateRole || null,
            protectedPortfolioWithdrawalAnnual: Number.isFinite(policyDiagnostics.protectedPortfolioWithdrawalAnnual)
                ? policyDiagnostics.protectedPortfolioWithdrawalAnnual
                : null,
            protectedPortfolioWithdrawalRate: Number.isFinite(policyDiagnostics.protectedPortfolioWithdrawalRate)
                ? policyDiagnostics.protectedPortfolioWithdrawalRate
                : null,
            protectedPortfolioWithdrawalRateThreshold: Number.isFinite(policyDiagnostics.protectedPortfolioWithdrawalRateThreshold)
                ? policyDiagnostics.protectedPortfolioWithdrawalRateThreshold
                : null,
            protectedPortfolioWithdrawalCapacityCritical: policyDiagnostics.protectedPortfolioWithdrawalCapacityCritical === true,
            protectedPortfolioWithdrawalGateRole: policyDiagnostics.protectedPortfolioWithdrawalGateRole || null,
            plannedPortfolioWithdrawalAnnual: policyDiagnostics.plannedPortfolioWithdrawalAnnual,
            plannedPortfolioWithdrawalRate: policyDiagnostics.plannedPortfolioWithdrawalRate,
            plannedPortfolioWithdrawalCapacityCritical: policyDiagnostics.plannedPortfolioWithdrawalCapacityCritical === true,
            finalLimitingPolicy: policyDiagnostics.finalLimitingPolicy || null,
            floorProtectionPolicy: policyDiagnostics.floorProtectionPolicy || null,
            runwayMonate,
            runwayTargetMonate: runwayTargetInfo.targetMonths,
            runwayTargetQuelle: runwayTargetInfo.source
        }
    };
}
