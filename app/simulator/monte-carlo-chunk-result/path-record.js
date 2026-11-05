// @ts-check
/** @import {NumericBuffers} from '../../../typcheck/rechenkern' */
import { MONTE_CARLO_MISSINGNESS_CODE, MONTE_CARLO_OUTCOME_CODE } from './schema.js';
import { assertNonNegativeInteger, contractError } from './validation-primitives.js';
import { EURO_PATH_FIELDS } from '../mc-euro-metrics.js';
/** @param {import('../../../typcheck/rechenkern').TypedNumbers} values
 * @param {import('../../../typcheck/rechenkern').TypedNumbers} missingness
 * @param {number} index
 * @param {unknown} value
 * @param {number} missingCode */
export function setOptionalValue(values, missingness, index, value, missingCode) {
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) {
        values[index] = Number(value);
        missingness[index] = MONTE_CARLO_MISSINGNESS_CODE.OBSERVED;
    } else {
        values[index] = 0;
        missingness[index] = missingCode;
    }
}

/** @param {{pathSummaries:NumericBuffers;pathMissingness:NumericBuffers;localIndex:number;globalRunIndex:number;outcomeCode:number;technicalError?:boolean;finalValueNominalEur?:number;finalValueRealEur?:number;displayHomeValueNominalEur?:number;displayHomeValueRealEur?:number;volatilityPct?:number;maxDrawdownPct?:number;maxDrawdownRealPct?:number|null;maxDrawdownRealObservationCount?:number;maxDrawdownRealMissingnessCode?:number;cutYearsNumerator?:number;cutYearsDenominator?:number;minimumFlexRestriction?:ReturnType<typeof import("../minimum-flex-metrics.js").finalizeMinimumFlexPath>|null;euroMetrics?:ReturnType<typeof import("../mc-euro-metrics.js").finalizeEuroPath>|null;realWithdrawalP10RealEur?:number|null;realWithdrawalObservationCount?:number;meanWithdrawalRateRatio?:number|null;withdrawalRateObservationCount?:number;p1CareEntryAge?:number|null;p2CareEntryAge?:number|null;p1CareYears?:number;p2CareYears?:number;bothCareYears?:number;careEverActive?:boolean;hasPartner?:boolean;p1CareAdditionalNeedRealEur?:number|null;p2CareAdditionalNeedRealEur?:number|null;totalCareAdditionalNeedRealEur?:number|null;maxAnnualCareAdditionalNeedRealEur?:number|null;p1CareAdditionalNeedNominalEur?:number|null;p2CareAdditionalNeedNominalEur?:number|null;totalCareAdditionalNeedNominalEur?:number|null;maxAnnualCareAdditionalNeedNominalEur?:number|null;healthBucketEnabled?:boolean;healthBucketUsedEur?:number;healthBucketEndEur?:number;healthBucketCoveragePct?:number|null;healthBucketTargetGapEur?:number;healthBucketInterestEur?:number;taxSavedByLossCarryEur?:number}} options */
export function recordMonteCarloPathSummaryV1({
    pathSummaries,
    pathMissingness,
    localIndex,
    globalRunIndex,
    outcomeCode,
    technicalError = false,
    finalValueNominalEur = 0,
    finalValueRealEur = 0,
    displayHomeValueNominalEur = 0,
    displayHomeValueRealEur = 0,
    volatilityPct = 0,
    maxDrawdownPct = 0,
    maxDrawdownRealPct = null,
    maxDrawdownRealObservationCount = 0,
    maxDrawdownRealMissingnessCode = MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS,
    cutYearsNumerator = 0,
    cutYearsDenominator = 0,
    minimumFlexRestriction = null,
    euroMetrics = null,
    realWithdrawalP10RealEur = null,
    realWithdrawalObservationCount = 0,
    meanWithdrawalRateRatio = null,
    withdrawalRateObservationCount = 0,
    p1CareEntryAge = null,
    p2CareEntryAge = null,
    p1CareYears = 0,
    p2CareYears = 0,
    bothCareYears = 0,
    careEverActive = false,
    hasPartner = false,
    p1CareAdditionalNeedRealEur = null,
    p2CareAdditionalNeedRealEur = null,
    totalCareAdditionalNeedRealEur = null,
    maxAnnualCareAdditionalNeedRealEur = null,
    p1CareAdditionalNeedNominalEur = null,
    p2CareAdditionalNeedNominalEur = null,
    totalCareAdditionalNeedNominalEur = null,
    maxAnnualCareAdditionalNeedNominalEur = null,
    healthBucketEnabled = false,
    healthBucketUsedEur = 0,
    healthBucketEndEur = 0,
    healthBucketCoveragePct = null,
    healthBucketTargetGapEur = 0,
    healthBucketInterestEur = 0,
    taxSavedByLossCarryEur = 0
}) {
    assertNonNegativeInteger(localIndex, 'localIndex');
    assertNonNegativeInteger(globalRunIndex, 'globalRunIndex');
    if (!pathSummaries || !pathMissingness || localIndex >= pathSummaries.globalRunIndex.length) {
        throw contractError('Path summary index is outside the allocated chunk range.');
    }

    pathSummaries.globalRunIndex[localIndex] = globalRunIndex;
    pathSummaries.outcomeCode[localIndex] = outcomeCode;
    const minimum = minimumFlexRestriction;
    pathSummaries.minimumFlexCompletedYearCount[localIndex] = minimum?.completedYearCount ?? 0;
    pathSummaries.minimumFlexObservationCount[localIndex] = minimum?.observationCount ?? 0;
    for (const field of ['minimumFlexAffectedYearCount', 'minimumFlexYearShareRatio',
        'minimumFlexPaidMedianNominalEur', 'minimumFlexDesiredMedianNominalEur', 'minimumFlexPaidMinimumNominalEur']) {
        pathSummaries[field][localIndex] = 0;
    }

    if (technicalError) {
        for (const values of Object.values(pathMissingness)) {
            values[localIndex] = MONTE_CARLO_MISSINGNESS_CODE.TECHNICAL_ERROR;
        }
        return;
    }

    pathMissingness.path[localIndex] = MONTE_CARLO_MISSINGNESS_CODE.OBSERVED;
    pathMissingness.euroMetrics[localIndex] = euroMetrics ? MONTE_CARLO_MISSINGNESS_CODE.OBSERVED : MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS;
    pathMissingness.euroRealAmounts[localIndex] = euroMetrics?.valid ? MONTE_CARLO_MISSINGNESS_CODE.OBSERVED : MONTE_CARLO_MISSINGNESS_CODE.MISSING_INFLATION;
    for (const field of Object.keys(EURO_PATH_FIELDS)) pathSummaries[field][localIndex] = euroMetrics?.[/** @type {import('../../../typcheck/rechenkern').EuroPathField} */ (field)] ?? 0;
    pathMissingness.minimumFlexRestriction[localIndex] = !minimum || minimum.missingReason === 'no_observations'
        ? MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS
        : minimum.missingReason === null ? MONTE_CARLO_MISSINGNESS_CODE.OBSERVED
            : MONTE_CARLO_MISSINGNESS_CODE.MISSING_YEAR_VALUES;
    if (minimum?.missingReason === null) {
        pathSummaries.minimumFlexAffectedYearCount[localIndex] = minimum.affectedYearCount;
        pathSummaries.minimumFlexYearShareRatio[localIndex] = minimum.affectedYearCount / minimum.observationCount;
        pathSummaries.minimumFlexPaidMedianNominalEur[localIndex] = /** @type {number} */ (minimum.paidMedianNominalEur);
        pathSummaries.minimumFlexDesiredMedianNominalEur[localIndex] = /** @type {number} */ (minimum.desiredMedianNominalEur);
        pathSummaries.minimumFlexPaidMinimumNominalEur[localIndex] = minimum.paidMinimumNominalEur;
    }
    pathSummaries.finalValueNominalEur[localIndex] = Number(finalValueNominalEur) || 0;
    pathSummaries.finalValueRealEur[localIndex] = Number(finalValueRealEur) || 0;
    if (pathSummaries.displayHomeValueNominalEur) {
        pathSummaries.displayHomeValueNominalEur[localIndex] = displayHomeValueNominalEur;
        pathSummaries.displayHomeValueRealEur[localIndex] = displayHomeValueRealEur;
    }
    pathSummaries.volatilityPct[localIndex] = Number(volatilityPct) || 0;
    pathSummaries.maxDrawdownPct[localIndex] = Number(maxDrawdownPct) || 0;
    assertNonNegativeInteger(maxDrawdownRealObservationCount, 'maxDrawdownRealObservationCount');
    pathSummaries.maxDrawdownRealObservationCount[localIndex] = maxDrawdownRealObservationCount;
    setOptionalValue(
        pathSummaries.maxDrawdownRealPct,
        pathMissingness.maxDrawdownRealPct,
        localIndex,
        maxDrawdownRealPct,
        maxDrawdownRealMissingnessCode
    );
    assertNonNegativeInteger(cutYearsNumerator, 'cutYearsNumerator');
    assertNonNegativeInteger(cutYearsDenominator, 'cutYearsDenominator');
    if (cutYearsNumerator > cutYearsDenominator) {
        throw contractError('cutYearsNumerator must not exceed cutYearsDenominator.');
    }
    pathSummaries.cutYearsNumerator[localIndex] = cutYearsNumerator;
    pathSummaries.cutYearsDenominator[localIndex] = cutYearsDenominator;
    setOptionalValue(
        pathSummaries.cutYearShareRatio,
        pathMissingness.cutYearShareRatio,
        localIndex,
        cutYearsDenominator > 0 ? cutYearsNumerator / cutYearsDenominator : null,
        MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS
    );
    pathSummaries.realWithdrawalObservationCount[localIndex] = Math.max(0, Number(realWithdrawalObservationCount) || 0);
    setOptionalValue(
        pathSummaries.realWithdrawalP10RealEur,
        pathMissingness.realWithdrawalP10RealEur,
        localIndex,
        pathSummaries.realWithdrawalObservationCount[localIndex] > 0 ? realWithdrawalP10RealEur : null,
        outcomeCode === MONTE_CARLO_OUTCOME_CODE.ALL_DEAD
            ? MONTE_CARLO_MISSINGNESS_CODE.DIED_BEFORE_FIRST_OBLIGATION
            : MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS
    );
    assertNonNegativeInteger(withdrawalRateObservationCount, 'withdrawalRateObservationCount');
    pathSummaries.withdrawalRateObservationCount[localIndex] = withdrawalRateObservationCount;
    setOptionalValue(
        pathSummaries.meanWithdrawalRateRatio,
        pathMissingness.meanWithdrawalRateRatio,
        localIndex,
        withdrawalRateObservationCount > 0 ? meanWithdrawalRateRatio : null,
        outcomeCode === MONTE_CARLO_OUTCOME_CODE.ALL_DEAD
            ? MONTE_CARLO_MISSINGNESS_CODE.DIED_BEFORE_FIRST_OBLIGATION
            : MONTE_CARLO_MISSINGNESS_CODE.NO_OBSERVATIONS
    );
    const normalizedP1CareEntryAge = Number(p1CareEntryAge) > 0 ? p1CareEntryAge : null;
    const normalizedP2CareEntryAge = Number(p2CareEntryAge) > 0 ? p2CareEntryAge : null;
    setOptionalValue(
        pathSummaries.p1CareEntryAge,
        pathMissingness.p1CareEntryAge,
        localIndex,
        normalizedP1CareEntryAge,
        MONTE_CARLO_MISSINGNESS_CODE.NOT_APPLICABLE
    );
    setOptionalValue(
        pathSummaries.p2CareEntryAge,
        pathMissingness.p2CareEntryAge,
        localIndex,
        normalizedP2CareEntryAge,
        MONTE_CARLO_MISSINGNESS_CODE.NOT_APPLICABLE
    );
    pathSummaries.p1CareYears[localIndex] = Math.max(0, Number(p1CareYears) || 0);
    pathSummaries.p2CareYears[localIndex] = Math.max(0, Number(p2CareYears) || 0);
    pathSummaries.bothCareYears[localIndex] = Math.max(0, Number(bothCareYears) || 0);
    pathSummaries.careEverActive[localIndex] = careEverActive ? 1 : 0;
    pathSummaries.hasPartner[localIndex] = hasPartner ? 1 : 0;
    const careValues = {
        p1CareAdditionalNeedRealEur: [normalizedP1CareEntryAge !== null, p1CareAdditionalNeedRealEur],
        p2CareAdditionalNeedRealEur: [normalizedP2CareEntryAge !== null, p2CareAdditionalNeedRealEur],
        totalCareAdditionalNeedRealEur: [careEverActive, totalCareAdditionalNeedRealEur],
        maxAnnualCareAdditionalNeedRealEur: [careEverActive, maxAnnualCareAdditionalNeedRealEur],
        p1CareAdditionalNeedNominalEur: [normalizedP1CareEntryAge !== null, p1CareAdditionalNeedNominalEur],
        p2CareAdditionalNeedNominalEur: [normalizedP2CareEntryAge !== null, p2CareAdditionalNeedNominalEur],
        totalCareAdditionalNeedNominalEur: [careEverActive, totalCareAdditionalNeedNominalEur],
        maxAnnualCareAdditionalNeedNominalEur: [careEverActive, maxAnnualCareAdditionalNeedNominalEur]
    };
    for (const [field, [applicable, value]] of Object.entries(careValues)) {
        setOptionalValue(
            pathSummaries[field],
            pathMissingness[field],
            localIndex,
            applicable ? value : null,
            MONTE_CARLO_MISSINGNESS_CODE.NOT_APPLICABLE
        );
    }
    pathSummaries.healthBucketEnabled[localIndex] = healthBucketEnabled ? 1 : 0;
    pathSummaries.healthBucketUsedEur[localIndex] = Number(healthBucketUsedEur) || 0;
    pathSummaries.healthBucketEndEur[localIndex] = Number(healthBucketEndEur) || 0;
    setOptionalValue(
        pathSummaries.healthBucketCoveragePct,
        pathMissingness.healthBucketCoveragePct,
        localIndex,
        healthBucketEnabled ? healthBucketCoveragePct : null,
        MONTE_CARLO_MISSINGNESS_CODE.NOT_APPLICABLE
    );
    pathSummaries.healthBucketTargetGapEur[localIndex] = Number(healthBucketTargetGapEur) || 0;
    pathSummaries.healthBucketInterestEur[localIndex] = Number(healthBucketInterestEur) || 0;
    pathSummaries.taxSavedByLossCarryEur[localIndex] = Number(taxSavedByLossCarryEur) || 0;
}
