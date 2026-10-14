import { projectDataPrices, bindDataPrices } from '../app/data/data-prices.js';
import { runHistoryFetch } from '../app/tranches/tranchen-history-fetch.js';
import { DAILY_PRICES_KEY, WEALTH_HISTORY_START_KEY, historyDay as day, emptyHistorySymbol } from '../app/tranches/tranchen-history-store.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
const now = new Date('2026-01-10T12:00:00Z'), asOf = now.getTime() / 1000 - 60;
const lot = (id, ticker = 'TEST.DE', purchaseDate = '2026-01-01') => ({ schemaVersion: 1, trancheId: id, name: 'Ähre ' + id, isin: '', ticker,
    shares: 10, purchasePrice: 100, currentPrice: 100, asOf, purchaseDate, category: 'equity', type: 'aktien_neu', tqf: 0, notes: '' });
function records() {
    const a = lot('a'), b = lot('b', 'TEST.DE', '2026-01-05'), sold = lot('sold', 'SOLD.DE');
    const registry = { version: 1, profiles: {
        a: { meta: { id: 'a', name: 'Ähre' }, data: { depot_tranchen: JSON.stringify([a]), profile_wealth_history_lots_v1: JSON.stringify({ version: 1, lots: { sold: { tranche: sold, remainingShares: 0, status: 'sold', capturedAt: '2026-01-01' } } }) } },
        b: { meta: { id: 'b', name: 'Öl' }, data: { depot_tranchen: JSON.stringify([b]) } }
    } };
    return { rs_profiles_v1: JSON.stringify(registry), rs_active_profile: 'a', rs_current_profile: 'a',
        depot_tranchen: JSON.stringify([a]), profile_wealth_history_lots_v1: registry.profiles.a.data.profile_wealth_history_lots_v1,
        [WEALTH_HISTORY_START_KEY]: JSON.stringify({ version: 1, startDate: '2026-01-01' }),
        [DAILY_PRICES_KEY]: JSON.stringify({ version: 1, symbols: { 'TEST.DE': { ...emptyHistorySymbol(), currency: 'EUR',
            days: [day('2026-01-02')], closes: [100], queried: [[day('2026-01-01'), day('2026-01-09')]] } } }) };
}
const report = { status: 'complete', retrievedAt: now.getTime(), results: [{ profileId: 'a', trancheId: 'a', status: 'updated', asOf }, { profileId: 'b', trancheId: 'b', status: 'updated', asOf }] };
let model = projectDataPrices(records(), { now, startupReport: report });
assertEqual(model.state, 'current', 'Bestätigter Startupreport und frische Quotes zeigen aktuellen Zustand');
assertEqual(model.rows.length, 2, 'Geteilte Ticker und verkaufte Lots werden eindeutig aggregiert');
const row = model.rows.find(row => row.symbol === 'TEST.DE');
assertEqual(row.count, 1, 'Gemeinsamer Ticker zählt gespeicherten Kurs einmal');
assertEqual(row.first, '2026-01-02', 'Seit nennt ersten echten Kurs statt angeforderten Beginn');
assertEqual(row.requested[0][0], '2026-01-01', 'Angeforderter Beginn bleibt separat');
assertEqual(row.gaps.length, 0, 'Bestätigte Feiertage und Wochenende erzeugen keine Lücken');
assertEqual(model.attemptedAt, now.getTime(), 'Versuchszeit stammt aus tatsächlichem Report');
assertEqual(model.quoteAt, asOf * 1000, 'Kurszeit stammt aus bestätigten Quotes');
assertEqual(model.usableQuoteCount, 2, 'Gespeicherte brauchbare Kurse sind unabhängig vom Abrufstatus erfasst');
assert(model.missingHistory, 'Noch unbestätigtes Wertpapier ohne Tageskurse meldet fehlende Daten');
const completeHistory = records();
const daily = JSON.parse(completeHistory[DAILY_PRICES_KEY]);
daily.symbols['SOLD.DE'] = { ...daily.symbols['TEST.DE'] };
completeHistory[DAILY_PRICES_KEY] = JSON.stringify(daily);
const storedOffline = projectDataPrices(completeHistory, { now, startupReport: { ...report, status: 'offline', results: [] } });
assertEqual(storedOffline.usableQuoteCount, 2, 'Fehlgeschlagener Abruf entwertet gespeicherte Kurse nicht');
assertEqual(storedOffline.openIntervals, 0, 'Vollständige Tageskurse bleiben trotz fehlgeschlagenem Abruf vollständig');
assert(!storedOffline.missingHistory, 'Bestätigte Tageskurse erzeugen keinen Datenfehler');
assertEqual(projectDataPrices(completeHistory, { now: new Date('2026-02-10') }).usableQuoteCount, 2, 'Alte gültige Kurse bleiben brauchbar, ohne aktuell zu heißen');
const noQuote = completeHistory;
noQuote.depot_tranchen = JSON.stringify([{ ...lot('a'), currentPrice: 0 }]);
assert(projectDataPrices(noQuote, { now }).unreadable, 'Ungültiger gespeicherter Kurs wird als Datenfehler erkannt');
assertEqual(projectDataPrices(records(), { now, startupReport: { ...report, results: report.results.slice(0, 1) } }).state, 'partial', 'Teilantwort zeigt teilweise aktuelle Kurslage');
assertEqual(projectDataPrices(records(), { now, startupReport: { ...report, status: 'offline', results: [] } }).state, 'offline', 'Offlineantwort macht alte Quotes nicht grün');
assertEqual(projectDataPrices(records(), { now }).state, 'unknown', 'Ohne Sitzungsbefund bleibt Kurslage unbekannt');
assertEqual(projectDataPrices(records(), { now, startupReport: report, serviceReport: { status: 'offline', attemptedAt: 123 } }).state, 'offline', 'Neuester Dienstfehler bleibt sichtbar');
assertEqual(projectDataPrices(records(), { now: new Date('2026-02-10'), startupReport: report }).state, 'unknown', 'Frischeprüfung bleibt bei unverändertem Sieben-Tage-Vertrag');
const mismatch = records(); mismatch.depot_tranchen = JSON.stringify([{ ...lot('a'), asOf: asOf - 60 }]);
assertEqual(projectDataPrices(mismatch, { now, startupReport: report }).state, 'partial', 'Alte Reportidentität bestätigt keinen inzwischen geänderten Kurs');
const missing = records(); missing.depot_tranchen = JSON.stringify([lot('a', '')]);
assert(projectDataPrices(missing, { now }).issues.some(issue => issue.includes('Ticker')), 'Fehlender Ticker wird erklärt');
assertEqual(projectDataPrices({}, { now }).rows.length, 0, 'Leerer Bestand hat keine erfundenen Wertpapiere');
const noStart = records(); delete noStart[WEALTH_HISTORY_START_KEY];
assertEqual(projectDataPrices(noStart, { now }).openIntervals, null, 'Fehlender Verlaufsbeginn ist unbekannt statt vollständig');
const corrupt = records(); corrupt[DAILY_PRICES_KEY] = '{kaputt';
assertEqual(projectDataPrices(corrupt, { now }).total, null, 'Defekter Kursbereich wird nicht als leer angezeigt');
assert(projectDataPrices(corrupt, { now }).unreadable, 'Unlesbare Kursdaten bleiben als Datenfehler erkennbar');

function harness({ fetchImpl, flush = async () => true, coordinator, readModel, probe } = {}) {
    const values = records(); values.profile_wealth_history_lots_v1 = JSON.stringify({ version: 1, lots: {} });
    delete values[DAILY_PRICES_KEY];
    const map = new Map(Object.entries(values)), writes = [];
    const storage = { getItem: key => map.get(key) ?? null, setItem: (key, raw) => { writes.push(key); map.set(key, raw); }, removeItem: key => map.delete(key) };
    const doc = createPresentationTestDocument();
    for (const id of ['dataPriceActionStatus', 'dataPriceFetch', 'dataPriceCheck', 'dataPriceCancel', 'dataPriceTechnical']) { const node = doc.createElement('button'); node.id = id; doc.body.appendChild(node); }
    const listeners = new Map(); const win = { addEventListener: (name, fn) => listeners.set(name, fn) };
    const guard = createNavigationGuard({ decide: async () => true });
    const binder = bindDataPrices(doc, { win, guard, now: () => now, storage, persistence: { getPersistenceStatus: () => ({}) },
        readModel: readModel || (async () => ({ priceCoverage: projectDataPrices(Object.fromEntries(map), { now }) })),
        probe, coordinator: coordinator || (args => runHistoryFetch({ ...args, flush, fetchImpl })), refresh: async () => {} });
    return { binder, storage, writes, guard, listeners, doc, map };
}
const chart = symbol => ({ chart: { result: [{ meta: { symbol, currency: 'EUR', exchangeTimezoneName: 'Europe/Berlin' }, timestamp: [], indicators: { quote: [{ close: [] }] } }] } });
const response = url => ({ ok: true, json: async () => chart(new URL(url).searchParams.get('symbol')) });
const drain = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let requests = 0;
const healthy = harness({ fetchImpl: async url => { requests++; return response(url); } });
await healthy.binder.execute('history');
assertEqual(requests, 1, 'Echter Seitenkoordinator holt geteilten Ticker einmal');
await healthy.binder.execute('history');
assertEqual(requests, 1, 'Vollständige Abdeckung löst auf neuer Seite keinen Abruf aus');
assert(!healthy.map.has('rs_history_fetch_session_v1') && !healthy.map.has('rs_startup_prices_session_v1'), 'Manuelles Nachladen löscht oder setzt keine Sitzungsmarker');
const offline = harness({ fetchImpl: async () => { throw new Error('Offline'); } });
await offline.binder.execute('history');
assert(offline.doc.getElementById('dataPriceActionStatus').textContent.includes('nicht erreichbar'), 'Echter Nachladefehler zeigt Offlinezustand');
assertEqual(JSON.parse(offline.storage.getItem(DAILY_PRICES_KEY)).symbols['TEST.DE'].queried.length, 0, 'Offline bleibt unbestätigt');
for (const action of ['cancel', 'profile', 'page', 'guard']) {
    const late = deferred();
    const h = harness({ fetchImpl: () => late.promise });
    const task = h.binder.execute('history'); await drain(); const count = h.writes.length;
    if (action === 'cancel') h.binder.cancel();
    if (action === 'profile') { h.storage.setItem('rs_active_profile', 'b'); late.resolve(response('http://test/chart?symbol=TEST.DE')); }
    if (action === 'page') h.listeners.get('pagehide')();
    if (action === 'guard') { const permit = await h.guard.prepare(); assert(permit, 'Navigation wartet auf bestätigtes Abbruchende'); h.guard.end(permit); }
    await task; late.resolve(response('http://test/chart?symbol=TEST.DE')); await drain();
    assertEqual(h.writes.length, count + (action === 'profile' ? 1 : 0), action + ': verspäteter Provider schreibt keine fremden Profilrecords');
    assertEqual(h.storage.getItem(DAILY_PRICES_KEY), null, action + ': Abbruch bestätigt keine Kursabdeckung');
}
{
    const write = deferred(), rollback = deferred(); let flushes = 0;
    const h = harness({ fetchImpl: async url => response(url), flush: () => ++flushes === 1 ? true : flushes === 2 ? write.promise : rollback.promise });
    const task = h.binder.execute('history'); await drain();
    assertEqual(h.guard.reasons()[0].phase, 'commit', 'Nachladen schützt kurzen bestätigten Commit');
    assertEqual(await h.guard.prepare(), null, 'Navigation während Commit bleibt gesperrt');
    h.binder.cancel(); write.resolve(false); await drain();
    assertEqual(h.guard.reasons()[0].phase, 'commit', 'Writefehler schützt auch kompensierendes Rückschreiben');
    rollback.resolve(true); await task;
    assertEqual(h.storage.getItem(DAILY_PRICES_KEY), null, 'Writefehler behauptet keine gespeicherte Abdeckung');
    assertEqual(h.guard.reasons().length, 0, 'Bestätigter Rollback gibt Navigation frei');
}
{
    const seen = [];
    const h = harness({ fetchImpl: async url => {
        const symbol = new URL(url).searchParams.get('symbol'); seen.push(symbol);
        if (symbol === 'B.DE') throw new Error('Teilweise offline');
        return response(url);
    } });
    const registry = JSON.parse(h.storage.getItem('rs_profiles_v1'));
    registry.profiles.b.data.depot_tranchen = JSON.stringify([lot('b', 'B.DE')]); h.storage.setItem('rs_profiles_v1', JSON.stringify(registry));
    await h.binder.execute('history');
    assert(h.doc.getElementById('dataPriceActionStatus').textContent.includes('teilweise bestätigt'), 'Teilantwort bestätigt nur erfolgreiche Intervalle');
    const prices = JSON.parse(h.storage.getItem(DAILY_PRICES_KEY));
    assert(prices.symbols['TEST.DE'].queried.length && !prices.symbols['B.DE'].queried.length, 'Teilfortschritt und offene Providerintervalle bleiben unterscheidbar');
    seen.length = 0; await h.binder.execute('history');
    assertEqual(JSON.stringify(seen), '["B.DE"]', 'Fortsetzung fragt ausschließlich noch offene Intervalle an');
}
{
    const { setAppTestDate } = await import('../app/shared/app-clock.js');
    let network = 0;
    try {
        setAppTestDate('2026-01-10');
        const h = harness({ fetchImpl: () => { network++; throw new Error('Netz verboten'); } });
        await h.binder.execute('history');
        assertEqual(network, 0, 'Manuelles Nachladen im Probelauf verwendet ausschließlich synthetischen Adapter');
        assert(JSON.parse(h.storage.getItem(DAILY_PRICES_KEY)).symbols['TEST.DE'].queried.length > 0, 'Synthetische Abdeckung wird tatsächlich bestätigt');
    } finally { setAppTestDate(null); }
}
const counted = projectDataPrices(records(), { now, startupReport: report });
assertEqual(counted.quoteCount, 2, 'Lesende Kachelprojektion zählt beide aktuellen Tranchen');
assertEqual(counted.updatedCount, 2, 'Lesende Kachelprojektion zählt nur bestätigte Quotes');
assertEqual(projectDataPrices(records(), { now, serviceReport: { status: 'available' } }).updatedCount, 0, 'Healthcheck erfindet keine Aktualisierungszahl');
assertEqual(row.names, 'Ähre a, Ähre b', 'Wertpapiernamen stammen aus Lots und nicht aus Profilmetadaten');

// Dynamische Hauptmeldungen bleiben verständlich; Dienstprüfung bestätigt keine Quotes.
for (const [completed, text] of [[1, '1 Zeitraum bestätigt'], [2, '2 Zeiträume bestätigt']]) {
    const h = harness({ coordinator: async () => ({ status: 'complete', completed }) });
    await h.binder.execute('history');
    assert(h.doc.getElementById('dataPriceActionStatus').textContent.includes(text), 'Nachladerückmeldung beachtet Singular/Plural: ' + text);
}
for (const failure of ['offline', 'throw']) {
    const h = harness({ probe: async () => { if (failure === 'throw') throw new Error('HTTP_503 IndexedDB kv'); return { status: 'offline', error: 'HTTP_503 IndexedDB kv' }; } });
    await h.binder.execute('health');
    assert(!/HTTP_503|IndexedDB|\bkv\b/.test(h.doc.getElementById('dataPriceActionStatus').textContent), failure + ': Dienstfehlercode bleibt aus Hauptmeldung');
    assert(h.doc.getElementById('dataPriceTechnical').textContent.includes('HTTP_503'), failure + ': technische Ursache bleibt in Details zugänglich');
}
const checked = harness({ probe: async () => ({ status: 'available' }) });
await checked.binder.execute('health');
assertEqual(checked.binder.reportOptions().serviceReport.attemptedAt, now.getTime(), 'Healthcheck nennt seine echte Versuchszeit');
assertEqual(projectDataPrices(Object.fromEntries(checked.map), { now, ...checked.binder.reportOptions() }).updatedCount, 0, 'Erreichbarkeitsprüfung erzeugt keinen Quote-Erfolg');

const recoveredService = projectDataPrices(records(), { now, startupReport: { ...report, status: 'offline', results: [] }, serviceReport: { status: 'available', attemptedAt: now.getTime() } });
assertEqual(recoveredService.state, 'unknown', 'Später erreichbarer Dienst ersetzt alten Offlinebefund ohne Aktualisierungserfolg');
assertEqual(recoveredService.updatedCount, 0, 'Erreichbarer Dienst nach Offline bestätigt weiterhin keine Quote');
