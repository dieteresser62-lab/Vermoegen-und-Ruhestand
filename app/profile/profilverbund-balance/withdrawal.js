import { computeTaxRate, computeProfitRatio, selectTranchesForSale } from './tax.js';
import { resolveTrancheSplitTotals } from './tranches.js';
import { resolveLiquidityRunwayYears } from '../../../types/liquidity-runway-contract.js';
import { profileAssetTotal, profileLiquidity } from './values.js';

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
        // Steuersatz einmal je Profil: calculateTaxPerEuro = Gewinnquote * computeTaxRate (reine Funktion).
        const taxRate = computeTaxRate(inputs);
        const taxPerEuro = computeProfitRatio((inputs.depotwertAlt || 0) + (inputs.depotwertNeu || 0),
            (inputs.costBasisAlt || 0) + (inputs.costBasisNeu || 0)) * taxRate;
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

    let remainingCents = totalNeedCents;
    let allocations = [];

    if (mode === 'tax_optimized') {
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
                const exactCents = totalNeedCents * (weights[idx] / totalWeight);
                const amountCents = Math.floor(exactCents);
                return { entry, amountCents, fraction: exactCents - amountCents, index: idx };
            });
            let roundingRest = totalNeedCents - raw.reduce((sum, item) => sum + item.amountCents, 0);
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
    if (mode === 'tax_optimized') {
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

    return { items, totalNeed, remaining: remainingCents / 100, totalTaxEstimate, mode };
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
    return { ...plan, items: plan.items.map((item, i) => ({ ...item, withdrawalAmount: amounts[i] })) };
}
