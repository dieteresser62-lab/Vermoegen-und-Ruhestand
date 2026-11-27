import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { createProfilverbundHandlers } from '../app/balance/balance-main-profilverbund.js';
import { evaluateBalanceInputs } from '../app/balance/balance-evaluation.js';
import { deriveYearEndMarketInputs, prepareMarketPreview, projectMarketPreview } from '../app/balance/balance-market-preview.js';
import { DAILY_PRICES_KEY, emptyHistorySymbol, historyDay, assertDailyPrices } from '../app/tranches/tranchen-history-store.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { persistBalanceUpdate } from '../app/balance/balance-update-pipeline.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { syntheticChart } from '../app/shared/probelauf-prices.js';
import { projectBalanceBudget } from '../app/balance/balance-budget.js';

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
const result = run(prepared.marketInputs);
const view = projectMarketPreview(prepared, result);
const yearsSinceHigh = 108 / 365.2425;
// FR-89: ein Hoch aus allen gespeicherten Schlüssen bis zum Stichtag; Jahresendstände rücken genau einmal nach.
assertEqual(json(prepared.marketInputs), json({ endeVJ: 170, endeVJ_1: 150, endeVJ_2: 140, endeVJ_3: 120, ath: 200, jahreSeitAth: yearsSinceHigh }), 'Nachgerückte Jahresendstände mit Tageshoch und Bruchalter');
assertEqual(json(view.high), json({ value: 200, asOf: '2026-07-14', origin: 'daily_close', dated: true, source: 'daily', splitAsOf: null }), 'Höchster Schluss mit Datum; zukünftige Kurse ausgeschlossen');
assertEqual(view.drawdownPct, 15, '15 % unter dem höchsten Schlusskurs');
assert(Math.abs(view.yearsSinceHigh * 12 - 3.548327481057106) < 1e-12, '108 Tage / (365,2425 / 12) ergeben etwa 3,5 Monate');
assertEqual(result.input.jahreSeitAth, prepared.marketInputs.jahreSeitAth, 'Validator und Normalisierung erhalten den Bruchteil');
assertEqual(view.market.key, 'corr_young', 'Marktlage: Junge Korrektur');
assertEqual(view.market.text, 'Junge Korrektur', 'Markttext kommt aus Engine');
assertEqual(projectBalanceBudget({ ...result.ui, input: result.input }).budget, 5000, 'Budget Max und Erika: 5.000 EUR');
assertEqual(result.ui.action.type, 'TRANSACTION', 'Aktion aus Engine');
assertEqual(EngineAPI.analyzeMarket({ ...prepared.marketInputs, inflation: 0, jahreSeitAth: 0 }).sKey, 'recovery', 'Genau 0 würde zwölf Monate und Erholung ergeben');
assertEqual(view.deepBear.threshold, 160, 'höchster Schlusskurs: Index streng unter 160');
assertEqual(view.deepBear.remainingDeclinePct.toFixed(1), '5.9', 'höchster Schlusskurs: noch 5,9 % Kursrückgang');
assertEqual(view.deepBear.cutActive, false, 'Junge Korrektur kürzt nicht');
assertEqual(view.stored.index, 150, 'Gespeicherte Jahresmarktdaten bleiben in der Anzeige erhalten');
assertEqual(json({ context, calculation, records }), bytes, 'Ableitung und Projektion erhalten alle Eingaben und Speicherbytes');
for (const price of [150, 149, 151]) {
    const derived = deriveYearEndMarketInputs({ ...inputs, jahreSeitAth: 2 }, price);
    assertEqual(derived.jahreSeitAth, price >= 150 ? 0 : 3, 'Jahresregel bei Gleichstand, Rückgang und neuem Hoch');
    assertEqual(derived.ath, Math.max(150, price), 'Jahresregel hält das historische Hoch');
}
for (const dailyPrices of [null, { version: 1, symbols: {} }, prices([['2026-11-02', 999]]), prices([['2026-10-30', 170]], 'USD')]) {
    const p = prepareMarketPreview({ ...context, dailyPrices });
    assertEqual(p.withoutQuote, true, 'Ohne verwertbaren EUR-Schluss keine neue Rechnung');
    assertEqual(json(p.marketInputs), json(inputs), 'Ohne Kurs kein Nachrücken');
}
const january = prepareMarketPreview({ ...context, today: '2027-01-12', dailyPrices: prices([
    ['2026-07-14', 200], ['2026-12-30', 175], ['2027-01-08', 250]]) });
assertEqual(january.quote.asOf, '2026-12-30', 'Januar vor Abschluss nutzt letzten Schluss bis Ende Abschlussjahr');
assertEqual(january.high.value, 200, 'Januarhoch des Folgejahrs ausgeschlossen');
const equalHigh = prepareMarketPreview({ ...context, dailyPrices: prices([['2026-07-14', 170], ['2026-10-30', 170]]) });
assertEqual(equalHigh.high.origin, 'quote', 'Gleichstand mit dem Stichtagskurs: der jüngste Tag ist der Stichtag');
assertEqual(equalHigh.marketInputs.jahreSeitAth, 0, 'Gleichstand am Stichtag: Alter 0');
const repeated = prepareMarketPreview({ ...context, dailyPrices: prices([['2026-07-14', 200], ['2026-09-01', 200], ['2026-10-30', 170]]) });
assertEqual(repeated.high.asOf, '2026-09-01', 'Jüngster Tag mit gleichem höchsten Schlusskurs');
const older = prepareMarketPreview({ ...context, inputs: { ...inputs, ath: 210, jahreSeitAth: 2 } });
assertEqual(older.marketInputs.ath, 210, 'höchster Schlusskurs unter historischem ATH ändert das Hoch nicht');
assertEqual(older.marketInputs.jahreSeitAth, 3, 'Alter des historischen ATH wie Jahresregel');
assertEqual(json(older.high), json({ value: 210, asOf: '2023-12-31', origin: 'stored', dated: false, source: 'stored', splitAsOf: null }), 'Historisches Hoch ohne belegtes Datum: abgeleitetes Jahresende');
for (const price of [160, 159.99]) {
    const p = prepareMarketPreview({ ...context, dailyPrices: prices([['2026-07-14', 200], ['2026-10-30', price]]) });
    const v = projectMarketPreview(p, run(p.marketInputs));
    assertEqual(v.deepBear.reached, price < 160, 'Bärengrenze streng größer als 20 % Drawdown');
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
const evaluation = evaluateBalanceInputs({ ...options, marketPreviewContext: { calculation: c, storage, now: new Date('2026-10-30T12:00:00Z') } });
assertEqual(calls.length, 2, 'Basis und genau eine Vorschaurechnung (FR-89: keine zweite Lesart)');
assertEqual(json(calls[1].input.endeVJ), '170', 'Vorschau rückt den Stichtagskurs als Jahresende nach');
assertEqual(calls[1].input.ath, 200, 'Vorschau rechnet mit dem höchsten Schlusskurs');
assertEqual(json(calls[0].lastState), json(calls[1].lastState), 'Gleiche Historie für Basis und Vorschau');
assertEqual(json(publication), json([false, false]), 'Lesende Aufrufe veröffentlichen keine Profilaktionen');
assertEqual(evaluation.previewInputData.endeVJ, 170, 'Renderer erhält die Vorschaudaten');
assertEqual(evaluation.previewInputData.ath, 200, 'Renderer erhält das Tageshoch');
assertEqual(evaluation.persistenceEvaluation.profilverbundRuns.householdInput.endeVJ, 150, 'Persistenz erhält ursprüngliche Jahresmarktdaten');
assertEqual(evaluation.modelResult.ui.market.sKey, 'corr_young', 'Empfehlung rechnet mit dem Allzeithoch');
assertEqual(evaluation.marketPreview.market.key, 'corr_young', 'Anzeige und Empfehlung haben dieselbe Marktlage');
assertEqual(json(records), before, 'Produktive Vorschau schreibt keine Rohrecords');
assertEqual(json({ ...options, engineApi: null, profilverbundHandlers: null }), baseOptions, 'Keine Mutation der Eingaben, Profile oder Historie');
publication.length = 0;
evaluateBalanceInputs({ ...options, publish: true, profileSimulationOptions: { publish: true },
    marketPreviewContext: { calculation: c, storage, now: new Date('2026-10-30T12:00:00Z') } });
assertEqual(json(publication), json([true, true]), 'Basis und Vorschau veröffentlichen wie die aktive Rechnung');
const persisted = [];
persistBalanceUpdate({ mode: 'persist_inputs', inputData: c.inputData, modelResult: evaluation.modelResult,
    persistentState: c.persistentState, profilverbundRuns: evaluation.persistenceEvaluation.profilverbundRuns,
    profilverbundHandlers: { persistProfilverbundInputs: runs => persisted.push(runs) } });
assertEqual(persisted[0].householdInput.endeVJ, 150, 'Eingabenspeicherung rückt Jahresmarktdaten nicht nach');
assertEqual(persisted[0].householdInput.ath, 150, 'höchster Schlusskurs landet nicht im Speicher');
delete records[DAILY_PRICES_KEY];
calls.length = 0;
const noQuote = evaluateBalanceInputs({ ...options, marketPreviewContext: { calculation: c, storage, now: new Date('2026-10-30T12:00:00Z') } });
assertEqual(calls.length, 1, 'Ohne Kurs nur bisheriger Engineaufruf');
assertEqual(json(noQuote.modelResult), json(evaluateBalanceInputs(options).modelResult), 'Ohne Kurs vollständiges bisheriges Ergebnis bytegleich');
assertEqual(noQuote.marketPreview.withoutQuote, true, 'Produktiver Ohne-Kurs-Zustand');
records[DAILY_PRICES_KEY] = json(prices([['2025-12-31', 150], ['2026-03-27', 200], ['2026-10-30', 170]]));
const lateCorrection = evaluateBalanceInputs({ ...options,
    marketPreviewContext: { calculation: c, storage, now: new Date('2026-10-30T12:00:00Z') } });
assertEqual(lateCorrection.marketPreview.market.text, 'Junge Korrektur',
    'FR-90: Die Tagesvorschau zeigt beim Hoch vor sieben Monaten eine junge Korrektur');
records[DAILY_PRICES_KEY] = json(prices([['2026-07-14', 200], ['2026-12-30', 175], ['2027-01-08', 250]]));
const beforeAnnualClose = evaluateBalanceInputs({ ...options,
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
    const game = evaluateBalanceInputs({ ...options, marketPreviewContext: { calculation: c, storage } });
    assertEqual(game.marketPreview.quote.price, chart.closes.at(-1), 'Spielbereich nutzt gespeicherten Spielschluss und Fachdatum');
    assertEqual(fetches, 0, 'Marktvorschau ruft weder echte noch synthetische Kurse ab');
    assertEqual(json(records), gameBytes, 'Spielvorschau erhält alle Speicherbytes');
} finally { setAppTestDate(oldDate); globalThis.fetch = oldFetch; }
