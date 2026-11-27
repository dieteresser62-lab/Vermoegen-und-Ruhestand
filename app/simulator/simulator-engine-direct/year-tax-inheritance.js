// @ts-check
/** @import {YearOutcome} from '../../../typcheck/rechenkern' */
import { applyUnmarriedInheritance } from '../simulator-inheritance.js';
import { nextFixedIncomeWageFactor } from '../simulator-fixed-income.js';
import { snapshotPersonalInvestments, applyPersonalTaxAdjustment } from '../simulator-personal-accounts.js';
import { executedSaleBreakdown, sumDepot } from '../simulator-portfolio.js';
import { euros, signedEuros } from '../simulator-engine-direct-utils.js';
import { survivorLiquidityTarget } from '../simulator-survivor.js';
import { applySimulatorTaxRecompute } from '../simulator-tax-recompute.js';
import { buildHealthBucketDiagnostics } from '../simulator-health-bucket.js';
import { settlePersonalTaxYear, careSaleTaxAid } from '../simulator-personal-tax.js';
import { loadTaxClaims, withResidenceTaxPaid } from '../simulator-tax-debt.js';
import { ruinOutcome, snapshotBalance } from './year-diagnostics.js';
/** @typedef {import('./year-payout.js').YearContext & NonNullable<ReturnType<typeof settleYear>['state']>} YearContext */
/** @param {import('./year-payout.js').YearContext} context */
export function settleYear(context) {
    let {
        liquiditaet, portfolio, cashZinsen, liqNachZins, personalInterest, healthBucketInterest, inputs, spendingNewState,
        inflatedFloor, marketDataHist, rA, resolvedCapeRatio, yearData, personalTaxBook, actionResult,
        plannedActionFlow, regularSaleScale, forcedTaxReserved, didForcedSale, threeBucketState, fullResult,
        taxStatePrev, combinedTaxRawAggregate, engineInput, forcedSaleScaleApplied, totalTaxesThisYear,
        saleFunding, forcedFunding, currentState, inflowLog, expenseLog, marketDataCurrentYear, netFloorYear,
        jahresEntnahmeEffektiv, depotwertGesamt, hasLifeEvents, survivorYear, executedSaleSources,
        cumulativeInflationFactor, pensionResult, homeHousehold, yearIndex, depotTranchesAktien,
        depotTranchesGold, healthBucketCoverage, balanceTrace, floorRelief, netBasicFloor, unmarried, unmarriedShares, personalPayout
    } = context;
    // FR-84 (NK-1b/NK-1c, Gutachten NK1C Befund 5, NK1C2 Befund 4): Pflegequote der Zahlung. Unverheiratete je eigener Kasse (selbst
    // bezahlte Pflege durch eigene Auszahlung; Einkünfte des Partners ändern daran nichts), sonst für den Haushalt (Pflege aus dem
    // Geldvermögen durch Entnahme samt geplanter Ausgabe).
    /** @type {Record<string, number>} */
    const ownTaxShare = {};
    if (unmarried) for (const row of /** @type {any[]} */ (unmarriedShares || [])) {
        const aid = floorRelief.careAidPersons.filter(item => item.profileId === row.profileId).reduce((sum, item) => sum + item.amount, 0);
        const carePaid = Math.max(0, (row.care || 0) - aid);
        // NK-2 (Gutachten NK1C3 Befund 1): Zahlungsbasis samt der selbst bezahlten Einmalausgabe.
        const paid = (/** @type {any} */ (personalPayout)?.items || []).filter((/** @type {any} */ item) => item.profileId === row.profileId)
            .reduce((/** @type {number} */ sum, /** @type {any} */ item) => sum + (item.amount || 0), 0)
            + (floorRelief.expensePaidPersons || []).filter((/** @type {any} */ item) => item.profileId === row.profileId).reduce((/** @type {number} */ sum, /** @type {any} */ item) => sum + item.amount, 0);
        if (carePaid > 0.005 && paid > 0.005) ownTaxShare[row.profileId] = Math.min(1, carePaid / paid);
    }
    const householdCarePaid = Math.max(0, netFloorYear - netBasicFloor - floorRelief.careAid);
    const householdPaid = jahresEntnahmeEffektiv + (expenseLog?.geplante_ausgaben || 0);
    const careShare = unmarried ? ownTaxShare : Object.fromEntries((portfolio.personAccounts || []).map(account => [account.profileId,
        householdPaid > 0.005 ? Math.min(1, householdCarePaid / householdPaid) : 0]));

    // Rebalancing bei Überschuss
    // HINWEIS: Die Logik wurde in die TransactionEngine (determineAction) verschoben,
    // um Simulator und Balance App zu harmonisieren (FR-57: Ansparjahre auch im Bärenmarkt).
    // simulator-engine-direct.js verlässt sich nun rein auf die Engine-Ergebnisse.
    let kaufAkt = 0, kaufGld = 0;
    // (Legacy Block entfernt)

    // KR-1c (NG-5): Der Zins des Jahres ist schon vor der Entscheidung gebucht (year-market.js). Hier steht die Liquidität am
    // Jahresende nach allen Bewegungen, vor der Steuerabrechnung (Protokollfeld liqEnd).
    liquiditaet = portfolio.liquiditaet;
    const liqJahresende = euros(liquiditaet);
    if (!isFinite(liquiditaet)) liquiditaet = 0;
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
    const heimPartners = unmarried && (unmarriedShares || []).some((/** @type {any} */ row) => row.residential)
        ? (unmarriedShares || []).filter((/** @type {any} */ row) => !row.residential).map((/** @type {any} */ row) => /** @type {string} */ (row.profileId)) : [];
    // NK-2 (FR-84 Punkt 17): Altschuld aus dem Vorjahr und offene Wohnrechtsteuer dieses Jahres zahlt die Abrechnung wie Steuer.
    if (personalTaxBook) floorRelief.oldTaxDue = loadTaxClaims(/** @type {any[]} */ (personalTaxBook)).old;
    const taxReconciliation = personalTaxBook ? /** @type {import('../../../typcheck/rechenkern-integration').SettlePersonalTaxYear} */ (settlePersonalTaxYear)({
        portfolio, book: personalTaxBook, personalInterest, actionResult, plannedActionFlow,
        regularSaleScale, forcedTaxReserved, spendingNewState, didForcedSale, inputs,
        // FR-84: Den Steueranteil aus eigenen Pflegezahlungen zahlen Unverheiratete ohne Zugriff auf den Partner.
        ...(Object.keys(ownTaxShare).length ? { ownTaxShare } : {}),
        // NK-3 (FR-84 Punkt 21, Fable B): Neben einer Person im Heim zahlt der Partner seine Steuer erst aus eigenem Geld und Depot.
        ...(heimPartners.length ? { ownFirstIds: heimPartners } : {})
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
        cashInterestIncomeSigned: cashZinsen + healthBucketInterest.cashInterest,
        forcedSaleScaleApplied,
        regularSaleScale,
        forcedTaxReserved
    });
    totalTaxesThisYear += taxReconciliation.totalTaxesThisYear;
    // The personal path books its own cash adjustment, including realized MM gains.
    // Legacy inputs retain the pooled interest-tax adjustment.
    if (!personalTaxBook) applyPersonalTaxAdjustment(portfolio, taxReconciliation.taxCashAdjustment, personalInterest, [...saleFunding, ...forcedFunding]);
    liquiditaet = portfolio.liquiditaet;
    // Fehlender Shortfall bedeutet hier bewusst keine Unterdeckung.
    const taxShortfall = Number(/** @type {{taxShortfall?: number}} */ (taxReconciliation).taxShortfall) || 0;
    // NK-2 (Gutachten NK1C2 Befund 3): Die am Jahresende bezahlte Wohnrechtsteuer steht einmal im Protokoll, mit der Zahlung zu Beginn.
    inflowLog = withResidenceTaxPaid(inflowLog, /** @type {any[]|null} */ (personalTaxBook), /** @type {any[]} */ (actionResult.personalAnnualTaxes || []));
    // FR-84 (NK-1c): Offene neue Steuer aus Pflegeverkäufen trägt der Staat (Hilfe zur Pflege), anteilig nach der Pflegequote der Zahlung.
    // NK-2 (Punkt 17): Jede andere offene Steuer bleibt als Schuld bei der Person und wird im Folgejahr bezahlt; im Entstehungsjahr kein
    // Notverkauf. Bleibt eine fällige Altschuld offen, verkauft der Haushalt danach eine Immobilie dieser Person (Nachtrag 4).
    if (taxShortfall > 1e-8) {
        const rows = /** @type {any[]} */ (actionResult.personalAnnualTaxes || []);
        const careTax = careSaleTaxAid(rows, careShare);
        for (const row of careTax.persons) {
            const hit = floorRelief.careAidPersons.find(item => item.profileId === row.profileId);
            if (unmarried) { if (hit) hit.amount += row.amount; else floorRelief.careAidPersons.push({ ...row }); }
        }
        floorRelief.careAid += careTax.total;
        floorRelief.taxAid = careTax.total;
        for (const row of rows) {
            const rest = (Number(row.taxShortfall) || 0) - (careTax.persons.find(item => item.profileId === row.profileId)?.amount || 0);
            const account = /** @type {any[]} */ (portfolio.personAccounts || []).find(item => item.profileId === row.profileId);
            if (account && rest > 1e-8) account.openTax = (account.openTax || 0) + rest;
            if ((row.oldDebtRest || 0) > 0.005) floorRelief.taxRestOwners.push(row.profileId);
        }
    }
    const hasInheritance = hasLifeEvents && inputs.partner?.aktiv
        && (inputs.partnership || inputs.simulationPeople?.length === 2);
    if (hasInheritance && survivorYear?.deathThisYear) executedSaleSources.push(...executedSaleBreakdown(investmentsBeforeTax));
    const inheritanceLog = hasInheritance ? /** @type {import('../../../typcheck/rechenkern-integration').ApplyUnmarriedInheritance} */ (applyUnmarriedInheritance)({ portfolio, transition: survivorYear,
        inputs, historicalYear: yearData.temporal ? yearData.jahr : undefined,
        inflationFactor: cumulativeInflationFactor * (1 + yearData.inflation / 100), pension: pensionResult,
        personalInterest, actionResult, household: homeHousehold,
        reserveTarget: () => survivorLiquidityTarget({ state: currentState, portfolio, transition: survivorYear, inputs,
            household: homeHousehold, yearIndex, inflationFactor: cumulativeInflationFactor * (1 + yearData.inflation / 100),
            marketData: marketDataCurrentYear, pension: pensionResult,
            fixedIncomeWageFactor: inputs.fixedIncome?.length ? nextFixedIncomeWageFactor(inputs, currentState, yearData)
                : currentState.fixedIncomeWageFactor }) }) : null;
    if (inheritanceLog) {
        // NK-2 (FR-84 Punkt 17): Ungedeckte Erbschaftsteuer bleibt als Schuld bei der erbenden Person; im Folgejahr fällig.
        const inheritanceShortfall = inheritanceLog.inheritancePayment.shortfall;
        const heir = /** @type {any[]} */ (portfolio.personAccounts || []).find(item => item.profileId === survivorYear?.survivor?.survivorProfileId)
            || portfolio.personAccounts?.[0];
        if (inheritanceShortfall > 0.01 && heir) heir.openTax = (heir.openTax || 0) + inheritanceShortfall;
        else if (inheritanceShortfall > 0.01) {
            return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog: { ...expenseLog,
                abgang_erben: inheritanceLog.abgang_erben, erbschaftsteuer: inheritanceLog.erbschaftsteuer,
                inheritance: inheritanceLog.inheritance, SurvivorDeathYear: true }, portfolio,
                liquiditaet: portfolio.liquiditaet, marketDataCurrentYear, reason: 'Erbschaftsteuer ungedeckt',
                requiredFloorNominal: netFloorYear, coveredFloorNominal: jahresEntnahmeEffektiv,
                effectiveWithdrawalNominal: jahresEntnahmeEffektiv, depotValueNominal: sumDepot(portfolio) }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage, yearEnd: true })) };
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
        kaufAkt, kaufGld, liquiditaet, portfolio, cashZinsen, liqNachZins, liqJahresende, healthBucketInterest, inputs,
        healthBucketDiagnostics, spendingNewState, inflatedFloor, guardReason, newMarketDataHist, rA, yearData,
        investmentsBeforeTax, actionResult, fullResult, totalTaxesThisYear, currentState, inflowLog,
        expenseLog, jahresEntnahmeEffektiv, depotwertGesamt, survivorYear, executedSaleSources, inheritanceLog,
        pensionResult, depotTranchesAktien, depotTranchesGold, healthBucketCoverage, balanceTrace,
        cumulativeInflationFactor, floorRelief
    } };
}
