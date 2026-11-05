// @ts-check
/** @import {YearOutcome} from '../../../typcheck/rechenkern' */
import { applyUnmarriedInheritance } from '../simulator-inheritance.js';
import { nextFixedIncomeWageFactor } from '../simulator-fixed-income.js';
import { snapshotPersonalInvestments, applyPersonalInterest, applyPersonalTaxAdjustment } from '../simulator-personal-accounts.js';
import { executedSaleBreakdown, sumDepot } from '../simulator-portfolio.js';
import { euros, signedEuros } from '../simulator-engine-direct-utils.js';
import { survivorLiquidityTarget } from '../simulator-survivor.js';
import { applySimulatorTaxRecompute } from '../simulator-tax-recompute.js';
import { applyHealthBucketInterest, buildHealthBucketDiagnostics } from '../simulator-health-bucket.js';
import { settlePersonalTaxYear } from '../simulator-personal-tax.js';
import { ruinOutcome, snapshotBalance } from './year-diagnostics.js';
/** @typedef {import('./year-payout.js').YearContext & NonNullable<ReturnType<typeof settleYear>['state']>} YearContext */
/** @param {import('./year-payout.js').YearContext} context */
export function settleYear(context) {
    let {
        liquiditaet, portfolio, rC, cashZinsen, liqNachZins, healthBucketInterest, inputs, spendingNewState,
        inflatedFloor, marketDataHist, rA, resolvedCapeRatio, yearData, personalTaxBook, actionResult,
        plannedActionFlow, regularSaleScale, forcedTaxReserved, didForcedSale, threeBucketState, fullResult,
        taxStatePrev, combinedTaxRawAggregate, engineInput, forcedSaleScaleApplied, totalTaxesThisYear,
        saleFunding, forcedFunding, currentState, inflowLog, expenseLog, marketDataCurrentYear, netFloorYear,
        jahresEntnahmeEffektiv, depotwertGesamt, hasLifeEvents, survivorYear, executedSaleSources,
        cumulativeInflationFactor, pensionResult, homeHousehold, yearIndex, depotTranchesAktien,
        depotTranchesGold, healthBucketCoverage, balanceTrace
    } = context;

    // Rebalancing bei Überschuss
    // HINWEIS: Die Logik wurde in die TransactionEngine (determineAction) verschoben,
    // um Simulator und Balance App zu harmonisieren (FR-57: Ansparjahre auch im Bärenmarkt).
    // simulator-engine-direct.js verlässt sich nun rein auf die Engine-Ergebnisse.
    let kaufAkt = 0, kaufGld = 0;
    // (Legacy Block entfernt)

    // Cash-Verzinsung
    // Cash-Verzinsung
    const liqBasisForInterest = euros(liquiditaet);
    const personalInterest = applyPersonalInterest(portfolio, rC);
    liquiditaet = portfolio.liquiditaet;
    cashZinsen = personalInterest.interest;
    liqNachZins = euros(liquiditaet);
    if (!isFinite(liquiditaet)) liquiditaet = 0;
    snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_cash_interest', {
        cashInterestEarned: cashZinsen,
        liqBasisForInterest
    });
    healthBucketInterest = applyHealthBucketInterest({ inputs, portfolio, rC });
    let healthBucketDiagnostics = buildHealthBucketDiagnostics({
        inputs,
        portfolio,
        cumulativeInflationFactor: spendingNewState.cumulativeInflationFactor || 1
    });

    const floorCoveredByPension = inflatedFloor === 0;
    const guardReason = floorCoveredByPension ? "floor_covered_by_pension" : "engine_guard_primary";

    // Market History für nächstes Jahr
    const newMarketDataHist = {
        endeVJ_3: marketDataHist.endeVJ_2,
        endeVJ_2: marketDataHist.endeVJ_1,
        endeVJ_1: marketDataHist.endeVJ,
        endeVJ: marketDataHist.endeVJ * (1 + rA),
        ath: Math.max(marketDataHist.ath, marketDataHist.endeVJ * (1 + rA)),
        jahreSeitAth: (marketDataHist.endeVJ * (1 + rA) >= marketDataHist.ath) ? 0 : marketDataHist.jahreSeitAth + 1,
        capeRatio: resolvedCapeRatio,
        inflation: yearData.inflation
    };

    const investmentsBeforeTax = snapshotPersonalInvestments(portfolio);
    const taxReconciliation = personalTaxBook ? /** @type {import('../../../typcheck/rechenkern-integration').SettlePersonalTaxYear} */ (settlePersonalTaxYear)({
        portfolio, book: personalTaxBook, personalInterest, actionResult, plannedActionFlow,
        regularSaleScale, forcedTaxReserved, spendingNewState, didForcedSale, inputs
    }) : /** @type {import('../../../typcheck/rechenkern-integration').ApplySimulatorTaxRecompute} */ (applySimulatorTaxRecompute)({
        didForcedSale,
        forceRecompute: threeBucketState.is3Bucket && !fullResult.ui.threeBucket,
        actionResult,
        plannedActionFlow,
        spendingNewState,
        taxStatePrev,
        combinedTaxRawAggregate,
        sparerPauschbetrag: engineInput.sparerPauschbetrag,
        kirchensteuerSatz: engineInput.kirchensteuerSatz,
        cashInterestIncomeSigned: cashZinsen,
        forcedSaleScaleApplied,
        regularSaleScale,
        forcedTaxReserved
    });
    totalTaxesThisYear = taxReconciliation.totalTaxesThisYear;
    // The personal path books its own cash adjustment, including realized MM gains.
    // Legacy inputs retain the pooled interest-tax adjustment.
    if (!personalTaxBook) applyPersonalTaxAdjustment(portfolio, taxReconciliation.taxCashAdjustment, personalInterest, [...saleFunding, ...forcedFunding]);
    liquiditaet = portfolio.liquiditaet;
    // @ts-expect-error Muster: Fehlender Shortfall bedeutet hier bewusst keine Unterdeckung (undefined > 0 ist false).
    if (taxReconciliation.taxShortfall > 1e-8) {
        return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog, portfolio, liquiditaet, marketDataCurrentYear,
            reason: `Steuer im Haushalt ungedeckt (${euros(taxReconciliation.taxShortfall)} EUR)`,
            personalTaxFunding: actionResult.personalTaxFunding,
            requiredFloorNominal: netFloorYear, coveredFloorNominal: Math.min(netFloorYear, jahresEntnahmeEffektiv),
            effectiveWithdrawalNominal: jahresEntnahmeEffektiv, depotValueNominal: depotwertGesamt,
            taxReconciliation }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
    }
    const hasInheritance = hasLifeEvents && inputs.partner?.aktiv
        && (inputs.partnership || inputs.simulationPeople?.length === 2);
    if (hasInheritance && survivorYear?.deathThisYear) executedSaleSources.push(...executedSaleBreakdown(investmentsBeforeTax));
    const inheritanceLog = hasInheritance ? /** @type {import('../../../typcheck/rechenkern-integration').ApplyUnmarriedInheritance} */ (applyUnmarriedInheritance)({ portfolio, transition: survivorYear,
        inputs: inputs.partnership ? inputs : { ...inputs, partnership: { status: 'married' } },
        inflationFactor: cumulativeInflationFactor * (1 + yearData.inflation / 100), pension: pensionResult,
        personalInterest, actionResult, household: homeHousehold,
        reserveTarget: () => survivorLiquidityTarget({ state: currentState, portfolio, transition: survivorYear, inputs,
            household: homeHousehold, yearIndex, inflationFactor: cumulativeInflationFactor * (1 + yearData.inflation / 100),
            marketData: marketDataCurrentYear, pension: pensionResult,
            fixedIncomeWageFactor: inputs.fixedIncome?.length ? nextFixedIncomeWageFactor(inputs, currentState, yearData)
                : currentState.fixedIncomeWageFactor }) }) : null;
    if (inheritanceLog) {
        if (inheritanceLog.inheritancePayment.shortfall > 0.01) {
            return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog: { ...expenseLog,
                abgang_erben: inheritanceLog.abgang_erben, erbschaftsteuer: inheritanceLog.erbschaftsteuer,
                inheritance: inheritanceLog.inheritance, SurvivorDeathYear: true }, portfolio,
                liquiditaet: portfolio.liquiditaet, marketDataCurrentYear, reason: 'Erbschaftsteuer ungedeckt',
                requiredFloorNominal: netFloorYear, coveredFloorNominal: jahresEntnahmeEffektiv,
                effectiveWithdrawalNominal: jahresEntnahmeEffektiv, depotValueNominal: sumDepot(portfolio) }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
        }
        totalTaxesThisYear += inheritanceLog.inheritancePayment.extraTax;
        liquiditaet = portfolio.liquiditaet;
        depotTranchesAktien = portfolio.depotTranchesAktien;
        depotTranchesGold = portfolio.depotTranchesGold;
        spendingNewState.taxState = { .../** @type {NonNullable<typeof portfolio.personAccounts>} */ (portfolio.personAccounts)[0].taxState };
        /** @type {NonNullable<typeof survivorYear>} */ (survivorYear).inheritanceLog = inheritanceLog;
        healthBucketDiagnostics = buildHealthBucketDiagnostics({ inputs, portfolio, cumulativeInflationFactor: spendingNewState.cumulativeInflationFactor || 1 });
    }
    snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_tax_reconciliation', {
        regularSaleScale,
        forcedTaxReserved: euros(forcedTaxReserved),
        taxCashAdjustment: signedEuros(taxReconciliation.taxCashAdjustment)
    });
    return { state: {
        kaufAkt, kaufGld, liquiditaet, portfolio, cashZinsen, liqNachZins, healthBucketInterest, inputs,
        healthBucketDiagnostics, spendingNewState, inflatedFloor, guardReason, newMarketDataHist, rA, yearData,
        investmentsBeforeTax, actionResult, fullResult, totalTaxesThisYear, currentState, inflowLog,
        expenseLog, jahresEntnahmeEffektiv, depotwertGesamt, survivorYear, executedSaleSources, inheritanceLog,
        pensionResult, depotTranchesAktien, depotTranchesGold, healthBucketCoverage, balanceTrace,
        cumulativeInflationFactor
    } };
}
