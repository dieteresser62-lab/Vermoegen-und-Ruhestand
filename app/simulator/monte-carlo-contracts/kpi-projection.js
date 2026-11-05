// @ts-check
/** @import {AggregateMetrics,NumericArray} from '../../../typcheck/rechenkern' */
import { cloneContractValue } from './portable-json.js';

/** @param {{sampleSize?:number;realEur?:number|null;p50RealEur?:number|null;excludedRuns?:number;missingness?:unknown;observationCount?:unknown;uncertainty?:unknown}} value */
function projectRealWithdrawal(value = {}) {
    const sampleSize = Number(value.sampleSize) || 0;
    return {
        p10RealEur: value.realEur ?? null,
        p50RealEur: value.p50RealEur ?? null,
        sampleSize,
        excludedRuns: Number(value.excludedRuns) || 0,
        missingness: cloneContractValue(value.missingness || {}, '$.result.kpis.realWithdrawalP10RealEur.missingness'),
        observationCount: cloneContractValue(
            value.observationCount || { observedPaths: sampleSize },
            '$.result.kpis.realWithdrawalP10RealEur.observationCount'
        ),
        uncertainty: cloneContractValue(value.uncertainty || { confidenceInterval: null }, '$.result.kpis.realWithdrawalP10RealEur.uncertainty')
    };
}

/** @param {{entryRatePct?:number|null;entryRateNumerator?:number;entryRateDenominator?:number;entryAgeP50?:number|null;careYearsP50?:number|null;realCostEurP50?:number|null;sampleSize?:number;missingness?:string|null}} value */
function projectCarePerson(value = {}) {
    return {
        entryRatePct: value.entryRatePct ?? null,
        entryRateNumerator: Number(value.entryRateNumerator) || 0,
        entryRateDenominator: Number(value.entryRateDenominator) || 0,
        entryAgeYearsP50: value.entryAgeP50 ?? null,
        careYearsP50: value.careYearsP50 ?? null,
        additionalNeedRealEurP50: value.realCostEurP50 ?? null,
        sampleSize: Number(value.sampleSize) || 0,
        missingness: value.missingness ?? null
    };
}

/** @param {AggregateMetrics} aggregated */
export function projectMonteCarloKpis(aggregated = /** @type {NonNullable<Parameters<typeof projectMonteCarloKpis>[0]>} */ ({})) {
    const care = /** @type {Partial<NonNullable<AggregateMetrics['extraKPI']['pflege']>>} */ (aggregated.extraKPI?.pflege || {});
    const household = /** @type {Partial<NonNullable<AggregateMetrics['extraKPI']['pflege']['household']>>} */ (care.household || {});
    const comparison = /** @type {Partial<NonNullable<AggregateMetrics['extraKPI']['pflege']['comparison']>>} */ (care.comparison || {});
    const health = /** @type {Partial<AggregateMetrics['extraKPI']['healthBucket']>} */ (aggregated.extraKPI?.healthBucket || {});
    const lossCarry = /** @type {Partial<AggregateMetrics['extraKPI']['lossCarryTaxSavings']>} */ (aggregated.extraKPI?.lossCarryTaxSavings || {});
    const stress = /** @type {Partial<AggregateMetrics['stressKPI']>} */ (aggregated.stressKPI || {});
    return {
        floorCoverage: cloneContractValue(aggregated.outcomeInventory?.floorCoverageEstimate || null, '$.result.kpis.floorCoverage'),
        ...(aggregated.euroMetrics ? { euroMetrics: cloneContractValue(aggregated.euroMetrics, '$.result.kpis.euroMetrics') } : {}),
        finalWealthNominalEur: cloneContractValue(/** @type {AggregateMetrics['finalOutcomes']} */ (aggregated.finalOutcomes || {}), '$.result.kpis.finalWealthNominalEur'),
        taxPaidNominalEur: cloneContractValue(/** @type {AggregateMetrics['taxOutcomes']} */ (aggregated.taxOutcomes || {}), '$.result.kpis.taxPaidNominalEur'),
        simulatedLifetimeYears: cloneContractValue(/** @type {AggregateMetrics['kpiLebensdauer']} */ (aggregated.kpiLebensdauer || {}), '$.result.kpis.simulatedLifetimeYears'),
        cutYearSharePct: cloneContractValue(/** @type {AggregateMetrics['cutYearSharePct']} */ (aggregated.cutYearSharePct || {}), '$.result.kpis.cutYearSharePct'),
        ...(aggregated.minimumFlexRestriction ? {
            minimumFlexRestriction: cloneContractValue(aggregated.minimumFlexRestriction, '$.result.kpis.minimumFlexRestriction')
        } : {}),
        maximumFlexCutPct: cloneContractValue(/** @type {AggregateMetrics['kpiMaxKuerzung']} */ (aggregated.kpiMaxKuerzung || {}), '$.result.kpis.maximumFlexCutPct'),
        depotExhaustionRatePct: aggregated.depotErschoepfungsQuote ?? null,
        depotExhaustionAgeYears: cloneContractValue(/** @type {AggregateMetrics['alterBeiErschoepfung']} */ (aggregated.alterBeiErschoepfung || {}), '$.result.kpis.depotExhaustionAgeYears'),
        yearsWithoutFlexPct: cloneContractValue(/** @type {AggregateMetrics['anteilJahreOhneFlex']} */ (aggregated.anteilJahreOhneFlex || {}), '$.result.kpis.yearsWithoutFlexPct'),
        portfolioVolatilityPct: cloneContractValue(/** @type {AggregateMetrics['volatilities']} */ (aggregated.volatilities || {}), '$.result.kpis.portfolioVolatilityPct'),
        maximumDrawdownPct: cloneContractValue(/** @type {AggregateMetrics['maxDrawdowns']} */ (aggregated.maxDrawdowns || {}), '$.result.kpis.maximumDrawdownPct'),
        maximumDrawdownRealPct: cloneContractValue(/** @type {AggregateMetrics['realMaxDrawdowns']} */ (aggregated.realMaxDrawdowns || {}), '$.result.kpis.maximumDrawdownRealPct'),
        realWithdrawalP10RealEur: projectRealWithdrawal(aggregated.realWithdrawalP10),
        medianRealizedWithdrawalRateRatio: cloneContractValue(/** @type {AggregateMetrics['medianWithdrawalRate']} */ (aggregated.medianWithdrawalRate || {}), '$.result.kpis.medianRealizedWithdrawalRateRatio'),
        timeShareWithdrawalRateAbove45Ratio: aggregated.extraKPI?.timeShareQuoteAbove45 ?? null,
        dynamicFlexSafety: cloneContractValue(aggregated.extraKPI?.dynamicFlexSafety || {}, '$.result.kpis.dynamicFlexSafety'),
        lossCarryTaxSavingsNominalEur: {
            totalNominalEur: lossCarry.total ?? null,
            perRunMeanNominalEur: lossCarry.perRunMean ?? null
        },
        healthBucketNominalEur: {
            enabledRatePct: health.enabledRatePct ?? null,
            usedRatePct: health.usedRatePct ?? null,
            depletedRatePct: health.depletedRatePct ?? null,
            usedRuns: Number(health.usedRuns) || 0,
            depletedRuns: Number(health.depletedRuns) || 0,
            totalUsedNominalEur: health.totalUsed ?? null,
            usedP50NominalEur: health.usedMedian ?? null,
            usedP90NominalEur: health.usedP90 ?? null,
            endP50NominalEur: health.endMedian ?? null,
            coverageP50Pct: health.coverageMedianPct ?? null,
            targetGapP50NominalEur: health.targetGapMedian ?? null,
            interestP50NominalEur: health.interestMedian ?? null
        },
        tailRisk: cloneContractValue(aggregated.extraKPI?.tailRisk || {}, '$.result.kpis.tailRisk'),
        care: {
            p1: projectCarePerson(care.p1),
            p2: projectCarePerson(care.p2),
            household: {
                entryRatePct: household.entryRatePct ?? null,
                entryRateNumerator: Number(household.entryRateNumerator) || 0,
                entryRateDenominator: Number(household.entryRateDenominator) || 0,
                careYearsOverlapP50: household.careYearsOverlapP50 ?? null,
                totalAdditionalNeedRealEurP50: household.totalAdditionalNeedRealEurP50 ?? null,
                maxAnnualAdditionalNeedRealEurP50: household.maxAnnualAdditionalNeedRealEurP50 ?? null,
                endWealthWithCareRealEurP50: household.endWealthWithCareRealEurP50 ?? null,
                endWealthWithoutCareRealEurP50: household.endWealthNoCareRealEurP50 ?? null,
                shortfallRateWithCarePct: household.shortfallRateWithCarePct ?? null,
                shortfallRateWithoutCarePct: household.shortfallRateWithoutCarePct ?? null,
                sampleSize: Number(household.sampleSize) || 0,
                noCareSampleSize: Number(household.noCareSampleSize) || 0,
                missingness: household.missingness ?? null
            },
            comparison: {
                endWealthWithoutCareMinusCareRealEur: comparison.endWealthNoCareMinusCareRealEur ?? null,
                method: comparison.method ?? null,
                withCareSampleSize: Number(comparison.withCareSampleSize) || 0,
                noCareSampleSize: Number(comparison.noCareSampleSize) || 0,
                missingness: comparison.missingness ?? null
            }
        },
        stress: {
            preset: stress.presetKey ?? 'NONE',
            horizonYears: Number(stress.years) || 0,
            maximumDrawdownPct: cloneContractValue(stress.maxDD || {}, '$.result.kpis.stress.maximumDrawdownPct'),
            timeShareWithdrawalRateAbove45Ratio: cloneContractValue(stress.timeShareAbove45 || {}, '$.result.kpis.stress.timeShareWithdrawalRateAbove45Ratio'),
            cutYears: cloneContractValue(stress.cutYears || {}, '$.result.kpis.stress.cutYears'),
            realWithdrawalP10RealEur: projectRealWithdrawal(stress.realWithdrawalP10),
            recoveryYears: cloneContractValue(stress.recoveryYears || {}, '$.result.kpis.stress.recoveryYears')
        }
    };
}

/** @param {ReturnType<typeof projectMonteCarloKpis>} kpis */
export function buildMissingness(kpis) {
    return {
        zeroPolicy: 'observed-zero-is-zero; unavailable-values-are-null-with-reason',
        cutYearSharePct: {
            sampleSize: Number(kpis.cutYearSharePct?.sampleSize) || 0,
            excludedRuns: Number(kpis.cutYearSharePct?.excludedRuns) || 0
        },
        realWithdrawalP10RealEur: {
            sampleSize: kpis.realWithdrawalP10RealEur.sampleSize,
            excludedRuns: kpis.realWithdrawalP10RealEur.excludedRuns,
            reasons: kpis.realWithdrawalP10RealEur.missingness
        },
        stressRealWithdrawalP10RealEur: {
            sampleSize: kpis.stress.realWithdrawalP10RealEur.sampleSize,
            excludedRuns: kpis.stress.realWithdrawalP10RealEur.excludedRuns,
            reasons: kpis.stress.realWithdrawalP10RealEur.missingness
        },
        maximumDrawdownRealPct: {
            sampleSize: Number(kpis.maximumDrawdownRealPct?.distribution?.sampleSize) || 0,
            excludedRuns: Number(kpis.maximumDrawdownRealPct?.distribution?.excludedRuns) || 0,
            reasons: cloneContractValue(kpis.maximumDrawdownRealPct?.missingness || {}, '$.result.missingness.maximumDrawdownRealPct.reasons'),
            observationCount: cloneContractValue(kpis.maximumDrawdownRealPct?.observationCount || {}, '$.result.missingness.maximumDrawdownRealPct.observationCount')
        },
        care: {
            p1: { sampleSize: kpis.care.p1.sampleSize, reason: kpis.care.p1.missingness },
            p2: { sampleSize: kpis.care.p2.sampleSize, reason: kpis.care.p2.missingness },
            household: { sampleSize: kpis.care.household.sampleSize, reason: kpis.care.household.missingness },
            comparison: { reason: kpis.care.comparison.missingness }
        }
    };
}

/** @param {NumericArray|undefined} values */
export function projectHeatmapBins(values) {
    return (Array.isArray(values) ? values : []).map((value, index) => ({
        index,
        upperBoundPct: Number.isFinite(value) ? value : null,
        openEnded: value === Infinity
    }));
}
