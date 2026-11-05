// @ts-check
/** @import {YearOutcome} from '../../../typcheck/rechenkern' */
import { unmarriedWithdrawalPlan, debitUnmarriedPlan } from '../simulator-unmarried.js';
import { reconcileWithdrawalLiquidity } from '../../profile/profilverbund-balance.js';
import { personalProfiles, personalWithdrawalPlan, debitPersonalLiquidity, snapshotPersonalInvestments, creditPersonalSale } from '../simulator-personal-accounts.js';
import { buyGold, buyStocksNeu, executedSaleBreakdown, sumDepot } from '../simulator-portfolio.js';
import { euros } from '../simulator-engine-direct-utils.js';
import { applyPayoutFallbackSale } from '../simulator-forced-sale.js';
import { buyPlannedBonds } from '../simulator-bond-refill.js';
import { recordPersonalSales, coverPersonalPayout } from '../simulator-personal-tax.js';
import { ruinOutcome, snapshotBalance } from './year-diagnostics.js';
import { formatInteger } from './outcomes.js';
/** @typedef {import('./withdrawal-coverage.js').YearContext & NonNullable<ReturnType<typeof payYearWithdrawal>['state']>} YearContext */
/** @param {import('./withdrawal-coverage.js').YearContext} context */
export function payYearWithdrawal(context) {
    let {
        depotTranchesAktien, depotTranchesGold, portfolio, purchaseFunding, is3Bucket, actionResult,
        reinvestTotal, buyEqAmount, buyGoldAmount, buyBondAmount, bondRefillNet, bondRefillGross,
        regularSaleScale, bondRefillTax, unmarried, unmarriedShares, ownedPlan, market, personalCoverage,
        executedSaleSources, liquiditaet, netFloorYear, currentState, inflowLog, expenseLog,
        marketDataCurrentYear, depotwertGesamt, plannedExpense, incomeConsumed, jahresEntnahmeTarget, inputs,
        protectsEquity, stressReplayTransactionCapture, bondSaleAmount, unmetLiquidity,
        cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage, balanceTrace
    } = context;

    const equityAfterSales = sumDepot({ depotTranchesAktien });
    const goldAfterSales = sumDepot({ depotTranchesGold });

    // Kaufe Gold/Aktien wenn vorhanden
    const buyers = /** @type {NonNullable<typeof portfolio.personAccounts>} */ (portfolio.personAccounts).map(person => ({ profileId: person.profileId,
        amount: purchaseFunding.filter(row => row.profileId === person.profileId).reduce((sum, row) => sum + row.amount, 0) }));
    const executedPurchases = /** @type {{profileId:string;uses:Record<string,number>}[]} */ ([]);
    for (const row of buyers.filter(row => row.amount > 0)) {
        const local = is3Bucket ? actionResult.personalPlannedActions?.find(entry => entry.profileId === row.profileId)?.action.verwendungen : null;
        const planned = local ? (local.aktien || 0) + (local.gold || 0) + (local.bonds || 0) : reinvestTotal;
        const share = planned > 0 ? row.amount / planned : 0;
        const uses = { aktien: (local?.aktien ?? buyEqAmount) * share, gold: (local?.gold ?? buyGoldAmount) * share,
            bonds: (local?.bonds ?? buyBondAmount) * share };
        if (uses.gold > 0) /** @type {import('../../../typcheck/rechenkern-integration').BuyPersonalAsset} */ (buyGold)(portfolio, uses.gold, row.profileId);
        if (uses.aktien > 0) /** @type {import('../../../typcheck/rechenkern-integration').BuyPersonalAsset} */ (buyStocksNeu)(portfolio, uses.aktien, row.profileId);
        if (uses.bonds > 0) buyPlannedBonds(portfolio, uses.bonds, row.profileId);
        executedPurchases.push({ profileId: row.profileId, uses });
    }
    if (is3Bucket) {
        const executedBuy = buyers.reduce((sum, row) => sum + row.amount, 0);
        bondRefillNet = reinvestTotal > 0 ? buyBondAmount * executedBuy / reinvestTotal : 0;
        bondRefillGross *= regularSaleScale;
        bondRefillTax *= regularSaleScale;
    }
    let equityAfterBuys = sumDepot({ depotTranchesAktien });
    let goldAfterBuys = sumDepot({ depotTranchesGold });
    snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_buys', {
        buyEqAmount: euros(buyEqAmount),
        buyGoldAmount: euros(buyGoldAmount),
        ...(is3Bucket ? { buyBondAmount: euros(buyBondAmount) } : {})
    });

    if (unmarried) {
        // Die reguläre Anlage kann vorab finanzierte Käufe enthalten. Erst mit
        // diesen Lots ist auch bei vollständig rentengedecktem Bedarf jeder
        // persönliche Zahlungsanteil aus dem eigenen Vermögen finanzierbar.
        const beforeOwnedCoverage = snapshotPersonalInvestments(portfolio);
        const finalPlan = /** @type {import('../../../typcheck/rechenkern-integration').UnmarriedWithdrawalPlan} */ (unmarriedWithdrawalPlan)(unmarriedShares, /** @type {NonNullable<typeof ownedPlan>} */ (ownedPlan).totalNeed, portfolio);
        const coverage = coverPersonalPayout(portfolio, finalPlan, market);
        personalCoverage.raised += coverage.raised;
        personalCoverage.sources.push(...coverage.sources);
        executedSaleSources.push(...executedSaleBreakdown(beforeOwnedCoverage));
        /** @type {NonNullable<typeof ownedPlan>} */ (ownedPlan).items = finalPlan.items;
        liquiditaet = portfolio.liquiditaet;
        equityAfterBuys = sumDepot({ depotTranchesAktien });
        goldAfterBuys = sumDepot({ depotTranchesGold });
    }
    const totalWealthAvailable = equityAfterBuys + goldAfterBuys + liquiditaet;
    if (totalWealthAvailable + 1e-6 < netFloorYear) {
        return { outcome: /** @type {YearOutcome} */ (ruinOutcome({
            currentState,
            inflowLog,
            expenseLog,
            portfolio,
            liquiditaet,
            marketDataCurrentYear,
            reason: `Gesamtvermögen (${formatInteger(totalWealthAvailable)}) < Floor (${formatInteger(netFloorYear)})`,
            personalTaxFunding: actionResult.personalTaxFunding,
            requiredFloorNominal: netFloorYear,
            coveredFloorNominal: totalWealthAvailable,
            // D-14 measures the amount actually paid out. This ruin branch
            // terminates before the payout step, so the realized withdrawal
            // is exactly zero even if residual wealth could cover part of the
            // floor.
            effectiveWithdrawalNominal: 0,
            depotValueNominal: depotwertGesamt
        }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
    }

    if (plannedExpense > 0 && (totalWealthAvailable + 1e-6 < netFloorYear + plannedExpense
        || liquiditaet + 1e-6 < netFloorYear + plannedExpense)) {
        return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog, portfolio, liquiditaet, marketDataCurrentYear,
            reason: `Geplante Ausgaben ungedeckt (${formatInteger(plannedExpense)} EUR)`,
            requiredFloorNominal: netFloorYear, coveredFloorNominal: Math.min(netFloorYear, Math.max(0, liquiditaet - plannedExpense)),
            effectiveWithdrawalNominal: 0, depotValueNominal: depotwertGesamt }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
    }

    // Hinweis: Ein Liquiditäts-Engpass erzeugt keinen Ruin, solange das Gesamtvermögen den Floor deckt.
    // Payout wird unten an die Liquidität angepasst.

    // Auszahlung (begrenzt auf verfügbare Liquidität)
    // Hinweis: jahresEntnahmeTarget wurde bereits oben für forcedShortfall berechnet
    const liqBeforePayout = euros(liquiditaet);
    const portfolioTotalBeforePayout = euros(totalWealthAvailable - incomeConsumed);
    const payout = Math.min(Math.max(0, liquiditaet - plannedExpense - incomeConsumed), jahresEntnahmeTarget);
    const personalPayout = unmarried
        ? debitUnmarriedPlan(portfolio, { ...ownedPlan, items: /** @type {NonNullable<typeof ownedPlan>} */ (ownedPlan).items.map((item, i) => ({ ...item,
            withdrawalAmount: Math.max(0, item.withdrawalAmount - plannedExpense * unmarriedShares[i].share - (jahresEntnahmeTarget - payout) * unmarriedShares[i].share) })) })
        : /** @type {import('../../../typcheck/rechenkern-integration').DebitPersonalLiquidity} */ (debitPersonalLiquidity)(portfolio, payout,
            reconcileWithdrawalLiquidity(personalWithdrawalPlan(personalProfiles(portfolio, inputs), payout, inputs.householdWithdrawalMode), portfolio.personAccounts));
    if (unmarried && personalPayout.total + 0.01 < payout + incomeConsumed) {
        return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog, portfolio, liquiditaet: portfolio.liquiditaet, marketDataCurrentYear,
            reason: 'Persönlicher Ausgabenanteil ungedeckt', requiredFloorNominal: netFloorYear,
            coveredFloorNominal: personalPayout.total, effectiveWithdrawalNominal: Math.max(0, personalPayout.total - incomeConsumed), depotValueNominal: depotwertGesamt }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
    }
    liquiditaet = portfolio.liquiditaet;
    const liqAfterPayout = euros(liquiditaet);
    const jahresEntnahmeEffektiv = payout;
    snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_payout', {
        payout: euros(payout),
        jahresEntnahmeTarget: euros(jahresEntnahmeTarget),
        portfolioTotalBeforePayout
    });

    const investmentsBeforeFallback = jahresEntnahmeEffektiv + 1e-6 < netFloorYear ? snapshotPersonalInvestments(portfolio) : [];
    const payoutFallback = /** @type {ReturnType<typeof applyPayoutFallbackSale> & {reason?:string}} */ (applyPayoutFallbackSale({
        jahresEntnahmeEffektiv,
        netFloorYear,
        liquiditaet,
        payout,
        is3Bucket,
        isBadYear: protectsEquity,
        depotTranchesAktien,
        depotTranchesGold,
        formatRuinNumber: formatInteger,
        captureTransactions: stressReplayTransactionCapture
    }));
    if (payoutFallback.isRuin) {
        return { outcome: /** @type {YearOutcome} */ (ruinOutcome({
            currentState,
            inflowLog,
            expenseLog,
            portfolio,
            liquiditaet: payoutFallback.liquiditaet,
            marketDataCurrentYear,
            reason: /** @type {string} */ (payoutFallback.reason),
            personalTaxFunding: actionResult.personalTaxFunding,
            requiredFloorNominal: netFloorYear,
            coveredFloorNominal: jahresEntnahmeEffektiv + equityAfterBuys + goldAfterBuys,
            // Assets that remain after the partial payout are coverage
            // capacity, not an effective withdrawal.
            effectiveWithdrawalNominal: jahresEntnahmeEffektiv,
            depotValueNominal: depotwertGesamt
        }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
    }
    const fallbackGross = investmentsBeforeFallback.reduce((sum, row) => sum + Math.max(0, row.value - row.lot.marketValue), 0);
    executedSaleSources.push(...executedSaleBreakdown(investmentsBeforeFallback));
    if (fallbackGross > 0) {
        recordPersonalSales(portfolio, investmentsBeforeFallback);
        creditPersonalSale(portfolio, investmentsBeforeFallback, fallbackGross);
        /** @type {import('../../../typcheck/rechenkern-integration').DebitPersonalLiquidity} */ (debitPersonalLiquidity)(portfolio, Math.max(0, portfolio.liquiditaet - payoutFallback.liquiditaet));
    }
    liquiditaet = portfolio.liquiditaet;
    bondSaleAmount += payoutFallback.bondSaleAmountDelta;
    unmetLiquidity += payoutFallback.unmetLiquidityDelta;
    if (stressReplayTransactionCapture && payoutFallback.transactionDiagnostic) {
        snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_payout_fallback', {
            grossSale: euros(payoutFallback.transactionDiagnostic.grossEur),
            netProceeds: euros(payoutFallback.transactionDiagnostic.netEur),
            taxMissing: payoutFallback.transactionDiagnostic.taxEur === null
        });
    }

    if (plannedExpense > 0) {
        if (liquiditaet + 1e-6 < plannedExpense) {
            return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog, portfolio, liquiditaet, marketDataCurrentYear,
                reason: `Geplante Ausgaben ungedeckt (${formatInteger(plannedExpense)} EUR)`,
                requiredFloorNominal: netFloorYear, coveredFloorNominal: Math.min(netFloorYear, jahresEntnahmeEffektiv),
                effectiveWithdrawalNominal: jahresEntnahmeEffektiv, depotValueNominal: depotwertGesamt }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
        }
        if (unmarried) {
            const paid = debitUnmarriedPlan(portfolio, /** @type {import('../../../typcheck/rechenkern-integration').UnmarriedWithdrawalPlan} */ (unmarriedWithdrawalPlan)(unmarriedShares, plannedExpense, portfolio, false));
            if (paid.total + .01 < plannedExpense) return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog, portfolio,
                liquiditaet: portfolio.liquiditaet, marketDataCurrentYear, reason: 'Persönlicher Anteil der geplanten Ausgabe ungedeckt',
                requiredFloorNominal: netFloorYear, coveredFloorNominal: jahresEntnahmeEffektiv,
                effectiveWithdrawalNominal: jahresEntnahmeEffektiv, depotValueNominal: depotwertGesamt }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
        }
        else /** @type {import('../../../typcheck/rechenkern-integration').DebitPersonalLiquidity} */ (debitPersonalLiquidity)(portfolio, plannedExpense,
            reconcileWithdrawalLiquidity(personalWithdrawalPlan(personalProfiles(portfolio, inputs), plannedExpense, inputs.householdWithdrawalMode), portfolio.personAccounts));
        liquiditaet = portfolio.liquiditaet;
        snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_planned_expenses', { plannedExpenses: plannedExpense });
    }

    // Bestehende Standardlogs behalten ihren leeren Phasenmarker.
    if (!is3Bucket) snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_bond_refill', {
        bondRefillGross: 0,
        bondRefillNet: 0,
        bondRefillTax: 0,
        bondRefillDebugVersion: '',
        bondRefillSaleShortfallGross: 0
    });
    return { state: {
        equityAfterSales, depotTranchesAktien, goldAfterSales, depotTranchesGold, portfolio, executedPurchases,
        is3Bucket, actionResult, buyEqAmount, buyGoldAmount, bondRefillNet, bondRefillGross, regularSaleScale,
        bondRefillTax, equityAfterBuys, goldAfterBuys, unmarried, unmarriedShares, market, personalCoverage,
        executedSaleSources, liquiditaet, netFloorYear, currentState, inflowLog, expenseLog,
        marketDataCurrentYear, depotwertGesamt, liqBeforePayout, portfolioTotalBeforePayout, personalPayout,
        inputs, liqAfterPayout, jahresEntnahmeEffektiv, payoutFallback, stressReplayTransactionCapture,
        bondSaleAmount, unmetLiquidity, cumulativeInflationFactor, healthBucketInterest, yearData,
        healthBucketCoverage, balanceTrace
    } };
}
