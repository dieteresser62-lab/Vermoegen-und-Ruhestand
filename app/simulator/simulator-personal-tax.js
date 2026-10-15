/** Annual personal tax books. The Balance planner and settlement remain authoritative. */
import { attributeHouseholdAction } from '../profile/profilverbund-action-attribution.js';
import { settleTaxYear } from '../../engine/tax-settlement.mjs';
import { personalProfiles, personalWithdrawalPlan, debitAccount, syncPersonalLiquidity } from './simulator-personal-accounts.js';
import { attachExecutedTaxContract, buildTaxRawAggregate, addTaxRawAggregate } from './simulator-tax-recompute.js';
import { calculateSaleAndTax } from '../../engine/transactions/sale-engine.mjs';
import { applySaleToPortfolio } from './simulator-portfolio-tranches.js';

const books = new WeakMap();
const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);

export function beginPersonalTaxYear(portfolio) {
    // Older exports without individual allowances cannot prove their allocation.
    if (!portfolio.personAccounts.every(person => Number.isFinite(person.sparerPauschbetrag))) return null;
    const rows = portfolio.personAccounts.map(account => ({ profileId: account.profileId, account,
        taxStatePrev: { ...account.taxState }, sparerPauschbetrag: account.sparerPauschbetrag,
        kirchensteuerSatz: account.kirchensteuerSatz, rawAggregate: buildTaxRawAggregate(), reserved: 0 }));
    books.set(portfolio, rows);
    return rows;
}

export function recordPersonalDisposal(portfolio, lot, gross, cost) {
    const rows = books.get(portfolio);
    if (!rows || gross <= 0) return;
    const row = rows.find(row => row.profileId === (lot.sourceProfileId || portfolio.simulationSourceProfileId));
    if (!row) throw new Error('SIM_PERSONAL_TAX_OWNER_MISSING');
    const gain = gross - cost;
    addTaxRawAggregate(row.rawAggregate, { sumRealizedGainSigned: gain,
        sumTaxableAfterTqfSigned: lot.taxExempt === true ? 0 : gain * (1 - (Number(lot.tqf) || 0)) });
}

export function recordPersonalSales(portfolio, snapshot, sources = []) {
    const rows = books.get(portfolio);
    if (!rows) return;
    for (const item of snapshot) recordPersonalDisposal(portfolio, item.lot,
        Math.max(0, item.value - item.lot.marketValue), Math.max(0, item.cost - item.lot.costBasis));
    for (const source of sources) {
        const row = rows.find(row => row.profileId === source.sourceProfileId);
        if (!row && source.steuer > 0) throw new Error('SIM_PERSONAL_TAX_RESERVE_OWNER_MISSING');
        if (row) row.reserved += Number(source.steuer) || 0;
    }
}

export function attributeSimulatorAction(portfolio, action, inputs, { followup = false, onlyProfileId = null } = {}) {
    const book = books.get(portfolio);
    if (!book || book.length < 2) return action;
    const profiles = personalProfiles(portfolio, inputs);
    // Balance prefixes persisted IDs once; simulator IDs already include ownership
    // or are run-local purchase IDs. Adapt both directions without changing identity.
    const originalIds = new Map();
    const plannerIds = new Map();
    for (const profile of profiles) {
        profile.hasExplicitTrancheOverride = true;
        if (onlyProfileId && profile.profileId !== onlyProfileId) profile.tranches = [];
        profile.tranches = profile.tranches.map(lot => {
            const id = String(lot.trancheId);
            const local = id.startsWith(`${profile.profileId}:`) ? id.slice(profile.profileId.length + 1) : id;
            const key = `${profile.profileId}:${local}`;
            originalIds.set(key, lot.trancheId);
            plannerIds.set(JSON.stringify([profile.profileId, lot.trancheId]), key);
            return { ...lot, trancheId: local };
        });
    }
    if (followup) for (const profile of profiles) {
        const row = book.find(row => row.profileId === profile.profileId);
        const prior = settleTaxYear(row);
        profile.inputs.sparerPauschbetrag = Math.max(0, row.sparerPauschbetrag - prior.details.spbUsedThisYear);
        profile.balanceState.lastState.taxState = prior.taxStateNext;
    }
    const plannerAction = { ...action, quellen: (action.quellen || []).map(source => ({ ...source,
        trancheId: plannerIds.get(JSON.stringify([source.sourceProfileId, source.trancheId])) || source.trancheId })) };
    const attribution = attributeHouseholdAction({ householdAction: plannerAction, profiles,
        mode: inputs.householdWithdrawalMode || 'tax_optimized' });
    const result = attribution.finalAction;
    const restoreIds = source => ({ ...source, trancheId: originalIds.get(source.trancheId) ?? source.trancheId });
    result.quellen = result.quellen.map(restoreIds);
    for (const entry of attribution.profileActions) entry.action.quellen = entry.action.quellen.map(restoreIds);
    result.verwendungen = Object.fromEntries(Object.entries(result.verwendungen)
        .filter(([key, value]) => Object.hasOwn(action.verwendungen || {}, key) || value !== 0));
    result.personalPlannedActions = attribution.profileActions;
    return result;
}

/** Raise cash from this person's actual lots; tax is assessed in the annual book. */
function fundPersonalCash(portfolio, row, need, market = {}, bondsOnly = false, reason = 'payout') {
    const lots = [...portfolio.depotTranchesAktien, ...portfolio.depotTranchesGold]
        .filter(lot => (lot.sourceProfileId || portfolio.simulationSourceProfileId) === row.profileId
            && lot.marketValue > 1e-9 && (!bondsOnly || lot.category === 'bonds'));
    if (!lots.length) return 0;
    let sale = calculateSaleAndTax(Math.max(2, need), { detailledTranches: lots, sparerPauschbetrag: 0,
        kirchensteuerSatz: row.kirchensteuerSatz, goldAktiv: true }, { minGold: 0 }, market, true);
    if (sale.bruttoVerkaufGesamt > 0) {
        const action = attributeSimulatorAction(portfolio, { type: 'TRANSACTION', quellen: sale.breakdown,
            verwendungen: { liquiditaet: sale.achievedRefill } }, {}, { followup: true, onlyProfileId: row.profileId });
        sale = { ...sale, breakdown: action.quellen };
    }
    const snapshot = lots.map(lot => ({ lot, value: lot.marketValue, cost: lot.costBasis }));
    applySaleToPortfolio(portfolio, sale);
    let gross = 0;
    for (const item of snapshot) {
        const sold = Math.max(0, item.value - item.lot.marketValue);
        gross += sold;
        recordPersonalDisposal(portfolio, item.lot, sold, Math.max(0, item.cost - item.lot.costBasis));
    }
    row.account.tagesgeld += gross;
    if (reason === 'tax') row.taxFundingGross = (row.taxFundingGross || 0) + gross;
    syncPersonalLiquidity(portfolio);
    return gross;
}

export function coverPersonalPayout(portfolio, plan, market, bondsOnly = false) {
    const book = books.get(portfolio);
    if (!book) return 0;
    let raised = 0;
    for (const item of plan.items) {
        const row = book.find(row => row.profileId === item.profileId);
        const need = Math.max(0, item.withdrawalAmount - row.account.tagesgeld - row.account.geldmarktEtf);
        if (need > 0.01) raised += fundPersonalCash(portfolio, row, need, market, bondsOnly);
    }
    return raised;
}

export function settlePersonalTaxYear({ portfolio, book, personalInterest, actionResult,
    plannedActionFlow, regularSaleScale, forcedTaxReserved, spendingNewState, didForcedSale, inputs = {} }) {
    const booked = new Map(book.map(row => [row.profileId, 0]));
    const householdFunding = new Map(book.map(row => [row.profileId, new Map()]));
    const cashInterestFor = row => personalInterest.items.find(item => item.profileId === row.profileId)?.cashInterest || 0;
    const assess = row => settleTaxYear({ ...row, rawAggregate: { ...row.rawAggregate,
        sumTaxableAfterTqfSigned: row.rawAggregate.sumTaxableAfterTqfSigned + cashInterestFor(row) } });
    const deltaFor = row => row.reserved - assess(row).taxDue - booked.get(row.profileId);
    // A helper's MM disposal can change a previously settled person's tax. Revisit
    // all books before freezing any loss carry; allowances still apply just once.
    for (let pass = 0; pass < 40; pass++) {
        let progressed = false;
        for (const row of book) {
            for (let step = 0; step < 40; step++) {
                const delta = deltaFor(row);
                if (Math.abs(delta) <= 1e-8) break;
                if (delta > 0) {
                    row.account.tagesgeld += delta;
                    booked.set(row.profileId, booked.get(row.profileId) + delta);
                    progressed = true;
                } else {
                    let paid = debitAccount(portfolio, row.account, -delta).amount;
                    syncPersonalLiquidity(portfolio);
                    if (paid + 1e-8 < -delta) {
                        // FR-16: use household liquidity in Balance plan order before
                        // selling the taxpayer's own investments. Each account uses TG before MM.
                        const profiles = personalProfiles(portfolio, inputs).filter(profile => profile.profileId !== row.profileId);
                        // The planner quantizes to cents; query at least one cent for
                        // the order while keeping actual payments unrounded (FR-14).
                        const order = personalWithdrawalPlan(profiles, Math.max(0.01, -delta - paid), inputs.householdWithdrawalMode);
                        for (const item of order.items) {
                            const remaining = -delta - paid;
                            if (remaining <= 1e-8) break;
                            const account = portfolio.personAccounts.find(account => account.profileId === item.profileId);
                            const contribution = debitAccount(portfolio, account, remaining).amount;
                            const funding = householdFunding.get(row.profileId);
                            if (contribution > 0) funding.set(account.profileId, (funding.get(account.profileId) || 0) + contribution);
                            paid += contribution;
                        }
                    }
                    const need = -delta - paid;
                    if (need > 1e-8) {
                        fundPersonalCash(portfolio, row, need, {}, false, 'tax');
                        paid += debitAccount(portfolio, row.account, need).amount;
                    }
                    booked.set(row.profileId, booked.get(row.profileId) - paid);
                    syncPersonalLiquidity(portfolio);
                    if (paid <= 1e-8) break;
                    progressed = true;
                }
            }
        }
        if (book.every(row => Math.abs(deltaFor(row)) <= 1e-8) || !progressed) break;
        if (pass === 39) throw new Error('SIM_PERSONAL_TAX_SETTLEMENT_NOT_CONVERGED');
    }
    const results = book.map(row => {
        const settlement = assess(row);
        const shortfall = Math.max(0, settlement.taxDue + booked.get(row.profileId) - row.reserved);
        row.account.taxState = { ...settlement.taxStateNext };
        return { profileId: row.profileId, taxDue: settlement.taxDue,
            taxStateNext: settlement.taxStateNext, details: settlement.details,
            cashInterestIncomeSigned: cashInterestFor(row), saleTaxDue: settleTaxYear(row).taxDue,
            taxFundingGross: row.taxFundingGross || 0,
            taxReserved: row.reserved, taxCashAdjustment: booked.get(row.profileId),
            ...(householdFunding.get(row.profileId).size ? { householdTaxFunding: [...householdFunding.get(row.profileId)]
                .map(([profileId, amount]) => ({ profileId, amount })) } : {}),
            ...(shortfall > 1e-8 ? { taxShortfall: shortfall } : {}) };
    });
    syncPersonalLiquidity(portfolio);
    const totalTax = sum(results, 'taxDue');
    const saleTax = sum(results, 'saleTaxDue');
    const reserved = sum(book, 'reserved');
    const adjustment = sum(results, 'taxCashAdjustment');
    const details = {};
    for (const key of ['sumRealizedGainSigned', 'sumTaxableAfterTqfSigned', 'lossCarryStart', 'signedAfterCarry',
        'spbUsedThisYear', 'taxBaseBeforeCarry', 'taxBaseAfterCarry', 'taxBeforeLossCarry', 'taxAfterLossCarry', 'taxSavedByLossCarry']) {
        details[key] = results.reduce((total, row) => total + row.details[key], 0);
    }
    actionResult.steuer = totalTax;
    actionResult.taxSettlement = { ...details, profilverbund: book.length > 1, profiles: results,
        cashInterestIncomeSigned: sum(results, 'cashInterestIncomeSigned'), taxableBaseIncludesCashInterest: true,
        saleTaxDue: saleTax, cashInterestTaxDelta: totalTax - saleTax, taxCashAdjustment: adjustment };
    actionResult.taxRawAggregate = { sumRealizedGainSigned: details.sumRealizedGainSigned,
        sumTaxableAfterTqfSigned: details.sumTaxableAfterTqfSigned };
    actionResult.personalAnnualTaxes = results;
    // The household guardrail state never owns a personal loss carry.
    spendingNewState.taxState = book.length > 1 ? { lossCarry: 0 } : { ...results[0].taxStateNext };
    const taxShortfall = sum(results, 'taxShortfall');
    if (taxShortfall > 1e-8) {
        actionResult.taxSettlement.taxShortfall = taxShortfall;
        return { totalTaxesThisYear: totalTax, taxCashAdjustment: adjustment, taxShortfall };
    }
    attachExecutedTaxContract({ actionResult, plannedActionFlow, regularSaleScale,
        regularTaxReserved: (plannedActionFlow?.steuer || 0) * regularSaleScale, forcedTaxReserved,
        taxReservedTotal: reserved, saleTaxDue: saleTax, cashInterestTaxDelta: totalTax - saleTax,
        finalAnnualTax: totalTax, rawTaxCashAdjustment: reserved - totalTax, taxCashAdjustment: adjustment,
        recomputedWithForcedSales: didForcedSale, recomputedAfterActionTransform: true });
    return { totalTaxesThisYear: totalTax, taxCashAdjustment: adjustment };
}
