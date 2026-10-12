import { WEALTH_HISTORY_START_KEY, DAILY_PRICES_KEY, historyDay, historyDate, assertHistoryStart, assertDailyPrices, loadHistoryRecord,
    emptyHistorySymbol, mergeHistoryIntervals, historyGaps, readDailyPrices, commitDailyPriceResult, initializeHistoryStart } from '../app/tranches/tranchen-history-store.js';
const day = historyDay;
function storage() {
    const map = new Map();
    return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
function rejected(fn, label) { let caught = false; try { fn(); } catch { caught = true; } assert(caught, label); }
assertEqual(historyDate(day('2024-02-29')), '2024-02-29', 'Schalttag rundet ohne Zeitzone zurück');
for (const bad of ['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-01', '']) rejected(() => day(bad), 'Ungültiges Kalenderdatum abgewiesen');
for (const validator of [assertHistoryStart, assertDailyPrices]) {
    assertEqual(loadHistoryRecord(null, validator).status, 'missing', 'Fehlender Record ist ein kenntlicher Leerzustand');
    for (const raw of ['', '{', '{}', 'null', '{"version":2}']) assertEqual(loadHistoryRecord(raw, validator).status, 'corrupt', 'Beschädigter Record bleibt erkennbar');
}
assertEqual(loadHistoryRecord('{"version":1,"startDate":"2026-01-01"}', assertHistoryStart).status, 'valid', 'Beginn gültig');
const record = { version: 1, symbols: { 'TEST.DE': { ...emptyHistorySymbol(), currency: 'EUR', days: [day('2026-01-02')], closes: [100.123456789], queried: [[day('2026-01-01'), day('2026-01-02')]] } } };
assertEqual(loadHistoryRecord(JSON.stringify(record), assertDailyPrices).status, 'valid', 'Spaltenrecord gültig');
for (const mutate of [r => r.symbols['TEST.DE'].closes.push(2), r => r.symbols['TEST.DE'].days.push(day('2026-01-02')),
    r => r.symbols['TEST.DE'].closes[0] = 0, r => r.symbols['TEST.DE'].failures = -1, r => r.symbols['TEST.DE'].currency = null,
    r => r.symbols['TEST.DE'].queried = [[2, 1]], r => r.version = 3]) {
    const copy = structuredClone(record); mutate(copy); rejected(() => assertDailyPrices(copy), 'Ungültige Kursspalten/Metadaten abgewiesen');
}
rejected(() => assertDailyPrices(JSON.parse('{"version":1,"symbols":{"__proto__":{}}}')), 'Unsichere Symbolkennung abgewiesen');
assertEqual(JSON.stringify(mergeHistoryIntervals([[4, 7], [1, 5], [8, 9], [15, 16]])), '[[1,9],[15,16]]', 'Überlappende und benachbarte Intervalle werden vereinigt');
assertEqual(JSON.stringify(historyGaps(day('2026-01-01'), day('2026-01-09'))), JSON.stringify([[day('2026-01-01'), day('2026-01-09')]]), 'Ersterfassung umfasst Werktage und dazwischenliegendes Wochenende');
assertEqual(historyGaps(day('2026-01-03'), day('2026-01-04')).length, 0, 'Ungefragtes Wochenende allein ist keine Lücke');
assertEqual(historyGaps(day('2026-01-01'), day('2026-01-09'), [[day('2026-01-01'), day('2026-01-09')]]).length, 0, 'Abgefragter Feiertag braucht keinen Schlusskurs');
assertEqual(JSON.stringify(historyGaps(day('2026-01-01'), day('2026-01-09'), [[day('2026-01-02'), day('2026-01-06')]])),
    JSON.stringify([[day('2026-01-01'), day('2026-01-01')], [day('2026-01-07'), day('2026-01-09')]]), 'Echte Werktagslücken bleiben offen');
const s = storage(); let flushes = 0;
await initializeHistoryStart(2020, { storage: s, today: '2026-01-09', flush: async () => { flushes++; } });
await initializeHistoryStart(2027, { storage: s, today: '2027-01-09', flush: async () => { flushes++; } });
assertEqual(JSON.parse(s.getItem(WEALTH_HISTORY_START_KEY)).startDate, '2020-01-01', 'Bestätigter Beginn wandert im neuen Kalenderjahr nicht');
assertEqual(flushes, 1, 'Beginn wird genau einmal bestätigt');
s.setItem(DAILY_PRICES_KEY, JSON.stringify(record));
let release;
const pending = commitDailyPriceResult('TEST.DE', { currency: 'EUR', days: [day('2026-01-05')], closes: [200], interval: [day('2026-01-03'), day('2026-01-05')] },
    { storage: s, flush: () => new Promise(resolve => { release = resolve; }) });
assertEqual(readDailyPrices(s).value.symbols['TEST.DE'].days.length, 1, 'Während Flush bleibt bestätigte Abdeckung sichtbar');
release(true); await pending;
assertEqual(readDailyPrices(s).value.symbols['TEST.DE'].days.length, 2, 'Kurse und Intervall erscheinen nach gemeinsamem Flush');
const before = s.getItem(DAILY_PRICES_KEY); let calls = 0;
try { await commitDailyPriceResult('TEST.DE', { error: 'Dienst ausgefallen' }, { storage: s, flush: async () => ++calls !== 1 }); } catch {}
assertEqual(s.getItem(DAILY_PRICES_KEY), before, 'Fehlflush schreibt alte Kurs-/Intervall-/Fehlerbytes zurück');
assertEqual(calls, 2, 'Rollback wird ebenfalls geflusht');
let writes = 0; const set = s.setItem; s.setItem = (...args) => { if (++writes === 1) throw new Error('Writefehler'); return set(...args); };
try { await commitDailyPriceResult('TEST.DE', { error: 'Dienst ausgefallen' }, { storage: s, flush: async () => true }); } catch {}
assertEqual(s.getItem(DAILY_PRICES_KEY), before, 'Writefehler bewahrt alte Kurse'); s.setItem = set;
const foreign = JSON.parse(before); foreign.symbols['OTHER.DE'] = emptyHistorySymbol(); s.setItem(DAILY_PRICES_KEY, JSON.stringify(foreign));
await commitDailyPriceResult('TEST.DE', { currency: 'EUR', days: [day('2026-01-02')], closes: [99.987654321], interval: [day('2026-01-01'), day('2026-01-02')] }, { storage: s, flush: async () => true });
assert(readDailyPrices(s).value.symbols['OTHER.DE'], 'Vor Commit hinzugekommenes Symbol wird erneut gemergt');
assertEqual(readDailyPrices(s).value.symbols['TEST.DE'].closes[0], 99.987654321, 'Überlappende Antwort ersetzt deterministisch ohne Rundung');
let conflict;
try { await commitDailyPriceResult('TEST.DE', { error: 'x' }, { storage: s, flush: async () => { s.setItem(DAILY_PRICES_KEY, before); return true; } }); } catch (error) { conflict = error; }
assertEqual(conflict?.message, 'HISTORY_COMMIT_CONFLICT', 'Änderung während Flush wird als Konflikt abgewiesen');
assertEqual(s.getItem(DAILY_PRICES_KEY), before, 'Konflikt überschreibt Fremdbytes nicht');
const yearDays = [];
for (let d = day('2026-01-01'); d <= day('2026-12-31'); d++) if (![0, 6].includes(new Date(d * 86400000).getUTCDay())) yearDays.push(d);
assertEqual(yearDays.length, 261, 'Größenprobe verwendet alle 261 Werktage');
const large = { version: 1, symbols: {} };
for (let symbol = 0; symbol < 10; symbol++) large.symbols[`S${symbol}.DE`] = { currency: 'EUR', days: yearDays, closes: yearDays.map((_, i) => 100 + symbol + i * 0.01), queried: [[day('2026-01-01'), day('2026-12-31')]], failures: 0, lastError: null };
assertDailyPrices(large);
const raw = JSON.stringify(large), utf8 = Buffer.byteLength(raw, 'utf8'), utf16 = raw.length * 2;
console.log(`P8 Kursrecord: ${utf8} B UTF-8; ${utf16} B konservativer UTF-16-Stringbedarf`);
assert(utf8 <= 100000 && utf16 <= 200000, 'Spaltenrecord bleibt unter begründeter Obergrenze, ohne Fachwerte zu kürzen');
