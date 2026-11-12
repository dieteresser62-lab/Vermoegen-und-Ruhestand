// @ts-check
/** @import {YearOutcome} from '../../../typcheck/rechenkern' */
import { payResidenceTaxForYear } from '../simulator-residence-tax.js';
import { sumDepot } from '../simulator-portfolio.js';
import { euros } from '../simulator-engine-direct-utils.js';
import { getThreeBucketInputs } from '../../../engine/transactions/three-bucket-logic.mjs';
import { applyAnnualReturnsToPortfolio, buildCurrentYearMarketData } from '../simulator-year-portfolio.js';
import { isAccumulationYear, simulateAccumulationYear } from '../simulator-accumulation-year.js';
import { buildTaxRawAggregate } from '../simulator-tax-recompute.js';
import { beginPersonalTaxYear } from '../simulator-personal-tax.js';
import { ruinOutcome, snapshotBalance } from './year-diagnostics.js';
import { SIMULATOR_YEAR_OUTCOME_KINDS } from './outcomes.js';
/** @typedef {import('./year-preparation.js').YearContext & NonNullable<ReturnType<typeof applyYearMarket>['state']>} YearContext */
/** @param {import('./year-preparation.js').YearContext} context */
export function applyYearMarket(context) {
    let {
        portfolio, hasLifeEvents, inputs, currentState, homeHousehold, inflowLog, effectiveBaseFloor,
        lastState, yearData, marketDataHist, yearIndex, baseFloor, baseFlex, baseMinimumFlexAnnual,
        baseFlexBudgetAnnual, baseFlexBudgetRecharge, currentAnnualPension, currentAnnualPension2,
        householdCtx, survivorYear, healthBucketInterest, cumulativeInflationFactor, healthBucketCoverage
    } = context;
    const personalTaxBook = beginPersonalTaxYear(portfolio);
    const liquidityBeforeResidenceTax = portfolio.liquiditaet;
    const residenceAdvance = hasLifeEvents ? payResidenceTaxForYear(portfolio, inputs, currentState.survivor, homeHousehold) : null;
    if (residenceAdvance) {
        inflowLog = { ...inflowLog, ...residenceAdvance };
        if (residenceAdvance.residenceTaxPayment.shortfall > .01) return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState,
            inflowLog, portfolio, liquiditaet: portfolio.liquiditaet, reason: 'Steuer Wohnrecht (§ 23) ungedeckt',
            requiredFloorNominal: effectiveBaseFloor, coveredFloorNominal: 0, effectiveWithdrawalNominal: 0,
            depotValueNominal: sumDepot(portfolio) }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
    }
    let { depotTranchesAktien, depotTranchesGold } = portfolio;
    let liquiditaet = portfolio.liquiditaet;
    let initialLiqStart = euros(residenceAdvance ? liquidityBeforeResidenceTax : liquiditaet);
    let cashZinsen = 0;
    let liqNachZins = initialLiqStart;
    let totalTaxesThisYear = 0;
    const taxStatePrev = {
        lossCarry: Math.max(0, Number(lastState?.taxState?.lossCarry) || 0)
    };
    let combinedTaxRawAggregate = null;
    let didForcedSale = false;
    let forcedSaleScaleApplied = /** @type {number|null} */ (null);
    let regularSaleScale = 1;
    let forcedTaxReserved = 0;
    const threeBucketInput = getThreeBucketInputs(inputs);
    const is3Bucket = threeBucketInput.is3Bucket;
    const stressReplayTransactionCapture = inputs?.stressReplayTransactionCapture === true;

    let bondSaleAmount = 0;
    let bondRefillGross = 0;
    let bondRefillNet = 0;
    let bondRefillTax = 0;
    let equityPreserved = 0;
    let unmetLiquidity = 0;
    let isBadYear = false;
    const {
        rA,
        rG,
        rC,
        bondBucketBefore,
        equityBeforeReturn,
        goldBeforeReturn,
        equityAfterReturn,
        goldAfterReturn
    } = applyAnnualReturnsToPortfolio({ portfolio, yearData, threeBucketInput, equityCostPct: inputs.equityCostPct });
    const balanceTrace = /** @type {Record<string,unknown>[]} */ ([]);
    snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_returns', {
        rA,
        rG,
        rC,
        bondBucketBefore: euros(bondBucketBefore)
    });
    const {
        resolvedCapeRatio,
        marketDataCurrentYear
    } = buildCurrentYearMarketData({ yearData, inputs, marketDataHist, rA });

    // FIX (Redux): Calculate current market end value for Regime Detection
    // Shift the historical window by 1 year so 'endeVJ' reflects the value AFTER this year's returns.
    // This allows the Engine to see the crash (e.g. 2008) in the year it happens.
    // FIX (Redux): Calculate current market end value for Regime Detection
    // Shift the historical window by 1 year so 'endeVJ' reflects the value AFTER this year's returns.
    // This allows the Engine to see the crash (e.g. 2008) in the year it happens.
    //
    // CRITICAL FIX: Always calculate synthetically!
    // We cannot use HISTORICAL_DATA[yearData.jahr] because in Monte Carlo, the sampled year
    // has an absolute index value unrelated to the current synthetic simulation state.
    // ==========================================
    // ANSPARPHASE-LOGIK (unverändert, da keine Engine-Aufrufe)
    // ==========================================
    if (isAccumulationYear(inputs, yearIndex)) {
        const accumulated = /** @type {import('../../../typcheck/rechenkern-integration').SimulateAccumulationYear} */ (simulateAccumulationYear)({
            currentState,
            inputs,
            yearData,
            yearIndex,
            portfolio,
            liquiditaet,
            initialLiqStart,
            rA,
            rG,
            rC,
            bondBucketBefore,
            marketDataCurrentYear,
            marketDataHist,
            resolvedCapeRatio,
            baseFloor,
            baseFlex,
            baseMinimumFlexAnnual,
            baseFlexBudgetAnnual,
            baseFlexBudgetRecharge,
            effectiveBaseFloor,
            currentAnnualPension,
            currentAnnualPension2,
            householdCtx,
            isBadYear,
            survivorYear,
            hasInheritance: hasLifeEvents && inputs.partner?.aktiv
                && Boolean(inputs.partnership || inputs.simulationPeople?.length === 2),
            residenceAdvance,
            advanceTaxBook: residenceAdvance ? personalTaxBook : null
        });
        if (portfolio.healthBucketConfig?.enabled) {
            healthBucketInterest = { startAmount: accumulated.logData.health_bucket_start,
                interest: accumulated.logData.health_bucket_interest };
        }
        if (accumulated.taxReconciliation?.taxShortfall > 1e-8) {
            return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, portfolio, liquiditaet: portfolio.liquiditaet,
                marketDataCurrentYear, reason: `Steuer im Haushalt ungedeckt (${euros(accumulated.taxReconciliation.taxShortfall)} EUR)`,
                requiredFloorNominal: 0, coveredFloorNominal: 0, effectiveWithdrawalNominal: 0,
                depotValueNominal: sumDepot(portfolio), taxReconciliation: accumulated.taxReconciliation }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
        }
        if (accumulated.inheritanceShortfall > .01) {
            return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog: accumulated.logData, portfolio,
                liquiditaet: portfolio.liquiditaet, marketDataCurrentYear, reason: 'Erbschaftsteuer ungedeckt',
                requiredFloorNominal: 0, coveredFloorNominal: 0, effectiveWithdrawalNominal: 0,
                depotValueNominal: sumDepot(portfolio) }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
        }
        return { outcome: /** @type {YearOutcome} */ ({ kind: SIMULATOR_YEAR_OUTCOME_KINDS.SUCCESS, isRuin: false, ...accumulated,
            ...(inflowLog ? { logData: { ...accumulated.logData, ...inflowLog } } : {}) }) };
    }
    return { state: {
        personalTaxBook, portfolio, residenceAdvance, hasLifeEvents, inputs, currentState, homeHousehold,
        inflowLog, effectiveBaseFloor, depotTranchesAktien, depotTranchesGold, liquiditaet, initialLiqStart,
        cashZinsen, liqNachZins, totalTaxesThisYear, taxStatePrev, lastState,
        combinedTaxRawAggregate: /** @type {ReturnType<typeof buildTaxRawAggregate>|null} */ (combinedTaxRawAggregate),
        didForcedSale, forcedSaleScaleApplied, regularSaleScale, forcedTaxReserved, is3Bucket,
        stressReplayTransactionCapture, bondSaleAmount, bondRefillGross, bondRefillNet, bondRefillTax,
        equityPreserved, unmetLiquidity, isBadYear, rA, rG, rC, bondBucketBefore, equityBeforeReturn,
        goldBeforeReturn, equityAfterReturn, goldAfterReturn, yearData, balanceTrace, resolvedCapeRatio,
        marketDataCurrentYear, marketDataHist, yearIndex, baseFloor, baseFlex, baseMinimumFlexAnnual,
        baseFlexBudgetAnnual, baseFlexBudgetRecharge, currentAnnualPension, currentAnnualPension2,
        householdCtx, survivorYear, healthBucketInterest, cumulativeInflationFactor, healthBucketCoverage
    } };
}
