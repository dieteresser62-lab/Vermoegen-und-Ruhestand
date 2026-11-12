// @ts-check
/** @import {YearSuccess,ActionSource} from '../../../typcheck/rechenkern' */
import { threeBucketActionTrades } from '../../../engine/transactions/net-action.mjs';
import { nextFixedIncomeWageFactor } from '../simulator-fixed-income.js';
import { summarizeSalesByAsset, executedSaleBreakdown } from '../simulator-portfolio.js';
import { finishSurvivorYear } from '../simulator-survivor.js';
import { buildSimulatorYearResult } from '../simulator-year-result.js';
import { SIMULATOR_YEAR_OUTCOME_KINDS } from './outcomes.js';
/** @param {import('./year-tax-inheritance.js').YearContext} context */
export function completeYear(context) {
    let {
        personalCoverage, forcedCoverage, expenseCoverage, actionResult, unmarried, portfolio, unmarriedShares,
        inheritanceLog, executedSaleSources, investmentsBeforeTax, guardrailPlanInputs, preserveLogOrder,
        incomeLog, inflowLog, expenseLog, personalPayout, liquiditaet, spendingResult, market,
        spendingNewState, yearData, fullResult, currentState, newMarketDataHist, initialLiqStart,
        jahresEntnahmePlan, jahresEntnahmeEffektiv, liqBeforePayout, liqAfterPayout,
        portfolioTotalBeforePayout, buyEqAmount, buyGoldAmount, kaufAkt, kaufGld, baseFloor, baseFlex,
        baseMinimumFlexAnnual, baseFlexBudgetAnnual, baseFlexBudgetRecharge, pensionResult, rA, rG,
        depotwertGesamt, totalTaxesThisYear, depotTranchesAktien, depotTranchesGold, equityBeforeReturn,
        equityAfterReturn, equityAfterSales, equityAfterBuys, goldBeforeReturn, goldAfterReturn,
        goldAfterSales, goldAfterBuys, cashZinsen, liqNachZins, zielLiquiditaet, bondBucketBefore,
        bondRefillGross, bondRefillNet, bondRefillTax, bondSaleAmount, is3Bucket, effectiveBaseFloor,
        pensionAnnual, rente1, rente2, renteSum, inflatedFloor, inflatedFlex, pflegeMeta, householdCtx, careP1,
        careP2, survivorYear, temporaryFlexFactor, inputs, widowBenefits, widowPensionP1, widowPensionP2,
        p1Alive, p2Alive, guardReason, isBadYear, equityPreserved, unmetLiquidity, healthBucketCoverage,
        healthBucketInterest, healthBucketDiagnostics, stressReplayTransactionCapture, regularSaleDiagnostic,
        payoutFallback, balanceTrace, fixedIncome, executedPurchases, yearNeed
    } = context;

    // Verkäufe erst nach der finalen Jahressteuer zusammenfassen.
    const payoutSources = [...personalCoverage.sources,
        ...(forcedCoverage.didForcedSale ? (forcedCoverage.sources || []).map(source => ({ ...source,
            brutto: source.brutto * (forcedCoverage.forcedSaleScaleApplied ?? 1) })) : []),
        ...(expenseCoverage?.didForcedSale ? (expenseCoverage.sources || []).map(source => ({ ...source,
            brutto: source.brutto * (expenseCoverage.forcedSaleScaleApplied ?? 1) })) : [])];
    const taxSources = actionResult.householdTaxSale?.sources || [];
    const allSources = [...(actionResult.quellen || []), ...payoutSources, ...taxSources];
    if (payoutSources.length || taxSources.length) {
        for (const source of taxSources.length ? allSources : payoutSources) {
            const taxRow = actionResult.personalAnnualTaxes?.find(row => row.profileId === source.sourceProfileId);
            const personSources = allSources
                .filter(item => item.sourceProfileId === source.sourceProfileId);
            /** @param {ActionSource} item */
            const taxable = item => Math.max(0, Number(item.taxableAfterTqfSigned) || 0);
            const totalTaxable = personSources.reduce((sum, item) => sum + taxable(item), 0);
            if (taxRow) source.steuer = totalTaxable > 0 ? taxRow.saleTaxDue * taxable(source) / totalTaxable : 0;
        }
        if (payoutSources.length) actionResult.personalPayoutSale = {
            gross: payoutSources.reduce((sum, source) => sum + source.brutto, 0), sources: payoutSources,
            ...(unmarried ? { persons: /** @type {NonNullable<typeof portfolio.personAccounts>} */ (portfolio.personAccounts).map(person => ({ profileId: person.profileId, name: person.name,
                share: unmarriedShares.find(/** @param {{profileId:string;share:number}} row */ row => row.profileId === person.profileId)?.share || 0,
                gross: payoutSources.filter(source => source.sourceProfileId === person.profileId)
                    .reduce((sum, source) => sum + source.brutto, 0) })).filter(/** @type {(row:{gross:number})=>boolean} */ (/** @param {{gross:number}} row */ row => row.gross > 0)) } : {})
        };
    }
    const legacySaleTotals = summarizeSalesByAsset({ breakdown: allSources });
    // Unabhängig von Aktionsflags zählen alle tatsächlich abgebauten Lots.
    // Diese Kopien dienen nur vk; Aktionsbeleg, Steuerabschluss und Bestände bleiben unverändert.
    if (!inheritanceLog) executedSaleSources.push(...executedSaleBreakdown(investmentsBeforeTax));
    if (inheritanceLog) executedSaleSources.push(...inheritanceLog.inheritancePayment.sources);
    /** @param {ActionSource} source */
    const taxable = source => Math.max(0, source.taxableAfterTqfSigned || 0);
    for (const source of executedSaleSources) {
        const personTax = actionResult.personalAnnualTaxes?.find(row => row.profileId
            === (source.sourceProfileId || portfolio.simulationSourceProfileId));
        const sources = personTax ? executedSaleSources.filter(item =>
            (item.sourceProfileId || portfolio.simulationSourceProfileId) === personTax.profileId) : executedSaleSources;
        const totalTaxable = sources.reduce((sum, item) => sum + taxable(item), 0);
        const saleTax = personTax?.saleTaxDue ?? actionResult.taxSettlement?.saleTaxDue
            ?? actionResult.taxSettlement?.executedTaxContract?.saleTaxDue ?? actionResult.steuer ?? 0;
        source.steuer = totalTaxable > 0 ? saleTax * taxable(source) / totalTaxable : 0;
    }
    const vk = summarizeSalesByAsset({ breakdown: executedSaleSources });

    // PE-1/MP-1: Die Kopie nach einem festen Feld lief im generischen Spread-Pfad.
    const builtYearResult = /** @type {import('../../../typcheck/rechenkern-integration').BuildSimulatorYearResult} */ (buildSimulatorYearResult)({
        guardrailPlanInputs,
        preserveLogOrder,
        inheritanceLog,
        incomeLog,
        inflowLog,
        expenseLog,
        personalPayout,
        portfolio,
        liquiditaet,
        spendingResult,
        actionResult,
        market,
        spendingNewState,
        yearData,
        fullResult,
        currentState,
        newMarketDataHist,
        initialLiqStart,
        jahresEntnahmePlan,
        jahresEntnahmeEffektiv,
        liqBeforePayout,
        liqAfterPayout,
        portfolioTotalBeforePayout,
        buyEqAmount,
        buyGoldAmount,
        kaufAkt,
        kaufGld,
        baseFloor,
        baseFlex,
        baseMinimumFlexAnnual,
        baseFlexBudgetAnnual,
        baseFlexBudgetRecharge,
        pensionResult,
        rA,
        rG,
        depotwertGesamt,
        totalTaxesThisYear,
        vk,
        legacySaleTotals,
        depotTranchesAktien,
        depotTranchesGold,
        equityBeforeReturn,
        equityAfterReturn,
        equityAfterSales,
        equityAfterBuys,
        goldBeforeReturn,
        goldAfterReturn,
        goldAfterSales,
        goldAfterBuys,
        cashZinsen,
        liqNachZins,
        zielLiquiditaet,
        bondBucketBefore,
        bondRefillGross,
        bondRefillNet,
        bondRefillTax,
        bondSaleAmount,
        bondRefillDebugVersion: is3Bucket ? 'shared-finalizer-before-payout' : '',
        bondRefillSaleShortfallGross: 0,
        effectiveBaseFloor,
        pensionAnnual,
        rente1,
        rente2,
        renteSum,
        inflatedFloor,
        inflatedFlex,
        pflegeMeta,
        householdContext: householdCtx,
        careLogContext: { careMetaP1: careP1, careMetaP2: careP2,
            deathThisYear: survivorYear?.deathThisYear === true, effectiveFlexFactor: temporaryFlexFactor },
        yearNeed,
        hasPartner: inputs.partner?.aktiv === true,
        widowBenefits,
        widowPensionP1,
        widowPensionP2,
        p1Alive,
        p2Alive,
        guardReason,
        isBadYear,
        equityPreserved,
        unmetLiquidity,
        healthBucketCoverage,
        healthBucketInterest,
        healthBucketDiagnostics,
        stressReplayTransactionDiagnostics: stressReplayTransactionCapture
            ? [
                regularSaleDiagnostic,
                forcedCoverage.transactionDiagnostic,
                ...(expenseCoverage ? [expenseCoverage.transactionDiagnostic] : []),
                payoutFallback.transactionDiagnostic
            ].filter(Boolean)
            : null,
        balanceTrace
    });
    const yearResult = /** @type {YearSuccess} */ ({ kind: SIMULATOR_YEAR_OUTCOME_KINDS.SUCCESS });
    for (const key of Object.keys(builtYearResult)) yearResult[key] = builtYearResult[key];
    if (fixedIncome && inputs.fixedIncome?.length) {
        // Wie bei der Rente: geschützte Vorjahresrate, ohne spätere Nachholung.
        // Ohne Lohnanpassung bleibt auch der ungenutzte Altstate bytegleich.
        yearResult.newState.fixedIncomeWageFactor = nextFixedIncomeWageFactor(inputs, currentState, yearData);
    }
    if (is3Bucket) {
        yearResult.logData.threeBucketTrades = threeBucketActionTrades(/** @type {NonNullable<typeof portfolio.personAccounts>} */ (portfolio.personAccounts).map(person => {
            const uses = executedPurchases.find(row => row.profileId === person.profileId)?.uses || {};
            return { name: inputs.simulationPeople?.find(p => p.profileId === person.profileId)?.name || person.profileId,
                action: { quellen: executedSaleSources.filter(q => (q.sourceProfileId || portfolio.simulationSourceProfileId) === person.profileId),
                    verwendungen: uses } };
        }));
    }
    return finishSurvivorYear(yearResult, survivorYear, pensionResult);

}
