import { formatDisplayNumber, formatDisplayDate } from '../app/shared/designsystem-number-format.js';
import { formatPercentValue, formatPercentRatio } from '../app/shared/shared-formatting.js';
import { formatDisplayPercentValue, formatDisplayPercentRatio } from '../app/shared/shared-formatting.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { buildTranchenTableHtml, buildTranchenStatsHtml } from '../app/tranches/tranchen-manager-renderer.js';
import { renderBalanceWealthHistory } from '../app/balance/balance-wealth-history-renderer.js';
import { renderBalanceExpensesHistory } from '../app/balance/balance-expenses-history-renderer.js';
import { createManualWealthHistoryEntry } from '../types/wealth-history-contract.js';
import { createPresentationTestDocument, readSources } from './designsystem-source-contract.mjs';

for (const [value, options, expected] of [
    [0, {}, '0,0'], [null, {}, '— (Wert fehlt)'], [undefined, { reason: 'keine Beobachtung' }, '— (keine Beobachtung)'],
    [NaN, {}, '— (Wert fehlt)'], [1, { applicable: false, reason: 'kein Ziel' }, 'Nicht anwendbar (kein Ziel)'],
    [Infinity, { allowInfinity: true }, '∞'], [Infinity, { unit: 'years', allowInfinity: true }, '∞\u00a0Jahre'],
    [Infinity, {}, '— (Wert fehlt)'], [-Infinity, { allowInfinity: true }, '— (Wert fehlt)'],
    [12.3, { unit: 'percent' }, '12,3\u00a0%'], [.123, { unit: 'ratio' }, '12,3\u00a0%'],
    [1234.56, { unit: 'currency', fractionDigits: 2 }, '1.234,56\u00a0€'],
    [2, { unit: 'years' }, '2,0\u00a0Jahre'], [4, { unit: 'months', fractionDigits: 0 }, '4\u00a0Monate'],
    [10.12, { unit: 'price', fractionDigits: 2 }, '10,12\u00a0€/Stück'], ['12.3', {}, '— (Wert fehlt)']
]) assertEqual(formatDisplayNumber(value, options), expected, `Deutsche Anzeige unterscheidet Wert und Verfügbarkeit: ${expected}`);
assertEqual(formatPercentValue(12.3, { fractionDigits: 1 }), '12.3%', 'Bestehender Prozentwertvertrag bleibt kompatibel');
assertEqual(formatPercentRatio(.123, { fractionDigits: 1 }), '12.3%', 'Bestehender Ratiovertrag bleibt kompatibel');
assertEqual(formatDisplayDate('2024-01-02'), '02.01.2024', 'ISO-Speichertag erscheint ohne Zeitzonenwechsel deutsch');
assertEqual(formatDisplayDate(null), '— (Datum fehlt)', 'Fehlender Tag wird nicht erfunden');
for (const [value, options, expected] of [
    [75, { fractionDigits: 1 }, '75,0\u00a0%'], [75, { fractionDigits: 2 }, '75,00\u00a0%'],
    [0, { fractionDigits: 1, prefixPlus: true }, '0,0\u00a0%'],
    [-75, { fractionDigits: 1 }, '-75,0\u00a0%'], [75, { fractionDigits: 1, prefixPlus: true }, '+75,0\u00a0%'],
    [null, {}, 'N/A'], [NaN, { invalid: null }, null], [Infinity, { invalid: 'n/a' }, 'n/a']
]) assertEqual(formatDisplayPercentValue(value, options), expected, `Anzeigeprozent erhält Genauigkeit, Vorzeichen und Fehlwert: ${expected}`);
assertEqual(formatDisplayPercentRatio(.75, { fractionDigits: 1 }), '75,0\u00a0%', 'Anzeige-Ratio skaliert genau einmal');
assertEqual(formatDisplayNumber(12345.6, { unit: 'currency', fractionDigits: 2 }), '12.345,60\u00a0€', 'Tausenderpunkte und geschützter Euroabstand sind unabhängig geschützt');
for (const [value, expected] of [[1.005, '1,00\u00a0%'], [2.675, '2,67\u00a0%'], [-.005, '-0,01\u00a0%']]) {
    assertEqual(formatDisplayPercentValue(value, { fractionDigits: 2 }), expected, 'Prozentanzeige behält die bestehende binäre toFixed-Rundung');
}

const doc = createPresentationTestDocument(), previous = globalThis.document;
globalThis.document = doc;
try {
    const outputs = { miniSummary: doc.createElement('div') };
    const renderer = new SummaryRenderer({ outputs });
    const ui = { input: { floorBedarf: 10000, flexBedarf: 20000, renteAktiv: false, tagesgeld: 12000, geldmarktEtf: 3000 },
        action: { verwendungen: { liquiditaet: 2000 } }, liquiditaet: { deckungVorher: 12.3, deckungNachher: 23.4 }, runway: { months: 4, status: 'warn' } };
    const before = JSON.stringify(ui);
    renderer.renderMiniSummary(ui);
    const items = outputs.miniSummary.children[0].children;
    assertEqual(items[0].children[1].textContent, '12,3\u00a0% → ', 'Vorher zeigt Prozentwert einmal und ohne Ratio-Neuskalierung');
    assertEqual(items[0].children[1].children[0].textContent, '23,4\u00a0%', 'Nachher zeigt exakt ein Prozentzeichen');
    assertEqual(items[2].children[1].textContent, '1,5\u00a0Jahre → ', 'Reichweite erhält die bestehende Jahresskalierung');
    assertEqual(items[2].children[1].children[0].textContent, '1,7\u00a0Jahre', 'Nachher-Reichweite bleibt berechnungsidentisch');
    assertEqual(JSON.stringify(ui), before, 'MiniSummary verändert keine Eingaben oder Metriken');
    ui.liquiditaet = { deckungVorher: 75, deckungNachher: 75 };
    renderer.renderMiniSummary(ui);
    assertEqual(outputs.miniSummary.children[0].children[0].children[1].textContent, '75,0\u00a0% → ', 'Zusammenfassung zeigt 75 Prozent mit unverändert einer Nachkommastelle');
    assertEqual(outputs.miniSummary.children[0].children[0].children[1].children[0].textContent, '75,0\u00a0%', 'Zusammenfassung verwendet auch nachher exakt U+00A0');
    ui.input.floorBedarf = 0;
    renderer.renderMiniSummary(ui);
    assertEqual(outputs.miniSummary.children[0].children[2].children[1].children[0].textContent, '∞\u00a0Jahre', 'Fachlich vorhandene unendliche Floor-Reichweite behält ihre Einheit');
    ui.liquiditaet.deckungNachher = null;
    renderer.renderMiniSummary(ui);
    assertEqual(outputs.miniSummary.children[0].children[0].children[1].children[0].textContent, '— (Wert fehlt)', 'Fehlende Deckung wird nicht zu Null');
} finally { globalThis.document = previous; }

const lots = [{ trancheId: 'synthetisch', name: 'Synthetischer Bestand', purchaseDate: '2024-01-02', shares: 2.125,
    purchasePrice: 1234.56, currentPrice: 1358.016, marketValue: 2885.784, costBasis: 2623.44, type: 'aktien_neu', tqf: .3 }];
const beforeLots = JSON.stringify(lots);
const table = buildTranchenTableHtml(lots);
for (const text of ['02.01.2024', '2,125', '1.234,56\u00a0€/Stück', '1.358,02\u00a0€/Stück', '+10,0\u00a0%', 'Gewinn (€ / %)']) assert(table.includes(text), `Manager nennt deutsche Zahl und Einheit: ${text}`);
assert(buildTranchenStatsHtml(lots).includes('Gesamtwert der Tranchen (ohne Tagesgeld)'), 'Manager grenzt die Bestandssumme sichtbar ab');
const missing = buildTranchenTableHtml([{ ...lots[0], shares: null, purchasePrice: null, currentPrice: 0 }]);
assert(missing.includes('— (Wert fehlt)') && missing.includes('0,00\u00a0€/Stück'), 'Manager unterscheidet fehlenden Preis und echten Nullpreis');
assertEqual(JSON.stringify(lots), beforeLots, 'Datum, Werte und Exportgrundlage bleiben numerisch/ISO und unverändert');
const seventyFiveLot = { ...lots[0], shares: 1, purchasePrice: 100, currentPrice: 175, marketValue: 175, costBasis: 100 };
assert(buildTranchenTableHtml([seventyFiveLot]).includes('+75,0\u00a0%'), 'Tranchentabelle zeigt 75 Prozent mit einer Nachkommastelle');
assert(buildTranchenStatsHtml([seventyFiveLot]).includes('+75,0\u00a0%'), 'Tranchenstatistik zeigt Gewinnprozent mit einer Nachkommastelle');
for (const text of ['175\u00a0€', '100\u00a0€', '+75\u00a0€']) {
    assert(buildTranchenStatsHtml([seventyFiveLot]).includes(text), `Managerstatistik verwendet den geschützten Euroabstand: ${text}`);
    assert(buildTranchenTableHtml([seventyFiveLot]).includes(text), `Tranchentabelle verwendet den geschützten Euroabstand: ${text}`);
}

const previousManagerZone = process.env.TZ;
const datedLots = [{ ...seventyFiveLot, asOf: Date.parse('2024-01-01T23:30:00Z') / 1000 }];
const beforeDatedLots = JSON.stringify(datedLots);
try {
    for (const [zone, shortDate, fullDate] of [['UTC', '01.01.', '01.01.2024'], ['Europe/Berlin', '02.01.', '02.01.2024']]) {
        process.env.TZ = zone;
        assert(buildTranchenTableHtml(datedLots).includes(`class="pv-quote-date">Kurs ${shortDate}</small>`), 'Managerkurs zeigt das lokale Kurzdatum aus gespeichertem asOf');
        assert(buildTranchenStatsHtml(datedLots).includes(fullDate), 'Managerstatistik zeigt den lokalen Kursstand statt ISO-/UTC-Datum');
    }
    assertEqual(JSON.stringify(datedLots), beforeDatedLots, 'Lokale Kursanzeige verändert weder asOf noch numerische Depotwerte');
} finally {
    if (previousManagerZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousManagerZone;
}

const state = { wealthHistory: { schemaVersion: 1, entries: Array.from({ length: 20 }, (_, i) =>
    createManualWealthHistoryEntry({ tagesgeld: 1000 + i, geldmarktEtf: 2000, depotwertAlt: 3000, depotwertNeu: 4000 }, `${2026 + i}-01-02`)) } };
const beforeState = JSON.stringify(state);
let active = false;
const wealth = { panel: { classList: { contains: () => active } }, chart: { innerHTML: '' }, table: { innerHTML: '' }, hint: { textContent: '' } };
renderBalanceWealthHistory(wealth, state);
assertEqual(wealth.chart.innerHTML, '', 'Inaktiver Verlauf erzeugt keine Diagrammdetails');
active = true;
renderBalanceWealthHistory(wealth, state);
assert(wealth.chart.innerHTML.includes('min-width:2110px'), 'Gefüllter Verlauf behält die datenabhängige Diagrammbreite');
assert(wealth.table.innerHTML.includes('Erfasste Vermögensstände') && wealth.table.innerHTML.includes('nominale Euro'), 'Vermögensdaten nennen gespeicherten Kontext und Einheit');
assertEqual(JSON.stringify(state), beforeState, 'Verlaufsanzeige verändert keine gespeicherten Stände');
const expenses = { panel: { classList: { contains: () => active } }, chart: { innerHTML: '' }, table: { innerHTML: '' }, hint: { textContent: '' } };
const store = { version: 1, years: { '2026': { months: { '1': { profiles: { a: { categories: { Test: -100 } }, b: { categories: { Test: -50 } } } } } } } };
const beforeStore = JSON.stringify(store);
renderBalanceExpensesHistory(expenses, { ok: true, store }, 2026);
assert(expenses.table.innerHTML.includes('Alle gespeicherten Profile') && expenses.table.innerHTML.includes('laufendes Teiljahr') && expenses.table.innerHTML.includes('150'), 'Ausgabenverlauf nennt alle Profile und den bestehenden Teiljahresbezug');
assertEqual(JSON.stringify(store), beforeStore, 'Verlaufsanzeige verändert keine Ausgabensummen/Exportdaten');

const sources = readSources();
assert(sources['Ausgaben.html'].includes('Vergleich aller gespeicherten Personen, unabhängig vom Anzeigefilter.')
    && sources['app/balance/balance-expenses-renderer.js'].includes('Summe der gewählten Profile'), 'Jahresvergleich und Matrix nennen ihre unterschiedlichen vorhandenen Profilbezüge');
assert(sources['css/components.css'].includes('font-variant-numeric: tabular-nums'), 'Managerzahlspalten nutzen die tabellarische Tabellenrolle');

// Slice 9: Ausgabegrenzen ohne andere Rundung an binären Halbwerten.
const { formatDisplayFixed, formatDisplayScalar } = await import('../app/shared/designsystem-number-format.js');
for (const value of [0, -0, 1.005, 2.675, -.005, 123456.789, Infinity, NaN]) {
    for (const digits of [0, 1, 2, 3]) assertEqual(formatDisplayFixed(value, digits).replace(',', '.'), value.toFixed(digits), 'UI-Fixed erhält die ursprüngliche toFixed-Rundung einschließlich Sonderwert');
}
assertEqual(formatDisplayScalar(.000001), '0,000001', 'Parameterdarstellung rundet keine zusätzlichen Dezimalstellen');
assertEqual(formatDisplayScalar('standard'), 'standard', 'Nichtnumerischer Parameter bleibt identisch');
const { BACKTEST_LOG_DETAIL_KEY, getWorstRunColumnDefinitions, renderWorstRunLog } = await import('../app/simulator/simulator-results.js');
const { persistenceStorage } = await import('../app/shared/persistence-facade.js');
const columns = getWorstRunColumnDefinitions({ logDetailLevel: 'detailed' });
for (const [key, value, expected] of [
    ['QuoteEndPct', 12.3, '12,3\u00a0%'], ['NominalReturnEquityPct', .123, '12,3\u00a0%'],
    ['vpw.vpwRate', .0345, '3,5\u00a0%'], ['vpw.capeRatioUsed', 25.15, '25,1'],
    ['vpw.expectedRealReturn', -.015, '-1,5\u00a0%'], ['RunwayCoveragePct', 0, '0\u00a0%'],
    ['RunwayCoveragePct', null, ''], ['vpw.expectedRealReturn', null, '']
]) assertEqual(columns.find(column => column.key === key).fmt(value), expected, `Logdarstellung erhält Skalierung/Verfügbarkeit: ${key}`);
const logRows = [{ QuoteEndPct: 12.3, NominalReturnEquityPct: .123, jahresentnahme_real: 1234.56 }];
const originalLog = JSON.stringify(logRows);
const renderedLog = renderWorstRunLog(logRows, 0, { logDetailLevel: 'detailed' });
assert(renderedLog.includes('12,3\u00a0%'), 'Tatsächliches Log enthält deutsche Prozenttexte');
assertEqual(JSON.stringify(logRows), originalLog, 'Logdarstellung lässt die numerische Exportgrundlage unverändert');
assert(renderWorstRunLog([{ QuoteEndPct: 75 }], 0, { logDetailLevel: 'detailed' }).includes('75,0\u00a0%'), 'Simulatortabelle zeigt 75 Prozent mit unverändert einer Nachkommastelle');
const { renderBacktestLog } = await import('../app/simulator/simulator-backtest.js');
const backtestRows = [{ jahr: 2025, row: { QuoteEndPct: 75 } }];
const previousWindow = globalThis.window, previousBacktestDocument = globalThis.document;
const previousGetItem = persistenceStorage.getItem;
const backtestLog = { innerHTML: '' }, backtestBefore = JSON.stringify(backtestRows);
try {
    globalThis.window = { globalBacktestData: { rows: backtestRows } };
    globalThis.document = { getElementById: id => id === 'simulationLog' ? backtestLog : null };
    // QuoteEndPct gehört zur Detailansicht; die Formatierungsprobe wählt sie ausdrücklich.
    persistenceStorage.getItem = key => key === BACKTEST_LOG_DETAIL_KEY ? 'detailed' : previousGetItem(key);
    renderBacktestLog();
    assert(backtestLog.innerHTML.includes('75,0\u00a0%'), 'Echter Backtestrenderer verwendet den Anzeigezweig mit einer Nachkommastelle');
    assertEqual(JSON.stringify(backtestRows), backtestBefore, 'Backtestanzeige verändert keine Exportgrundlage');
} finally {
    persistenceStorage.getItem = previousGetItem;
    globalThis.window = previousWindow;
    globalThis.document = previousBacktestDocument;
}
