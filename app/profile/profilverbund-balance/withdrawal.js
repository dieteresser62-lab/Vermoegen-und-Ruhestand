import { computeTaxRate, calculateTaxPerEuro, selectTranchesForSale } from './tax.js';
import { resolveTrancheSplitTotals } from './tranches.js';
import { resolveLiquidityRunwayYears } from '../../../types/liquidity-runway-contract.js';
import { profileAssetTotal, profileLiquidity } from './values.js';
import { activeCarrier } from '../household-withdrawal-mode.js';

// Berechne Entnahmeverteilung nach Modus
export function calculateWithdrawalDistribution(profileInputs, aggregated, mode = 'tax_optimized') {
    const list = Array.isArray(profileInputs) ? profileInputs : [];
    const totalNeedCents = Math.max(0, Math.round((Number(aggregated?.netWithdrawal) || 0) * 100));
    const totalNeed = totalNeedCents / 100;
    if (list.length === 0 || totalNeed <= 0) {
        return { items: [], totalNeed, remaining: totalNeed, totalTaxEstimate: 0, mode };
    }

    // Pro Profil alle Kennzahlen vorbereiten, die für Verteilung & Steuer-Schätzung nötig sind.
    const entries = list.map(entry => {
        const inputs = entry.inputs || {};
        // FR-80 Punkt 8: Steuer je Euro je Tranche wie die Tranchenwahl (Teilfreistellung, „ganz steuerfrei“), nach Marktwert gewichtet.
        const taxRate = computeTaxRate(inputs);
        const taxPerEuro = calculateTaxPerEuro(inputs, entry.tranches);
        // Weiter alle Tranchen prüfen, auch bei explizitem Geldmarktwert:
        // Ein Klassifikationsfehler muss wie bisher an dieser Grenze werfen.
        const derivedMoneyMarket = resolveTrancheSplitTotals(entry.tranches || []).moneyValue || 0;
        return {
            profileId: entry.profileId,
            name: entry.name || entry.profileId,
            inputs,
            tranches: Array.isArray(entry.tranches) ? entry.tranches : [],
            taxPerEuro,
            taxRate,
            liquidityRunwayYears: resolveLiquidityRunwayYears(inputs).years,
            assets: profileAssetTotal(inputs),
            liquidity: profileLiquidity(inputs),
            derivedMoneyMarket,
            rentAnnual: (inputs.renteAktiv ? (inputs.renteMonatlich || 0) : 0) * 12
        };
    });

    // Persönliche Pflegekosten (unverheiratet, FR-72 Punkt 10) trägt zuerst die Person; nur der gemeinsame
    // Rest folgt dem gewählten Modus. Gutachten PFA-2, Befund 3: Dazu wird erst der Bruttobedarf zugeordnet
    // (gemeinsamer Anteil nach Modus plus eigene Pflegekosten), danach zählen die eigenen Einkünfte der Person.
    // Reicht die Auszahlung nicht einmal für die Pflegekosten, werden diese anteilig gekürzt.
    const personal = aggregated?.personalNeeds || {};
    const personalRaw = entries.map(entry => Math.max(0, Math.round((Number(personal[entry.profileId]) || 0) * 100)));
    const personalSum = personalRaw.reduce((sum, value) => sum + value, 0);
    const incomeCents = entries.map(entry => personalSum > 0 ? Math.max(0, Math.round((entry.rentAnnual || 0) * 100)) : 0);
    const grossCents = totalNeedCents + incomeCents.reduce((sum, value) => sum + value, 0);
    const personalCents = personalSum > grossCents && personalSum > 0
        ? personalRaw.map(value => Math.floor(value * grossCents / personalSum)) : personalRaw;
    const commonCents = Math.max(0, grossCents - personalCents.reduce((sum, value) => sum + value, 0));
    let remainingCents = commonCents;
    let allocations = [];
    // FR-80: Bei „Eine Person trägt“ übernimmt die tragende Person den gemeinsamen Anteil. Fehlt sie (gestorben, nicht im
    // Haushalt), endet der Modus und es gilt „steueroptimiert“.
    const carrierId = activeCarrier(mode, entries);
    const kind = carrierId ? 'one_carries' : String(mode).startsWith('one_carries') ? 'tax_optimized' : mode;

    if (kind === 'one_carries') {
        allocations = entries.map(entry => ({ entry, amountCents: entry.profileId === carrierId ? commonCents : 0 }));
        remainingCents = 0;
    } else if (kind === 'tax_optimized') {
        // FR-27: Haushaltsliquidität in Personenreihenfolge, je Person TG vor MM.
        allocations = entries.map(entry => {
            const maxShareCents = Math.max(0, Math.round(entry.liquidity * 100));
            const amountCents = Math.max(0, Math.min(remainingCents, maxShareCents));
            remainingCents -= amountCents;
            return { entry, amountCents };
        });
    } else {
        // Proportional nach Vermögen oder (runway_first) nach Runway-Zielen.
        const weights = entries.map(entry => {
            if (mode === 'runway_first') {
                return entry.assets > 0 ? Math.max(0, entry.liquidityRunwayYears || 0) : 0;
            }
            return Math.max(0, entry.assets || 0);
        });
        const totalWeight = weights.reduce((sum, val) => sum + val, 0);
        if (totalWeight > 0) {
            const raw = entries.map((entry, idx) => {
                const exactCents = commonCents * (weights[idx] / totalWeight);
                const amountCents = Math.floor(exactCents);
                return { entry, amountCents, fraction: exactCents - amountCents, index: idx };
            });
            let roundingRest = commonCents - raw.reduce((sum, item) => sum + item.amountCents, 0);
            raw.slice()
                .sort((a, b) => (b.fraction - a.fraction) || (a.index - b.index))
                .forEach(item => {
                    if (roundingRest <= 0) return;
                    item.amountCents += 1;
                    roundingRest -= 1;
                });
            allocations = raw;
            remainingCents = 0;
        } else {
            allocations = entries.map(entry => ({ entry, amountCents: 0 }));
        }
    }

    allocations.forEach((item, index) => { item.amountCents += personalCents[entries.indexOf(item.entry)] ?? personalCents[index] ?? 0; });
    creditPersonalIncome(allocations, entries, incomeCents, totalNeedCents);
    if (kind === 'one_carries') return finishWithdrawalItems(allocations, totalNeedCents, carryingRemainder(allocations, totalNeedCents, carrierId), mode, carrierId);
    // Erst Liquidität für den Plan, dann übrige Haushaltsliquidität, zuletzt Verkäufe.
    const originalAmounts = allocations.map(item => item.amountCents);
    for (const item of allocations) item.amountCents = Math.min(item.amountCents,
        Math.max(0, Math.round(item.entry.liquidity * 100)));
    remainingCents = totalNeedCents - allocations.reduce((sum, item) => sum + item.amountCents, 0);
    for (const item of allocations) {
        const available = Math.max(0, Math.round(item.entry.liquidity * 100) - item.amountCents);
        const take = Math.min(remainingCents, available);
        item.amountCents += take;
        remainingCents -= take;
    }
    if (kind === 'tax_optimized') {
        const saleOrder = allocations.slice().sort((a, b) =>
            a.entry.taxPerEuro - b.entry.taxPerEuro
            || String(a.entry.profileId).localeCompare(String(b.entry.profileId)));
        for (const item of saleOrder) {
            const available = Math.max(0, Math.round(item.entry.assets * 100) - item.amountCents);
            const take = Math.min(remainingCents, available);
            item.amountCents += take;
            remainingCents -= take;
        }
    } else if (remainingCents > 0) {
        // Anteilig/Reichweite zuerst behalten ihre bisherigen Gewichte für den Verkaufsrest.
        const deficits = allocations.map((item, index) => Math.max(0, originalAmounts[index] - item.amountCents));
        const totalDeficit = deficits.reduce((sum, value) => sum + value, 0);
        if (totalDeficit > 0) {
            const shares = deficits.map((value, index) => {
                const exact = remainingCents * value / totalDeficit;
                return { index, cents: Math.floor(exact), fraction: exact - Math.floor(exact) };
            });
            let rest = remainingCents - shares.reduce((sum, share) => sum + share.cents, 0);
            for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
                if (rest-- <= 0) break;
                share.cents++;
            }
            shares.forEach(share => { allocations[share.index].amountCents += share.cents; });
            remainingCents = 0;
        }
    }

    return finishWithdrawalItems(allocations, totalNeedCents, { remainingCents, attacked: [] }, mode, null);
}

/** FR-80 Punkte 2, 3 und 7: Jede Person zahlt ihren Anteil zuerst aus eigenem Vermögen (Liquidität, dann eigene Verkäufe); persönliche
 * Pflegekosten bleiben bei der Person (FR-72 Punkt 10). Was eine andere Person nicht tragen kann, übernimmt die tragende Person. Reicht
 * deren Vermögen nicht, greift der Plan auf das Vermögen der anderen zu, Reihenfolge wie steueroptimiert (Liquidität in
 * Haushaltsreihenfolge, dann Verkäufe nach Steuer je Euro). Diese Personen stehen in `attacked`. */
/** @param {{entry: any, amountCents: number}[]} allocations @param {number} totalNeedCents @param {string} carrierId */
function carryingRemainder(allocations, totalNeedCents, carrierId) {
    const assetsCents = item => Math.max(0, Math.round(item.entry.assets * 100));
    const own = allocations.map(item => item.amountCents);
    for (const item of allocations) item.amountCents = Math.min(item.amountCents, assetsCents(item));
    let remainingCents = totalNeedCents - allocations.reduce((sum, item) => sum + item.amountCents, 0);
    const carrier = allocations.find(item => item.entry.profileId === carrierId);
    const take = (item, available) => { const cents = Math.max(0, Math.min(remainingCents, available)); item.amountCents += cents; remainingCents -= cents; };
    if (carrier) take(carrier, assetsCents(carrier) - carrier.amountCents);
    const others = allocations.filter(item => item !== carrier);
    for (const item of others) take(item, Math.round(item.entry.liquidity * 100) - item.amountCents);
    for (const item of others.slice().sort((a, b) => a.entry.taxPerEuro - b.entry.taxPerEuro
        || String(a.entry.profileId).localeCompare(String(b.entry.profileId)))) take(item, assetsCents(item) - item.amountCents);
    const attacked = others.filter(item => item.amountCents > own[allocations.indexOf(item)] + 0.5)
        .map(item => ({ profileId: item.entry.profileId, name: item.entry.name, amount: (item.amountCents - own[allocations.indexOf(item)]) / 100 }));
    return { remainingCents, attacked };
}

/** Auszahlung je Person: Tagesgeld, dann Geldmarkt, Verkauf nur für den Rest; Steuer aus der Tranchenwahl.
 * @param {{entry: any, amountCents: number}[]} allocations @param {number} totalNeedCents
 * @param {{remainingCents: number, attacked: {profileId: string, name: string, amount: number}[]}} rest @param {string} mode @param {string|null} carrierId */
function finishWithdrawalItems(allocations, totalNeedCents, { remainingCents, attacked }, mode, carrierId) {
    const totalNeed = totalNeedCents / 100;
    let totalTaxEstimate = 0;
    const items = allocations.map(({ entry, amountCents }) => {
        const amount = amountCents / 100;
        // Cash zuerst nutzen (Tagesgeld/Geldmarkt), Verkauf nur für Restbedarf.
        const tagesgeldAvailable = entry.inputs?.tagesgeld || 0;
        const geldmarktInput = entry.inputs?.geldmarktEtf || 0;
        const geldmarktAvailable = geldmarktInput > 0 ? geldmarktInput : (entry.derivedMoneyMarket || 0);
        const tagesgeldUsed = Math.min(tagesgeldAvailable, amount);
        const remainingAfterTagesgeld = Math.max(0, amount - tagesgeldUsed);
        const geldmarktUsed = Math.min(geldmarktAvailable, remainingAfterTagesgeld);
        const cashUsed = tagesgeldUsed + geldmarktUsed;
        const sellAmount = Math.max(0, amount - cashUsed);
        const trancheSelections = sellAmount > 0
            ? selectTranchesForSale(entry.tranches, sellAmount, entry.taxRate)
            : [];
        const trancheTax = trancheSelections.reduce((sum, item) => sum + (item.taxAmount || 0), 0);
        const taxEstimate = trancheSelections.length
            ? trancheTax
            : sellAmount * entry.taxPerEuro;
        totalTaxEstimate += taxEstimate;
        return {
            profileId: entry.profileId,
            name: entry.name,
            withdrawalAmount: amount,
            cashUsed,
            tagesgeldUsed,
            geldmarktUsed,
            sellAmount,
            taxEstimate,
            taxPerEuro: entry.taxPerEuro,
            rentAnnual: entry.rentAnnual,
            liquidity: entry.liquidity,
            assetTotal: entry.assets,
            tranches: trancheSelections
        };
    });

    return { items, totalNeed, remaining: remainingCents / 100, totalTaxEstimate, mode,
        ...(carrierId ? { carrierId, attacked, carrierName: allocations.find(item => item.entry.profileId === carrierId)?.entry.name || carrierId } : {}) };
}

/** Eigene Einkünfte mindern den Bruttoanteil der jeweiligen Person. Übersteigen sie ihn, hilft der Überschuss
 * den anderen im Verhältnis ihrer Restbeträge; die Summe bleibt die beschlossene Nettoentnahme. */
function creditPersonalIncome(allocations, entries, incomeCents, totalNeedCents) {
    if (!incomeCents.some(value => value > 0)) return;
    for (const item of allocations) item.amountCents = Math.max(0, item.amountCents - (incomeCents[entries.indexOf(item.entry)] || 0));
    let excess = allocations.reduce((sum, item) => sum + item.amountCents, 0) - totalNeedCents;
    while (excess > 0) {
        const open = allocations.filter(item => item.amountCents > 0), base = open.reduce((sum, item) => sum + item.amountCents, 0);
        if (!open.length || base <= 0) break;
        let taken = 0;
        for (const item of open) { const cut = Math.min(item.amountCents, Math.floor(excess * item.amountCents / base)); item.amountCents -= cut; taken += cut; }
        if (taken === 0) { const largest = open.sort((a, b) => b.amountCents - a.amountCents)[0]; largest.amountCents -= Math.min(largest.amountCents, excess); break; }
        excess -= taken;
    }
}

/** Nach Umschichtungen bleibt die Haushaltsauszahlung aus verfügbarer Liquidität
 * gedeckt. Eine durch Käufe verbrauchte persönliche Auszahlung wandert in der
 * bestehenden Planreihenfolge zum anderen Konto, ohne unnötigen Rückverkauf.
 */
export function reconcileWithdrawalLiquidity(plan, accounts) {
    const available = new Map(accounts.map(account => [account.profileId,
        Math.max(0, Number(account.tagesgeld) || 0) + Math.max(0, Number(account.geldmarktEtf) || 0)]));
    if ([...available.values()].reduce((a, b) => a + b, 0) + 1e-8 < plan.totalNeed) return plan;
    const amounts = plan.items.map(item => Math.min(item.withdrawalAmount, available.get(item.profileId) || 0));
    let rest = plan.totalNeed - amounts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < plan.items.length && rest > 1e-8; i++) {
        const extra = Math.min(rest, Math.max(0, (available.get(plan.items[i].profileId) || 0) - amounts[i]));
        amounts[i] += extra; rest -= extra;
    }
    if (plan.items.every((item, i) => Math.abs(item.withdrawalAmount - amounts[i]) <= 1e-8)) return plan;
    // FR-80 Punkt 3 (TRG-1b, P1-1): Bei „Eine Person trägt“ ist jede Verschiebung zur anderen Person ein Rückgriff und steht im Hinweis.
    const attacked = plan.carrierId ? plan.items.flatMap((item, i) => item.profileId !== plan.carrierId && amounts[i] - item.withdrawalAmount > 0.5
        && !plan.attacked?.some(row => row.profileId === item.profileId)
        ? [{ profileId: item.profileId, name: item.name, amount: amounts[i] - item.withdrawalAmount }] : []) : [];
    return { ...plan, items: plan.items.map((item, i) => ({ ...item, withdrawalAmount: amounts[i] })),
        ...(attacked.length ? { attacked: [...(plan.attacked || []), ...attacked] } : {}) };
}
