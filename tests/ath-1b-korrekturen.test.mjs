// ATH-1b (FR-89, Ergänzung 2): Tageskurs nicht verwenden, Split eintragen, Warnung beim Senken, Warnhinweise ohne Verwerfen,
// Stichtag, wiederholter Abschluss, Grenzen und VWCE-Referenz. Kein automatischer Filter. Nur erfundene Musterdaten.
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { annualTestMarketData as marketData, annualTestNow as now } from './helpers/balance-storage-fixtures.mjs';
import { computeAnnualPlanUpdate, annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords, evaluateAnnualDraft } from '../app/balance/balance-annual-storage-commit.js';
import { prepareMarketPreview, deriveMarketHigh, projectMarketPreview } from '../app/balance/balance-market-preview.js';
import { marketHighSource, createAnnualMarketReadings, marketHighRows, withMarketHighRows } from '../app/balance/balance-market-preview-renderer.js';
import { withAthNoiseBand, athNoiseBandApplies, ATH_NOISE_BAND_PCT, ATH_NOISE_BAND_TEXT } from '../app/balance/balance-ath-noise.js';
import { prepareBalanceEngineAssets } from '../app/balance/balance-health-bucket.js';
import { readAthCorrections, highCorrectionsOf, ignoreDailyClose, restoreDailyClose, planSplit, applySplit, ATH_CORRECTIONS_KEY } from '../app/balance/balance-ath-corrections.js';
import { createAthCorrectionsBlock, athLowerWarningText, updateAthLowerWarning, storedHighSource, renderAthCorrections, bindAthCorrections,
    ATH_TRIAL_LOCKED_TEXT, ATH_SPLIT_YEAR_UNKNOWN_TEXT } from '../app/balance/balance-ath-corrections-view.js';
import { readExactFieldValue, setExactFieldValue } from '../app/balance/balance-exact-field.js';
import { registerPlanTrial } from '../app/shared/plan-trial.js';
import { storedMarketYear, renderMarketYearLabels } from '../app/balance/balance-presentation-controls.js';
import { projectBalanceActionOrigin } from '../app/balance/balance-action-origin.js';
import { HOUSEHOLD_OWNED_BALANCE_STATE_KEYS } from '../app/profile/profile-storage.js';
import { collectHistoryQueue, REFERENCE_HISTORY_SYMBOL } from '../app/tranches/tranchen-history-fetch.js';
import { selectAnnualCloseQuote } from '../app/shared/annual-marketdata.js';
import { emptyHistorySymbol, historyDay, DAILY_PRICES_KEY, readHistoryStartDate } from '../app/tranches/tranchen-history-store.js';
import { createAnnualMarketDataReaders } from '../app/shared/annual-marketdata.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { MemoryWebStorage } from './helpers/persistence-area-backends.mjs';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup } from '../app/shared/persistence-backup.js';

const key = CONFIG.STORAGE.LS_KEY, json = JSON.stringify;
const years = (from, to) => (historyDay(to) - historyDay(from)) / 365.2425;
/** @param {[string, number][]} points */
const pricesOf = points => ({ version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR',
    days: points.map(([date]) => historyDay(date)), closes: points.map(([, price]) => price),
    queried: [[historyDay(points[0][0]), historyDay(points.at(-1)[0])]] } } });
const text = node => [node, ...(node.children || [])].map(item => item === node ? '' : text(item)).join(' ') + ' ' + (node.textContent || '');
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const findData = (node, name) => walk(node).find(item => item.dataset && Object.hasOwn(item.dataset, name));
const phase = market => EngineAPI.analyzeMarket({ ...market, inflation: 2, capeRatio: 25 }).sKey;

// Datenfehler: Tageskurs 2.000 in einer Reihe um 200 → Ausreißer-Verdacht → „nicht verwenden“ → nächsthöheres echtes Hoch → „wieder verwenden“.
{
    const inputs = { endeVJ: 200, endeVJ_1: 190, endeVJ_2: 180, endeVJ_3: 170, ath: 200, jahreSeitAth: 0 };
    const dailyPrices = pricesOf([['2026-03-02', 198], ['2026-03-03', 2000], ['2026-03-04', 201], ['2026-06-12', 225], ['2026-06-15', 230],
        ['2026-06-16', 228], ['2026-11-20', 215]]);
    const preview = state => prepareMarketPreview({ inputs, dailyPrices, today: '2026-11-26', yearEndDate: '2025-12-31', hasAnnualClose: true,
        corrections: highCorrectionsOf(state) });
    const state = { inputs: { ...inputs } };
    const faulty = preview(state);
    assertEqual(`${faulty.high.value} · ${faulty.high.asOf}`, '2000 · 2026-03-03', 'Ohne Korrektur zählt der fehlerhafte Tageskurs (kein automatischer Filter)');
    assertEqual(faulty.warnings.outlier?.asOf, '2026-03-03', 'Ausreißer-Verdacht am Tag des Hochs');
    assert(faulty.warnings.outlier.pctOverPrevious > 900, 'Ausreißer: 2.000 liegt weit über dem Vortag');
    const doc = new MockDocument();
    const block = createAthCorrectionsBlock(doc, { state, view: { ...faulty, high: faulty.high, warnings: faulty.warnings } });
    assert(text(block).includes('Ausreißer-Verdacht – Kurs prüfen'), 'Block nennt den Ausreißer-Verdacht');
    assert(findData(block, 'athIgnore')?.dataset.athIgnore === '2026-03-03', 'Block bietet „nicht verwenden“ für genau diesen Tag');
    const ignored = ignoreDailyClose(state, '2026-03-03');
    assertEqual(json(readAthCorrections(ignored).ignoredCloses), json(['2026-03-03']), 'Markierter Tag steht im Balance-Stand');
    assertEqual(json(state), json({ inputs }), 'Markieren verändert den alten Stand nicht');
    const corrected = preview(ignored);
    assertEqual(`${corrected.high.value} · ${corrected.high.asOf}`, '230 · 2026-06-15', 'Nächsthöheres echtes Hoch, auch zwischen Fehlertag und heute');
    assertEqual(corrected.marketInputs.jahreSeitAth, years('2026-06-15', '2026-11-20'), 'Alter ab dem echten Hoch');
    assertEqual(corrected.warnings.outlier, null, 'Echtes Hoch ohne Ausreißer-Verdacht');
    assertEqual(json(dailyPrices.symbols['VWCE.DE'].closes), json([198, 2000, 201, 225, 230, 228, 215]), 'Rohkurse bleiben gespeichert');
    const list = createAthCorrectionsBlock(doc, { state: ignored, view: corrected, prices: dailyPrices });
    assert(text(list).includes('03.03.2026 · 2.000,00 €') && findData(list, 'athRestore')?.dataset.athRestore === '2026-03-03', 'Liste mit „Wieder verwenden“');
    const restored = restoreDailyClose(ignored, '2026-03-03');
    assertEqual(readAthCorrections(restored).ignoredCloses.length, 0, '„Wieder verwenden“ entfernt die Markierung');
    assertEqual(json([preview(restored).high, preview(restored).marketInputs]), json([faulty.high, faulty.marketInputs]), '„Wieder verwenden“ stellt den alten Zustand her');
    // Gleiche Regel im Jahresabschluss: dieselbe Markierung im gespeicherten Stand.
    const records = createMusterHaushaltRecords('2026-12-15');
    const live = JSON.parse(records[key]);
    live.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'ath1b', phase: 'writes_started' };
    records[key] = json({ ...live, [ATH_CORRECTIONS_KEY]: { ignoredCloses: ['2026-03-03'], splits: [] } });
    records[DAILY_PRICES_KEY] = json(pricesOf([['2026-03-02', 150], ['2026-03-03', 2000], ['2026-03-04', 151], ['2026-08-03', 170], ['2026-12-30', 160.2]]));
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage: annualRecordStorage(records), now });
    const meta = JSON.parse(draft.records[key]).annualMarketDataMeta.ath;
    assertEqual(`${meta.value} · ${meta.lastHighAsOf}`, '170 · 2026-08-03', 'Jahresabschluss überspringt den markierten Tag wie die Vorschau');
    assertEqual(json(readAthCorrections(JSON.parse(draft.records[key])).ignoredCloses), json(['2026-03-03']), 'Markierung bleibt nach dem Abschluss erhalten');
    assert(HOUSEHOLD_OWNED_BALANCE_STATE_KEYS.includes(ATH_CORRECTIONS_KEY), 'Korrekturen gehören dem Haushalt wie die Jahresmarktdaten');
}

// Split- oder Fehlerverdacht: Tagesschluss mehr als 30 % unter dem Vortag im Zeitraum seit dem Hoch; nur ein Hinweis.
{
    const prepared = prepareMarketPreview({ inputs: { endeVJ: 200, endeVJ_1: 190, endeVJ_2: 180, endeVJ_3: 170, ath: 200, jahreSeitAth: 0 },
        dailyPrices: pricesOf([['2026-03-02', 210], ['2026-06-12', 190], ['2026-06-15', 95], ['2026-11-20', 94]]), today: '2026-11-26', yearEndDate: '2025-12-31', hasAnnualClose: true });
    assertEqual(prepared.warnings.drop?.asOf, '2026-06-15', 'Möglicher Split oder Datenfehler am Tag des Einbruchs');
    assertEqual(prepared.high.value, 210, 'Der Hinweis verwirft nichts');
    const shown = text(createAnnualMarketReadings(new MockDocument(), { ...prepared, market: { key: 'bear_deep', text: 'Tiefer Bär' }, drawdownPct: 55,
        deepBear: { threshold: 168, reached: true, cutActive: true, remainingDeclinePct: 0 }, index: 94 }));
    assert(shown.includes('Möglicher Split oder Datenfehler: Am 15.06.2026') && shown.includes('„nicht verwenden“'), 'Jahresabschluss zeigt Hinweis und den Weg zur Korrektur');
}

// Split 1:2: Abstand und Marktphase vor und nach dem Split gleich, kein vorgetäuschter Bärenmarkt, alte Tagesschlüsse zählen nicht.
{
    const inputs = { endeVJ: 180, endeVJ_1: 170, endeVJ_2: 160, endeVJ_3: 150, ath: 200, jahreSeitAth: 0.33 };
    const meta = { periodId: 'calendar-year:2025', asOf: '2025-12-30', price: 180, ath: { value: 200, yearsSince: 0.33, evaluatedAsOf: '2025-12-30', lastHighAsOf: '2025-09-01' } };
    const state = { inputs: { ...inputs }, annualMarketDataMeta: meta };
    const dailyPrices = pricesOf([['2026-03-02', 185], ['2026-06-12', 190], ['2026-06-15', 95], ['2026-11-20', 94]]);
    const preview = (current, today) => prepareMarketPreview({ inputs: current.inputs, dailyPrices, today, yearEndDate: '2025-12-31', hasAnnualClose: true,
        storedHighAsOf: current.annualMarketDataMeta.ath.value === current.inputs.ath ? current.annualMarketDataMeta.ath.lastHighAsOf : null,
        yearEndAsOf: current.annualMarketDataMeta.asOf, corrections: highCorrectionsOf(current) });
    const before = preview(state, '2026-06-12');
    const unsplit = preview(state, '2026-06-15');
    assertEqual(phase(unsplit.marketInputs), 'bear_deep', 'Ohne Split-Eintrag sähe die App am Splittag einen tiefen Bären');
    const split = planSplit({ state, inputs, asOf: '2026-06-15', ratio: 2, now: () => new Date('2026-06-16T09:00:00Z') });
    assertEqual(json(split.after), json({ ath: 100, endeVJ: 90, endeVJ_1: 85, endeVJ_2: 80, endeVJ_3: 75 }), 'Vorher/Nachher für die Bestätigung');
    const after = applySplit(state, split);
    assertEqual(json([after.inputs.ath, after.inputs.endeVJ, after.inputs.endeVJ_3, after.annualMarketDataMeta.ath.value]), json([100, 90, 75, 100]), 'Split teilt Hoch und Jahresschlüsse einmal');
    let twice = null; try { planSplit({ state: after, inputs: after.inputs, asOf: '2026-06-15', ratio: 2 }); } catch (error) { twice = error.message; }
    assert(twice?.includes('schon ein Split'), 'Derselbe Split lässt sich nicht zweimal eintragen');
    const splitDay = preview(after, '2026-06-15');
    assertEqual(splitDay.high.value, 100, 'Tagesschlüsse vor dem Splitdatum zählen nicht mehr');
    assertEqual(marketHighSource(splitDay.high), 'Tagesschluss vom 01.09.2025 · nach Split am 15.06.2026', 'Herkunft „nach Split“');
    assertEqual(json([splitDay.marketInputs.endeVJ / splitDay.marketInputs.ath, phase(splitDay.marketInputs)]),
        json([before.marketInputs.endeVJ / before.marketInputs.ath, phase(before.marketInputs)]), 'Abstand und Marktphase vor und nach dem Split gleich');
    assert(phase(splitDay.marketInputs) !== 'bear_deep', 'Kein vorgetäuschter Bärenmarkt');
    assertEqual(storedHighSource(after, 100), 'Tagesschluss vom 01.09.2025 · nach Split am 15.06.2026', 'Kachel „Allzeithoch“ nennt die Herkunft nach Split');
    // Jahresprotokoll nennt den Split.
    const records = createMusterHaushaltRecords('2026-12-15');
    const live = JSON.parse(records[key]);
    live.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'ath1b-split', phase: 'writes_started' };
    records[key] = json({ ...live, [ATH_CORRECTIONS_KEY]: { ignoredCloses: [], splits: [split] } });
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage: annualRecordStorage(records), now });
    assertEqual(json(draft.results.etf.ath.splits), json([{ asOf: '2026-06-15', ratio: 2, athBefore: 200, athAfter: 100 }]), 'Jahresprotokoll nennt den Split');
}

// Feld „Allzeithoch“ von Hand senken: sichtbare Warnung, keine Sperre; ein höherer gültiger Tagesschluss gewinnt weiter.
{
    assertEqual(athLowerWarningText(200, 150), 'Du senkst das gespeicherte Hoch von 200,00 € auf 150,00 €. Ein Hoch, das älter ist als die gespeicherten Tageskurse, geht damit verloren.', 'Warnung beim Senken');
    assertEqual(athLowerWarningText(200, 210), null, 'Kein Hinweis beim Anheben');
    const doc = new MockDocument();
    renderAthCorrections(doc, { state: { inputs: { ath: 150 }, annualMarketDataMeta: { asOf: '2025-12-30', ath: { value: 200, lastHighAsOf: '2025-12-30' } } }, view: null });
    doc.getElementById('ath').value = '150';
    updateAthLowerWarning(doc);
    const note = doc.getElementById('athLowerWarning');
    assert(!note.hidden && note.textContent.startsWith('Du senkst das gespeicherte Hoch von 200,00 €'), 'Warnung erscheint unter dem Feld');
    const higher = prepareMarketPreview({ inputs: { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 130, endeVJ_3: 120, ath: 150, jahreSeitAth: 0 },
        dailyPrices: pricesOf([['2026-05-04', 180], ['2026-11-20', 170]]), today: '2026-11-26', yearEndDate: '2025-12-31', hasAnnualClose: true });
    assertEqual(higher.high.value, 180, 'Höherer gültiger Tagesschluss überbietet den gesenkten Wert');
}

// Rundlauf: Vollsicherung → Import erhält markierte Tage und Splits; ebenso ein Neustart.
{
    const records = createMusterHaushaltRecords('2026-12-15');
    const corrections = { ignoredCloses: ['2026-03-03'], splits: [{ asOf: '2026-06-15', ratio: 2, recordedAt: '2026-06-16T09:00:00.000Z',
        before: { ath: 200, endeVJ: 180, endeVJ_1: 170, endeVJ_2: 160, endeVJ_3: 150 }, after: { ath: 100, endeVJ: 90, endeVJ_1: 85, endeVJ_2: 80, endeVJ_3: 75 } }] };
    records[key] = json({ ...JSON.parse(records[key]), [ATH_CORRECTIONS_KEY]: corrections });
    const storage = new MemoryWebStorage();
    for (const [name, value] of Object.entries(records)) storage.setItem(name, value);
    const backup = buildFullPersistenceBackup({ storage });
    const f = await playFixture('tauri'); await f.boot();
    try {
        const imported = await importFullPersistenceBackup(backup);
        assertEqual(imported.ok, true, `Vollsicherung importiert: ${imported.message ?? ''}`);
        await P.flush(); await f.boot();
        assertEqual(json(readAthCorrections(JSON.parse(persistenceStorage.getItem(key)))), json(corrections), 'Nach Import und Neustart: markierte Tage und Splits erhalten');
    } finally { P.resetPersistenceRuntimeForTests(); }
}

// Stichtag: Ein neues Hoch am 05.01. zählt im Abschluss am 15.01. mit Stichtag 31.12. nicht; ist der 31.12. kein Handelstag, gilt der 30.12.
{
    const at = (date, hour = 16) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hour, 30) / 1000;
    const quote = selectAnnualCloseQuote({ chart: { result: [{ timestamp: ['2026-12-29', '2026-12-30', '2027-01-05'].map(date => at(date)),
        indicators: { quote: [{ close: [158, 160.2, 300] }] } }] } }, { targetYear: 2026 });
    assertEqual(`${quote.asOf} · ${quote.price}`, '2026-12-30 · 160.2', 'Ohne Handel am 31.12. gilt der letzte Tagesschluss bis einschließlich 31.12.');
    const prepared = prepareMarketPreview({ inputs: { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 130, endeVJ_3: 120, ath: 150, jahreSeitAth: 0 },
        dailyPrices: pricesOf([['2026-07-01', 155], ['2026-12-30', 160.2], ['2027-01-05', 300]]), quoteOverride: { price: 160.2, asOf: '2026-12-30' },
        today: '2026-12-31', ageUntil: '2026-12-31', yearEndDate: '2025-12-31', hasAnnualClose: true });
    assertEqual(prepared.high.value, 160.2, 'Abschlussvorschau: das Januarhoch zählt nicht');
    const records = createMusterHaushaltRecords('2026-12-15');
    const live = JSON.parse(records[key]);
    live.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'ath1b-stichtag', phase: 'writes_started' };
    records[key] = json(live);
    records[DAILY_PRICES_KEY] = json(pricesOf([['2026-07-01', 155], ['2026-12-30', 160.2], ['2027-01-05', 300]]));
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, storage: annualRecordStorage(records), now: () => new Date('2027-01-15T12:00:00Z'),
        marketData: { ...marketData, etf: { ...marketData.etf, ...quote } } });
    assertEqual(JSON.parse(draft.records[key]).inputs.ath, 160.2, 'Jahresabschluss am 15.01.: das Hoch vom 05.01. zählt nicht');
}

// Wiederholter Jahresabschluss (Rückkehrpunkt, dann erneut): gleiches Hoch, gleiches Alter, gleiche Marktphase.
{
    const records = createMusterHaushaltRecords('2026-12-15');
    const live = JSON.parse(records[key]);
    live.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'ath1b-repeat', phase: 'writes_started' };
    records[key] = json(live);
    records[DAILY_PRICES_KEY] = json(pricesOf([['2026-01-05', 150], ['2026-06-15', 200], ['2026-12-30', 170]]));
    const close = () => {
        const draft = computeAnnualPlanUpdate({ targetYear: 2026, storage: annualRecordStorage({ ...records }), now,
            marketData: { ...marketData, etf: { ...marketData.etf, price: 170, asOf: '2026-12-30', date: new Date('2026-12-30') } } });
        const committed = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now });
        const state = JSON.parse(committed.records[key]);
        return json([state.inputs.ath, state.inputs.jahreSeitAth, state.annualMarketDataMeta.ath, committed.receipt.adopted.marketPhase]);
    };
    const first = close();
    assertEqual(close(), first, 'Erneuter Abschluss vom Rückkehrpunkt ergibt dasselbe Hoch, Alter und dieselbe Marktphase');
    assertEqual(JSON.parse(first)[0], 200, 'Abschluss verwendet das Tageshoch');
}

// Grenzen mit Bruchjahren aus Kalendertagen / 365,2425; Schwellen der Engine wie in JAHRESBUDGET.md (nur geprüft, nicht geändert).
{
    const base = { endeVJ_2: 0, endeVJ_3: 0 };
    const monthsFor = days => days / 365.2425 * 12;
    const corr = months => phase({ ...base, endeVJ: 90, endeVJ_1: 91, ath: 100, jahreSeitAth: months / 12 });
    assertEqual(json([5.99, 6, 6.01].map(corr)), json(['corr_young', 'corr_young', 'side_long']), 'Junge Korrektur bis einschließlich 6 Monate');
    const recovery = months => phase({ ...base, endeVJ: 88, endeVJ_1: 78, ath: 100, jahreSeitAth: months / 12 });
    assertEqual(json([11.94, 11.95, 11.96].map(recovery)), json(['corr_young', 'recovery', 'recovery']), 'Bestätigte Erholung ab 11,95 Monaten');
    // Dieselben Grenzen aus echten Kalendertagen: 182 Tage = 5,98, 183 Tage = 6,01, 363 Tage = 11,93, 364 Tage = 11,96 Monate.
    const derived = (highDay, until, quote) => deriveMarketHigh({ inputs: { endeVJ: 91, endeVJ_1: 90, endeVJ_2: 85, endeVJ_3: 80, ath: 99, jahreSeitAth: 2 },
        quote: { price: quote, asOf: until }, yearEndDate: '2025-12-31', series: pricesOf([[highDay, 100], [until, quote]]).symbols['VWCE.DE'], ageUntil: until }).inputs;
    const d182 = derived('2026-03-01', '2026-08-30', 90), d183 = derived('2026-03-01', '2026-08-31', 90);
    assertEqual(json([d182.jahreSeitAth * 12, d183.jahreSeitAth * 12]), json([monthsFor(182), monthsFor(183)]), 'Alter aus Kalendertagen / 365,2425');
    assertEqual(json([phase({ ...d182, endeVJ_1: 91 }), phase({ ...d183, endeVJ_1: 91 })]), json(['corr_young', 'side_long']), '182/183 Tage: junge Korrektur nur bis 6 Monate');
    const d363 = derived('2025-09-01', '2026-08-30', 88), d364 = derived('2025-09-01', '2026-08-31', 88);
    assertEqual(json([d363.jahreSeitAth * 12 < 11.95, d364.jahreSeitAth * 12 >= 11.95]), json([true, true]), '363/364 Tage liegen unter bzw. über 11,95 Monaten');
    assertEqual(json([phase({ ...d363, endeVJ_1: 78 }), phase({ ...d364, endeVJ_1: 78 })]), json(['corr_young', 'recovery']), '363/364 Tage: Erholung erst ab 11,95 Monaten');
    const tie = deriveMarketHigh({ inputs: { endeVJ: 100, endeVJ_1: 90, endeVJ_2: 85, endeVJ_3: 80, ath: 100, jahreSeitAth: 1 }, quote: { price: 95, asOf: '2026-11-20' },
        yearEndDate: '2025-12-31', series: pricesOf([['2026-02-02', 110], ['2026-05-05', 110], ['2026-09-09', 110], ['2026-11-20', 95]]).symbols['VWCE.DE'], ageUntil: '2026-11-20' });
    assertEqual(tie.high.asOf, '2026-09-09', 'Gleiches Hoch an mehreren Tagen: der jüngste zählt');
    const leap = deriveMarketHigh({ inputs: { endeVJ: 100, endeVJ_1: 90, endeVJ_2: 85, endeVJ_3: 80, ath: 100, jahreSeitAth: 1 }, quote: { price: 95, asOf: '2024-12-30' },
        yearEndDate: '2023-12-31', series: pricesOf([['2024-02-28', 105], ['2024-02-29', 106], ['2024-12-30', 95]]).symbols['VWCE.DE'], ageUntil: '2024-12-31' });
    assertEqual(json([leap.high.asOf, leap.inputs.jahreSeitAth]), json(['2024-02-29', 306 / 365.2425]), 'Schaltjahr: 29.02. zählt als Tag, Alter 306 Tage bis 31.12.');
    assertEqual(json([phase({ ...base, endeVJ: 85, endeVJ_1: 86, ath: 100, jahreSeitAth: 0.4 }), phase({ ...base, endeVJ: 84.99, endeVJ_1: 86, ath: 100, jahreSeitAth: 0.4 })]),
        json(['corr_young', 'side_long']), 'Abstand genau 15 %: noch junge Korrektur (höchstens 15 %)');
    assertEqual(json([phase({ ...base, endeVJ: 80, endeVJ_1: 79, ath: 100, jahreSeitAth: 2 }), phase({ ...base, endeVJ: 79.99, endeVJ_1: 79, ath: 100, jahreSeitAth: 2 })]),
        json(['side_long', 'bear_deep']), 'Abstand genau 20 %: kein tiefer Bär (mehr als 20 %)');
}

// VWCE.DE immer als Referenz ab Historienstart, auch ohne VWCE-Tranche und bei späterem VWCE-Kauf; keine Tranche, keine Vermögenszeile.
{
    const lot = (ticker, purchaseDate) => ({ schemaVersion: 1, trancheId: `${ticker}-lot`, name: ticker, isin: '', ticker, shares: 10, purchasePrice: 100,
        currentPrice: 100, asOf: Date.parse('2026-03-02T12:00:00Z') / 1000, purchaseDate, category: 'equity', type: 'aktien_neu', tqf: 0, notes: '' });
    const registry = lots => ({ version: 1, profiles: { a: { meta: { id: 'a', name: 'Person A' }, data: { depot_tranchen: json(lots) } } } });
    const withoutVwce = collectHistoryQueue(registry([lot('TEST.DE', '2026-02-02')]), '2026-01-01', '2026-03-02');
    assertEqual(REFERENCE_HISTORY_SYMBOL, 'VWCE.DE', 'Referenz ist VWCE.DE');
    const reference = withoutVwce.wanted.find(entry => entry.symbol === 'VWCE.DE');
    assertEqual(json(reference?.intervals), json([[historyDay('2026-01-01'), historyDay('2026-03-01')]]), 'Depot ohne VWCE: Kursliste enthält VWCE.DE ab Historienstart');
    assertEqual(withoutVwce.queue.filter(job => job.symbol === 'VWCE.DE').length, 1, 'Referenz wird wie jede Lücke abgefragt');
    const laterVwce = collectHistoryQueue(registry([lot('VWCE.DE', '2026-02-16')]), '2026-01-01', '2026-03-02');
    assertEqual(laterVwce.wanted.find(entry => entry.symbol === 'VWCE.DE')?.intervals[0][0], historyDay('2026-01-01'), 'Späterer VWCE-Kauf: Reihe beginnt trotzdem am Historienstart');
    assertEqual(laterVwce.wanted.length, 1, 'Referenz und Tranche teilen dieselbe Reihe');
    assertEqual(json(collectHistoryQueue(registry([]), '2026-01-01', '2026-03-02').issues), '[]', 'Die Referenz erzeugt keine Tranche und keinen Hinweis');
}

// Gutachten zu ATH-1 (Punkt 8): P2-1 Abschlusskurs ohne Tagesreihe, P2-3 Alter eines belegten Hochs, P3-1 Lücken ab Historienstart,
// P3-2 kein schreibender ETF-Handler mehr.
{
    const inputs = { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 130, endeVJ_3: 120, ath: 200, jahreSeitAth: years('2025-06-30', '2025-12-31') };
    const quote = { price: 160, asOf: '2026-12-30' };
    const empty = { version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR', queried: [[historyDay('2025-01-01'), historyDay('2026-12-30')]] } } };
    for (const [label, dailyPrices] of [['ohne Reihe', null], ['leere Reihe', empty], ['Reihe erst im Folgejahr', pricesOf([['2027-01-04', 170]])]]) {
        const prepared = prepareMarketPreview({ inputs, dailyPrices, quoteOverride: quote, today: '2026-12-31', ageUntil: '2026-12-31',
            yearEndDate: '2025-12-31', hasAnnualClose: true, storedHighAsOf: '2025-06-30' });
        assert(prepared.quote?.price === 160 && prepared.marketInputs.endeVJ === 160 && prepared.marketInputs.endeVJ_1 === 150,
            `P2-1 ${label}: Abschlusskurs gilt, keine Vorjahreswerte`);
        const draft = deriveMarketHigh({ inputs, quote, yearEndDate: '2025-12-31', storedHighAsOf: '2025-06-30',
            series: dailyPrices?.symbols['VWCE.DE'] ?? null, ageUntil: '2026-12-31' });
        assertEqual(json(prepared.marketInputs), json(draft.inputs), `P2-1 ${label}: Marktschritt und Jahresentwurf rechnen dasselbe`);
        assert(prepared.high.value === 200 && prepared.high.asOf === '2025-06-30', `P2-1 ${label}: Hoch aus gespeichertem Hoch und Abschlusskurs`);
    }

    // P2-3: Herbsthoch 15.11.2026, Vorschau am 15.02.2027 knapp 8 % darunter: 0,25 Jahre und junge Korrektur statt 1,1 Jahre.
    const autumn = { endeVJ: 180, endeVJ_1: 150, endeVJ_2: 140, endeVJ_3: 130, ath: 200, jahreSeitAth: years('2026-11-15', '2026-12-31') };
    const series = pricesOf([['2026-11-13', 196], ['2026-11-15', 200], ['2026-12-30', 180], ['2027-02-15', 184]]);
    const dated = prepareMarketPreview({ inputs: autumn, dailyPrices: series, today: '2027-02-15', yearEndDate: '2026-12-31',
        hasAnnualClose: true, storedHighAsOf: '2026-11-15', yearEndAsOf: '2026-12-30' });
    assert(dated.high.origin === 'stored' && dated.high.asOf === '2026-11-15', 'P2-3: Gleichstand am belegten Tag behält das gespeicherte Hoch');
    assertEqual(marketHighSource(dated.high), 'Tagesschluss vom 15.11.2026', 'P2-3: Herkunft Tagesschluss mit Datum');
    assertEqual(dated.marketInputs.jahreSeitAth, years('2026-11-15', '2027-02-15'), 'P2-3: Alter bis zum Kursdatum statt Regelalter +1');
    assertEqual(phase(dated.marketInputs), 'corr_young', 'P2-3: Rückgang unter 15 % nach drei Monaten ist eine junge Korrektur');
    const undated = prepareMarketPreview({ inputs: { ...autumn, ath: 210, jahreSeitAth: 1 }, dailyPrices: series, today: '2027-02-15',
        yearEndDate: '2026-12-31', hasAnnualClose: true });
    assert(undated.high.origin === 'stored' && !undated.high.dated && undated.marketInputs.jahreSeitAth === 2, 'P2-3: Ohne belegtes Datum bleibt das Regelalter +1');
    const close = deriveMarketHigh({ inputs: autumn, quote: { price: 180, asOf: '2026-12-30' }, yearEndDate: '2025-12-31',
        storedHighAsOf: '2026-11-15', series: null, ageUntil: '2026-12-31' });
    assertEqual(close.inputs.jahreSeitAth, years('2026-11-15', '2026-12-31'), 'P2-3: Im Abschluss zählt das belegte Hoch bis zum 31.12.');

    // P3-1: Erstkauf am 01.09., Kurse erst ab dann abgefragt: Mit Historienstart 01.01. sind Januar bis August ungeprüft.
    const fromPurchase = pricesOf([['2026-09-01', 170], ['2026-11-25', 172]]);
    const reason = (dailyPrices, historyStart) => prepareMarketPreview({ inputs: { ...inputs, ath: 175, jahreSeitAth: 0 }, dailyPrices,
        today: '2026-11-26', yearEndDate: '2025-12-31', hasAnnualClose: true, historyStart }).unreliableReason;
    assertEqual(reason(fromPurchase, null), null, 'P3-1: Ohne Historienstart geprüft ab dem ersten Schluss');
    assert(String(reason(fromPurchase, '2026-01-01')).startsWith('Kursreihe hat ungeprüfte Tage'), 'P3-1: Lücken vor dem ersten Schluss sind ungeprüft');
    const fromStart = { version: 1, symbols: { 'VWCE.DE': { ...fromPurchase.symbols['VWCE.DE'], queried: [[historyDay('2026-01-01'), historyDay('2026-11-25')]] } } };
    assertEqual(reason(fromStart, '2026-01-01'), null, 'P3-1: Referenz ab Historienstart abgefragt, belastbar');
    assertEqual(readHistoryStartDate({ getItem: () => json({ version: 1, startDate: '2026-01-01' }) }), '2026-01-01', 'P3-1: Historienstart gelesen');
    assertEqual(readHistoryStartDate({ getItem: () => '{kaputt' }), null, 'P3-1: Ungültiger Historienstart zählt nicht');

    // P3-2: Der alte ETF-Handler mit Jahresendregel ohne deriveMarketHigh ist entfernt; es bleiben die lesenden Abrufe.
    const market = createAnnualMarketDataReaders();
    assert(!('handleNachrueckenMitETF' in market) && typeof market.prepareETF === 'function', 'P3-2: kein schreibender ETF-Handler mehr');
}

// Punkt 9 (FR-89, Ergänzung 3): Grundrauschen. Höchstens 5 % unter dem echten Hoch gilt für die Engine als Höchststand; gespeichert
// bleibt das echte Hoch. Punkt 10 (Ergänzung 4): nur bei einem Hoch jünger als ein Jahr.
{
    assertEqual(ATH_NOISE_BAND_PCT, 5, 'Grundrauschen 5 % an einer benannten Stelle');
    const young = { endeVJ_1: 175, endeVJ_2: 160, endeVJ_3: 150, ath: 200, jahreSeitAth: years('2026-08-12', '2026-12-31') };
    const at = endeVJ => ({ ...young, endeVJ });
    assertEqual(json(withAthNoiseBand(at(190.2))), json({ ...at(190.2), ath: 190.2, jahreSeitAth: 0 }), '4,9 %: Engine sieht ath = Kurs, Alter 0');
    assert(['peak_hot', 'peak_stable'].includes(phase(withAthNoiseBand(at(190.2)))), '4,9 % unter dem Hoch: Höchststand');
    assert(athNoiseBandApplies(at(190)) && !athNoiseBandApplies(at(189.8)), 'Genau 5 % zählt noch, 5,1 % nicht mehr');
    assertEqual(phase(withAthNoiseBand(at(189.8))), 'corr_young', '5,1 % unter dem Hoch: kein Höchststand');
    for (const [price, label] of [[170, '15 %'], [159.8, '20,1 %'], [150, '25 %']]) {
        const input = at(price);
        assertEqual(withAthNoiseBand(input), input, `${label}: Eingabe unverändert`);
        assertEqual(phase(withAthNoiseBand(at(price))), phase(at(price)), `${label}: Bär- und Erholungsschwellen ungestört`);
    }
    assert(!athNoiseBandApplies(at(200)) && !athNoiseBandApplies(at(205)), 'Auf oder über dem Hoch keine Übersetzung');
    assert(!athNoiseBandApplies({ ...at(199), jahreSeitAth: 0 }), 'Alter 0 unter dem Hoch zählt die Engine als zwölf Monate: keine Übersetzung');
    // Punkt 10: Hoch am 31.12. des Vorjahrs, Jahresende 4,5 % darunter → keine Übersetzung (Regelalter 1 oder 365 Tage = 11,99 Monate).
    for (const jahreSeitAth of [1, years('2025-12-31', '2026-12-31')]) {
        const old = { ...young, endeVJ: 191, jahreSeitAth };
        assertEqual(withAthNoiseBand(old), old, `Hoch vom Vorjahresende (${jahreSeitAth.toFixed(4)} Jahre): Engine sieht das echte Hoch`);
        assert(!['peak_hot', 'peak_stable'].includes(phase(withAthNoiseBand(old))), 'Minusjahr am Vorjahreshoch ist kein Höchststand');
    }
    const october = { ...young, endeVJ: 194, jahreSeitAth: years('2026-10-15', '2026-12-31') };
    assert(['peak_hot', 'peak_stable'].includes(phase(withAthNoiseBand(october))), 'Hoch vom Oktober, Jahresende 3 % darunter: Höchststand');
    // Gemeinsamer Weg aller Balance-Engine-Aufrufe: prepareBalanceEngineAssets übersetzt, die Eingabe selbst bleibt unverändert.
    const original = { ...at(199.68), tagesgeld: 1000 };
    const engineCopy = prepareBalanceEngineAssets(/** @type {any} */ (original)).input;
    assert(engineCopy.ath === 199.68 && engineCopy.jahreSeitAth === 0 && original.ath === 200, 'Rechenkopie übersetzt, Eingabe behält das echte Hoch');

    // 0,16 % unter dem Tageshoch bei über 10 % Jahresgewinn: heißer Höchststand und opportunistisches Auffüllen im Jahresabschluss
    // (Renate allein, damit die Handlung der Engine sichtbar bleibt; im Haushalt heißt sie „Profilverbund-Transaktionen“).
    const records = createMusterHaushaltRecords('2026-12-15', 'renate');
    const write = raw => { const state = JSON.parse(raw); state.inputs = { ...state.inputs, endeVJ: 175, endeVJ_1: 160, endeVJ_2: 150, endeVJ_3: 140, ath: 175, jahreSeitAth: 0 };
        for (const field of ['endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath', 'jahreSeitAth']) (state.balanceInputFields ||= {})[field] = { value: String(state.inputs[field]), checked: false };
        return json(state); };
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const profile of Object.values(registry.profiles)) if (profile.data[key]) profile.data[key] = write(profile.data[key]);
    records.rs_profiles_v1 = json(registry);
    const live = JSON.parse(write(records[key]));
    live.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'ath1b-noise', phase: 'writes_started' };
    records[key] = json(live);
    records[DAILY_PRICES_KEY] = json(pricesOf([['2025-12-31', 175], ['2026-08-12', 200.32], ['2026-12-30', 200]]));
    const market = { ...marketData, etf: { ...marketData.etf, price: 200 } };
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData: market, storage: annualRecordStorage(records), now });
    const stored = JSON.parse(draft.records[key]);
    assert(stored.inputs.ath === 200.32 && stored.inputs.jahreSeitAth === years('2026-08-12', '2026-12-31') && stored.annualMarketDataMeta.ath.value === 200.32
        && stored.annualMarketDataMeta.ath.lastHighAsOf === '2026-08-12', 'Gespeichert bleibt das echte Hoch mit Datum und Alter');
    const evaluation = evaluateAnnualDraft(draft, { engineApi: EngineAPI, now });
    assertEqual(evaluation.modelResult.ui.market.sKey, 'peak_hot', '0,16 % unter dem Hoch, 14 % Jahresgewinn: heißer Höchststand');
    assert(String(evaluation.modelResult.ui.action?.title).startsWith('Opportunistisches Rebalancing'), `Handlung opportunistisches Rebalancing (${evaluation.modelResult.ui.action?.title})`);
    assertEqual(phase({ endeVJ: 200, endeVJ_1: 175, endeVJ_2: 160, endeVJ_3: 150, ath: 200.32, jahreSeitAth: years('2026-08-12', '2026-12-31') }), 'corr_young',
        'Gegenprobe ohne Grundrauschen: junge Korrektur');

    // Anzeige: Zusatz am Hoch und der echte Abstand, die Marktlage aus der Engine.
    const prepared = prepareMarketPreview({ inputs: { endeVJ: 175, endeVJ_1: 160, endeVJ_2: 150, endeVJ_3: 140, ath: 175, jahreSeitAth: 0 },
        dailyPrices: pricesOf([['2025-12-31', 175], ['2026-08-12', 200.32], ['2026-11-25', 196]]), today: '2026-11-26', yearEndDate: '2025-12-31', hasAnnualClose: true });
    const view = projectMarketPreview(prepared, /** @type {any} */ ({ ui: { market: { abstandVomAthProzent: 0, sKey: 'peak_hot', szenarioText: 'Heißer Höchststand' } } }));
    const rows = Object.fromEntries(marketHighRows(view));
    assertEqual(rows.Allzeithoch, `200,32 € · Tagesschluss vom 12.08.2026 · ${ATH_NOISE_BAND_TEXT}`, 'Jahresabschluss und Vorschau nennen das Grundrauschen');
    assertEqual(ATH_NOISE_BAND_TEXT, 'gilt als Höchststand (Grundrauschen bis 5 %)', 'Wortlaut des Zusatzes');
    assert(Math.abs(view.drawdownPct - (200.32 - 196) / 200.32 * 100) < 1e-9 && rows.Marktlage === 'Heißer Höchststand', 'Echter Abstand, Marktlage der Engine');
    const tile = Object.fromEntries(withMarketHighRows(view.inputs, 'peak_hot', view, [['Abstand zum Allzeithoch', '0 %'], ['Seit dem Hoch', 'x']]));
    assert(tile.Allzeithoch.endsWith(ATH_NOISE_BAND_TEXT) && tile['Abstand zum Allzeithoch'] !== '0 %', `Marktkachel: Zusatz und echter Abstand (${tile['Abstand zum Allzeithoch']})`);
}

// Punkt 10: Split im Januar bei offenem Vorjahresabschluss wird abgelehnt; die Vorschau liefert das nächste Abschlussjahr.
{
    const inputs = { ath: 200, endeVJ: 180, endeVJ_1: 170, endeVJ_2: 160, endeVJ_3: 150 };
    let message = null;
    try { planSplit({ state: {}, inputs, asOf: '2027-01-10', ratio: 2, closingYear: 2026 }); } catch (error) { message = error.message; }
    assertEqual(message, 'Erst den Jahresabschluss 2026 durchführen, dann den Split eintragen.', 'Split im neuen Jahr vor dem offenen Abschluss abgelehnt');
    assertEqual(planSplit({ state: {}, inputs, asOf: '2026-12-15', ratio: 2, closingYear: 2026 }).after.ath, 100, 'Split im offenen Abschlussjahr bleibt möglich');
    assertEqual(planSplit({ state: {}, inputs, asOf: '2027-01-10', ratio: 2, closingYear: 2027 }).after.ath, 100, 'Nach dem Abschluss ist der Januarsplit möglich');
    const doc = new MockDocument(), host = doc.createElement('div'); host.id = 'athCorrections'; doc.body.append(host);
    renderAthCorrections(doc, { state: { inputs: { ...inputs, jahreSeitAth: 0 } }, view: /** @type {any} */ ({ yearEndDate: '2025-12-31',
        high: { value: 200, asOf: null, origin: 'stored', dated: false, source: 'stored', splitAsOf: null }, warnings: { outlier: null, drop: null } }) });
    assertEqual(host.dataset.athClosingYear, '2026', 'Offener Abschluss 2026: Vorschau mit Jahresende 2025 ergibt Abschlussjahr 2026');
}

// UI-1 (Gutachten): Gerundet angezeigtes Allzeithoch löst beim Öffnen keine Senkungswarnung aus; Nutzeränderung und Split-Neuanzeige.
{
    const doc = new MockDocument();
    renderAthCorrections(doc, { state: { inputs: { ath: 145.890673 }, annualMarketDataMeta: { asOf: '2026-12-31', ath: { value: 145.890673, lastHighAsOf: '2026-08-12' } } }, view: null });
    const field = doc.getElementById('ath');
    setExactFieldValue(field, 145.890673, 2);
    assertEqual(field.value, '145.89', 'Allzeithoch wird gerundet angezeigt');
    assertEqual(readExactFieldValue(field), '145.890673', 'Lesen liefert den Rohwert');
    updateAthLowerWarning(doc);
    assert(doc.getElementById('athLowerWarning').hidden, 'Beim Öffnen keine Senkungswarnung durch die Rundung');
    field.value = '140';
    assertEqual(readExactFieldValue(field), '140', 'Geänderter Wert wird gelesen');
    updateAthLowerWarning(doc);
    assert(!doc.getElementById('athLowerWarning').hidden, 'Echte Senkung warnt weiter');
    setExactFieldValue(field, 72.9453365, 2);
    assertEqual(field.value + '|' + readExactFieldValue(field), '72.95|72.9453365', 'Nach dem Split: neuer Rohwert, Anzeige neu gerundet');
}

// ATH-1c (Gutachten zu ATH-1b): Im Ausprobieren schreibt keine Korrektur; ohne Jahresstand wird kein Split eingetragen.
{
    const setup = (options = {}) => {
        const doc = new MockDocument(), host = doc.createElement('div'), status = doc.createElement('p');
        host.id = 'athCorrections'; status.id = 'athSplitStatus'; status.hidden = true;
        doc.body.append(host, status);
        for (const [id, value] of Object.entries({ athSplitDate: '2026-06-15', athSplitRatio: '2', ath: '200', endeVJ: '180', endeVJ_1: '170', endeVJ_2: '160', endeVJ_3: '150' })) {
            const input = doc.createElement('input'); input.id = id; input.value = value; doc.body.append(input);
        }
        const saves = [], updates = [];
        const storage = /** @type {any} */ ({ loadState: () => ({ inputs: { ath: 200, endeVJ: 180 } }), saveState: state => { saves.push(state); } });
        bindAthCorrections(doc, { update: request => { updates.push(request); }, storage, ...options });
        const click = async dataset => Promise.all(doc.listeners.click.map(listener => listener({ target: { closest: () => ({ dataset }) } })));
        return { doc, host, status, saves, updates, click };
    };
    const locked = setup({ trialActive: () => true });
    for (const dataset of [{ athIgnore: '2026-03-03' }, { athRestore: '2026-03-03' }, { athSplitSubmit: '' }]) await locked.click(dataset);
    assert(locked.saves.length === 0 && locked.updates.length === 0, 'Im Ausprobieren schreiben nicht verwenden, Wieder verwenden und Split nichts');
    assert(!locked.status.hidden && locked.status.textContent === ATH_TRIAL_LOCKED_TEXT, 'Sichtbarer Satz „Im Ausprobieren nicht möglich – erst ‚Zurück zum Plan‘.“');
    const registered = new MockDocument();
    registerPlanTrial(registered, /** @type {any} */ ({ read: () => ({ active: true }) }));
    let wrote = false;
    bindAthCorrections(registered, { update() { wrote = true; }, storage: /** @type {any} */ ({ loadState: () => ({}), saveState() { wrote = true; } }) });
    await Promise.all(registered.listeners.click.map(listener => listener({ target: { closest: () => ({ dataset: { athIgnore: '2026-03-03' } }) } })));
    assert(!wrote, 'Der registrierte Versuch der Seite sperrt die Korrekturen');
    const free = setup({ trialActive: () => false });
    await free.click({ athIgnore: '2026-03-03' });
    assert(free.saves.length === 1 && json(free.saves[0][ATH_CORRECTIONS_KEY].ignoredCloses) === json(['2026-03-03']) && free.updates.length === 1,
        'Ohne Versuch wie bisher: markieren, speichern, neu rechnen');
    await free.click({ athSplitSubmit: '' });
    assert(free.saves.length === 1 && free.status.textContent === ATH_SPLIT_YEAR_UNKNOWN_TEXT, 'Ohne Jahresstand der Vorschau kein Split');
    assertEqual(ATH_SPLIT_YEAR_UNKNOWN_TEXT, 'Jahresstand gerade unklar – Split bitte später eintragen.', 'Wortlaut der Ablehnung');
}

// FIX-ST9 (Befund 1612): Im Ausprobieren sind die Korrekturen von Anfang an sichtbar gesperrt, mit Satz über dem Block.
{
    const doc = new MockDocument(), host = doc.createElement('div'); host.id = 'athCorrections'; doc.body.append(host);
    const state = ignoreDailyClose({ inputs: { ath: 210, endeVJ: 180, endeVJ_1: 170, endeVJ_2: 160, endeVJ_3: 150, jahreSeitAth: 0 } }, '2026-03-03');
    const view = /** @type {any} */ ({ yearEndDate: '2025-12-31', high: { value: 210, asOf: '2026-08-12', origin: 'daily_close', dated: true, source: 'daily', splitAsOf: null },
        warnings: { outlier: null, drop: null } });
    const walk = node => node.children.flatMap(child => [child, ...walk(child)]);
    const controls = () => walk(host).filter(node => 'athIgnore' in node.dataset || 'athRestore' in node.dataset || 'athSplitSubmit' in node.dataset
        || ['athSplitDate', 'athSplitRatio'].includes(node.id));
    const note = () => walk(host).find(node => 'athTrialLock' in node.dataset);
    renderAthCorrections(doc, { state, view, trialActive: true });
    assertEqual(controls().length, 5, 'nicht verwenden, Wieder verwenden, Split eintragen und beide Split-Felder vorhanden');
    assert(controls().every(node => node.disabled === true), 'Im Ausprobieren sind alle Korrekturen gesperrt (disabled)');
    assert(note() && !note().hidden && note().textContent === ATH_TRIAL_LOCKED_TEXT && host.children[0].children[0] === note(), 'Satz steht von Anfang an über dem Block');
    renderAthCorrections(doc, { state, view, trialActive: false });
    assert(controls().every(node => !node.disabled) && note().hidden, 'Ohne Versuch: alles frei, kein Satz');
    let active = true;
    bindAthCorrections(doc, { update() {}, storage: /** @type {any} */ ({ loadState: () => state, saveState() {} }), trialActive: () => active });
    doc.dispatchEvent(new Event('balance:plan-trial'));
    assert(controls().every(node => node.disabled === true) && !note().hidden, 'Start des Versuchs sperrt sofort');
    active = false;
    doc.dispatchEvent(new Event('balance:plan-trial'));
    assert(controls().every(node => !node.disabled) && note().hidden, '„Zurück zum Plan“ gibt sofort frei');
}

// FIX-ST9 (Befund 1604): „Ende …“ trägt das Jahr des gespeicherten Standes. Testdatum 05.01.2027.
{
    const yearEnd = occasion => `${projectBalanceActionOrigin({ year: 2027, occasion }).previewYear - 1}-12-31`;
    const completed = 2026;
    const nodes = Object.fromEntries(['endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3'].map(id => [id, { textContent: '' }]));
    const note = { hidden: true, textContent: '' };
    const doc = /** @type {any} */ ({ querySelector: selector => nodes[/label\[for="([^"]+)"\]/.exec(selector)?.[1]] ?? null,
        getElementById: id => id === 'balanceMarketYearNote' ? note : null });
    const labels = () => Object.values(nodes).map(node => node.textContent).join(' · ');
    const open = storedMarketYear({ view: { yearEndDate: yearEnd({ annualState: 'open', closingYear: 2026 }) }, state: null, fallback: completed });
    assertEqual(open, 2025, 'Letzter Abschluss 2025, Abschluss 2026 offen: Stand 2025');
    renderMarketYearLabels(doc, open, completed);
    assertEqual(labels(), 'Ende 2025 · Ende 2024 · Ende 2023 · Ende 2022', 'Felder heißen Ende 2025 … Ende 2022');
    assert(!note.hidden && note.textContent === 'Der Schluss 2026 kommt mit dem Jahresabschluss.', 'Satz zum offenen Schluss 2026');
    const done = storedMarketYear({ view: { yearEndDate: yearEnd({ annualState: 'done', closingYear: 2026 }) }, state: null, fallback: completed });
    assertEqual(done, 2026, 'Nach dem Abschluss 2026: Stand 2026');
    renderMarketYearLabels(doc, done, completed);
    assert(labels().startsWith('Ende 2026 · ') && note.hidden && note.textContent === '', 'Nach dem Abschluss: Ende 2026, kein Satz');
    assertEqual(storedMarketYear({ view: { yearEndDate: null }, state: { annualMarketDataMeta: { targetYear: 2025 } }, fallback: completed }), 2025, 'Ohne Vorschau: Jahr aus annualMarketDataMeta');
    assertEqual(storedMarketYear({ state: { annualPeriodMetadata: { lastCommittedPeriod: 'calendar-year:2025' } }, fallback: completed }), 2025, 'Sonst: zuletzt abgeschlossener Zeitraum');
    assertEqual(storedMarketYear({ state: {}, fallback: completed }), 2026, 'Ohne gespeicherten Stand: letztes Kalenderjahr');
}
