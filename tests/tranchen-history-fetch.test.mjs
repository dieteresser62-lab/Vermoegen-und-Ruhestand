import { deriveOverviewPlanningStart } from '../app/overview/overview-model.js';
import { historyDay as day, WEALTH_HISTORY_START_KEY, DAILY_PRICES_KEY, emptyHistorySymbol } from '../app/tranches/tranchen-history-store.js';
import { PROFILE_WEALTH_LOTS_KEY } from '../app/profile/profile-wealth-history.js';
import { HISTORY_FETCH_BUDGET_MS, HISTORY_FETCH_SESSION_KEY, historyChartUrl, parseHistoryChart, collectHistoryQueue, fetchHistoryChart,
    initializeHistoryData, runHistoryFetch, bindHistoryFetch } from '../app/tranches/tranchen-history-fetch.js';
import { createNavigationGuard, createNavigationOperationLifecycle } from '../app/shared/navigation-guard.js';
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function drain() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function clock() {
    let time = 0, next = 0; const timers = new Map();
    return { now: () => time, schedule: (fn, delay) => { timers.set(++next, { fn, at: time + delay }); return next; }, unschedule: id => timers.delete(id),
        tick(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } }, timers };
}
const lot = (ticker = 'TEST.DE', purchaseDate = '2026-01-01') => ({ schemaVersion: 1, trancheId: 'lot-a', name: 'Synthetisch', isin: '', ticker,
    shares: 10, purchasePrice: 100, currentPrice: 100, purchaseDate, category: 'equity', type: 'aktien_neu', tqf: 0, notes: '' });
function source(lots = [lot()], extras = {}) {
    const profile = items => ({ meta: { id: 'default', name: 'Synthetisch' }, data: { depot_tranchen: JSON.stringify(items) } });
    const registry = { version: 1, profiles: { default: profile(lots), b: profile([lot()]) } };
    const map = new Map(Object.entries({ rs_profiles_v1: JSON.stringify(registry), depot_tranchen: JSON.stringify(lots), rs_current_profile: 'default', rs_active_profile: 'default', ...extras }));
    const writes = [];
    return { map, writes, getItem: key => map.get(key) ?? null, setItem: (key, value) => { writes.push([key, value]); map.set(key, value); }, removeItem: key => { writes.push([key, null]); map.delete(key); } };
}
function chart(symbol = 'TEST.DE', timestamps = [], closes = [], timezone = 'Europe/Berlin') {
    return { chart: { error: null, result: [{ meta: { symbol, currency: 'EUR', exchangeTimezoneName: timezone }, timestamp: timestamps, indicators: { quote: [{ close: closes }] } }] } };
}
const response = data => ({ ok: true, json: async () => data });
const range = [day('2026-01-01'), day('2026-01-09')];
const url = new URL(historyChartUrl('test.de', range));
assertEqual(url.searchParams.get('period1'), String(range[0] * 86400), 'HTTP-Starttag ist inklusive UTC-Sekunden');
assertEqual(url.searchParams.get('period2'), String((range[1] + 1) * 86400), 'HTTP-Ende ist exklusiver Folgetag');
assertEqual(url.searchParams.get('interval'), '1d', 'Täglicher Chartabruf');
const dst = new URL(historyChartUrl('TEST.DE', [day('2026-03-28'), day('2026-03-30')]));
assertEqual(Number(dst.searchParams.get('period2')) - Number(dst.searchParams.get('period1')), 3 * 86400, 'Sommerzeit verändert den UTC-HTTP-Tageszeitraum nicht');
const normalized = parseHistoryChart(chart('TEST.DE', [Date.parse('2026-01-02T01:00:00Z') / 1000], [123.456789], 'America/New_York'), 'TEST.DE', range);
assertEqual(normalized.days[0], day('2026-01-01'), 'Providerzeit wird mit Börsenzeitzone zum Kalenderdatum');
assertEqual(normalized.closes[0], 123.456789, 'Keine zusätzliche Preisrundung');
for (const data of [chart('OTHER.DE'), { chart: { error: { code: 'Not Found', description: 'Symbol unbekannt' } } }, {}, { chart: { result: [{ meta: chart().chart.result[0].meta }] } }]) {
    let error; try { parseHistoryChart(data, 'TEST.DE', range); } catch (e) { error = e; } assert(error, 'Fehlerhafte/Symbolfremde Antwort markiert keine Abdeckung');
}
const s = source([lot('TEST.DE', '2026-01-05')]);
const registry = JSON.parse(s.getItem('rs_profiles_v1'));
let jobs = collectHistoryQueue(registry, '2026-01-01', '2026-01-10');
assertEqual(jobs.queue.length, 1, 'Zwei Profile mit gleichem Symbol erzeugen eine Queue');
assertEqual(jobs.queue[0].interval[0], day('2026-01-01'), 'Ältester Kauf beider Profile bestimmt Sollstart');
delete registry.profiles.b;
assertEqual(collectHistoryQueue(registry, '2026-01-01', '2026-01-10').queue[0].interval[0], day('2026-01-05'), 'Späterer Kauf begrenzt Sollzeitraum');
// Bestände vor Beginn erhalten keinen versteckten Rückblick zur Ermittlung der Basis.
const beforeStart = source([lot('TEST.DE', '2025-12-15')]);
const holidayQueue = collectHistoryQueue(JSON.parse(beforeStart.getItem('rs_profiles_v1')), '2026-01-01', '2026-01-07');
assertEqual(holidayQueue.queue.length, 1, 'Vor Beginn gekaufter Bestand wird mit gleichem Symbol zusammengeführt');
assertEqual(JSON.stringify(holidayQueue.queue[0].interval), JSON.stringify([day('2026-01-01'), day('2026-01-06')]), 'Abruf bleibt zwischen Beginn und gestern');
const holidayRequests = [];
await runHistoryFetch({ firstPlanningYear: 2026, storage: beforeStart, today: '2026-01-07', flush: async () => true,
    fetchImpl: async url => { holidayRequests.push(new URL(url)); return response(chart()); } });
assertEqual(holidayRequests.length, 1, 'Symbol wird nur einmal abgerufen');
assertEqual(holidayRequests[0].searchParams.get('period1'), String(day('2026-01-01') * 86400), 'Kein Rückblick vor Beginn');
assertEqual(holidayRequests[0].searchParams.get('period2'), String(day('2026-01-07') * 86400), 'Exklusives Ende schließt heutigen Kurs aus');
await runHistoryFetch({ firstPlanningYear: 2026, storage: beforeStart, today: '2026-01-07', flush: async () => true,
    fetchImpl: async () => { throw new Error('Bereits geprüfter Zeitraum darf nicht erneut abgerufen werden'); } });
assertEqual(collectHistoryQueue(JSON.parse(beforeStart.getItem('rs_profiles_v1')), '2026-01-01', '2026-01-07',
    JSON.parse(beforeStart.getItem(DAILY_PRICES_KEY))).queue.length, 0, 'Geprüftes Feiertagsintervall bleibt aus der Queue');
registry.profiles.default.data.depot_tranchen = JSON.stringify([lot('')]);
assertEqual(collectHistoryQueue(registry, '2026-01-01', '2026-01-10').issues[0].reason, 'Kein Kursverlauf ohne Ticker', 'ISIN wird nicht still als Chartticker benutzt');
const init = source(); let initFlushes = 0;
const planning = deriveOverviewPlanningStart({ now: new Date('2026-01-10T12:00:00Z'), scope: { ids: ['default'] },
    metadata: [{ schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2020', pendingCommit: null }] });
assertEqual(planning.firstPlanningYear, 2020, 'Echte P6c-Regel liefert erstes belegtes Planungsjahr');
await initializeHistoryData(planning.firstPlanningYear, { storage: init, today: '2026-01-10', flush: async () => { initFlushes++; } });
assertEqual(JSON.parse(init.getItem(WEALTH_HISTORY_START_KEY)).startDate, '2020-01-01', 'Erstes belegtes Planungsjahr wird als 1. Januar bestätigt');
assert(JSON.parse(init.getItem(PROFILE_WEALTH_LOTS_KEY)).lots['lot-a'], 'Erstbestand erhält Stammdatenkopie');
await initializeHistoryData(2027, { storage: init, today: '2027-01-10', flush: async () => { initFlushes++; } });
assertEqual(initFlushes, 1, 'Reload/Jahreswechsel initialisiert Beginn und unveränderte Stammdaten nicht erneut');

// Leere erfolgreiche Antworten bestätigen Feiertage, ohne erfundene Kurse.
const empty = source();
let requests = 0;
const options = { firstPlanningYear: 2026, storage: empty, today: '2026-01-10', flush: async () => true,
    fetchImpl: async () => { requests++; return response(chart()); } };
const report = await runHistoryFetch(options);
assertEqual(report.completed, 1, 'Leerer erfolgreicher Abruf wird bestätigt');
assertEqual(JSON.parse(empty.getItem(DAILY_PRICES_KEY)).symbols['TEST.DE'].days.length, 0, 'Leerer Abruf erzeugt keine Kurse');
await runHistoryFetch(options);
assertEqual(requests, 1, 'Erfolgreich geprüfter Zeitraum wird beim nächsten Start nicht erneut geholt');

// Älteste Lücke zuerst; ein Symbol immer seriell, Fehler kein Retry im selben Job.
const serial = source([lot('B.DE')]);
serial.setItem(DAILY_PRICES_KEY, JSON.stringify({ version: 1, symbols: { 'TEST.DE': { ...emptyHistorySymbol(), queried: [[day('2026-01-05'), day('2026-01-06')]] } } }));
const seen = []; let running = 0, maximum = 0;
await runHistoryFetch({ firstPlanningYear: 2026, storage: serial, today: '2026-01-10', flush: async () => true, fetchImpl: async url => {
    running++; maximum = Math.max(maximum, running); const u = new URL(url); seen.push([u.searchParams.get('symbol'), Number(u.searchParams.get('period1'))]);
    await Promise.resolve(); running--; return response(chart(u.searchParams.get('symbol')));
} });
assertEqual(maximum, 1, 'Globale Queue erlaubt höchstens einen laufenden Symbolabruf');
assertEqual(JSON.stringify(seen.map(item => item[0])), '["B.DE","TEST.DE","TEST.DE"]', 'Älteste Lücke zuerst, stabile Symbolordnung bei gleichem Beginn');
assertEqual(seen[2][1], day('2026-01-07') * 86400, 'Zweite Lücke folgt erst nach erstem Commit');

// Budget umfasst Header und Deferred-Body; Abort ignorierende Provider schreiben niemals spät.
for (const phase of ['headers', 'body']) {
    const c = clock(), late = deferred(), st = source(); let count = 0;
    const task = runHistoryFetch({ firstPlanningYear: 2026, storage: st, today: '2026-01-10', now: c.now, schedule: c.schedule, unschedule: c.unschedule,
        flush: async () => true, fetchImpl: async () => { count++; return phase === 'headers' ? late.promise : { ok: true, json: () => late.promise }; } });
    await drain(); const before = JSON.stringify([...st.map]); const writeCount = st.writes.length;
    c.tick(HISTORY_FETCH_BUDGET_MS); await drain();
    assertEqual((await task).status, 'budget-ended', phase + ': Eigenes 20-s-Budget beendet ignorierenden Provider');
    assertEqual(JSON.stringify([...st.map]), before, phase + ': Budgetende schreibt keine neuen Records');
    late.resolve(phase === 'headers' ? response(chart()) : chart()); await drain();
    assertEqual(st.writes.length, writeCount, phase + ': Verspätete Antwort schreibt nicht');
    assertEqual(c.timers.size, 0, phase + ': Deadline-Timer wird entfernt');
    const next = await runHistoryFetch({ firstPlanningYear: 2026, storage: st, today: '2026-01-10', now: c.now, schedule: c.schedule, unschedule: c.unschedule,
        flush: async () => true, fetchImpl: async () => { count++; return response(chart()); } });
    assertEqual(next.completed, 1, 'Nächster Start erhält neues Budget und setzt offene Lücke fort');
    assertEqual(count, 2, 'Abgebrochene Lücke wird einmal erneut geholt');
}
{
    const c = clock(), late = deferred(), st = source(), abort = new AbortController();
    const task = runHistoryFetch({ firstPlanningYear: 2026, storage: st, today: '2026-01-10', now: c.now, schedule: c.schedule, unschedule: c.unschedule,
        signal: abort.signal, flush: async () => true, fetchImpl: async () => ({ ok: true, json: () => late.promise }) });
    await drain(); const count = st.writes.length; abort.abort();
    assertEqual((await task).status, 'cancelled', 'Navigation beendet auch hängenden Body ohne Budgetwartezeit');
    late.resolve(chart()); await drain();
    assertEqual(st.writes.length, count, 'Navigation verhindert verspätete Writes und Providerfehlerzähler');
}
{
    const c = clock(), st = source(), commitFlush = deferred(), late = deferred(); let flushes = 0;
    const guard = createNavigationGuard({ decide: async () => true }), lifecycle = createNavigationOperationLifecycle({ guard });
    const task = runHistoryFetch({ firstPlanningYear: 2026, storage: st, today: '2026-01-10', now: c.now, schedule: c.schedule, unschedule: c.unschedule,
        withOperation: fn => lifecycle.run({}, fn), flush: async () => { flushes++; return flushes === 2 ? commitFlush.promise : true; },
        fetchImpl: async () => response(chart()) });
    await drain();
    assertEqual(guard.reasons()[0].phase, 'commit', 'Realer Lifecycle schützt den bereits begonnenen Commit');
    assertEqual(await guard.prepare(), null, 'Navigation erhält während Flush keine Freigabe');
    c.tick(HISTORY_FETCH_BUDGET_MS); commitFlush.resolve(true); await task;
    assert(JSON.parse(st.getItem(DAILY_PRICES_KEY)).symbols['TEST.DE'].queried.length, 'Vor Deadline begonnener Commit wird atomar nach Deadline bestätigt');
    assertEqual(guard.reasons().length, 0, 'Commitabschluss gibt Navigation frei');
}
{
    const st = source(), late = deferred(), guard = createNavigationGuard({ decide: async () => true }), lifecycle = createNavigationOperationLifecycle({ guard });
    const task = runHistoryFetch({ firstPlanningYear: 2026, storage: st, today: '2026-01-10', withOperation: fn => lifecycle.run({}, fn),
        flush: async () => true, fetchImpl: async () => ({ ok: true, json: () => late.promise }) });
    await drain(); const count = st.writes.length;
    const permit = await guard.prepare();
    assert(permit, 'Realer Navigationsguard wartet auf bestätigtes Abrufabbruchende'); guard.end(permit);
    assertEqual((await task).status, 'cancelled', 'Guardabbruch beendet Queue');
    late.resolve(chart()); await drain(); assertEqual(st.writes.length, count, 'Guardabbruch erhält Speicherbytes');
}
const failures = source();
for (let attempt = 1; attempt <= 3; attempt++) {
    let calls = 0;
    const r = await runHistoryFetch({ firstPlanningYear: 2026, storage: failures, today: '2026-01-10', flush: async () => true,
        fetchImpl: async () => { calls++; return { ok: false, status: 404 }; } });
    const saved = JSON.parse(failures.getItem(DAILY_PRICES_KEY)).symbols['TEST.DE'];
    assertEqual(calls, 1, 'Kein erneuter Providerabruf desselben Symbols innerhalb eines Starts');
    assertEqual(saved.failures, attempt, 'Echter Symbolfehler zählt über getrennte Starts');
    assertEqual(saved.queried.length, 0, 'Fehler markiert keine Abdeckung');
    assertEqual(r.hints.length, attempt === 3 ? 1 : 0, 'Dritter Fehler liefert begründeten Hinweis');
    if (attempt === 3) assert(r.hints[0].includes('HISTORY_HTTP_404'), 'Hinweis bewahrt echten Fehlergrund');
}
await runHistoryFetch({ firstPlanningYear: 2026, storage: failures, today: '2026-01-10', flush: async () => true, fetchImpl: async () => response(chart()) });
assertEqual(JSON.parse(failures.getItem(DAILY_PRICES_KEY)).symbols['TEST.DE'].failures, 0, 'Erfolg setzt Fehlerfolge zurück');

// Bindung startet erst nach Quote-Promise und sperrt nur ihre eigene Sitzung.
const start = deferred(), sessionMap = new Map(), listeners = new Map(); let jobsStarted = 0;
const doc = { getElementById: () => null, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
const session = { getItem: key => sessionMap.get(key), setItem: (key, value) => sessionMap.set(key, value) };
const bound = bindHistoryFetch({ doc, win: {}, afterStartup: start.promise, session, firstPlanningYear: 2020, guard: createNavigationGuard(),
    coordinator: async args => { jobsStarted++; assertEqual(args.firstPlanningYear, 2020, 'Binder reicht belegtes Planungsjahr weiter'); return { hints: [] }; } });
await drain(); assertEqual(jobsStarted, 0, 'Verlauf erhält sein Budget erst nach beendetem Quotejob');
assert(!sessionMap.has(HISTORY_FETCH_SESSION_KEY), 'Wartender Job reserviert noch keine Sitzung');
start.resolve(); await bound; assertEqual(jobsStarted, 1, 'Nach Quoteabschluss startet der eigene Job');
assertEqual(listeners.size, 0, 'Binder räumt Dokumentlistener auf');
await bindHistoryFetch({ doc: { ...doc }, win: {}, afterStartup: Promise.resolve(), session, firstPlanningYear: 2020, guard: createNavigationGuard(), coordinator: async () => { jobsStarted++; } });
assertEqual(jobsStarted, 1, 'Reload mit derselben Sitzung startet keinen zweiten Job');

// Teilfortschritt bleibt erhalten, nächste Sitzung holt ausschließlich älteste offene Lücke.
{
    const c = clock(), st = source([lot('B.DE')]), late = deferred(); const seen = [];
    const task = runHistoryFetch({ firstPlanningYear: 2026, storage: st, today: '2026-01-10', now: c.now, schedule: c.schedule, unschedule: c.unschedule,
        flush: async () => true, fetchImpl: async url => { const symbol = new URL(url).searchParams.get('symbol'); seen.push(symbol); return symbol === 'B.DE' ? response(chart(symbol)) : late.promise; } });
    await drain(); c.tick(HISTORY_FETCH_BUDGET_MS); const partial = await task;
    assertEqual(partial.completed, 1, 'Teilfortschritt vor Budgetende bleibt bestätigt');
    assertEqual(partial.status, 'budget-ended', 'Zweiter hängender Abruf beendet aktuelles Budget');
    const next = [];
    await runHistoryFetch({ firstPlanningYear: 2026, storage: st, today: '2026-01-10', now: c.now, schedule: c.schedule, unschedule: c.unschedule,
        flush: async () => true, fetchImpl: async url => { const symbol = new URL(url).searchParams.get('symbol'); next.push(symbol); return response(chart(symbol)); } });
    assertEqual(JSON.stringify(next), '["TEST.DE"]', 'Nächster Start holt ausschließlich unbestätigte Lücke');
    const before = JSON.stringify([...st.map]); late.resolve(response(chart())); await drain();
    assertEqual(JSON.stringify([...st.map]), before, 'Später erster Lauf überschreibt bestätigten zweiten Lauf nicht');
}
{
    const st = source(); await initializeHistoryData(2026, { storage: st, today: '2026-01-10', flush: async () => true });
    const before = JSON.stringify([...st.map]); let flushes = 0;
    const report = await runHistoryFetch({ firstPlanningYear: 2026, storage: st, today: '2026-01-10',
        flush: async () => ++flushes !== 1, fetchImpl: async () => ({ ok: false, status: 404 }) });
    assertEqual(report.status, 'storage-error', 'Fehlerstatus benötigt ebenfalls bestätigten Flush');
    assertEqual(JSON.stringify([...st.map]), before, 'Speicherfehler erhöht keinen Providerzähler und hält Lücke offen');
}
{
    const start = deferred(), listenerMap = new Map(); let started = false;
    const localDoc = { getElementById: () => null, addEventListener: (key, fn) => listenerMap.set(key, fn), removeEventListener: key => listenerMap.delete(key) };
    const task = bindHistoryFetch({ doc: localDoc, win: {}, guard: createNavigationGuard(), session: { getItem: () => null, setItem() {} },
        afterStartup: start.promise, firstPlanningYear: 2026, coordinator: async () => { started = true; } });
    listenerMap.get('change')({ type: 'change', target: { closest: () => ({ id: 'profileSelect' }) } });
    start.resolve(); await task;
    assertEqual(started, false, 'Profilwechsel während vorgelagertem Quotejob verhindert späteren Verlaufstart');
}

// Navigation im übernommenen Commit wartet auch auf verzögertes Rückschreiben.
{
    const st = source([lot('B.DE')]);
    await initializeHistoryData(2026, { storage: st, today: '2026-01-10', flush: async () => true });
    const before = JSON.stringify([...st.map]), first = deferred(), rollback = deferred(), handlers = new Map();
    const guard = createNavigationGuard(); let flushes = 0, requests = 0, navigations = 0;
    const target = { id: 'profileCreateBtn', click: () => { navigations++; }, isConnected: true };
    const doc = { getElementById: () => null, addEventListener: (key, fn) => handlers.set(key, fn), removeEventListener: key => handlers.delete(key) };
    const task = bindHistoryFetch({ doc, win: {}, guard, session: { getItem: () => null, setItem() {} }, afterStartup: Promise.resolve(), firstPlanningYear: 2026,
        coordinator: args => runHistoryFetch({ ...args, storage: st, today: '2026-01-10',
            flush: async () => ++flushes === 1 ? first.promise : rollback.promise,
            fetchImpl: async url => { requests++; return response(chart(new URL(url).searchParams.get('symbol'))); } }) });
    await drain(); let prevented = false;
    handlers.get('click')({ type: 'click', target: { closest: selector => selector === 'a[href]' ? null : target },
        preventDefault: () => { prevented = true; }, stopImmediatePropagation() {} });
    assert(prevented, 'Binder hält Profilverwaltung während begonnenem Kurscommit an');
    assertEqual(navigations, 0, 'Profilhandler beginnt nicht vor Flushabschluss');
    first.resolve(false); await drain();
    assertEqual(guard.reasons()[0].phase, 'commit', 'Fehlflush behält Besitzer bis zum kompensierenden Rückschreiben');
    assertEqual(navigations, 0, 'Profilhandler wartet auch auf Rollbackflush');
    rollback.resolve(true); await task; await drain();
    assertEqual(JSON.stringify([...st.map]), before, 'Abgebrochener Fehlcommit stellt alte Daten und offene Lücke wieder her');
    assertEqual(navigations, 1, 'Profilverwaltung läuft einmal nach bestätigtem Rückschreiben');
    assertEqual(requests, 1, 'Navigation im Commit startet keinen weiteren Symbolabruf');
}

{
    const { setAppTestDate } = await import('../app/shared/app-clock.js');
    setAppTestDate('2026-01-10');
    let network = 0;
    try {
        const data = source([lot('TEST.DE', '2025-12-15')]);
        const result = await runHistoryFetch({ firstPlanningYear: 2026, storage: data, today: '2026-01-10', flush: async () => true,
            fetchImpl: () => { network++; throw new Error('Kursnetz im Probelauf verboten'); } });
        assertEqual(result.status, 'complete', 'Synthetischer Historyjob bestätigt vollständigen Zeitraum');
        const saved = JSON.parse(data.getItem(DAILY_PRICES_KEY)).symbols['TEST.DE'];
        assertEqual(saved.queried.at(-1)[1], day('2026-01-10'), 'Probelauf bestätigt Wochenende einschließlich Testdatum');
        assertEqual(saved.days.at(-1), day('2026-01-09'), 'Wochenende enthält keinen erfundenen Kurspunkt');
        assertEqual(network, 0, 'Historyjob erreicht werfende Netzwerkfunktion nie');
    } finally { setAppTestDate(null); }
}

// Die neue Datenseite liest Sollintervalle direkt aus derselben Queue.
{
    const data = source();
    const wanted = collectHistoryQueue(JSON.parse(data.getItem('rs_profiles_v1')), '2026-01-01', '2026-01-10');
    assertEqual(wanted.wanted.length, 1, 'Sollintervalle aggregieren gemeinsam genutzten Ticker einmal');
    assertEqual(wanted.wanted[0].intervals[0][0], day('2026-01-01'), 'Sollbeginn bleibt auch neben der offenen Queue belegbar');
}
{
    const data = source(), body = deferred();
    await initializeHistoryData(2026, { storage: data, today: '2026-01-10', flush: async () => true });
    const task = runHistoryFetch({ firstPlanningYear: 2026, storage: data, today: '2026-01-10', flush: async () => true,
        fetchImpl: async () => ({ ok: true, json: () => body.promise }) });
    await drain(); const count = data.writes.length;
    data.map.set('rs_active_profile', 'b'); // Fremder Kontextwechsel, kein Writer aus dem Job.
    body.resolve(chart());
    assertEqual((await task).status, 'cancelled', 'Koordinator selbst prüft Profilquelle nach Providerantwort');
    assertEqual(data.writes.length, count, 'Kontextwechsel erzeugt weder Kursabdeckung noch fremden Profilwrite');
}
