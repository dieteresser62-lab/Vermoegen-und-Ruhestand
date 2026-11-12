// TH-2: „Tageskurse neu laden“ für ein erfundenes Wertpapier nach einem Split 1:5.
import { historyDay, WEALTH_HISTORY_START_KEY, DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';
import { reloadSymbolHistory, historyReloadIntervals, historyReloadReason } from '../app/tranches/tranchen-history-reload.js';
import { evaluateWealthHistory, historyPriceAt } from '../app/tranches/tranchen-history-model.js';
import { readManagerHistoryContext, buildTrancheHistoryDetail, projectTrancheHistory } from '../app/tranches/tranchen-history-ui.js';
import { splitHintHtml, reloadPricesButtonHtml, setReloadPricesProgress, reloadPricesDoneText } from '../app/tranches/tranche-split-hint.js';
import { scopeWebStorage, PLAY_STORAGE_PREFIX } from '../app/shared/persistence-area-storage.js';

console.log('--- Tageskurse neu laden (TH-2) ---');
const today = '2026-03-10', splitDay = historyDay('2026-03-02'), first = historyDay('2026-02-02'), last = historyDay(today) - 1;
const weekdays = (from, to) => { const days = []; for (let day = from; day <= to; day++) if (![0, 6].includes(new Date(day * 86400000).getUTCDay())) days.push(day); return days; };
const lot = { schemaVersion: 1, trancheId: 'muster-1', name: 'Muster Technik AG', isin: '', ticker: 'MUSTER.DE', shares: 5000, purchasePrice: 20,
    currentPrice: 30, purchaseDate: '2026-02-02', category: 'equity', type: 'aktien_neu', tqf: 0, notes: '' };
const other = { ...lot, trancheId: 'andere-1', name: 'Andere Werte AG', ticker: 'ANDERE.DE', shares: 10 };
const oldDays = weekdays(first, last);
const prices = { version: 1, symbols: {
    'MUSTER.DE': { currency: 'EUR', days: oldDays, closes: oldDays.map(day => day < splitDay ? 150 : 30), queried: [[first, last]], failures: 0, lastError: null },
    'ANDERE.DE': { currency: 'EUR', days: oldDays, closes: oldDays.map(() => 12.5), queried: [[first, last]], failures: 0, lastError: null } } };
const registry = { version: 1, profiles: {
    default: { meta: { id: 'default', name: 'Muster' }, data: { depot_tranchen: JSON.stringify([lot]) } },
    b: { meta: { id: 'b', name: 'Partner' }, data: { depot_tranchen: JSON.stringify([other]) } } } };
function memory(entries = {}) {
    const map = new Map(Object.entries(entries)), writes = [];
    return { map, writes, getItem: key => map.get(key) ?? null, setItem: (key, value) => { writes.push(key); map.set(key, String(value)); },
        removeItem: key => { writes.push(key); map.delete(key); }, key: index => [...map.keys()][index] ?? null, get length() { return map.size; } };
}
const records = () => ({ rs_profiles_v1: JSON.stringify(registry), depot_tranchen: JSON.stringify([lot]), rs_current_profile: 'default', rs_active_profile: 'default',
    [WEALTH_HISTORY_START_KEY]: JSON.stringify({ version: 1, startDate: '2026-01-01', confirmed: true }), [DAILY_PRICES_KEY]: JSON.stringify(prices) });
const chart = (url, close = () => 30, skip = () => false) => {
    const params = new URL(url).searchParams, from = Number(params.get('period1')) / 86400, to = Number(params.get('period2')) / 86400 - 1;
    const days = weekdays(from, to).filter(day => !skip(day));
    return { ok: true, json: async () => ({ chart: { error: null, result: [{ meta: { symbol: params.get('symbol'), currency: 'EUR', exchangeTimezoneName: 'Europe/Berlin' },
        timestamp: days.map(day => day * 86400 + 12 * 3600), indicators: { quote: [{ close: days.map(close) }] } }] } }) };
};
const wealthBeforeSplit = storage => {
    const stored = JSON.parse(storage.getItem(DAILY_PRICES_KEY));
    const history = evaluateWealthHistory({ profiles: [{ id: 'default', currentCash: 0, lots: [lot] }], prices: stored, startDate: '2026-01-01', today });
    return history.points.find(point => point.day === splitDay - 3).total;
};

// Ausgangslage: alte Schlusskurse ungeteilt, Tranche schon korrigiert → Stufe am Splittag.
const storage = memory(records());
assertEqual(wealthBeforeSplit(storage), 750000, 'Vorher: Vermögensverlauf vor dem Splittag zu hoch (5.000 × 150 €)');
assertEqual(JSON.stringify(historyReloadIntervals('muster.de', { storage, today })), JSON.stringify([[first, last]]), 'Zeitraum wie beim Start: ab Kauf bis gestern');
assertEqual(storage.writes.length, 0, 'Zeitraum ermitteln schreibt nie');

// Lesen und Anzeigen schreiben nie; der Knopf steht am Hinweis und im Kursverlauf der Tranche.
const context = readManagerHistoryContext(registry, { storage, today });
const detail = buildTrancheHistoryDetail(lot, projectTrancheHistory(lot, context, 'default'));
assert(detail.includes('data-action="reload-prices"') && detail.includes('Tageskurse neu laden'), 'Kursverlauf der Tranche zeigt den Knopf');
const hint = splitHintHtml({ ...lot, currentPrice: 30, asOf: splitDay * 86400 + 15 * 3600 }, { status: 'ready', prices: { version: 1, symbols: { 'MUSTER.DE': {
    ...prices.symbols['MUSTER.DE'], days: oldDays.filter(day => day < splitDay), closes: oldDays.filter(day => day < splitDay).map(() => 150), queried: [[first, splitDay - 1]] } } } });
assert(hint.includes('data-action="reload-prices"') && hint.includes('data-tranche-id="muster-1"'), 'Hinweis „Möglicher Split“ zeigt den Knopf');
assertEqual(storage.writes.length, 0, 'Lesen und Anzeigen schreiben nie');

// Scheitern lässt alles bytegleich: offline, Dienstfehler, Lücke, leere Antwort, Kontextwechsel.
const failures = [
    ['offline', async () => { throw new Error('offline'); }, 'nicht erreichbar'],
    ['HTTP 500', async () => ({ ok: false, status: 500 }), 'nicht erreichbar'],
    ['Lücke', async url => chart(url, () => 30, day => day === splitDay - 10), 'nicht alle'],
    ['leer', async url => chart(url, () => 30, () => true), 'keine Tageskurse'],
    ['Kontextwechsel', async url => { failing.map.set('depot_tranchen', JSON.stringify([{ ...lot, shares: 1 }])); return chart(url); }, 'geändert']
];
let failing;
for (const [label, fetchImpl, expected] of failures) {
    failing = memory(records());
    const before = JSON.stringify([...failing.map]);
    let error;
    try { await reloadSymbolHistory('MUSTER.DE', { storage: failing, today, fetchImpl, flush: async () => true }); } catch (e) { error = e; }
    assert(error, `${label}: Neu laden meldet einen Fehler`);
    assert(historyReloadReason(error).includes(expected), `${label}: verständlicher Grund`);
    if (label !== 'Kontextwechsel') assertEqual(JSON.stringify([...failing.map]), before, `${label}: alle Records bytegleich`);
    else assertEqual(failing.getItem(DAILY_PRICES_KEY), JSON.stringify(prices), `${label}: Tageskurse bytegleich`);
    assertEqual(failing.writes.filter(key => key !== 'depot_tranchen').length, 0, `${label}: kein Write`);
}
assertEqual(historyReloadReason({ code: 'HISTORY_RELOAD_GAP' }), 'Der Kursdienst hat nicht alle Handelstage geliefert.', 'Lücke wird benannt');

// Erfolg: ein Abruf, ein Commit, nur MUSTER.DE ersetzt; Verlauf ohne Stufe.
const requests = [];
const result = await reloadSymbolHistory('MUSTER.DE', { storage, today, flush: async () => true, fetchImpl: async url => { requests.push(url); return chart(url); } });
assertEqual(requests.length, 1, 'Ein Abruf über den ganzen Zeitraum');
assertEqual(result.days, oldDays.length, 'Alle Tage neu geladen');
assertEqual(JSON.stringify(storage.writes), JSON.stringify([DAILY_PRICES_KEY]), 'Ein einziger Write nur der Tageskurse');
const stored = JSON.parse(storage.getItem(DAILY_PRICES_KEY));
assert(stored.symbols['MUSTER.DE'].closes.every(close => close === 30), 'Alte Schlusskurse im neuen Maßstab');
assertEqual(JSON.stringify(stored.symbols['MUSTER.DE'].queried), JSON.stringify([[first, last]]), 'Abfrageabdeckung ersetzt');
assertEqual(JSON.stringify(stored.symbols['ANDERE.DE']), JSON.stringify(prices.symbols['ANDERE.DE']), 'Anderes Wertpapier bytegleich');
for (const [key, raw] of Object.entries(records())) if (key !== DAILY_PRICES_KEY) assertEqual(storage.getItem(key), raw, `${key} bytegleich`);
assertEqual(wealthBeforeSplit(storage), 150000, 'Nachher: Vermögensverlauf ohne Stufe (5.000 × 30 €)');

// Spielbereich: nur die Spielkopie wird ersetzt, echte Schlüssel bleiben bytegleich.
const physical = memory({ ...records(), ...Object.fromEntries(Object.entries(records()).map(([key, raw]) => [PLAY_STORAGE_PREFIX + key, raw])) });
const realBefore = JSON.stringify([...physical.map].filter(([key]) => !key.startsWith(PLAY_STORAGE_PREFIX)));
await reloadSymbolHistory('MUSTER.DE', { storage: scopeWebStorage(physical, 'spiel'), today, flush: async () => true, fetchImpl: async url => chart(url) });
assertEqual(JSON.stringify([...physical.map].filter(([key]) => !key.startsWith(PLAY_STORAGE_PREFIX))), realBefore, 'Spielbereich schreibt nie in echte Daten');
assertEqual(JSON.stringify(physical.writes), JSON.stringify([PLAY_STORAGE_PREFIX + DAILY_PRICES_KEY]), 'Nur die Spielkopie der Tageskurse');
// TH-2b: abgeschnittene Antwort. Bis Freitag angefragt, nur Montag und Dienstag geliefert → kein Austausch, Freitag bleibt offen.
const mo = historyDay('2026-02-02'), di = mo + 1, mi = mo + 2, fr = mo + 4;
const shortPrices = (record) => JSON.stringify({ version: 1, symbols: { 'MUSTER.DE': { currency: 'EUR', failures: 0, lastError: null, ...record } } });
const cut = memory({ ...records(), [DAILY_PRICES_KEY]: shortPrices({ days: [mo, di], closes: [100, 100], queried: [[mo, di]] }) });
const cutBefore = JSON.stringify([...cut.map]);
let cutError;
try { await reloadSymbolHistory('MUSTER.DE', { storage: cut, today: '2026-02-07', flush: async () => true, fetchImpl: async url => chart(url, () => 99, day => day > di) }); } catch (e) { cutError = e; }
assert(cutError && historyReloadReason(cutError).includes('nicht alle'), 'Abgeschnittene Antwort: Abbruch mit Grund');
assertEqual(JSON.stringify([...cut.map]), cutBefore, 'Abgeschnittene Antwort: alle Records bytegleich');
const cutRecord = JSON.parse(cut.getItem(DAILY_PRICES_KEY)).symbols['MUSTER.DE'];
assertEqual(historyPriceAt(cutRecord, fr).status, 'open-gap', 'Abgeschnittene Antwort: Freitag bleibt offene Lücke');
assertEqual(historyPriceAt(cutRecord, fr).queried, false, 'Abgeschnittene Antwort: Freitag gilt nicht als abgefragt');
// Ein früher ohne Schluss abgefragter Feiertag gilt als belegte Handelspause; kein Abbruch, Abdeckung bleibt.
const holiday = memory({ ...records(), [DAILY_PRICES_KEY]: shortPrices({ days: [mo, di, mi + 1, fr], closes: [100, 100, 100, 100], queried: [[mo, fr]] }) });
await reloadSymbolHistory('MUSTER.DE', { storage: holiday, today: '2026-02-10', flush: async () => true, fetchImpl: async url => chart(url, () => 99, day => day === mi) });
const holidayRecord = JSON.parse(holiday.getItem(DAILY_PRICES_KEY)).symbols['MUSTER.DE'];
assertEqual(historyPriceAt(holidayRecord, mi).status, 'carried', 'Belegter Feiertag bleibt abgefragt');
assertEqual(JSON.stringify(holidayRecord.queried), JSON.stringify([[mo, mo + 7]]), 'Wochenende verbindet die Abdeckung bis Montag');

console.log('✓ Tageskurse neu laden OK');

// TH-2c: „Lädt …“ und Bestätigung stehen an der Klickstelle (Knopf der Tranche), andere Tranchen und Fehler bleiben unberührt.
{
    const text = reloadPricesDoneText('Muster Technik AG', 2512);
    assertEqual(text, 'Tageskurse von „Muster Technik AG“ neu geladen: 2.512 Tage.', 'TH-2c Meldung nennt Name und Tageszahl');
    setReloadPricesProgress({ trancheId: 'muster-1', phase: 'running', text: '' });
    const running = reloadPricesButtonHtml(lot);
    assert(running.includes('disabled') && running.includes('Lädt …'), 'TH-2c Knopf zeigt während des Abrufs „Lädt …“ und ist gesperrt');
    assert(!reloadPricesButtonHtml(other).includes('Lädt …'), 'TH-2c andere Tranche bleibt unverändert');
    setReloadPricesProgress({ trancheId: 'muster-1', phase: 'done', text });
    const done = reloadPricesButtonHtml(lot), detailDone = buildTrancheHistoryDetail(lot, projectTrancheHistory(lot, context, 'default'));
    assert(done.includes('data-price-reload-notice') && done.includes('2.512 Tage') && !done.includes('disabled'), 'TH-2c Bestätigung steht neben dem Knopf');
    assert(detailDone.includes('data-price-reload-notice'), 'TH-2c Bestätigung erscheint auch im Kursverlauf der Tranche');
    assert(!reloadPricesButtonHtml(other).includes('data-price-reload-notice'), 'TH-2c andere Tranche zeigt keine Bestätigung');
    // TH-2d: Beseitigt das Neuladen den Splithinweis (Vergleichskurs 30 statt 150), bleibt die Bestätigung in der Zeile.
    const fixedLot = { ...lot, currentPrice: 30, asOf: splitDay * 86400 + 15 * 3600 };
    const fixedDays = oldDays.filter(day => day < splitDay);
    const fixedContext = { status: 'ready', prices: { version: 1, symbols: { 'MUSTER.DE': { ...prices.symbols['MUSTER.DE'], days: fixedDays, closes: fixedDays.map(() => 30), queried: [[first, splitDay - 1]] } } } };
    const rowDone = splitHintHtml(fixedLot, fixedContext);
    assert(!rowDone.includes('data-split-hint') && !rowDone.includes('data-action="reload-prices"'), 'TH-2d Splithinweis und Knopf entfallen nach dem Neuladen');
    assert(rowDone.includes('data-price-reload-notice') && rowDone.includes('2.512 Tage'), 'TH-2d Bestätigung bleibt in der Tranchenzeile');
    assert(!splitHintHtml({ ...fixedLot, trancheId: 'andere-1' }, fixedContext).includes('data-price-reload-notice'), 'TH-2d andere Tranche zeigt keine Bestätigung');
    setReloadPricesProgress(null);
    assertEqual(splitHintHtml(fixedLot, fixedContext), '', 'TH-2d ohne Bestätigung und ohne Hinweis bleibt die Zeile leer');
    assert(!reloadPricesButtonHtml(lot).includes('data-price-reload-notice'), 'TH-2c Fehler oder Ablauf: keine Erfolgsmeldung');
}
