// @ts-check

import { commitWealthFanPath } from '../wealth-fan-aggregation.js';
import { commitHomeWealthFan } from '../wealth-home-fan.js';
import { MONTE_CARLO_MISSINGNESS_CODE, MONTE_CARLO_OUTCOME_CODE } from '../monte-carlo-chunk-result.js';
import { MAX_TECHNICAL_ERROR_SAMPLES } from './batch.js';
import { recordMonteCarloPathSummaryV1 } from '../monte-carlo-chunk-result.js';
import { finalizeMinimumFlexPath } from '../minimum-flex-metrics.js';
import { resolveMonteCarloTerminalOutcomeV1 } from '../monte-carlo-chunk-result.js';
import { resolveStressReplayTerminalStatus } from './replay-records.js';
import { buildMonteCarloDeathLogRow } from '../mc-log-builder.js';
import { computeRunStatsFromSeries, resolveSimulatorCumulativeInflationFactor } from '../simulator-engine-wrapper.js';
import { writeMonteCarloStressMetrics } from '../mc-stress-tracker.js';
import { portfolioTotal } from '../simulator-results.js';
import { recordMonteCarloRunOutcome } from '../mc-run-metrics.js';
import { homeValueAtYearEnd } from '../simulator-home-sale.js';
import { finalizeEuroPath } from '../mc-euro-metrics.js';
import { quantile } from '../simulator-utils.js';
/** @param {import('./path-state.js').YearContext} context */
export function completePath(context) {

    if (context.technicalPathError) {
        commitWealthFanPath(context.wealthFan, context.wealthFanPath, true);
        commitHomeWealthFan(context.displayHomeValueFan, context.wealthFanPath, context.displayHomeValuePath, true);
        context.stress_realWithdrawalP10Missingness[context.i] = MONTE_CARLO_MISSINGNESS_CODE.TECHNICAL_ERROR;
        context.technicalInventory.technicalError++;
        if (context.technicalInventory.errors.length < MAX_TECHNICAL_ERROR_SAMPLES) {
            context.technicalInventory.errors.push(context.technicalPathError);
        }
        recordMonteCarloPathSummaryV1({
            pathSummaries: context.pathSummaries,
            pathMissingness: context.pathMissingness,
            localIndex: context.i,
            globalRunIndex: context.runIdx,
            outcomeCode: MONTE_CARLO_OUTCOME_CODE.TECHNICAL_ERROR,
            technicalError: true,
            minimumFlexRestriction: finalizeMinimumFlexPath(context.minimumFlexTracker, { technicalError: true })
        });
        return;
    }

    const terminalResolution = resolveMonteCarloTerminalOutcomeV1({
        ruinInStartedFinancialYear: context.failed,
        allDeadTiming: context.runEndedBecauseAllDied
            ? context.failed ? 'after_ruin' : 'before_next_financial_obligation'
            : null,
        horizonExhausted: !context.failed && !context.runEndedBecauseAllDied && context.lebensdauer === context.maxDauer
    });
    if (terminalResolution.outcomeCode === MONTE_CARLO_OUTCOME_CODE.TECHNICAL_ERROR) {
        commitWealthFanPath(context.wealthFan, context.wealthFanPath, true);
        commitHomeWealthFan(context.displayHomeValueFan, context.wealthFanPath, context.displayHomeValuePath, true);
        const errorCode = terminalResolution.errorCode || 'MC_TERMINAL_OUTCOME_INVALID';
        context.technicalInventory.technicalError++;
        if (context.technicalInventory.errors.length < MAX_TECHNICAL_ERROR_SAMPLES) {
            context.technicalInventory.errors.push({
                runIndex: context.runIdx,
                simulationYearIndex: Math.max(0, context.lebensdauer - 1),
                code: errorCode,
                message: `Ein Simulationspfad verletzte den terminalen Outcome-Vertrag (${errorCode}).`
            });
        }
        context.stress_realWithdrawalP10Missingness[context.i] = MONTE_CARLO_MISSINGNESS_CODE.TECHNICAL_ERROR;
        recordMonteCarloPathSummaryV1({
            pathSummaries: context.pathSummaries,
            pathMissingness: context.pathMissingness,
            localIndex: context.i,
            globalRunIndex: context.runIdx,
            outcomeCode: MONTE_CARLO_OUTCOME_CODE.TECHNICAL_ERROR,
            technicalError: true,
            minimumFlexRestriction: finalizeMinimumFlexPath(context.minimumFlexTracker, { technicalError: true })
        });
        return;
    }

    if (context.replayCapture) {
        context.replayCapture.terminalStatus = resolveStressReplayTerminalStatus(terminalResolution.outcomeCode);
        context.replayCapturesByIndex.set(context.runIdx, context.replayCapture);
    }

    context.technicalInventory.financiallyEvaluable++;
    commitWealthFanPath(context.wealthFan, context.wealthFanPath);
    commitHomeWealthFan(context.displayHomeValueFan, context.wealthFanPath, context.displayHomeValuePath);
    if (terminalResolution.outcomeCode === MONTE_CARLO_OUTCOME_CODE.RUIN) context.outcomeCounts.ruin++;
    if (terminalResolution.outcomeCode === MONTE_CARLO_OUTCOME_CODE.ALL_DEAD) context.outcomeCounts.all_dead++;
    if (terminalResolution.outcomeCode === MONTE_CARLO_OUTCOME_CODE.HORIZON_EXHAUSTED) context.outcomeCounts.horizon_exhausted++;

    if (context.runEndedBecauseAllDied) {
        // Ergänze einen letzten Log-Eintrag, damit klar ersichtlich ist, dass alle Personen verstorben sind.
        const portfolioSnapshot = context.simState?.portfolio || {};
        if (context.currentRunLog) context.currentRunLog.push(buildMonteCarloDeathLogRow({
            deathLogContext: context.deathLogContext,
            currentRunLogLength: context.currentRunLog.length,
            portfolioSnapshot,
            inputs: context.inputs,
            lifeLogContext: {
                hasPartner: context.hasPartner,
                p1Alive: context.p1Alive,
                p2Alive: context.p2Alive,
                careMetaP1: context.careMetaP1,
                careMetaP2: context.careMetaP2,
                p1ActiveThisYear: context.p1ActiveThisYear,
                p2ActiveThisYear: context.p2ActiveThisYear
            }
        }));
    }

    const { volPct, maxDDpct } = computeRunStatsFromSeries(context.depotWertHistorie);
    context.volatilities[context.i] = volPct;
    context.maxDrawdowns[context.i] = maxDDpct;
    context.realMaxDrawdownObservationCount[context.i] = context.depotWertHistorieReal.length;
    if (context.realDrawdownInflationComplete) {
        const { maxDDpct: realMaxDDpct } = computeRunStatsFromSeries(context.depotWertHistorieReal);
        context.realMaxDrawdowns[context.i] = realMaxDDpct;
        context.realMaxDrawdownMissingness[context.i] = MONTE_CARLO_MISSINGNESS_CODE.OBSERVED;
    } else {
        context.realMaxDrawdowns[context.i] = 0;
        context.realMaxDrawdownMissingness[context.i] = MONTE_CARLO_MISSINGNESS_CODE.MISSING_INFLATION;
    }

    writeMonteCarloStressMetrics(
        context.stressTracker,
        context.i,
        context.stress_maxDrawdowns,
        context.stress_timeQuoteAbove45,
        context.stress_cutYears,
        context.stress_CaR_P10_Real,
        context.stress_recoveryYears
    );
    const stressWithdrawalCount = context.stressTracker.realWithdrawals?.length || 0;
    context.stress_realWithdrawalObservationCount[context.i] = stressWithdrawalCount;
    context.stress_realWithdrawalP10Missingness[context.i] = context.stressTracker.stressYears <= 0
        ? MONTE_CARLO_MISSINGNESS_CODE.NOT_APPLICABLE
        : stressWithdrawalCount > 0
            ? MONTE_CARLO_MISSINGNESS_CODE.OBSERVED
            : terminalResolution.outcomeCode === MONTE_CARLO_OUTCOME_CODE.ALL_DEAD
                ? MONTE_CARLO_MISSINGNESS_CODE.DIED_BEFORE_FIRST_OBLIGATION
                : MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS;

    const depotOnlyEnd = context.depotNurHistorie[context.depotNurHistorie.length - 1] || 0;
    const ruinOrDepleted = context.failed || depotOnlyEnd <= context.DEPOT_DEPLETION_THRESHOLD;
    const finalValueNominalEur = context.failed ? 0 : portfolioTotal(context.simState.portfolio);
    const finalValueRealEur = finalValueNominalEur / resolveSimulatorCumulativeInflationFactor(context.simState);
    recordMonteCarloRunOutcome(context.runMetrics, {
        i: context.i,
        runIdx: context.runIdx,
        buffers: context.buffers,
        simState: context.simState,
        failed: context.failed,
        lebensdauer: context.lebensdauer,
        jahreOhneFlex: context.jahreOhneFlex,
        kpiJahreMitKuerzungDieserLauf: context.kpiJahreMitKuerzungDieserLauf,
        kpiMaxKuerzungDieserLauf: context.kpiMaxKuerzungDieserLauf,
        totalTaxesThisRun: context.totalTaxesThisRun,
        totalTaxSavedByLossCarryThisRun: context.totalTaxSavedByLossCarryThisRun,
        finalValueRealEur,
        ruinOrDepleted,
        careEverActive: context.careEverActive,
        triggeredAge: context.triggeredAge,
        triggeredAgeP2: context.triggeredAgeP2,
        p1CareYears: context.p1CareYears,
        p2CareYears: context.p2CareYears,
        bothCareYears: context.bothCareYears,
        hasPartner: context.hasPartner,
        ...context.careNeedTracker,
        runSafetyStage1Ever: context.runSafetyStage1Ever,
        runSafetyStage2Ever: context.runSafetyStage2Ever,
        healthBucketEnabledThisRun: context.healthBucketEnabledThisRun,
        healthBucketUsedThisRun: context.healthBucketUsedThisRun,
        healthBucketEndThisRun: context.healthBucketEndThisRun,
        healthBucketCoveragePctThisRun: context.healthBucketCoveragePctThisRun,
        healthBucketTargetGapThisRun: context.healthBucketTargetGapThisRun,
        healthBucketInterestThisRun: context.healthBucketInterestThisRun,
        tailRiskEntriesThisRun: context.tailRiskEntriesThisRun,
        equityLogReturnSum: context.equityLogReturnSum,
        equityReturnYears: context.equityReturnYears,
        currentRunLog: context.currentRunLog
    });
    recordMonteCarloPathSummaryV1({
        pathSummaries: context.pathSummaries,
        pathMissingness: context.pathMissingness,
        localIndex: context.i,
        globalRunIndex: context.runIdx,
        outcomeCode: terminalResolution.outcomeCode,
        finalValueNominalEur: context.finalOutcomes[context.i],
        finalValueRealEur,
        displayHomeValueNominalEur: homeValueAtYearEnd({ inputs: context.inputs, portfolio: context.simState.portfolio, survivor: context.simState.survivor,
            inflationFactor: resolveSimulatorCumulativeInflationFactor(context.simState) }),
        displayHomeValueRealEur: homeValueAtYearEnd({ inputs: context.inputs, portfolio: context.simState.portfolio, survivor: context.simState.survivor,
            inflationFactor: resolveSimulatorCumulativeInflationFactor(context.simState) }) / resolveSimulatorCumulativeInflationFactor(context.simState),
        volatilityPct: context.volatilities[context.i],
        maxDrawdownPct: context.maxDrawdowns[context.i],
        maxDrawdownRealPct: context.realDrawdownInflationComplete ? context.realMaxDrawdowns[context.i] : null,
        maxDrawdownRealObservationCount: context.realMaxDrawdownObservationCount[context.i],
        maxDrawdownRealMissingnessCode: context.realMaxDrawdownMissingness[context.i],
        cutYearsNumerator: context.cutYearsNumeratorThisRun,
        cutYearsDenominator: context.cutDecisionYearsThisRun,
        minimumFlexRestriction: finalizeMinimumFlexPath(context.minimumFlexTracker),
        euroMetrics: finalizeEuroPath(context.euroTracker),
        realWithdrawalP10RealEur: context.realWithdrawalsThisRun.length > 0
            ? /** @type {import('../../../typcheck/rechenkern-integration').Quantile} */ (quantile)(context.realWithdrawalsThisRun, 0.10)
            : null,
        realWithdrawalObservationCount: context.realWithdrawalsThisRun.length,
        meanWithdrawalRateRatio: context.withdrawalRateObservationCountThisRun > 0
            ? context.withdrawalRateSumThisRun / context.withdrawalRateObservationCountThisRun
            : null,
        withdrawalRateObservationCount: context.withdrawalRateObservationCountThisRun,
        p1CareEntryAge: context.triggeredAge,
        p2CareEntryAge: context.triggeredAgeP2,
        p1CareYears: context.p1CareYears,
        p2CareYears: context.p2CareYears,
        bothCareYears: context.bothCareYears,
        careEverActive: context.careEverActive,
        hasPartner: context.hasPartner,
        ...context.careNeedTracker,
        healthBucketEnabled: context.healthBucketEnabledThisRun,
        healthBucketUsedEur: context.healthBucketUsedThisRun,
        healthBucketEndEur: context.healthBucketEndThisRun,
        healthBucketCoveragePct: context.healthBucketCoveragePctThisRun,
        healthBucketTargetGapEur: context.healthBucketTargetGapThisRun,
        healthBucketInterestEur: context.healthBucketInterestThisRun,
        taxSavedByLossCarryEur: context.totalTaxSavedByLossCarryThisRun
    });
}
