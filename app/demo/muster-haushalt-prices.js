import { addDirectHouseholdPlans } from '../profile/household-plan-migration.js';
import { parseCalendarDate } from '../shared/app-clock.js';
import { syntheticQuote, syntheticChart, syntheticDay } from '../shared/probelauf-prices.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';

export function validateMusterTestDate(testDate) {
    const now = parseCalendarDate(testDate);
    if (testDate < '2026-01-01') throw new Error('Der Muster-Haushalt ist ab 01.01.2026 verfügbar.');
    return now;
}

/** Neue Kursgeneration für Kopie/Datumssprung; keine Veränderung bestätigter Abschlüsse. */
export function rebuildSyntheticPriceRecords(records, testDate) {
    const next = { ...records };
    const registry = records.rs_profiles_v1 ? JSON.parse(records.rs_profiles_v1) : null;
    const active = records.rs_active_profile;
    const start = records.rs_wealth_history_start_v1 ? JSON.parse(records.rs_wealth_history_start_v1).startDate : null;
    const prices = { version: 1, symbols: {} };
    const projectLots = raw => JSON.stringify(normalizeTrancheCollection(JSON.parse(raw || '[]'), { mode: 'persisted' }).map(lot => {
        if (!lot.ticker && !lot.isin) { const copy = { ...lot, currentPrice: lot.purchasePrice }; delete copy.asOf; return copy; }
        let quote;
        try { quote = syntheticQuote(lot.ticker || lot.isin, testDate); }
        catch { const copy = { ...lot, currentPrice: lot.purchasePrice }; delete copy.asOf; return copy; }
        if (start && start <= testDate && !prices.symbols[quote.symbol]) {
            const chart = syntheticChart(quote.symbol, [syntheticDay(start), syntheticDay(testDate)], testDate);
            prices.symbols[quote.symbol] = { currency: 'EUR', days: chart.days, closes: chart.closes,
                queried: [chart.interval], failures: 0, lastError: null };
        }
        return { ...lot, ticker: quote.symbol, currentPrice: quote.price, asOf: quote.asOf };
    }));
    if (registry) {
        for (const [id, profile] of Object.entries(registry.profiles)) {
            const raw = id === active ? records.depot_tranchen : profile.data.depot_tranchen;
            if (raw !== undefined) profile.data.depot_tranchen = projectLots(raw);
            if (id === active && raw !== undefined) next.depot_tranchen = profile.data.depot_tranchen;
        }
        next.rs_profiles_v1 = JSON.stringify(registry);
    } else if (records.depot_tranchen !== undefined) next.depot_tranchen = projectLots(records.depot_tranchen);
    next.rs_daily_prices_v1 = JSON.stringify(prices);
    return addDirectHouseholdPlans(next, { now: () => parseCalendarDate(testDate) });
}

