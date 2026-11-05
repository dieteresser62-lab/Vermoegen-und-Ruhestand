/** @import {Needs, EngineInput, EngineState, SpendingParameters, Market, RunwayProfile, AddDecision, Trace, AlarmStatus, PlannerState, KeyParams} from '../../typcheck/rechenkern' */
import { CONFIG } from '../config.mjs';
import { calculateFinalWithdrawal } from './spending-policy-helpers.mjs';
import { applyFinalRateLimits } from './final-rate-policy.mjs';
import { applyFlexBudgetCap } from './flex-budget-policy.mjs';
import { SAFETY_RATE_TOLERANCE_PCT } from './flex-rate-policy.mjs';
import { ALARM_WEALTH_SUFFICIENT_FACTOR_THRESHOLD } from './alarm-policy.mjs';
import { applyMinimumFlexFloor, writeMinimumFlexDiagnostics, evaluateProtectedPortfolioWithdrawal } from './minimum-flex-policy.mjs';
import { applyGuardrails } from './spending-guardrails.mjs';

export const SPENDING_POLICY_ORDER_CONTRACT = Object.freeze({
    schemaVersion: 'SpendingPolicyOrderV2',
    steps: Object.freeze([
        'alarm',
        'guardrails',
        'minimum_flex',
        'flex_budget',
        'final_smoothing',
        'safety_cap'
    ])
});

const SAFETY_SOURCE_PRIORITY = Object.freeze({
    bear_deep: 1,
    alarm: 2,
    flex_rate_hard_cap: 3,
    spending_guardrail: 4,
    severe_bear_wealth_emergency: 5
});
const SAFETY_SOURCE_ANCHOR = Object.freeze({
    bear_deep: 'post_internal_smoothing_and_flex_rate_hard_caps',
    alarm: 'post_internal_smoothing_and_flex_rate_hard_caps',
    flex_rate_hard_cap: 'post_internal_smoothing_and_flex_rate_hard_caps',
    spending_guardrail: 'post_spending_guardrails',
    severe_bear_wealth_emergency: 'post_total_wealth_drawdown_gate'
});

/** @param {number|null|undefined} value */
function clampRate(value) {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, value));
}


/** @param {NonNullable<import('../../typcheck/rechenkern').InitialPolicy['safetyEvidence']>} evidence
 * @returns {import('../../typcheck/rechenkern').SafetyCandidate|null} */
function normalizeSafetyCandidate(evidence) {
    if (evidence?.active !== true) return null;
    const candidateFlexRatePct = clampRate(evidence.candidateFlexRatePct);
    const source = typeof evidence.source === 'string' ? evidence.source : null;
    const anchorStage = typeof evidence.anchorStage === 'string' ? evidence.anchorStage : null;
    if (
        candidateFlexRatePct === null
        || !SAFETY_SOURCE_PRIORITY[/** @type {keyof typeof SAFETY_SOURCE_PRIORITY} */ (source)]
        || anchorStage !== SAFETY_SOURCE_ANCHOR[/** @type {keyof typeof SAFETY_SOURCE_ANCHOR} */ (source)]
    ) {
        throw new RangeError('Aktive Safety-Evidenz muss endliche Rate, bekannte Quelle und Anchor-Stage enthalten.');
    }
    return /** @type {import('../../typcheck/rechenkern').SafetyCandidate} */ ({ source, candidateFlexRatePct, anchorStage, evidence });
}

/** @param {import('../../typcheck/rechenkern').SafetyCandidate[]} candidates
 * @returns {import('../../typcheck/rechenkern').SafetyCandidate|null} */
function selectStrongestSafetyCandidate(candidates) {
    return candidates.reduce((selected, candidate) => {
        if (!selected) return candidate;
        if (candidate.candidateFlexRatePct + SAFETY_RATE_TOLERANCE_PCT < selected.candidateFlexRatePct) {
            return candidate;
        }
        if (Math.abs(candidate.candidateFlexRatePct - selected.candidateFlexRatePct) <= SAFETY_RATE_TOLERANCE_PCT) {
            return SAFETY_SOURCE_PRIORITY[/** @type {keyof typeof SAFETY_SOURCE_PRIORITY} */ (candidate.source)] > SAFETY_SOURCE_PRIORITY[/** @type {keyof typeof SAFETY_SOURCE_PRIORITY} */ (selected.source)]
                ? candidate
                : selected;
        }
        return selected;
    }, /** @type {import('../../typcheck/rechenkern').SafetyCandidate|null} */ (null));
}


/** @param {PlannerState} state
 * @param {Market} market
 * @param {AlarmStatus} alarmStatus
 * @param {ReturnType<typeof evaluateProtectedPortfolioWithdrawal>} protectedWithdrawal
 * @param {{annual:number;rate:number;capacityCritical:boolean}} plannedWithdrawal */
function evaluateSevereFlexEmergency(state, market, alarmStatus, protectedWithdrawal, plannedWithdrawal) {
    const rawDrawdownRatio = state?.keyParams?.realerDepotDrawdown;
    const thresholdRatio = CONFIG.THRESHOLDS?.ALARM?.realDrawdown;
    if (!Number.isFinite(rawDrawdownRatio)) {
        throw new RangeError('Realer Gesamtvermoegensdrawdown muss fuer das Safety-Gate als endliches Ratio vorliegen.');
    }
    if (!Number.isFinite(thresholdRatio) || thresholdRatio < 0 || thresholdRatio > 1) {
        throw new RangeError('Safety-Gate-Schwelle fuer realen Gesamtvermoegensdrawdown ist ungueltig.');
    }

    // Before the yearly peak update, a new real-wealth high can transiently
    // produce a negative raw ratio. Semantically this is a 0% drawdown.
    const drawdownRatio = Math.max(0, rawDrawdownRatio);
    const marketExtremeBear = market?.sKey === 'bear_deep';
    const emergencyMarketEligible = marketExtremeBear || market?.sKey === 'recovery_in_bear';
    const protectedWithdrawalCapacityCritical = protectedWithdrawal?.capacityCritical === true;
    const active = emergencyMarketEligible
        && drawdownRatio > thresholdRatio
        && plannedWithdrawal.capacityCritical;
    const withdrawalBurdenFactor = Number.isFinite(state?.keyParams?.withdrawalBurdenFactor)
        ? Math.max(0, Math.min(1, state.keyParams.withdrawalBurdenFactor))
        : (Number.isFinite(state?.keyParams?.wealthReductionFactor)
            ? Math.max(0, Math.min(1, state.keyParams.wealthReductionFactor))
            : null);

    return {
        active,
        marketExtremeBear,
        realTotalWealthDrawdownRatio: drawdownRatio,
        realTotalWealthDrawdownThresholdRatio: thresholdRatio,
        minimumFlexOverrideAllowed: active,
        alarmActive: alarmStatus?.active === true,
        withdrawalBurdenFactor,
        alarmWealthSufficient: withdrawalBurdenFactor === null
            ? null
            : withdrawalBurdenFactor < ALARM_WEALTH_SUFFICIENT_FACTOR_THRESHOLD,
        alarmWealthSufficientThreshold: ALARM_WEALTH_SUFFICIENT_FACTOR_THRESHOLD,
        withdrawalBurdenGateRole: 'diagnostic_only',
        protectedPortfolioWithdrawalAnnual: protectedWithdrawal.annual,
        protectedPortfolioWithdrawalRate: protectedWithdrawal.rate,
        protectedPortfolioWithdrawalRateThreshold: protectedWithdrawal.criticalRate,
        protectedPortfolioWithdrawalCapacityCritical: protectedWithdrawalCapacityCritical,
        protectedPortfolioWithdrawalGateRole: 'diagnostic_only',
        plannedPortfolioWithdrawalAnnual: plannedWithdrawal.annual,
        plannedPortfolioWithdrawalRate: plannedWithdrawal.rate,
        plannedPortfolioWithdrawalCapacityCritical: plannedWithdrawal.capacityCritical
    };
}

/** @param {string[]} executedSteps */
function assertPolicyOrder(executedSteps) {
    const expectedSteps = SPENDING_POLICY_ORDER_CONTRACT.steps;
    const matchesContract = executedSteps.length === expectedSteps.length
        && executedSteps.every((step, index) => step === expectedSteps[index]);
    if (!matchesContract) {
        throw new Error(
            `Spending-Policy-Reihenfolge verletzt (${SPENDING_POLICY_ORDER_CONTRACT.schemaVersion}): `
            + `${executedSteps.join(' > ')}`
        );
    }
}

/** @param {PlannerState} state
 * @param {AlarmStatus} alarmStatus
 * @param {SpendingParameters} params
 * @param {AddDecision} addDecision
 * @param {import('../../typcheck/rechenkern').InitialPolicy} initialPolicyResult
 * @param {Trace|undefined} trace */
export function applySpendingPolicyPipeline(state, alarmStatus, params, addDecision, initialPolicyResult, trace) {
    const { inflatedBedarf, input, market } = params;
    let flexRate = initialPolicyResult.geglätteteFlexRate;
    let kuerzungQuelle = initialPolicyResult.kuerzungQuelle;
    let guardrailDiagnostics = /** @type {import('../../typcheck/rechenkern').GuardrailDiagnostics} */ ({});
    const safetyCandidates = /** @type {import('../../typcheck/rechenkern').SafetyCandidate[]} */ ([]);
    const initialSafetyCandidate = normalizeSafetyCandidate(initialPolicyResult.safetyEvidence);
    if (initialSafetyCandidate) safetyCandidates.push(initialSafetyCandidate);
    const executedSteps = ['alarm'];
    let finalLimitingPolicy = initialSafetyCandidate?.source === 'alarm'
        ? 'alarm'
        : 'initial_flex_policy';

    executedSteps.push('guardrails');
    const guardrailInputRate = flexRate;
    let guardrailRateCapApplied = false;
    let preventedFloorRaiseRatePct = 0;
    if (!alarmStatus.active) {
        const guardrailResult = applyGuardrails(
            flexRate,
            state,
            { ...params, kuerzungQuelle },
            addDecision
        );
        flexRate = guardrailResult.rate;
        kuerzungQuelle = guardrailResult.source;
        guardrailDiagnostics = guardrailResult.diagnostics || {};
        preventedFloorRaiseRatePct = guardrailResult.preventedFloorRaiseRatePct;
        guardrailRateCapApplied = Number.isFinite(guardrailInputRate)
            && Number.isFinite(flexRate)
            && flexRate + SAFETY_RATE_TOLERANCE_PCT < guardrailInputRate;
        if (guardrailRateCapApplied) {
            safetyCandidates.push({
                source: 'spending_guardrail',
                candidateFlexRatePct: flexRate,
                anchorStage: 'post_spending_guardrails',
                evidence: {
                    rateCapApplied: true,
                    inputFlexRatePct: guardrailInputRate,
                    outputFlexRatePct: flexRate
                }
            });
            finalLimitingPolicy = 'spending_guardrail';
        }
    }
    guardrailDiagnostics = {
        ...guardrailDiagnostics,
        rateCap: {
            rateCapApplied: guardrailRateCapApplied,
            inputFlexRatePct: Number.isFinite(guardrailInputRate) ? guardrailInputRate : null,
            outputFlexRatePct: Number.isFinite(flexRate) ? flexRate : null,
            tolerancePct: SAFETY_RATE_TOLERANCE_PCT
        }
    };
    trace?.record('guardrails', guardrailInputRate, flexRate, 'Guardrails', {
        wegenAlarmAusgesetzt: alarmStatus.active,
        gewaehlteQuelle: kuerzungQuelle,
        rateBegrenzt: guardrailRateCapApplied,
        budgetFloorBegrenzt: guardrailDiagnostics.cautionBudgetFloor?.details?.budgetFloorBlocked === true,
        budgetFloorGesperrt: guardrailDiagnostics.cautionBudgetFloor?.details?.budgetFloorBlocked === true
            && flexRate <= guardrailInputRate
    });
    // Die verhinderte Anhebung zählt vom hypothetisch angehobenen Floor aus.
    trace?.considerReduction('Guardrail (Vorsicht)', preventedFloorRaiseRatePct,
        guardrailInputRate + preventedFloorRaiseRatePct);

    const normalSafetyCandidate = selectStrongestSafetyCandidate(safetyCandidates);

    executedSteps.push('minimum_flex');
    const rateBeforeMinimumFlex = flexRate;
    const minimumFlexResult = applyMinimumFlexFloor(
        flexRate,
        { ...params, state, alarmStatus, kuerzungQuelle },
        addDecision
    );
    flexRate = minimumFlexResult.rate;
    trace?.record('minimum_flex', rateBeforeMinimumFlex, flexRate, 'Mindest-Flex', {
        zielEurJahr: minimumFlexResult.minimumFlexAnnual,
        offenesZielEurJahr: minimumFlexResult.minimumFlexDepotAnnual,
        erforderlicheRateProzent: minimumFlexResult.requiredRate,
        status: minimumFlexResult.status
    });
    let minimumFlexStatus = minimumFlexResult.status;
    const protectedWithdrawal = evaluateProtectedPortfolioWithdrawal(params, minimumFlexResult);
    let selectedSafetyCandidate = normalSafetyCandidate;
    let minimumFlexCanBeLimited = minimumFlexResult.minimumFlexAnnual > 0
        && minimumFlexResult.flexAnnual > 0
        && minimumFlexResult.status !== 'blocked_emergency';
    if (minimumFlexResult.applied) finalLimitingPolicy = 'minimum_flex';

    let safetyCapRawCandidateFlexRatePct = selectedSafetyCandidate?.candidateFlexRatePct ?? null;
    let safetyCapFlexRatePct = safetyCapRawCandidateFlexRatePct;
    let minimumFlexFloorAppliedToSafetyCap = false;
    if (
        selectedSafetyCandidate
        && minimumFlexCanBeLimited
        && Number.isFinite(minimumFlexResult.requiredRate)
        && /** @type {number} */ (safetyCapFlexRatePct) + SAFETY_RATE_TOLERANCE_PCT < minimumFlexResult.requiredRate
    ) {
        safetyCapFlexRatePct = minimumFlexResult.requiredRate;
        minimumFlexFloorAppliedToSafetyCap = true;
    }
    executedSteps.push('flex_budget');
    const rateBeforeFlexBudget = flexRate;
    const flexBudgetResult = applyFlexBudgetCap(
        flexRate,
        inflatedBedarf,
        input,
        state,
        market,
        addDecision
    );
    if (flexBudgetResult.applied) {
        const minimumFlexWasLimited = minimumFlexCanBeLimited &&
            Number.isFinite(minimumFlexResult.requiredRate) &&
            flexBudgetResult.rate + 0.01 < minimumFlexResult.requiredRate;
        flexRate = flexBudgetResult.rate;
        if (minimumFlexWasLimited) {
            minimumFlexStatus = 'limited_by_flex_budget';
        }
        if (kuerzungQuelle !== 'Budget-Floor') {
            kuerzungQuelle = 'Flex-Budget (Cap)';
        }
        finalLimitingPolicy = 'flex_budget';
    }
    if (Number.isFinite(flexBudgetResult.balanceYears)) {
        state.flexBudgetBalanceYears = flexBudgetResult.balanceYears;
    }
    if (state.keyParams && Number.isFinite(flexBudgetResult.minRatePct)) {
        state.keyParams.minFlexRatePct = flexBudgetResult.minRatePct;
    }
    trace?.record('flex_budget', rateBeforeFlexBudget, flexRate, 'Flex-Budget', {
        budgetEurJahr: Number(input?.flexBudgetAnnual) || 0,
        budgetrateProzent: flexBudgetResult.rate,
        mindestrateProzent: flexBudgetResult.minRatePct,
        restbudgetJahre: flexBudgetResult.balanceYears ?? null
    });

    const wealthFactor = Number.isFinite(state.keyParams?.wealthReductionFactor)
        ? Math.min(1, Math.max(0, state.keyParams.wealthReductionFactor))
        : 1;

    executedSteps.push('final_smoothing');
    const finalLimitResult = applyFinalRateLimits(
        state.flexRate ?? 100,
        flexRate,
        market,
        addDecision,
        wealthFactor,
        trace,
        state.keyParams?.entnahmequoteUsed
    );
    if (finalLimitResult.applied) {
        const minimumFlexWasSmoothed = minimumFlexCanBeLimited &&
            minimumFlexStatus !== 'limited_by_flex_budget' &&
            Number.isFinite(minimumFlexResult.requiredRate) &&
            finalLimitResult.rate + 0.01 < minimumFlexResult.requiredRate;
        flexRate = finalLimitResult.rate;
        if (minimumFlexWasSmoothed) {
            minimumFlexStatus = 'applied_limited_by_final_smoothing';
        }
        if (kuerzungQuelle !== 'Budget-Floor') {
            kuerzungQuelle = 'Glättung (Final-Guardrail)';
        }
        finalLimitingPolicy = 'final_smoothing';
    }

    executedSteps.push('safety_cap');
    const finalRateBeforeSafetyCapPct = flexRate;
    let safetyCapEffectiveFlexRatePct = safetyCapFlexRatePct;
    let safetyCapDeferredByRateLimit = false;
    if (
        selectedSafetyCandidate
        && Number.isFinite(safetyCapFlexRatePct)
    ) {
        const rateLimitedTarget = applyFinalRateLimits(
            state.flexRate ?? 100,
            safetyCapFlexRatePct,
            market,
            () => {},
            wealthFactor,
            undefined,
            state.keyParams?.entnahmequoteUsed
        );
        safetyCapEffectiveFlexRatePct = Math.max(
            safetyCapFlexRatePct,
            Number.isFinite(rateLimitedTarget.rate) ? rateLimitedTarget.rate : safetyCapFlexRatePct
        );
        safetyCapDeferredByRateLimit = safetyCapEffectiveFlexRatePct
            > safetyCapFlexRatePct + SAFETY_RATE_TOLERANCE_PCT
            && finalRateBeforeSafetyCapPct
                > safetyCapFlexRatePct + SAFETY_RATE_TOLERANCE_PCT;
    }
    let safetyCapApplied = selectedSafetyCandidate !== null
        && Number.isFinite(safetyCapEffectiveFlexRatePct)
        && flexRate > safetyCapEffectiveFlexRatePct + SAFETY_RATE_TOLERANCE_PCT;
    if (selectedSafetyCandidate && Number.isFinite(safetyCapEffectiveFlexRatePct)) {
        flexRate = Math.min(flexRate, safetyCapEffectiveFlexRatePct);
    }
    // FR-20 prüft die Auszahlung nach sämtlichen normalen Regeln samt Rundung.
    // Der normale Cap ist bereits angewendet; kein zweiter Pipeline-Durchlauf.
    const plannedAnnual = calculateFinalWithdrawal(
        inflatedBedarf, flexRate, CONFIG.ANTI_PSEUDO_ACCURACY.ENABLED
    ).endgueltigeEntnahme;
    const plannedRate = plannedAnnual <= 0 ? 0 : (params.gesamtwert > 0 ? plannedAnnual / params.gesamtwert : 1);
    const severeFlexEmergency = evaluateSevereFlexEmergency(state, market, alarmStatus, protectedWithdrawal, {
        annual: plannedAnnual,
        rate: plannedRate,
        capacityCritical: plannedRate >= protectedWithdrawal.criticalRate
    });
    const minimumFlexStatusBeforeSafetyOverride = minimumFlexStatus;
    if (severeFlexEmergency.active) {
        selectedSafetyCandidate = {
            source: 'severe_bear_wealth_emergency',
            candidateFlexRatePct: inflatedBedarf.flex > 0
                ? /** @type {number} */ (clampRate(Math.max(0, protectedWithdrawal.criticalRate * params.gesamtwert - inflatedBedarf.floor)
                    / inflatedBedarf.flex * 100))
                : 0,
            anchorStage: 'post_total_wealth_drawdown_gate',
            evidence: severeFlexEmergency
        };
        safetyCapRawCandidateFlexRatePct = /** @type {import("../../typcheck/rechenkern").SafetyCandidate} */ (selectedSafetyCandidate).candidateFlexRatePct;
        safetyCapFlexRatePct = safetyCapRawCandidateFlexRatePct;
        safetyCapEffectiveFlexRatePct = safetyCapRawCandidateFlexRatePct;
        minimumFlexFloorAppliedToSafetyCap = false;
        safetyCapDeferredByRateLimit = false;
        safetyCapApplied = flexRate > safetyCapFlexRatePct + SAFETY_RATE_TOLERANCE_PCT;
        flexRate = Math.min(flexRate, safetyCapFlexRatePct);
        minimumFlexStatus = 'overridden_by_severe_flex_emergency';
        minimumFlexCanBeLimited = false;
    }
    const safetyCapBindingApplied = safetyCapApplied || severeFlexEmergency.active;
    if (severeFlexEmergency.active) {
        finalLimitingPolicy = 'safety_cap';
        kuerzungQuelle = 'Safety-Cap (schwere Flex-Notlage)';
        addDecision(
            'Schwere Flex-Notlage',
            `Tiefer Bärenmarkt oder Erholung im Bärenmarkt, realer Drawdown des aktiven Gesamtvermögens über ${(severeFlexEmergency.realTotalWealthDrawdownThresholdRatio * 100).toFixed(1)}% und geplante tatsächliche Portfolioentnahmequote einschließlich Rundung ab ${(severeFlexEmergency.protectedPortfolioWithdrawalRateThreshold * 100).toFixed(1)}%: Flex einschließlich Mindest-Flex auf höchstens ${(inflatedBedarf.flex * flexRate / 100).toFixed(2)} € pro Jahr begrenzt; Floor bleibt unverändert.`,
            'active',
            'alarm'
        );
    } else if (safetyCapApplied) {
        finalLimitingPolicy = 'safety_cap';
        kuerzungQuelle = `Safety-Cap (${/** @type {import("../../typcheck/rechenkern").SafetyCandidate} */ (selectedSafetyCandidate).source})`;
        addDecision(
            'Safety-Obergrenze',
            `Strukturelles Signal ${/** @type {import("../../typcheck/rechenkern").SafetyCandidate} */ (selectedSafetyCandidate).source} begrenzt die finale Flex-Rate auf ${/** @type {number} */ (safetyCapEffectiveFlexRatePct).toFixed(1)}% (Policy-Ziel ${/** @type {number} */ (safetyCapFlexRatePct).toFixed(1)}%; bestehende Änderungsgrenzen bleiben erhalten).`,
            'active',
            'guardrail'
        );
    } else if (safetyCapDeferredByRateLimit && finalRateBeforeSafetyCapPct > /** @type {number} */ (safetyCapFlexRatePct) + SAFETY_RATE_TOLERANCE_PCT) {
        addDecision(
            'Safety-Ziel geglättet',
            `Policy-Ziel ${/** @type {number} */ (safetyCapFlexRatePct).toFixed(1)}% wird wegen der bestehenden Abwärtsgrenze schrittweise erreicht; aktuell ${flexRate.toFixed(1)}%.`,
            'active',
            'guardrail'
        );
    }

    const nextFlexRateSmoothingReferencePct = severeFlexEmergency.active
        ? finalRateBeforeSafetyCapPct
        : flexRate;
    trace?.record('safety_cap', finalRateBeforeSafetyCapPct, flexRate,
        severeFlexEmergency.active ? 'Schwere Flex-Notlage' : 'Safety-Obergrenze', {
            quelle: selectedSafetyCandidate?.source ?? null,
            rohzielProzent: safetyCapRawCandidateFlexRatePct,
            policyZielProzent: safetyCapFlexRatePct,
            wirksamerCapProzent: safetyCapEffectiveFlexRatePct,
            mindestFlexGeschuetzt: minimumFlexFloorAppliedToSafetyCap,
            durchAenderungsgrenzeVerschoben: safetyCapDeferredByRateLimit,
            schwereNotlage: severeFlexEmergency.active,
            drawdownRatio: severeFlexEmergency.realTotalWealthDrawdownRatio,
            geschuetzteEntnahmequoteRatio: severeFlexEmergency.protectedPortfolioWithdrawalRate,
            geplanteEntnahmequoteRatio: severeFlexEmergency.plannedPortfolioWithdrawalRate,
            vorNotlageRateProzent: finalRateBeforeSafetyCapPct
        });

    if (
        minimumFlexCanBeLimited
        && minimumFlexStatus !== 'limited_by_flex_budget'
        && minimumFlexStatus !== 'applied_limited_by_final_smoothing'
        && minimumFlexResult.targetUnattainableAtFullFlex === true
    ) {
        minimumFlexStatus = 'limited_by_available_flex';
    }
    writeMinimumFlexDiagnostics(state, {
        ...minimumFlexResult,
        rate: flexRate
    }, minimumFlexStatus);
    // Leistung: benannte Zuweisungen statt Object.assign (keyed stores schalten das
    // Objekt ab 12 Feldern außerhalb des Literals in den Wörterbuchmodus; danach sind
    // alle keyParams-Kopien langsam). Reihenfolge und Werte wie zuvor.
    const keyParams = state.keyParams;
    keyParams.safetyCapActive = selectedSafetyCandidate !== null;
    keyParams.safetyCapFlexRatePct = safetyCapFlexRatePct;
    keyParams.safetyCapEffectiveFlexRatePct = safetyCapEffectiveFlexRatePct;
    keyParams.safetyCapRawCandidateFlexRatePct = safetyCapRawCandidateFlexRatePct;
    keyParams.safetyCapSource = selectedSafetyCandidate?.source ?? null;
    keyParams.safetyCapAnchorStage = selectedSafetyCandidate?.anchorStage ?? null;
    keyParams.safetyCapApplied = safetyCapBindingApplied;
    keyParams.safetyCapBinding = {
            active: selectedSafetyCandidate !== null,
            source: selectedSafetyCandidate?.source ?? null,
            rawCandidateFlexRatePct: safetyCapRawCandidateFlexRatePct,
            policyTargetFlexRatePct: safetyCapFlexRatePct,
            effectiveCapFlexRatePct: safetyCapEffectiveFlexRatePct,
            minimumFlexFloorApplied: minimumFlexFloorAppliedToSafetyCap,
            finalRateBeforeCapPct: Number.isFinite(finalRateBeforeSafetyCapPct)
                ? finalRateBeforeSafetyCapPct
                : null,
            finalRateAfterCapPct: Number.isFinite(flexRate) ? flexRate : null,
            capApplied: safetyCapBindingApplied,
            deferredByRateLimit: safetyCapDeferredByRateLimit,
            tolerancePct: SAFETY_RATE_TOLERANCE_PCT
        };
    keyParams.safetyCapDeferredByRateLimit = safetyCapDeferredByRateLimit;
    keyParams.spendingGuardrailRateCapApplied = guardrailRateCapApplied;
    keyParams.severeFlexEmergencyActive = severeFlexEmergency.active;
    keyParams.marketExtremeBear = severeFlexEmergency.marketExtremeBear;
    keyParams.realTotalWealthDrawdownRatio = severeFlexEmergency.realTotalWealthDrawdownRatio;
    keyParams.realTotalWealthDrawdownThresholdRatio = severeFlexEmergency.realTotalWealthDrawdownThresholdRatio;
    keyParams.minimumFlexOverrideAllowed = severeFlexEmergency.minimumFlexOverrideAllowed;
    keyParams.minimumFlexStatusBeforeSafetyOverride = severeFlexEmergency.active
            ? minimumFlexStatusBeforeSafetyOverride
            : null;
    keyParams.alarmActiveDiagnostic = severeFlexEmergency.alarmActive;
    keyParams.withdrawalBurdenFactor = severeFlexEmergency.withdrawalBurdenFactor;
    keyParams.alarmWealthSufficient = severeFlexEmergency.alarmWealthSufficient;
    keyParams.alarmWealthSufficientThreshold = severeFlexEmergency.alarmWealthSufficientThreshold;
    keyParams.withdrawalBurdenGateRole = severeFlexEmergency.withdrawalBurdenGateRole;
    keyParams.protectedPortfolioWithdrawalAnnual = severeFlexEmergency.protectedPortfolioWithdrawalAnnual;
    keyParams.protectedPortfolioWithdrawalRate = severeFlexEmergency.protectedPortfolioWithdrawalRate;
    keyParams.protectedPortfolioWithdrawalRateThreshold = severeFlexEmergency.protectedPortfolioWithdrawalRateThreshold;
    keyParams.protectedPortfolioWithdrawalCapacityCritical = severeFlexEmergency.protectedPortfolioWithdrawalCapacityCritical;
    keyParams.protectedPortfolioWithdrawalGateRole = severeFlexEmergency.protectedPortfolioWithdrawalGateRole;
    keyParams.plannedPortfolioWithdrawalAnnual = severeFlexEmergency.plannedPortfolioWithdrawalAnnual;
    keyParams.plannedPortfolioWithdrawalRate = severeFlexEmergency.plannedPortfolioWithdrawalRate;
    keyParams.plannedPortfolioWithdrawalCapacityCritical = severeFlexEmergency.plannedPortfolioWithdrawalCapacityCritical;
    keyParams.finalLimitingPolicy = finalLimitingPolicy;
    keyParams.floorProtectionPolicy = 'planned_floor_unchanged';
    keyParams.nextFlexRateSmoothingReferencePct = nextFlexRateSmoothingReferencePct;
    assertPolicyOrder(executedSteps);

    return {
        flexRate,
        kuerzungQuelle,
        guardrailDiagnostics,
        safetyCapActive: selectedSafetyCandidate !== null,
        safetyCapFlexRatePct,
        safetyCapEffectiveFlexRatePct,
        safetyCapRawCandidateFlexRatePct,
        safetyCapSource: selectedSafetyCandidate?.source ?? null,
        safetyCapBinding: state.keyParams.safetyCapBinding,
        safetyCapAnchorStage: selectedSafetyCandidate?.anchorStage ?? null,
        safetyCapApplied: safetyCapBindingApplied,
        safetyCapDeferredByRateLimit,
        severeFlexEmergencyActive: severeFlexEmergency.active,
        marketExtremeBear: severeFlexEmergency.marketExtremeBear,
        realTotalWealthDrawdownRatio: severeFlexEmergency.realTotalWealthDrawdownRatio,
        realTotalWealthDrawdownThresholdRatio: severeFlexEmergency.realTotalWealthDrawdownThresholdRatio,
        minimumFlexOverrideAllowed: severeFlexEmergency.minimumFlexOverrideAllowed,
        alarmActive: severeFlexEmergency.alarmActive,
        withdrawalBurdenFactor: severeFlexEmergency.withdrawalBurdenFactor,
        alarmWealthSufficient: severeFlexEmergency.alarmWealthSufficient,
        alarmWealthSufficientThreshold: severeFlexEmergency.alarmWealthSufficientThreshold,
        withdrawalBurdenGateRole: severeFlexEmergency.withdrawalBurdenGateRole,
        protectedPortfolioWithdrawalAnnual: severeFlexEmergency.protectedPortfolioWithdrawalAnnual,
        protectedPortfolioWithdrawalRate: severeFlexEmergency.protectedPortfolioWithdrawalRate,
        protectedPortfolioWithdrawalRateThreshold: severeFlexEmergency.protectedPortfolioWithdrawalRateThreshold,
        protectedPortfolioWithdrawalCapacityCritical: severeFlexEmergency.protectedPortfolioWithdrawalCapacityCritical,
        protectedPortfolioWithdrawalGateRole: severeFlexEmergency.protectedPortfolioWithdrawalGateRole,
        plannedPortfolioWithdrawalAnnual: severeFlexEmergency.plannedPortfolioWithdrawalAnnual,
        plannedPortfolioWithdrawalRate: severeFlexEmergency.plannedPortfolioWithdrawalRate,
        plannedPortfolioWithdrawalCapacityCritical: severeFlexEmergency.plannedPortfolioWithdrawalCapacityCritical,
        finalLimitingPolicy,
        floorProtectionPolicy: 'planned_floor_unchanged',
        nextFlexRateSmoothingReferencePct,
        policyOrder: Object.freeze({
            schemaVersion: SPENDING_POLICY_ORDER_CONTRACT.schemaVersion,
            executedSteps: Object.freeze([...executedSteps])
        })
    };
}
