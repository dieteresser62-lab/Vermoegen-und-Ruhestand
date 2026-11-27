// @ts-check
/** @import {SimulationLog,HistoricalYear,CareMeta,LifeLogContext,DeathLogContext,TailRiskOverlay,YearOutcome} from '../../../typcheck/rechenkern' */
import { createMinimumFlexTracker } from '../minimum-flex-metrics.js';
import { createMonteCarloCareNeedTracker } from '../mc-run-metrics.js';
import { createEuroPathTracker } from '../mc-euro-metrics.js';
import { STRESS_PRESETS, annualData, BREAK_ON_RUIN } from '../simulator-data.js';
import { makeRunSeed, rng } from '../simulator-utils.js';
import { comparisonRandomSource } from '../decision-comparison-random.js';
import { createTailRiskSchedule } from '../tail-risk-overlay.js';
import { pickMonteCarloStartYearIndex, recordMonteCarloSamplingStartV1, initializeMonteCarloSamplingStateV1 } from '../mc-year-sampling.js';
import { initMcRunState } from '../simulator-engine-wrapper.js';
import { portfolioTotal } from '../simulator-results.js';
import { createWealthFanPath } from '../wealth-fan-aggregation.js';
import { sumDepot } from '../simulator-portfolio.js';
import { createMonteCarloLifeState } from '../mc-life-events.js';
import { cloneStressContext } from '../simulator-run-utils.js';
import { createMonteCarloStressTracker } from '../mc-stress-tracker.js';
import { buildHealthBucketDiagnostics } from '../simulator-health-bucket.js';
import { prepareAnnualLife } from './annual-life.js';
import { decideAnnualYear } from './annual-decision.js';
import { recordAnnualResult } from './annual-result.js';
import { continuePostRuin, advancePostRuinCarePricing } from './post-ruin.js';
import { completePath } from './path-completion.js';
import { createPersonEventYears } from '../mc-person-outcomes.js';
/** @typedef {ReturnType<typeof createPathContext>} PathContext
 * @typedef {PathContext & {
 *   simulationsJahr:number;
 *   yearData:HistoricalYear;
 *   tailRiskOverlay:TailRiskOverlay & {yearData:HistoricalYear};
 *   ageP1:number;
 *   ageP2:number;
 *   isAccumulation:boolean|undefined;
 *   yearCareP1:CareMeta|null;
 *   yearCareP2:CareMeta|null;
 *   totalCareFloor:number;
 *   effectiveFlexFactor:number;
 *   resolvedCapeRatio:number;
 *   result:YearOutcome;
 *   lifeLogContext:LifeLogContext|null;
 *   careCostP1:ReturnType<typeof import('../simulator-engine-wrapper.js').calcCareCost>;
 *   careCostP2:ReturnType<typeof import('../simulator-engine-wrapper.js').calcCareCost>|null;
 * }} YearContext */
/** @param {import('./chunk.js').ChunkContext} context
 * @param {number} i */
export function createPathContext(context, i) {
    const runIdx = context.runStart + i;
    let failed = false, totalTaxesThisRun = 0, totalTaxSavedByLossCarryThisRun = 0, kpiJahreMitKuerzungDieserLauf = 0, kpiMaxKuerzungDieserLauf = 0;
    let cutYearsNumeratorThisRun = 0;
    let cutDecisionYearsThisRun = 0;
    const minimumFlexTracker = createMinimumFlexTracker();
    let lebensdauer = 0, jahreOhneFlex = 0, triggeredAge = null;
    let careEverActive = false;
    const careNeedTracker = createMonteCarloCareNeedTracker();
    let technicalPathError = null;
    const realWithdrawalsThisRun = /** @type {number[]} */ ([]);
    const euroTracker = createEuroPathTracker(STRESS_PRESETS[/** @type {string} */ (context.inputs.stressPreset)]?.years || 0);
    let withdrawalRateSumThisRun = 0;
    let withdrawalRateObservationCountThisRun = 0;
    let equityLogReturnSum = 0;
    let equityReturnYears = 0;

    const runSeed = makeRunSeed(context.seed, 0, runIdx);
    const rand = /** @type {import('../../../typcheck/rechenkern-integration').ComparisonRandomSource} */ (comparisonRandomSource)(context.legacyRand || rng(runSeed), context.comparisonPairing, runIdx, runSeed);
    const tailRiskSchedule = createTailRiskSchedule(runSeed, context.inputs, context.maxDauer).schedule;

    const startYearIndex = pickMonteCarloStartYearIndex({
        rand,
        inputs: context.inputs,
        annualData,
        useCapeSampling: context.useCapeSampling,
        excludeEstimatedHistory: context.excludeEstimatedHistory,
        yearSamplingConfig: context.yearSamplingConfig,
        startYearCdf: context.startYearCdf,
        minStartYearIndex: context.minStartYearIndex,
        samplingContract: context.samplingResolution
    });
    recordMonteCarloSamplingStartV1(context.samplingDiagnostics, annualData[startYearIndex]);

    let simState = /** @type {import('../../../typcheck/rechenkern-integration').InitMcRunState} */ (initMcRunState)(context.inputs, startYearIndex);
    initializeMonteCarloSamplingStateV1({
        state: simState,
        method: context.methode,
        blockSize: context.blockSize,
        rand,
        startYearIndex,
        samplingResolution: context.samplingResolution,
        annualData
    });

    const initialPortfolioTotal = portfolioTotal(simState.portfolio);
    const wealthFanPath = context.wealthFan ? createWealthFanPath(context.maxDauer, initialPortfolioTotal) : null;
    const displayHomeValuePath = context.displayHomeValueFan ? Object.fromEntries(['nominal', 'real', 'selfNominal', 'selfReal'].map(key => [key, new Float64Array(context.maxDauer + 1).fill(NaN)])) : null;
    if (displayHomeValuePath) {
        displayHomeValuePath.nominal[0] = displayHomeValuePath.real[0] = (context.inputs.home || []).reduce((sum, home) => sum + home.wert, 0);
        displayHomeValuePath.selfNominal[0] = displayHomeValuePath.selfReal[0] = (context.inputs.home || []).filter(home => home.nutzung === 'selbst').reduce((sum, home) => sum + home.wert, 0);
    }
    const depotWertHistorie = [initialPortfolioTotal];
    const depotWertHistorieReal = [initialPortfolioTotal];
    let realDrawdownInflationComplete = true;
    const shouldLogRun = !context.logIndexSet || context.logIndexSet.has(runIdx);
    const currentRunLog = /** @type {SimulationLog[]|null} */ (shouldLogRun ? [] : null);
    const tailRiskEntriesThisRun = /** @type {TailRiskOverlay[]} */ ([]);
    let depotNurHistorie = [sumDepot(simState.portfolio)];
    let depotErschoepfungAlterGesetzt = false;
    // Track dynamic transition year (can be shortened by care event)
    let effectiveTransitionYear = context.inputs.transitionYear ?? 0;

    const lifeState = createMonteCarloLifeState(context.inputs, rand, context.widowOptions);
    const { careMetaP1, careMetaP2, hasPartner } = lifeState;
    const rngCareP1 = lifeState.rngCareP1;
    const rngCareP2 = lifeState.rngCareP2;
    let p1Alive = lifeState.p1Alive;
    let p2Alive = lifeState.p2Alive;
    let p1CareYears = 0;
    let p2CareYears = 0;
    let bothCareYears = 0;
    let triggeredAgeP2 = null;
    let runEndedBecauseAllDied = false;
    let deathLogContext = null;
    let p1ActiveThisYear = /** @type {boolean|undefined} */ (false);
    let p2ActiveThisYear = /** @type {boolean|undefined} */ (false);
    let widowBenefitActiveForP1 = false;
    let widowBenefitActiveForP2 = false;
    const householdContext = lifeState.householdContext;
    let previousDynamicHorizon = null;
    let wasJointAliveAtPreviousHorizon = hasPartner && p1Alive && p2Alive;
    let longevityTransitionStartYear = null;
    let longevityTransitionAnchorHorizon = null;

    let stressCtx = /** @type {import('../../../typcheck/rechenkern-integration').CloneStressContext} */ (cloneStressContext)(context.stressCtxMaster);

    const stressTracker = createMonteCarloStressTracker(context.stressCtxMaster, portfolioTotal(simState.portfolio));

    let retirementYearCounter = 0; // Track years in retirement for heatmap alignment
    let runSafetyStage1Ever = false;
    let runSafetyStage2Ever = false;
    const initialBucket = buildHealthBucketDiagnostics({ inputs: context.inputs, portfolio: simState.portfolio });
    let healthBucketEnabledThisRun = initialBucket.enabled;
    let healthBucketUsedThisRun = 0;
    let healthBucketEndThisRun = initialBucket.currentAmount;
    let healthBucketCoveragePctThisRun = initialBucket.realCoveragePct;
    let healthBucketTargetGapThisRun = initialBucket.targetGap;
    let healthBucketInterestThisRun = 0;

    let postRuinCarePricing = null;
    return {
        ...context, i, runIdx, failed, totalTaxesThisRun, totalTaxSavedByLossCarryThisRun,
        personEventYears: context.personOutcomeCounts ? createPersonEventYears() : null,
        kpiJahreMitKuerzungDieserLauf, kpiMaxKuerzungDieserLauf, cutYearsNumeratorThisRun, cutDecisionYearsThisRun,
        minimumFlexTracker, lebensdauer, jahreOhneFlex, triggeredAge: /** @type {number|null} */ (triggeredAge),
        careEverActive, careNeedTracker,
        technicalPathError: /** @type {import('../../../typcheck/rechenkern').TechnicalPathError|null} */ (technicalPathError),
        realWithdrawalsThisRun, euroTracker, withdrawalRateSumThisRun, withdrawalRateObservationCountThisRun,
        equityLogReturnSum, equityReturnYears, runSeed, rand, tailRiskSchedule, startYearIndex, simState,
        initialPortfolioTotal, wealthFanPath, displayHomeValuePath, depotWertHistorie, depotWertHistorieReal,
        realDrawdownInflationComplete, shouldLogRun, currentRunLog, tailRiskEntriesThisRun, depotNurHistorie,
        depotErschoepfungAlterGesetzt, effectiveTransitionYear, lifeState, careMetaP1, careMetaP2, hasPartner, rngCareP1,
        rngCareP2, p1Alive, p2Alive, p1CareYears, p2CareYears, bothCareYears,
        triggeredAgeP2: /** @type {number|null} */ (triggeredAgeP2), runEndedBecauseAllDied,
        deathLogContext: /** @type {DeathLogContext|null} */ (deathLogContext), p1ActiveThisYear, p2ActiveThisYear,
        widowBenefitActiveForP1, widowBenefitActiveForP2, householdContext,
        previousDynamicHorizon: /** @type {number|null} */ (previousDynamicHorizon), wasJointAliveAtPreviousHorizon,
        longevityTransitionStartYear: /** @type {number|null} */ (longevityTransitionStartYear),
        longevityTransitionAnchorHorizon: /** @type {number|null} */ (longevityTransitionAnchorHorizon), stressCtx,
        stressTracker, retirementYearCounter, runSafetyStage1Ever, runSafetyStage2Ever, initialBucket,
        healthBucketEnabledThisRun, healthBucketUsedThisRun, healthBucketEndThisRun, healthBucketCoveragePctThisRun,
        healthBucketTargetGapThisRun, healthBucketInterestThisRun, careAidSumThisRun: 0, careAidFirstYearThisRun: 0,
        droppedExpenseSumThisRun: 0, droppedExpenseFirstYearThisRun: 0,
        postRuinCarePricing: /** @type {ReturnType<typeof advancePostRuinCarePricing>|null} */ (postRuinCarePricing)
    };
}

/** @param {import('./chunk.js').ChunkContext} chunk
 * @param {number} i */
export function runMonteCarloPath(chunk, i) {
    const context = /** @type {YearContext} */ (createPathContext(chunk, i));
    for (context.simulationsJahr = 0; context.simulationsJahr < context.maxDauer; context.simulationsJahr++) {
        prepareAnnualLife(context);
        if (decideAnnualYear(context)) break;
        if (recordAnnualResult(context)) break;
    }
    continuePostRuin(context);
    completePath(context);
}
