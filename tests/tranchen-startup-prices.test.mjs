import { isDeepStrictEqual } from 'node:util';
import { getEventListeners } from 'node:events';
const assert = (condition, message) => globalThis.assert(condition, message);
assert.equal = (actual, expected, message = 'Werte stimmen überein') => assert(Object.is(actual, expected), message);
assert.deepEqual = (actual, expected, message = 'Strukturen bleiben gleich') => assert(isDeepStrictEqual(actual, expected), message);
import { bindStartupPrices, captureStartupPriceSource, commitStartupPriceResults,
    runStartupPriceRefresh, renderStartupPriceStatus, STARTUP_PRICE_TIMEOUT_MS, STARTUP_PRICE_SESSION_KEY } from '../app/tranches/tranchen-startup-prices.js';
import { createNavigationGuard, createNavigationOperationLifecycle } from '../app/shared/navigation-guard.js';
import { init, resetPersistenceForTests, persistenceStorage, exportAllSync, flush } from '../app/shared/persistence-facade.js';
import { completeProfilePageReadiness } from '../app/profile/profile-navigation.js';
import { createBatchQuoteFetcher, resolveTrancheQuote, fetchProxyPrice } from '../app/tranches/tranchen-price-service.js';
import { switchProfile } from '../app/profile/profile-storage.js';
import { appNow } from '../app/shared/app-clock.js';

const original = { fetch: globalThis.fetch, setTimeout, clearTimeout, Date: globalThis.Date };
const epoch = Date.parse('2026-10-06T10:00:00Z');
const personNames = { a: 'Alva <Test> & Partner', b: 'Berta Beispiel', c: 'Carlo Muster' };
let time, timers, timerId;
function installClock() {
    time = epoch; timers = new Map(); timerId = 0;
    // appNow() liest new Date(); Fachzeit und technische Fristen teilen die Testuhr.
    globalThis.Date = class extends original.Date {
        constructor(...args) { super(...(args.length ? args : [time])); }
        static now() { return time; }
    };
    globalThis.setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: time + ms }); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
}
async function settle() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
async function advance(ms) {
    const end = time + ms;
    while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at; timers.delete(next[0]); next[1].fn(); await settle();
    }
    time = end; await settle();
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const json = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const quote = (symbol, price = 120) => ({ symbol, price, currency: 'EUR', asOf: Math.floor(epoch / 1000) - 60, source: 'test' });
const lot = (id, ticker, extra = {}) => ({ schemaVersion: 2, trancheId: id, name: `Tranche ${id}`, ticker, isin: '',
    category: 'equity', type: 'aktien_neu', shares: 2, purchasePrice: 80, currentPrice: 100,
    tqf: 0.3, taxExempt: false, asOf: Math.floor(epoch / 1000) - 86400, ...extra });
async function setup(activeLots, inactiveLots = activeLots, { fail = false, hold = null, rollbackFail = false } = {}) {
    const profile = (id, lots) => ({ meta: { id, name: personNames[id], createdAt: 'alt', updatedAt: 'unverändert', belongsToHousehold: id === 'a', custom: 'behalten' },
        data: { depot_tranchen: JSON.stringify(lots), sim_extra: ' { "fremd": true } ', profile_tagesgeld: '500', sim_audit_bytes: ' { "audit": [] } ' }, extension: { untouched: true } });
    const registry = { version: 1, profiles: { a: profile('a', activeLots), b: profile('b', inactiveLots), c: profile('c', []) }, extra: 'original', trancheReconciliation: { schemaVersion: 1, actions: [], extension: 'Audit unverändert' } };
    const backend = { rs_profiles_v1: JSON.stringify(registry), rs_current_profile: 'a', rs_active_profile: 'a', ...registry.profiles.a.data };
    let batches = 0; const backendWrites = [], batchStarts = [];
    resetPersistenceForTests({ loadAll: async () => ({ ...backend }), saveBatch: async ({ deletes, upserts }) => {
        batches++; batchStarts.push(time);
        if (hold) await hold.promise;
        if (fail && (batches === 1 || rollbackFail)) throw new Error('SYNTHETIC_FLUSH_FAILURE');
        deletes.forEach(key => { backendWrites.push(time); delete backend[key]; });
        upserts.forEach(([key, value]) => { backendWrites.push(time); backend[key] = value; });
    } });
    await init({ installLifecycleHooks: false, debounceMs: 60000 });
    return { backend, registry, backendWrites, batchStarts, batches: () => batches };
}
function sessionStore() {
    const records = new Map();
    return { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value) };
}
function dom() {
    const listeners = new Map();
    const node = () => ({ children: [], textContent: '', appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; } });
    const host = node();
    const doc = { documentElement: { dataset: { suitePage: 'index' } },
        createElement: node, getElementById: id => id === 'startupPriceStatus' ? host : null,
        addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); },
        dispatch(type, event) { for (const handler of listeners.get(type) || []) handler(event); } };
    host.ownerDocument = doc;
    const win = new EventTarget(); win.Event = Event; win.document = doc;
    return { doc, win, host };
}
function startCoordinator(options = {}) {
    const guard = createNavigationGuard({ decide: async () => true });
    const lifecycle = createNavigationOperationLifecycle({ guard });
    let signal;
    const task = lifecycle.run({}, operation => {
        signal = operation.controller.signal;
        return runStartupPriceRefresh({ operation, ...options });
    });
    return { task, guard, get signal() { return signal; } };
}
function observeCoordinator(options = {}) {
    const cacheWrites = [], commits = [], progresses = [];
    const previous = persistenceStorage.setItem;
    persistenceStorage.setItem = (...args) => { cacheWrites.push(time); return previous(...args); };
    const coordinator = startCoordinator({ ...options,
        progress: value => progresses.push({ ...value, at: time }),
        commit: (...args) => { commits.push(time); return commitStartupPriceResults(...args); }
    });
    coordinator.task = coordinator.task.finally(() => { persistenceStorage.setItem = previous; });
    return { coordinator, cacheWrites, commits, progresses };
}
function assertSingleCommit(trace, state, at) {
    assert.deepEqual(trace.commits, [at], 'Genau ein rechtzeitiger Commitstart');
    assert.deepEqual(state.batchStarts, [at], 'Genau ein bestätigter Erfolgsflush');
    assert(trace.cacheWrites.length > 0 && state.backendWrites.length > 0, 'Echter Writer schreibt Cache und Backend');
    assert([...trace.cacheWrites, ...state.backendWrites].every(stamp => stamp === at && stamp < epoch + 15000), 'Alle Writes des sofort bestätigenden Adapters liegen vor globaler Deadline');
    assert.equal(getEventListeners(trace.coordinator.signal, 'abort').length, 0, 'Koordinator entfernt seinen Abbruchlistener');
    assert.equal(timers.size, 0, 'Nach Abschluss sind Reserve-, Request-, Rückoff- und Globaltimer entfernt');
}
const statusRows = host => (host.children.find(child => child.children?.some(row => row.children?.[0]?.href === 'depot-tranchen-manager.html'))?.children || []).map(row => row.textContent);
function assertSessionReport(report) {
    const topFields = ['status', 'updated', 'retrievedAt', 'restored', 'results'];
    const resultFields = ['profileId', 'trancheId', 'profileName', 'trancheName', 'status', 'code', 'message', 'asOf'];
    const forbidden = ['quote', 'raw', 'tranche', 'price', 'currentPrice', 'purchasePrice', 'shares', 'marketValue', 'costBasis'];
    assert(Object.keys(report).every(key => topFields.includes(key)), 'Zusammenfassung enthält nur Statusmetadaten');
    for (const [key, value] of Object.entries(report)) {
        if (key !== 'results') assert(value === null || typeof value !== 'object', 'Zusammenfassung speichert keine Unterobjekte');
    }
    for (const result of report.results) {
        assert(Object.keys(result).every(key => resultFields.includes(key)), 'Ergebnis enthält ausschließlich erlaubte Statusfelder');
        for (const field of forbidden) assert(!(field in result), `Sitzungsbericht enthält kein ${field}`);
        assert(Object.values(result).every(value => value === null || typeof value !== 'object'), 'Keine mittelbar gespeicherten Kurs-/Finanzobjekte');
    }
}
try {
    installClock();
    assert.equal(new Date().getTime(), epoch, 'Date-Konstruktor verwendet die feste Referenzuhr');
    assert.equal(appNow().getTime(), Date.now(), 'App-Uhr und technische Uhr starten gleichzeitig');
    await advance(1000);
    assert.equal(new Date().getTime(), epoch + 1000, 'Date-Konstruktor folgt dem Timerfortschritt');
    assert.equal(appNow().getTime(), Date.now(), 'App-Uhr folgt derselben fortschreitenden Testzeit');
    assert.equal(new Date(0).getTime(), 0, 'Explizite Datumsargumente bleiben erhalten');
    console.log('Acht direkte Erfolge bleiben bei neun Gruppen und hängenden Such-/ISINpfaden bestätigt');
    for (const latePart of ['unanswered', 'headers', 'body']) {
        installClock();
        const symbols = Array.from({ length: 8 }, (_, i) => `READY${i}.DE`);
        const state = await setup([...symbols.map((symbol, i) => lot(`a-${i}`, symbol)),
            lot('hanging', 'MISSING.DE', { isin: 'IE00HANG0001' })], symbols.map((symbol, i) => lot(`b-${i}`, symbol)));
        const held = [], requests = []; let bodyReads = 0, active = 0, peak = 0;
        globalThis.fetch = (url, options) => {
            const u = new URL(url), symbol = u.searchParams.get('symbol');
            requests.push({ path: u.pathname, symbol, at: time });
            active++; peak = Math.max(peak, active);
            const end = () => { active--; };
            options.signal.addEventListener('abort', end, { once: true });
            if (symbols.includes(symbol) || symbol === 'MISSING.DE') return new Promise(resolve => setTimeout(() => {
                options.signal.removeEventListener('abort', end); end();
                resolve(json(symbol === 'MISSING.DE' ? { code: 'SYMBOL_NOT_FOUND' } : quote(symbol), symbol === 'MISSING.DE' ? 404 : 200));
            }, 1000));
            const wait = deferred(); held.push({ wait, path: u.pathname, symbol });
            if (latePart === 'body') return Promise.resolve({ ...json({}), json: () => { bodyReads++; return wait.promise; } });
            return wait.promise;
        };
        const trace = observeCoordinator(); await settle();
        await advance(13999); assert.equal(state.batches(), 0);
        await advance(1); const report = await trace.coordinator.task;
        assert.equal(report.status, 'complete'); assert.equal(report.updated, 16);
        assertSingleCommit(trace, state, epoch + 14000);
        assert.equal(peak, 3, 'Höchstens drei aktive JS-Requests');
        assert(requests.some(request => request.path === '/search') && requests.some(request => request.symbol === 'IE00HANG0001'), 'Fixture erreicht Suche, Wiederholung und ISINquote');
        for (const symbol of [...symbols, 'MISSING.DE']) assert.equal(requests.filter(request => request.symbol === symbol).length, 1, 'Direktquotes werden einschließlich 404 geteilt, nicht wiederholt');
        assert.equal(report.results.find(result => result.trancheId === 'hanging').code, 'STARTUP_FALLBACK_TIMEOUT');
        const frozen = JSON.stringify({ report, backend: state.backend, cache: exportAllSync().records, requests, progresses: trace.progresses });
        const readsBefore = bodyReads;
        await advance(2000);
        if (latePart !== 'unanswered') for (const item of held) {
            const data = item.path === '/search' ? { quotes: [{ symbol: 'LATE.DE' }] } : quote(item.symbol);
            item.wait.resolve(latePart === 'headers' ? { ...json(data), json: async () => { bodyReads++; return data; } } : data);
        }
        await settle();
        assert.equal(bodyReads, readsBefore, 'Späte Headers verursachen keine Bodylesung');
        assert.equal(JSON.stringify({ report, backend: state.backend, cache: exportAllSync().records, requests, progresses: trace.progresses }), frozen, 'Späte Such-/ISINantworten verändern weder Bericht noch Writes, Requests oder Progress');
        assert.equal(state.batches(), 1); assert.equal(trace.commits.length, 1); assert.equal(timers.size, 0);
    }
    console.log('Erster Fallbackerfolg aktiviert Reserve dynamisch, auch bei 14000/14500/14999 ms');
    for (const successAt of [2000, 14000, 14500, 14999, null]) {
        installClock();
        const state = await setup([lot('a-ready', 'A.DE', { isin: 'IE00READY001' }), lot('hanging', 'B.DE', { isin: 'IE00HANG0001' })],
            [lot('b-ready', 'A.DE', { isin: 'IE00READY001' })]);
        const before = JSON.stringify({ backend: state.backend, cache: exportAllSync().records });
        const held = [], requests = []; let bodyReads = 0;
        const hanging = () => { const wait = deferred(); held.push(wait); return wait.promise; };
        globalThis.fetch = async url => {
            const u = new URL(url), symbol = u.searchParams.get('symbol'), query = u.searchParams.get('q');
            requests.push({ path: u.pathname, symbol, query, at: time });
            if (['A.DE', 'B.DE', 'IE00READY001'].includes(symbol)) return json({ code: 'SYMBOL_NOT_FOUND' }, 404);
            if (successAt !== null && u.pathname === '/search' &&
                (successAt === 2000 ? query === 'A.DE' : query === 'IE00READY001' && time >= epoch + 10900)) {
                if (successAt === 2000) return json({ quotes: [{ symbol: 'RESOLVED.DE' }] });
                return new Promise(resolve => setTimeout(() => resolve(json({ quotes: [{ symbol: 'RESOLVED.DE' }] })), epoch + 13000 - time));
            }
            if (symbol === 'RESOLVED.DE') return new Promise(resolve => setTimeout(() => resolve(json(quote(symbol))), epoch + successAt - time));
            return hanging();
        };
        const trace = observeCoordinator(); await settle();
        const endAt = successAt === null ? 15000 : Math.max(14000, successAt);
        await advance(endAt - 1); assert.equal(state.batches(), 0);
        await advance(1); const report = await trace.coordinator.task;
        if (successAt === null) {
            assert.equal(report.status, 'timeout'); assert.equal(report.updated, 0);
            assert.equal(trace.commits.length, 0); assert.equal(state.batches(), 0); assert.equal(trace.cacheWrites.length, 0);
            assert(report.results.some(result => result.code === 'STARTUP_TIMEOUT'), 'Ohne Kandidaten bleibt die globale Grenze maßgeblich');
            assert(!report.results.some(result => result.code === 'STARTUP_FALLBACK_TIMEOUT'), 'Ohne Erfolgskandidaten entsteht kein lokaler Schluss');
            assert.equal(JSON.stringify({ backend: state.backend, cache: exportAllSync().records }), before);
        } else {
            assert.equal(report.status, 'complete'); assert.equal(report.updated, 2);
            assertSingleCommit(trace, state, epoch + endAt);
            assert.equal(report.results.find(result => result.trancheId === 'hanging').code, 'STARTUP_FALLBACK_TIMEOUT');
            assert(report.results.filter(result => result.status === 'updated').every(result => result.quote.symbol === 'RESOLVED.DE'), 'Aktive und inaktive Tranche teilen den echten Fallbackerfolg');
            assert(requests.every(request => request.at < epoch + endAt), 'Nach spätem Erfolg beginnt keine weitere Leserarbeit');
        }
        const frozen = JSON.stringify({ report, backend: state.backend, cache: exportAllSync().records, requests, progresses: trace.progresses });
        await advance(2000);
        for (const wait of held) wait.resolve({ ...json({ quotes: [{ symbol: 'LATE.DE' }] }), json: async () => { bodyReads++; return quote('LATE.DE'); } });
        await settle();
        assert.equal(bodyReads, 0); assert.equal(timers.size, 0);
        assert.equal(JSON.stringify({ report, backend: state.backend, cache: exportAllSync().records, requests, progresses: trace.progresses }), frozen, 'Späte Fallbackantworten und Reservetimer erzeugen keine zweite Bestätigung');
    }
    console.log('Späte direkte Erfolge beenden nach der direkten Runde sofort, ohne Fallbackstart');
    for (const successAt of [14000, 14500, 14999]) {
        installClock();
        const state = await setup([lot('ready', 'READY.DE'), lot('not-started', '', { isin: 'IE00HANG0001' })], []);
        const requests = [];
        globalThis.fetch = async url => { requests.push(url); time = epoch + successAt; return json(quote('READY.DE')); };
        const trace = observeCoordinator(), report = await trace.coordinator.task;
        assert.equal(report.updated, 1); assert.equal(requests.length, 1);
        assert.equal(report.results[1].code, 'STARTUP_FALLBACK_TIMEOUT');
        assertSingleCommit(trace, state, epoch + successAt);
    }
    console.log('Lokaler Schluss bewahrt abgeschlossene Fachfehler und schützt den begonnenen Flush');
    for (const fail of [false, true]) {
        installClock();
        const hold = deferred(), late = deferred();
        const state = await setup([lot('ready', 'READY.DE'), lot('currency', 'USD.DE'), lot('missing', 'MISSING.DE'),
            lot('hanging', 'HANG.DE', { isin: 'IE00HANG0001' })], [], { hold, fail });
        const before = JSON.stringify(state.backend);
        globalThis.fetch = async url => {
            const u = new URL(url), symbol = u.searchParams.get('symbol');
            if (symbol === 'READY.DE') return json(quote(symbol));
            if (symbol === 'USD.DE') return json({ ...quote(symbol), currency: 'USD' });
            if (symbol === 'MISSING.DE' || symbol === 'HANG.DE') return json({ code: 'SYMBOL_NOT_FOUND' }, 404);
            if (u.searchParams.get('q') === 'USD.DE' || u.searchParams.get('q') === 'MISSING.DE') return json({ quotes: [] });
            return late.promise;
        };
        const { task, guard } = startCoordinator(); let done = false; task.then(() => { done = true; });
        await settle(); await advance(14000);
        assert.equal(state.batches(), 1); assert.equal(done, false, 'Vor Flushbestätigung ist noch kein Erfolg gemeldet');
        assert(guard.reasons().some(reason => reason.phase === 'commit'), 'Lokaler Schluss führt in geschützten Commit');
        await advance(2000);
        assert.equal(done, false); assert.equal(await guard.prepare(), null, 'Navigation bleibt auch nach globaler Deadline bis Flushende gesperrt');
        hold.resolve(); const report = await task;
        assert.equal(report.updated, fail ? 0 : 1); assert.equal(report.status, fail ? 'storage-failed' : 'complete');
        assert.equal(report.results.find(result => result.trancheId === 'currency').code, 'UNSUPPORTED_CURRENCY', 'Fertiger Fachfehler wird nicht durch lokalen Timeout überschrieben');
        assert.equal(report.results.find(result => result.trancheId === 'missing').code, 'SYMBOL_NOT_FOUND');
        assert.equal(report.results.find(result => result.trancheId === 'hanging').code, 'STARTUP_FALLBACK_TIMEOUT');
        assert.equal(state.batches(), fail ? 2 : 1);
        if (fail) { assert.equal(report.restored, true); assert.equal(JSON.stringify(state.backend), before); }
        assert.equal(guard.reasons().length, 0); assert.equal(timers.size, 0);
        late.resolve(json({ quotes: [{ symbol: 'LATE.DE' }] })); await settle();
        assert.equal(state.batches(), fail ? 2 : 1, 'Spätes Lesen erzeugt weder zweiten Erfolgsflush noch weitere Kompensation');
    }
    installClock();
    console.log('Neun direkte Gruppen in 3000 ms, höchstens drei Requests und genau ein Erfolgsflush');
    {
        const symbols = Array.from({ length: 9 }, (_, i) => `GROUP${i}.DE`);
        const state = await setup(symbols.map((symbol, i) => lot(`a-${i}`, symbol)),
            symbols.map((symbol, i) => lot(`b-${i}`, symbol.toLowerCase())));
        const requests = []; let active = 0, peak = 0;
        globalThis.fetch = url => {
            const u = new URL(url), symbol = u.searchParams.get('symbol');
            requests.push({ path: u.pathname, symbol, at: time }); active++; peak = Math.max(peak, active);
            return new Promise(resolve => setTimeout(() => { active--; resolve(json(quote(symbol))); }, 1000));
        };
        const started = time, { task } = startCoordinator(); await settle();
        await advance(2999); assert.equal(state.batches(), 0);
        await advance(1); const report = await task;
        assert.equal(time - started, 3000); assert.equal(report.updated, 18);
        assert.equal(peak, 3); assert.equal(requests.length, 9);
        assert(requests.every(request => request.path === '/quote'), 'Direkte Erfolge starten keine Suche');
        assert.equal(state.batches(), 1, 'Alle Gruppen teilen genau einen bestätigten Flush');
        for (const profileId of ['a', 'b']) for (let i = 0; i < 9; i++) {
            const result = report.results.find(item => item.profileId === profileId && item.trancheId === `${profileId}-${i}`);
            assert.equal(result.index, i); assert.equal(result.quote.symbol, symbols[i]);
            assert.equal(result.requestDurationMs, 1000, 'Cacheteilung erhält tatsächliche Anfragedauer');
        }
        const page = dom(); renderStartupPriceStatus(page.host, report);
        const technique = page.host.children.find(child => child.className === 'startup-price-technical');
        assert.equal(technique.children.length, 19);
        assert(technique.children.slice(1).every(row => row.textContent.includes('1000 ms')), 'Erfolgsdauer steht pro Tranche sicher als Text in Technik');
        assert(!JSON.stringify(state.backend).includes('requestDuration'), 'Diagnose schreibt keine Finanz-/Registryfelder');
    }
    installClock();
    console.log('Zwei Runden: alle direkten Gruppen enden vor Suche, nur Fehlschläge erhalten Fallback');
    {
        const state = await setup([lot('good', 'GOOD.DE'), lot('bad', 'BAD.DE'), lot('isin', '', { isin: 'IE00ONLY0001' }),
            lot('fallback', 'FALL.DE', { isin: 'IE00FALL0001' }), lot('none', '')], []);
        const requests = [], directEnds = [];
        globalThis.fetch = url => {
            const u = new URL(url), symbol = u.searchParams.get('symbol'), query = u.searchParams.get('q');
            requests.push({ path: u.pathname, symbol, query, at: time });
            return new Promise(resolve => setTimeout(() => {
                if (['GOOD.DE', 'BAD.DE', 'FALL.DE'].includes(symbol)) directEnds.push(time);
                if (u.pathname === '/search') resolve(json({ quotes: query === 'BAD.DE' ? [{ symbol: 'FOUND.DE' }] : [] }));
                else if (['BAD.DE', 'FALL.DE', 'IE00ONLY0001'].includes(symbol)) resolve(json({ code: 'SYMBOL_NOT_FOUND' }, 404));
                else resolve(json(quote(symbol)));
            }, symbol === 'GOOD.DE' ? 1000 : 100));
        };
        const { task } = startCoordinator(); await settle(); await advance(2000); const report = await task;
        assert.equal(report.updated, 3); assert.equal(state.batches(), 1);
        assert(requests.filter(request => request.path === '/search').every(request => request.at >= Math.max(...directEnds)), 'Kein Suchrequest vor Ende aller direkten Gruppen');
        for (const symbol of ['GOOD.DE', 'BAD.DE', 'FALL.DE']) assert.equal(requests.filter(request => request.symbol === symbol).length, 1, 'Keine zweite direkte Tickerquote');
        assert(!requests.some(request => request.query === 'GOOD.DE'), 'Direkter Erfolg erreicht Runde 2 nicht');
        assert(requests.some(request => request.symbol === 'IE00FALL0001'), 'Fehlgeschlagener Ticker nutzt ISIN-Fallback');
        assert.equal(report.results.find(result => result.trancheId === 'isin').status, 'failed');
        assert.equal(report.results.find(result => result.trancheId === 'none').status, 'skipped');
        const page = dom(); renderStartupPriceStatus(page.host, report);
        assert(page.host.children.find(child => child.className === 'startup-price-technical').children
            .some(row => row.textContent.includes('Tranche isin: letzte Anfragedauer 100 ms')), 'Fehlerdauer gehört zur letzten Anfrage, unabhängig vom gespeicherten Kursdatum');
    }
    installClock();
    console.log('Persistierter Symbolweg: echter Resolver und Writer, neuer Capture und ausschließlich aufgelöste Direktquotes');
    {
        const lots = id => [lot(`${id}-search`, 'OLDQUERY', { isin: 'IE00KEEP0001', extension: { keep: true } }),
            lot(`${id}-isin`, '', { isin: 'IE00SEARCH01', notes: 'synthetische Zusatznotiz' }), lot(`${id}-original`, 'ORIGINAL.DE')];
        const state = await setup(lots('a'), lots('b'));
        const firstRequests = [];
        globalThis.fetch = async url => {
            const u = new URL(url), symbol = u.searchParams.get('symbol'); firstRequests.push(u.pathname + u.search);
            if (u.pathname === '/search') return json({ quotes: [{ symbol: u.searchParams.get('q') === 'OLDQUERY' ? 'RESOLVED.DE' : 'ISINFUND.DE' }] });
            return ['OLDQUERY', 'IE00SEARCH01'].includes(symbol) ? json({ code: 'SYMBOL_NOT_FOUND' }, 404) : json(quote(symbol));
        };
        const source = captureStartupPriceSource();
        const lifecycle = createNavigationOperationLifecycle({ guard: createNavigationGuard() });
        await lifecycle.run({}, async operation => {
            const fetcher = createBatchQuoteFetcher(operation.controller.signal);
            const results = [];
            for (const profileId of ['a', 'b']) {
                const raw = profileId === source.activeId ? source.liveRaw : source.registry.profiles[profileId].data.depot_tranchen;
                const records = JSON.parse(raw);
                for (const index of [0, 1]) results.push({ profileId, raw, index, trancheId: records[index].trancheId,
                    ...await resolveTrancheQuote(records[index], fetcher) });
            }
            await commitStartupPriceResults(source, results, operation);
        });
        assert(firstRequests.includes('/search?q=OLDQUERY') && firstRequests.includes('/search?q=IE00SEARCH01'), 'Vorbereitender Abruf löst beide Ausgangstypen tatsächlich per Suche auf');
        const registry = JSON.parse(state.backend.rs_profiles_v1);
        for (const profileId of ['a', 'b']) {
            const stored = JSON.parse(registry.profiles[profileId].data.depot_tranchen);
            assert.equal(stored[0].ticker, 'RESOLVED.DE'); assert.equal(stored[1].ticker, 'ISINFUND.DE');
            assert.equal(stored[0].isin, 'IE00KEEP0001'); assert.equal(stored[1].isin, 'IE00SEARCH01');
            assert.deepEqual(stored[0].extension, { keep: true }); assert.equal(stored[1].notes, 'synthetische Zusatznotiz');
            assert.equal(stored[2].ticker, 'ORIGINAL.DE', 'Noch nie aufgelöster Ticker bleibt Originalfeld');
            assert(stored.every(record => !('resolvedSymbol' in record)), 'Symbol steht ausschließlich im vorhandenen ticker-Feld');
        }
        assert.equal(registry.profiles.a.data.depot_tranchen, state.backend.depot_tranchen, 'Backend und aktive Registry enthalten dieselben Writerbytes');
        const reread = captureStartupPriceSource(), nextRequests = [];
        assert.equal(reread.liveRaw, state.backend.depot_tranchen, 'Neue Quelle stammt aus bestätigtem Writerergebnis');
        globalThis.fetch = async url => { const u = new URL(url); nextRequests.push(u.pathname + u.search); return json(quote(u.searchParams.get('symbol'))); };
        const report = await startCoordinator({ source: reread }).task;
        assert.equal(report.updated, 6); assert.equal(state.batches(), 2);
        assert.deepEqual(nextRequests.sort(), ['/quote?symbol=ISINFUND.DE', '/quote?symbol=ORIGINAL.DE', '/quote?symbol=RESOLVED.DE'], 'Zweiter Abruf verwendet nur gespeicherte Symbole, weder Suche noch alte Kennungen');
    }
    console.log('Restbudget 14999/15000/15001 ms begrenzt Timeout und verhindert Fetch, Retry, Body und Commit nach Frist');
    for (const elapsed of [14999, 15000, 15001]) {
        installClock();
        let calls = 0, bodyReads = 0;
        const deadline = epoch + STARTUP_PRICE_TIMEOUT_MS;
        time = epoch + elapsed;
        globalThis.fetch = async () => { calls++; return { ...json(quote('BOUND.DE')), json: async () => { bodyReads++; return quote('BOUND.DE'); } }; };
        const scheduled = [];
        let error;
        try { await fetchProxyPrice('BOUND.DE', undefined, { deadline, now: () => time,
            schedule: (fn, ms) => { scheduled.push(ms); return setTimeout(fn, ms); }, retries: 1 }); } catch (caught) { error = caught; }
        assert.equal(calls, elapsed < 15000 ? 1 : 0); assert.equal(bodyReads, elapsed < 15000 ? 1 : 0);
        if (elapsed < 15000) assert.deepEqual(scheduled, [1], 'Requesttimeout überschreitet niemals Restbudget');
        else { assert.equal(error.code, 'STARTUP_TIMEOUT'); assert.equal(scheduled.length, 0); }
        installClock();
        const state = await setup([lot('bound', 'BOUND.DE')], []), before = JSON.stringify(state.backend), cacheBefore = JSON.stringify(exportAllSync().records);
        let progresses = 0;
        globalThis.fetch = async () => { time = epoch + elapsed; return json(quote('BOUND.DE')); };
        const report = await startCoordinator({ progress: () => { progresses++; } }).task;
        assert.equal(report.updated, elapsed < 15000 ? 1 : 0); assert.equal(state.batches(), elapsed < 15000 ? 1 : 0);
        if (elapsed >= 15000) {
            assert.equal(report.status, 'timeout'); assert.equal(progresses, 0);
            assert.equal(JSON.stringify(state.backend), before); assert.equal(JSON.stringify(exportAllSync().records), cacheBefore);
        }
    }
    console.log('Globale 15000-ms-Grenze verwirft unbestätigte Erfolge und ignorierte Abortantworten');
    for (const latePart of ['headers', 'body']) {
        installClock();
        const state = await setup([lot('late', 'LATE.DE')], []), before = JSON.stringify(state.backend), cacheBefore = JSON.stringify(exportAllSync().records);
        const held = deferred(); let calls = 0, bodyReads = 0, progresses = 0;
        globalThis.fetch = async () => {
            calls++;
            if (latePart === 'headers') return held.promise;
            return { ...json(quote('LATE.DE')), json: async () => { bodyReads++; return held.promise; } };
        };
        const { task } = startCoordinator({ progress: () => { progresses++; } }); await settle();
        await advance(15000); const report = await task;
        assert.equal(report.updated, 0); assert.equal(state.batches(), 0);
        const finalProgress = progresses, finalCalls = calls, finalReads = bodyReads;
        held.resolve(latePart === 'headers' ? { ...json(quote('LATE.DE')), json: async () => { bodyReads++; return quote('LATE.DE'); } } : quote('LATE.DE'));
        await settle(); await advance(1);
        assert.equal(progresses, finalProgress); assert.equal(calls, finalCalls); assert.equal(bodyReads, finalReads, 'Verspätete Headers starten keine Bodylesung');
        assert.equal(JSON.stringify(state.backend), before); assert.equal(JSON.stringify(exportAllSync().records), cacheBefore);
        assert(report.results.every(result => Number.isFinite(result.requestDurationMs)), 'Timeout-/Fehlerdauer bleibt unabhängig vom Kursstichtag verfügbar');
    }
    installClock();
    {
        const state = await setup([lot('retry', 'RETRY.DE')], []); let calls = 0;
        globalThis.fetch = async () => { calls++; time = epoch + 14999; return json({ code: 'PROVIDER_UNAVAILABLE' }, 503); };
        const report = await startCoordinator().task;
        assert.equal(report.status, 'offline'); assert.equal(report.updated, 0); assert.equal(calls, 1, 'Unpassender Rückoff startet weder Retry noch Fallback'); assert.equal(state.batches(), 0);
    }
    for (const commitAt of [15000, 15001]) {
        installClock();
        const state = await setup([lot('commit-bound', 'BOUND.DE')], []), before = JSON.stringify(state.backend);
        globalThis.fetch = async () => { time = epoch + 14999; return json(quote('BOUND.DE')); };
        const report = await startCoordinator({ commit: async (...args) => {
            time = epoch + commitAt;
            return commitStartupPriceResults(...args);
        } }).task;
        assert.equal(report.status, 'timeout'); assert.equal(report.updated, 0);
        assert.equal(state.batches(), 0, 'Writer prüft Frist erneut unmittelbar vor Commitstart');
        assert.equal(JSON.stringify(state.backend), before);
        assert.equal(report.results[0].code, 'STARTUP_TIMEOUT');
    }
    console.log('Vor Deadline begonnener Flush bleibt bis Bestätigung oder Kompensation geschützt');
    for (const fail of [false, true]) {
        installClock();
        const hold = deferred(), state = await setup([lot('flush', 'FLUSH.DE')], [], { hold, fail }), before = JSON.stringify(state.backend);
        globalThis.fetch = async () => { time = epoch + 14999; return json(quote('FLUSH.DE')); };
        const { task, guard } = startCoordinator(); await settle();
        assert(guard.reasons().some(reason => reason.phase === 'commit'), 'Commit beginnt rechtzeitig');
        await advance(2000); assert(guard.reasons().some(reason => reason.phase === 'commit'), 'Deadline bricht keinen Schreibabschnitt ab');
        assert.equal(await guard.prepare(), null, 'Navigation bleibt auch nach Deadline bis zum Flushabschluss gesperrt');
        hold.resolve(); const report = await task;
        assert.equal(report.status, fail ? 'storage-failed' : 'complete'); assert.equal(report.updated, fail ? 0 : 1);
        assert.equal(state.batches(), fail ? 2 : 1);
        if (fail) { assert.equal(report.restored, true); assert.equal(JSON.stringify(state.backend), before); }
        assert.equal(guard.reasons().length, 0);
    }
    installClock();
    {
        const state = await setup([lot('rollback', 'ROLLBACK.DE')], [], { fail: true, rollbackFail: true });
        globalThis.fetch = async () => json(quote('ROLLBACK.DE'));
        const report = await startCoordinator().task;
        assert.equal(report.status, 'storage-failed'); assert.equal(report.updated, 0); assert.equal(report.restored, false);
        assert.equal(state.batches(), 2, 'Fehlflush versucht den bestehenden kompensierenden Rückschreibweg');
        const page = dom(); renderStartupPriceStatus(page.host, report);
        assert(page.host.children[0].textContent.includes('Speicherwiederherstellung erforderlich'), 'Fehlendes Rückschreiben meldet Recovery, keinen Kurserfolg');
    }
    installClock();
    console.log('Ortsfester Status nennt Anzahl/Gründe und trennt Abrufzeit vom UTC-Kursstand');
    {
        const node = () => ({ children: [], textContent: '', appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; } });
        const host = node(); host.ownerDocument = { createElement: node };
        renderStartupPriceStatus(host, { status: 'timeout', updated: 1, retrievedAt: epoch, results: [
            { profileId: 'a', profileName: personNames.a, trancheId: 'ok', trancheName: 'Weltfonds <Erfolg>', status: 'updated', quote: quote('OK.DE') },
            { profileId: 'b', profileName: personNames.b, trancheId: 'slow', trancheName: 'Langsamer Fonds', status: 'failed', code: 'STARTUP_TIMEOUT' },
            { profileId: 'b', profileName: personNames.b, trancheId: 'missing', trancheName: 'Ohne Kennung', status: 'skipped' }
        ] });
        assert(host.children[0].textContent.includes('1 von 3 Kursen aktualisiert · 2 nicht aktualisiert'), 'Zusammenfassung unterscheidet Teilerfolg');
        const rows = (host.children[1]?.children || []).map(row => row.textContent);
        assert.equal(rows.length, 2, 'Ausschließlich Fehlkurse erscheinen als Zeilen');
        assert(rows[0].startsWith(`${personNames.b} / Langsamer Fonds:`), 'Timeout nennt beide Anzeigenamen');
        assert(rows[1].startsWith(`${personNames.b} / Ohne Kennung:`), 'Übersprungene Tranche nennt beide Anzeigenamen');
        assert(rows[0].includes('Kursdatum unbekannt') && !rows.join('').includes('UTC'), 'Fehlende Provenienz wird nicht aus Abrufzeit erfunden');
        assert(rows[0].includes('globales Zeitlimit') && rows[1].includes('Ticker oder ISIN fehlt'), 'Fehlkurse besitzen eigene verständliche Gründe');
        assert(host.children[1].children.every(row => row.children[0].href === 'depot-tranchen-manager.html'), 'Fehlkurse haben den bestehenden Managerzugang');
        renderStartupPriceStatus(host, { status: 'storage-failed', updated: 0 });
        assert(host.children[0].textContent.includes('Kein Erfolg bestätigt'), 'Fehlflush zeigt keinen erfolgreichen Kursstand');
    }

    console.log('Kompakte Ausgabe liest gespeicherte Provenienz, nie Abrufzeit oder ungespeicherte Quote');
    {
        const previousZone = process.env.TZ; process.env.TZ = 'Europe/Berlin';
        try {
            const node = () => ({ children: [], textContent: '', attributes: {}, appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, setAttribute(key, value) { this.attributes[key] = value; } });
            const host = node(); host.ownerDocument = { createElement: node };
            let reads = 0;
            for (const [iso, expected] of [
                ['2024-01-01T23:30:00Z', '02.01.2024, 00:30'],
                ['2024-06-01T23:30:00Z', '02.06.2024, 01:30'],
                ['2024-03-31T01:30:00Z', '31.03.2024, 03:30'],
                ['2024-10-27T01:30:00Z', '27.10.2024, 02:30']
            ]) {
                const asOf = Date.parse(iso) / 1000;
                const source = { activeId: 'p', liveRaw: JSON.stringify([{ id: 'legacy', name: '<Alter Fonds>', asOf }]), registry: { profiles: { p: { meta: { name: '<Person>' } } } } };
                const report = { status: 'storage-failed', updated: 0, retrievedAt: epoch, restored: false,
                    results: [{ profileId: 'p', trancheId: 'legacy', status: 'failed', code: 'NOT_STORED', asOf: quote('NEW.DE').asOf }] };
                const before = JSON.stringify({ source, report });
                renderStartupPriceStatus(host, report, { readSource: () => { reads++; return source; } });
                assert(statusRows(host)[0].includes(`Kurs vom ${expected}`), 'Lokale Anzeige folgt gespeichertem asOf einschließlich Sommer-/Winterzeit');
                assert(host.children[0].textContent.includes('Rückschreiben nicht bestätigt') && !host.children[0].textContent.includes('Kursdienst'), 'Fehlflush mit fehlendem Rückschreiben meldet Speicher-Recovery');
                assert(host.children[1].children[0].children[0].attributes['data-profile-handoff'] === '', 'Fehlerlink benutzt den bestehenden Handoff');
                assert.equal(JSON.stringify({ source, report }), before, 'Darstellung erhält Quell- und Berichtsbytes');
            }
            assert.equal(reads, 4, 'Pro Darstellung höchstens ein rein lesender Quellenzugriff');
            renderStartupPriceStatus(host, { status: 'complete', updated: 1, retrievedAt: epoch - 86400000, results: [{ status: 'updated', profileName: 'Person', trancheName: 'Fonds' }] });
            assert.equal(host.children.length, 2, 'Vollerfolg hat eine Zusammenfassungszeile und eine geschlossene Technikklappe');
            assert.equal(host.children[1].className, 'startup-price-technical');
            assert(host.children[1].children[1].textContent.includes('letzte Anfragedauer unbekannt'), 'Altmerker erfindet keine Dauer');
            assert(!host.children[0].textContent.includes('heute'), 'Historischer Abruf wird mit tatsächlichem Datum bezeichnet');
            renderStartupPriceStatus(host, { status: 'offline', updated: 0, results: [{ status: 'failed', code: 'PROXY_UNREACHABLE' }] });
            assert(host.children[0].textContent.startsWith('Kursdienst nicht erreichbar'), 'Totaler Dienstausfall ist sachlich bezeichnet');
            renderStartupPriceStatus(host, { status: 'offline', updated: 0, results: [{ status: 'failed', code: 'SECRET_CODE', message: 'SECRET_ID' }] });
            assert(!statusRows(host)[0].includes('SECRET'), 'Unbekannte technische Fehlerdetails werden nicht sichtbar ausgegeben');
            renderStartupPriceStatus(host, { status: 'offline', updated: 0, results: [] });
            assert.equal(host.children.length, 1, 'Leerer Bestand erfindet keine Erfolgsliste');
        } finally { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; }
    }

    console.log('Echter Renderer und lesender Sitzungsreload unterscheiden Antwortzeit, Anbieterfehler und Fachfehler');
    {
        installClock();
        const state = await setup([lot('reason', 'REASON.DE', { name: '<Fonds & Partner>' })], []);
        const cases = [
            { codes: ['REQUEST_TIMEOUT', 'PROVIDER_TIMEOUT'], summary: 'Kursantwort nicht rechtzeitig erhalten',
                reasons: ['Kursdienst antwortet nicht rechtzeitig', 'Kursanbieter antwortet nicht rechtzeitig'] },
            { codes: ['PROXY_UNREACHABLE'], summary: 'Kursdienst nicht erreichbar', reasons: ['Kursdienst nicht erreichbar'] },
            { codes: ['PROVIDER_UNAVAILABLE'], summary: 'Kursanbieter vorübergehend nicht verfügbar', reasons: ['Kursanbieter vorübergehend nicht verfügbar'] },
            { codes: ['PROVIDER_RATE_LIMITED'], summary: 'Zu viele Anfragen beim Kursanbieter', reasons: ['Zu viele Anfragen beim Kursanbieter'] },
            { codes: ['STARTUP_FALLBACK_TIMEOUT'], summary: 'Keine Kurse aktualisiert', reasons: ['Zeitlimit für Instrumentauflösung erreicht'] },
            { codes: ['STARTUP_TIMEOUT'], summary: 'Zeitlimit von 15 Sekunden erreicht', reasons: ['globales Zeitlimit erreicht'], status: 'timeout' },
            { codes: ['SYMBOL_NOT_FOUND', 'UNSUPPORTED_CURRENCY'], summary: '1 von 3 Kursen aktualisiert · 2 nicht aktualisiert',
                reasons: ['Instrument beim Kursdienst nicht gefunden', 'Kurs nicht in Euro'], updated: 1 },
            { codes: ['REQUEST_TIMEOUT', 'PROVIDER_UNAVAILABLE'], summary: 'Keine Kurse aktualisiert',
                reasons: ['Kursdienst antwortet nicht rechtzeitig', 'Kursanbieter vorübergehend nicht verfügbar'] }
        ];
        let requests = 0; globalThis.fetch = () => { requests++; throw new Error('UNEXPECTED_REQUEST'); };
        for (const item of cases) {
            const report = { status: item.status || (item.updated ? 'complete' : 'offline'), updated: item.updated || 0, retrievedAt: epoch,
                results: item.codes.map(code => ({ profileId: 'a', trancheId: 'reason', status: 'failed', code, message: '<script>SECRET_PROVIDER</script>' })) };
            if (item.updated) report.results.unshift({ profileId: 'a', trancheId: 'success', status: 'updated' });
            const session = sessionStore(), bytes = JSON.stringify(report); session.setItem(STARTUP_PRICE_SESSION_KEY, bytes);
            const frozen = JSON.stringify({ backend: state.backend, cache: exportAllSync().records });
            const direct = dom(); renderStartupPriceStatus(direct.host, report);
            assert(direct.host.children[0].textContent.startsWith(item.summary), 'Zusammenfassung passt zum tatsächlichen Grund');
            for (const [index, reason] of item.reasons.entries()) {
                const row = statusRows(direct.host)[index];
                assert(row.includes(reason) && row.startsWith(`${personNames.a} / <Fonds & Partner>:`), 'Fehlerzeile enthält sicheren Namen und verständlichen eigenen Grund');
                assert(!row.includes(item.codes[index]) && !row.includes('SECRET_PROVIDER'), 'Fehlerzeile zeigt weder technische Kennung noch Providertext');
                assert(row.includes('Kurs vom'), 'Fehlerzeile liest den gespeicherten Kurszeitpunkt');
            }
            if (!item.codes.includes('PROXY_UNREACHABLE')) assert(!direct.host.children[0].textContent.includes('nicht erreichbar'), 'Nur ein reiner Proxyausfall behauptet Nichterreichbarkeit');
            const reload = dom(); completeProfilePageReadiness(reload.doc);
            await bindStartupPrices({ ...reload, session, initialize: async () => true, guard: createNavigationGuard() });
            assert.equal(reload.host.children[0].textContent, direct.host.children[0].textContent);
            assert.deepEqual(statusRows(reload.host), statusRows(direct.host), 'Lesender Binder erhält sämtliche Gründe und Namen');
            assert.equal(reload.host.children[1].children[0].children[0].href, 'depot-tranchen-manager.html');
            assert.equal(reload.host.children[2].className, 'startup-price-technical', 'Technikklappe bleibt nach Sitzungsreload vorhanden');
            assert.equal(session.getItem(STARTUP_PRICE_SESSION_KEY), bytes);
            assert.equal(JSON.stringify({ backend: state.backend, cache: exportAllSync().records }), frozen);
        }
        assert.equal(requests, 0); assert.equal(state.batches(), 0, 'Fehlerdarstellung und Sitzungsreload bleiben vollständig lesend');
    }
    console.log('Statusanzeige bleibt bei unlesbaren oder unvollständigen Quellen verfügbar');
    {
        const { host } = dom();
        const report = { status: 'offline', updated: 0, retrievedAt: epoch, results: [
            { profileId: 'p', trancheId: 't', status: 'failed', code: 'PROXY_UNREACHABLE', asOf: quote('NEW.DE').asOf }
        ] };
        const beforeReport = JSON.stringify(report);
        const sources = [undefined, null, {}, { registry: null }, { registry: {} },
            { registry: { profiles: null } }, { registry: { profiles: {} } },
            { registry: { profiles: { p: {} } } },
            { registry: { profiles: { p: { meta: null, data: null } } } },
            { activeId: 'p', liveRaw: '{', registry: { profiles: { p: {} } } },
            { activeId: 'p', liveRaw: '{}', registry: { profiles: { p: {} } } }
        ];
        const readers = sources.map(source => () => source);
        readers.push(() => { throw new Error('SOURCE_UNREADABLE'); });
        readers.push(() => ({ get registry() { throw new Error('REGISTRY_UNREADABLE'); } }));
        for (const readSource of readers) {
            let reads = 0;
            renderStartupPriceStatus(host, report, { readSource: () => { reads++; return readSource(); } });
            assert.equal(reads, 1, 'Defekte Quelle wird höchstens einmal gelesen');
            assert(host.children[0].textContent.startsWith('Kursdienst nicht erreichbar'), 'Defekte Quelle erhält die sachliche Fehlerzusammenfassung');
            assert(statusRows(host)[0].startsWith('Unbenannte Person / Unbenannte Tranche:'), 'Unvollständige Quelle behält sichere Ersatznamen');
            assert(statusRows(host)[0].includes('Kursdatum unbekannt'), 'Defekte Quelle erfindet keine Provenienz aus Bericht oder Abrufzeit');
            assert.equal(host.children[1].children[0].children[0].href, 'depot-tranchen-manager.html', 'Managerzugang bleibt bei defekter Quelle verfügbar');
            assert.equal(JSON.stringify(report), beforeReport, 'Defekte Quelle verändert keine Berichtsbytes');
        }
        renderStartupPriceStatus(host, { ...report, results: [{ ...report.results[0], profileName: 'Person', trancheName: 'Fonds' }] }, {
            readSource: () => ({ registry: {} })
        });
        assert(statusRows(host)[0].startsWith('Person / Fonds:'), 'Vorhandene Berichtsnamen bleiben ohne lesbare Registry erhalten');
    }

    console.log('Bereitschaft, Recovery, Sitzung und gemeinsame Suche/Wiederholung');
    {
        const { backend, batches } = await setup([lot('a1', 'VWCE.DE'), lot('a2', '', { isin: 'IE00TEST00001' })],
            [lot('b1', ' vwce.de '), lot('b2', '', { isin: 'IE00TEST00001', name: 'Anderer Anzeigename' })]);
        const requests = [], counts = new Map();
        globalThis.fetch = async url => {
            const value = new URL(url); const key = value.pathname + value.search;
            requests.push(key); counts.set(key, (counts.get(key) || 0) + 1);
            const symbol = value.searchParams.get('symbol');
            if (symbol === 'IE00TEST00001') return json({ code: 'SYMBOL_NOT_FOUND' }, 404);
            if (value.pathname === '/search') return json({ quotes: [{ symbol: 'FUND.DE' }] });
            if (symbol === 'FUND.DE' && counts.get(key) === 1) return json({ code: 'PROVIDER_UNAVAILABLE' }, 503);
            return json(quote(symbol));
        };
        const { doc, win, host } = dom(); const session = sessionStore(); const gate = deferred();
        const task = bindStartupPrices({ doc, win, session, guard: createNavigationGuard(), initialize: () => gate.promise });
        await settle(); assert.equal(requests.length, 0); assert.equal(batches(), 0);
        gate.resolve(true); await settle(); assert.equal(requests.length, 0, 'Profilbereitschaft fehlt noch');
        completeProfilePageReadiness(doc); await settle(); await advance(200); await task;
        assert.equal(counts.get('/quote?symbol=VWCE.DE'), 1);
        assert.equal(counts.get('/quote?symbol=IE00TEST00001'), 1);
        assert.equal(counts.get('/search?q=IE00TEST00001'), 1, 'Name vervielfacht ISIN-Suche nicht');
        assert.equal(counts.get('/quote?symbol=FUND.DE'), 2, 'Ein gemeinsam benutzter Retry');
        assert.equal(batches(), 1);
        const current = JSON.parse(backend.depot_tranchen); const registry = JSON.parse(backend.rs_profiles_v1);
        assert.equal(current[0].marketValue, 240);
        assert.equal(registry.profiles.a.data.depot_tranchen, backend.depot_tranchen);
        assert.equal(registry.profiles.a.data.sim_audit_bytes, ' { "audit": [] } ');
        assert.equal(JSON.parse(registry.profiles.b.data.depot_tranchen)[1].ticker, 'FUND.DE');
        const firstRows = statusRows(host);
        assert.deepEqual(firstRows, [], 'Vollerfolg erzeugt keine Einzelliste');
        assert(host.children[0].textContent.includes('Kurse aktualisiert · 4 von 4'), 'Vollerfolg ist eine kompakte Zusammenfassung');
        const saved = JSON.parse(session.getItem(STARTUP_PRICE_SESSION_KEY));
        assertSessionReport(saved);
        assert.equal(saved.updated, 4); assert.equal(saved.retrievedAt, time);
        assert(saved.results.every(result => result.asOf === quote('FUND.DE').asOf), 'Sitzungsbericht bewahrt echte Kurszeitpunkte');
        const before = JSON.stringify(backend), count = requests.length;
        const second = dom(); completeProfilePageReadiness(second.doc);
        await bindStartupPrices({ ...second, session: { getItem: session.getItem, setItem: session.setItem }, initialize: async () => true, guard: createNavigationGuard() });
        assert.equal(requests.length, count); assert.equal(batches(), 1); assert.equal(JSON.stringify(backend), before);
        assert.deepEqual(statusRows(second.host), firstRows, 'Echter Sitzungsleseweg zeigt dieselben Namen und UTC-Kursstände');
        assert(!session.getItem(STARTUP_PRICE_SESSION_KEY).includes('currentPrice'));
        const recovery = dom(); completeProfilePageReadiness(recovery.doc, null, false);
        await bindStartupPrices({ ...recovery, session: sessionStore(), initialize: async () => true, guard: createNavigationGuard() });
        assert.equal(requests.length, count);
    }
    console.log('Echter Binder ordnet Fehlkurse, übersprungene Jobs und beschädigte Bestände lesbar zu');
    {
        const state = await setup([lot('good', 'GOOD.DE'), lot('missing', ''),
            lot('', 'UNMAPPABLE.DE', { schemaVersion: undefined, name: 'Nicht zuordenbarer Fonds' })], [lot('failed', 'FAIL.DE')]);
        const registry = JSON.parse(state.backend.rs_profiles_v1);
        registry.profiles.c.data.depot_tranchen = '{synthetisch-beschädigt';
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry)); await flush();
        globalThis.fetch = async url => {
            const u = new URL(url);
            if (u.pathname === '/search') return json({ quotes: [] });
            return u.searchParams.get('symbol') === 'FAIL.DE' ? json({ code: 'SYMBOL_NOT_FOUND' }, 404) : json(quote('GOOD.DE'));
        };
        const page = dom(), session = sessionStore(); completeProfilePageReadiness(page.doc);
        await bindStartupPrices({ ...page, session, initialize: async () => true, guard: createNavigationGuard() });
        const rows = statusRows(page.host);
        assert(rows.some(row => row.startsWith(`${personNames.a} / Tranche missing: Ticker oder ISIN fehlt`)), 'Übersprungener Job behält Namen und Grund');
        assert(rows.some(row => row.startsWith(`${personNames.a} / Nicht zuordenbarer Fonds: Originalrecord nicht eindeutig zuordenbar`)), 'Nicht zuordenbarer Job behält Namen und Grund');
        assert(rows.some(row => row.startsWith(`${personNames.b} / Tranche failed:`) && row.includes('bisherigen Kurs beibehalten')), 'Fehlkurs nennt inaktive Person und ihre Tranche');
        assert(rows.some(row => row.startsWith(`${personNames.c} / Bestand: Tranchenbestand nicht lesbar`)), 'Beschädigter Bestand nennt Person und Bestand');
        assertSessionReport(JSON.parse(session.getItem(STARTUP_PRICE_SESSION_KEY)));
    }
    console.log('Altmerker ergänzt Namen ausschließlich lesend über eindeutige stabile IDs');
    {
        const legacy = { id: 'legacy', name: 'Legacyfonds', ticker: 'LEGACY.DE' };
        const state = await setup([lot('second', 'SECOND.DE'), lot('first', 'FIRST.DE')],
            [legacy, { id: 'duplicate', name: 'Doppelter Name eins' }, { trancheId: 'duplicate', name: 'Doppelter Name zwei' }]);
        const registry = JSON.parse(state.backend.rs_profiles_v1);
        registry.profiles.c.data.depot_tranchen = '{synthetisch-beschädigt';
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry)); await flush();
        const report = { status: 'complete', updated: 2, retrievedAt: epoch, results: [
            { profileId: 'a', trancheId: 'first', status: 'updated', asOf: quote('FIRST.DE').asOf },
            { profileId: 'b', trancheId: 'legacy', status: 'updated', asOf: quote('LEGACY.DE').asOf },
            { profileId: 'b', trancheId: 'duplicate', status: 'failed', code: 'NOT_STORED' },
            { profileId: 'a', trancheId: 'removed', status: 'skipped' },
            { profileId: 'removed-person', trancheId: 'removed-lot', status: 'skipped' },
            { profileId: 'c', status: 'failed', code: 'TRANCHE_STORAGE_CORRUPT' },
            { profileId: 'a', trancheId: 'second', profileName: 'Name bei Abruf', trancheName: 'Tranche bei Abruf', status: 'skipped' }
        ] };
        const session = sessionStore(), prior = JSON.stringify(report);
        session.setItem(STARTUP_PRICE_SESSION_KEY, prior);
        const before = JSON.stringify(state.backend), mirrorBefore = JSON.stringify(exportAllSync().records), batchesBefore = state.batches();
        let requests = 0; globalThis.fetch = () => { requests++; throw new Error('unexpected'); };
        const page = dom(); completeProfilePageReadiness(page.doc);
        await bindStartupPrices({ ...page, session, initialize: async () => true, guard: createNavigationGuard() });
        const rows = statusRows(page.host);
        assert.equal(rows.length, 5, 'Altbericht zeigt ausschließlich betroffene Tranchen');
        assert(rows[0].startsWith(`${personNames.b} / Unbenannte Tranche:`) && rows[0].includes('Kursdatum unbekannt'), 'Doppelte stabile ID wird nicht geraten');
        assert(rows[1].startsWith(`${personNames.a} / Unbenannte Tranche:`), 'Entfernte Tranche erhält Ersatztext');
        assert(rows[2].startsWith('Unbenannte Person / Unbenannte Tranche:'), 'Entfernte Identitäten erhalten verständliche Ersatztexte');
        assert(rows[3].startsWith(`${personNames.c} / Bestand:`), 'Beschädigter Altbestand behält lesbare Person und Bestandsbezeichnung');
        assert(rows[4].startsWith('Name bei Abruf / Tranche bei Abruf:'), 'Vorhandene Namen bleiben erhalten');
        const unavailable = dom(); completeProfilePageReadiness(unavailable.doc);
        await bindStartupPrices({ ...unavailable, session: { getItem: session.getItem, setItem: session.setItem },
            source: () => { throw new Error('PROFILE_CONTEXT_UNAVAILABLE'); }, initialize: async () => true, guard: createNavigationGuard() });
        assert(statusRows(unavailable.host)[0].startsWith('Unbenannte Person / Unbenannte Tranche:'), 'Nicht lesbare Quelle verhindert weder Altbericht noch Ersatztexte');
        assert.equal(requests, 0); assert.equal(state.batches(), batchesBefore);
        assert.equal(JSON.stringify(state.backend), before); assert.equal(JSON.stringify(exportAllSync().records), mirrorBefore);
        assert.equal(session.getItem(STARTUP_PRICE_SESSION_KEY), prior, 'Altmerker wird weder ersetzt noch zurückgesetzt');
    }
    console.log('Lokale Reserve erhält frühe Erfolge trotz hängender gemischter Fallbacks');
    {
        const slow = deferred(), search = deferred();
        const state = await setup([lot('fast', 'FAST.DE'), lot('slow', 'SLOW.DE', { isin: 'IE00SLOW0001' }), lot('search', 'SEARCH.DE'), lot('retry', 'RETRY.DE')]);
        const beforeTimeout = JSON.stringify(state.backend), cacheBefore = JSON.stringify(exportAllSync().records);
        const originalInactive = structuredClone(state.registry.profiles.b);
        globalThis.fetch = async url => {
            const u = new URL(url), symbol = u.searchParams.get('symbol');
            if (symbol === 'FAST.DE') return json(quote(symbol));
            if (symbol === 'SLOW.DE') return slow.promise;
            if (u.pathname === '/search') return search.promise;
            return json({ code: symbol === 'RETRY.DE' ? 'PROVIDER_UNAVAILABLE' : 'SYMBOL_NOT_FOUND' }, symbol === 'RETRY.DE' ? 503 : 404);
        };
        const { task } = startCoordinator(); let done = false; task.then(() => { done = true; });
        await settle(); await advance(STARTUP_PRICE_TIMEOUT_MS - 1001);
        assert.equal(done, false); assert.equal(state.batches(), 0);
        await advance(1); const result = await task;
        assert.equal(result.status, 'complete'); assert.equal(result.updated, 2); assert.equal(state.batches(), 1);
        assert(JSON.stringify(state.backend) !== beforeTimeout && JSON.stringify(exportAllSync().records) !== cacheBefore, 'Bestätigte frühe Kurse erreichen Backend und Cache');
        const page = dom(); renderStartupPriceStatus(page.host, result);
        assert(page.host.children[0].textContent.includes('nicht aktualisiert') && !page.host.children[0].textContent.includes('nicht erreichbar'), 'Lokaler Teilabschluss behauptet keinen Dienstausfall');
        for (const id of ['a', 'b']) {
            assert(statusRows(page.host).some(row => row.startsWith(`${personNames[id]} / Tranche slow: Zeitlimit für Instrumentauflösung`)), 'Nach lokalem Schluss ergänzte Ergebnisse behalten die jeweilige Zuordnung');
        }
        const registry = JSON.parse(state.backend.rs_profiles_v1);
        const expectedInactive = structuredClone(originalInactive);
        expectedInactive.data.depot_tranchen = JSON.stringify(JSON.parse(expectedInactive.data.depot_tranchen).map(record => record.ticker === 'FAST.DE'
            ? { ...record, currentPrice: 120, asOf: quote('FAST.DE').asOf } : record));
        assert.deepEqual(registry.profiles.b, expectedInactive);
        const before = JSON.stringify(state.backend);
        slow.resolve(json(quote('SLOW.DE', 999))); search.resolve(json({ quotes: [{ symbol: 'LATE.DE' }] }));
        await settle(); await advance(1000);
        assert.equal(JSON.stringify(state.backend), before); assert.equal(state.batches(), 1);
    }
    console.log('Echter Binder: Navigation, Pagehide und Profilwechsel verwerfen frühere Erfolge');
    for (const trigger of ['navigation', 'link', 'pagehide', 'unload', 'profile', 'profile-pagehide']) {
        const slow = deferred(); const state = await setup([lot('fast', 'FAST.DE'), lot('slow', 'SLOW.DE')]);
        const before = JSON.stringify(state.backend);
        globalThis.fetch = async url => new URL(url).searchParams.get('symbol') === 'FAST.DE' ? json(quote('FAST.DE')) : slow.promise;
        const { doc, win, host } = dom(); completeProfilePageReadiness(doc); const guard = createNavigationGuard({ decide: async () => true });
        const task = bindStartupPrices({ doc, win, session: sessionStore(), initialize: async () => true, guard });
        await settle(); await advance(13999);
        let replayed = false;
        if (trigger === 'navigation') { const attempt = await guard.prepare(); assert(attempt); guard.end(attempt); }
        else if (trigger === 'link') {
            const target = { closest(selector) { return selector === 'a[href]' ? this : null; },
                hasAttribute: () => false, getAttribute: key => key === 'href' ? 'Balance.html' : '', click() {
                    replayed = true; assert.equal(guard.reasons().length, 0, 'Rahmenlink erst nach Abbruchende');
                    assert.equal(JSON.stringify(state.backend), before, 'Rahmenlink verwirft früheren Teilerfolg');
                } };
            doc.dispatch('click', { target, type: 'click', button: 0, preventDefault() {}, stopImmediatePropagation() {} });
        }
        else if (['profile', 'profile-pagehide'].includes(trigger)) {
            const target = { id: 'profileSelect', closest() { return this; }, dispatchEvent() {
                replayed = true; assert.equal(guard.reasons().length, 0, 'Wechsel erst nach Abbruchende');
                assert.equal(JSON.stringify(state.backend), before, 'Keine Kurswrites vor Profilwechsel');
                assert.equal(switchProfile('b'), true, 'Bestehender Profilwechsel startet nach Abbruchende');
                void flush();
            } };
            doc.dispatch('change', { target, type: 'change', preventDefault() {}, stopImmediatePropagation() {} });
            if (trigger === 'profile-pagehide') win.dispatchEvent(new Event('pagehide'));
        } else win.dispatchEvent(new Event(trigger));
        await task; await settle();
        if (['profile', 'link'].includes(trigger)) assert(replayed);
        if (trigger === 'profile-pagehide') assert.equal(replayed, false, 'Nach tatsächlichem Pagehide wird der aufgeschobene Profilhandler nicht mehr gestartet');
        if (['profile', 'link', 'navigation'].includes(trigger)) assert(host.children[0].textContent.includes('verworfen'), 'Verbleibendes Startdokument zeigt abgeschlossenen Abbruch statt laufendem Abruf');
        const expectedBatches = trigger === 'profile' ? 1 : 0;
        assert.equal(state.batches(), expectedBatches, 'Nur ein etwaiger Nutzer-Profilwechsel darf schreiben');
        const stored = JSON.parse(state.backend.rs_profiles_v1);
        for (const id of ['a', 'b']) assert.equal(stored.profiles[id].data.depot_tranchen,
            state.registry.profiles[id].data.depot_tranchen, 'Aktive und inaktive Kursfelder bleiben vor und nach Wechsel unverändert');
        if (trigger !== 'profile') assert.equal(JSON.stringify(state.backend), before);
        const afterSwitch = JSON.stringify(state.backend);
        slow.resolve(json(quote('SLOW.DE', 999))); await settle(); await advance(2000);
        assert.equal(state.batches(), expectedBatches); assert.equal(JSON.stringify(state.backend), afterSwitch);
    }
    console.log('Commit schützt Navigation bis zur Backendbestätigung; Fehler bestätigen keinen Erfolg');
    {
        const hold = deferred(); const state = await setup([lot('one', 'ONE.DE')], undefined, { hold });
        globalThis.fetch = async url => json(quote(new URL(url).searchParams.get('symbol')));
        const { doc, win } = dom(); completeProfilePageReadiness(doc); const guard = createNavigationGuard({ decide: async () => true });
        const control = { disabled: false }; doc.getElementById = id => id === 'profileSelect' ? control : null;
        const task = bindStartupPrices({ doc, win, session: sessionStore(), initialize: async () => true, guard });
        await settle(); assert.equal(control.disabled, true, 'Native Profilauswahl während Commit gesperrt'); assert(guard.reasons().some(reason => reason.phase === 'commit'));
        assert.equal(await guard.prepare(), null);
        let replayed = false;
        const target = { id: 'profileSelect', closest() { return this; }, dispatchEvent() { replayed = true; } };
        doc.dispatch('change', { target, type: 'change', preventDefault() {}, stopImmediatePropagation() {} });
        await settle(); assert.equal(replayed, false);
        assert.equal(JSON.parse(state.backend.depot_tranchen)[0].currentPrice, 100);
        hold.resolve(); await task;
        assert.equal(control.disabled, false, 'Native Profilauswahl nach Bestätigung wieder bedienbar');
        assert.equal(JSON.parse(state.backend.depot_tranchen)[0].currentPrice, 120);
        const attempt = await guard.prepare(); assert(attempt); guard.end(attempt);
    }
    {
        const state = await setup([lot('one', 'ONE.DE')], undefined, { fail: true }); const before = JSON.stringify(state.backend);
        const result = await startCoordinator().task;
        assert.equal(result.status, 'storage-failed'); assert.equal(result.updated, 0); assert.equal(result.restored, true);
        assert.equal(JSON.stringify(state.backend), before);
        assert.deepEqual({ ...exportAllSync().records }, JSON.parse(before)); assert.equal(state.batches(), 2);
    }
    console.log('Aktiver kanonischer Weg bewahrt inaktive Legacy-/Zusatzfelder und vollständiges Audit');
    {
        const legacy = { id: 'legacy', name: 'Synthetisches Legacygold', kind: 'gold', shares: 2, purchasePrice: 80,
            currentPrice: 100, tqf: 1, ticker: 'GOLD.DE', notes: '  Rohnotiz  ', extension: { keep: true } };
        const state = await setup([lot('active', 'ONE.DE')], [legacy, { ...legacy, id: 'failed', ticker: 'FAIL.DE' }]);
        const registry = JSON.parse(state.backend.rs_profiles_v1);
        delete registry.profiles.b.meta.id;
        registry.profiles.b.meta.other = 'Zusatzmetadatum';
        state.backend.rs_profiles_v1 = JSON.stringify(registry);
        // Die geprüfte Quelle stammt aus dem Adapter und enthält die Legacy-Metadaten.
        resetPersistenceForTests({ loadAll: async () => ({ ...state.backend }), saveBatch: async ({ upserts }) => {
            upserts.forEach(([key, value]) => { state.backend[key] = value; });
        } });
        await init({ installLifecycleHooks: false, debounceMs: 60000 });
        globalThis.fetch = async url => {
            const u = new URL(url), symbol = u.searchParams.get('symbol');
            if (symbol === 'FAIL.DE') return json({ code: 'SYMBOL_NOT_FOUND' }, 404);
            if (u.pathname === '/search') return json({ quotes: [] });
            return json(quote(symbol));
        };
        const result = await startCoordinator().task;
        assert.equal(result.updated, 2);
        const expected = structuredClone(registry.profiles.b);
        expected.data.depot_tranchen = JSON.stringify([{ ...legacy, currentPrice: 120, asOf: quote('GOLD.DE').asOf, ticker: 'GOLD.DE' },
            { ...legacy, id: 'failed', ticker: 'FAIL.DE' }]);
        const after = JSON.parse(state.backend.rs_profiles_v1);
        assert.deepEqual(after.profiles.b, expected, 'Inaktiver Legacyrecord erhält id/kind/TQF/fehlende Schema- und Steuermarker unverändert');
        assert.deepEqual(after.profiles.c, registry.profiles.c, 'Unbeteiligtes Profil bleibt vollständig gleich');
        assert.deepEqual(after.trancheReconciliation, registry.trancheReconciliation, 'Vollständiges Audit bleibt unverändert');
        assert.equal(after.profiles.a.data.depot_tranchen, state.backend.depot_tranchen);
        assert.equal(JSON.parse(state.backend.depot_tranchen)[0].marketValue, 240);
    }

    console.log('Bestands-/Verwaltungsänderung und fehlender Sitzungsspeicher erzeugen keine Kurswrites');
    {
        const slow = deferred(); const state = await setup([lot('one', 'ONE.DE')]);
        globalThis.fetch = () => slow.promise;
        const { task } = startCoordinator(); await settle();
        const foreign = JSON.parse(state.backend.rs_profiles_v1); foreign.profiles.b.meta.name = 'Fremd';
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(foreign)); await flush();
        const before = JSON.stringify(state.backend);
        slow.resolve(json(quote('ONE.DE'))); const result = await task;
        assert.equal(result.status, 'changed'); assert.equal(result.updated, 0); assert.equal(JSON.stringify(state.backend), before);
        assert.equal(state.batches(), 1);
        let requests = 0; globalThis.fetch = () => { requests++; throw new Error('unexpected'); };
        const broken = { getItem() { throw new Error('session unavailable'); } };
        for (let i = 0; i < 2; i++) { const page = dom(); completeProfilePageReadiness(page.doc);
            await bindStartupPrices({ ...page, session: broken, initialize: async () => true, guard: createNavigationGuard() }); }
        assert.equal(requests, 0);
    }
    console.log('✓ Startkurse: Sitzungs-, Deadline-, Navigations- und Backendverträge');
} finally {
    resetPersistenceForTests(); globalThis.fetch = original.fetch; globalThis.setTimeout = original.setTimeout;
    globalThis.clearTimeout = original.clearTimeout; globalThis.Date = original.Date;
}

{
    const { setAppTestDate } = await import('../app/shared/app-clock.js');
    const { syntheticQuote } = await import('../app/shared/probelauf-prices.js');
    let network = 0;
    try {
        installClock(); setAppTestDate('2027-07-01');
        await setup([lot('muster-direkt', 'VWCE.DE'), lot('muster-isin', '', { isin: 'IE00BK5BQT80' })]);
        globalThis.fetch = () => { network++; throw new Error('Kursnetz im Probelauf verboten'); };
        const result = await startCoordinator().task;
        assertEqual(result.status, 'complete', 'Synthetische Startautomatik bestätigt alle Gruppen');
        const saved = JSON.parse(persistenceStorage.getItem('depot_tranchen'));
        assert(saved.every(lot => lot.currentPrice === syntheticQuote('VWCE.DE', '2027-07-01').price), 'Startquote und ISINquote sind identisch');
        assertEqual(network, 0, 'Startup erreicht werfende Netzwerkfunktion nie');
    } finally {
        setAppTestDate(null); resetPersistenceForTests(); globalThis.fetch = original.fetch;
        globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; globalThis.Date = original.Date;
    }
}
{
    const { readStartupPriceReport } = await import('../app/tranches/tranchen-startup-prices.js');
    let writes = 0;
    const report = { status: 'offline', retrievedAt: 123, results: [{ profileId: 'a', trancheId: 'x', status: 'failed' }] };
    const session = { getItem: () => JSON.stringify(report), setItem: () => { writes++; } };
    assert.deepEqual(readStartupPriceReport(session), report, 'Unterseite liest bestehenden Sitzungsreport mit Versuchszeit');
    assert.equal(writes, 0, 'Sitzungsreportleser startet keinen Quotejob und schreibt keinen Marker');
    assert.equal(readStartupPriceReport({ getItem: () => '{kaputt' }), null, 'Defekter Sitzungsreport bleibt unbekannt');
}

{
    const { syntheticQuote } = await import('../app/shared/probelauf-prices.js');
    const { overviewPricesDone } = await import('../app/overview/overview-model.js');
    const saturday = '2027-01-02', quote = syntheticQuote('VWCE.DE', saturday);
    assert(overviewPricesDone({ now: new Date(2027, 0, 2, 12), quoteDate: new Date(quote.asOf * 1000).toISOString(),
        priceTranches: [{ profileId: 'a', trancheId: 'synthetic', asOf: quote.asOf }],
        occasion: { kind: 'annual', closingYear: 2026 } }), 'Synthetischer Wochenendkurs erfüllt den Jahresstand am 02.01.2027');
}
