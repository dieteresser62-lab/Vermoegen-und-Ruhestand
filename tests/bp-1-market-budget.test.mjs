import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { evaluateBalanceFileInputs } from '../app/balance/balance-file-service.js';
import { prepareMarketPreview, projectMarketPreview, deriveYearEndMarketInputs, compareMarketBudgets } from '../app/balance/balance-market-preview.js';
import { projectAnnualMarketReadings } from '../app/balance/balance-annual-market-preview.js';
import { createMarketReadingsTable } from '../app/balance/balance-market-preview-renderer.js';
import { historyDay, emptyHistorySymbol, mergeDailyPriceResult, DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const json = JSON.stringify;
const prices = (points, queried = null) => {
    const days = points.map(([date]) => historyDay(date));
    return { version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR', days,
        closes: points.map(([, price]) => price), queried: queried ?? [[days[0], days.at(-1)]] } } };
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
    const results = { stored: run(options.inputs), rule: run(p.ruleInputs), high: run(p.highInputs) };
    return { p, results, view: projectMarketPreview(p, results) };
}
const before = json({ context, calculation, records });
const { p, view, results } = project();
assertEqual(p.high.value, 140, 'AR-2: Jahreshoch seit Ende VJ zählt');
assertEqual(p.high.asOf, '2027-01-14', 'Hochdatum gehört zum laufenden Jahr');
assertEqual(p.high.origin, 'stored_close', 'Herkunft gespeicherter Schlusskurs');
assertEqual(json(p.high.coverage), json({ first: '2025-12-31', last: '2027-02-12' }), 'Abdeckung bis zum heutigen Kurs');
assert(Math.abs(view.high.drawdownPct - 26.42857142857143) < 1e-10, '103 liegt etwa 26,4 % unter 140');
assert(Math.abs(p.highInputs.jahreSeitAth - 29 / 365.2425) < 1e-12, 'Zeit seit Januarhoch als Bruchteil von Jahren');
assertEqual(view.rule.market.key, 'side_long', 'Regelphase aus Engine');
assertEqual(view.high.market.key, 'bear_deep', 'Hochreferenzphase aus Engine');
assertEqual(view.comparison.state, 'budget_lower', 'Hochreferenz liefert tatsächlich niedrigeres Budget');
assertEqual(view.comparison.text, 'Budgetentscheidung vor dem Jahresabschluss prüfen', 'Text für niedrigeres Budget');
const withoutHigh = input => Object.fromEntries(Object.entries(input).filter(([key]) => !['ath', 'jahreSeitAth'].includes(key)));
assertEqual(json(withoutHigh(results.rule.input)), json(withoutHigh(results.high.input)), 'Sonstige Engine-Eingaben sind in beiden Varianten identisch');
assertEqual(json(view.comparison.difference), json({ annualBudget: -3600, monthlyBudget: -300, floor: 0, releasedFlex: -3600 }), 'Budgetdifferenzen aus fertigen Ergebnissen');
assertEqual(json(view.comparison.changedParts), json(['flex']), 'Nur Flex ändert sich');
for (const [key, annual, monthly, flex, net, tax, reserve] of [
    ['rule', 60000, 5000, 30000, 89349.53190916814, 650.4680908318529, 179349.53190916814],
    ['high', 56400, 4700, 26400, 35000, 0, 125000]
]) {
    const variant = view.comparison[key];
    assertEqual(variant.floor, 30000, key + ': Grundbedarf');
    assertEqual(variant.annualBudget, annual, key + ': Jahresbudget');
    assertEqual(variant.monthlyBudget, monthly, key + ': Monatsbudget');
    assertEqual(variant.releasedFlex, flex, key + ': freigegebener Flex');
    assertEqual(variant.mainAction.netAmount, net, key + ': Netto derselben Variante');
    assertEqual(variant.tax, tax, key + ': Steuer derselben Variante');
    assertEqual(variant.reserveAfterAction, reserve, key + ': Reserve derselben Variante');
}
const multi = project({ ...context, inputs: deriveYearEndMarketInputs({ ...annualInputs, ath: 140, jahreSeitAth: 351 / 365.2425 }, 104), storedHighAsOf: '2027-01-14',
    dailyPrices: prices([...points, ['2027-12-31', 104], ['2028-02-11', 103]]), today: '2028-02-11', yearEndDate: '2027-12-31' });
assertEqual(multi.p.high.asOf, '2027-01-14', 'Bewusst gespeichertes Hoch bleibt im Folgejahr wirksam');
assertEqual(multi.p.highInputs.ath, 140, 'Gespeicherte Hochwahl bleibt Referenz');
for (const [price, date] of [[145, '2027-02-15'], [140, '2027-02-15']]) {
    const recovered = prepareMarketPreview({ ...context, today: date, dailyPrices: prices([...points, [date, price]]) });
    assertEqual(recovered.high.value, price, 'Höherer oder gleicher Schluss erneuert Referenz');
    assertEqual(recovered.high.asOf, date, 'Bei Gleichstand zählt späteres Datum');
    assertEqual(recovered.highInputs.jahreSeitAth, 0, 'Vollständige Erholung beginnt bei null');
}
const stored = prepareMarketPreview({ ...context, inputs: { ...annualInputs, ath: 150, jahreSeitAth: 2 } });
assertEqual(stored.high.origin, 'stored_ath', 'Höheres Jahresmarkthoch bleibt Referenz');
assertEqual(stored.high.asOf, null, 'Kein erfundenes Datum für gespeichertes ATH');
assertEqual(stored.highInputs.jahreSeitAth, stored.ruleInputs.jahreSeitAth, 'ATH ohne Datum verwendet Regelalter');
const dated = prepareMarketPreview({ ...context, inputs: { ...annualInputs, ath: 150, jahreSeitAth: 2 }, storedHighAsOf: '2024-07-14' });
assertEqual(dated.highInputs.jahreSeitAth, dated.ruleInputs.jahreSeitAth, 'Gleiches ATH behält auch mit belegtem Datum das Regelalter');
const tie = prepareMarketPreview({ ...context, inputs: { ...annualInputs, ath: 140 }, storedHighAsOf: '2027-01-31' });
assertEqual(tie.high.origin, 'stored_ath', 'Späteres Datum der Jahresmarktdaten gewinnt Wertgleichstand');
assertEqual(tie.high.asOf, '2027-01-31', 'Gleichstand behält späteres Jahresmarktdatum');
for (const [close, expected] of [[160, false], [159.8, true]]) {
    const boundary = project({ ...context, inputs: { ...inputs, endeVJ: 180, endeVJ_1: 180, endeVJ_2: 180, endeVJ_3: 180, ath: 180 },
        dailyPrices: prices([['2027-01-14', 200], ['2027-02-12', close]]) });
    assertEqual(boundary.view.high.drawdownPct.toFixed(1), expected ? '20.1' : '20.0', 'Genau 20,0 beziehungsweise 20,1 Prozent');
    assertEqual(boundary.view.high.market.key === 'bear_deep', expected, 'Engine unterscheidet streng größer als 20');
}
const p24 = project({ ...context, inputs: { ...inputs, endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150 },
    dailyPrices: prices([['2026-07-14', 200], ['2026-10-30', 170]]), today: '2026-10-30', yearEndDate: '2025-12-31' });
assertEqual(p24.view.high.high.value, 200, 'p24 unverändert: Hoch 200');
assertEqual(p24.view.high.drawdownPct, 15, 'p24 unverändert: Abstand 15 Prozent');
assertEqual(p24.view.comparison.state, 'budget_same_action_differs', 'p24: gleiches Budget, anderer Verkauf');
assertEqual(p24.view.comparison.rule.monthlyBudget, 5000, 'p24 Regelbudget unverändert');
assertEqual(p24.view.comparison.high.monthlyBudget, 5000, 'p24 Hochreferenzbudget unverändert');
const same = structuredClone(p24.results.high);
same.ui.action = structuredClone(p24.results.rule.ui.action);
same.ui.liquiditaet = structuredClone(p24.results.rule.ui.liquiditaet);
assertEqual(compareMarketBudgets(p24.results.rule, same).state, 'same', 'Andere Marktphase bei gleichem Budget und Handlung: same');
assertEqual(compareMarketBudgets(p24.results.rule, same).text, 'Keine Auswirkung auf die Planung', 'Neutraler Gleichheitstext');
const roundedBudget = structuredClone(same);
roundedBudget.ui.spending.monatlicheEntnahme += 0.01;
assertEqual(compareMarketBudgets(p24.results.rule, roundedBudget).state, 'same', 'Jahres- und Monatsbudgets unter einem halben Euro Unterschied gelten als gleich');
same.ui.action.steuer += 0.01;
assertEqual(compareMarketBudgets(p24.results.rule, same).state, 'same', 'Beträge werden auf ganze Euro verglichen');
same.ui.action.steuer += 1;
assertEqual(compareMarketBudgets(p24.results.rule, same).state, 'budget_same_action_differs', 'Steuerunterschied ist Handlungsunterschied');
const reserve = structuredClone(p24.results.rule);
reserve.input.aktuelleLiquiditaet = (reserve.input.aktuelleLiquiditaet ?? reserve.input.tagesgeld + reserve.input.geldmarktEtf) + 1;
assertEqual(compareMarketBudgets(p24.results.rule, reserve).state, 'budget_same_action_differs', 'Andere Reserve bei gleichem Budget erkannt');
assertEqual(compareMarketBudgets(results.high, results.rule).state, 'budget_higher', 'Umgekehrte Engine-Ergebnisse ergeben höheres Budget');
assertEqual(compareMarketBudgets(results.high, results.rule).text, 'Die zweite Variante ergibt ein höheres Budget – kein Anlass zur Kürzung', 'Höheres Budget ohne Kürzungswarnung');
for (const [dailyPrices, today, reason] of [
    [null, context.today, 'kein Tageskurs seit Jahresende VJ'],
    [prices([['2026-12-31', 105]]), context.today, 'kein Tageskurs seit Jahresende VJ'],
    [context.dailyPrices, '2027-02-23', 'älter als 10 Kalendertage'],
    [prices(points, [[historyDay('2026-12-31'), historyDay('2027-02-12')]]), context.today, 'Kursreihe hat ungeprüfte Tage – Kurse auf der Seite Daten & Sicherung holen']
]) {
    const bad = project({ ...context, dailyPrices, today }).view.comparison;
    assertEqual(bad.state, 'not_reliable', 'Fehlender, alter oder lückenhafter Kurs');
    assert(bad.reason.includes(reason), 'Belastbarkeitsgrund: ' + reason);
}
assert(project({ ...context, today: '2027-02-22' }).view.comparison.state !== 'not_reliable', 'Genau zehn Kalendertage bleiben zulässig');
const table = createMarketReadingsTable(new MockDocument(), [{ label: 'Hochreferenz', reading: p24.view.high }]);
assert(table.textContent.includes('höchster gespeicherter Schlusskurs am 14.07.2026'), 'Ehrliche Schlusskursbezeichnung mit Datum');
assert(table.textContent.includes('(gespeicherte Kurse seit 14.07.2026)'), 'Kurze Historie gegenüber gespeichertem ATH kenntlich');
assert(!table.textContent.includes('Allzeithoch'), 'Speicherwert ohne unbelegte Hochbezeichnung');
const merged = mergeDailyPriceResult(context.dailyPrices, 'VWCE.DE', { currency: 'EUR', days: [historyDay('2027-02-15')], closes: [104], interval: [historyDay('2027-02-13'), historyDay('2027-02-15')] });
assertEqual(json(merged.symbols['VWCE.DE'].days.slice(0, -1)), json(context.dailyPrices.symbols['VWCE.DE'].days), 'Tageskursspeicher entfernt keinen früheren Kurstag');
assertEqual(merged.symbols['VWCE.DE'].closes[1], 140, 'Julihoch bleibt nach neuem Abruf im Speicher');
for (let i = 0; i < 3; i++) project();
assertEqual(json({ context, calculation, records }), before, 'Mehrfachvorschau erhält Speicher, Budgetgedächtnis und Daten bytegleich');

records[DAILY_PRICES_KEY] = json(context.dailyPrices);
const annualBefore = json({ records, calculation });
const annual = await projectAnnualMarketReadings({ targetYear: 2027, quote: { price: 103, asOf: '2027-12-31' }, storage, engineLoader: { load: async () => EngineAPI } });
assertEqual(annual.high.high.value, 140, 'Jahresabschluss nutzt das Hoch seit Ende VJ');
assertEqual(annual.high.high.asOf, '2027-01-14', 'Jahresabschluss erhält das Datum des laufenden Jahres');
assertEqual(annual.high.high.coverage.last, '2027-02-12', 'Jahresendabruf erweitert nicht die gespeicherte Kursabdeckung');
assertEqual(annual.comparison.state, 'not_reliable', 'Jahresabschluss erkennt fehlende Abdeckung bis zur Jahresendquote');
assertEqual(json({ records, calculation }), annualBefore, 'Jahresabschlussvergleich schreibt keine Daten');
records[DAILY_PRICES_KEY] = json(prices([...points, ['2027-12-31', 103]]));
const completeAnnualBefore = json(records);
for (let i = 0; i < 3; i++) {
    const complete = await projectAnnualMarketReadings({ targetYear: 2027, quote: { price: 103, asOf: '2027-12-31' }, storage, engineLoader: { load: async () => EngineAPI } });
    assert(complete.comparison.state !== 'not_reliable', 'Jahresabschluss mit vollständiger Abdeckung liefert Budgetvergleich');
    assertEqual(complete.comparison.rule.monthlyBudget, complete.rule.monthlyBudget, 'Jahresabschluss nutzt dasselbe Regelbudget');
    assertEqual(complete.comparison.high.monthlyBudget, complete.high.monthlyBudget, 'Jahresabschluss nutzt dasselbe Hochreferenzbudget');
}
assertEqual(json(records), completeAnnualBefore, 'Mehrfacher Jahresvergleich lässt echte Records bytegleich');
const fetchedHigh = await projectAnnualMarketReadings({ targetYear: 2027, quote: { price: 160, asOf: '2027-12-31' }, storage, engineLoader: { load: async () => EngineAPI } });
assertEqual(fetchedHigh.high.high.origin, 'stored_close', 'Abrufkurs ersetzt den gespeicherten Schluss am Quote-Tag für die Anzeige');
assertEqual(fetchedHigh.high.high.value, 160, 'Abgerufenes Regelhoch ist die höhere Referenz');
const staleAnnual = await projectAnnualMarketReadings({ targetYear: 2027, quote: { price: 103, asOf: '2027-12-20' }, storage, engineLoader: { load: async () => EngineAPI } });
assertEqual(staleAnnual.comparison.state, 'not_reliable', 'Jahresabschluss prüft Kursalter gegen Abschlussjahresende');
assert(staleAnnual.comparison.reason.includes('älter als 10'), 'Jahresabschluss mit veraltetem Kurs nennt Grund');
const options = { inputData: calculation.inputData, persistentState: calculation.history.persistentState, profiles: calculation.profiles,
    profileId: calculation.profileId, engineApi: EngineAPI, publish: false,
    profilverbundHandlers: { runProfilverbundProfileSimulations: () => null } };
const unclearRecords = { ...records, rs_current_profile: '' };
const unclear = evaluateBalanceFileInputs({ ...options, marketPreviewContext: { calculation, storage: { ...storage, getItem: key => unclearRecords[key] ?? null }, now: new Date('2027-02-12T12:00:00Z') } });
assertEqual(unclear.marketPreview.comparison.state, 'not_reliable', 'Unklarer Jahresstand ohne belastbaren Vergleich');
assert(unclear.marketPreview.comparison.reason.includes('Jahresstand'), 'Unklarer Jahresstand mit Grund');
const savedError = console.error;
try {
    console.error = () => {};
    const failed = await projectAnnualMarketReadings({ targetYear: 2027, quote: { price: 103, asOf: '2027-12-31' }, storage,
        engineLoader: { load: async () => { throw new Error('synthetisch'); } } });
    assertEqual(failed.comparison.state, 'not_reliable', 'Vorschaufehler im Jahresabschluss bleibt Anzeigezustand');
    assert(failed.comparison.reason.includes('nicht verfügbar'), 'Vorschaufehler hat Grund');
} finally { console.error = savedError; }
