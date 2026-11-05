import { capitalGainsTaxRate } from '../../../engine/tax-settlement.mjs';
import { readNumber } from './values.js';
import { resolveTrancheCategory } from './tranches.js';

const DEFAULT_TAX_RATE = capitalGainsTaxRate(0);

export function computeTaxRate(inputs) {
    const kirchen = Math.max(0, readNumber(inputs?.kirchensteuerSatz, 0));
    return capitalGainsTaxRate(kirchen);
}

export function computeProfitRatio(marketValue, costBasis) {
    if (!Number.isFinite(marketValue) || marketValue <= 0) return 0;
    const gain = Math.max(0, (marketValue || 0) - (costBasis || 0));
    return Math.max(0, gain / marketValue);
}

function normalizeTrancheDate(tranche) {
    const raw = tranche?.purchaseDate;
    if (!raw) return Number.POSITIVE_INFINITY;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

// Berechne Steuerlast pro Euro für ein Profil
export function calculateTaxPerEuro(inputs) {
    if (!inputs) return 0;
    const marketValue = (inputs.depotwertAlt || 0) + (inputs.depotwertNeu || 0);
    const costBasis = (inputs.costBasisAlt || 0) + (inputs.costBasisNeu || 0);
    // Steuerlast pro € = Gewinnquote * effektiver Steuersatz.
    const profitRatio = computeProfitRatio(marketValue, costBasis);
    return profitRatio * computeTaxRate(inputs);
}

// Wähle optimale Tranchen für Verkauf (wenn depot_tranchen vorhanden)
export function selectTranchesForSale(tranches, targetAmount, taxRate = DEFAULT_TAX_RATE) {
    if (!Array.isArray(tranches) || tranches.length === 0 || targetAmount <= 0) return [];
    const candidates = tranches
        .filter(t => resolveTrancheCategory(t) === 'equity')
        .map(t => {
            const marketValue = readNumber(t.marketValue, 0);
            const costBasis = readNumber(t.costBasis, 0);
            const profitRatio = computeProfitRatio(marketValue, costBasis);
            const tqf = Math.max(0, Math.min(1, readNumber(t.tqf, 0)));
            return {
                tranche: t,
                marketValue,
                taxPerEuro: profitRatio * (1 - tqf) * taxRate,
                purchaseStamp: normalizeTrancheDate(t)
            };
        })
        .filter(item => item.marketValue > 0);

    // Sortierung: niedrigste Steuerlast zuerst, dann FIFO nach Kaufdatum.
    candidates.sort((a, b) => {
        if (a.taxPerEuro !== b.taxPerEuro) return a.taxPerEuro - b.taxPerEuro;
        return a.purchaseStamp - b.purchaseStamp;
    });

    let remaining = targetAmount;
    const selections = [];
    for (const item of candidates) {
        if (remaining <= 0) break;
        const sellAmount = Math.min(item.marketValue, remaining);
        const taxAmount = sellAmount * item.taxPerEuro;
        selections.push({
            tranche: item.tranche,
            sellAmount,
            taxAmount
        });
        remaining -= sellAmount;
    }

    return selections;
}
