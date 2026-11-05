import { historyDay as day, historyDate, DAILY_PRICES_KEY, WEALTH_HISTORY_START_KEY, emptyHistorySymbol } from '../app/tranches/tranchen-history-store.js';
import { collectHistoryQueue, runHistoryFetch } from '../app/tranches/tranchen-history-fetch.js';

// TD-6: Abgefragte Börsentage ohne Schluss bleiben 10 Tage offen; Altbestände werden einmal nachgeholt.
const lot = { schemaVersion: 1, trancheId: 'lot-a', name: 'Synthetisch', isin: '', ticker: 'TEST.DE',
    shares: 10, purchasePrice: 100, currentPrice: 100, purchaseDate: '2026-01-01', category: 'equity', type: 'aktien_neu', tqf: 0, notes: '' };
const weekdays = (from, to, skip = []) => {
    const days = [];
    for (let d = day(from); d <= day(to); d++) {
        const weekday = new Date(d * 86400000).getUTCDay();
        if (weekday !== 0 && weekday !== 6 && !skip.includes(historyDate(d))) days.push(d);
    }
    return days;
};
function source(record, startDate = '2026-01-01') {
    const registry = { version: 1, profiles: { default: { meta: { id: 'default', name: 'Synthetisch' }, data: { depot_tranchen: JSON.stringify([lot]) } } } };
    const map = new Map(Object.entries({ rs_profiles_v1: JSON.stringify(registry), depot_tranchen: JSON.stringify([lot]),
        rs_current_profile: 'default', rs_active_profile: 'default', [WEALTH_HISTORY_START_KEY]: JSON.stringify({ version: 1, startDate }),
        [DAILY_PRICES_KEY]: JSON.stringify({ version: 1, symbols: { 'TEST.DE': record } }) }));
    return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
const record = (days, queried) => ({ ...emptyHistorySymbol(), currency: 'EUR', days, closes: days.map((d, i) => 100 + i), queried });
const prices = storage => JSON.parse(storage.getItem(DAILY_PRICES_KEY)).symbols['TEST.DE'];
const queue = (storage, today) => collectHistoryQueue(JSON.parse(storage.getItem('rs_profiles_v1')), '2026-01-01', today,
    JSON.parse(storage.getItem(DAILY_PRICES_KEY))).queue.map(job => job.interval.map(historyDate));
const chart = (symbol, points) => ({ ok: true, json: async () => ({ chart: { error: null, result: [{ meta: { symbol, currency: 'EUR', exchangeTimezoneName: 'Europe/Berlin' },
    timestamp: points.map(([date]) => Date.parse(`${date}T08:00:00Z`) / 1000), indicators: { quote: [{ close: points.map(([, close]) => close) }] } }] } }) });

// Heute 20.01.: 07.01. fehlt seit 13 Tagen (endgültig), 14.01. seit 6 Tagen, 19.01. seit gestern.
const days = weekdays('2026-01-02', '2026-01-19', ['2026-01-07', '2026-01-14', '2026-01-19']);
const storage = source(record(days, [[day('2026-01-01'), day('2026-01-19')]]));
const before = prices(storage);
assertEqual(JSON.stringify(queue(storage, '2026-01-20')), JSON.stringify([['2026-01-14', '2026-01-14'], ['2026-01-19', '2026-01-19']]),
    'Nur junge Tage ohne Schluss sind offen; ein Abruf je Lückenblock');
const requests = [];
await runHistoryFetch({ firstPlanningYear: 2026, storage, today: '2026-01-20', flush: async () => true, fetchImpl: async url => {
    const u = new URL(url); requests.push([historyDate(Number(u.searchParams.get('period1')) / 86400), historyDate(Number(u.searchParams.get('period2')) / 86400 - 1)]);
    return chart('TEST.DE', requests.at(-1)[0] === '2026-01-14' ? [['2026-01-14', 123.5]] : [['2026-01-19', null]]);
} });
assertEqual(JSON.stringify(requests), JSON.stringify([['2026-01-14', '2026-01-14'], ['2026-01-19', '2026-01-19']]), 'Zwei zusätzliche Abrufe, keiner für den 13 Tage alten Tag');
const after = prices(storage);
assertEqual(after.closes[after.days.indexOf(day('2026-01-14'))], 123.5, 'Lücke von 6 Tagen wird mit dem neuen Wert ergänzt');
assert(!after.days.includes(day('2026-01-19')), 'Antwort mit close null lässt den Tag offen');
assertEqual(JSON.stringify(before.days.map(d => [d, after.closes[after.days.indexOf(d)]])),
    JSON.stringify(before.days.map((d, i) => [d, before.closes[i]])), 'Bestehende Werte bleiben unverändert');
assertEqual(JSON.stringify(after.queried), JSON.stringify(before.queried), 'Format und Inhalt von queried bleiben gleich');
assertEqual(JSON.stringify(queue(storage, '2026-01-20')), JSON.stringify([['2026-01-19', '2026-01-19']]), 'Der Tag ohne Schluss bleibt für den nächsten Start offen');
assertEqual(JSON.stringify(queue(storage, '2026-01-30')), JSON.stringify([['2026-01-20', '2026-01-29']]), 'Nach 10 Tagen ist der Tag endgültig, nur neue Tage bleiben offen');

// Altbestand vor TD-6: Lücken der letzten 45 Tage werden einmal nachgeholt, ältere nicht.
const repairDays = weekdays('2026-09-14', '2026-11-03', ['2026-09-18', '2026-09-22', '2026-10-12', '2026-10-13', '2026-10-26', '2026-11-02']);
const repair = source(record(repairDays, [[day('2026-09-14'), day('2026-11-03')]]), '2026-09-14');
assertEqual(JSON.stringify(collectHistoryQueue(JSON.parse(repair.getItem('rs_profiles_v1')), '2026-09-14', '2026-11-04', JSON.parse(repair.getItem(DAILY_PRICES_KEY))).queue
    .map(job => job.interval.map(historyDate))), JSON.stringify([['2026-09-22', '2026-09-22'], ['2026-10-12', '2026-10-13'], ['2026-10-26', '2026-10-26'], ['2026-11-02', '2026-11-02']]),
    'Reparatur fragt Lücken der letzten 45 Tage ab; die Lücke vom 18.09. bleibt außen vor');
assertEqual(collectHistoryQueue(JSON.parse(repair.getItem('rs_profiles_v1')), '2026-09-14', '2027-01-10', JSON.parse(repair.getItem(DAILY_PRICES_KEY))).queue
    .filter(job => job.interval[0] <= day('2026-11-03')).length, 0, 'Nach 45 Tagen erzeugt die Reparatur keine Abfragen mehr');

// Ein Symbol ganz ohne Schluss wird nicht wiederholt.
const none = source({ ...emptyHistorySymbol(), queried: [[day('2026-01-01'), day('2026-01-19')]] });
assertEqual(queue(none, '2026-01-20').length, 0, 'Symbol ohne jeden Schluss erzeugt keine Wiederholung');

// Gespeicherter Wochenendschluss (Handel am Wochenende) wird nicht überschrieben: der Block endet davor.
const weekendDays = [...weekdays('2026-01-05', '2026-01-19', ['2026-01-16', '2026-01-19']), day('2026-01-17')].sort((a, b) => a - b);
const weekend = source(record(weekendDays, [[day('2026-01-01'), day('2026-01-19')]]));
assertEqual(JSON.stringify(queue(weekend, '2026-01-20')), JSON.stringify([['2026-01-16', '2026-01-16'], ['2026-01-19', '2026-01-19']]),
    'Ein gespeicherter Samstagsschluss trennt den Nachprüfblock');

// Neue Tage kommen vor den Nachprüfungen, damit das Zeitbudget den jüngsten Schluss zuerst holt.
const ordered = source(record(weekdays('2026-01-02', '2026-01-15', ['2026-01-13']), [[day('2026-01-01'), day('2026-01-15')]]));
const jobs = collectHistoryQueue(JSON.parse(ordered.getItem('rs_profiles_v1')), '2026-01-01', '2026-01-20', JSON.parse(ordered.getItem(DAILY_PRICES_KEY))).queue;
assertEqual(JSON.stringify(jobs.map(job => [job.interval.map(historyDate), job.recheck === true])),
    JSON.stringify([[['2026-01-16', '2026-01-19'], false], [['2026-01-13', '2026-01-13'], true]]), 'Reguläre Lücke vor dem Nachprüfblock');
