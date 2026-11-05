// @ts-check
/** @import {SimulatorInputs,SimulationState,Random,CareMeta} from '../../../typcheck/rechenkern' */
import { advanceSimulatorCumulativeInflationFactor } from '../simulator-engine-helpers.js';
import { resolveSimulatorCumulativeInflationFactor, updateCareMeta, computeCareMortalityMultiplier, sampleNextYearData, resolveMonteCarloCape } from '../simulator-engine-wrapper.js';
import { euros } from '../simulator-engine-direct-utils.js';
import { resolveSimulatorMortalityProbability, priceMonteCarloCareForYear, createMonteCarloPostRuinLifeState, updateMonteCarloLifeEventsForYear } from '../mc-life-events.js';
import { recordWealthFanYear, createWealthFanPath } from '../wealth-fan-aggregation.js';
import { recordEuroZeroWithdrawal } from '../mc-euro-metrics.js';
import { recordMonteCarloStressZeroWithdrawal } from '../mc-stress-tracker.js';
import { BREAK_ON_RUIN, annualData } from '../simulator-data.js';
import { deriveStressReplayShadowSeed } from '../stress-replay-path-materializer.js';
import { rng } from '../simulator-utils.js';
import { createTailRiskSchedule, applyTailRiskOverlay } from '../tail-risk-overlay.js';
import { cloneStressContext } from '../simulator-sweep-utils.js';
import { throwIfMonteCarloAborted } from './batch.js';
import { sampleMonteCarloYearV1 } from '../mc-year-sampling.js';
import { cloneReplayValue, createReplayStressEvents, createReplayHouseholdEvent, createReplayAnnualRecord } from './replay-records.js';
import { applyStressOverride } from '../simulator-portfolio.js';
import { buildNextMarketDataHist } from '../simulator-year-portfolio.js';
/** @param {import('../../../typcheck/rechenkern').StressContext|null} stressCtx */
export function shouldUseStressBootstrap(stressCtx) {
    return stressCtx?.type === 'conditional_bootstrap' && stressCtx.remainingYears > 0;
}

// Nach Ruin gibt es keinen finanziellen Folgezustand. Für die Pflege im
// Replay-Schattenpfad läuft die Preisbasis wie im normalen Jahreswechsel weiter.
/** @param {Pick<SimulationState,'baseFloor'|'baseFlex'|'cumulativeInflationFactor'>} state
 * @param {number} inflation */
export function advancePostRuinCarePricing(state, inflation) {
    const annualFactor = 1 + inflation / 100;
    return {
        cumulativeInflationFactor: advanceSimulatorCumulativeInflationFactor(
            resolveSimulatorCumulativeInflationFactor(state), inflation),
        baseFloor: euros(state.baseFloor * annualFactor),
        baseFlex: euros(state.baseFlex * annualFactor)
    };
}

/** @param {{inputs:SimulatorInputs;startSimulationYear:number;maxDauer:number;p1Alive:boolean;p2Alive:boolean;careMetaP1:CareMeta|null;careMetaP2:CareMeta|null;rngCareP1:Random;rngCareP2:Random|null;rand:Random;effectiveTransitionYear:number;carePricingState:Partial<SimulationState>|null;realWithdrawals:number[];euroTracker:import('../../../typcheck/rechenkern').EuroTracker;stressTracker:import('../../../typcheck/rechenkern').StressTracker;wealthFanPath:ReturnType<typeof createWealthFanPath>|null;comparisonPairing:import('../../../typcheck/rechenkern').ComparisonPairing|null;runIdx:number}} options */
export function appendPostRuinZeroWithdrawals({
    inputs,
    startSimulationYear,
    maxDauer,
    p1Alive: initialP1Alive,
    p2Alive: initialP2Alive,
    careMetaP1,
    careMetaP2,
    rngCareP1,
    rngCareP2,
    rand,
    effectiveTransitionYear: initialTransitionYear,
    carePricingState,
    realWithdrawals,
    euroTracker,
    stressTracker,
    wealthFanPath,
    comparisonPairing,
    runIdx
}) {
    let p1Alive = initialP1Alive;
    let p2Alive = initialP2Alive;
    let effectiveTransitionYear = initialTransitionYear;
    const postRuinCareP1 = careMetaP1 ? { ...careMetaP1 } : null;
    const postRuinCareP2 = careMetaP2 ? { ...careMetaP2 } : null;
    const neutralYearData = { inflation: 0 };

    for (let simulationsJahr = startSimulationYear; simulationsJahr < maxDauer; simulationsJahr++) {
        rand.comparisonPhase?.(`life:${simulationsJahr}`);
        const previouslyJointAlive = p1Alive && p2Alive;
        const ageP1 = inputs.startAlter + simulationsJahr;
        const ageP2 = inputs.partner?.aktiv
            ? inputs.partner.startAlter + simulationsJahr
            : ageP1;

        if (p1Alive && postRuinCareP1) {
            /** @type {import('../../../typcheck/rechenkern-integration').UpdateCareMeta} */ (updateCareMeta)(postRuinCareP1, inputs, ageP1, neutralYearData, rngCareP1, carePricingState, simulationsJahr, true);
        }
        if (p2Alive && postRuinCareP2) {
            /** @type {import('../../../typcheck/rechenkern-integration').UpdateCareMeta} */ (updateCareMeta)(postRuinCareP2, inputs, ageP2, neutralYearData, rngCareP2, carePricingState, simulationsJahr, true);
        }
        if (inputs.accumulationPhase?.enabled && simulationsJahr < effectiveTransitionYear
            && ((p1Alive && postRuinCareP1?.active) || (p2Alive && postRuinCareP2?.active))) {
            effectiveTransitionYear = simulationsJahr;
        }
        const isAccumulation = inputs.accumulationPhase?.enabled
            && simulationsJahr < effectiveTransitionYear;

        if (!isAccumulation && p1Alive) {
            let qx1 = resolveSimulatorMortalityProbability(inputs.geschlecht, ageP1);
            const careFactorP1 = /** @type {import('../../../typcheck/rechenkern-integration').ComputeCareMortalityMultiplier} */ (computeCareMortalityMultiplier)(postRuinCareP1);
            if (careFactorP1 > 1) qx1 = Math.min(1, qx1 * careFactorP1);
            if (rand() < qx1) p1Alive = false;
        }
        if (!isAccumulation && p2Alive) {
            const p2Gender = inputs.partner?.geschlecht || (inputs.geschlecht === 'm' ? 'w' : 'm');
            let qx2 = resolveSimulatorMortalityProbability(p2Gender, ageP2);
            const careFactorP2 = /** @type {import('../../../typcheck/rechenkern-integration').ComputeCareMortalityMultiplier} */ (computeCareMortalityMultiplier)(postRuinCareP2);
            if (careFactorP2 > 1) qx2 = Math.min(1, qx2 * careFactorP2);
            if (rand() < qx2) p2Alive = false;
        }

        priceMonteCarloCareForYear(inputs, postRuinCareP1, postRuinCareP2, carePricingState, simulationsJahr,
            p1Alive, p2Alive, previouslyJointAlive);
        comparisonPairing?.onYear?.({ runIndex: runIdx, yearIndex: simulationsJahr, historicalYear: null,
            p1Alive, p2Alive, careP1: postRuinCareP1?.grade ?? 0, careP2: postRuinCareP2?.grade ?? 0 });
        if (!p1Alive && !p2Alive) break;
        recordWealthFanYear(wealthFanPath, simulationsJahr + 1, 0, 0, true);
        if (!isAccumulation) {
            realWithdrawals.push(0);
            recordEuroZeroWithdrawal(euroTracker, simulationsJahr);
            recordMonteCarloStressZeroWithdrawal(stressTracker, simulationsJahr);
        }
    }
}

/** @param {import('./path-state.js').YearContext} context */
export function continuePostRuin(context) {

    const endedEarlyBecauseOfRuin = context.failed && BREAK_ON_RUIN && !context.technicalPathError;
    const shouldCapturePostRuinContinuation = Boolean(
        context.replayCapture
        && endedEarlyBecauseOfRuin
        && context.replayCapture.years.length < context.maxDauer
    );

    if (endedEarlyBecauseOfRuin) {
        if (context.comparisonPairing?.mode === 'record') context.comparisonPairing.continuationYears.set(context.runIdx, context.lebensdauer);
        appendPostRuinZeroWithdrawals({
            inputs: context.inputs,
            startSimulationYear: context.lebensdauer,
            maxDauer: context.maxDauer,
            p1Alive: context.p1Alive,
            p2Alive: context.p2Alive,
            careMetaP1: context.careMetaP1,
            careMetaP2: context.careMetaP2,
            rngCareP1: context.rngCareP1,
            rngCareP2: context.rngCareP2,
            rand: context.rand,
            effectiveTransitionYear: context.effectiveTransitionYear,
            carePricingState: context.postRuinCarePricing,
            realWithdrawals: context.realWithdrawalsThisRun,
            euroTracker: context.euroTracker,
            stressTracker: context.stressTracker,
            wealthFanPath: context.wealthFanPath,
            comparisonPairing: context.comparisonPairing,
            runIdx: context.runIdx
        });
    }

    if (shouldCapturePostRuinContinuation) {
        const shadowSeed = deriveStressReplayShadowSeed({
            seed: context.seed >>> 0,
            absoluteRunIndex: context.runIdx
        });
        const shadowRand = rng(shadowSeed);
        const shadowTailRiskSchedule = createTailRiskSchedule(shadowSeed, context.inputs, context.maxDauer).schedule;
        const shadowLifeState = createMonteCarloPostRuinLifeState(context.inputs, shadowRand, {
            widowOptions: context.widowOptions,
            p1Alive: context.p1Alive,
            p2Alive: context.p2Alive,
            careMetaP1: context.careMetaP1,
            careMetaP2: context.careMetaP2,
            p1CareYears: context.p1CareYears,
            p2CareYears: context.p2CareYears,
            bothCareYears: context.bothCareYears,
            triggeredAgeP2: context.triggeredAgeP2,
            widowBenefitActiveForP1: context.widowBenefitActiveForP1,
            widowBenefitActiveForP2: context.widowBenefitActiveForP2
        });
        const shadowStressCtx = /** @type {import('../../../typcheck/rechenkern-integration').CloneStressContext} */ (cloneStressContext)(context.stressCtx);
        let shadowTriggeredAge = context.triggeredAge;
        let shadowCareEverActive = context.careEverActive;
        let shadowEffectiveTransitionYear = context.effectiveTransitionYear;
        let shadowCarePricing = context.postRuinCarePricing;
        /** @type {NonNullable<typeof context.replayCapture>} */ (context.replayCapture).continuation = {
            .../** @type {NonNullable<typeof context.replayCapture>} */ (context.replayCapture).continuation,
            active: true,
            shadowSeed,
            startsAtYearIndex: /** @type {NonNullable<typeof context.replayCapture>} */ (context.replayCapture).years.length
        };

        for (let shadowYearIndex = /** @type {NonNullable<typeof context.replayCapture>} */ (context.replayCapture).years.length; shadowYearIndex < context.maxDauer; shadowYearIndex++) {
            throwIfMonteCarloAborted(context.signal);
            const conditionalStressActive = shouldUseStressBootstrap(shadowStressCtx);
            const samplingStep = sampleMonteCarloYearV1({
                state: context.simState,
                method: context.methode,
                blockSize: context.blockSize,
                rand: shadowRand,
                stressContext: shadowStressCtx,
                conditionalStressActive,
                samplingResolution: context.samplingResolution,
                annualData,
                sampleNextYearData
            });
            const beforeStress = cloneReplayValue(samplingStep.yearData);
            let shadowYearData = applyStressOverride(samplingStep.yearData, shadowStressCtx, shadowRand);
            const shadowStressEvents = createReplayStressEvents(
                beforeStress,
                shadowYearData,
                shadowStressCtx,
                context.inputs?.stressPreset
            );
            const shadowTailRiskOverlay = /** @type {import('../../../typcheck/rechenkern-integration').ApplyTailRiskOverlay} */ (/** @type {unknown} */ (applyTailRiskOverlay))(
                shadowYearData,
                shadowTailRiskSchedule[shadowYearIndex] ?? null,
                {
                    runIdx: context.runIdx,
                    simulationsJahr: shadowYearIndex,
                    methode: context.methode,
                    stressPreset: context.inputs?.stressPreset
                }
            );
            shadowYearData = shadowTailRiskOverlay.yearData;
            const resolvedCapeRatio = resolveMonteCarloCape(
                shadowYearData,
                context.inputs,
                context.simState.marketDataHist
            );
            shadowYearData.capeRatio = resolvedCapeRatio;

            const shadowLifeYear = updateMonteCarloLifeEventsForYear(
                shadowLifeState,
                context.inputs,
                context.widowOptions,
                shadowYearIndex,
                shadowYearData,
                shadowEffectiveTransitionYear,
                shadowTriggeredAge,
                shadowCareEverActive,
                shadowRand,
                shadowCarePricing ?? {}
            );
            shadowEffectiveTransitionYear = shadowLifeYear.effectiveTransitionYear;
            shadowTriggeredAge = shadowLifeYear.triggeredAge;
            shadowCareEverActive = shadowLifeYear.careEverActive;
            const shadowHouseholdEvent = createReplayHouseholdEvent({
                p1Alive: shadowLifeState.p1Alive,
                p2Alive: shadowLifeState.p2Alive,
                hasPartner: shadowLifeState.hasPartner,
                careMetaP1: shadowLifeYear.householdContext.care.p1,
                careMetaP2: shadowLifeYear.householdContext.care.p2,
                p1ActiveThisYear: shadowLifeState.p1ActiveThisYear,
                p2ActiveThisYear: shadowLifeState.p2ActiveThisYear,
                effectiveFlexFactor: shadowLifeYear.effectiveFlexFactor,
                totalCareFloor: shadowLifeYear.totalCareFloor,
                widowBenefitActiveForP1: shadowLifeState.widowBenefitActiveForP1,
                widowBenefitActiveForP2: shadowLifeState.widowBenefitActiveForP2,
                effectiveTransitionYear: shadowEffectiveTransitionYear
            });
            const recordType = shadowLifeState.runEndedBecauseAllDied
                ? 'terminal_death'
                : 'financial_year';
            /** @type {NonNullable<typeof context.replayCapture>} */ (context.replayCapture).years.push(createReplayAnnualRecord({
                yearIndex: shadowYearIndex,
                yearData: shadowYearData,
                recordType,
                stressEvents: shadowStressEvents,
                tailRiskOverlay: shadowTailRiskOverlay,
                householdEvent: shadowHouseholdEvent,
                continuation: true
            }));
            if (shadowLifeState.runEndedBecauseAllDied) break;
            if (shadowCarePricing) {
                shadowCarePricing = advancePostRuinCarePricing(shadowCarePricing, shadowYearData.inflation);
            }
            context.simState.marketDataHist = buildNextMarketDataHist({
                marketDataHist: context.simState.marketDataHist,
                yearData: shadowYearData,
                rA: Number(shadowYearData.rendite),
                resolvedCapeRatio
            });
        }
    }
}
