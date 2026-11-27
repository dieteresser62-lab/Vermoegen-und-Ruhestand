// @ts-check
/** @import {YearOutcome} from '../../../typcheck/rechenkern' */
import { unmarriedWithdrawalPlan, debitUnmarriedPlan, unmarriedPayoutPlan, capCarrierToPayable, unmarriedPayoutAccounting, unmarriedHouseholdFloor, unpayableOwnCare, heimIncomeReserve } from '../simulator-unmarried.js';
import { reconcileWithdrawalLiquidity } from '../../profile/profilverbund-balance.js';
import { personalProfiles, personalWithdrawalPlan, debitPersonalLiquidity, snapshotPersonalInvestments, creditPersonalSale, debitAccount, payableLiquidity, syncPersonalLiquidity } from '../simulator-personal-accounts.js';
import { buyGold, buyStocksNeu, executedSaleBreakdown, sumDepot } from '../simulator-portfolio.js';
import { euros } from '../simulator-engine-direct-utils.js';
import { applyPayoutFallbackSale } from '../simulator-forced-sale.js';
import { buyPlannedBonds } from '../simulator-bond-refill.js';
import { recordPersonalSales, coverPersonalPayout } from '../simulator-personal-tax.js';
import { openTaxDebt } from '../simulator-tax-debt.js';
import { onceExpenseItems, selectExpenseItems } from '../simulator-planned-expense-items.js';
import { heimExpenseRules } from '../simulator-heim-expense.js';
import { ruinOutcome, snapshotBalance } from './year-diagnostics.js';
import { formatInteger } from './outcomes.js';
import { parseWithdrawalMode, ONE_CARRIES } from '../../profile/household-withdrawal-mode.js';
import { sumBondBucketValuation } from '../../../engine/transactions/three-bucket-logic.mjs';
/** @typedef {import('./withdrawal-coverage.js').YearContext & NonNullable<ReturnType<typeof payYearWithdrawal>['state']>} YearContext */
/** FR-84 (NK-1b, Gutachten NK1C Befund 2, Fable P1-3): Höchstens dieser Rest am Grundbedarf darf in einem Erfolgsjahr offen bleiben
 * (Rundung). Darüber ist der Grundbedarf nicht bezahlt, also Mangel. */
export const FLOOR_REST_TOLERANCE = 1;
/** NK-1c: Ruin allein wegen einbehaltener Verkaufssteuer für Prüfungen markieren (seit NK-2 gibt die Freigabe sie vorher frei).
 * @param {any} outcome @param {boolean} taxGap */
const markTaxGap = (outcome, taxGap) => {
    if (taxGap) Object.defineProperty(outcome, 'taxGap', { value: true, enumerable: false });
    return outcome;
};
/** Bestand der Pflegerücklage (Tranchen und Geld). @param {any} portfolio */
const reserveValue = portfolio => (portfolio.healthBucketTranches || []).reduce((/** @type {number} */ sum, /** @type {any} */ lot) => sum + lot.marketValue, 0)
    + (portfolio.healthBucketCashAmount || 0);
/** @param {import('./withdrawal-coverage.js').YearContext} context */
export function payYearWithdrawal(context) {
    let {
        depotTranchesAktien, depotTranchesGold, portfolio, purchaseFunding, is3Bucket, actionResult,
        reinvestTotal, buyEqAmount, buyGoldAmount, buyBondAmount, bondRefillNet, bondRefillGross,
        regularSaleScale, bondRefillTax, unmarried, unmarriedShares, ownedPlan, market, personalCoverage,
        executedSaleSources, liquiditaet, netFloorYear, currentState, inflowLog, expenseLog,
        marketDataCurrentYear, depotwertGesamt, plannedExpense, incomeConsumed, jahresEntnahmeTarget, inputs,
        protectsEquity, bondSaleAmount, unmetLiquidity,
        cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage, balanceTrace, basicCoverage, pensionAnnual
    } = context;
    // FR-84 Punkt 13: Ein Jahr endet nur als Ruin, wenn das Geldvermögen des Haushalts den Grundbedarf ohne Pflege (nach Renten und
    // Einkünften, mit festen geplanten Ausgaben) nicht deckt. Sonst trägt der Staat fehlende Pflegekosten, Flex und einmalige Ausgaben
    // werden gekürzt. Steuerlücken ohne Pflegebezug bleiben wie bisher (NK-1c). NK-1b: Die Pflegerücklage zählt nur, soweit dieses Jahr sie freigibt (wie bisher nur
    // bei ausgelöster Pflege); der übrige Bestand ist gesperrt und deckt keinen Grundbedarf.
    if (basicCoverage) {
        const lockedReserve = reserveValue(portfolio);
        basicCoverage.money = Math.max(0, basicCoverage.money - lockedReserve);
        basicCoverage.lockedReserve = lockedReserve;
    }
    // NK-2b (FR-84 Punkte 18/19): Einkünfte, die die Person im Heim zuerst für ihr Heim einsetzt, decken keinen Grundbedarf zu Hause.
    const heimReserve = unmarried ? (unmarriedShares || []).reduce((/** @type {number} */ sum, /** @type {any} */ row) => sum
        + heimIncomeReserve(row, unmarriedShares, /** @type {any} */ (ownedPlan)?.credits), 0) : 0;
    if (basicCoverage && heimReserve > 0) basicCoverage.need = Math.max(0, (/** @type {any} */ (basicCoverage).rawNeed ?? basicCoverage.need) + heimReserve);
    const covers = Boolean(basicCoverage) && basicCoverage.money + 0.01 >= basicCoverage.need;
    const netBasicFloor = Math.max(0, Math.min(netFloorYear, (Number(context.engineInput?.floorBedarf) || 0) - (basicCoverage?.careNeed || 0) - (Number(pensionAnnual) || 0)));
    const floorRelief = { careAid: 0, careAidPersons: /** @type {{profileId: string, amount: number}[]} */ ([]), floorRest: 0,
        partnerFloor: /** @type {{profileId: string, fromProfileId: string, amount: number}[]} */ ([]), plannedExpenseCut: 0, taxAid: 0,
        oldTaxDue: 0, taxRestOwners: /** @type {string[]} */ ([]), droppedExpenses: /** @type {{label: string, amount: number}[]} */ ([]),
        expensePaidPersons: /** @type {{profileId: string, amount: number}[]} */ ([]) };
    // NK-3 (FR-84 Punkt 15): Der Plan je Person (`ownedPlan`) enthält die Einmalausgabe in voller Höhe. Die Auszahlung zieht immer diesen
    // Betrag ab, auch wenn ein Posten entfällt; sonst buchte sie den entfallenen Teil als Auszahlung ab (Nutzertest 16.11.2026).
    const ownedExpense = plannedExpense;
    // NK-3 (FR-84 Punkt 21): Unverheiratet mit Personen im Heim. Ihr Geld zahlt nach ihrem Heim nur ihren eigenen Anteil an Einmalausgaben.
    const heim = unmarried ? heimExpenseRules(unmarriedShares, portfolio) : null;
    const heimIds = heim?.ids || [];
    // NK-2 (FR-84 Punkte 14 bis 16, Nachtrag 5): Einmalausgaben als Posten, jeder ganz oder gar nicht, in Planreihenfolge.
    let expenseItems = context.checkedExpenses?.kept.map(({ label, amount }) => ({ label, amount }))
        ?? onceExpenseItems(inputs, /** @type {number} */ (/** @type {any} */ (context).yearIndex), cumulativeInflationFactor, plannedExpense);
    // NK-3: Das Budget kann von der Summe der bezahlten Posten abhängen (Anteil der Person im Heim); dann wird bis zur Ruhe neu gewählt.
    const dropExpenses = (/** @type {number|((total: number) => number)} */ budget) => {
        const budgetOf = typeof budget === 'number' ? () => budget : budget;
        let pick = selectExpenseItems(expenseItems, budgetOf(plannedExpense));
        for (let pass = 0; pass < expenseItems.length && pick.total + 1e-6 > budgetOf(pick.total) && pick.kept.length; pass++) {
            pick = selectExpenseItems(pick.kept, budgetOf(pick.total));
        }
        const dropped = expenseItems.filter(item => !pick.kept.includes(item));
        floorRelief.plannedExpenseCut += dropped.reduce((sum, item) => sum + item.amount, 0);
        floorRelief.droppedExpenses.push(...dropped);
        expenseItems = pick.kept;
        plannedExpense = pick.total;
        expenseLog = { ...expenseLog, geplante_ausgaben: plannedExpense };
    };
    let floorTarget = netFloorYear;

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
    let totalWealthAvailable = equityAfterBuys + goldAfterBuys + liquiditaet;
    // NK-2 (FR-84 Punkte 13 und 17): Fehlt nach der einbehaltenen Verkaufssteuer Geld für Grundbedarf und Pflege, gehen sie vor. Die
    // Steuer bleibt bei der Abrechnung offen; ihr Pflegeanteil ist Hilfe zur Pflege, der Rest Schuld. Flex und Ausgaben geben nichts frei.
    const taxBook = /** @type {any[]|null} */ (/** @type {any} */ (context).personalTaxBook);
    const withheldTax = (taxBook || []).reduce((sum, row) => sum + Math.max(0, row.reserved), 0);
    if (withheldTax > 0 && totalWealthAvailable + 1e-6 < netFloorYear) {
        let need = netFloorYear - totalWealthAvailable;
        for (const row of /** @type {any[]} */ (taxBook)) {
            const amount = Math.min(need, Math.max(0, row.reserved));
            if (!(amount > 0)) continue;
            row.reserved -= amount;
            row.releasedForFloor = (row.releasedForFloor || 0) + amount;
            row.account.tagesgeld += amount;
            need -= amount;
        }
        syncPersonalLiquidity(portfolio);
        liquiditaet = portfolio.liquiditaet;
        totalWealthAvailable = equityAfterBuys + goldAfterBuys + liquiditaet;
    }
    // NK-1b: Ein Erfolgsjahr bezahlt den Grundbedarf ohne Pflege; nur ein Rundungsrest bis FLOOR_REST_TOLERANCE bleibt offen.
    if (totalWealthAvailable + 1e-6 < netFloorYear && totalWealthAvailable + FLOOR_REST_TOLERANCE >= netBasicFloor) {
        // FR-84: Fehlende Pflegekosten trägt der Staat; bei Unverheirateten je Person nach der Auszahlung.
        floorTarget = Math.max(0, totalWealthAvailable);
        if (!unmarried) {
            floorRelief.careAid = Math.min(netFloorYear - netBasicFloor, netFloorYear - floorTarget);
            floorRelief.floorRest = Math.max(0, netFloorYear - floorRelief.careAid - floorTarget);
        }
    } else if (totalWealthAvailable + 1e-6 < netFloorYear) {
        return { outcome: /** @type {YearOutcome} */ (markTaxGap(ruinOutcome({
            currentState,
            inflowLog,
            expenseLog,
            portfolio,
            liquiditaet,
            marketDataCurrentYear,
            reason: `Gesamtvermögen (${formatInteger(totalWealthAvailable)}) < Floor (${formatInteger(netBasicFloor)})`,
            personalTaxFunding: actionResult.personalTaxFunding,
            requiredFloorNominal: netBasicFloor,
            coveredFloorNominal: totalWealthAvailable,
            // D-14 measures the amount actually paid out. This ruin branch
            // terminates before the payout step, so the realized withdrawal
            // is exactly zero even if residual wealth could cover part of the
            // floor.
            effectiveWithdrawalNominal: 0,
            depotValueNominal: depotwertGesamt
        }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage }), totalWealthAvailable + (taxBook || []).reduce((sum, row) => sum + Math.max(0, row.reserved), 0) + FLOOR_REST_TOLERANCE >= netBasicFloor)) };
    }

    // FR-84 (NK-1b, Gutachten NK1C Befund 1, Fable P1-1/P2-6): Eigene Pflege, die eine unverheiratete Person nach ihrem Anteil am
    // Grundbedarf nicht zahlen kann, trägt der Staat. Sie fällt vor der Auszahlung heraus; die Auszahlung rechnet mit dem ungekürzten
    // Bedarf ohne diesen Teil, damit eine Liquiditätslücke nicht den Grundbedarf kürzt.
    const unmarriedAmounts = { incomeConsumed, netFloorYear, floor: context.engineInput?.floorBedarf };
    const ownCare = unmarried ? unpayableOwnCare(/** @type {import('../../../typcheck/rechenkern-integration').UnmarriedWithdrawalPlan} */ (unmarriedWithdrawalPlan)(
        unmarriedShares, jahresEntnahmeTarget + incomeConsumed, portfolio, true, /** @type {any} */ (ownedPlan).credits || null).items, unmarriedAmounts, portfolio,
        unmarriedShares, /** @type {any} */ (ownedPlan).credits || null) : null;
    const careCutTotal = ownCare ? [...ownCare.cut.values()].reduce((sum, value) => sum + value, 0) : 0;
    // Fable P2-4 Punkt 4: Die Ausgabe der zahlenden Person prüft gegen den Bedarf ohne den Staatsanteil.
    const expenseFloor = Math.max(0, floorTarget - careCutTotal);
    // NK-2b (Fable P2-1): Fällige Steuerschuld geht der Einmalausgabe vor (Grundbedarf, Pflege, Schuld, Ausgabe, Flex).
    // NK-3 (FR-84 Punkt 21): Mit Personen im Heim zählen Steuer und Schuld je Person (in `heim.unavailable`), sonst wie bisher die des Haushalts.
    const debtFirst = covers && !heim?.active ? openTaxDebt(portfolio) : 0;
    // NK-3 (Gutachten Codex P1, Fable 3): Bei Unverheirateten sind die verbrauchten Einkünfte schon gutgeschrieben; sie gehen mit dem
    // Grundbedarf hinaus. Die Auswahl rechnet deshalb mit dem ganzen Bedarf, nicht nur mit dem Teil nach den Einkünften.
    const expenseBudget = (/** @type {number} */ total) => totalWealthAvailable - expenseFloor - incomeConsumed
        - (heim?.active ? heim.unavailable('wealth', total, ownCare?.cut || null) : 0);
    if (plannedExpense > 0 && covers && debtFirst > 0 && expenseBudget(plannedExpense) - debtFirst + 1e-6 < plannedExpense) {
        dropExpenses(total => expenseBudget(total) - debtFirst);
    }
    if (plannedExpense > 0 && covers && (expenseBudget(plannedExpense) + 1e-6 < plannedExpense
        || liquiditaet + 1e-6 < expenseFloor + plannedExpense)) {
        // FR-84 Punkte 13 bis 15: Ein Posten, den das Geldvermögen nach Grundbedarf und Pflege nicht mehr trägt, entfällt ganz.
        // Fehlt nur Liquidität, bleibt er; der Rückfallverkauf und die Prüfung nach der Auszahlung entscheiden.
        if (expenseBudget(plannedExpense) + 1e-6 < plannedExpense) dropExpenses(expenseBudget);
    } else if (plannedExpense > 0 && (totalWealthAvailable + 1e-6 < expenseFloor + plannedExpense
        || liquiditaet + 1e-6 < expenseFloor + plannedExpense)) {
        return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog, portfolio, liquiditaet, marketDataCurrentYear,
            reason: `Geplante Ausgaben ungedeckt (${formatInteger(plannedExpense)} EUR)`,
            requiredFloorNominal: floorTarget, coveredFloorNominal: Math.min(floorTarget, Math.max(0, liquiditaet - plannedExpense)),
            effectiveWithdrawalNominal: 0, depotValueNominal: depotwertGesamt }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
    }

    // Hinweis: Ein Liquiditäts-Engpass erzeugt keinen Ruin, solange das Gesamtvermögen den Floor deckt.
    // Payout wird unten an die Liquidität angepasst.

    // Auszahlung (begrenzt auf verfügbare Liquidität)
    // Hinweis: jahresEntnahmeTarget wurde bereits oben für forcedShortfall berechnet
    const liqBeforePayout = euros(liquiditaet);
    const portfolioTotalBeforePayout = euros(totalWealthAvailable - incomeConsumed);
    const payoutTarget = Math.max(0, jahresEntnahmeTarget - careCutTotal);
    // NK-2 (FR-84 Punkt 17): Offene Steuer wird nach Grundbedarf und Pflege, aber vor dem Flex bezahlt; die Auszahlung lässt sie liegen.
    // NK-3 (Fable A): Mit Personen im Heim zahlt ihr übriges Geld weder die Ausgabe noch den Flex des Partners; die Rangfolge Grundbedarf,
    // Pflege, Einmalausgabe, Flex gilt mit dem Geld, das der Partner auszahlen kann.
    const heimExcessBeforePayout = heim?.active && plannedExpense > 0 ? heim.heimExcess('beforePayout', plannedExpense, ownCare?.cut || null) : 0;
    const liqForPayout = Math.max(0, liquiditaet - heimExcessBeforePayout - plannedExpense - incomeConsumed), taxDebt = openTaxDebt(portfolio);
    const payout = Math.min(taxDebt > 0 ? Math.max(Math.min(liqForPayout, expenseFloor), liqForPayout - taxDebt) : liqForPayout, payoutTarget);
    const payoutPlan = unmarried ? unmarriedPayoutPlan(/** @type {any} */ (ownedPlan), unmarriedShares,
        { payout, incomeConsumed, plannedExpense: ownedExpense, target: payoutTarget, ratio: /** @type {NonNullable<typeof ownCare>} */ (ownCare).ratio }, portfolio,
        /** @type {NonNullable<typeof ownCare>} */ (ownCare).cut) : null;
    const personalPayout = unmarried
        ? debitUnmarriedPlan(portfolio, payoutPlan)
        : /** @type {import('../../../typcheck/rechenkern-integration').DebitPersonalLiquidity} */ (debitPersonalLiquidity)(portfolio, payout,
            reconcileWithdrawalLiquidity(personalWithdrawalPlan(personalProfiles(portfolio, inputs), payout, inputs.householdWithdrawalMode), portfolio.personAccounts));
    // FR-81/FR-84: Zahlt eine unverheiratete Person ihren Plan nicht ganz, gilt die Reihenfolge Grundbedarf, eigene Pflege, Flex. Eine Lücke
    // im Grundbedarf deckt der Partner, fehlende eigene Pflege trägt der Staat, der Rest kürzt den Flex-Anteil (in beiden Modi).
    const personalShortfall = unmarried && personalPayout.total + 0.01 < payout + incomeConsumed;
    const floorAmounts = { payout, incomeConsumed, netFloorYear, floor: context.engineInput?.floorBedarf };
    let flexCut = /** @type {{profileId: string, amount: number}[]|null} */ (null), partnerPaid = 0, accountedAid = 0, basicShort = 0;
    if (unmarried) {
        /** @type {Map<string, number>} */
        const aid = new Map();
        const addAid = (/** @type {string} */ id, /** @type {number} */ amount) => { if (amount > 0.005) aid.set(id, (aid.get(id) || 0) + amount); };
        for (const [id, amount] of /** @type {NonNullable<typeof ownCare>} */ (ownCare).cut) addAid(id, amount);
        const carrierCut = /** @type {any} */ (payoutPlan).careCut;
        if (carrierCut) addAid(carrierCut.profileId, carrierCut.amount);
        if (personalShortfall) {
            const rows = unmarriedPayoutAccounting(/** @type {any} */ (payoutPlan), /** @type {any} */ (personalPayout), floorAmounts, careCutTotal + (carrierCut?.amount || 0));
            for (const row of rows) {
                let gap = row.floorGap;
                for (const account of /** @type {any[]} */ (portfolio.personAccounts || []).filter(item => item.profileId !== row.profileId)) {
                    if (gap <= 0.005) break;
                    const before = snapshotPersonalInvestments(portfolio);
                    const cover = coverPersonalPayout(portfolio, { mode: 'unmarried', fixedOwnership: true, totalNeed: gap,
                        items: [{ profileId: account.profileId, withdrawalAmount: gap }] }, market);
                    personalCoverage.raised += cover.raised;
                    personalCoverage.sources.push(...cover.sources);
                    executedSaleSources.push(...executedSaleBreakdown(before));
                    const paid = debitAccount(portfolio, account, Math.min(gap, payableLiquidity(portfolio, account.profileId))).amount;
                    syncPersonalLiquidity(portfolio);
                    if (paid > 0.005) floorRelief.partnerFloor.push({ profileId: row.profileId, fromProfileId: account.profileId, amount: paid });
                    partnerPaid += paid;
                    gap -= paid;
                }
                addAid(row.profileId, row.careAid);
                accountedAid += row.careAid;
            }
            flexCut = rows.filter(row => row.flexCut > 0.005).map(row => ({ profileId: row.profileId, amount: row.flexCut }));
        }
        floorRelief.careAidPersons = [...aid].map(([profileId, amount]) => ({ profileId, amount }));
        floorRelief.careAid += floorRelief.careAidPersons.reduce((sum, row) => sum + row.amount, 0);
        // NK-1b (Gutachten NK1C Befund 1): unabhängig nachrechnen, ob der Grundbedarf ohne Pflege bezahlt ist. Gezahlt minus bezahlte
        // Pflege muss den Grundbedarf des Haushalts decken; fehlt mehr als ein Rundungsrest, verkauft der Rückfallverkauf im Haushalt.
        const careTotal = unmarriedShares.reduce((/** @type {number} */ sum, /** @type {any} */ row) => sum + Math.max(0, row.care || 0), 0);
        const basicFloor = Math.max(0, unmarriedHouseholdFloor(floorAmounts) - careTotal);
        basicShort = Math.max(0, basicFloor - (personalPayout.total + partnerPaid - Math.max(0, careTotal - floorRelief.careAid)));
    }
    if (flexCut?.length) /** @type {any} */ (personalPayout).flexCut = flexCut;
    // Ergänzung 1 FR-81 (VN-1 Punkt 15): Kürzung, obwohl die Einkünfte des Haushalts den Bedarf decken (keine Entnahme aus dem Vermögen
    // nötig). Nur Merkmal für den Hinweis im Protokoll; gerechnet wird nichts anders.
    if (flexCut?.length && jahresEntnahmeTarget < 0.5) /** @type {any} */ (personalPayout).flexCutIncomeCovers = true;
    liquiditaet = portfolio.liquiditaet;
    const liqAfterPayout = euros(liquiditaet);
    // FR-81 (Nachtrag 1): Die Entnahme sinkt auf den tatsächlich gezahlten Betrag; der Engine-Anker rechnet mit der geplanten Auszahlung.
    let jahresEntnahmeEffektiv = personalShortfall ? Math.max(0, personalPayout.total + partnerPaid - incomeConsumed) : payout;
    const personalFlexCutNominal = Math.max(0, payout - jahresEntnahmeEffektiv - (personalShortfall ? accountedAid + basicShort : 0));
    // RK-3 Punkt 1 (FR-81 Punkt 3): ganze Kürzung im Haushalt, auch der Teil aus verbrauchten Einkünften (Kennzahlen, Ausgaben, Rohdaten).
    const personalFlexCutTotal = flexCut?.length ? flexCut.reduce((sum, row) => sum + row.amount, 0) : 0;
    snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_payout', {
        payout: euros(jahresEntnahmeEffektiv),
        jahresEntnahmeTarget: euros(jahresEntnahmeTarget),
        portfolioTotalBeforePayout
    });

    // Rückfallverkauf: Verheiratete und Alleinstehende bis zum Floor (bei Hilfe zur Pflege bis zum verbleibenden Geld). Unverheiratete nur
    // für den nachgerechneten fehlenden Grundbedarf; ihre Pflege und ihr Flex verkaufen nie beim Haushalt (FR-84, Fable P3-11).
    let fallbackFloor = unmarried ? jahresEntnahmeEffektiv + basicShort : floorTarget;
    if (jahresEntnahmeEffektiv + 1e-6 < fallbackFloor) {
        // FR-84 Punkt 13: Fehlt nach allen Verkäufen Geld (etwa weil Steuer aus den Verkäufen schon abging), trägt bei Verheirateten und
        // Alleinstehenden der Staat zuerst den Pflegeanteil; ein Rundungsrest bleibt offen; fehlt mehr, entscheidet der Rückfallverkauf.
        const available = jahresEntnahmeEffektiv + sumDepot({ depotTranchesAktien }) + sumDepot({ depotTranchesGold });
        if (available < fallbackFloor + 1e-6) {
            const missing = Math.max(0, fallbackFloor - available);
            const careShare = unmarried ? 0 : Math.min(missing, Math.max(0, netFloorYear - netBasicFloor - floorRelief.careAid));
            floorRelief.careAid += careShare;
            if (missing - careShare <= FLOOR_REST_TOLERANCE) {
                floorRelief.floorRest += missing - careShare;
                fallbackFloor = Math.max(jahresEntnahmeEffektiv, available - 1e-9);
            }
        }
    }
    if (floorRelief.floorRest > FLOOR_REST_TOLERANCE) {
        return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog, portfolio, liquiditaet: portfolio.liquiditaet, marketDataCurrentYear,
            reason: `Gesamtvermögen (${formatInteger(totalWealthAvailable)}) < Floor (${formatInteger(netBasicFloor)})`,
            requiredFloorNominal: netBasicFloor, coveredFloorNominal: Math.max(0, netBasicFloor - floorRelief.floorRest),
            effectiveWithdrawalNominal: jahresEntnahmeEffektiv, depotValueNominal: depotwertGesamt }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
    }
    const investmentsBeforeFallback = jahresEntnahmeEffektiv + 1e-6 < fallbackFloor ? snapshotPersonalInvestments(portfolio) : [];
    const payoutFallback = /** @type {ReturnType<typeof applyPayoutFallbackSale> & {reason?:string}} */ (applyPayoutFallbackSale({
        jahresEntnahmeEffektiv,
        netFloorYear: fallbackFloor,
        liquiditaet,
        // Unverheiratete: Der Rückfall ergänzt die tatsächlich gezahlte Entnahme um den fehlenden Grundbedarf.
        payout: unmarried ? jahresEntnahmeEffektiv : payout,
        is3Bucket,
        // NK-1b: Wie bei der Deckung darf der Anleihenschutz im Bär den Grundbedarf nicht verhindern. Reichen die Anleihen nicht, verkauft
        // der Rückfall auch Aktien und Gold.
        isBadYear: protectsEquity && sumBondBucketValuation(depotTranchesAktien) + 1e-6 >= fallbackFloor - jahresEntnahmeEffektiv,
        depotTranchesAktien,
        depotTranchesGold,
        formatRuinNumber: formatInteger
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
        // NK-1b: Der Rückfallverkauf zahlt Grundbedarf aus; er gehört zur Entnahme des Jahres (Protokoll und unabhängige Prüfung).
        jahresEntnahmeEffektiv += fallbackDebit.total;
        if (fallbackDebit.total > 0) /** @type {any} */ (personalPayout).fallback = fallbackDebit.total;
        if (fallbackDebit.attacked?.length) /** @type {any} */ (actionResult).carrierAttacked = [...(/** @type {any} */ (actionResult).carrierAttacked || []), ...fallbackDebit.attacked];
    }
    liquiditaet = portfolio.liquiditaet;
    bondSaleAmount += payoutFallback.bondSaleAmountDelta;
    unmetLiquidity += payoutFallback.unmetLiquidityDelta;

    // FR-84 Punkte 13 bis 15: Fehlt nach der Auszahlung Liquidität, entfällt jeder Posten ganz, der nicht mehr bezahlbar ist. Bei
    // Unverheirateten zählt, was die Personen auszahlen können (eigener Anteil, Rest vom Partner), nie das Geld der Person im Heim (NK-3).
    const expenseLiquidity = unmarried ? Math.min(liquiditaet, /** @type {any[]} */ (portfolio.personAccounts || [])
        .reduce((sum, account) => sum + payableLiquidity(portfolio, account.profileId), 0)) : liquiditaet;
    const debtNow = covers && !heim?.active ? openTaxDebt(portfolio) : 0;
    const liquidityBudget = (/** @type {number} */ total) => expenseLiquidity - debtNow - (heim?.active ? heim.unavailable('liquidity', total) : 0);
    if (plannedExpense > 0 && covers && liquidityBudget(plannedExpense) + 1e-6 < plannedExpense) dropExpenses(liquidityBudget);
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
            // NK-3 (FR-84 Punkt 21): Ist die andere Person im Heim, verschiebt sich nichts zu ihr.
            const carrierHelper = unmarriedShares.find((/** @type {any} */ row) => row.carries === false);
            const paid = debitUnmarriedPlan(portfolio, unmarriedShares.some((/** @type {any} */ row) => row.carries) && !heimIds.includes(carrierHelper?.profileId)
                ? capCarrierToPayable(expensePlan, unmarriedShares, portfolio) : expensePlan);
            const byPerson = new Map(paid.items.map((/** @type {any} */ row) => [row.profileId, row.amount]));
            if (covers && paid.total + .01 < plannedExpense) {
                // FR-84 Punkt 13: Den fehlenden Anteil an der geplanten Ausgabe zahlt die andere Person aus ihrer Liquidität. Die Auswahl oben
                // hält jeden Posten bezahlbar; ein Rest wäre nur Rundung.
                let gap = plannedExpense - paid.total;
                for (const account of /** @type {any[]} */ (portfolio.personAccounts || []).filter(item => !heimIds.includes(item.profileId))) {
                    if (gap <= 0.005) break;
                    const extra = debitAccount(portfolio, account, Math.min(gap, payableLiquidity(portfolio, account.profileId))).amount;
                    paid.total += extra; gap -= extra;
                    byPerson.set(account.profileId, (byPerson.get(account.profileId) || 0) + extra);
                }
                syncPersonalLiquidity(portfolio);
                // FR-84 Punkt 15 (NK-3, Codex Befund 5): Die Auswahl hält jeden Posten ganz bezahlbar. Ein Rest über einem Rundungsbetrag wäre eine
                // Teilzahlung; das ist ein Rechenfehler, kein Wegfall.
                if (gap > FLOOR_REST_TOLERANCE) throw new Error('SIM_PLANNED_EXPENSE_PARTIALLY_PAID');
                if (gap > 0.005) {
                    floorRelief.plannedExpenseCut += gap;
                    plannedExpense -= gap;
                    expenseLog = { ...expenseLog, geplante_ausgaben: plannedExpense };
                }
            }
            if (paid.total + .01 < plannedExpense) return { outcome: /** @type {YearOutcome} */ (ruinOutcome({ currentState, inflowLog, expenseLog, portfolio,
                liquiditaet: portfolio.liquiditaet, marketDataCurrentYear, reason: 'Persönlicher Anteil der geplanten Ausgabe ungedeckt',
                requiredFloorNominal: netFloorYear, coveredFloorNominal: jahresEntnahmeEffektiv,
                effectiveWithdrawalNominal: jahresEntnahmeEffektiv, depotValueNominal: depotwertGesamt }, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage })) };
            expensePaid = paid;
            // Gutachten NK1C3 Befund 1: Die bezahlte Ausgabe je Person gehört in die Zahlungsbasis der Pflegequote.
            floorRelief.expensePaidPersons = [...byPerson].filter(([, amount]) => amount > 0.005).map(([profileId, amount]) => ({ profileId, amount }));
        }
        else {
            const paid = /** @type {import('../../../typcheck/rechenkern-integration').DebitPersonalLiquidity} */ (debitPersonalLiquidity)(portfolio, plannedExpense,
                reconcileWithdrawalLiquidity(personalWithdrawalPlan(personalProfiles(portfolio, inputs), plannedExpense, inputs.householdWithdrawalMode), portfolio.personAccounts));
            // NK-3 (Gutachten Codex P3): Auch die gemeinsame Kasse vermerkt, wer die Ausgabe bezahlt hat (nur Prüfung, nicht im Protokoll).
            floorRelief.expensePaidPersons = (/** @type {any} */ (paid).items || []).filter((/** @type {any} */ row) => row.amount > 0.005)
                .map((/** @type {any} */ row) => ({ profileId: row.profileId, amount: row.amount }));
            expensePaid = paid;
        }
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
        inputs, liqAfterPayout, jahresEntnahmeEffektiv, personalFlexCutNominal, personalFlexCutTotal, payoutFallback,
        bondSaleAmount, unmetLiquidity, cumulativeInflationFactor, healthBucketInterest, yearData,
        healthBucketCoverage, balanceTrace, floorRelief, covers, netBasicFloor, plannedExpense
    } };
}
