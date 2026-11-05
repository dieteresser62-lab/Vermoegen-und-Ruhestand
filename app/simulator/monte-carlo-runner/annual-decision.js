// @ts-check

import { createReplayAnnualRecord } from './replay-records.js';
import { recordMonteCarloCareNeedYear } from '../mc-run-metrics.js';
import { resolveSimulatorCumulativeInflationFactor, resolveMonteCarloCape, simulateOneYear } from '../simulator-engine-wrapper.js';
import { computeRentAdjRate } from '../simulator-portfolio.js';
import { resolveDynamicFlexRunnerHorizon } from '../dynamic-flex-runner-horizon.js';
import { normalizeTechnicalPathError } from './batch.js';
/** @param {import('./path-state.js').YearContext} context */
export function decideAnnualYear(context) {

    if (context.runEndedBecauseAllDied) {
        if (context.replayCapture) {
            context.replayCapture.years.push(createReplayAnnualRecord({
                yearIndex: context.simulationsJahr,
                yearData: context.yearData,
                recordType: 'terminal_death',
                stressEvents: context.replayStressEvents,
                tailRiskOverlay: context.tailRiskOverlay,
                householdEvent: context.replayHouseholdEvent
            }));
            context.replayCapture.sourcePrefixLength = context.replayCapture.years.length;
        }
        return true;
    }

    // Measure the exact modelled care addition passed to the engine.
    // It is a need, not an attributable depot cash flow. Real values use
    // the same start-price factor as the current simulator year.
    recordMonteCarloCareNeedYear(context.careNeedTracker, {
        p1CareAdditionalNeedNominalEur: context.careCostP1.zusatzFloor * (context.p1Alive ? 1 : .5),
        p2CareAdditionalNeedNominalEur: (context.careCostP2?.zusatzFloor || 0) * (context.p2Alive ? 1 : .5),
        priceFactor: resolveSimulatorCumulativeInflationFactor(context.simState)
    });

    // Do NOT modify simState.baseFlex permanently.
    // We pass the effectiveFlexFactor to simulateOneYear to apply it only for the current year's spending decision.
    // The simulation engine will then base the NEXT year's state on the original (unreduced) baseFlex.
    const stateWithCareFlex = {
        ...context.simState
    };

    // Berechne dynamische Rentenanpassung basierend auf Modus (fix/wage/cpi)
    const effectiveRentAdjPct = computeRentAdjRate(context.inputs, context.yearData);
    context.resolvedCapeRatio = resolveMonteCarloCape(context.yearData, context.inputs, context.simState.marketDataHist);
    const jointAliveThisYear = context.hasPartner && context.p1Alive && context.p2Alive;
    if (context.wasJointAliveAtPreviousHorizon && !jointAliveThisYear && Number.isFinite(context.previousDynamicHorizon)) {
        context.longevityTransitionStartYear = context.simulationsJahr;
        context.longevityTransitionAnchorHorizon = context.previousDynamicHorizon;
    } else if (jointAliveThisYear) {
        context.longevityTransitionStartYear = null;
        context.longevityTransitionAnchorHorizon = null;
    }
    const horizonResolution = resolveDynamicFlexRunnerHorizon(context.inputs, {
        yearIndex: context.simulationsJahr,
        ageP1: context.ageP1,
        ageP2: context.ageP2,
        p1Alive: context.p1Alive,
        p2Alive: context.p2Alive,
        applyTransitionSmoothing: context.longevityTransitionStartYear !== null,
        previousHorizon: context.longevityTransitionAnchorHorizon,
        yearsSinceTransition: context.longevityTransitionStartYear === null
            ? 0
            : context.simulationsJahr - context.longevityTransitionStartYear
    });
    const dynamicHorizonYears = horizonResolution.horizonYears;
    const adjustedInputs = {
        ...context.inputs,
        rentAdjPct: effectiveRentAdjPct,
        transitionYear: context.effectiveTransitionYear,
        capeRatio: context.resolvedCapeRatio,
        marketCapeRatio: context.resolvedCapeRatio,
        horizonYears: dynamicHorizonYears,
        guardrailPlanHorizonYears: context.inputs.horizonYears,
        ...(horizonResolution.diagnostics?.longevityMode !== 'none'
            ? { longevityHorizonDiagnostics: horizonResolution.diagnostics }
            : {})
    };
    context.previousDynamicHorizon = dynamicHorizonYears;
    context.wasJointAliveAtPreviousHorizon = jointAliveThisYear;
    context.yearData.capeRatio = context.resolvedCapeRatio;

    // Pass care floor and Flex Factor as separate parameters
    context.result = /** @type {import('../../../typcheck/rechenkern-integration').SimulateOneYear} */ (/** @type {unknown} */ (simulateOneYear))(stateWithCareFlex, adjustedInputs, context.yearData, context.simulationsJahr, context.careMetaP1, context.totalCareFloor, context.householdContext, context.effectiveFlexFactor, context.engine, null, context.chunkGuardrailPlanInputs, Boolean(context.currentRunLog));
    context.comparisonPairing?.onFinancialYear?.(context.runIdx, context.result.logData, context.simulationsJahr);
    context.lifeLogContext = context.currentRunLog ? {
        hasPartner: context.hasPartner,
        p1Alive: context.p1Alive,
        p2Alive: context.p2Alive,
        careMetaP1: context.yearCareP1,
        careMetaP2: context.yearCareP2,
        deathThisYear: context.result.logData?.SurvivorDeathYear === true
            || (!context.p1Alive && context.yearCareP1?.active === true)
            || (!context.p2Alive && context.yearCareP2?.active === true),
        effectiveFlexFactor: context.result.logData?.pflege_flex_faktor,
        p1ActiveThisYear: context.p1ActiveThisYear,
        p2ActiveThisYear: context.p2ActiveThisYear
    } : null;

    const adapterFlagsConflict = (context.result?.kind === 'success' && /** @type {boolean} */ (context.result?.isRuin) === true)
        || (context.result?.kind === 'ruin' && /** @type {boolean} */ (context.result?.isRuin) === false);
    if (adapterFlagsConflict) {
        context.technicalPathError = normalizeTechnicalPathError({
            error: {
                code: 'MC_TERMINAL_FLAGS_CONFLICT',
                message: 'Der Jahresadapter lieferte widerspruechliche Terminalflags.'
            }
        }, context.runIdx, context.simulationsJahr);
        return true;
    }

    if (context.result?.kind === 'technical_error' || context.result?.error) {
        context.technicalPathError = normalizeTechnicalPathError(context.result, context.runIdx, context.simulationsJahr);
        return true;
    }

    const realizedWithdrawalRate = Number(context.result?.logData?.entnahmequote);
    if (!context.isAccumulation && Number.isFinite(realizedWithdrawalRate)) {
        context.withdrawalRateSumThisRun += realizedWithdrawalRate;
        context.withdrawalRateObservationCountThisRun++;
    }

    if (context.result.logData?.health_bucket_enabled) {
        context.healthBucketEnabledThisRun = true;
    }
    context.healthBucketUsedThisRun += Number(context.result.logData?.health_bucket_used) || 0;
    context.healthBucketInterestThisRun += Number(context.result.logData?.health_bucket_interest) || 0;
    if (Number.isFinite(Number(context.result.logData?.health_bucket_end))) {
  context.healthBucketEndThisRun = Number(context.result.logData.health_bucket_end);
    }
    if (Number.isFinite(Number(context.result.logData?.health_bucket_real_coverage_pct))) {
        context.healthBucketCoveragePctThisRun = Number(context.result.logData.health_bucket_real_coverage_pct);
    }
    if (Number.isFinite(Number(context.result.logData?.health_bucket_target_gap))) {
        context.healthBucketTargetGapThisRun = Number(context.result.logData.health_bucket_target_gap);
    }
}
