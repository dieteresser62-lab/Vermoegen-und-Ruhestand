import { capitalGainsTaxRate } from '../../../engine/tax-settlement.mjs';
import { readNumber } from './values.js';
import { resolveTrancheCategory } from './tranches.js';
import { applyIsinFifo, isinFifoGroup } from '../../../types/sale-fifo.js';

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

/** Steuer je verkauftem Euro einer Aktientranche wie in der Tranchenwahl: Gewinnanteil × (1 − Teilfreistellung) × Steuersatz,
 * „ganz steuerfrei“ ergibt 0 (FR-80 Punkt 8). */
function trancheTaxPerEuro(tranche, taxRate) {
    if (tranche?.taxExempt === true) return 0;
    const tqf = Math.max(0, Math.min(1, readNumber(tranche?.tqf, 0)));
    return computeProfitRatio(readNumber(tranche?.marketValue, 0), readNumber(tranche?.costBasis, 0)) * (1 - tqf) * taxRate;
}

// Berechne Steuerlast pro Euro für ein Profil. FR-80 Punkt 8: Mit Tranchen je Aktientranche wie `selectTranchesForSale`
// (Teilfreistellung, „ganz steuerfrei“), gewichtet nach Marktwert; ohne Tranchen wie bisher aus den Summen.
export function calculateTaxPerEuro(inputs, tranches = null) {
    if (!inputs) return 0;
    const taxRate = computeTaxRate(inputs);
    // RK-3 Punkt 4: eine Schleife statt Filter und zwei Summen; gleiche Summenreihenfolge, gleiches Ergebnis.
    if (Array.isArray(tranches)) {
        let total = 0, weighted = 0, count = 0;
        for (const t of tranches) {
            if (resolveTrancheCategory(t) !== 'equity') continue;
            const value = readNumber(t.marketValue, 0);
            if (!(value > 0)) continue;
            total += value; weighted += value * trancheTaxPerEuro(t, taxRate); count += 1;
        }
        if (count) return weighted / total;
    }
    // TRG-1b (P3-5): Ohne Tranchen je Teildepot mit seiner Teilfreistellung (tqfAlt/tqfNeu), damit eine Person mit und eine ohne
    // Tranchen gleich gerechnet werden.
    const parts = [[inputs.depotwertAlt, inputs.costBasisAlt, inputs.tqfAlt], [inputs.depotwertNeu, inputs.costBasisNeu, inputs.tqfNeu]]
        .map(([value, cost, tqf]) => ({ value: readNumber(value, 0), cost: readNumber(cost, 0), tqf: Math.max(0, Math.min(1, readNumber(tqf, 0))) }));
    const marketValue = parts.reduce((sum, part) => sum + part.value, 0);
    if (!(marketValue > 0)) return 0;
    // Steuerlast pro € = Gewinn nach Teilfreistellung je verkauftem Euro * effektiver Steuersatz.
    return parts.reduce((sum, part) => sum + Math.max(0, part.value - part.cost) * (1 - part.tqf), 0) / marketValue * taxRate;
}

// Wähle optimale Tranchen für Verkauf (wenn depot_tranchen vorhanden)
export function selectTranchesForSale(tranches, targetAmount, taxRate = DEFAULT_TAX_RATE) {
    if (!Array.isArray(tranches) || tranches.length === 0 || targetAmount <= 0) return [];
    const candidates = tranches
        .filter(t => resolveTrancheCategory(t) === 'equity')
        .map(t => ({
            tranche: t,
            marketValue: readNumber(t.marketValue, 0),
            // TRG-1b (P3-5): „ganz steuerfrei“ wie die Kennzahl je Euro.
            taxPerEuro: trancheTaxPerEuro(t, taxRate),
            purchaseStamp: normalizeTrancheDate(t)
        }))
        .filter(item => item.marketValue > 0);

    // Sortierung: niedrigste Steuerlast zuerst, dann nach Kaufdatum.
    candidates.sort((a, b) => {
        if (a.taxPerEuro !== b.taxPerEuro) return a.taxPerEuro - b.taxPerEuro;
        return a.purchaseStamp - b.purchaseStamp;
    });

    // FR-82: Bei derselben ISIN zuerst die ältesten Stücke (Tranchen einer Person).
    const ordered = applyIsinFifo(candidates, item => item.tranche, item => isinFifoGroup(item.tranche, ''));

    let remaining = targetAmount;
    const selections = [];
    for (const item of ordered) {
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
