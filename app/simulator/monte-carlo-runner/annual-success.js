// @ts-check
/** @import {YearSuccess} from '../../../typcheck/rechenkern' */
import { recordEuroFinancialYear } from '../mc-euro-metrics.js';
import { resolveSimulatorCumulativeInflationFactor } from '../simulator-engine-wrapper.js';
import { recordMinimumFlexYear } from '../minimum-flex-metrics.js';
import { sumDepot } from '../simulator-portfolio.js';
import { MC_HEATMAP_BINS } from '../monte-carlo-runner-utils.js';
import { portfolioTotal } from '../simulator-results.js';
import { recordWealthFanYear } from '../wealth-fan-aggregation.js';
import { recordMonteCarloStressYear } from '../mc-stress-tracker.js';
import { buildMonteCarloYearLogRow } from '../mc-log-builder.js';
import { createReplayAnnualRecord } from './replay-records.js';
/** @param {import('./path-state.js').YearContext & {result:import('../../../typcheck/rechenkern').YearSuccess}} context */
export function recordSuccessfulYear(context) {
    context.simState = context.result.newState;
    // Nur vollständig gerechnete Finanzjahre, ohne Todes-/Ruinzeile.
    context.equityLogReturnSum += Math.log1p(context.yearData.rendite);
    context.equityReturnYears++;
    recordEuroFinancialYear(context.euroTracker, context.result.logData, context.result.totalTaxesThisYear, context.simulationsJahr,
        Number.isFinite(context.yearData.inflation) ? resolveSimulatorCumulativeInflationFactor(context.simState) : NaN);
    context.totalTaxesThisRun += context.result.totalTaxesThisYear;
    context.totalTaxSavedByLossCarryThisRun += Number(context.result.logData?.taxSavedByLossCarry) || 0;
    const cutPct = context.result.logData.flex_wunsch_haushalt_nominal > 0 ? Number(context.result.logData.entscheidung.kuerzungProzent) : 0;
    if (!context.isAccumulation) recordMinimumFlexYear(context.minimumFlexTracker, context.result.logData);
    if (Number.isFinite(cutPct)) {
        if (cutPct >= 10) context.kpiJahreMitKuerzungDieserLauf++;
        if (!context.isAccumulation) {
            context.cutDecisionYearsThisRun++;
            if (cutPct >= 10) context.cutYearsNumeratorThisRun++;
        }
        context.kpiMaxKuerzungDieserLauf = Math.max(context.kpiMaxKuerzungDieserLauf, cutPct);
    }

    const depotOnlyNow = sumDepot(context.simState.portfolio);
    context.depotNurHistorie.push(depotOnlyNow);

    if (!context.depotErschoepfungAlterGesetzt && depotOnlyNow <= context.DEPOT_DEPLETION_THRESHOLD) {
        context.alterBeiErschoepfung[context.i] = context.ageP1;
        context.alterBeiErschoepfungMissingness[context.i] = 1;
        context.depotErschoepfungAlterGesetzt = true;
    }

    if (/** @type {number} */ (context.result.logData.FlexRatePct) <= 0.1) {
        context.jahreOhneFlex++;
    }

    context.runMetrics.totalSimulatedYears++;
    if (context.result.logData.entnahmequote * 100 > 4.5) context.runMetrics.totalYearsQuoteAbove45++;
    const vpwPayload = context.result.ui?.vpw || null;
    const vpwSafetyStage = Number(vpwPayload?.safetyStage);
    if (Number.isFinite(vpwSafetyStage)) {
        if (vpwSafetyStage >= 1) {
            context.runMetrics.totalYearsSafetyStage1plus++;
            context.runSafetyStage1Ever = true;
        }
        if (vpwSafetyStage >= 2) {
            context.runMetrics.totalYearsSafetyStage2++;
            context.runSafetyStage2Ever = true;
        }
    }
    if (!context.isAccumulation && Number.isFinite(Number(context.result.logData.jahresentnahme_real))) {
        context.realWithdrawalsThisRun.push(Number(context.result.logData.jahresentnahme_real));
    }

    if (!context.isAccumulation && context.retirementYearCounter < 10) {
        const quote = context.result.logData.entnahmequote * 100;
        for (let b = 0; b < MC_HEATMAP_BINS.length - 1; b++) {
            if (quote >= MC_HEATMAP_BINS[b] && quote < MC_HEATMAP_BINS[b + 1]) { context.heatmap[context.retirementYearCounter][b]++; break; }
        }
        context.retirementYearCounter++;
    }

    const currentPortfolioTotal = portfolioTotal(context.simState.portfolio);
    context.depotWertHistorie.push(currentPortfolioTotal);
    if (context.realDrawdownInflationComplete) {
        if (typeof context.yearData.inflation === 'number' && Number.isFinite(context.yearData.inflation)) {
            context.depotWertHistorieReal.push(
                currentPortfolioTotal / resolveSimulatorCumulativeInflationFactor(context.simState)
            );
        } else {
            context.realDrawdownInflationComplete = false;
        }
    }
    if (context.displayHomeValuePath) {
        const factor = resolveSimulatorCumulativeInflationFactor(context.simState);
        const home = /** @type {number} */ (context.result.logData?.immobilien_wert_end);
        context.displayHomeValuePath.nominal[context.simulationsJahr + 1] = home;
        context.displayHomeValuePath.real[context.simulationsJahr + 1] = context.realDrawdownInflationComplete ? home / factor : NaN;
        const self = /** @type {number} */ (context.result.logData?.immobilien_selbst_end);
        context.displayHomeValuePath.selfNominal[context.simulationsJahr + 1] = self;
        context.displayHomeValuePath.selfReal[context.simulationsJahr + 1] = context.realDrawdownInflationComplete ? self / factor : NaN;
    }
    recordWealthFanYear(context.wealthFanPath, context.simulationsJahr + 1, currentPortfolioTotal,
        context.realDrawdownInflationComplete ? context.depotWertHistorieReal.at(-1) : NaN);

    if (context.stressTracker.stressYears > 0) {
        recordMonteCarloStressYear(
            context.stressTracker,
            context.simulationsJahr,
            portfolioTotal(context.simState.portfolio),
            context.result.logData,
            { realWithdrawalObserved: !context.isAccumulation }
        );
    }

    if (context.currentRunLog) context.currentRunLog.push(buildMonteCarloYearLogRow(/** @type {Parameters<typeof buildMonteCarloYearLogRow>[0]} */ ({
        simulationsJahr: context.simulationsJahr,
        yearData: context.yearData,
        result: context.result,
        lifeLogContext: context.lifeLogContext,
        tailRiskOverlay: context.tailRiskOverlay
    })));
    if (context.replayCapture) {
        context.replayCapture.years.push(createReplayAnnualRecord({
            yearIndex: context.simulationsJahr,
            yearData: context.yearData,
            recordType: 'financial_year',
            stressEvents: context.replayStressEvents,
            tailRiskOverlay: context.tailRiskOverlay,
            householdEvent: context.replayHouseholdEvent
        }));
        context.replayCapture.sourcePrefixLength = context.replayCapture.years.length;
    }
}
