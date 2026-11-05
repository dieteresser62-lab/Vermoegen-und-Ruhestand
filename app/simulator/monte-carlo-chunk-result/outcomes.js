// @ts-check

import { MONTE_CARLO_OUTCOME_CODE, MONTE_CARLO_OUTCOME_INVENTORY_VERSION } from './schema.js';
import { assertNonNegativeInteger, contractError } from './validation-primitives.js';
import { buildBinaryProportionEstimate } from '../monte-carlo-statistics.js';
/** @param {{technicalError?:boolean;ruinInStartedFinancialYear?:boolean;allDeadTiming?:string|null;horizonExhausted?:boolean}} options */
export function resolveMonteCarloTerminalOutcomeV1({
    technicalError = false,
    ruinInStartedFinancialYear = false,
    allDeadTiming = null,
    horizonExhausted = false
} = {}) {
    const allowedDeathTimings = new Set([null, 'before_next_financial_obligation', 'after_ruin']);
    const flagsAreBoolean = [technicalError, ruinInStartedFinancialYear, horizonExhausted]
        .every(value => typeof value === 'boolean');
    if (!flagsAreBoolean || !allowedDeathTimings.has(allDeadTiming)) {
        return { outcomeCode: MONTE_CARLO_OUTCOME_CODE.TECHNICAL_ERROR, errorCode: 'MC_TERMINAL_FLAGS_INVALID' };
    }
    if (technicalError) {
        return { outcomeCode: MONTE_CARLO_OUTCOME_CODE.TECHNICAL_ERROR, errorCode: null };
    }
    if (ruinInStartedFinancialYear) {
        if (allDeadTiming === 'before_next_financial_obligation' || horizonExhausted) {
            return { outcomeCode: MONTE_CARLO_OUTCOME_CODE.TECHNICAL_ERROR, errorCode: 'MC_TERMINAL_FLAGS_CONFLICT' };
        }
        return { outcomeCode: MONTE_CARLO_OUTCOME_CODE.RUIN, errorCode: null };
    }
    if (allDeadTiming !== null) {
        if (allDeadTiming === 'after_ruin' || horizonExhausted) {
            return { outcomeCode: MONTE_CARLO_OUTCOME_CODE.TECHNICAL_ERROR, errorCode: 'MC_TERMINAL_FLAGS_CONFLICT' };
        }
        return { outcomeCode: MONTE_CARLO_OUTCOME_CODE.ALL_DEAD, errorCode: null };
    }
    if (horizonExhausted) {
        return { outcomeCode: MONTE_CARLO_OUTCOME_CODE.HORIZON_EXHAUSTED, errorCode: null };
    }
    return { outcomeCode: MONTE_CARLO_OUTCOME_CODE.TECHNICAL_ERROR, errorCode: 'MC_TERMINAL_OUTCOME_INCOMPLETE' };
}

/** @param {{requestedRuns:number;ruin?:number;all_dead?:number;horizon_exhausted?:number;technical_error?:number}} options */
export function buildMonteCarloOutcomeInventoryV1({
    requestedRuns,
    ruin = 0,
    all_dead = 0,
    horizon_exhausted = 0,
    technical_error = 0
} = /** @type {NonNullable<Parameters<typeof buildMonteCarloOutcomeInventoryV1>[0]>} */ ({})) {
    const counts = { ruin, all_dead, horizon_exhausted, technical_error };
    assertNonNegativeInteger(requestedRuns, 'outcomeInventory.requestedRuns');
    for (const [name, value] of Object.entries(counts)) {
        assertNonNegativeInteger(value, `outcomeInventory.${name}`);
    }
    const inventorySum = Object.values(counts).reduce((total, value) => total + value, 0);
    if (inventorySum !== requestedRuns) {
        throw contractError(`Outcome inventory sum ${inventorySum} does not match requestedRuns ${requestedRuns}.`);
    }
    const floorCoveredCount = all_dead + horizon_exhausted;
    const hasTechnicalError = technical_error > 0;
    const floorCoverageEstimate = buildBinaryProportionEstimate({
        successes: floorCoveredCount,
        trials: requestedRuns,
        technicalErrorCount: technical_error
    });
    return {
        schemaVersion: MONTE_CARLO_OUTCOME_INVENTORY_VERSION,
        requestedRuns,
        ...counts,
        inventorySum,
        floorCoveredCount,
        floorCoverageRatio: floorCoverageEstimate.estimateRatio,
        floorCoveragePct: floorCoverageEstimate.estimatePct,
        floorCoverageEstimate,
        floorCoverageMissingnessReason: hasTechnicalError
            ? 'technical_error_in_batch'
            : requestedRuns === 0
                ? 'no_requested_runs'
                : null
    };
}
