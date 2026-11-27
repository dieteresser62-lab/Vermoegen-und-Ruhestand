import { createMusterHaushaltRecords } from '../../app/demo/muster-haushalt.js';
import { annualRecordStorage } from '../../app/balance/balance-annual-storage.js';
import { CONFIG } from '../../app/balance/balance-config.js';
import { DAILY_PRICES_KEY, emptyHistorySymbol, historyDay } from '../../app/tranches/tranchen-history-store.js';

export const stateKey = CONFIG.STORAGE.LS_KEY;
export const fixtureNow = () => new Date('2026-12-30T12:00:00Z');
export function setPrices(records, points) {
    const days = points.map(([date]) => historyDay(date));
    // Abgefragt ab Historienstart wie die Referenzreihe (ATH-1b); sonst wären die Tage davor ungeprüft.
    const start = records.rs_wealth_history_start_v1 ? historyDay(JSON.parse(records.rs_wealth_history_start_v1).startDate) : days[0];
    records[DAILY_PRICES_KEY] = JSON.stringify({ version: 1, symbols: { 'VWCE.DE': {
        ...emptyHistorySymbol(), currency: 'EUR', days, closes: points.map(([, value]) => value),
        queried: [[Math.min(start, days[0]), days.at(-1)]]
    } } });
}
export function changeProfiles(records, update) {
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const [id, profile] of Object.entries(registry.profiles)) update(profile, id);
    records.rs_profiles_v1 = JSON.stringify(registry);
    Object.assign(records, registry.profiles[records.rs_current_profile].data);
}
export function fjFixture(id = 'max-erika') {
    const records = createMusterHaushaltRecords('2026-12-30', id);
    setPrices(records, [['2025-12-31', 150], ['2026-07-14', 200], ['2026-12-30', 170]]);
    return annualRecordStorage(records);
}
