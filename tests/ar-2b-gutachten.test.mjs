import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { prepareMarketPreview, projectMarketPreview, classifyMarketPreview, isHiddenBearMarket } from '../app/balance/balance-market-preview.js';
import { renderBalanceMarketPreview } from '../app/balance/balance-market-preview-renderer.js';
import { emptyHistorySymbol, historyDay } from '../app/tranches/tranchen-history-store.js';
import { assertAnnualPlanRecord } from '../app/profile/annual-plan-record.js';
import { normalizeBalanceImportDocument } from '../app/balance/balance-binder-imports.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

// Befunde aus den Gutachten zu AR-2 (Fable B1/B6, Argon 3–5); Musterhaushalt, Platzhalterkurse.
const records = createMusterHaushaltRecords('2026-10-30', 'max-erika');
const calculation = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, referenceYear: 2026 });
const run = values => EngineAPI.simulateSingleYear({ ...calculation.engineInput, ...values }, calculation.engineLastState);
function project(inputs, dates, closes, today) {
    const days = dates.map(historyDay);
    const dailyPrices = { version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR', days, closes, queried: [[days[0], days.at(-1)]] } } };
    const prepared = prepareMarketPreview({ inputs, dailyPrices, today, yearEndDate: '2025-12-31', hasAnnualClose: true });
    return projectMarketPreview(prepared, { stored: run(inputs), rule: run(prepared.ruleInputs), high: run(prepared.highInputs) });
}
const doc = new MockDocument();
const text = () => doc.getElementById('balanceMarketPreviewBody').textContent.replaceAll(' ', ' ');

// WT-1 (FR-77 Punkt 5): Die Stufen bleiben intern; angezeigt wird nur noch der verdeckte Bärenmarkt.
const assertNothingShown = (view, label) => {
    renderBalanceMarketPreview(doc, view);
    assert(!isHiddenBearMarket(view) && doc.getElementById('balanceMarketPreview').hidden && text() === '', `${label}: kein verdeckter Bär, die Balance zeigt nichts zum Jahreshoch`);
};

// B1: Ein älteres gespeichertes Hoch liegt über dem Jahreshoch (Bärenjahr). Der Abstand zählt trotzdem zum Jahreshoch.
const bear = project({ endeVJ: 200, endeVJ_1: 250, endeVJ_2: 300, endeVJ_3: 280, ath: 300, jahreSeitAth: 2 },
    ['2025-12-31', '2026-03-10', '2026-10-30'], [200, 220, 160], '2026-10-30');
assertEqual(bear.high.high.origin, 'stored_ath', 'Bärenjahr: zweite Lesart rechnet mit dem älteren gespeicherten Hoch');
assertEqual(bear.comparison.state, 'same', 'Bärenjahr: beide Lesarten gleich');
const bearStage = classifyMarketPreview(bear);
assert(Math.abs(bearStage.gapPct - (220 - 160) / 220 * 100) < 1e-9, 'Abstand zum Jahreshoch 220, nicht 0');
assertEqual(bearStage.stage, 'notice', '27 % unter dem Jahreshoch ist ein Hinweis, nicht ruhig');
assertNothingShown(bear, 'Bärenjahr mit älterem Hoch');

// Ruhig, aber Schwelle schon erreicht: kein „sinkt erst unter“.
const calmBear = project({ endeVJ: 200, endeVJ_1: 250, endeVJ_2: 300, endeVJ_3: 280, ath: 300, jahreSeitAth: 2 },
    ['2025-12-31', '2026-03-10', '2026-10-30'], [200, 205, 200], '2026-10-30');
assertEqual(classifyMarketPreview(calmBear).stage, 'calm', '2,4 % unter dem Jahreshoch ist ruhig');
assertNothingShown(calmBear, 'Ruhig mit erreichter Schwelle');

// Normalfall unverändert: heute neues Hoch, beide Lesarten gleich, Schwelle noch nicht erreicht.
const normal = project({ endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 },
    ['2025-12-31', '2026-07-14', '2026-10-30'], [150, 190, 197], '2026-10-30');
assertEqual(classifyMarketPreview(normal).stage, 'calm', 'Normalfall: am Hoch ruhig');
assertNothingShown(normal, 'Normalfall');

// B6: Stufe folgt dem angezeigten Wert mit einer Nachkommastelle.
for (const [price, expected] of [[187.4, 'calm'], [187.2, 'notice'], [187.15, 'notice']]) {
    const copy = structuredClone(normal); copy.quote.price = price; copy.comparison.state = 'same';
    assertEqual(classifyMarketPreview(copy).stage, expected, `Gerundeter Abstand bei Kurs ${price}`);
}

// FR-71 Grundrauschen (Nutzer 04.11.: „Wir brauchen ein Grundrauschen, auf das Wetter nicht reagieren“ → 10 %).
// Im Musterhaushalt schichtet „heiß gelaufen“ anders um als „junge Korrektur“, schon bei 1,5 %.
for (const [today, stage, title] of [[197, 'calm', 'Nahe am Jahreshoch – Grundrauschen, es gilt die Jahresendregel'],
    [185, 'notice', 'Der Kurs liegt 7,5 % unter dem Jahreshoch'], [178, 'warning', 'Der Markt war in diesem Jahr schon viel heißer']]) {
    const view = project({ endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 },
        ['2025-12-31', '2026-07-14', '2026-10-30'], [150, 200, today], '2026-10-30');
    assert(view.comparison.state !== 'same', `Kurs ${today}: die Lesarten unterscheiden sich`);
    const result = classifyMarketPreview(view);
    assertEqual(result.stage, stage, `Kurs ${today}: Stufe ${stage}`);
    assertEqual(result.noise, stage !== 'warning', `Kurs ${today}: Grundrauschen nur unter 10 %`);
    assertNothingShown(view, `Kurs ${today} (${title})`);
}

// Argon 3: Datierung einer Jahreshoch-Meta muss in sich stimmen (über die Importfassade).
const meta = { schemaVersion: 1, periodId: 'calendar-year:2026', targetYear: 2026, price: 160, asOf: '2026-12-31', ticker: 'VWCE.DE', source: 'Platzhalter',
    ath: { value: 250, yearsSince: 0.54, evaluatedAsOf: '2026-12-31', lastHighAsOf: '2026-06-15', reading: 'year_high' } };
const importWith = (ath, inputs = {}) => normalizeBalanceImportDocument({ app: 'Ruhestand-Balancing', version: 'v21.1 Refactored (Engine v31)', payload: {
    inputs: { aktuellesAlter: 68, floorBedarf: 30000, flexBedarf: 30000, runwayTargetMonths: 48, ath: 250, jahreSeitAth: 0.54, ...inputs },
    annualMarketDataMeta: { ...meta, ath } } });
importWith(meta.ath);
// Fable B3: Eingaben dürfen nach der Wahl geändert oder gerundet sein.
assertEqual(importWith(meta.ath, { ath: 255, jahreSeitAth: 0.5 }).payload.inputs.jahreSeitAth, 0.5, 'Geänderte Hoch-Eingaben bleiben importierbar');
for (const [label, change] of [['Alter 0', { yearsSince: 0 }], ['Hoch am Stichtag', { lastHighAsOf: '2026-12-31' }]]) {
    let rejected = false;
    try { importWith({ ...meta.ath, ...change }); } catch { rejected = true; }
    assert(rejected, 'Unstimmige Jahreshoch-Meta wird abgewiesen: ' + label);
}

// Argon 3b: Ein vorhandenes, aber leeres oder kalenderfalsches marketReading im Jahresbeleg wird abgewiesen.
const receipt = JSON.parse(records.annual_plan_record_v1);
const firstOutcome = record => { const entry = Object.values(record.entries)[0]; return entry.adopted || entry.recommended; };
assert(firstOutcome(receipt).snapshot, 'Musterbeleg hat einen Snapshot');
assertAnnualPlanRecord(JSON.stringify(receipt));
for (const bad of [null, { reading: 'year_high', value: 250, asOf: '2026-02-30' }]) {
    const copy = structuredClone(receipt); firstOutcome(copy).snapshot.marketReading = bad;
    let rejected = false; try { assertAnnualPlanRecord(JSON.stringify(copy)); } catch { rejected = true; }
    assert(rejected, 'Jahresbeleg mit ungültigem marketReading abgewiesen: ' + JSON.stringify(bad));
}
