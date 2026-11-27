// @ts-check
/** @import {YearOutcome} from '../../../typcheck/rechenkern' */
import { payResidenceTaxForYear } from '../simulator-residence-tax.js';
import { sumDepot } from '../simulator-portfolio.js';
import { moneyAssets } from '../simulator-home-sale.js';
import { withResidenceTaxPaid } from '../simulator-tax-debt.js';
import { euros } from '../simulator-engine-direct-utils.js';
import { getThreeBucketInputs } from '../../../engine/transactions/three-bucket-logic.mjs';
import { applyAnnualReturnsToPortfolio, buildCurrentYearMarketData } from '../simulator-year-portfolio.js';
import { isAccumulationYear, simulateAccumulationYear } from '../simulator-accumulation-year.js';
import { buildTaxRawAggregate } from '../simulator-tax-recompute.js';
import { beginPersonalTaxYear } from '../simulator-personal-tax.js';
import { addReserveCashInterest, applyPersonalInterest } from '../simulator-personal-accounts.js';
import { applyHealthBucketInterest } from '../simulator-health-bucket.js';
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
    // NK-2b (Gutachten NK2C Befund 1): Grundbedarf und Pflege des Jahres vor der Vorauszahlung schützen (ohne gesperrte Rücklage).
    const reserve = /** @type {any[]} */ (portfolio.healthBucketTranches || []).reduce((sum, lot) => sum + lot.marketValue, 0) + (portfolio.healthBucketCashAmount || 0);
    const residenceAdvance = hasLifeEvents ? payResidenceTaxForYear(portfolio, inputs, currentState.survivor, homeHousehold,
        Math.max(0, moneyAssets(portfolio) - reserve - (Number(effectiveBaseFloor) || 0))) : null;
    if (residenceAdvance) {
        inflowLog = { ...inflowLog, ...residenceAdvance };
        // NK-2 (FR-84 Punkt 17, Nachtrag 10): Fehlt zu Jahresbeginn Geld für die Wohnrechtsteuer, bleibt sie als Forderung der zahlenden
        // Person stehen. Die Steuerabrechnung am Jahresende zahlt sie aus dem Geld nach dem Grundbedarf; ein Rest wird Schuld.
        const shortfall = residenceAdvance.residenceTaxPayment.shortfall;
        if (shortfall > .01) {
            const accounts = /** @type {any[]} */ (portfolio.personAccounts || []);
            const payer = accounts.find(row => row.profileId === residenceAdvance.residenceTaxPayment.profileId) || accounts[0];
            if (payer) payer.residenceTaxOpen = (payer.residenceTaxOpen || 0) + shortfall;
            else return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState,
                inflowLog, portfolio, liquiditaet: portfolio.liquiditaet,
                reason: portfolio.rentBequest ? 'Steuer auf die Rente aus dem Erbe (§ 23) ungedeckt' : 'Steuer Wohnrecht (§ 23) ungedeckt',
                requiredFloorNominal: effectiveBaseFloor, coveredFloorNominal: 0, effectiveWithdrawalNominal: 0,
                depotValueNominal: sumDepot(portfolio) }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
        }
    }
    let { depotTranchesAktien, depotTranchesGold } = portfolio;
    let liquiditaet = portfolio.liquiditaet;
    let initialLiqStart = euros(residenceAdvance ? liquidityBeforeResidenceTax : liquiditaet);
    let cashZinsen = 0;
    let liqNachZins = initialLiqStart;
    // Die Steuer auf später ausgezahltes Wohnkapital steckt bereits im Nettozufluss.
    const totalTaxesThisYear = Number(inflowLog?.erbschaftsteuer) || 0;
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
        accumulated.totalTaxesThisYear += totalTaxesThisYear;
        accumulated.logData.steuern_gesamt = accumulated.totalTaxesThisYear;
        if (portfolio.healthBucketConfig?.enabled) {
            healthBucketInterest = { startAmount: accumulated.logData.health_bucket_start,
                interest: accumulated.logData.health_bucket_interest };
        }
        if (accumulated.taxReconciliation?.taxShortfall > 1e-8) {
            return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, portfolio, liquiditaet: portfolio.liquiditaet,
                marketDataCurrentYear, reason: `Steuer im Haushalt ungedeckt (${euros(accumulated.taxReconciliation.taxShortfall)} EUR)`,
                requiredFloorNominal: 0, coveredFloorNominal: 0, effectiveWithdrawalNominal: 0,
                depotValueNominal: sumDepot(portfolio), taxReconciliation: accumulated.taxReconciliation }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage,
                yearEnd: Boolean(healthBucketInterest) })) };
        }
        if (accumulated.inheritanceShortfall > .01) {
            return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog: accumulated.logData, portfolio,
                liquiditaet: portfolio.liquiditaet, marketDataCurrentYear, reason: 'Erbschaftsteuer ungedeckt',
                requiredFloorNominal: 0, coveredFloorNominal: 0, effectiveWithdrawalNominal: 0,
                depotValueNominal: sumDepot(portfolio) }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage,
                yearEnd: Boolean(healthBucketInterest) })) };
        }
        if (accumulated.housingRentPayment) {
            const paid = accumulated.housingRentPayment.paidCost;
            return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog: accumulated.logData, portfolio,
                liquiditaet: portfolio.liquiditaet, marketDataCurrentYear, reason: 'Miete nach Verkauf im Erbfall ungedeckt',
                requiredFloorNominal: paid + accumulated.housingRentPayment.shortfall, coveredFloorNominal: paid,
                effectiveWithdrawalNominal: paid, depotValueNominal: sumDepot(portfolio) },
            { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage, yearEnd: true })) };
        }
        // NK-2b (Gutachten NK2C Befund 6): Eine am Jahresende bezahlte Wohnrechtsteuer steht einmal im Protokoll und im Zahlungsnachweis.
        const taxRows = /** @type {any} */ (accumulated).taxRows;
        if (taxRows) inflowLog = withResidenceTaxPaid(inflowLog, taxRows.book, taxRows.rows);
        const outcome = /** @type {YearOutcome} */ ({ kind: SIMULATOR_YEAR_OUTCOME_KINDS.SUCCESS, isRuin: false, ...accumulated,
            ...(inflowLog ? { logData: { ...accumulated.logData, ...inflowLog } } : {}) });
        // NK-2b (Gutachten NK2C Befund 5): Bleibt eine fällige Altschuld offen, verkauft der Haushalt eine Immobilie der Schuldnerin.
        if (/** @type {any} */ (accumulated).taxRestOwners?.length) Object.defineProperty(outcome, 'saleBeforeOpenTax', { value: [.../** @type {any} */ (accumulated).taxRestOwners], enumerable: false });
        return { outcome };
    }
    // KR-1c (NG-5): Der Zins des Jahres gilt wie die Aktienrendite für den Stand vor der Entscheidung. Er wird hier auf Tagesgeld,
    // Geldmarkt und Gesundheitstopf gebucht; was Auszahlung, Verkauf, Zukauf und Auffüllen bewegen, verzinst sich erst im Folgejahr.
    // Die Steuer auf den Zins bleibt in der Steuerabrechnung am Jahresende. Ansparjahre buchen ihren Zins selbst (oben).
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
    const reserveInterest = applyHealthBucketInterest({ inputs, portfolio, rC });
    addReserveCashInterest(personalInterest, reserveInterest.cashInterestByOwner);
    return { state: {
        personalInterest, personalTaxBook, portfolio, residenceAdvance, hasLifeEvents, inputs, currentState, homeHousehold,
        inflowLog, effectiveBaseFloor, depotTranchesAktien, depotTranchesGold, liquiditaet, initialLiqStart,
        cashZinsen, liqNachZins, totalTaxesThisYear, taxStatePrev, lastState,
        combinedTaxRawAggregate: /** @type {ReturnType<typeof buildTaxRawAggregate>|null} */ (combinedTaxRawAggregate),
        didForcedSale, forcedSaleScaleApplied, regularSaleScale, forcedTaxReserved, is3Bucket,
        bondSaleAmount, bondRefillGross, bondRefillNet, bondRefillTax,
        equityPreserved, unmetLiquidity, isBadYear, rA, rG, rC, bondBucketBefore, equityBeforeReturn,
        goldBeforeReturn, equityAfterReturn, goldAfterReturn, yearData, balanceTrace, resolvedCapeRatio,
        marketDataCurrentYear, marketDataHist, yearIndex, baseFloor, baseFlex, baseMinimumFlexAnnual,
        baseFlexBudgetAnnual, baseFlexBudgetRecharge, currentAnnualPension, currentAnnualPension2,
        householdCtx, survivorYear, healthBucketInterest: reserveInterest, cumulativeInflationFactor, healthBucketCoverage
    } };
}
