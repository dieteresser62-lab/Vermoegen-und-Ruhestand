import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { createProfilverbundHandlers } from '../app/balance/balance-main-profilverbund.js';
import { evaluateBalanceFileInputs } from '../app/balance/balance-file-service.js';
import { deriveYearEndMarketInputs, prepareMarketPreview, projectMarketPreview } from '../app/balance/balance-market-preview.js';
import { DAILY_PRICES_KEY, emptyHistorySymbol, historyDay, assertDailyPrices } from '../app/tranches/tranchen-history-store.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { persistBalanceUpdate } from '../app/balance/balance-update-pipeline.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { syntheticChart } from '../app/shared/probelauf-prices.js';

const json = JSON.stringify;
const inputs = { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 };
const prices = (points, currency = 'EUR') => assertDailyPrices({ version: 1, symbols: { 'VWCE.DE': {
    ...emptyHistorySymbol(), currency, days: points.map(([date]) => historyDay(date)), closes: points.map(([, price]) => price)
} } });
const dailyPrices = prices([['2025-12-30', 140], ['2026-07-14', 200], ['2026-10-30', 170], ['2026-11-02', 999]]);
const context = { inputs, dailyPrices, today: '2026-10-30', yearEndDate: '2025-12-31', hasAnnualClose: false };
const records = createMusterHaushaltRecords('2026-10-30', 'max-erika');
const storage = { getItem: key => records[key] ?? null, key: i => Object.keys(records)[i] ?? null,
    setItem: (key, value) => { records[key] = value; }, removeItem: key => { delete records[key]; }, get length() { return Object.keys(records).length; } };
const calculation = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
const run = market => {
    const result = EngineAPI.simulateSingleYear({ ...calculation.engineInput, ...market }, calculation.engineLastState);
    assert(!result.error, 'Musterrechnung erfolgreich');
    return result;
};
const prepared = prepareMarketPreview(context), bytes = json({ context, calculation, records });
const results = { stored: run(inputs), rule: run(prepared.ruleInputs), high: run(prepared.highInputs) };
const view = projectMarketPreview(prepared, results);
assertEqual(json(prepared.ruleInputs), json({ endeVJ: 170, endeVJ_1: 150, endeVJ_2: 140, endeVJ_3: 120, ath: 170, jahreSeitAth: 0 }), 'Genau einmal nachgerückte Jahresendstände');
assertEqual(view.rule.market.key, 'peak_hot', 'Regel: Markt heiß gelaufen');
assertEqual(view.rule.market.text, 'Markt heiß gelaufen', 'Markttext kommt aus Engine');
assertEqual(view.rule.monthlyBudget, 5000, 'Regelbudget Max und Erika: 5.000 EUR');
assertEqual(view.rule.mainAction.type, 'TRANSACTION', 'Regelaktion aus Engine');
assertEqual(view.rule.mainAction.text, 'Aktien verkaufen', 'Regelaktion: Verkauf');
assert(Math.abs(view.rule.mainAction.netAmount - 89349.53190916814) < 1e-8, 'Regelverkauf 89.349,53 EUR netto vor persönlicher Attribution');
assertEqual(view.high.high.value, 200, 'Jahreshoch 200');
assertEqual(view.high.high.asOf, '2026-07-14', 'Höchster Schluss mit Datum; zukünftige Kurse ausgeschlossen');
assertEqual(view.high.drawdownPct, 15, '15 % unter dem höchsten Schlusskurs');
assert(Math.abs(view.high.monthsSinceHigh - 3.548327481057106) < 1e-12, '108 Tage / (365,2425 / 12) ergeben etwa 3,5 Monate');
assertEqual(results.high.input.jahreSeitAth, prepared.highInputs.jahreSeitAth, 'Validator und Normalisierung erhalten den Bruchteil');
assertEqual(view.high.market.key, 'corr_young', 'Hochvariante: Junge Korrektur');
assertEqual(view.high.monthlyBudget, 5000, 'Budget der Hochvariante: 5.000 EUR');
assertEqual(view.high.mainAction.netAmount, 35000, 'Verkauf der Hochvariante 35.000 EUR netto');
assertEqual(EngineAPI.analyzeMarket({ ...prepared.highInputs, inflation: 0, jahreSeitAth: 0 }).sKey, 'recovery', 'Genau 0 würde zwölf Monate und Erholung ergeben');
assertEqual(view.rule.deepBear.threshold, 120, 'AR-2: Regelschwelle aus gespeichertem Hoch 150');
assertEqual(view.rule.deepBear.remainingDeclinePct.toFixed(1), '29.4', 'AR-2: Restabstand vom Stichtagskurs 170');
assertEqual(view.high.deepBear.threshold, 160, 'höchster Schlusskurs: Index streng unter 160');
assertEqual(view.high.deepBear.remainingDeclinePct.toFixed(1), '5.9', 'höchster Schlusskurs: noch 5,9 % Kursrückgang');
assertEqual(view.rule.changeSinceYearEndPct.toFixed(1), '13.3', 'Seit Jahresende VJ +13,3 %');
assertEqual(view.readingsEqual, false, 'Gleiches Budget allein macht Lesarten nicht gleich');
assertEqual(view.withoutAnnualClose, true, 'Erstes Planungsjahr markiert');
assertEqual(view.storedLabel, 'Jahresmarktdaten Ende VJ', 'Gespeicherte Spalte ohne Jahresabschluss');
assertEqual(view.stored.market.key, 'peak_stable', 'Gespeicherte Marktlage von Engine berechnet');
assertEqual(view.rule.high.origin, 'rule_high', 'Neues Regelhoch als Herkunft');
assertEqual(view.high.high.origin, 'stored_close', 'Gespeicherter Schluss als Herkunft');
assertEqual(json({ context, calculation, records }), bytes, 'Ableitung und Projektion erhalten alle Eingaben und Speicherbytes');
for (const price of [150, 149, 151]) {
    const derived = deriveYearEndMarketInputs({ ...inputs, jahreSeitAth: 2 }, price);
    assertEqual(derived.jahreSeitAth, price >= 150 ? 0 : 3, 'Jahresregel bei Gleichstand, Rückgang und neuem Hoch');
    assertEqual(derived.ath, Math.max(150, price), 'Jahresregel hält das historische Hoch');
}
for (const dailyPrices of [null, { version: 1, symbols: {} }, prices([['2026-11-02', 999]]), prices([['2026-10-30', 170]], 'USD')]) {
    const p = prepareMarketPreview({ ...context, dailyPrices });
    const fallback = projectMarketPreview(p, { stored: results.stored, rule: results.stored, high: results.stored });
    assertEqual(fallback.withoutQuote, true, 'Ohne verwertbaren EUR-Schluss keine neue Rechnung');
    assertEqual(json(p.ruleInputs), json(inputs), 'Ohne Kurs kein Nachrücken');
    assertEqual(fallback.readingsEqual, true, 'Ohne Kurs beide Lesarten gleich');
    assertEqual(fallback.rule.monthlyBudget, view.stored.monthlyBudget, 'Ohne Kurs bisheriges Budget');
}
const january = prepareMarketPreview({ ...context, today: '2027-01-12', dailyPrices: prices([
    ['2026-07-14', 200], ['2026-12-30', 175], ['2027-01-08', 250]]) });
assertEqual(january.quote.asOf, '2026-12-30', 'Januar vor Abschluss nutzt letzten Schluss bis Ende Abschlussjahr');
assertEqual(january.yearlyHigh.price, 200, 'Januarhoch des Folgejahrs ausgeschlossen');
const equalHigh = prepareMarketPreview({ ...context, dailyPrices: prices([['2026-07-14', 170], ['2026-10-30', 170]]) });
assertEqual(equalHigh.high.origin, 'stored_close', 'Gleichstand zum Regelhoch belegt den gespeicherten Schluss');
const equalView = projectMarketPreview(equalHigh, { stored: results.stored, rule: run(equalHigh.ruleInputs), high: run(equalHigh.highInputs) });
assertEqual(equalView.readingsEqual, true, 'Gleiche Marktlage und gleiches Budget setzen Merker auch mit Kurs');
const confirmedView = projectMarketPreview({ ...prepared, hasAnnualClose: true }, results);
assertEqual(confirmedView.storedLabel, 'Plan 2026 / Januar', 'Spaltenjahr folgt gespeichertem Jahresende');
assertEqual(confirmedView.withoutAnnualClose, false, 'Jahresabschluss vorhanden');
const repeated = prepareMarketPreview({ ...context, dailyPrices: prices([['2026-07-14', 200], ['2026-09-01', 200], ['2026-10-30', 170]]) });
assertEqual(repeated.high.asOf, '2026-09-01', 'Jüngster Tag mit gleichem höchsten Schlusskurs');
const older = prepareMarketPreview({ ...context, inputs: { ...inputs, ath: 210, jahreSeitAth: 2 } });
assertEqual(older.highInputs.ath, 210, 'höchster Schlusskurs unter historischem ATH ändert zweite Lesart nicht');
assertEqual(older.highInputs.jahreSeitAth, 3, 'Alter des historischen ATH wie Jahresregel');
assertEqual(older.high.asOf, null, 'Historisches Jahreshoch ohne belegtes Datum bleibt undatiert');
for (const price of [160, 159.99]) {
    const p = prepareMarketPreview({ ...context, dailyPrices: prices([['2026-07-14', 200], ['2026-10-30', price]]) });
    const r = run(p.highInputs), v = projectMarketPreview(p, { stored: results.stored, rule: run(p.ruleInputs), high: r });
    assertEqual(v.high.deepBear.reached, price < 160, 'Bärengrenze streng größer als 20 % Drawdown');
}

// Produktiver Adapter mit persönlicher Steuerzuordnung; Speicherzweig erhält die Jahresbasis.
const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
state.inputs = { ...state.inputs, ...inputs };
for (const [key, value] of Object.entries(inputs)) (state.balanceInputFields ||= {})[key] = { value: String(value), checked: false };
records[CONFIG.STORAGE.LS_KEY] = json(state);
records[DAILY_PRICES_KEY] = json(dailyPrices);
const c = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
const calls = [], publication = [];
const api = { ...EngineAPI, simulateSingleYear(input, lastState) {
    calls.push(structuredClone({ input, lastState })); return EngineAPI.simulateSingleYear(input, lastState);
} };
const handlers = createProfilverbundHandlers({ dom: {}, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
const options = { inputData: c.inputData, persistentState: c.history.persistentState, profiles: c.profiles,
    profileId: c.profileId, engineApi: api, planInputs: c.householdPlan.entry.values, publish: false,
    profilverbundHandlers: { runProfilverbundProfileSimulations: (input, profiles, state, { publish = false } = {}) => {
        publication.push(publish);
        return handlers.runProfilverbundProfileSimulations(input, profiles, state,
            { engineApi: api, publish, withdrawalMode: c.householdPlan.entry.values.householdWithdrawalMode });
    } } };
const before = json(records), baseOptions = json({ ...options, engineApi: null, profilverbundHandlers: null });
const evaluation = evaluateBalanceFileInputs({ ...options, marketPreviewContext: { calculation: c, storage, now: new Date('2026-10-30T12:00:00Z') } });
assertEqual(calls.length, 3, 'Basis sowie zwei unabhängige Engineaufrufe');
assertEqual(json(calls[1].input.endeVJ), '170', 'Operative Vorschau nutzt Regelkurs');
assertEqual(calls[2].input.ath, 200, 'Zweiter Vorschauaufruf nutzt höchsten Schlusskurs');
assertEqual(json(calls[0].lastState), json(calls[1].lastState), 'Gleiche Historie für Basis und Regel');
assertEqual(json(calls[1].lastState), json(calls[2].lastState), 'höchster Schlusskurs setzt nicht auf Regel-Ergebniszustand auf');
assertEqual(json(publication), json([false, false, false]), 'Lesende Aufrufe veröffentlichen keine Profilaktionen');
assertEqual(evaluation.previewInputData.endeVJ, 170, 'Renderer erhält Regeldaten');
assertEqual(evaluation.persistenceEvaluation.profilverbundRuns.householdInput.endeVJ, 150, 'Persistenz erhält ursprüngliche Jahresmarktdaten');
assertEqual(evaluation.modelResult.ui.market.sKey, 'peak_hot', 'Bestehende Empfehlung rechnet nach Regel');
assertEqual(evaluation.marketPreview.high.market.key, 'corr_young', 'Information behält Hochvariante');
assertEqual(json(records), before, 'Produktive Vorschau schreibt keine Rohrecords');
assertEqual(json({ ...options, engineApi: null, profilverbundHandlers: null }), baseOptions, 'Keine Mutation der Eingaben, Profile oder Historie');
assertEqual(evaluation.marketPreview.rule.mainAction.netAmount.toFixed(2), '89349.53', 'Regelverkauf nach persönlicher Attribution 89.349,53 EUR netto');
assertEqual(evaluation.marketPreview.high.mainAction.netAmount, 35000, 'Verkauf der Hochvariante nach persönlicher Attribution 35.000 EUR netto');
publication.length = 0;
evaluateBalanceFileInputs({ ...options, publish: true, profileSimulationOptions: { publish: true },
    marketPreviewContext: { calculation: c, storage, now: new Date('2026-10-30T12:00:00Z') } });
assertEqual(json(publication), json([true, true, false]), 'Rechnung der Hochvariante veröffentlicht auch bei aktiver Regellesart keine Profilaktionen');
const persisted = [];
persistBalanceUpdate({ mode: 'persist_inputs', inputData: c.inputData, modelResult: evaluation.modelResult,
    persistentState: c.persistentState, profilverbundRuns: evaluation.persistenceEvaluation.profilverbundRuns,
    profilverbundHandlers: { persistProfilverbundInputs: runs => persisted.push(runs) } });
assertEqual(persisted[0].householdInput.endeVJ, 150, 'Eingabenspeicherung rückt Jahresmarktdaten nicht nach');
assertEqual(persisted[0].householdInput.ath, 150, 'höchster Schlusskurs landet nicht im Speicher');
delete records[DAILY_PRICES_KEY];
calls.length = 0;
const noQuote = evaluateBalanceFileInputs({ ...options, marketPreviewContext: { calculation: c, storage, now: new Date('2026-10-30T12:00:00Z') } });
assertEqual(calls.length, 1, 'Ohne Kurs nur bisheriger Engineaufruf');
assertEqual(json(noQuote.modelResult), json(evaluateBalanceFileInputs(options).modelResult), 'Ohne Kurs vollständiges bisheriges Ergebnis bytegleich');
assertEqual(noQuote.marketPreview.readingsEqual, true, 'Produktiver Ohne-Kurs-Merker');
assertEqual(noQuote.marketPreview.withoutQuote, true, 'Produktiver Ohne-Kurs-Zustand');
records[DAILY_PRICES_KEY] = json(prices([['2026-07-14', 200], ['2026-12-30', 175], ['2027-01-08', 250]]));
const beforeAnnualClose = evaluateBalanceFileInputs({ ...options,
    marketPreviewContext: { calculation: c, storage, now: new Date('2027-01-12T12:00:00Z') } });
assertEqual(beforeAnnualClose.marketPreview.quote.asOf, '2026-12-30', 'Produktiver Anlass begrenzt offenen Januarabschluss auf das Abschlussjahr');
assertEqual(beforeAnnualClose.marketPreview.yearEndDate, '2025-12-31', 'Produktiver Januar-Anlass erhält Bezugsjahresende');
const oldDate = getAppTestDate(), oldFetch = globalThis.fetch;
try {
    setAppTestDate('2026-10-30');
    let fetches = 0;
    globalThis.fetch = () => { fetches++; throw new Error('Unerlaubter Kursabruf'); };
    const chart = syntheticChart('VWCE.DE', [historyDay('2025-12-31'), historyDay('2026-10-30')], '2026-10-30');
    records[DAILY_PRICES_KEY] = json({ version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), ...chart } } });
    const gameBytes = json(records);
    const game = evaluateBalanceFileInputs({ ...options, marketPreviewContext: { calculation: c, storage } });
    assertEqual(game.marketPreview.quote.price, chart.closes.at(-1), 'Spielbereich nutzt gespeicherten Spielschluss und Fachdatum');
    assertEqual(fetches, 0, 'Marktvorschau ruft weder echte noch synthetische Kurse ab');
    assertEqual(json(records), gameBytes, 'Spielvorschau erhält alle Speicherbytes');
} finally { setAppTestDate(oldDate); globalThis.fetch = oldFetch; }
