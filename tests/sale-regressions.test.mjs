import { calculateSaleAndTax } from '../engine/transactions/sale-engine.mjs';
import { applyForcedSaleLiquidityCoverage, applyPayoutFallbackSale } from '../app/simulator/simulator-forced-sale.js';

const lot = (trancheId, patch = {}) => ({ schemaVersion: 2, trancheId, type: 'aktien_neu',
    category: 'equity', marketValue: 100000, costBasis: 0, purchaseDate: '2020-01-01',
    tqf: 0.3, taxExempt: false, ...patch });
const input = { kirchensteuerSatz: 0, sparerPauschbetrag: 1000, detailledTranches: [lot('probe')] };
const market = { sKey: 'peak_stable' };

// F3: Der feste Pauschbetrag bleibt beim Teilverkauf vollständig verfügbar.
for (const requested of [1000, 1000 / 0.7, 10000]) {
    const sale = calculateSaleAndTax(requested, input, {}, market, false);
    const expectedGross = requested <= 1000 / 0.7 ? requested : (requested - 1000 * 0.26375) / (1 - 0.7 * 0.26375);
    assertClose(sale.achievedRefill, requested, 1e-8, 'Teilverkauf trifft den Nettoauftrag');
    assertClose(sale.bruttoVerkaufGesamt, expectedGross, 1e-8, 'Brutto folgt der stückweisen Steuerformel');
    assertClose(sale.steuerGesamt, Math.max(0, expectedGross * 0.7 - 1000) * 0.26375, 1e-8, 'Steuer nur auf den Teilgewinn nach SPB');
}
{
    const sale = calculateSaleAndTax(10000, { ...input,
        detailledTranches: [lot('first', { marketValue: 1000 }), lot('second')] }, {}, market, false);
    assertEqual(sale.breakdown.length, 2, 'Teilverkauf nach verbrauchtem ersten Lot');
    assertClose(sale.achievedRefill, 10000, 1e-8, 'Nettoauftrag auch mit verbleibendem Pauschbetrag getroffen');
    assertClose(sale.pauschbetragVerbraucht, 1000, 1e-8, 'Pauschbetrag nur einmal verbraucht');
    const full = calculateSaleAndTax(100000, input, {}, market, false);
    assertEqual(full.bruttoVerkaufGesamt, 100000, 'Bestand begrenzt einen ungedeckten Auftrag');
    const gross = calculateSaleAndTax(10000, input, { forceGrossSellAmount: 15000 }, market, false);
    assertEqual(gross.bruttoVerkaufGesamt, 15000, 'Explizites Bruttoziel bleibt maßgeblich');
}

// F4: Bei gleichem Steuer- und Gewinnfaktor entscheidet das ältere Kaufdatum.
{
    const tranches = [lot('new', { costBasis: 50000, purchaseDate: '2025-01-01', isin: 'SAME' }),
        lot('old', { costBasis: 50000, purchaseDate: '2010-01-01', isin: 'SAME' })];
    const sale = calculateSaleAndTax(10000, { ...input, detailledTranches: tranches }, {}, market, false);
    assertEqual(sale.breakdown[0].trancheId, 'old', 'Älteste Tranche zuerst bei Gleichstand');
    tranches[0].costBasis = 100000;
    const cheaper = calculateSaleAndTax(10000, { ...input, detailledTranches: tranches }, {}, market, false);
    assertEqual(cheaper.breakdown[0].trancheId, 'new', 'Steuerliche Reihenfolge bleibt vor dem Datum');
}

// F1: Schlechte Drei-Topf-Jahre erkennen vorhandene Anleihen.
{
    const bond = lot('bond', { type: 'anleihe', category: 'bonds', costBasis: 100000, tqf: 0 });
    const equity = lot('equity', { costBasis: 100000 });
    const portfolio = { depotTranchesAktien: [equity, bond], depotTranchesGold: [], depotTranchesGeldmarkt: [] };
    const result = applyForcedSaleLiquidityCoverage({ forcedShortfall: 10000, portfolio,
        engineInput: {}, market: { sKey: 'bear_deep' }, is3Bucket: true, isBadYear: true,
        depotTranchesAktien: portfolio.depotTranchesAktien, depotTranchesGold: [],
        equityBeforeForced: 200000, goldBeforeForced: 0, combinedTaxRawAggregate: {}, captureTransactions: true });
    assertEqual(result.didForcedSale, true, 'Notverkauf findet Anleihen');
    assertEqual(result.bondSaleAmountDelta, 10000, 'Anleihen decken die Lücke');
    assertEqual(result.unmetLiquidityDelta, 0, 'Vorhandene Anleihen zählen nicht als Fehlbetrag');
    assertEqual(bond.marketValue, 90000, 'Anleihenbestand sinkt');
    assertEqual(equity.marketValue, 100000, 'Aktien bleiben im schlechten Jahr erhalten');
    const fallback = applyPayoutFallbackSale({ jahresEntnahmeEffektiv: 0, netFloorYear: 5000,
        liquiditaet: 0, payout: 0, is3Bucket: true, isBadYear: true,
        depotTranchesAktien: portfolio.depotTranchesAktien, depotTranchesGold: [] });
    assertEqual(fallback.bondSaleAmountDelta, 5000, 'Auch der Auszahlungs-Fallback erkennt Anleihen');
    assertEqual(bond.marketValue, 85000, 'Fallback reduziert den Anleihentopf');
    assertEqual(equity.marketValue, 100000, 'Fallback schützt Aktien');
}
