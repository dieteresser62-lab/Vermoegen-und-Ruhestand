// @ts-check
/** @import {YearOutcome} from '../../../typcheck/rechenkern' */
import { unmarriedWithdrawalPlan, debitUnmarriedPlan, unmarriedPayoutPlan, capCarrierToPayable, unmarriedFlexCut, unmarriedFloorGap, unmarriedHouseholdFloor } from '../simulator-unmarried.js';
import { reconcileWithdrawalLiquidity } from '../../profile/profilverbund-balance.js';
import { personalProfiles, personalWithdrawalPlan, debitPersonalLiquidity, snapshotPersonalInvestments, creditPersonalSale } from '../simulator-personal-accounts.js';
import { buyGold, buyStocksNeu, executedSaleBreakdown, sumDepot } from '../simulator-portfolio.js';
import { euros } from '../simulator-engine-direct-utils.js';
import { applyPayoutFallbackSale } from '../simulator-forced-sale.js';
import { buyPlannedBonds } from '../simulator-bond-refill.js';
import { recordPersonalSales, coverPersonalPayout } from '../simulator-personal-tax.js';
import { ruinOutcome, snapshotBalance } from './year-diagnostics.js';
import { formatInteger } from './outcomes.js';
import { parseWithdrawalMode, ONE_CARRIES } from '../../profile/household-withdrawal-mode.js';
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
        const finalPlan = /** @type {import('../../../typcheck/rechenkern-integration').UnmarriedWithdrawalPlan} */ (unmarriedWithdrawalPlan)(unmarriedShares, /** @type {NonNullable<typeof ownedPlan>} */ (ownedPlan).totalNeed, portfolio, true, /** @type {any} */ (ownedPlan).credits || null);
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
        ? debitUnmarriedPlan(portfolio, unmarriedPayoutPlan(/** @type {any} */ (ownedPlan), unmarriedShares,
            { payout, incomeConsumed, plannedExpense, target: jahresEntnahmeTarget }, portfolio))
        : /** @type {import('../../../typcheck/rechenkern-integration').DebitPersonalLiquidity} */ (debitPersonalLiquidity)(portfolio, payout,
            reconcileWithdrawalLiquidity(personalWithdrawalPlan(personalProfiles(portfolio, inputs), payout, inputs.householdWithdrawalMode), portfolio.personAccounts));
    // FR-81: Im Vorgabemodus kürzt ein fehlender Teil nur den Flex-Anteil der Person, solange ihr Anteil am Grundbedarf gedeckt ist.
    const personalShortfall = unmarried && personalPayout.total + 0.01 < payout + incomeConsumed;
    const defaultMode = unmarried && !unmarriedShares.some((/** @type {any} */ row) => row.carries);
    const floorAmounts = { payout, incomeConsumed, netFloorYear, floor: context.engineInput?.floorBedarf };
    const flexCut = personalShortfall && defaultMode ? unmarriedFlexCut(/** @type {any} */ (personalPayout), floorAmounts) : null;
    if (personalShortfall && !flexCut) {
        // FR-81: Im Vorgabemodus ist die Lücke der ungedeckte persönliche Anteil am Grundbedarf.
        const floorGap = defaultMode ? unmarriedFloorGap(/** @type {any} */ (personalPayout), floorAmounts) : null;
        return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog, portfolio, liquiditaet: portfolio.liquiditaet, marketDataCurrentYear,
            reason: 'Persönlicher Ausgabenanteil ungedeckt', requiredFloorNominal: floorGap === null ? netFloorYear : unmarriedHouseholdFloor(floorAmounts),
            coveredFloorNominal: floorGap === null ? personalPayout.total : Math.max(0, unmarriedHouseholdFloor(floorAmounts) - floorGap),
            effectiveWithdrawalNominal: Math.max(0, personalPayout.total - incomeConsumed), depotValueNominal: depotwertGesamt }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
    }
    if (flexCut?.length) /** @type {any} */ (personalPayout).flexCut = flexCut;
    // Ergänzung 1 FR-81 (VN-1 Punkt 15): Kürzung, obwohl die Einkünfte des Haushalts den Bedarf decken (keine Entnahme aus dem Vermögen
    // nötig). Nur Merkmal für den Hinweis im Protokoll; gerechnet wird nichts anders.
    if (flexCut?.length && jahresEntnahmeTarget < 0.5) /** @type {any} */ (personalPayout).flexCutIncomeCovers = true;
    liquiditaet = portfolio.liquiditaet;
    const liqAfterPayout = euros(liquiditaet);
    // FR-81 (Nachtrag 1): Die Entnahme sinkt auf den tatsächlich gezahlten Betrag; der Engine-Anker rechnet mit der geplanten Auszahlung.
    const jahresEntnahmeEffektiv = flexCut ? Math.max(0, personalPayout.total - incomeConsumed) : payout;
    const personalFlexCutNominal = payout - jahresEntnahmeEffektiv;
    // RK-3 Punkt 1 (FR-81 Punkt 3): ganze Kürzung im Haushalt, auch der Teil aus verbrauchten Einkünften (Kennzahlen, Ausgaben, Rohdaten).
    const personalFlexCutTotal = flexCut?.length ? flexCut.reduce((sum, row) => sum + row.amount, 0) : 0;
    snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_payout', {
        payout: euros(jahresEntnahmeEffektiv),
        jahresEntnahmeTarget: euros(jahresEntnahmeTarget),
        portfolioTotalBeforePayout
    });

    // FR-81: Nach einer Flex-Kürzung ist jeder Anteil am Grundbedarf gedeckt; kein Rückfallverkauf über die andere Person.
    // Zahlt jede Person ihren ganzen Plan (leere Kürzung), bleibt der bisherige Rückfallverkauf für den Grundbedarf.
    const fallbackFloor = flexCut?.length ? Math.min(netFloorYear, jahresEntnahmeEffektiv) : netFloorYear;
    const investmentsBeforeFallback = jahresEntnahmeEffektiv + 1e-6 < fallbackFloor ? snapshotPersonalInvestments(portfolio) : [];
    const payoutFallback = /** @type {ReturnType<typeof applyPayoutFallbackSale> & {reason?:string}} */ (applyPayoutFallbackSale({
        jahresEntnahmeEffektiv,
        netFloorYear: fallbackFloor,
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
        // TRG-1c Punkt 3: Rückfallverkauf zahlt bei „Eine Person trägt“ nach dem Modus (sonst wie bisher steueroptimiert).
        const fallbackDebit = /** @type {any} */ (debitPersonalLiquidity)(portfolio, Math.max(0, portfolio.liquiditaet - payoutFallback.liquiditaet), null,
            parseWithdrawalMode(inputs.householdWithdrawalMode).kind === ONE_CARRIES ? inputs.householdWithdrawalMode : undefined);
        if (fallbackDebit.attacked?.length) /** @type {any} */ (actionResult).carrierAttacked = [...(/** @type {any} */ (actionResult).carrierAttacked || []), ...fallbackDebit.attacked];
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
        /** @type {{attacked?: {profileId: string, amount: number}[]}} */
        let expensePaid;
        if (unmarried) {
            // VK-3b (Gutachten VK3-FABLE P2-2): Auch die geplante Ausgabe zahlt die tragende Person nur, soweit sie auszahlen kann.
            const expensePlan = /** @type {import('../../../typcheck/rechenkern-integration').UnmarriedWithdrawalPlan} */ (unmarriedWithdrawalPlan)(unmarriedShares, plannedExpense, portfolio, false);
            const paid = debitUnmarriedPlan(portfolio, unmarriedShares.some((/** @type {any} */ row) => row.carries) ? capCarrierToPayable(expensePlan, unmarriedShares, portfolio) : expensePlan);
            if (paid.total + .01 < plannedExpense) return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog, portfolio,
                liquiditaet: portfolio.liquiditaet, marketDataCurrentYear, reason: 'Persönlicher Anteil der geplanten Ausgabe ungedeckt',
                requiredFloorNominal: netFloorYear, coveredFloorNominal: jahresEntnahmeEffektiv,
                effectiveWithdrawalNominal: jahresEntnahmeEffektiv, depotValueNominal: depotwertGesamt }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
            expensePaid = paid;
        }
        else expensePaid = /** @type {import('../../../typcheck/rechenkern-integration').DebitPersonalLiquidity} */ (debitPersonalLiquidity)(portfolio, plannedExpense,
            reconcileWithdrawalLiquidity(personalWithdrawalPlan(personalProfiles(portfolio, inputs), plannedExpense, inputs.householdWithdrawalMode), portfolio.personAccounts));
        // VK-3b (Gutachten VK3 Befund 4): Greift die geplante Ausgabe auf die andere Person zu, steht der Hinweis im Jahresprotokoll wie beim Rückfallverkauf.
        if (expensePaid?.attacked?.length) /** @type {any} */ (actionResult).carrierAttacked = [...(/** @type {any} */ (actionResult).carrierAttacked || []), ...expensePaid.attacked];
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
        inputs, liqAfterPayout, jahresEntnahmeEffektiv, personalFlexCutNominal, personalFlexCutTotal, payoutFallback, stressReplayTransactionCapture,
        bondSaleAmount, unmetLiquidity, cumulativeInflationFactor, healthBucketInterest, yearData,
        healthBucketCoverage, balanceTrace
    } };
}
