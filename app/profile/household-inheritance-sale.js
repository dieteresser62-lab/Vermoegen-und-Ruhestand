/** FR-54: Nettoerlös aus X; Tagesgeld zuerst, dann anteilige Nachlasstranchen. */
import { calculateSaleAndTax } from '../../engine/transactions/sale-engine.mjs';
import { settleTaxYear } from '../../engine/tax-settlement.mjs';

/** @param {import("../../typcheck/rechenkern.js").EngineTranche[]} tranches @param {number} [kirchensteuerSatz] @returns {import("../../typcheck/rechenkern.js").SaleResult} */
export function inheritanceSale(tranches, kirchensteuerSatz = 0) {
    const normalized = tranches.filter(lot => lot.marketValue > 0).map(lot => ({ ...lot, taxExempt: lot.taxExempt === true, tqf: Number(lot.tqf) || 0,
        type: lot.type || (lot.category === 'bonds' ? 'anleihe' : lot.category === 'gold' ? 'gold' : lot.category === 'money_market' ? 'geldmarkt' : 'aktien_neu') }));
    const originals = new Map(normalized.map(lot => [lot.trancheId, lot]));
    /** @type {import("../../typcheck/rechenkern.js").EngineTranche[]} */
    const lots = normalized.map(lot => ({ ...lot,
        ...(lot.type === 'geldmarkt' || lot.category === 'money_market' ? { type: 'anleihe', category: 'bonds' } : {}) }));
    const gross = lots.reduce((sum, lot) => sum + lot.marketValue, 0);
    const sale = /** @type {(amount: number, input: Pick<import("../../typcheck/rechenkern.js").EngineInput, "detailledTranches"|"sparerPauschbetrag"|"kirchensteuerSatz"|"goldAktiv">, context: import("../../typcheck/rechenkern.js").SaleContext, prior: object, capture: boolean)=>import("../../typcheck/rechenkern.js").SaleResult} */ (calculateSaleAndTax)(gross, { detailledTranches: lots, sparerPauschbetrag: 0,
        kirchensteuerSatz, goldAktiv: true }, { forceGrossSellAmount: gross, minGold: 0 }, {}, true);
    sale.breakdown = sale.breakdown.map(source => ({ ...source, kind: originals.get(source.trancheId).type,
        category: originals.get(source.trancheId).category }));
    return sale;
}

/**
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Funktion zur Ermittlung des Nettoerlöses eines Erbbetrags.
 */
export function inheritanceNetProceeds({ cash = 0, tranches = [], reservedHomeProceeds = 0, kirchensteuerSatz = 0,
    sparerPauschbetrag = 0, taxStatePrev, saleTax = rawAggregate => settleTaxYear({ rawAggregate,
        kirchensteuerSatz, sparerPauschbetrag, taxStatePrev }).taxDue }) {
    const depot = tranches.reduce((sum, lot) => sum + lot.marketValue, 0);
    const availableCash = Math.max(0, cash - reservedHomeProceeds);
    return amount => {
        const fromDepot = Math.max(0, amount - availableCash);
        if (!fromDepot || !depot) return amount;
        const share = Math.min(1, fromDepot / depot);
        const lots = tranches.filter(lot => lot.marketValue > 0).map((lot, index) => ({ ...lot,
            trancheId: `estate:${index}`, marketValue: lot.marketValue * share, costBasis: (Number.isFinite(lot.costBasis) ? lot.costBasis : 0) * share,
            ...(Number.isFinite(lot.shares) ? { shares: lot.shares * share } : {}) }));
        const sale = inheritanceSale(lots, kirchensteuerSatz);
        const tax = saleTax(sale.taxRawAggregate);
        return Math.max(0, amount - tax);
    };
}
