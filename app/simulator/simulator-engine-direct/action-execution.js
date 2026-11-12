// @ts-check

import { personalProfiles, personalWithdrawalPlan, debitPersonalLiquidity, snapshotPersonalInvestments, creditPersonalSale, personalPurchaseFunding } from '../simulator-personal-accounts.js';
import { applySaleToPortfolio, isBondKind, executedSaleBreakdown, sumDepot } from '../simulator-portfolio.js';
import { euros } from '../simulator-engine-direct-utils.js';
import { addTaxRawAggregate, buildTaxRawAggregate } from '../simulator-tax-recompute.js';
import { PLANNED_ACTION_FLOW_EPSILON } from '../../../types/planned-action-contract.js';
import { recordPersonalSales } from '../simulator-personal-tax.js';
import { snapshotBalance } from './year-diagnostics.js';
/** @typedef {import('./action-plan.js').YearContext & NonNullable<ReturnType<typeof executeYearAction>['state']>} YearContext */
/** @param {import('./action-plan.js').YearContext} context */
export function executeYearAction(context) {
    let {
        actionResult, isBadYear, threeBucketState, bondRefillGross, bondRefillNet, bondRefillTax,
        equityPreserved, unmetLiquidity, portfolio, bondSaleAmount, depotTranchesAktien, depotTranchesGold,
        residenceAdvance, personalTaxBook, inputs, liquiditaet, equityAfterReturn, goldAfterReturn,
        regularSaleScale, combinedTaxRawAggregate, stressReplayTransactionCapture, balanceTrace, deathYearCash
    } = context;

    const allQuellen = Array.isArray(actionResult.quellen) ? actionResult.quellen : [];
    let saleQuellen = allQuellen.filter(q => q?.kind && q.kind !== 'liquiditaet');

    isBadYear = threeBucketState.isBadYear;
    const protectsEquity = isBadYear || actionResult.bondPayoutProtection === true;
    bondRefillGross = threeBucketState.bondRefillGross;
    bondRefillNet = threeBucketState.bondRefillNet;
    bondRefillTax = threeBucketState.bondRefillTax;
    equityPreserved = threeBucketState.equityPreserved;
    unmetLiquidity += threeBucketState.unmetLiquidity;

    let plannedSaleBrutto = saleQuellen.reduce((sum, q) => sum + (q?.brutto || 0), 0);
    let hasSales = plannedSaleBrutto > 0;
    let buyGoldAmount = 0;
    let buyEqAmount = 0;
    let buyBondAmount = 0;

    // Check if this is a cash-funded transaction (Surplus Rebalancing)
    // In this case, we DON'T sell assets - we BUY them using liquidity
    const cashQuellen = allQuellen.filter(q => q?.kind === 'liquiditaet');
    const isCashFundedPurchase = cashQuellen.length > 0 && !hasSales &&
        (actionResult.verwendungen?.gold > 0 || actionResult.verwendungen?.aktien > 0 || actionResult.verwendungen?.bonds > 0);

    const investmentsBeforeAction = hasSales ? snapshotPersonalInvestments(portfolio) : [];
    // Wende Transaktionen auf Portfolio an
    if (actionResult.type === 'TRANSACTION' && hasSales) {
        const saleResult = {
            steuerGesamt: actionResult.steuer || 0,
            bruttoVerkaufGesamt: plannedSaleBrutto,
            achievedRefill: actionResult.nettoErlös || 0,
            breakdown: saleQuellen
        };

        applySaleToPortfolio(portfolio, saleResult);
        bondSaleAmount += saleQuellen.reduce((sum, item) => {
            const kind = String(item?.kind || '').toLowerCase();
            return (isBondKind(kind) || String(item?.category || '').toLowerCase() === 'bonds')
                ? (sum + (Number(item?.brutto) || 0))
                : sum;
        }, 0);
    }
    actionResult.quellen = [...allQuellen.filter(q => q?.kind === 'liquiditaet'), ...saleQuellen];
    const equityAfterSalesAction = sumDepot({ depotTranchesAktien });
    const goldAfterSalesAction = sumDepot({ depotTranchesGold });
    const executedSaleSources = [...(residenceAdvance?.residenceTaxPayment.sources || []), ...executedSaleBreakdown(investmentsBeforeAction)];

    // Cash-funded Käufe (Quelle: Liquidität) reduzieren die Liquidität direkt.
    const cashSpend = allQuellen.reduce(
        (sum, q) => (q?.kind === 'liquiditaet' ? sum + (q.brutto || 0) : sum),
        0
    );
    const cashFunding = cashSpend > 0
        ? /** @type {import('../../../typcheck/rechenkern-integration').DebitPersonalLiquidity} */ (debitPersonalLiquidity)(portfolio, cashSpend,
            (personalTaxBook || deathYearCash) && cashQuellen.every(source => source.sourceProfileId)
                ? { mode: inputs.householdWithdrawalMode, items: cashQuellen.map(source => ({
                    profileId: source.sourceProfileId, withdrawalAmount: source.brutto })) }
                : personalWithdrawalPlan(personalProfiles(portfolio, inputs), cashSpend, inputs.householdWithdrawalMode)).items : [];
    liquiditaet = portfolio.liquiditaet;

    // FIX: For cash-funded purchases (Surplus Rebalancing), set buy amounts directly
    if (isCashFundedPurchase) {
        buyGoldAmount = actionResult.verwendungen?.gold || 0;
        buyEqAmount = actionResult.verwendungen?.aktien || 0;
        buyBondAmount = actionResult.verwendungen?.bonds || 0;
    }

    if (hasSales) {
        const executedEqSale = Math.max(0, equityAfterReturn - equityAfterSalesAction);
        const executedGldSale = Math.max(0, goldAfterReturn - goldAfterSalesAction);
        const executedTotalSale = executedEqSale + executedGldSale;
        regularSaleScale = plannedSaleBrutto > 0 ? Math.min(1, executedTotalSale / plannedSaleBrutto) : 0;
        combinedTaxRawAggregate = buildTaxRawAggregate();
        addTaxRawAggregate(combinedTaxRawAggregate, actionResult?.taxRawAggregate, regularSaleScale);
        recordPersonalSales(portfolio, investmentsBeforeAction,
            saleQuellen.map(source => ({ ...source, steuer: (source.steuer || 0) * regularSaleScale })));
    }
    const regularSaleBreakdown = stressReplayTransactionCapture && hasSales && regularSaleScale > 0
        ? saleQuellen.map(source => ({
            assetClass: source?.category || source?.kind || 'unknown',
            grossEur: (Number(source?.brutto) || 0) * regularSaleScale,
            netEur: typeof source?.netto === 'number' && Number.isFinite(source.netto) && source.netto >= 0
                ? source.netto * regularSaleScale
                : null,
            taxEur: typeof source?.steuer === 'number' && Number.isFinite(source.steuer) && source.steuer >= 0
                ? source.steuer * regularSaleScale
                : null
        }))
        : [];
    const regularSaleMissingness = regularSaleBreakdown.flatMap((item, breakdownIndex) => [
        ...(item.netEur === null ? [{
            scope: 'breakdown',
            breakdownIndex,
            assetClass: item.assetClass,
            field: 'netEur',
            reason: 'policy_sale_breakdown_net_not_reported'
        }] : []),
        ...(item.taxEur === null ? [{
            scope: 'breakdown',
            breakdownIndex,
            assetClass: item.assetClass,
            field: 'taxEur',
            reason: 'policy_sale_breakdown_tax_not_reported'
        }] : [])
    ]);
    const regularSaleDiagnostic = stressReplayTransactionCapture && hasSales && regularSaleScale > 0
        ? {
            class: 'policy_rebalancing_sale',
            phase: 'after_action_sales',
            oracle: 'engine_action_sources_with_execution_scale_v1',
            requestedNetEur: Number(actionResult.nettoErlös) || 0,
            grossEur: plannedSaleBrutto * regularSaleScale,
            netEur: (Number(actionResult.nettoErlös) || 0) * regularSaleScale,
            taxEur: (Number(actionResult.steuer) || 0) * regularSaleScale,
            breakdown: regularSaleBreakdown,
            missingness: regularSaleMissingness
        }
        : null;

    // Aktualisiere Liquidität nach Transaktionen
    let saleFunding = [];
    if (hasSales && actionResult.nettoErlös > 0) {
        const actualNettoErlos = (actionResult.nettoErlös || 0) * regularSaleScale;
        buyGoldAmount = (actionResult.verwendungen?.gold || 0) * regularSaleScale;
        buyEqAmount = (actionResult.verwendungen?.aktien || 0) * regularSaleScale;
        buyBondAmount = (actionResult.verwendungen?.bonds || 0) * regularSaleScale;
        // Proceeds stay with the sellers; the reinvested part finances their new lots.
        // Purchase debits are booked below before the actual lot creation.
        saleFunding = creditPersonalSale(portfolio, investmentsBeforeAction, Math.max(0, actualNettoErlos - cashSpend),
            saleQuellen.map(source => ({ ...source, steuer: (source.steuer || 0) * regularSaleScale })));
    }
    const reinvestTotal = buyGoldAmount + buyEqAmount + buyBondAmount;
    // Cash-funded amounts were already debited; sale proceeds still need the purchase debit.
    const saleReinvest = Math.max(0, reinvestTotal - cashFunding.reduce((sum, row) => sum + row.amount, 0));
    const purchaseFunding = [...cashFunding, ...personalPurchaseFunding(portfolio, saleReinvest, saleFunding)];
    liquiditaet = portfolio.liquiditaet;
    if (liquiditaet < 0 && liquiditaet >= -PLANNED_ACTION_FLOW_EPSILON) {
        liquiditaet = 0;
    }
    snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_action_sales', {
        plannedSaleBrutto: euros(plannedSaleBrutto),
        nettoErlos: hasSales ? euros(actionResult.nettoErlös) : 0,
        cashSpend: euros(cashSpend),
        buyEqAmount: euros(buyEqAmount),
        buyGoldAmount: euros(buyGoldAmount)
    });
    return { state: {
        actionResult, saleQuellen, isBadYear, threeBucketState, protectsEquity, bondRefillGross, bondRefillNet,
        bondRefillTax, equityPreserved, unmetLiquidity, buyGoldAmount, buyEqAmount, buyBondAmount, portfolio,
        bondSaleAmount, depotTranchesAktien, depotTranchesGold, executedSaleSources, personalTaxBook, inputs,
        liquiditaet, equityAfterReturn, goldAfterReturn, regularSaleScale, combinedTaxRawAggregate,
        stressReplayTransactionCapture, regularSaleDiagnostic, saleFunding, reinvestTotal, purchaseFunding,
        balanceTrace
    } };
}
