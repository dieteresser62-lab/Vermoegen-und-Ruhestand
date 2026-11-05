// @ts-check
/** @import {SimulationLog} from '../../../typcheck/rechenkern' */

/**
* @param {number | null} currentMinimum
* @param {unknown} runwayMonths
*/
export function mergeApplicableRunwayMinimum(currentMinimum, runwayMonths) {
    if (typeof runwayMonths !== 'number' || !Number.isFinite(runwayMonths)) {
        return currentMinimum;
    }
    return currentMinimum === null || runwayMonths < currentMinimum
        ? runwayMonths
        : currentMinimum;
}

/** @param {SimulationLog|null|undefined} logData */
export function readApplicableRunwayMonths(logData) {
    if (logData?.RunwayMeasurementPhase !== 'after_transaction_before_payout') {
        return null;
    }
    const runwayMonths = logData?.runway_after_transaction_before_payout_months;
    return typeof runwayMonths === 'number' && Number.isFinite(runwayMonths)
        ? runwayMonths
        : null;
}
