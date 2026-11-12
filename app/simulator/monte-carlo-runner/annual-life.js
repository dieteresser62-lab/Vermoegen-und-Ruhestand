// @ts-check

import { throwIfMonteCarloAborted } from './batch.js';
import { shouldUseStressBootstrap } from './post-ruin.js';
import { sampleMonteCarloYearV1, recordMonteCarloSampledYearV1 } from '../mc-year-sampling.js';
import { annualData } from '../simulator-data.js';
import { sampleNextYearData, updateCareMeta, computeCareMortalityMultiplier, endCareForDeceased, calcCareCost, computeHouseholdFlexFactor } from '../simulator-engine-wrapper.js';
import { cloneReplayValue, createReplayStressEvents, createReplayHouseholdEvent } from './replay-records.js';
import { applyStressOverride } from '../simulator-portfolio.js';
import { applyTailRiskOverlay } from '../tail-risk-overlay.js';
import { computeMarriageYearsCompleted } from '../simulator-sweep-utils.js';
import { priceMonteCarloCareForYear } from '../mc-life-events.js';
import { applyCareTodayMortalityFloor, resolveBaseMortalityProbability } from '../target-mortality.js';
import { resolveSurvivorFlexFactors } from '../simulator-survivor.js';
/** @param {import('./path-state.js').YearContext} context */
export function prepareAnnualLife(context) {
    const { rand } = context;
    throwIfMonteCarloAborted(context.signal);
    context.lebensdauer = context.simulationsJahr + 1;
    rand.comparisonPhase?.(`market:${context.simulationsJahr}`);

    const conditionalStressActive = shouldUseStressBootstrap(context.stressCtx);
    const samplingStep = sampleMonteCarloYearV1({
        state: context.simState,
        method: context.methode,
        blockSize: context.blockSize,
        rand: rand,
        stressContext: context.stressCtx,
        conditionalStressActive,
        samplingResolution: context.samplingResolution,
        annualData,
        sampleNextYearData
    });
    context.yearData = samplingStep.yearData;
    recordMonteCarloSampledYearV1(context.samplingDiagnostics, {
        yearData: context.yearData,
        source: samplingStep.source,
        stationaryRestartReason: samplingStep.stationaryRestartReason
    });
    // PE-1/MP-1: Die Tiefkopie wird nur bei einer Replay-Aufzeichnung gelesen.
    const yearDataBeforeStress = context.replayCapture ? cloneReplayValue(context.yearData) : null;
    context.yearData = applyStressOverride(context.yearData, context.stressCtx, rand);
    context.replayStressEvents = context.replayCapture
        ? createReplayStressEvents(/** @type {NonNullable<typeof yearDataBeforeStress>} */ (yearDataBeforeStress), context.yearData, context.stressCtx, context.inputs?.stressPreset)
        : null;
    context.tailRiskOverlay = /** @type {import('../../../typcheck/rechenkern-integration').ApplyTailRiskOverlay} */ (/** @type {unknown} */ (applyTailRiskOverlay))(context.yearData, context.tailRiskSchedule[context.simulationsJahr] ?? null, {
        runIdx: context.runIdx,
        simulationsJahr: context.simulationsJahr,
        methode: context.methode,
        stressPreset: context.inputs?.stressPreset
    });
    context.yearData = context.tailRiskOverlay.yearData;
    context.tailRiskEntriesThisRun.push(context.tailRiskOverlay);
    rand.comparisonPhase?.(`life:${context.simulationsJahr}`);

    const previouslyJointAlive = context.p1Alive && context.p2Alive;
    context.ageP1 = context.inputs.startAlter + context.simulationsJahr;
    const marriageYearsCompleted = computeMarriageYearsCompleted(context.simulationsJahr, context.widowOptions);
    const widowModeEnabled = context.widowOptions.mode === 'percent' && context.widowOptions.percent > 0 && context.hasPartner;
    const widowEligibleThisYear = widowModeEnabled &&
        marriageYearsCompleted > 0 &&
        marriageYearsCompleted >= context.widowOptions.minMarriageYears;
    context.ageP2 = context.ageP1;
    if (context.inputs.partner?.aktiv) {
        context.ageP2 = context.inputs.partner.startAlter + context.simulationsJahr;
    }

    if (context.p1Alive) {
        /** @type {import('../../../typcheck/rechenkern-integration').UpdateCareMeta} */ (updateCareMeta)(context.careMetaP1, context.inputs, context.ageP1, context.yearData, context.rngCareP1, context.simState, context.simulationsJahr, true);
        if (context.careMetaP1 && context.careMetaP1.active) context.careEverActive = true;
        if (context.careMetaP1 && context.careMetaP1.triggered && context.triggeredAge === null) context.triggeredAge = context.ageP1;
    }

    if (context.p2Alive && context.careMetaP2) {
        /** @type {import('../../../typcheck/rechenkern-integration').UpdateCareMeta} */ (updateCareMeta)(context.careMetaP2, context.inputs, context.ageP2, context.yearData, context.rngCareP2, context.simState, context.simulationsJahr, true);
        if (context.careMetaP2 && context.careMetaP2.triggered && context.triggeredAgeP2 === null) {
            context.triggeredAgeP2 = context.ageP2;
        }
        if (context.careMetaP2 && context.careMetaP2.active) context.careEverActive = true;
    }

    if (context.inputs.accumulationPhase?.enabled && context.simulationsJahr < context.effectiveTransitionYear) {
        if ((context.p1Alive && context.careMetaP1?.active) || (context.p2Alive && context.careMetaP2?.active)) {
            context.effectiveTransitionYear = context.simulationsJahr;
        }
    }

    context.p1ActiveThisYear = context.p1Alive && context.careMetaP1?.active;
    context.p2ActiveThisYear = context.p2Alive && context.careMetaP2?.active;
    if (context.p2ActiveThisYear) context.careEverActive = true;

    context.isAccumulation = context.inputs.accumulationPhase?.enabled && context.simulationsJahr < context.effectiveTransitionYear;

    if (!context.isAccumulation && context.p1Alive) {
        let qx1 = resolveBaseMortalityProbability(context.inputs, 0, context.inputs.geschlecht, context.ageP1);
        const careFactorP1 = /** @type {import('../../../typcheck/rechenkern-integration').ComputeCareMortalityMultiplier} */ (computeCareMortalityMultiplier)(context.careMetaP1);
        if (careFactorP1 > 1) {
            qx1 = Math.min(1.0, qx1 * careFactorP1);
        }
        qx1 = applyCareTodayMortalityFloor(qx1, context.careMetaP1, context.inputs, 0, context.inputs.geschlecht, context.ageP1);
        if (rand() < qx1) {
            context.p1Alive = false;
        }
    }

    if (!context.isAccumulation && context.p2Alive) {
        const p2Gender = context.inputs.partner?.geschlecht || (context.inputs.geschlecht === 'm' ? 'w' : 'm');
        let qx2 = resolveBaseMortalityProbability(context.inputs, 1, p2Gender, context.ageP2);
        const careFactorP2 = /** @type {import('../../../typcheck/rechenkern-integration').ComputeCareMortalityMultiplier} */ (computeCareMortalityMultiplier)(context.careMetaP2);
        if (careFactorP2 > 1) {
            qx2 = Math.min(1.0, qx2 * careFactorP2);
        }
        qx2 = applyCareTodayMortalityFloor(qx2, context.careMetaP2, context.inputs, 1, p2Gender, context.ageP2);
        if (rand() < qx2) {
            context.p2Alive = false;
        }
    }

    priceMonteCarloCareForYear(context.inputs, context.careMetaP1, context.careMetaP2, context.simState, context.simulationsJahr,
        context.p1Alive, context.p2Alive, previouslyJointAlive);
    context.comparisonPairing?.onYear?.({ runIndex: context.runIdx, yearIndex: context.simulationsJahr, historicalYear: context.yearData.jahr,
        p1Alive: context.p1Alive, p2Alive: context.p2Alive, careP1: context.careMetaP1?.grade ?? 0, careP2: context.careMetaP2?.grade ?? 0 });

    // Diagnosejahre zählen im Sterbejahr jeweils ein halbes Jahr.
    if (context.p1ActiveThisYear) context.p1CareYears += context.p1Alive ? 1 : .5;
    if (context.p2ActiveThisYear) context.p2CareYears += context.p2Alive ? 1 : .5;
    if (context.p1ActiveThisYear && context.p2ActiveThisYear) context.bothCareYears += context.p1Alive && context.p2Alive ? 1 : .5;

    if (widowEligibleThisYear && (!context.p1Alive || !context.p2Alive)) {
        if (!context.p1Alive && context.p2Alive) {
            context.widowBenefitActiveForP2 = true;
        } else if (!context.p2Alive && context.p1Alive) {
            context.widowBenefitActiveForP1 = true;
        }
    }

    if (!context.p1Alive && !context.p2Alive) {
        context.runEndedBecauseAllDied = true;
        context.deathLogContext = {
            jahr: context.simulationsJahr + 1,
            histJahr: context.yearData.jahr,
            inflation: context.yearData.inflation,
            tailRiskOverlay: context.tailRiskOverlay
        };
    }

    context.yearCareP1 = !context.p1Alive && context.careMetaP1?.active ? { ...context.careMetaP1 } : context.careMetaP1;
    context.yearCareP2 = !context.p2Alive && context.careMetaP2?.active ? { ...context.careMetaP2 } : context.careMetaP2;
    endCareForDeceased(context.careMetaP1, context.p1Alive);
    endCareForDeceased(context.careMetaP2, context.p2Alive);
    context.p1ActiveThisYear = context.p1Alive && context.careMetaP1?.active;
    context.p2ActiveThisYear = context.p2Alive && context.careMetaP2?.active;
    context.careCostP1 = calcCareCost(context.yearCareP1, null);
    context.careCostP2 = context.yearCareP2 ? calcCareCost(context.yearCareP2, null) : null;
    context.totalCareFloor = context.careCostP1.zusatzFloor + (context.careCostP2 ? context.careCostP2.zusatzFloor : 0);
    // Ereignisfaktor nach dem Tod; die Halbjahresmischung übernimmt simulateOneYear.
    context.effectiveFlexFactor = resolveSurvivorFlexFactors(context.inputs, {
        p1Alive: context.p1Alive, p2Alive: context.p2Alive, care: { p1: context.yearCareP1, p2: context.yearCareP2 }
    }, false)?.flexFactor ?? computeHouseholdFlexFactor({
        hasPartner: context.hasPartner,
        p1Alive: context.p1Alive,
        careMetaP1: context.careMetaP1,
        p2Alive: context.p2Alive,
        careMetaP2: context.careMetaP2
    });
    context.householdContext.p1Alive = context.p1Alive;
    context.householdContext.p2Alive = context.hasPartner ? context.p2Alive : false;
    context.householdContext.widowBenefits.p1FromP2 = context.widowBenefitActiveForP1;
    context.householdContext.widowBenefits.p2FromP1 = context.widowBenefitActiveForP2;
    context.householdContext.care = {
        p1: context.yearCareP1,
        p2: context.yearCareP2
    };

    context.replayHouseholdEvent = context.replayCapture ? createReplayHouseholdEvent({
        p1Alive: context.p1Alive,
        p2Alive: context.p2Alive,
        hasPartner: context.hasPartner,
        careMetaP1: context.yearCareP1,
        careMetaP2: context.yearCareP2,
        p1ActiveThisYear: context.p1ActiveThisYear,
        p2ActiveThisYear: context.p2ActiveThisYear,
        effectiveFlexFactor: context.effectiveFlexFactor,
        totalCareFloor: context.totalCareFloor,
        widowBenefitActiveForP1: context.widowBenefitActiveForP1,
        widowBenefitActiveForP2: context.widowBenefitActiveForP2,
        effectiveTransitionYear: context.effectiveTransitionYear
    }) : null;
}
