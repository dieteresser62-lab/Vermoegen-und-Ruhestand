/** Person-owned liquidity and the Balance withdrawal order. */
import { calculateWithdrawalDistribution } from '../profile/profilverbund-balance.js';
import { recordPersonalDisposal } from './simulator-personal-tax.js';

const amount = value => Math.max(0, Number(value) || 0);
const investmentLots = portfolio => [...(portfolio.depotTranchesAktien || []), ...(portfolio.depotTranchesGold || [])];
const owner = (portfolio, lot) => lot.sourceProfileId || portfolio.simulationSourceProfileId || 'simulation';

export function syncPersonalLiquidity(portfolio) {
    if (!Array.isArray(portfolio.personAccounts)) return;
    for (const account of portfolio.personAccounts) account.geldmarktEtf = 0;
    for (const lot of portfolio.depotTranchesGeldmarkt || []) {
        const account = portfolio.personAccounts.find(entry => entry.profileId === owner(portfolio, lot));
        if (!account) throw new Error('SIM_PERSONAL_MONEY_MARKET_OWNER_MISSING');
        account.geldmarktEtf += amount(lot.marketValue);
    }
    portfolio.tagesgeld = portfolio.personAccounts.reduce((sum, entry) => sum + entry.tagesgeld, 0);
    portfolio.geldmarktEtf = portfolio.personAccounts.reduce((sum, entry) => sum + entry.geldmarktEtf, 0);
    portfolio.liquiditaet = portfolio.tagesgeld + portfolio.geldmarktEtf;
}

/** Old single-person runs remain readable; a legacy household needs actual cash evidence. */
export function ensurePersonalAccounts(portfolio, inputs = {}) {
    if (Array.isArray(portfolio.personAccounts)) return;
    const primary = portfolio.simulationSourceProfileId || inputs.simulationSourceProfileId || 'simulation';
    const moneyLots = portfolio.depotTranchesGeldmarkt ||= [];
    if (moneyLots.length === 0 && amount(portfolio.geldmarktEtf) > 0) {
        const value = amount(portfolio.geldmarktEtf);
        moneyLots.push({ schemaVersion: 2, trancheId: `simbase:${encodeURIComponent(primary)}:geldmarkt`,
            sourceProfileId: primary, marketValue: value, costBasis: value, shares: value,
            purchasePrice: 1, currentPrice: 1, purchaseDate: '1970-01-01', tqf: 0, taxExempt: false,
            type: 'geldmarkt', category: 'money_market' });
    }
    let people = inputs.simulationPeople;
    if (!Array.isArray(people) || !people.length) {
        const diagnostics = inputs.goldStrategyDiagnostics;
        // Older merged exports already captured personal operative liquidity and owned MM lots.
        if (Array.isArray(diagnostics) && diagnostics.length) {
            people = diagnostics.map(row => ({ profileId: row.profileId, name: row.name,
                tagesgeld: amount(row.operativeLiquidity) - (portfolio.depotTranchesGeldmarkt || [])
                    .filter(lot => owner(portfolio, lot) === row.profileId).reduce((sum, lot) => sum + amount(lot.marketValue), 0) }));
        } else {
            people = [{ profileId: primary, tagesgeld: amount(portfolio.tagesgeld ?? (amount(portfolio.liquiditaet) - moneyLots.reduce((sum, lot) => sum + amount(lot.marketValue), 0))) }];
            const ids = new Set(investmentLots(portfolio).concat(portfolio.depotTranchesGeldmarkt || []).map(lot => owner(portfolio, lot)));
            for (const profileId of ids) if (profileId !== primary) people.push({ profileId, tagesgeld: 0 });
            if (people.length > 1) portfolio.personalAccountEvidence = 'legacy_personal_cash_unavailable';
        }
    }
    portfolio.personAccounts = people.map(person => ({ profileId: person.profileId, name: person.name || person.profileId,
        tagesgeld: amount(person.tagesgeld), geldmarktEtf: 0,
        ...(Number.isFinite(person.sparerPauschbetrag) ? { sparerPauschbetrag: amount(person.sparerPauschbetrag),
            taxState: { lossCarry: amount(person.taxState?.lossCarry) } } : {}),
        kirchensteuerSatz: amount(person.kirchensteuerSatz ?? inputs.kirchensteuerSatz),
        liquidityRunwayYears: person.liquidityRunwayYears ?? inputs.liquidityRunwayYears ?? 5 }));
    if (new Set(portfolio.personAccounts.map(person => person.profileId)).size !== portfolio.personAccounts.length) {
        throw new Error('SIM_PERSONAL_ACCOUNT_DUPLICATE');
    }
    if (Array.isArray(inputs.simulationPeople) && Math.abs(portfolio.personAccounts.reduce((sum, person) => sum + person.tagesgeld, 0)
        - amount(portfolio.tagesgeld)) > 0.01) throw new Error('SIM_PERSONAL_CASH_TOTAL_MISMATCH');
    // Explicit zero is authoritative. Do not resurrect an exhausted component from the initial inputs.
    syncPersonalLiquidity(portfolio);
}

export function personalProfiles(portfolio, inputs = {}) {
    return portfolio.personAccounts.map(account => {
        const lots = investmentLots(portfolio).filter(lot => owner(portfolio, lot) === account.profileId);
        const values = { depotwertAlt: 0, depotwertNeu: 0, goldWert: 0, costBasisAlt: 0, costBasisNeu: 0 };
        for (const lot of lots) {
            if (lot.category === 'gold' || lot.type === 'gold') values.goldWert += amount(lot.marketValue);
            else if (lot.type === 'aktien_alt') { values.depotwertAlt += amount(lot.marketValue); values.costBasisAlt += amount(lot.costBasis); }
            else { values.depotwertNeu += amount(lot.marketValue); values.costBasisNeu += amount(lot.costBasis); }
        }
        return { profileId: account.profileId, name: account.name, tranches: lots,
            balanceState: { lastState: { taxState: account.taxState || { lossCarry: 0 } } },
            inputs: { ...values, ...account, liquidityRunwayYears: inputs.liquidityRunwayYears ?? account.liquidityRunwayYears } };
    });
}

export function personalWithdrawalPlan(profiles, value, mode = 'tax_optimized') {
    return calculateWithdrawalDistribution(profiles, { netWithdrawal: value }, mode);
}

export function debitAccount(portfolio, account, value) {
    let remaining = amount(value);
    const tagesgeldUsed = Math.min(account.tagesgeld, remaining);
    account.tagesgeld -= tagesgeldUsed;
    remaining -= tagesgeldUsed;
    let geldmarktUsed = 0;
    const lots = (portfolio.depotTranchesGeldmarkt || []).filter(lot => owner(portfolio, lot) === account.profileId)
        .sort((a, b) => String(a.purchaseDate || '').localeCompare(String(b.purchaseDate || '')));
    for (const lot of lots) {
        const take = Math.min(amount(lot.marketValue), remaining);
        if (take <= 0) continue;
        const ratio = take / lot.marketValue;
        recordPersonalDisposal(portfolio, lot, take, amount(lot.costBasis) * ratio);
        lot.costBasis = amount(lot.costBasis) * (1 - ratio);
        if (Number.isFinite(lot.shares)) lot.shares *= 1 - ratio;
        lot.marketValue = Math.max(0, lot.marketValue - take);
        if (lot.marketValue === 0) lot.simulationLotStatus = 'sold';
        geldmarktUsed += take;
        remaining -= take;
    }
    return { profileId: account.profileId, tagesgeldUsed, geldmarktUsed, amount: tagesgeldUsed + geldmarktUsed };
}

/** Respect the Balance plan; report any liquidity-driven redistribution explicitly. */
export function debitPersonalLiquidity(portfolio, value, plan = null) {
    const total = Math.min(amount(value), portfolio.liquiditaet);
    const distribution = plan || personalWithdrawalPlan(personalProfiles(portfolio), total);
    let targetRemaining = total;
    const rows = distribution.items.map(item => {
        const used = debitAccount(portfolio, portfolio.personAccounts.find(account => account.profileId === item.profileId),
            Math.min(item.withdrawalAmount, targetRemaining));
        targetRemaining -= used.amount;
        return { planned: item.withdrawalAmount, ...used };
    });
    let rest = total - rows.reduce((sum, row) => sum + row.amount, 0);
    // No transfers or negative personal balances: exhaust remaining real accounts in the same order.
    for (const profile of [...distribution.items, ...portfolio.personAccounts]) {
        if (rest <= 1e-9) break;
        const account = portfolio.personAccounts.find(entry => entry.profileId === profile.profileId);
        const used = debitAccount(portfolio, account, rest);
        const row = rows.find(entry => entry.profileId === account.profileId);
        if (row) { row.amount += used.amount; row.tagesgeldUsed += used.tagesgeldUsed; row.geldmarktUsed += used.geldmarktUsed; }
        else rows.push({ ...used, planned: 0 });
        rest -= used.amount;
    }
    syncPersonalLiquidity(portfolio);
    return { mode: distribution.mode, items: rows, total: rows.reduce((sum, row) => sum + row.amount, 0),
        ...(rows.some(row => Math.abs(row.amount - row.planned) > 0.01)
            ? { restCause: 'personal_payout_exceeds_owned_liquidity' } : {}) };
}

export const snapshotPersonalInvestments = portfolio => investmentLots(portfolio).map(lot => ({ lot, value: amount(lot.marketValue), cost: amount(lot.costBasis) }));

/** Credit proceeds to the actual lot owner after reserving sale tax. */
export function creditPersonalSale(portfolio, snapshot, net, sources = []) {
    if (!(net > 0)) return [];
    const weights = portfolio.personAccounts.map(account => {
        const gross = snapshot.filter(row => owner(portfolio, row.lot) === account.profileId)
            .reduce((sum, row) => sum + Math.max(0, row.value - amount(row.lot.marketValue)), 0);
        const tax = sources.filter(source => source.sourceProfileId === account.profileId)
            .reduce((sum, source) => sum + amount(source.steuer), 0);
        return { profileId: account.profileId, weight: Math.max(0, gross - tax), gross, tax };
    });
    const total = weights.reduce((sum, row) => sum + row.weight, 0);
    if (net > 1e-7 && total <= 0) throw new Error('SIM_PERSONAL_SALE_PROVENANCE_MISSING');
    const grossTotal = weights.reduce((sum, row) => sum + row.gross, 0);
    const hasSourceTax = sources.some(source => amount(source.steuer) > 0);
    const funding = weights.map(row => ({ profileId: row.profileId, amount: total > 0 ? net * row.weight / total : 0,
        taxReserved: hasSourceTax ? row.tax : grossTotal > 0 ? Math.max(0, grossTotal - net) * row.gross / grossTotal : 0 }));
    for (const row of funding) portfolio.personAccounts.find(account => account.profileId === row.profileId).tagesgeld += row.amount;
    syncPersonalLiquidity(portfolio);
    return funding;
}

/** Reinvest in the owners who finance the purchase; never use the current UI person as buyer. */
export function personalPurchaseFunding(portfolio, value, funding) {
    if (!(value > 0)) return [];
    const total = funding?.reduce((sum, row) => sum + row.amount, 0) || 0;
    if (total <= 0) return debitPersonalLiquidity(portfolio, value).items;
    const rows = funding.map(row => ({ profileId: row.profileId, amount: value * row.amount / total }));
    for (const row of rows) {
        const used = debitAccount(portfolio, portfolio.personAccounts.find(account => account.profileId === row.profileId), row.amount);
        if (used.amount + 1e-7 < row.amount) throw new Error('SIM_PERSONAL_PURCHASE_UNDERFUNDED');
    }
    syncPersonalLiquidity(portfolio);
    return rows;
}

export function applyPersonalInterest(portfolio, rate, { additive = false } = {}) {
    const before = portfolio.liquiditaet;
    const rows = portfolio.personAccounts.map(account => ({ profileId: account.profileId,
        interest: (account.tagesgeld + account.geldmarktEtf) * rate, cashInterest: account.tagesgeld * rate }));
    for (const account of portfolio.personAccounts) account.tagesgeld = additive
        ? account.tagesgeld + account.tagesgeld * rate : account.tagesgeld * (1 + rate);
    for (const lot of portfolio.depotTranchesGeldmarkt || []) lot.marketValue = additive
        ? lot.marketValue + lot.marketValue * rate : lot.marketValue * (1 + rate);
    syncPersonalLiquidity(portfolio);
    return { interest: additive ? rows.reduce((sum, row) => sum + row.interest, 0) : portfolio.liquiditaet - before, items: rows };
}

export function applyPersonalTaxAdjustment(portfolio, adjustment, interest, saleFunding = []) {
    const weights = interest.items.map(row => ({ profileId: row.profileId, amount: Math.abs(row.interest) }));
    const total = weights.reduce((sum, row) => sum + row.amount, 0);
    if (adjustment >= 0) {
        const reserved = saleFunding.reduce((sum, row) => sum + (row.taxReserved || 0), 0);
        for (const account of portfolio.personAccounts) {
            const paid = saleFunding.filter(row => row.profileId === account.profileId).reduce((sum, row) => sum + (row.taxReserved || 0), 0);
            account.tagesgeld += adjustment * (reserved > 0 ? paid / reserved : total > 0
                ? weights.find(row => row.profileId === account.profileId).amount / total
                : account === portfolio.personAccounts[0] ? 1 : 0);
        }
    } else {
        const plan = { mode: 'pooled_tax_PA_A7', items: weights.map(row => ({ profileId: row.profileId,
            withdrawalAmount: -adjustment * (total > 0 ? row.amount / total : 1 / weights.length) })) };
        debitPersonalLiquidity(portfolio, -adjustment, plan);
    }
    syncPersonalLiquidity(portfolio);
}
