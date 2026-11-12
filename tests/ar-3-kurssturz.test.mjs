import { readGU1References } from './helpers/gu-1-expectations.mjs';
// LE-1 (FR-75) und KO-2 (Ergänzung FR-76) in einem Leser; Paare, die beide ändern, sind für den vereinten Stand gemessen.
import { readLE1KO2References } from './helpers/le-1-ko-2-expectations.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { readPFA2References } from './helpers/pfa-2-expectations.mjs';
import { readPFA3References } from './helpers/pfa-3-expectations.mjs';
import { readPFA5References } from './helpers/pfa-5-expectations.mjs';
import { readGA2References } from './helpers/ga-2-expectations.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords, rebuildSyntheticPriceRecords } from '../app/demo/muster-haushalt.js';
import { MUSTER_HAUSHALTE, musterVarianten, musterMarktverlauf } from '../app/demo/muster-haushalte.js';
import { musterLesson } from '../app/demo/muster-steckbrief.js';
import { syntheticChart, syntheticDay, syntheticDate, syntheticPrice, syntheticAnnualQuote,
    syntheticMarketScenario, withSyntheticMarketScenario, SYNTHETIC_MARKET_SOURCE } from '../app/shared/probelauf-prices.js';
import { annualTestMarketData } from './helpers/balance-storage-fixtures.mjs';
import { annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { projectAnnualMarketReadings } from '../app/balance/balance-annual-market-preview.js';
import { classifyMarketPreview } from '../app/balance/balance-market-preview.js';

// AR-3: Beispielvariante „Markt erst heiß, dann Rückgang“ macht den Warnfall aus FR-71 im Spielbereich testbar.
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const basis = JSON.parse(fs.readFileSync(new URL('./fixtures/ar-3-muster-basis.json', import.meta.url), 'utf8'));

// Alle bisherigen Haushalte und Varianten bleiben bytegleich (Basis vor AR-3 aufgenommen).
let compared = 0;
for (const household of MUSTER_HAUSHALTE) for (const variant of musterVarianten(household.id)) {
    const key = `${household.id}:${variant.id}`;
    if (key === 'max-erika:kurssturz' || key === 'max-erika:teilweise') continue;
    const start = createMusterHaushaltRecords('2026-11-04', household.id, variant.id);
    // FR-73: helga-werner:haus-pg3 rechnet die heutige Pflege selbst; seit PFA-3 trägt die Variante den Grundbedarf ohne Pflege (36.000 €),
    // seit PFA-5 nennt ihr Jahresplanbeleg das Liquiditätsziel mit fortgeschriebenen Folgejahreseinkünften (124.700 € statt 129.600 €).
    // GA-2: Sophie trägt den Ratenkredit als feste geplante Ausgabe.
    const reference = value => readGA2References(readPFA5References(readPFA3References(readPFA2References(value))));
    assertEqual(hash(start), readLE1KO2References(readGU1References(reference(basis[key].start))), `${key}: Startbestand bytegleich`);
    assertEqual(hash(rebuildSyntheticPriceRecords(start, '2027-01-02')), readLE1KO2References(readGU1References(reference(basis[key].jump2027))), `${key}: Datumssprung bytegleich`);
    assertEqual(hash(createMusterHaushaltRecords('2026-01-02', household.id, variant.id)), readLE1KO2References(readGU1References(reference(basis[key].jan2026))), `${key}: Januarbestand bytegleich`);
    compared++;
}
assertEqual(compared, Object.keys(basis).length, 'Jede bisherige Variante verglichen');
assert(musterVarianten('max-erika').some(variant => variant.id === 'kurssturz' && variant.name === 'Markt erst heiß, dann Rückgang'), 'Variante im Startdialog');
assertEqual(musterMarktverlauf('max-erika', 'kurssturz'), 'kurssturz', 'Variante trägt ihren Marktverlauf');
assertEqual(musterMarktverlauf('max-erika', 'grund'), null, 'Grundfall ohne Marktverlauf');

// Kursverlauf: Hoch am 15.06.2026, Ende 2026 rund das 1,25-Fache von Ende 2025; Geldmarkt unverändert.
const days = [syntheticDay('2025-12-31'), syntheticDay('2026-12-31')];
const chart = withSyntheticMarketScenario('kurssturz', () => syntheticChart('VWCE.DE', days, '2027-01-02'));
const top = chart.closes.indexOf(Math.max(...chart.closes));
assertEqual(syntheticDate(chart.days[top]), '2026-06-15', 'Jahreshoch am 15.06.2026');
const ratio = chart.closes.at(-1) / chart.closes[0];
assert(ratio > 1.2 && ratio < 1.4, `Ende 2026 rund 1,25 × Ende 2025 (${ratio.toFixed(3)})`);
assert(chart.closes[top] / chart.closes[0] > 1.9, 'Hoch rund doppelt so hoch wie Ende 2025');
assertEqual(withSyntheticMarketScenario('kurssturz', () => syntheticPrice('XEON.DE', '2026-06-15')), syntheticPrice('XEON.DE', '2026-06-15'), 'Geldmarkt ohne Marktverlauf');
assertEqual(withSyntheticMarketScenario('kurssturz', () => syntheticPrice('VWCE.DE', '2025-12-31')), syntheticPrice('VWCE.DE', '2025-12-31'), 'Bis Ende 2025 unverändert');
assertEqual(syntheticMarketScenario(), null, 'Marktverlauf gilt nur innerhalb des Aufrufs');

// Jahresabschluss 2026 der Variante: Warnung mit Wahl (Abstand weit über dem Grundrauschen von 10 %).
const start = createMusterHaushaltRecords('2026-11-04', 'max-erika', 'kurssturz');
assertEqual(syntheticMarketScenario(), null, 'Anlage der Beispieldaten hinterlässt keinen Marktverlauf');
const records = withSyntheticMarketScenario('kurssturz', () => rebuildSyntheticPriceRecords(start, '2027-01-02'));
// Inflation und CAPE in der aufbereiteten Abschlussform der Test-Hilfen; der Jahresendkurs aus den Spielkursen der Variante.
const marketData = { ...annualTestMarketData,
    etf: { ...annualTestMarketData.etf, ...withSyntheticMarketScenario('kurssturz', () => syntheticAnnualQuote('VWCE.DE', 2026, '2027-01-02')), source: SYNTHETIC_MARKET_SOURCE } };
const view = await projectAnnualMarketReadings({ targetYear: 2026, quote: marketData.etf, marketData,
    storage: annualRecordStorage(records), engineLoader: { load: async () => EngineAPI } });
assert(view && 'yearlyHigh' in view, 'Jahresvergleich verfügbar');
assertEqual(view.yearlyHigh.asOf, '2026-06-15', 'Jahresabschluss kennt das Jahreshoch vom 15.06.');
const stage = classifyMarketPreview(view);
assert(stage.gapPct > 30, `Ende 2026 weit unter dem Jahreshoch (${stage.gapPct.toFixed(1)} %)`);
assertEqual(view.rule.market.key, 'peak_hot', 'Jahresendregel sieht ein neues Hoch');
// Mit +25 % im Jahr liest die Engine den tiefen Bären als „Erholung im Bärenmarkt“; beide kürzen den Flex.
assert(['bear_deep', 'recovery_in_bear'].includes(view.high.market.key), `Gemessen am Jahreshoch Bärenmarkt (${view.high.market.key})`);
assertEqual(stage.stage, 'warning', 'Jahresabschluss 2026 verlangt die Wahl');

// Steckbrief und Übung.
const lesson = musterLesson('max-erika', 'kurssturz');
assert(lesson.exercises.some(text => text.includes('Reiter „Plan 2027“')), 'Übung führt zur Wahl im Schritt Plan (WT-1)');
assert(lesson.note.includes('15.06.'), 'Hinweis nennt das Hochdatum');
