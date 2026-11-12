// @ts-check
/** @import {SweepFingerprint,SweepRiskDiagnostics,SweepChunkOptions,SimulatorInputs,SamplingDiagnostics} from '../../../typcheck/rechenkern' */
import { COMMON_RANDOM_NUMBER_COMBINATION_COORDINATE } from './provenance.js';
import { beginSweepFingerprintRun, recordSweepFingerprintYear } from './fingerprint.js';
import { beginSweepHouseholdRiskTrace, recordSweepHouseholdRiskYear, finalizeSweepRunRiskDiagnostics } from './household-risk.js';
import { mergeApplicableRunwayMinimum, readApplicableRunwayMonths } from './runway.js';
import { rng, makeRunSeed } from '../simulator-utils.js';
import { computeRentAdjRate, applyStressOverride, buildStressContext } from '../simulator-portfolio.js';
import { annualData } from '../simulator-data.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../mc-life-events.js';
import { simulateOneYear, initMcRunState, sampleNextYearData, computeRunStatsFromSeries, resolveMonteCarloCape } from '../simulator-engine-wrapper.js';
import { portfolioTotal, aggregateSweepMetrics } from '../simulator-results.js';
import { resolveDynamicFlexRunnerHorizon } from '../dynamic-flex-runner-horizon.js';
import { applyTailRiskOverlay, createTailRiskSchedule } from '../tail-risk-overlay.js';
import { initializeMonteCarloSamplingStateV1, pickMonteCarloStartYearIndex, recordMonteCarloSampledYearV1, recordMonteCarloSamplingStartV1, sampleMonteCarloYearV1, buildYearSamplingConfig, resolveMonteCarloSamplingContractV1 } from '../mc-year-sampling.js';
import { cloneStressContext } from '../simulator-sweep-utils.js';
import { isFirstDeathYear, savedHomeFloorShares } from '../simulator-survivor.js';

/** @param {import('../../../typcheck/rechenkern').StressContext|null} stressContext */
function isConditionalStressActive(stressContext) {
    return stressContext?.type === 'conditional_bootstrap'
        && stressContext.remainingYears > 0;
}

/** @param {{
 * baseSeed:number;
 * i:number;
 * inputs:SimulatorInputs;
 * maxDauer:number;
 * useCapeSampling:boolean;
 * excludeEstimatedHistory:boolean;
 * yearSamplingConfig:ReturnType<typeof buildYearSamplingConfig>;
 * samplingResolution:ReturnType<typeof resolveMonteCarloSamplingContractV1>;
 * samplingDiagnostics:SamplingDiagnostics;
 * methode:string;
 * blockSize:number;
 * samplingFingerprint:SweepFingerprint;
 * householdRiskDiagnostics:SweepRiskDiagnostics;
 * stressCtxMaster:ReturnType<typeof buildStressContext>;
 * comboIdx:number;
 * engine:SweepChunkOptions['engine'];
 * widowOptions:ReturnType<import('../../../typcheck/rechenkern-integration').NormalizeWidowOptions>;
 * runOutcomes:Parameters<typeof aggregateSweepMetrics>[0];
 * invalidComboReason:string;
 * }} context */
export function runSweepSimulation({
    baseSeed, i, inputs, maxDauer, useCapeSampling, excludeEstimatedHistory,
    yearSamplingConfig, samplingResolution, samplingDiagnostics, methode, blockSize,
    samplingFingerprint, householdRiskDiagnostics, stressCtxMaster, comboIdx, engine,
    widowOptions, runOutcomes, invalidComboReason
}) {
    const runSeed = makeRunSeed(
        baseSeed,
        COMMON_RANDOM_NUMBER_COMBINATION_COORDINATE,
        i
    );
    const rand = rng(runSeed);
    const tailRiskPlan = createTailRiskSchedule(runSeed, inputs, maxDauer);
    const tailRiskEntriesThisRun = [];
    let failed = false;
    let totalTaxSavedByLossCarryThisRun = 0;
    const startYearIndex = pickMonteCarloStartYearIndex({
        rand,
        inputs,
        annualData,
        useCapeSampling,
        excludeEstimatedHistory,
        yearSamplingConfig,
        samplingContract: samplingResolution
    });
    recordMonteCarloSamplingStartV1(samplingDiagnostics, annualData[startYearIndex]);
    let simState = /** @type {import('../../../typcheck/rechenkern-integration').InitMcRunState} */ (initMcRunState)(inputs, startYearIndex);
    initializeMonteCarloSamplingStateV1({
        state: simState,
        method: methode,
        blockSize,
        rand,
        startYearIndex,
        samplingResolution,
        annualData
    });
    const fingerprintTrace = beginSweepFingerprintRun(samplingFingerprint, i);
    const householdRiskTrace = beginSweepHouseholdRiskTrace(
        householdRiskDiagnostics,
        i,
        tailRiskPlan
    );

    const depotWertHistorie = [portfolioTotal(simState.portfolio)];
    let stressCtx = /** @type {import('../../../typcheck/rechenkern-integration').CloneStressContext} */ (cloneStressContext)(stressCtxMaster);

    let minRunway = null;
    let effectiveTransitionYear = inputs.transitionYear ?? 0;
    let triggeredAge = null;
    let careEverActive = false;
    const lifeState = createMonteCarloLifeState(inputs, rand, widowOptions);
    let previousDynamicHorizon = null;
    let wasJointAliveAtPreviousHorizon = lifeState.hasPartner
        && lifeState.p1Alive
        && lifeState.p2Alive;
    let longevityTransitionStartYear = null;
    let longevityTransitionAnchorHorizon = null;
    let previousLife = {
        p1Alive: lifeState.p1Alive,
        p2Alive: lifeState.p2Alive,
        p1CareActive: false,
        p2CareActive: false,
        widowP1Active: false,
        widowP2Active: false,
        horizonYears: null
    };

    for (let simulationsJahr = 0; simulationsJahr < maxDauer; simulationsJahr++) {
        const samplingStep = sampleMonteCarloYearV1({
            state: simState,
            method: methode,
            blockSize,
            rand,
            stressContext: stressCtx,
            conditionalStressActive: isConditionalStressActive(stressCtx),
            samplingResolution,
            annualData,
            sampleNextYearData
        });
        let yearData = samplingStep.yearData;
        recordMonteCarloSampledYearV1(samplingDiagnostics, {
            yearData,
            source: samplingStep.source,
            stationaryRestartReason: samplingStep.stationaryRestartReason
        });
        recordSweepFingerprintYear(samplingFingerprint, fingerprintTrace, yearData);
        yearData = applyStressOverride(yearData, stressCtx, rand);
        const tailRiskOverlay = /** @type {import('../../../typcheck/rechenkern-integration').ApplyTailRiskOverlay} */ (/** @type {unknown} */ (applyTailRiskOverlay))(
            yearData,
            tailRiskPlan.schedule[simulationsJahr] ?? null,
            {
                runIdx: i,
                combinationIndex: comboIdx,
                simulationsJahr,
                methode,
                stressPreset: inputs?.stressPreset
            }
        );
        yearData = tailRiskOverlay.yearData;
        tailRiskEntriesThisRun.push(tailRiskOverlay);

        const lifeYear = updateMonteCarloLifeEventsForYear(
            lifeState,
            inputs,
            widowOptions,
            simulationsJahr,
            yearData,
            effectiveTransitionYear,
            triggeredAge,
            careEverActive,
            rand,
            simState
        );
        effectiveTransitionYear = lifeYear.effectiveTransitionYear;
        triggeredAge = lifeYear.triggeredAge;
        careEverActive = lifeYear.careEverActive;

        if (lifeState.runEndedBecauseAllDied) {
            recordSweepHouseholdRiskYear(
                householdRiskDiagnostics,
                householdRiskTrace,
                {
                    runIndex: i,
                    simulationsJahr,
                    yearData,
                    lifeYear,
                    previousLife,
                    tailRiskOverlay,
                    runEndedBecauseAllDied: true
                }
            );
            previousLife = {
                p1Alive: false,
                p2Alive: false,
                p1CareActive: false,
                p2CareActive: false,
                widowP1Active: lifeYear.householdContext.widowBenefits.p1FromP2 === true,
                widowP2Active: lifeYear.householdContext.widowBenefits.p2FromP1 === true,
                horizonYears: previousDynamicHorizon
            };
            break;
        }

        // Inflation/rent adjustment can be regime-dependent.
        const effectiveRentAdjPct = computeRentAdjRate(inputs, yearData);
        const resolvedCapeRatio = resolveMonteCarloCape(
            yearData,
            inputs,
            simState.marketDataHist
        );
        const p1Alive = lifeYear.householdContext.p1Alive !== false;
        const p2Alive = lifeYear.householdContext.p2Alive === true;
        const jointAliveThisYear = lifeState.hasPartner && p1Alive && p2Alive;
        if (
            wasJointAliveAtPreviousHorizon
            && !jointAliveThisYear
            && Number.isFinite(previousDynamicHorizon)
        ) {
            longevityTransitionStartYear = simulationsJahr;
            longevityTransitionAnchorHorizon = previousDynamicHorizon;
        } else if (jointAliveThisYear) {
            longevityTransitionStartYear = null;
            longevityTransitionAnchorHorizon = null;
        }
        const horizonResolution = resolveDynamicFlexRunnerHorizon(inputs, {
            yearIndex: simulationsJahr,
            ageP1: lifeYear.ageP1,
            ageP2: lifeYear.ageP2,
            p1Alive,
            p2Alive,
            applyTransitionSmoothing: longevityTransitionStartYear !== null,
            previousHorizon: longevityTransitionAnchorHorizon,
            yearsSinceTransition: longevityTransitionStartYear === null
                ? 0
                : simulationsJahr - longevityTransitionStartYear
        });
        const dynamicHorizonYears = horizonResolution.horizonYears;
        const adjustedInputs = {
            ...inputs,
            rentAdjPct: effectiveRentAdjPct,
            transitionYear: effectiveTransitionYear,
            capeRatio: resolvedCapeRatio,
            marketCapeRatio: resolvedCapeRatio,
            horizonYears: dynamicHorizonYears,
            guardrailPlanHorizonYears: inputs.horizonYears,
            ...(horizonResolution.diagnostics?.longevityMode !== 'none'
                ? { longevityHorizonDiagnostics: horizonResolution.diagnostics }
                : {})
        };
        previousDynamicHorizon = dynamicHorizonYears;
        wasJointAliveAtPreviousHorizon = jointAliveThisYear;
        yearData.capeRatio = resolvedCapeRatio;

        // FR-72 Punkt 18: eingesparter Grundbedarf für die Netto-Pflegesumme, vor der Jahresrechnung.
        const savedHomeFloor = savedHomeFloorShares(inputs, simState.baseFloor, lifeYear.householdContext, isFirstDeathYear(lifeState.hasPartner,
            { p1Alive, p2Alive }, /** @type {{survivor?: {deathYearIndex?: number}}} */ (simState), simulationsJahr));
        const result = /** @type {import('../../../typcheck/rechenkern-integration').SimulateOneYear} */ (/** @type {unknown} */ (simulateOneYear))(
            { ...simState },
            adjustedInputs,
            yearData,
            simulationsJahr,
            lifeState.careMetaP1,
            lifeYear.totalCareFloor,
            lifeYear.householdContext,
            lifeYear.effectiveFlexFactor,
            engine
        );
        recordSweepHouseholdRiskYear(
            householdRiskDiagnostics,
            householdRiskTrace,
            {
                runIndex: i,
                simulationsJahr,
                yearData,
                lifeYear,
                previousLife,
                horizonResolution,
                tailRiskOverlay,
                result,
                savedHomeFloor
            }
        );
        previousLife = {
            p1Alive,
            p2Alive,
            p1CareActive: p1Alive && lifeState.careMetaP1?.active === true,
            p2CareActive: p2Alive && lifeState.careMetaP2?.active === true,
            widowP1Active: lifeYear.householdContext.widowBenefits.p1FromP2 === true,
            widowP2Active: lifeYear.householdContext.widowBenefits.p2FromP1 === true,
            horizonYears: dynamicHorizonYears
        };

        if (result?.error) {
            const firstFieldError = Array.isArray(result.error?.errors) && result.error.errors.length > 0
                ? result.error.errors[0]?.message
                : '';
            invalidComboReason = firstFieldError || result.error?.message || 'Engine-Validierungsfehler';
            failed = true;
            break;
        }

        if (result.isRuin) {
            failed = true;
            // SWP-09 / D-06: Der terminale Nullpunkt gehoert vor dem
            // zwingenden Sweep-Abbruch in die Drawdownserie.
            depotWertHistorie.push(0);
            break;
        } else {
            simState = result.newState;
            totalTaxSavedByLossCarryThisRun += Number(result.logData?.taxSavedByLossCarry) || 0;
            depotWertHistorie.push(portfolioTotal(simState.portfolio));

            // Track canonical after-transaction/before-payout runway months.
            minRunway = mergeApplicableRunwayMinimum(
                minRunway,
                readApplicableRunwayMonths(result.logData)
            );
        }
    }

    finalizeSweepRunRiskDiagnostics(
        householdRiskDiagnostics,
        tailRiskPlan,
        tailRiskEntriesThisRun,
        lifeState.runEndedBecauseAllDied
    );

    const endVermoegen = failed ? 0 : portfolioTotal(simState.portfolio);
    const { maxDDpct } = computeRunStatsFromSeries(depotWertHistorie);

    runOutcomes.push({
        finalVermoegen: endVermoegen,
        maxDrawdown: maxDDpct,
        minRunway,
        taxSavedByLossCarry: totalTaxSavedByLossCarryThisRun,
        failed: failed
    });
    return invalidComboReason;
}
