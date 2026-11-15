import { getAppTestDate } from './app-clock.js';
import { syntheticQuote, syntheticChart, syntheticAnnualQuote, syntheticSymbol, syntheticSearch,
    syntheticAnnualInflation, syntheticAnnualCape, SYNTHETIC_MARKET_SOURCE } from './probelauf-prices.js';

/** Die Uhr wird erst vom dauerhaft bestätigten, laufzeitgeprüften Koordinator gesetzt.
 *
 * @returns {boolean} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function isSyntheticPriceMode() { return getAppTestDate() !== null; }
/**
 * @param kind Wert für den bestehenden Aufrufvertrag.
 * @param args Wert für den bestehenden Aufrufvertrag.
 * @param provider Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
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
    // VK-2: strukturierte Trefferliste für die Kursprüfung beim Kauf.
    if (kind === 'searchList') return { quotes: syntheticSearch(args.query) };
    if (kind === 'health') return { synthetic: true };
    throw new Error('Unbekannter Kursweg.');
}
