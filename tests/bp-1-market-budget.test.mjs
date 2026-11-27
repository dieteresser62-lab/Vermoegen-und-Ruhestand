import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { evaluateBalanceInputs } from '../app/balance/balance-evaluation.js';
import { prepareMarketPreview, projectMarketPreview, deriveYearEndMarketInputs } from '../app/balance/balance-market-preview.js';
import { projectAnnualMarketReadings } from '../app/balance/balance-annual-market-preview.js';
import { marketHighRows } from '../app/balance/balance-market-preview-renderer.js';
import { historyDay, emptyHistorySymbol, mergeDailyPriceResult, DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';

const json = JSON.stringify;
const prices = (points, queried = null) => {
    const days = points.map(([date]) => historyDay(date));
    return { version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR', days,
        // Wie die Referenzreihe ab Historienstart abgefragt (Muster-Haushalt: 01.01.2025, ATH-1b).
        closes: points.map(([, price]) => price), queried: queried ?? [[Math.min(days[0], historyDay('2025-01-01')), days.at(-1)]] } } };
};
const records = createMusterHaushaltRecords('2026-10-30', 'max-erika');
const registry = JSON.parse(records.rs_profiles_v1);
for (const profile of Object.values(registry.profiles)) {
    const state = JSON.parse(profile.data.ruhestandsmodellValues_v29_guardrails);
    state.inputs = { ...state.inputs, ath: 105, jahreSeitAth: 0 };
    state.profilverbundHouseholdInputs = { ...state.profilverbundHouseholdInputs, ath: 105, jahreSeitAth: 0 };
    for (const [key, value] of Object.entries({ ath: 105, jahreSeitAth: 0 })) (state.balanceInputFields ||= {})[key] = { value: String(value), checked: false };
    profile.data.ruhestandsmodellValues_v29_guardrails = json(state);
}
records.rs_profiles_v1 = json(registry);
records.ruhestandsmodellValues_v29_guardrails = registry.profiles[records.rs_current_profile].data.ruhestandsmodellValues_v29_guardrails;
const storage = { getItem: key => records[key] ?? null, key: i => Object.keys(records)[i] ?? null,
    get length() { return Object.keys(records).length; } };
const calculation = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
const run = market => {
    const result = EngineAPI.simulateSingleYear({ ...structuredClone(calculation.engineInput), ...market }, structuredClone(calculation.engineLastState));
    assert(!result.error, 'Echte Engine rechnet erfolgreich');
    return result;
};
const inputs = { endeVJ: 100, endeVJ_1: 95, endeVJ_2: 90, endeVJ_3: 85, ath: 100, jahreSeitAth: 0 };
const points = [['2025-12-31', 100], ['2026-07-14', 140], ['2026-12-31', 105], ['2027-01-14', 140], ['2027-02-12', 103]];
const annualInputs = deriveYearEndMarketInputs(inputs, 105);
const context = { inputs: annualInputs, dailyPrices: prices(points), today: '2027-02-12', yearEndDate: '2026-12-31', hasAnnualClose: true };
function project(options = context) {
    const p = prepareMarketPreview(options);
    const result = run(p.marketInputs);
    return { p, result, view: projectMarketPreview(p, result) };
}
const before = json({ context, calculation, records });
const { p, view } = project();
// FR-89: alle gespeicherten Tagesschlüsse bis zum Stichtag zählen; bei Gleichstand (14.07.2026 und 14.01.2027) der jüngste Tag.
assertEqual(p.high.value, 140, 'ATH-1: Tageshoch zählt');
assertEqual(p.high.asOf, '2027-01-14', 'Gleicher Höchstwert: jüngster Tag');
assertEqual(p.high.origin, 'daily_close', 'Herkunft gespeicherter Tagesschluss');
assert(Math.abs(view.drawdownPct - 26.42857142857143) < 1e-10, '103 liegt etwa 26,4 % unter 140');
assert(Math.abs(p.marketInputs.jahreSeitAth - 29 / 365.2425) < 1e-12, 'Zeit seit Januarhoch als Bruchteil von Jahren');
assertEqual(view.market.key, 'bear_deep', 'Marktlage aus Engine');
assert(view.deepBear.cutActive && view.deepBear.threshold === 112, 'Kursschwelle 112 erreicht, Kürzung aktiv');
const multi = project({ ...context, inputs: deriveYearEndMarketInputs({ ...annualInputs, ath: 140, jahreSeitAth: 351 / 365.2425 }, 104), storedHighAsOf: '2027-01-14',
    dailyPrices: prices([...points, ['2027-12-31', 104], ['2028-02-11', 103]]), today: '2028-02-11', yearEndDate: '2027-12-31' });
assertEqual(json(multi.p.high), json({ value: 140, asOf: '2027-01-14', origin: 'stored', dated: true, source: 'daily', splitAsOf: null }), 'Gespeichertes Hoch mit Datum bleibt im Folgejahr wirksam');
// Gutachten P2-3: Mit belegtem Datum zählt das Alter bis zum Kursdatum (14.01.2027 bis 11.02.2028 = 393 Tage), nicht nach Jahresendregel.
assertEqual(multi.p.marketInputs.jahreSeitAth, 393 / 365.2425, 'Gespeichertes Hoch mit Datum altert bis zum Kursdatum');
for (const [price, date] of [[145, '2027-02-15'], [140, '2027-02-15']]) {
    const recovered = prepareMarketPreview({ ...context, today: date, dailyPrices: prices([...points, [date, price]]) });
    assertEqual(recovered.high.value, price, 'Höherer oder gleicher Schluss erneuert das Hoch');
    assertEqual(recovered.high.asOf, date, 'Bei Gleichstand zählt späteres Datum');
    assertEqual(recovered.marketInputs.jahreSeitAth, 0, 'Vollständige Erholung beginnt bei null');
}
const stored = prepareMarketPreview({ ...context, inputs: { ...annualInputs, ath: 150, jahreSeitAth: 2 } });
assertEqual(json(stored.high), json({ value: 150, asOf: '2024-12-31', origin: 'stored', dated: false, source: 'stored', splitAsOf: null }), 'Höheres gespeichertes Hoch bleibt; Datum nach <Jahr − jahreSeitAth>-12-31');
assertEqual(stored.marketInputs.jahreSeitAth, 3, 'Gespeichertes Hoch ohne Datum verwendet Regelalter');
const dated = prepareMarketPreview({ ...context, inputs: { ...annualInputs, ath: 150, jahreSeitAth: 2 }, storedHighAsOf: '2024-07-14' });
// Gutachten P2-3: 14.07.2024 bis 12.02.2027 = 943 Tage statt Regelalter 3.
assertEqual(dated.marketInputs.jahreSeitAth, 943 / 365.2425, 'Gleiches Hoch mit belegtem Datum zählt das Alter bis zum Kursdatum');
const tie = prepareMarketPreview({ ...context, inputs: { ...annualInputs, ath: 140 }, storedHighAsOf: '2027-01-31' });
assertEqual(tie.high.origin, 'stored', 'Späteres Datum des gespeicherten Hochs gewinnt den Wertgleichstand');
assertEqual(tie.high.asOf, '2027-01-31', 'Gleichstand behält das spätere gespeicherte Datum');
for (const [close, expected] of [[160, false], [159.8, true]]) {
    const boundary = project({ ...context, inputs: { ...inputs, endeVJ: 180, endeVJ_1: 180, endeVJ_2: 180, endeVJ_3: 180, ath: 180 },
        dailyPrices: prices([['2027-01-14', 200], ['2027-02-12', close]]) });
    assertEqual(boundary.view.drawdownPct.toFixed(1), expected ? '20.1' : '20.0', 'Genau 20,0 beziehungsweise 20,1 Prozent');
    assertEqual(boundary.view.market.key === 'bear_deep', expected, 'Engine unterscheidet streng größer als 20');
}
const p24 = project({ ...context, inputs: { ...inputs, endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150 },
    dailyPrices: prices([['2026-07-14', 200], ['2026-10-30', 170]]), today: '2026-10-30', yearEndDate: '2025-12-31' });
assertEqual(p24.view.high.value, 200, 'p24 unverändert: Hoch 200');
assertEqual(p24.view.drawdownPct, 15, 'p24 unverändert: Abstand 15 Prozent');
for (const [dailyPrices, today, reason] of [
    [null, context.today, 'kein Tageskurs seit Jahresende VJ'],
    [prices([['2026-12-31', 105]]), context.today, 'kein Tageskurs seit Jahresende VJ'],
    [context.dailyPrices, '2027-02-23', 'älter als 10 Kalendertage'],
    [prices(points, [[historyDay('2026-12-31'), historyDay('2027-02-12')]]), context.today, 'Kursreihe hat ungeprüfte Tage – Kurse auf der Seite Daten & Sicherung holen']
]) {
    const bad = project({ ...context, dailyPrices, today }).view;
    assert(String(bad.unreliableReason).includes(reason), 'Fehlender, alter oder lückenhafter Kurs: ' + reason);
}
assertEqual(project({ ...context, today: '2027-02-22' }).view.unreliableReason, null, 'Genau zehn Kalendertage bleiben zulässig');
assertEqual(Object.fromEntries(marketHighRows(p24.view)).Allzeithoch, '200,00 € · Tagesschluss vom 14.07.2026', 'Ehrliche Schlusskursbezeichnung mit Datum');
const merged = mergeDailyPriceResult(context.dailyPrices, 'VWCE.DE', { currency: 'EUR', days: [historyDay('2027-02-15')], closes: [104], interval: [historyDay('2027-02-13'), historyDay('2027-02-15')] });
assertEqual(json(merged.symbols['VWCE.DE'].days.slice(0, -1)), json(context.dailyPrices.symbols['VWCE.DE'].days), 'Tageskursspeicher entfernt keinen früheren Kurstag');
assertEqual(merged.symbols['VWCE.DE'].closes[1], 140, 'Julihoch bleibt nach neuem Abruf im Speicher');
for (let i = 0; i < 3; i++) project();
assertEqual(json({ context, calculation, records }), before, 'Mehrfachvorschau erhält Speicher, Budgetgedächtnis und Daten bytegleich');

records[DAILY_PRICES_KEY] = json(context.dailyPrices);
const annualBefore = json({ records, calculation });
const annual = await projectAnnualMarketReadings({ targetYear: 2027, quote: { price: 103, asOf: '2027-12-31' }, storage, engineLoader: { load: async () => EngineAPI } });
assertEqual(annual.high.value, 140, 'Jahresabschluss nutzt das Tageshoch');
assertEqual(annual.high.asOf, '2027-01-14', 'Jahresabschluss erhält das Datum des Hochs');
assert(String(annual.unreliableReason).includes('ungeprüfte Tage'), 'Jahresabschluss erkennt fehlende Abdeckung bis zur Jahresendquote');
assertEqual(json({ records, calculation }), annualBefore, 'Jahresabschlussanzeige schreibt keine Daten');
records[DAILY_PRICES_KEY] = json(prices([...points, ['2027-12-31', 103]]));
const completeAnnualBefore = json(records);
for (let i = 0; i < 3; i++) {
    const complete = await projectAnnualMarketReadings({ targetYear: 2027, quote: { price: 103, asOf: '2027-12-31' }, storage, engineLoader: { load: async () => EngineAPI } });
    assertEqual(complete.unreliableReason, null, 'Jahresabschluss mit vollständiger Abdeckung ist belastbar');
    assertEqual(complete.inputs.jahreSeitAth, (historyDay('2027-12-31') - historyDay('2027-01-14')) / 365.2425, 'Jahresabschluss: Alter bis zum 31.12.');
}
assertEqual(json(records), completeAnnualBefore, 'Mehrfache Jahresanzeige lässt echte Records bytegleich');
const fetchedHigh = await projectAnnualMarketReadings({ targetYear: 2027, quote: { price: 160, asOf: '2027-12-31' }, storage, engineLoader: { load: async () => EngineAPI } });
assertEqual(fetchedHigh.high.origin, 'quote', 'Abrufkurs über allen Schlüssen ist das Hoch');
assertEqual(fetchedHigh.high.value, 160, 'Abgerufenes Hoch ist die höhere Referenz');
const staleAnnual = await projectAnnualMarketReadings({ targetYear: 2027, quote: { price: 103, asOf: '2027-12-20' }, storage, engineLoader: { load: async () => EngineAPI } });
assert(String(staleAnnual.unreliableReason).includes('älter als 10'), 'Jahresabschluss prüft Kursalter gegen Abschlussjahresende');
const options = { inputData: calculation.inputData, persistentState: calculation.history.persistentState, profiles: calculation.profiles,
    profileId: calculation.profileId, engineApi: EngineAPI, publish: false,
    profilverbundHandlers: { runProfilverbundProfileSimulations: () => null } };
const unclearRecords = { ...records, rs_current_profile: '' };
const unclear = evaluateBalanceInputs({ ...options, marketPreviewContext: { calculation, storage: { ...storage, getItem: key => unclearRecords[key] ?? null }, now: new Date('2027-02-12T12:00:00Z') } });
assert(unclear.marketPreview.withoutQuote && unclear.marketPreview.unreliableReason.includes('Jahresstand'), 'Unklarer Jahresstand ohne Vorschau, mit Grund');
const savedError = console.error;
try {
    console.error = () => {};
    const failed = await projectAnnualMarketReadings({ targetYear: 2027, quote: { price: 103, asOf: '2027-12-31' }, storage,
        engineLoader: { load: async () => { throw new Error('synthetisch'); } } });
    assert(failed.withoutQuote && failed.unreliableReason.includes('nicht verfügbar'), 'Vorschaufehler im Jahresabschluss bleibt Anzeigezustand mit Grund');
} finally { console.error = savedError; }
