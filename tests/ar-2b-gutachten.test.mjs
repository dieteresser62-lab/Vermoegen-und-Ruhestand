import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { prepareMarketPreview, projectMarketPreview } from '../app/balance/balance-market-preview.js';
import { renderBalanceMarketPreview, marketHighRows } from '../app/balance/balance-market-preview-renderer.js';
import { emptyHistorySymbol, historyDay } from '../app/tranches/tranchen-history-store.js';
import { assertAnnualPlanRecord } from '../app/profile/annual-plan-record.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

// Befunde aus den Gutachten zu AR-2 (Fable B1, Argon 3); Musterhaushalt, Platzhalterkurse. Seit FR-89 gibt es ein Allzeithoch.
const records = createMusterHaushaltRecords('2026-10-30', 'max-erika');
const calculation = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, referenceYear: 2026 });
const run = values => EngineAPI.simulateSingleYear({ ...calculation.engineInput, ...values }, calculation.engineLastState);
function project(inputs, dates, closes, today) {
    const days = dates.map(historyDay);
    const dailyPrices = { version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR', days, closes, queried: [[days[0], days.at(-1)]] } } };
    const prepared = prepareMarketPreview({ inputs, dailyPrices, today, yearEndDate: '2025-12-31', hasAnnualClose: true });
    return projectMarketPreview(prepared, run(prepared.marketInputs));
}
const doc = new MockDocument();
const text = () => doc.getElementById('balanceMarketPreviewBody').textContent.replaceAll(' ', ' ');
// FR-89: Mit belastbaren Kursen zeigt „Was zu tun ist“ nichts zum Hoch; Hoch und Marktlage stehen in der Marktkachel.
const assertNothingShown = (view, label) => {
    renderBalanceMarketPreview(doc, view);
    assert(doc.getElementById('balanceMarketPreview').hidden && text() === '', `${label}: belastbare Kurse, keine Zeile in „Was zu tun ist“`);
};

// B1: Ein älteres gespeichertes Hoch liegt über allen Tagesschlüssen (Bärenjahr). Das Hoch sinkt nie.
const bear = project({ endeVJ: 200, endeVJ_1: 250, endeVJ_2: 300, endeVJ_3: 280, ath: 300, jahreSeitAth: 2 },
    ['2025-12-31', '2026-03-10', '2026-10-30'], [200, 220, 160], '2026-10-30');
assertEqual(JSON.stringify(bear.high), JSON.stringify({ value: 300, asOf: '2023-12-31', origin: 'stored', dated: false, source: 'stored', splitAsOf: null }), 'Bärenjahr: das ältere gespeicherte Hoch bleibt');
assertEqual(bear.inputs.jahreSeitAth, 3, 'Bärenjahr: Alter nach Jahresendregel');
assert(Math.abs(bear.drawdownPct - (300 - 160) / 300 * 100) < 1e-9, 'Abstand zum Allzeithoch 300');
assert(bear.deepBear.cutActive, 'Bärenjahr: Kürzung aktiv');
assertEqual(Object.fromEntries(marketHighRows(bear)).Allzeithoch, '300,00 € · gespeicherter Wert', 'Gespeichertes Hoch ohne belegtes Datum heißt „gespeicherter Wert“ (ATH-1b)');
assertNothingShown(bear, 'Bärenjahr mit älterem Hoch');

// Normalfall: heute neues Hoch über dem Tageshoch; Alter 0 nach Jahresendregel.
const normal = project({ endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 },
    ['2025-12-31', '2026-07-14', '2026-10-30'], [150, 190, 197], '2026-10-30');
assertEqual(JSON.stringify(normal.high), JSON.stringify({ value: 197, asOf: '2026-10-30', origin: 'quote', dated: true, source: 'daily', splitAsOf: null }), 'Normalfall: Stichtagskurs ist das Hoch');
assertEqual(normal.inputs.jahreSeitAth, 0, 'Normalfall: Alter 0');
assertNothingShown(normal, 'Normalfall');

// Seit FR-89 kein Grundrauschen und keine Stufen mehr: Ein Tageshoch von 200 gilt bei jedem Abstand.
for (const today of [197, 185, 178]) {
    const view = project({ endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 },
        ['2025-12-31', '2026-07-14', '2026-10-30'], [150, 200, today], '2026-10-30');
    assertEqual(view.inputs.ath, 200, `Kurs ${today}: das Tageshoch 200 gilt`);
    assert(Math.abs(view.drawdownPct - (200 - today) / 2) < 1e-9, `Kurs ${today}: Abstand zum Tageshoch`);
    assertNothingShown(view, `Kurs ${today}`);
}

// Argon 3b, Altbestand [A7]: Ein vorhandenes, aber leeres oder kalenderfalsches marketReading im Jahresbeleg wird abgewiesen.
const receipt = JSON.parse(records.annual_plan_record_v1);
const firstOutcome = record => { const entry = Object.values(record.entries)[0]; return entry.adopted || entry.recommended; };
assert(firstOutcome(receipt).snapshot, 'Musterbeleg hat einen Snapshot');
assertAnnualPlanRecord(JSON.stringify(receipt));
for (const bad of [null, { reading: 'year_high', value: 250, asOf: '2026-02-30' }]) {
    const copy = structuredClone(receipt); firstOutcome(copy).snapshot.marketReading = bad;
    let rejected = false; try { assertAnnualPlanRecord(JSON.stringify(copy)); } catch { rejected = true; }
    assert(rejected, 'Jahresbeleg mit ungültigem marketReading abgewiesen: ' + JSON.stringify(bad));
}
