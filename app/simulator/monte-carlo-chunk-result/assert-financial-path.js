// @ts-check

import { MONTE_CARLO_MISSINGNESS_CODE, MONTE_CARLO_OUTCOME_CODE } from './schema.js';
import { contractError } from './validation-primitives.js';
/** @param {import('../../../typcheck/rechenkern').MonteCarloChunkResult} result
 * @param {number} localIndex
 * @param {number} globalIndex
 * @param {number} outcomeCode
 * @param {{observedHouseholdCarePaths:number;observedP1CarePaths:number;observedP2CarePaths:number}} careCounts */
export function assertFinancialPath(result, localIndex, globalIndex, outcomeCode, careCounts) {
    for (const [field, values] of Object.entries(result.pathMissingness)) {
        if (field !== 'path' && values[localIndex] === MONTE_CARLO_MISSINGNESS_CODE.TECHNICAL_ERROR) {
            throw contractError(`financial path ${globalIndex} cannot contain technical missingness.`);
        }
    }
    const nominalDrawdown = result.pathSummaries.maxDrawdownPct[localIndex];
    const minimumCount = result.pathSummaries.minimumFlexObservationCount[localIndex];
    const minimumCompleted = result.pathSummaries.minimumFlexCompletedYearCount[localIndex];
    const minimumAffected = result.pathSummaries.minimumFlexAffectedYearCount[localIndex];
    const minimumState = result.pathMissingness.minimumFlexRestriction[localIndex];
    const minimumRatio = result.pathSummaries.minimumFlexYearShareRatio[localIndex];
    const minimumAmounts = [
        result.pathSummaries.minimumFlexPaidMedianNominalEur[localIndex],
        result.pathSummaries.minimumFlexDesiredMedianNominalEur[localIndex],
        result.pathSummaries.minimumFlexPaidMinimumNominalEur[localIndex]
    ];
    if (minimumCount > minimumCompleted || minimumAffected > minimumCount) {
        throw contractError(`financial path ${globalIndex} has inconsistent minimum-flex counts.`);
    }
    if (minimumState === MONTE_CARLO_MISSINGNESS_CODE.OBSERVED) {
        if (minimumCount === 0 || minimumCount !== minimumCompleted
            || minimumRatio !== minimumAffected / minimumCount
            || minimumAmounts.some(value => !Number.isFinite(value) || value < 0)
            || minimumAmounts[2] > minimumAmounts[0]) {
            throw contractError(`financial path ${globalIndex} has invalid observed minimum-flex statistics.`);
        }
    } else {
        const validMissing = minimumState === MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS
            ? minimumCompleted === 0 && minimumCount === 0
            : minimumState === MONTE_CARLO_MISSINGNESS_CODE.MISSING_YEAR_VALUES
                && minimumCompleted > minimumCount;
        if (!validMissing || minimumRatio !== 0 || minimumAffected !== 0
            || minimumAmounts.some(value => value !== 0)) {
            throw contractError(`financial path ${globalIndex} has invalid minimum-flex missingness.`);
        }
    }
    if (!Number.isFinite(nominalDrawdown) || nominalDrawdown < 0 || nominalDrawdown > 100) {
        throw contractError(`financial path ${globalIndex} has a nominal drawdown outside 0..100.`);
    }
    const realDrawdown = result.pathSummaries.maxDrawdownRealPct[localIndex];
    const realDrawdownCount = result.pathSummaries.maxDrawdownRealObservationCount[localIndex];
    const realDrawdownMissingness = result.pathMissingness.maxDrawdownRealPct[localIndex];
    if (realDrawdownMissingness === MONTE_CARLO_MISSINGNESS_CODE.OBSERVED) {
        if (realDrawdownCount < 1 || !Number.isFinite(realDrawdown)
            || realDrawdown < 0 || realDrawdown > 100) {
            throw contractError(`financial path ${globalIndex} has an invalid observed real drawdown.`);
        }
    } else if (realDrawdownMissingness === MONTE_CARLO_MISSINGNESS_CODE.MISSING_INFLATION) {
        if (realDrawdownCount < 1 || realDrawdown !== 0) {
            throw contractError(`financial path ${globalIndex} has inconsistent real-drawdown inflation missingness.`);
        }
    } else if (realDrawdownMissingness === MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS) {
        if (realDrawdownCount !== 0 || realDrawdown !== 0) {
            throw contractError(`financial path ${globalIndex} has inconsistent empty real-drawdown observations.`);
        }
    } else {
        throw contractError(`financial path ${globalIndex} has unsupported real-drawdown missingness.`);
    }
    const cutNumerator = result.pathSummaries.cutYearsNumerator[localIndex];
    const cutDenominator = result.pathSummaries.cutYearsDenominator[localIndex];
    const cutRatio = result.pathSummaries.cutYearShareRatio[localIndex];
    const cutMissingness = result.pathMissingness.cutYearShareRatio[localIndex];
    if (cutNumerator > cutDenominator) {
        throw contractError(`financial path ${globalIndex} has a cut numerator above its denominator.`);
    }
    if (cutDenominator === 0) {
        if (cutNumerator !== 0
            || cutMissingness !== MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS
            || cutRatio !== 0) {
            throw contractError(`financial path ${globalIndex} must encode an empty cut denominator as nullable missingness.`);
        }
    } else if (cutMissingness !== MONTE_CARLO_MISSINGNESS_CODE.OBSERVED
        || cutRatio !== Math.fround(cutNumerator / cutDenominator)) {
        throw contractError(`financial path ${globalIndex} has an inconsistent cut-year share.`);
    }
    const bufferedCutRatio = result.buffers.cutYearShareRatio[localIndex];
    if (!Object.is(bufferedCutRatio, cutRatio)) {
        throw contractError(`financial path ${globalIndex} has divergent cut-year buffer and summary values.`);
    }
    if (result.buffers.cutYearShareMissingness[localIndex] !== cutMissingness) {
        throw contractError(`financial path ${globalIndex} has divergent cut-year buffer and missingness values.`);
    }

    const withdrawalCount = result.pathSummaries.realWithdrawalObservationCount[localIndex];
    const withdrawalMissingness = result.pathMissingness.realWithdrawalP10RealEur[localIndex];
    if (withdrawalCount === 0) {
        const allowedMissingness = outcomeCode === MONTE_CARLO_OUTCOME_CODE.ALL_DEAD
            ? MONTE_CARLO_MISSINGNESS_CODE.DIED_BEFORE_FIRST_OBLIGATION
            : MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS;
        if (withdrawalMissingness !== allowedMissingness
            || result.pathSummaries.realWithdrawalP10RealEur[localIndex] !== 0) {
            throw contractError(`financial path ${globalIndex} has inconsistent withdrawal missingness.`);
        }
    } else if (withdrawalMissingness !== MONTE_CARLO_MISSINGNESS_CODE.OBSERVED
        || result.pathSummaries.realWithdrawalP10RealEur[localIndex] < 0) {
        throw contractError(`financial path ${globalIndex} has an invalid observed withdrawal summary.`);
    }

    const rateCount = result.pathSummaries.withdrawalRateObservationCount[localIndex];
    const rateMissingness = result.pathMissingness.meanWithdrawalRateRatio[localIndex];
    if (rateCount === 0) {
        const allowedMissingness = outcomeCode === MONTE_CARLO_OUTCOME_CODE.ALL_DEAD
            ? MONTE_CARLO_MISSINGNESS_CODE.DIED_BEFORE_FIRST_OBLIGATION
            : MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS;
        if (rateMissingness !== allowedMissingness
            || result.pathSummaries.meanWithdrawalRateRatio[localIndex] !== 0) {
            throw contractError(`financial path ${globalIndex} has inconsistent withdrawal-rate missingness.`);
        }
    } else if (rateMissingness !== MONTE_CARLO_MISSINGNESS_CODE.OBSERVED
        || !Number.isFinite(result.pathSummaries.meanWithdrawalRateRatio[localIndex])) {
        throw contractError(`financial path ${globalIndex} has an invalid observed withdrawal-rate summary.`);
    }
    if (!Object.is(
        result.buffers.meanWithdrawalRateRatio[localIndex],
        result.pathSummaries.meanWithdrawalRateRatio[localIndex]
    ) || result.buffers.withdrawalRateObservationCount[localIndex] !== rateCount
        || result.buffers.meanWithdrawalRateMissingness[localIndex] !== rateMissingness) {
        throw contractError(`financial path ${globalIndex} has divergent withdrawal-rate buffer and summary values.`);
    }

    const stressCount = result.buffers.stress_realWithdrawalObservationCount[localIndex];
    const stressMissingness = result.buffers.stress_realWithdrawalP10Missingness[localIndex];
    if (stressCount > 0) {
        if (stressMissingness !== MONTE_CARLO_MISSINGNESS_CODE.OBSERVED
            || result.buffers.stress_CaR_P10_Real[localIndex] < 0) {
            throw contractError(`financial path ${globalIndex} has an invalid stress withdrawal summary.`);
        }
    } else if (!/** @type {number[]} */ ([MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS,
        MONTE_CARLO_MISSINGNESS_CODE.DIED_BEFORE_FIRST_OBLIGATION,
        MONTE_CARLO_MISSINGNESS_CODE.NOT_APPLICABLE]).includes(stressMissingness)) {
        throw contractError(`financial path ${globalIndex} has inconsistent stress withdrawal missingness.`);
    }

    const p1Observed = result.pathMissingness.p1CareEntryAge[localIndex]
        === MONTE_CARLO_MISSINGNESS_CODE.OBSERVED;
    const p2Observed = result.pathMissingness.p2CareEntryAge[localIndex]
        === MONTE_CARLO_MISSINGNESS_CODE.OBSERVED;
    const householdObserved = result.pathSummaries.careEverActive[localIndex] === 1;
    if (p1Observed) careCounts.observedP1CarePaths++;
    if (p2Observed) careCounts.observedP2CarePaths++;
    if (householdObserved) careCounts.observedHouseholdCarePaths++;
    if (householdObserved !== (p1Observed || p2Observed)) {
        throw contractError(`financial path ${globalIndex} has inconsistent household/person care flags.`);
    }
    if (p2Observed && result.pathSummaries.hasPartner[localIndex] !== 1) {
        throw contractError(`financial path ${globalIndex} observes P2 care without a partner.`);
    }
    if (!p1Observed && result.pathSummaries.p1CareYears[localIndex] !== 0) {
        throw contractError(`financial path ${globalIndex} has P1 care years without a P1 entry.`);
    }
    if (!p2Observed && result.pathSummaries.p2CareYears[localIndex] !== 0) {
        throw contractError(`financial path ${globalIndex} has P2 care years without a P2 entry.`);
    }
    if (result.pathSummaries.bothCareYears[localIndex]
        > Math.min(result.pathSummaries.p1CareYears[localIndex], result.pathSummaries.p2CareYears[localIndex])) {
        throw contractError(`financial path ${globalIndex} has impossible simultaneous care years.`);
    }
    const careMissingnessExpectations = {
        p1CareAdditionalNeedRealEur: p1Observed,
        p2CareAdditionalNeedRealEur: p2Observed,
        totalCareAdditionalNeedRealEur: householdObserved,
        maxAnnualCareAdditionalNeedRealEur: householdObserved,
        p1CareAdditionalNeedNominalEur: p1Observed,
        p2CareAdditionalNeedNominalEur: p2Observed,
        totalCareAdditionalNeedNominalEur: householdObserved,
        maxAnnualCareAdditionalNeedNominalEur: householdObserved
    };
    for (const [field, observed] of Object.entries(careMissingnessExpectations)) {
        const expectedCode = observed
            ? MONTE_CARLO_MISSINGNESS_CODE.OBSERVED
            : MONTE_CARLO_MISSINGNESS_CODE.NOT_APPLICABLE;
        if (result.pathMissingness[field][localIndex] !== expectedCode) {
            throw contractError(`financial path ${globalIndex} has inconsistent ${field} missingness.`);
        }
        if (result.pathSummaries[field][localIndex] < 0) {
            throw contractError(`financial path ${globalIndex} has negative ${field}.`);
        }
    }
}
