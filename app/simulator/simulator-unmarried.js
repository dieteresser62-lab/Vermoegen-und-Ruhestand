/** FR-48: persönliche Jahreszahlungen; nur der Simulator verwendet diesen Pfad. */
import { debitAccount, syncPersonalLiquidity, payableLiquidity } from './simulator-personal-accounts.js';
import { residentialSpending } from './simulator-residential-care.js';
import { activeCarrier } from '../profile/household-withdrawal-mode.js';

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
    // FR-72 Punkt 10: Heimkosten und eigene Ausgaben gehören zur Person im Heim; die Ersparnis
    // beim gemeinsamen Grundbedarf bleibt im gemeinsamen Anteil.
    const personal = meta => residentialSpending(meta) ? Math.max(0, meta.zusatzFloorZiel || 0) + residentialSpending(meta)
        : Math.max(0, meta.zusatzFloorZiel || 0);
    const costs = [care.p1, care.p2].map((meta, i) => meta?.active
        ? personal(meta) * (household[`p${i + 1}Alive`] ? 1 : deathThisYear ? .5 : 0) : 0);
    const sumCare = costs.reduce((sum, value) => sum + value, 0);
    // FR-80: Bei „Eine Person trägt“ trägt sie den gemeinsamen Anteil allein; persönliche Pflege bleibt bei der Person (FR-72 Punkt 10).
    const carrierId = activeCarrier(inputs.householdWithdrawalMode, values);
    return values.map((row, i) => ({ profileId: row.profileId, ...(carrierId ? { carries: row.profileId === carrierId } : {}),
        share: carrierId ? Number(row.profileId === carrierId) : total > 0 ? row.value / total : 1 / values.length,
        care: sumCare > 0 ? careTotal * (costs[inputs.simulationPeople?.findIndex(p => p.profileId === row.profileId) ?? i] || 0) / sumCare
            : i === 0 ? careTotal : 0 }));
}

/** Die Engine entscheidet weiter über den Nettobedarf; vor Zahlung folgt die volle persönliche Gutschrift.
 * @returns {{profileId: string, amount: number}[]} verbrauchte Einkünfte je Person */
export function consumedIncomeCredits(portfolio, inputs, pension, income, incomeLog) {
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
    const plan = unmarriedWithdrawalPlan(shares, withdrawal + expense + consumed, portfolio, true, credits);
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
 * @param {{profileId: string, amount: number}[]|null} [credits] Verbrauchte Einkünfte je Person (nur bei „Eine Person trägt“ wirksam).
 * @returns Ergebnis der Operation.
 */
export function unmarriedWithdrawalPlan(shares, gross, portfolio, includeCare = true, credits = null) {
    const care = includeCare ? shares.reduce((sum, row) => sum + row.care, 0) : 0;
    const shared = Math.max(0, gross - care);
    const values = personalAssetValues(portfolio, { includeReserve: false });
    const items = shares.map(row => ({ profileId: row.profileId, shared: shared * row.share, care: includeCare ? row.care : 0 }));
    // FR-80 Punkt 3: Reicht das Vermögen der tragenden Person nicht, geht der Rest des gemeinsamen Anteils an die andere Person.
    const attacked = [];
    const carrier = items.find(row => shares.find(share => share.profileId === row.profileId)?.carries);
    // FR-80 Punkt 2 (TRG-1b, P2-2): Die Einkünfte beider zählen zum Haushalt. Die andere Person zahlt ihre verbrauchten Einkünfte
    // (nach ihren eigenen Pflegekosten) in den gemeinsamen Anteil; die tragende Person trägt nur den Rest – wie in der Balance.
    if (carrier && credits) for (const item of items) {
        if (item === carrier) continue;
        const credit = Math.max(0, (credits.find(row => row.profileId === item.profileId)?.amount || 0) - item.care);
        const own = Math.min(carrier.shared, credit);
        item.shared += own; carrier.shared -= own;
    }
    if (carrier) {
        const over = Math.max(0, carrier.shared - (values.find(value => value.profileId === carrier.profileId)?.value || 0));
        const helper = items.find(item => item !== carrier);
        if (over > 0.005 && helper) { carrier.shared -= over; helper.shared += over; attacked.push({ profileId: helper.profileId, amount: over }); }
    }
    // Sonst darf nur persönliche Pflege auf den Partner übergehen; der gemeinsame Anteil bleibt fest.
    for (const row of items) {
        const capacity = Math.max(0, (values.find(value => value.profileId === row.profileId)?.value || 0) - row.shared);
        const rest = Math.max(0, row.care - capacity);
        row.care -= rest;
        const helper = items.find(item => item !== row);
        if (helper) helper.care += rest;
    }
    return { mode: 'unmarried', fixedOwnership: true, totalNeed: gross, ...(attacked.length ? { attacked } : {}),
        items: items.map(row => ({ ...row, withdrawalAmount: row.shared + row.care })) };
}

/** VK-3b (Gutachten VK3-FABLE P2-2, Nachtrag 1): Bei „Eine Person trägt“ zahlt die tragende Person höchstens, was sie auszahlen kann
 * (Tagesgeld und Geldmarkt). Der Plan rechnet mit ihrem Vermögenswert; bleibt nach dem Deckungsverkauf ein kleiner Depotrest, fehlte
 * sonst genau dieser Rest. Den fehlenden Betrag trägt die andere Person mit Hinweis; scheitern kann der Lauf nur, wenn beide nicht reichen.
 * Ohne tragende Person bleibt der Plan unverändert. @param {{items: any[], attacked?: any[]}} plan @param {any[]} shares @param portfolio */
export function capCarrierToPayable(plan, shares, portfolio) {
    const carrierId = shares.find(row => row.carries)?.profileId;
    const carrier = plan.items.find(item => item.profileId === carrierId), helper = plan.items.find(item => item.profileId !== carrierId);
    if (!carrier || !helper) return plan;
    const over = carrier.withdrawalAmount - payableLiquidity(portfolio, /** @type {string} */ (carrierId));
    if (!(over > 0.005)) return plan;
    const shared = Math.min(Math.max(0, carrier.shared), over), care = over - shared;
    const items = plan.items.map(item => item === carrier ? { ...item, shared: item.shared - shared, care: item.care - care, withdrawalAmount: item.withdrawalAmount - over }
        : item === helper ? { ...item, shared: item.shared + shared, care: item.care + care, withdrawalAmount: item.withdrawalAmount + over } : item);
    const attacked = [...(plan.attacked || [])];
    const hit = attacked.findIndex(row => row.profileId === helper.profileId);
    if (hit >= 0) attacked[hit] = { ...attacked[hit], amount: attacked[hit].amount + over };
    else attacked.push({ profileId: helper.profileId, amount: over });
    return { ...plan, items, attacked };
}

/** Auszahlungsanteile, wenn die Auszahlung kleiner ist als der Plan (Liquiditätslücke) oder die geplante Ausgabe getrennt bezahlt wird.
 * Ohne tragende Person wie bisher linear nach Vermögensanteil. Bei „Eine Person trägt“ (FR-80, VK-2b P1-3) wird der Plan für den
 * tatsächlich gezahlten Betrag neu verteilt: Die Anteile sind dort nicht linear (Rückgriff und Einkünfte der anderen Person liegen
 * schon bei ihr), eine Kürzung über `share` würde nur die tragende Person kürzen und der anderen ihren übernommenen Teil lassen.
 * @param {{items: any[], credits?: any}} plan Plan über Zielentnahme, verbrauchte Einkünfte und geplante Ausgabe.
 * @param {any[]} shares Anteile aus `unmarriedYearShares`.
 * @param {{payout: number, incomeConsumed: number, plannedExpense: number, target: number}} amounts
 * @param portfolio Veränderlicher Portfoliozustand.
 * @returns {{items: any[]}} */
export function unmarriedPayoutPlan(plan, shares, { payout, incomeConsumed, plannedExpense, target }, portfolio) {
    if (shares.some(row => row.carries)) {
        const revised = capCarrierToPayable(unmarriedWithdrawalPlan(shares, payout + incomeConsumed, portfolio, true, plan.credits || null), shares, portfolio);
        return { ...plan, items: revised.items, ...(revised.attacked ? { attacked: revised.attacked } : {}) };
    }
    return { ...plan, items: plan.items.map((item, i) => ({ ...item,
        withdrawalAmount: Math.max(0, item.withdrawalAmount - plannedExpense * shares[i].share - (target - payout) * shares[i].share) })) };
}

/** FR-81: Anteil des Grundbedarfs am Plan des Haushalts (höchstens 1). @param {{payout: number, incomeConsumed: number, netFloorYear: number, floor?: number}} amounts */
function floorRatio(amounts) {
    const planned = amounts.payout + amounts.incomeConsumed;
    return planned > 0 ? Math.min(1, unmarriedHouseholdFloor(amounts) / planned) : 1;
}

/** FR-81: Grundbedarf im Haushalt = Floor nach Einkünften plus verbrauchte Einkünfte, höchstens der Floor selbst.
 * @param {{incomeConsumed: number, netFloorYear: number, floor?: number}} amounts */
export function unmarriedHouseholdFloor({ incomeConsumed, netFloorYear, floor }) {
    return Math.max(0, Math.min(netFloorYear + incomeConsumed, Number.isFinite(floor) ? Number(floor) : Infinity));
}

/** FR-81: Ungedeckter Teil der persönlichen Anteile am Grundbedarf (0, wenn jede Person ihren Anteil zahlt).
 * @param {{items: {planned: number, amount: number}[]}} paid @param {{payout: number, incomeConsumed: number, netFloorYear: number, floor?: number}} amounts */
export function unmarriedFloorGap(paid, amounts) {
    const ratio = floorRatio(amounts);
    return paid.items.reduce((sum, item) => sum + (item.amount + 0.005 < item.planned * ratio ? item.planned * ratio - item.amount : 0), 0);
}

/** FR-81: Zahlt eine unverheiratete Person im Vorgabemodus ihren Anteil nicht ganz, wohl aber ihren Anteil am Grundbedarf, ist der
 * Rest eine Kürzung ihres Flex-Anteils. Anteil am Grundbedarf = Planbetrag × Grundbedarf im Haushalt / Plan des Haushalts; der
 * Grundbedarf im Haushalt ist der Floor nach Einkünften plus verbrauchte Einkünfte, höchstens der Floor selbst.
 * @param {{items: {profileId: string, planned: number, amount: number}[]}} paid Ergebnis von `debitUnmarriedPlan`.
 * @param {{payout: number, incomeConsumed: number, netFloorYear: number, floor?: number}} amounts
 * Zahlt jede Person ihren ganzen Plan und fehlt trotzdem ein Rest (Plan verteilt nicht alles), ist die Liste leer.
 * @returns {{profileId: string, amount: number}[]|null} Kürzung je Person; null, wenn ein Anteil am Grundbedarf fehlt. */
export function unmarriedFlexCut(paid, amounts) {
    if (unmarriedFloorGap(paid, amounts) > 0) return null;
    return paid.items.map(item => ({ profileId: item.profileId, amount: Math.max(0, item.planned - item.amount) }))
        .filter(row => row.amount > 0.005);
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
    return { mode: plan.mode, items: rows, total: rows.reduce((sum, row) => sum + row.amount, 0), ...(plan.attacked ? { attacked: plan.attacked } : {}) };
}
