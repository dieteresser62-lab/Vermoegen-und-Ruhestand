import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { prepareMarketPreview, projectMarketPreview } from '../app/balance/balance-market-preview.js';
import { projectAnnualMarketReadings } from '../app/balance/balance-annual-market-preview.js';
import { historyDay, emptyHistorySymbol, DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';

const records = createMusterHaushaltRecords('2026-12-15', 'max-erika');
const storage = { getItem: key => records[key] ?? null };
const calculation = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
const inputs = { endeVJ: 140, endeVJ_1: 135, endeVJ_2: 130, endeVJ_3: 125, ath: 150, jahreSeitAth: 0 };
const prices = (points, queried) => {
    const days = points.map(([date]) => historyDay(date));
    return { version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR', days,
        closes: points.map(([, price]) => price), queried: queried ?? [[days[0], days.at(-1)]] } } };
};
const run = market => {
    const result = EngineAPI.simulateSingleYear({ ...structuredClone(calculation.engineInput), ...market }, structuredClone(calculation.engineLastState));
    assert(!result.error, 'Engine-Vergleich erfolgreich'); return result;
};
function project(options) {
    const p = prepareMarketPreview(options);
    return { p, view: projectMarketPreview(p, run(p.marketInputs)) };
}
const january = project({ inputs, dailyPrices: prices([['2026-07-14', 160], ['2026-12-30', 140], ['2027-01-14', 170]]),
    today: '2027-01-15', yearEndDate: '2025-12-31', hasAnnualClose: true });
assertEqual(january.p.quote.asOf, '2026-12-30', 'Offener Abschluss verwendet letzten Schluss des Abschlussjahrs');
assertEqual(january.view.unreliableReason, null, '15. Januar: Kurs vom 30. Dezember bleibt zum Abschlussjahr belastbar');
assertEqual(january.p.high.value, 160, 'Januarhoch des Folgejahrs zählt nicht, das Julihoch schon');
for (const storedHighAsOf of [null, '2026-12-30']) {
    const equal = project({ inputs, dailyPrices: prices([['2026-12-30', 150], ['2027-03-01', 140]]),
        today: '2027-03-01', yearEndDate: '2026-12-31', hasAnnualClose: true, storedHighAsOf });
    // Ohne belegtes Datum gilt das Regelalter; mit Datum zählt es bis zum Kursdatum (30.12.2026 bis 01.03.2027 = 61 Tage, Gutachten P2-3).
    assertEqual(equal.p.marketInputs.jahreSeitAth, storedHighAsOf ? 61 / 365.2425 : 1, 'Gleiches Hoch am Jahresende: Regelalter nur ohne Datum');
    // Gleicher Schluss am belegten Tag oder vor dem abgeleiteten 31.12.: das gespeicherte Hoch bleibt.
    assertEqual(equal.p.high.origin, 'stored', 'Gleicher Schluss am 30.12. ändert das gespeicherte Hoch nicht');
}
const dated = prepareMarketPreview({ inputs: { ...inputs, ath: 170, jahreSeitAth: 2 }, storedHighAsOf: '2024-07-14',
    dailyPrices: prices([['2026-12-30', 150], ['2027-03-01', 140]]), today: '2027-03-01', yearEndDate: '2026-12-31', hasAnnualClose: true });
assertEqual(dated.high.origin, 'stored', 'Höheres gespeichertes Hoch bleibt');
// Gutachten P2-3: 14.07.2024 bis 01.03.2027 = 960 Tage statt Regelalter 3.
assertEqual(dated.marketInputs.jahreSeitAth, 960 / 365.2425, 'Belegtes Hoch zählt sein Alter bis zum Kursdatum');
const gap = prepareMarketPreview({ inputs, dailyPrices: prices([['2026-12-30', 150], ['2027-03-01', 140]], [[historyDay('2027-03-01'), historyDay('2027-03-01')]]),
    today: '2027-03-01', yearEndDate: '2026-12-31', hasAnnualClose: true });
assertEqual(gap.unreliableReason, 'Kursreihe hat ungeprüfte Tage – Kurse auf der Seite Daten & Sicherung holen', 'Lücke nennt Hilfe und zuständige Seite');
// Abruf ersetzt nur den Schluss seines Tags. Historie, Abdeckung und Records bleiben erhalten.
records[DAILY_PRICES_KEY] = JSON.stringify(prices([['2025-12-31', 100], ['2026-07-14', 200], ['2026-12-31', 250]]));
const before = JSON.stringify(records);
const annual = await projectAnnualMarketReadings({ targetYear: 2026, quote: { price: 170, asOf: '2026-12-31' }, storage,
    engineLoader: { load: async () => EngineAPI } });
assertEqual(annual.high.value, 200, 'Korrigierter Abrufkurs verdrängt falsches Hoch am Quote-Tag');
assertEqual(annual.high.asOf, '2026-07-14', 'Früheres echtes Hoch bleibt erhalten');
assertEqual(annual.index, 170, 'Jahresende verwendet denselben Abrufkurs');
assertEqual(JSON.stringify(records), before, 'Abrufkorrektur ist rein lesend');
