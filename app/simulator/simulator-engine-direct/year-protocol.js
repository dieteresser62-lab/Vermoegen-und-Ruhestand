// @ts-check
/** @import {YearSuccess,ActionSource} from '../../../typcheck/rechenkern' */
import { threeBucketActionTrades } from '../../../engine/transactions/net-action.mjs';
import { nextFixedIncomeWageFactor } from '../simulator-fixed-income.js';
import { summarizeSalesByAsset, executedSaleBreakdown } from '../simulator-portfolio.js';
import { finishSurvivorYear } from '../simulator-survivor.js';
import { buildSimulatorYearResult } from '../simulator-year-result.js';
import { SIMULATOR_YEAR_OUTCOME_KINDS } from './outcomes.js';
import { careSaleEligible, homeWasSold } from '../simulator-home-sale.js';
import { residentialSpending } from '../../shared/care-needs.js';
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
        goldAfterSales, goldAfterBuys, cashZinsen, liqNachZins, liqJahresende, zielLiquiditaet, bondBucketBefore,
        bondRefillGross, bondRefillNet, bondRefillTax, bondSaleAmount, is3Bucket, effectiveBaseFloor,
        pensionAnnual, rente1, rente2, renteSum, inflatedFloor, inflatedFlex, pflegeMeta, householdCtx, careP1,
        careP2, survivorYear, temporaryFlexFactor, inputs, widowBenefits, widowPensionP1, widowPensionP2,
        p1Alive, p2Alive, guardReason, isBadYear, equityPreserved, unmetLiquidity, healthBucketCoverage,
        healthBucketInterest, healthBucketDiagnostics,
        balanceTrace, fixedIncome, executedPurchases, yearNeed, personalFlexCutNominal, personalFlexCutTotal,
        floorRelief
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
        // FR-80 Punkt 3 (TRG-1b, P3-4): Verkauf bei der anderen Person steht im Protokoll-Hinweis wie ein Rückgriff in der Auszahlung.
        // TRG-1c Punkt 1: ebenso, wenn die andere Person einen Teil der Steuer der tragenden Person zahlt.
        personalPayout: withReserveShort(withCarrierAttacked(personalPayout, [...(/** @type {any} */ (actionResult).carrierAttacked || []), ...(/** @type {any} */ (actionResult).carrierTaxAttacked || [])]),
            /** @type {any} */ (actionResult).carrierReserveShort),
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
        // FR-81 (Nachtrag 1): Der Engine-Anker bleibt bei einer persönlichen Flex-Kürzung unverändert. RK-3 Punkt 4: festes Feld
        // statt Spread, sonst läuft das ganze Objekt im langsamen generischen Pfad (PE-1/MP-1).
        personalFlexCutNominal: Math.max(0, personalFlexCutNominal || 0),
        personalFlexCutTotal: Math.max(0, personalFlexCutTotal || 0),
        // Steuer aus Pflegeverkäufen (taxAid) zahlt keine Auszahlung; nur die Hilfe aus der Auszahlung zählt hier.
        careAidNominal: Math.max(0, (floorRelief?.careAid || 0) - (floorRelief?.taxAid || 0)),
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
        liqJahresende,
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
        balanceTrace
    });
    const yearResult = /** @type {YearSuccess} */ ({ kind: SIMULATOR_YEAR_OUTCOME_KINDS.SUCCESS });
    for (const key of Object.keys(builtYearResult)) yearResult[key] = builtYearResult[key];
    if (floorRelief) addFloorReliefLog(/** @type {Record<string, unknown>} */ (yearResult.logData), floorRelief);
    // NK-2 (FR-84 Punkt 17, Gutachten NK1C2 Befunde 3 und 5): Steuerschuld nach dem endgültigen Steuerabschluss. Das Jahresendvermögen ist
    // netto (abzüglich Schuld, höchstens bis null); das Bruttovermögen steht daneben. Ohne Schuld bleiben die Felder unverändert.
    const debtEnd = /** @type {any[]} */ (portfolio.personAccounts || []).reduce((sum, row) => sum + (row.openTax > 0 ? row.openTax : 0), 0);
    if (debtEnd > 0.005) {
        const log = /** @type {any} */ (yearResult.logData);
        log.steuer_offen = debtEnd;
        log.portfolio_total_brutto = log.portfolio_total_end;
        log.portfolio_total_end = Math.max(0, log.portfolio_total_end - debtEnd);
    }
    // Nachtrag 4: Bleibt eine fällige Altschuld nach dem Abschluss offen, verkauft der Haushalt eine Immobilie der Schuldnerin oder des
    // Schuldners (Wiederholung des Jahres). Das Merkmal ist nicht aufzählbar und ändert kein Ergebnis.
    if (floorRelief?.taxRestOwners?.length) Object.defineProperty(yearResult, 'saleBeforeOpenTax', { value: [...floorRelief.taxRestOwners], enumerable: false });
    // NK-2 (FR-84 Punkt 20): Hilfe zur Pflege erst, wenn die pflegebedürftige Person ihre verwertbare Immobilie eingesetzt hat. Hat sie noch
    // eine, wiederholt der Jahreskoordinator das Jahr mit dem Verkauf. Das Merkmal ist nicht aufzählbar und ändert kein Ergebnis.
    const careSaleOwners = floorRelief?.careAid > 0.005 && inputs.home?.length ? careSaleCandidates({ floorRelief, unmarried, inputs, portfolio,
        household: { ...householdCtx, care: { p1: careP1, p2: careP2 } }, survivor: currentState.survivor }) : [];
    if (careSaleOwners.length) Object.defineProperty(yearResult, 'saleBeforeCareAid', { value: careSaleOwners, enumerable: false });
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

/** Hinweise „Vermögen von … wird angegriffen“ aus Aktion und Steuer zur Auszahlung hinzufügen (je Person einmal).
 * @param {any} personalPayout @param {{profileId: string, amount: number}[]} rows */
function withCarrierAttacked(personalPayout, rows) {
    const extra = rows.filter((row, index) => rows.findIndex(item => item.profileId === row.profileId) === index
        && !personalPayout?.attacked?.some((/** @type {{profileId: string}} */ item) => item.profileId === row.profileId));
    return extra.length ? { ...personalPayout, attacked: [...(personalPayout?.attacked || []), ...extra] } : personalPayout;
}

/** VN-3: Hinweis „Reserve von … unter Ziel“ zur Auszahlung hinzufügen. @param {any} personalPayout @param {any} short */
function withReserveShort(personalPayout, short) {
    return short ? { ...personalPayout, carrierReserveShort: short } : personalPayout;
}

/** FR-84: Hilfe zur Pflege, Grundbedarf vom Partner und offene Reste im Jahresprotokoll. Felder nur, wenn ein Betrag anfällt,
 * damit Jahre ohne diese Fälle unverändert bleiben (nominal).
 * @param {Record<string, unknown>} logData @param {any} relief */
function addFloorReliefLog(logData, relief) {
    if (relief.careAid > 0.005) logData.hilfe_zur_pflege = relief.careAid;
    if (relief.careAidPersons?.length) logData.hilfe_zur_pflege_personen = relief.careAidPersons;
    // NK-1b: Davon Steuer aus Pflegeverkäufen, die keine Auszahlung des Jahres ist (für Prüfungen und das Protokoll).
    if (relief.taxAid > 0.005) logData.hilfe_zur_pflege_steuer = relief.taxAid;
    if (relief.partnerFloor?.length) logData.partner_grundbedarf = relief.partnerFloor;
    if (relief.floorRest > 0.005) logData.grundbedarf_rest = relief.floorRest;
    if (relief.plannedExpenseCut > 0.005) logData.geplante_ausgaben_gekuerzt = relief.plannedExpenseCut;
    // NK-2 (FR-84 Punkt 16): entfallene Posten mit Bezeichnung für den Hinweis im Jahresprotokoll.
    if (relief.droppedExpenses?.some((/** @type {any} */ item) => item.label)) logData.geplante_ausgaben_entfallen = relief.droppedExpenses.map((/** @type {any} */ item) => ({ ...item }));
    // NK-2: Steuerschuld aus dem Vorjahr, die dieses Jahr fällig war (was offen bleibt, steht danach unter „steuer_offen“).
    if (relief.oldTaxDue > 0.005) logData.steuer_schuld_vorjahr = relief.oldTaxDue;
}

/** NK-2 (FR-84 Punkt 20): Personen mit Hilfe zur Pflege, die noch eine verwertbare Immobilie haben (vermietet, oder selbst genutzt und
 * niemand wohnt mehr darin). Unverheiratete je Person mit Hilfe, sonst jede Person mit Pflege in diesem Jahr. Geerbte Immobilien gehören
 * der lebenden Person. @param {any} options @returns {string[]} */
function careSaleCandidates({ floorRelief, unmarried, inputs, portfolio, household, survivor }) {
    const people = inputs.simulationPeople || [];
    // NK-2b (Fable P3-6): Reihenfolge nach Hilfe (Unverheiratete) bzw. Pflegekosten (gemeinsame Kasse), die höheren zuerst.
    const ids = unmarried ? [...floorRelief.careAidPersons].filter((/** @type {any} */ row) => row.amount > 0.005)
        .sort((/** @type {any} */ a, /** @type {any} */ b) => b.amount - a.amount).map((/** @type {any} */ row) => row.profileId)
        : [household.care?.p1, household.care?.p2].flatMap((care, index) => care?.active && household[`p${index + 1}Alive`] !== false && people[index]
            ? [{ id: people[index].profileId, cost: Math.max(0, care.zusatzFloorZiel || 0) + residentialSpending(care) }] : [])
            .sort((a, b) => b.cost - a.cost).map(row => row.id);
    const ownerOf = (/** @type {any} */ home) => survivor?.deceasedProfileId != null && survivor.deceasedProfileId === home.profileId ? survivor.survivorProfileId : home.profileId;
    return ids.filter((/** @type {string} */ id) => inputs.home.some((/** @type {any} */ home, /** @type {number} */ index) => ownerOf(home) === id
        && !homeWasSold(portfolio, home, index) && careSaleEligible(home, inputs, household)));
}
