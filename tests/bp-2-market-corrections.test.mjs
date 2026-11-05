import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { prepareMarketPreview, projectMarketPreview, compareMarketBudgets } from '../app/balance/balance-market-preview.js';
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
    const results = { stored: run(options.inputs), rule: run(p.ruleInputs), high: run(p.highInputs) };
    return { p, results, view: projectMarketPreview(p, results) };
}
const january = project({ inputs, dailyPrices: prices([['2026-07-14', 160], ['2026-12-30', 140], ['2027-01-14', 170]]),
    today: '2027-01-15', yearEndDate: '2025-12-31', hasAnnualClose: true });
assertEqual(january.p.quote.asOf, '2026-12-30', 'Offener Abschluss verwendet letzten Schluss des Abschlussjahrs');
assert(january.view.comparison.state !== 'not_reliable', '15. Januar: Kurs vom 30. Dezember bleibt zum Abschlussjahr belastbar');
for (const storedHighAsOf of [null, '2026-12-30']) {
    const equal = project({ inputs, dailyPrices: prices([['2026-12-30', 150], ['2027-03-01', 140]]),
        today: '2027-03-01', yearEndDate: '2026-12-31', hasAnnualClose: true, storedHighAsOf });
    assertEqual(equal.p.highInputs.jahreSeitAth, equal.p.ruleInputs.jahreSeitAth, 'Gleiches Hoch verwendet immer Regelalter');
    assertEqual(equal.view.comparison.state, 'same', 'ATH 150 vom 30. Dezember: am 1. März gleiche Varianten');
    assertEqual(equal.view.rule.market.key, equal.view.high.market.key, 'Gleiches Hoch: gleiche Marktphase');
}
const dated = prepareMarketPreview({ inputs: { ...inputs, ath: 170, jahreSeitAth: 2 }, storedHighAsOf: '2024-07-14',
    dailyPrices: prices([['2026-12-30', 150], ['2027-03-01', 140]]), today: '2027-03-01', yearEndDate: '2026-12-31', hasAnnualClose: true });
assertEqual(dated.high.origin, 'stored_ath', 'Höheres gespeichertes ATH bleibt Hochreferenz');
assertEqual(dated.highInputs.jahreSeitAth, dated.ruleInputs.jahreSeitAth, 'Auch belegtes ATH behält bei gleichem Wert das Regelalter');
const gap = prepareMarketPreview({ inputs, dailyPrices: prices([['2026-12-30', 150], ['2027-03-01', 140]], [[historyDay('2027-03-01'), historyDay('2027-03-01')]]),
    today: '2027-03-01', yearEndDate: '2026-12-31', hasAnnualClose: true });
assertEqual(gap.unreliableReason, 'Kursreihe hat ungeprüfte Tage – Kurse auf der Seite Daten & Sicherung holen', 'Lücke nennt Hilfe und zuständige Seite');
const result = run(inputs);
const baseBudget = result.input.renteMonatlich + result.ui.spending.monatlicheEntnahme;
for (const [delta, expected] of [[0.49, 'same'], [0.51, 'budget_higher'], [-0.51, 'budget_lower']]) {
    const high = structuredClone(result); high.ui.spending.monatlicheEntnahme += delta;
    const comparison = compareMarketBudgets(result, high);
    assertEqual(comparison.state, expected, 'Monatsrundung entscheidet: ' + delta);
    for (const variant of [comparison.rule, comparison.high]) assertEqual(variant.annualBudget, variant.monthlyBudget * 12, 'Jahr gleich gerundetem Monat mal zwölf');
    assertEqual(comparison.difference.annualBudget, comparison.difference.monthlyBudget * 12, 'Jahres- und Monatsdifferenz widersprechen sich nicht');
}
const belowFloor = structuredClone(result);
belowFloor.ui.spending.monatlicheEntnahme -= baseBudget - (belowFloor.input.floorBedarf / 12 - 100);
const affected = compareMarketBudgets(result, belowFloor);
assertEqual(affected.state, 'budget_lower', 'Budget unter Grundbedarf ist niedriger');
assert(affected.high.annualBudget < affected.high.floor, 'Probe liegt tatsächlich unter Grundbedarf');
assert(affected.changedParts.includes('floor'), 'Budget unter Grundbedarf meldet floor');
// Abruf ersetzt nur den Schluss seines Tags. Historie, Abdeckung und Records bleiben erhalten.
records[DAILY_PRICES_KEY] = JSON.stringify(prices([['2025-12-31', 100], ['2026-07-14', 200], ['2026-12-31', 250]]));
const before = JSON.stringify(records);
const annual = await projectAnnualMarketReadings({ targetYear: 2026, quote: { price: 170, asOf: '2026-12-31' }, storage,
    engineLoader: { load: async () => EngineAPI } });
assertEqual(annual.high.high.value, 200, 'Korrigierter Abrufkurs verdrängt falsches Hoch am Quote-Tag');
assertEqual(annual.high.high.asOf, '2026-07-14', 'Früheres echtes Hoch bleibt erhalten');
assertEqual(annual.rule.index, 170, 'Regel verwendet denselben Abrufkurs');
assertEqual(annual.high.high.coverage.last, '2026-12-31', 'Abdeckung bleibt der gespeicherte letzte Tag');
assertEqual(JSON.stringify(records), before, 'Abrufkorrektur ist rein lesend');
