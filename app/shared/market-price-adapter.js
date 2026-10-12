import { getAppTestDate } from './app-clock.js';
import { syntheticQuote, syntheticChart, syntheticAnnualQuote, syntheticSymbol,
    syntheticAnnualInflation, syntheticAnnualCape, SYNTHETIC_MARKET_SOURCE } from './probelauf-prices.js';

/** Die Uhr wird erst vom dauerhaft bestätigten, laufzeitgeprüften Koordinator gesetzt. */
export function isSyntheticPriceMode() { return getAppTestDate() !== null; }
export function marketPriceAdapter(kind, args, provider) {
    const date = getAppTestDate();
    if (date === null) return provider();
    if (kind === 'quote') return syntheticQuote(args.symbol, date);
    if (kind === 'chart') return syntheticChart(args.symbol, args.interval, date);
    if (kind === 'annual') return { ...syntheticAnnualQuote(args.symbol, args.year, date), source: SYNTHETIC_MARKET_SOURCE };
    if (kind === 'inflation') return syntheticAnnualInflation(args.year, date);
    if (kind === 'cape') return syntheticAnnualCape(args.year, date);
    if (kind === 'search') {
        try { return syntheticSymbol(args.query); } catch { return null; }
    }
    if (kind === 'health') return { synthetic: true };
    throw new Error('Unbekannter Kursweg.');
}
