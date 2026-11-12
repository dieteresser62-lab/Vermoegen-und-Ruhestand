// @ts-check

import { creditConsumedIncome, unmarriedWithdrawalPlan } from '../simulator-unmarried.js';
import { syncPersonalLiquidity, personalProfiles, personalWithdrawalPlan, snapshotPersonalInvestments, creditPersonalSale } from '../simulator-personal-accounts.js';
import { isBondKind, executedSaleBreakdown, sumDepot } from '../simulator-portfolio.js';
import { euros } from '../simulator-engine-direct-utils.js';
import { applyForcedSaleLiquidityCoverage } from '../simulator-forced-sale.js';
import { applyHealthBucketCoverage } from '../simulator-health-bucket.js';
import { attributeSimulatorAction, recordPersonalSales, coverPersonalPayout, recordPersonalDisposal } from '../simulator-personal-tax.js';
import { snapshotBalance } from './year-diagnostics.js';
/** @typedef {import('./action-execution.js').YearContext & NonNullable<ReturnType<typeof coverYearWithdrawal>['state']>} YearContext */
/** @param {import('./action-execution.js').YearContext} context */
export function coverYearWithdrawal(context) {
    let {
        plannedWithdrawalResolution, engineInput, pensionAnnual, plannedExpense, unmarried, portfolio, inputs,
        pensionResult, fixedIncome, incomeLog, liquiditaet, unmarriedShares, healthBucketCoverage,
        healthBucketHousehold, pflegeMeta, careFloorAddition, healthBucketCareNeed, personalTaxBook, profilesAtDecision, market,
        is3Bucket, protectsEquity, depotTranchesAktien, depotTranchesGold, combinedTaxRawAggregate,
        stressReplayTransactionCapture, bondSaleAmount, unmetLiquidity, didForcedSale, forcedSaleScaleApplied,
        forcedTaxReserved, saleQuellen, regularSaleScale, executedSaleSources, balanceTrace
    } = context;

    // Auch injizierbare Engine-Adapter dürfen nur die Monatsdarstellung
    // liefern. Derselbe Vertrag wie im Core reconciliert alle vorhandenen
    // Darstellungen; fehlende oder widersprüchliche Shapes scheitern sichtbar.
    const jahresEntnahmePlan = plannedWithdrawalResolution.annualWithdrawal;
    const jahresEntnahme = jahresEntnahmePlan;

    // RUIN-Check: Können wir zumindest den Floor decken?
    // Berechnung des Netto-Floors (Floor - Rente)
    const netFloorYear = Math.max(0, engineInput.floorBedarf - pensionAnnual);

    // FIX: forcedShortfall muss die TATSÄCHLICHE Entnahme abdecken, nicht nur den Floor.
    // Sonst kann bei Flex-Ausgaben ein Liquiditätsengpass entstehen.
    // Zusätzlich: Mindest-Puffer für das nächste Jahr einplanen (1 Monat Floor-Deckung),
    // um emergency_guard am Jahresende zu vermeiden.
    const jahresEntnahmeTarget = Math.max(jahresEntnahmePlan, netFloorYear);
    const minLiqAfterPayout = netFloorYear / 12; // 1 Monat Mindest-Liquidität nach Auszahlung
    // FR-43: Die Reserve ist bereits im Engineziel enthalten. Hier nur eine
    // verbleibende Deckungslücke finanzieren; die Zahlung selbst folgt einmalig.
    const expenseLog = plannedExpense > 0 ? { geplante_ausgaben: plannedExpense } : null;
    const incomeConsumed = unmarried ? creditConsumedIncome(portfolio, inputs, pensionResult, fixedIncome, incomeLog) : 0;
    if (unmarried) liquiditaet = portfolio.liquiditaet;
    const ownedPlan = unmarried ? /** @type {import('../../../typcheck/rechenkern-integration').UnmarriedWithdrawalPlan} */ (unmarriedWithdrawalPlan)(unmarriedShares, jahresEntnahmeTarget + incomeConsumed + plannedExpense, portfolio) : null;
    const totalLiqNeed = jahresEntnahmeTarget + minLiqAfterPayout + incomeConsumed;
    let forcedShortfall = Math.max(0, totalLiqNeed + plannedExpense - liquiditaet);
    healthBucketCoverage = /** @type {import('../../../typcheck/rechenkern-integration').ApplyHealthBucketCoverage} */ (applyHealthBucketCoverage)({
        inputs,
        portfolio,
        householdContext: healthBucketHousehold,
        pflegeMeta,
        forcedShortfall,
        careFloorAddition: healthBucketCareNeed ?? careFloorAddition
    });
    if (healthBucketCoverage.used > 0) {
        const consumed = healthBucketCoverage.consumedTranches;
        const attributed = consumed.reduce((sum, lot) => sum + lot.marketValue, 0);
        for (const lot of consumed) {
            recordPersonalDisposal(portfolio, lot, lot.marketValue, lot.costBasis);
            const account = /** @type {NonNullable<typeof portfolio.personAccounts>} */ (portfolio.personAccounts).find(person => person.profileId === lot.sourceProfileId) || /** @type {NonNullable<typeof portfolio.personAccounts>} */ (portfolio.personAccounts)[0];
            account.tagesgeld += lot.marketValue;
        }
        let cashAttributed = 0;
        for (const row of healthBucketCoverage.consumedCash || []) {
            const account = /** @type {NonNullable<typeof portfolio.personAccounts>} */ (portfolio.personAccounts).find(person => person.profileId === row.profileId);
            if (account) { account.tagesgeld += row.amount; cashAttributed += row.amount; }
        }
        /** @type {NonNullable<typeof portfolio.personAccounts>} */ (portfolio.personAccounts)[0].tagesgeld += Math.max(0, healthBucketCoverage.used - attributed - cashAttributed);
        syncPersonalLiquidity(portfolio);
        liquiditaet = portfolio.liquiditaet;
        forcedShortfall = Math.max(0, forcedShortfall - healthBucketCoverage.used);
    }
    const investmentsBeforeCoverage = snapshotPersonalInvestments(portfolio);
    const personalCoverage = personalTaxBook ? coverPersonalPayout(portfolio,
        ownedPlan || personalWithdrawalPlan(profilesAtDecision, jahresEntnahmeTarget + plannedExpense, inputs.householdWithdrawalMode),
        market, is3Bucket && protectsEquity) : { raised: 0, sources: [] };
    if (personalTaxBook && portfolio.liquiditaet + 1e-6 < netFloorYear + plannedExpense && is3Bucket && protectsEquity) {
        // Der Anleihenschutz im Bär darf Grundbedarf und fällige geplante Ausgabe nicht verhindern.
        // Für die offene Summe stehen die Anlagen des gesamten Haushalts bereit.
        const floorCoverage = coverPersonalPayout(portfolio,
            personalWithdrawalPlan(personalProfiles(portfolio, inputs), netFloorYear + plannedExpense, inputs.householdWithdrawalMode), market);
        personalCoverage.raised += floorCoverage.raised;
        personalCoverage.sources.push(...floorCoverage.sources);
    }
    liquiditaet = portfolio.liquiditaet;
    forcedShortfall = Math.max(0, totalLiqNeed + plannedExpense - liquiditaet);
    if (unmarried) {
        // Persönliche Lücken auch dann decken, wenn der Partner noch Tagesgeld hat.
        const revisedPlan = /** @type {import('../../../typcheck/rechenkern-integration').UnmarriedWithdrawalPlan} */ (unmarriedWithdrawalPlan)(unmarriedShares, /** @type {NonNullable<typeof ownedPlan>} */ (ownedPlan).totalNeed, portfolio);
        const ownCoverage = coverPersonalPayout(portfolio, revisedPlan, market);
        personalCoverage.raised += ownCoverage.raised;
        personalCoverage.sources.push(...ownCoverage.sources);
        /** @type {NonNullable<typeof ownedPlan>} */ (ownedPlan).items = revisedPlan.items;
        liquiditaet = portfolio.liquiditaet;
        forcedShortfall = Math.max(0, totalLiqNeed + plannedExpense - liquiditaet);
    }
    const forcedFunding = /** @type {{profileId:string;amount:number}[]} */ ([]);
    /** @param {number} shortfall
 * @param {boolean} protectEquity */
    const coverShortfall = (shortfall, protectEquity) => {
        const equityBeforeForced = sumDepot({ depotTranchesAktien });
        const goldBeforeForced = sumDepot({ depotTranchesGold });
        const investments = shortfall > 0 ? snapshotPersonalInvestments(portfolio) : [];
        const coverage = /** @type {import('../../../typcheck/rechenkern-integration').ApplyForcedSaleLiquidityCoverage} */ (applyForcedSaleLiquidityCoverage)({
            forcedShortfall: shortfall, portfolio, engineInput, market, is3Bucket,
            isBadYear: protectEquity, depotTranchesAktien, depotTranchesGold,
            equityBeforeForced, goldBeforeForced, combinedTaxRawAggregate,
            attributeAction: personalTaxBook ? action => /** @type {import('../../../typcheck/rechenkern-integration').AttributeSimulatorAction} */ (attributeSimulatorAction)(portfolio, action, inputs, { followup: true }) : null,
            captureTransactions: stressReplayTransactionCapture
        });
        recordPersonalSales(portfolio, investments, coverage.sources);
        forcedFunding.push(...creditPersonalSale(portfolio, investments, coverage.liquiditaetDelta, coverage.sources));
        liquiditaet = portfolio.liquiditaet;
        bondSaleAmount += coverage.bondSaleAmountDelta;
        unmetLiquidity += coverage.unmetLiquidityDelta;
        didForcedSale = didForcedSale || coverage.didForcedSale;
        forcedSaleScaleApplied = coverage.forcedSaleScaleApplied ?? forcedSaleScaleApplied;
        forcedTaxReserved += coverage.forcedTaxReservedDelta;
        return coverage;
    };
    const forcedCoverage = coverShortfall(forcedShortfall, protectsEquity);
    // Zuerst die normale Deckung einschließlich Anleihen ausschöpfen. Die
    // Ausnahme finanziert höchstens die Ausgabe, niemals den Jahrespuffer.
    const expenseEquityFunded = is3Bucket && protectsEquity && plannedExpense > 0
        ? saleQuellen.filter(source => !isBondKind(String(source.kind).toLowerCase())
            && source.category !== 'bonds' && !String(source.kind).toLowerCase().startsWith('gold'))
            .reduce((sum, source) => sum + (source.netto ?? Math.max(0, (source.brutto || 0) - (source.steuer || 0))) * regularSaleScale, 0) : 0;
    const expenseShortfall = is3Bucket && protectsEquity && plannedExpense > 0
        ? Math.min(Math.max(0, plannedExpense - expenseEquityFunded), Math.max(0, jahresEntnahmeTarget + plannedExpense - liquiditaet)) : 0;
    const expenseCoverage = expenseShortfall > 0 ? coverShortfall(expenseShortfall, false) : null;
    executedSaleSources.push(...executedSaleBreakdown(investmentsBeforeCoverage));
    snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_forced_sales', {
        forcedShortfall: euros(forcedShortfall),
        liquiditaetDelta: euros(forcedCoverage.liquiditaetDelta + (expenseCoverage?.liquiditaetDelta || 0) + personalCoverage.raised),
        ...(personalCoverage.raised > 0 ? { personalPayoutCoverage: personalCoverage.raised } : {}),
        healthBucketUsed: euros(healthBucketCoverage.used)
    });
    return { state: {
        jahresEntnahmePlan, netFloorYear, engineInput, pensionAnnual, jahresEntnahmeTarget, expenseLog,
        plannedExpense, incomeConsumed, unmarried, portfolio, inputs, pensionResult, fixedIncome, incomeLog,
        liquiditaet, ownedPlan, unmarriedShares, healthBucketCoverage, pflegeMeta, personalCoverage,
        personalTaxBook, market, is3Bucket, protectsEquity, forcedFunding, depotTranchesAktien,
        depotTranchesGold, combinedTaxRawAggregate, stressReplayTransactionCapture, bondSaleAmount,
        unmetLiquidity, didForcedSale, forcedSaleScaleApplied, forcedTaxReserved, forcedCoverage,
        regularSaleScale, expenseCoverage, executedSaleSources, balanceTrace
    } };
}
