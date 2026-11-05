// @ts-check
/** @import {HistoricalYear,CareMeta,TailRiskOverlay,ReplayAnnualRecord,ReplayHouseholdEvent} from '../../../typcheck/rechenkern' */
import { MONTE_CARLO_OUTCOME_CODE } from '../monte-carlo-chunk-result.js';
/** @param {number} outcomeCode */
export function resolveStressReplayTerminalStatus(outcomeCode) {
    if (outcomeCode === MONTE_CARLO_OUTCOME_CODE.RUIN) return 'ruin';
    if (outcomeCode === MONTE_CARLO_OUTCOME_CODE.ALL_DEAD) return 'all_dead';
    if (outcomeCode === MONTE_CARLO_OUTCOME_CODE.HORIZON_EXHAUSTED) return 'horizon_exhausted';
    const error = /** @type {Error & {code:string}} */ (new Error('Stress replay capture received an unsupported terminal outcome.'));
    error.code = 'STRESS_REPLAY_TERMINAL_STATUS_INVALID';
    throw error;
}

/** @template T
 * @param {T} value
 * @returns {T} */
export function cloneReplayValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

/** @param {{p1Alive:boolean;p2Alive:boolean;hasPartner:boolean;careMetaP1:CareMeta|null;careMetaP2:CareMeta|null;p1ActiveThisYear?:boolean;p2ActiveThisYear?:boolean;effectiveFlexFactor:number;totalCareFloor:number;widowBenefitActiveForP1:boolean;widowBenefitActiveForP2:boolean;effectiveTransitionYear:number}} options
 * @returns {ReplayHouseholdEvent} */
export function createReplayHouseholdEvent({
    p1Alive,
    p2Alive,
    hasPartner,
    careMetaP1,
    careMetaP2,
    p1ActiveThisYear,
    p2ActiveThisYear,
    effectiveFlexFactor,
    totalCareFloor,
    widowBenefitActiveForP1,
    widowBenefitActiveForP2,
    effectiveTransitionYear
}) {
    return {
        type: 'household_state',
        p1Alive: p1Alive ? 1 : 0,
        p2Alive: hasPartner ? (p2Alive ? 1 : 0) : null,
        p1CareActive: p1ActiveThisYear === true,
        p2CareActive: p2ActiveThisYear === true,
        careMetaP1: cloneReplayValue(careMetaP1),
        careMetaP2: cloneReplayValue(careMetaP2),
        effectiveFlexFactor: Number(effectiveFlexFactor) || 0,
        totalCareFloorEur: Number(totalCareFloor) || 0,
        widowBenefitActiveForP1: widowBenefitActiveForP1 === true,
        widowBenefitActiveForP2: widowBenefitActiveForP2 === true,
        effectiveTransitionYear
    };
}

/** @param {HistoricalYear} beforeStress
 * @param {HistoricalYear} afterStress
 * @param {import('../../../typcheck/rechenkern').StressContext|null} stressCtx
 * @param {string|undefined} stressPreset */
export function createReplayStressEvents(beforeStress, afterStress, stressCtx, stressPreset) {
    const changed = beforeStress?.rendite !== afterStress?.rendite
        || beforeStress?.inflation !== afterStress?.inflation
        || beforeStress?.gold_eur_perf !== afterStress?.gold_eur_perf;
    if (!changed) return [];
    return [{
        type: 'stress_override',
        preset: String(stressPreset || 'NONE'),
        equityReturnBeforePct: Number(beforeStress.rendite) * 100,
        equityReturnAfterPct: Number(afterStress.rendite) * 100,
        inflationBeforePct: Number(beforeStress.inflation),
        inflationAfterPct: Number(afterStress.inflation),
        goldReturnBeforePct: Number(beforeStress.gold_eur_perf),
        goldReturnAfterPct: Number(afterStress.gold_eur_perf),
        remainingYearsAfter: Number(stressCtx?.remainingYears) || 0
    }];
}

/** @param {{yearIndex:number;yearData:HistoricalYear;recordType:string;stressEvents:unknown[]|null;tailRiskOverlay:TailRiskOverlay|null;householdEvent:ReplayHouseholdEvent|null;continuation?:boolean}} options
 * @returns {ReplayAnnualRecord} */
export function createReplayAnnualRecord({
    yearIndex,
    yearData,
    recordType,
    stressEvents,
    tailRiskOverlay,
    householdEvent,
    continuation = false
}) {
    const financiallyEvaluable = recordType === 'financial_year';
    const record = /** @type {ReplayAnnualRecord} */ ({
        yearIndex,
        recordType,
        financiallyEvaluable,
        historicalYear: Number.isFinite(Number(yearData?.jahr)) ? Number(yearData.jahr) : null,
        stressEvents: cloneReplayValue(stressEvents || []),
        tailRiskEvents: tailRiskOverlay?.tailRiskActive === true ? [cloneReplayValue(tailRiskOverlay)] : [],
        householdEvents: householdEvent ? [cloneReplayValue(householdEvent)] : [],
        continuation
    });
    // A terminal ruin row does not expose returns in ScenarioLogExportV2 and
    // therefore does not reconcile them. The opt-in runner capture observed
    // the effective data directly, however, and must retain it so a variant
    // that survives the same started financial year can be evaluated.
    if (financiallyEvaluable || recordType === 'terminal_ruin') {
        Object.assign(record, {
            equityReturnPct: Number(yearData.rendite) * 100,
            goldReturnPct: Number(yearData.gold_eur_perf),
            cashReturnPct: Number(yearData.zinssatz),
            inflationPct: Number(yearData.inflation),
            wageGrowthPct: Number(yearData.lohn),
            capeRatio: Number(yearData.capeRatio),
            regime: String(yearData.regime || 'UNKNOWN')
        });
    } else if (Number.isFinite(Number(yearData?.inflation))) {
        record.inflationPct = Number(yearData.inflation);
    }
    return record;
}
