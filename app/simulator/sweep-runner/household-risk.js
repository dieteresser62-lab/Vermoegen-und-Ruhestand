// @ts-check
/** @import {SweepRiskDiagnostics,SweepRiskTrace,SimulationLog,HistoricalYear,LifeYear,TailRiskOverlay,YearOutcome} from '../../../typcheck/rechenkern' */
import { SWEEP_HOUSEHOLD_RISK_DIAGNOSTICS_VERSION } from './provenance.js';
import { buildCareLogFields } from '../simulator-care-log.js';
import { summarizeTailRiskEvents, createTailRiskSchedule } from '../tail-risk-overlay.js';
import { resolveDynamicFlexRunnerHorizon } from '../dynamic-flex-runner-horizon.js';

const MAX_HOUSEHOLD_TRACE_RUNS = 1;

const MAX_HOUSEHOLD_TRACE_EVENTS = 32;

const MAX_TAIL_SCHEDULE_TRACE_EVENTS = 16;

const HOUSEHOLD_TRACE_INITIAL_YEARS = 4;

/** @returns {SweepRiskDiagnostics} */
export function createSweepHouseholdRiskDiagnostics() {
    return {
        schemaVersion: SWEEP_HOUSEHOLD_RISK_DIAGNOSTICS_VERSION,
        runsEvaluated: 0,
        yearsEvaluated: 0,
        household: {
            p1DeathEvents: 0,
            p2DeathEvents: 0,
            allDeadRuns: 0,
            p1CareActiveYears: 0,
            p2CareActiveYears: 0,
            bothCareActiveYears: 0,
            widowP1ActiveYears: 0,
            widowP2ActiveYears: 0,
            totalCareFloorNominalEur: 0,
            minimumTemporaryFlexFactor: null
        },
        horizon: {
            resolutionCount: 0,
            invalidResolutionCount: 0,
            minimumYears: null,
            maximumYears: null
        },
        tailRisk: {
            evaluatedYears: 0,
            runsWithScheduledEvents: 0,
            scheduledEventCount: 0,
            activeYears: 0,
            appliedYears: 0,
            skippedHistoricalCrisisYears: 0,
            invalidScheduleCount: 0
        },
        tracedRuns: []
    };
}

/** @param {SweepRiskDiagnostics} diagnostics
 * @param {number} runIndex
 * @param {ReturnType<typeof createTailRiskSchedule>} tailRiskPlan
 * @returns {SweepRiskTrace|null} */
export function beginSweepHouseholdRiskTrace(diagnostics, runIndex, tailRiskPlan) {
    if (diagnostics.tracedRuns.length >= MAX_HOUSEHOLD_TRACE_RUNS) return null;
    const scheduledEvents = Array.isArray(tailRiskPlan?.events)
        ? tailRiskPlan.events.slice(0, MAX_TAIL_SCHEDULE_TRACE_EVENTS).map(event => ({ ...event }))
        : [];
    const trace = {
        runIndex,
        tailRiskSchedule: {
            valid: tailRiskPlan?.valid === true,
            horizonYears: tailRiskPlan?.horizonYears ?? null,
            scheduledEvents,
            truncated: (tailRiskPlan?.events?.length || 0) > scheduledEvents.length,
            errors: Array.isArray(tailRiskPlan?.errors)
                ? tailRiskPlan.errors.map(error => ({ ...error }))
                : []
        },
        events: [],
        truncated: false
    };
    diagnostics.tracedRuns.push(trace);
    return trace;
}

/** @param {SweepRiskDiagnostics} diagnostics
 * @param {SweepRiskTrace|null} trace
 * @param {{runIndex:number;simulationsJahr:number;yearData:HistoricalYear;lifeYear:LifeYear;previousLife:{p1Alive:boolean;p2Alive:boolean;p1CareActive?:boolean;p2CareActive?:boolean;widowP1Active:boolean;widowP2Active:boolean;horizonYears?:number|null};horizonResolution?:ReturnType<typeof resolveDynamicFlexRunnerHorizon>|null;tailRiskOverlay?:TailRiskOverlay|null;result?:YearOutcome|null;runEndedBecauseAllDied?:boolean}} options */
export function recordSweepHouseholdRiskYear(
    diagnostics,
    trace,
    {
        runIndex,
        simulationsJahr,
        yearData,
        lifeYear,
        previousLife,
        horizonResolution = null,
        tailRiskOverlay = null,
        result = null,
        runEndedBecauseAllDied = false
    }
) {
    const engineStepExecuted = result !== null;
    if (engineStepExecuted) diagnostics.yearsEvaluated += 1;
    const household = diagnostics.household;
    const p1Alive = lifeYear?.householdContext?.p1Alive !== false;
    const p2Alive = lifeYear?.householdContext?.p2Alive === true;
    const p1CareActive = p1Alive && lifeYear?.householdContext?.care?.p1?.active === true;
    const p2CareActive = p2Alive && lifeYear?.householdContext?.care?.p2?.active === true;
    const widowP1Active = lifeYear?.householdContext?.widowBenefits?.p1FromP2 === true;
    const widowP2Active = lifeYear?.householdContext?.widowBenefits?.p2FromP1 === true;

    if (previousLife?.p1Alive === true && !p1Alive) household.p1DeathEvents += 1;
    if (previousLife?.p2Alive === true && !p2Alive) household.p2DeathEvents += 1;
    const annualCare = /** @type {import('../../../typcheck/rechenkern-integration').BuildCareLogFields} */ (buildCareLogFields)({ hasPartner: Number.isFinite(lifeYear?.ageP2) || lifeYear?.householdContext?.care?.p2 != null, p1Alive, p2Alive,
        careMetaP1: lifeYear?.householdContext?.care?.p1,
        careMetaP2: lifeYear?.householdContext?.care?.p2,
        deathThisYear: (previousLife?.p1Alive === true && !p1Alive)
            || (previousLife?.p2Alive === true && !p2Alive) });
    if (engineStepExecuted) {
        if (annualCare.CareP1_Active) household.p1CareActiveYears += p1Alive ? 1 : .5;
        if (annualCare.CareP2_Active) household.p2CareActiveYears += p2Alive ? 1 : .5;
        if (annualCare.CareP1_Active && annualCare.CareP2_Active) household.bothCareActiveYears += p1Alive && p2Alive ? 1 : .5;
        if (widowP1Active) household.widowP1ActiveYears += 1;
        if (widowP2Active) household.widowP2ActiveYears += 1;
    }

    const careFloor = Number(result?.logData?.pflege_zusatz_floor ?? annualCare.pflege_zusatz_floor);
    if (engineStepExecuted && Number.isFinite(careFloor)) {
        household.totalCareFloorNominalEur += careFloor;
    }
    const temporaryFlexFactor = Number(result?.logData?.pflege_aktiv
        ? result.logData.pflege_flex_faktor
        : annualCare.pflege_aktiv ? annualCare.pflege_flex_faktor : lifeYear?.effectiveFlexFactor);
    if (engineStepExecuted && Number.isFinite(temporaryFlexFactor)) {
        household.minimumTemporaryFlexFactor = household.minimumTemporaryFlexFactor === null
            ? temporaryFlexFactor
            : Math.min(household.minimumTemporaryFlexFactor, temporaryFlexFactor);
    }

    const horizonYears = Number(horizonResolution?.horizonYears);
    if (engineStepExecuted && horizonResolution) {
        diagnostics.horizon.resolutionCount += 1;
        if (horizonResolution.valid !== true || !Number.isFinite(horizonYears)) {
            diagnostics.horizon.invalidResolutionCount += 1;
        } else {
            diagnostics.horizon.minimumYears = diagnostics.horizon.minimumYears === null
                ? horizonYears
                : Math.min(diagnostics.horizon.minimumYears, horizonYears);
            diagnostics.horizon.maximumYears = diagnostics.horizon.maximumYears === null
                ? horizonYears
                : Math.max(diagnostics.horizon.maximumYears, horizonYears);
        }
    }

    if (!trace) return;
    const lifeChanged = previousLife?.p1Alive !== p1Alive
        || previousLife?.p2Alive !== p2Alive
        || previousLife?.p1CareActive !== p1CareActive
        || previousLife?.p2CareActive !== p2CareActive
        || previousLife?.widowP1Active !== widowP1Active
        || previousLife?.widowP2Active !== widowP2Active;
    const shouldTrace = simulationsJahr < HOUSEHOLD_TRACE_INITIAL_YEARS
        || lifeChanged
        || tailRiskOverlay?.tailRiskActive === true
        || (Number.isFinite(previousLife?.horizonYears)
            && Number.isFinite(horizonYears)
            && previousLife.horizonYears !== horizonYears)
        || runEndedBecauseAllDied;
    if (!shouldTrace) return;
    if (trace.events.length >= MAX_HOUSEHOLD_TRACE_EVENTS) {
        trace.truncated = true;
        return;
    }

    trace.events.push({
        runIndex,
        simulationYearIndex: simulationsJahr,
        historicalYear: Number.isFinite(Number(yearData?.jahr)) ? Number(yearData.jahr) : null,
        p1Alive,
        p2Alive,
        p1CareActive,
        p2CareActive,
        widowP1Active,
        widowP2Active,
        widowP1Percent: Number(lifeYear?.householdContext?.widowBenefits?.p1FromP2Percent) || 0,
        widowP2Percent: Number(lifeYear?.householdContext?.widowBenefits?.p2FromP1Percent) || 0,
        totalCareFloorNominalEur: Number.isFinite(careFloor) ? careFloor : null,
        temporaryFlexFactor: Number.isFinite(temporaryFlexFactor) ? temporaryFlexFactor : null,
        horizonYears: Number.isFinite(horizonYears) ? horizonYears : null,
        horizonValid: horizonResolution ? horizonResolution.valid === true : null,
        vpwHorizonYears: Number.isFinite(Number(result?.ui?.vpw?.horizonYears))
            ? Number(/** @type {import('../../../typcheck/rechenkern').EngineUi} */ (/** @type {NonNullable<typeof result>} */ (result).ui).vpw.horizonYears)
            : null,
        vpwRate: Number.isFinite(Number(result?.ui?.vpw?.vpwRate))
            ? Number(/** @type {import('../../../typcheck/rechenkern').EngineUi} */ (/** @type {NonNullable<typeof result>} */ (result).ui).vpw.vpwRate)
            : null,
        pensionAnnualEur: Number.isFinite(Number(result?.logData?.pension_annual))
            ? Number(/** @type {import('../../../typcheck/rechenkern').SimulationLog} */ (/** @type {NonNullable<typeof result>} */ (result).logData).pension_annual)
            : null,
        pensionP1Eur: Number.isFinite(Number(result?.logData?.rente1))
            ? Number(/** @type {import('../../../typcheck/rechenkern').SimulationLog} */ (/** @type {NonNullable<typeof result>} */ (result).logData).rente1)
            : null,
        pensionP2Eur: Number.isFinite(Number(result?.logData?.rente2))
            ? Number(/** @type {import('../../../typcheck/rechenkern').SimulationLog} */ (/** @type {NonNullable<typeof result>} */ (result).logData).rente2)
            : null,
        widowPensionP1Eur: Number.isFinite(Number(result?.logData?.WidowBenefitP1))
            ? Number(/** @type {import('../../../typcheck/rechenkern').SimulationLog} */ (/** @type {NonNullable<typeof result>} */ (result).logData).WidowBenefitP1)
            : null,
        widowPensionP2Eur: Number.isFinite(Number(result?.logData?.WidowBenefitP2))
            ? Number(/** @type {import('../../../typcheck/rechenkern').SimulationLog} */ (/** @type {NonNullable<typeof result>} */ (result).logData).WidowBenefitP2)
            : null,
        tailRisk: tailRiskOverlay?.tailRiskActive === true
            ? {
                eventId: tailRiskOverlay.tailRiskEventId,
                eventYearOffset: tailRiskOverlay.tailRiskEventYearOffset,
                applied: tailRiskOverlay.tailRiskApplied === true,
                skippedReason: tailRiskOverlay.tailRiskSkippedReason,
                returnShockPct: tailRiskOverlay.tailRiskReturnShockPct,
                inflationShockPct: tailRiskOverlay.tailRiskInflationShockPct,
                historicalReturnPct: tailRiskOverlay.historicalReturnPct,
                effectiveReturnPct: tailRiskOverlay.effectiveReturnPct,
                historicalInflationPct: tailRiskOverlay.historicalInflationPct,
                effectiveInflationPct: tailRiskOverlay.effectiveInflationPct
            }
            : null,
        runEndedBecauseAllDied
    });
}

/** @param {SweepRiskDiagnostics} diagnostics
 * @param {ReturnType<typeof createTailRiskSchedule>} tailRiskPlan
 * @param {TailRiskOverlay[]} tailRiskEntries
 * @param {boolean} allDied */
export function finalizeSweepRunRiskDiagnostics(diagnostics, tailRiskPlan, tailRiskEntries, allDied) {
    diagnostics.runsEvaluated += 1;
    if (allDied) diagnostics.household.allDeadRuns += 1;
    if (tailRiskPlan?.valid !== true) diagnostics.tailRisk.invalidScheduleCount += 1;
    const scheduledEventCount = Array.isArray(tailRiskPlan?.events)
        ? tailRiskPlan.events.length
        : 0;
    diagnostics.tailRisk.scheduledEventCount += scheduledEventCount;
    if (scheduledEventCount > 0) diagnostics.tailRisk.runsWithScheduledEvents += 1;

    const summary = summarizeTailRiskEvents(tailRiskEntries);
    diagnostics.tailRisk.evaluatedYears += Array.isArray(tailRiskEntries)
        ? tailRiskEntries.length
        : 0;
    diagnostics.tailRisk.activeYears += summary.tailRiskActiveYears;
    diagnostics.tailRisk.appliedYears += summary.tailRiskAppliedYears;
    diagnostics.tailRisk.skippedHistoricalCrisisYears += summary.tailRiskSkippedHistoricalCrisisYears;
}
