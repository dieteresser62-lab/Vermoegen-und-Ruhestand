/** FR-48: persönliche Jahreszahlungen; nur der Simulator verwendet diesen Pfad. */
import { debitAccount, syncPersonalLiquidity } from './simulator-personal-accounts.js';

/**
 * @param inputs Wirksame Simulationseingaben.
 * @returns {boolean} Ergebnis der Operation.
 */
export const isUnmarriedSimulation = inputs => inputs.partner?.aktiv === true && inputs.partnership?.status === 'unmarried';
const groups = ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt', 'healthBucketTranches'];
/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param {object} [options]
 * @param {boolean} [options.includeReserve]
 * @returns Ergebnis der Operation.
 */
export function personalAssetValues(portfolio, { includeReserve = true } = {}) {
    return portfolio.personAccounts.map(account => ({ profileId: account.profileId,
        value: account.tagesgeld + groups.filter(key => includeReserve || key !== 'healthBucketTranches')
            .reduce((total, key) => total + (portfolio[key] || [])
            .filter(lot => (lot.sourceProfileId || portfolio.simulationSourceProfileId) === account.profileId)
            .reduce((sum, lot) => sum + lot.marketValue, 0), 0)
            + (includeReserve ? portfolio.healthBucketCashOwners || [] : []).filter(row => row.profileId === account.profileId)
                .reduce((sum, row) => sum + row.amount, 0) }));
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param inputs Wirksame Simulationseingaben.
 * @param care
 * @param deathThisYear
 * @param household
 * @param careTotal
 * @returns Ergebnis der Operation.
 */
export function unmarriedYearShares(portfolio, inputs, care, deathThisYear, household, careTotal) {
    const values = personalAssetValues(portfolio), total = values.reduce((sum, row) => sum + row.value, 0);
    const costs = [care.p1, care.p2].map((meta, i) => meta?.active
        ? Math.max(0, meta.zusatzFloorZiel || 0) * (household[`p${i + 1}Alive`] ? 1 : deathThisYear ? .5 : 0) : 0);
    const sumCare = costs.reduce((sum, value) => sum + value, 0);
    return values.map((row, i) => ({ profileId: row.profileId, share: total > 0 ? row.value / total : 1 / values.length,
        care: sumCare > 0 ? careTotal * (costs[inputs.simulationPeople?.findIndex(p => p.profileId === row.profileId) ?? i] || 0) / sumCare
            : i === 0 ? careTotal : 0 }));
}

/** Die Engine entscheidet weiter über den Nettobedarf; vor Zahlung folgt die volle persönliche Gutschrift. */
function consumedIncomeCredits(portfolio, inputs, pension, income, incomeLog) {
    const credits = new Map((income?.persons || []).map(row => [row.profileId, row.amount]));
    for (const [i, amount] of [pension.rente1, pension.rente2].entries()) {
        const id = inputs.simulationPeople?.[i]?.profileId || portfolio.personAccounts[i]?.profileId;
        if (id && amount) credits.set(id, (credits.get(id) || 0) + amount);
    }
    return [...credits].map(([profileId, amount]) => ({ profileId,
        amount: amount - (incomeLog?.einkuenfte_gespart_personen.find(row => row.profileId === profileId)?.amount || 0) }));
}

/** Vor der Überschussanlage den noch aus eigenem Tagesgeld zu zahlenden Anteil schützen.
 *
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param inputs Wirksame Simulationseingaben.
 * @param shares
 * @param withdrawal
 * @param expense
 * @param pension
 * @param income
 * @param incomeLog
 * @returns Ergebnis der Operation.
 */
export function unmarriedInvestmentReserves(portfolio, inputs, shares, withdrawal, expense, pension, income, incomeLog) {
    const credits = consumedIncomeCredits(portfolio, inputs, pension, income, incomeLog);
    const consumed = credits.reduce((sum, row) => sum + row.amount, 0);
    const plan = unmarriedWithdrawalPlan(shares, withdrawal + expense + consumed, portfolio);
    return plan.items.map(row => ({ profileId: row.profileId,
        amount: Math.max(0, row.withdrawalAmount - (credits.find(item => item.profileId === row.profileId)?.amount || 0)) }));
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param inputs Wirksame Simulationseingaben.
 * @param pension
 * @param income
 * @param incomeLog
 * @returns {number} Ergebnis der Operation.
 */
export function creditConsumedIncome(portfolio, inputs, pension, income, incomeLog) {
    let total = 0;
    for (const { profileId: id, amount: consumed } of consumedIncomeCredits(portfolio, inputs, pension, income, incomeLog)) {
        if (!consumed) continue;
        const account = portfolio.personAccounts.find(row => row.profileId === id);
        if (!account) throw new Error('SIM_UNMARRIED_INCOME_OWNER_MISSING');
        account.tagesgeld += consumed;
        total += consumed;
    }
    syncPersonalLiquidity(portfolio);
    return total;
}

/**
 * @param shares
 * @param gross
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param {boolean} [includeCare]
 * @returns Ergebnis der Operation.
 */
export function unmarriedWithdrawalPlan(shares, gross, portfolio, includeCare = true) {
    const care = includeCare ? shares.reduce((sum, row) => sum + row.care, 0) : 0;
    const shared = Math.max(0, gross - care);
    const values = personalAssetValues(portfolio, { includeReserve: false });
    const items = shares.map(row => ({ profileId: row.profileId, shared: shared * row.share, care: includeCare ? row.care : 0 }));
    // Nur persönliche Pflege darf auf den Partner übergehen; der gemeinsame Anteil bleibt fest.
    for (const row of items) {
        const capacity = Math.max(0, (values.find(value => value.profileId === row.profileId)?.value || 0) - row.shared);
        const rest = Math.max(0, row.care - capacity);
        row.care -= rest;
        const helper = items.find(item => item !== row);
        if (helper) helper.care += rest;
    }
    return { mode: 'unmarried', fixedOwnership: true, totalNeed: gross,
        items: items.map(row => ({ ...row, withdrawalAmount: row.shared + row.care })) };
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param plan
 * @returns Ergebnis der Operation.
 */
export function debitUnmarriedPlan(portfolio, plan) {
    const rows = plan.items.map(item => ({ planned: item.withdrawalAmount,
        ...debitAccount(portfolio, portfolio.personAccounts.find(row => row.profileId === item.profileId), item.withdrawalAmount) }));
    syncPersonalLiquidity(portfolio);
    return { mode: plan.mode, items: rows, total: rows.reduce((sum, row) => sum + row.amount, 0) };
}
