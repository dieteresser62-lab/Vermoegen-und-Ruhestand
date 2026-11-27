// @ts-check
/** @import {SimulatorInputs,SimulationState,Random,CareMeta} from '../../../typcheck/rechenkern' */
import { advanceSimulatorCumulativeInflationFactor } from '../simulator-engine-helpers.js';
import { resolveSimulatorCumulativeInflationFactor, updateCareMeta, computeCareMortalityMultiplier, endCareForDeceased } from '../simulator-engine-wrapper.js';
import { euros } from '../simulator-engine-direct-utils.js';
import { priceMonteCarloCareForYear } from '../mc-life-events.js';
import { applyCareTodayMortalityFloor, resolveBaseMortalityProbability } from '../target-mortality.js';
import { recordWealthFanYear, createWealthFanPath } from '../wealth-fan-aggregation.js';
import { recordEuroZeroWithdrawal } from '../mc-euro-metrics.js';
import { recordMonteCarloStressZeroWithdrawal } from '../mc-stress-tracker.js';
import { BREAK_ON_RUIN } from '../simulator-data.js';
import { recordPersonCareStarts } from '../mc-person-outcomes.js';
/** @param {import('../../../typcheck/rechenkern').StressContext|null} stressCtx */
export function shouldUseStressBootstrap(stressCtx) {
    return stressCtx?.type === 'conditional_bootstrap' && stressCtx.remainingYears > 0;
}

// Nach Ruin gibt es keinen finanziellen Folgezustand. Für die Pflege nach dem
// Ruin läuft die Preisbasis wie im normalen Jahreswechsel weiter.
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

/** @param {{inputs:SimulatorInputs;startSimulationYear:number;maxDauer:number;p1Alive:boolean;p2Alive:boolean;careMetaP1:CareMeta|null;careMetaP2:CareMeta|null;rngCareP1:Random;rngCareP2:Random|null;rand:Random;effectiveTransitionYear:number;carePricingState:Partial<SimulationState>|null;realWithdrawals:number[];euroTracker:import('../../../typcheck/rechenkern').EuroTracker;stressTracker:import('../../../typcheck/rechenkern').StressTracker;wealthFanPath:ReturnType<typeof createWealthFanPath>|null;comparisonPairing:import('../../../typcheck/rechenkern').ComparisonPairing|null;runIdx:number;personEventYears:import('./path-state.js').PathContext['personEventYears']}} options */
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
    runIdx,
    personEventYears
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
        if (personEventYears) recordPersonCareStarts(personEventYears, simulationsJahr, postRuinCareP1?.grade, postRuinCareP2?.grade);
        if (inputs.accumulationPhase?.enabled && simulationsJahr < effectiveTransitionYear
            && ((p1Alive && postRuinCareP1?.active) || (p2Alive && postRuinCareP2?.active))) {
            effectiveTransitionYear = simulationsJahr;
        }
        const isAccumulation = inputs.accumulationPhase?.enabled
            && simulationsJahr < effectiveTransitionYear;

        if (!isAccumulation && p1Alive) {
            let qx1 = resolveBaseMortalityProbability(inputs, 0, inputs.geschlecht, ageP1);
            const careFactorP1 = /** @type {import('../../../typcheck/rechenkern-integration').ComputeCareMortalityMultiplier} */ (computeCareMortalityMultiplier)(postRuinCareP1);
            if (careFactorP1 > 1) qx1 = Math.min(1, qx1 * careFactorP1);
            qx1 = applyCareTodayMortalityFloor(qx1, postRuinCareP1, inputs, 0, inputs.geschlecht, ageP1);
            if (rand() < qx1) {
                p1Alive = false;
                if (personEventYears) personEventYears.deathP1 = simulationsJahr;
            }
        }
        if (!isAccumulation && p2Alive) {
            const p2Gender = inputs.partner?.geschlecht || (inputs.geschlecht === 'm' ? 'w' : 'm');
            let qx2 = resolveBaseMortalityProbability(inputs, 1, p2Gender, ageP2);
            const careFactorP2 = /** @type {import('../../../typcheck/rechenkern-integration').ComputeCareMortalityMultiplier} */ (computeCareMortalityMultiplier)(postRuinCareP2);
            if (careFactorP2 > 1) qx2 = Math.min(1, qx2 * careFactorP2);
            qx2 = applyCareTodayMortalityFloor(qx2, postRuinCareP2, inputs, 1, p2Gender, ageP2);
            if (rand() < qx2) {
                p2Alive = false;
                if (personEventYears) personEventYears.deathP2 = simulationsJahr;
            }
        }

        priceMonteCarloCareForYear(inputs, postRuinCareP1, postRuinCareP2, carePricingState, simulationsJahr,
            p1Alive, p2Alive, previouslyJointAlive);
        comparisonPairing?.onYear?.({ runIndex: runIdx, yearIndex: simulationsJahr, historicalYear: null,
            p1Alive, p2Alive, careP1: postRuinCareP1?.grade ?? 0, careP2: postRuinCareP2?.grade ?? 0 });
        // Wie im normalen Jahreslauf endet die Pflege einer verstorbenen Person nach ihrem Sterbejahr.
        endCareForDeceased(postRuinCareP1, p1Alive);
        endCareForDeceased(postRuinCareP2, p2Alive);
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
            runIdx: context.runIdx,
            personEventYears: context.personEventYears
        });
    }
}
