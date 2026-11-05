import fs from 'node:fs/promises';
import https from 'node:https';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { createAnnualMarketDataReaders, createAnnualMarketDataRequest, CAPE_SOURCES } from '../app/shared/annual-marketdata.js';
import { createInflationReaders } from '../app/balance/balance-annual-inflation.js';
import { AppError, CONFIG } from '../app/balance/balance-config.js';
import { GERMAN_CPI_RESEARCH_CHAIN } from '../app/simulator/german-cpi-chain.js';
import { US_SHILLER_CAPE_CHAIN } from '../app/simulator/us-shiller-cape-chain.js';
import { readBiff8Sheet } from './lib/biff8-numeric-sheet.mjs';

const ROOT = new URL('../', import.meta.url);
const ORIGINS = ['http://tauri.localhost', 'https://tauri.localhost'];
const TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const nativeFetch = globalThis.fetch;
const isolated = 'LP-1: andere Quelle für Einzelprobe gesperrt';
const excerpt = text => String(text).split(/\r?\n/).filter(line => line.trim()).slice(0, 2).map(line => line.slice(0, 240)).join('\n');
const number = value => Number.isFinite(value) ? value.toFixed(4) : '—';

export function corsAllows(allowOrigin, origin) {
    return allowOrigin === '*' || allowOrigin === origin;
}

export function connectAllows(address, policy, origin) {
    const url = new URL(address);
    return policy.split(/\s+/).some(entry => entry === '*' || entry === "'self'" && url.origin === origin
        || entry === url.protocol || entry === url.origin);
}

/** Manual redirects expose every contacted host. A cross-origin redirect taints the browser Origin. */
export async function fetchTrace(address, options, origin, policy, fetchImpl = nativeFetch) {
    const started = performance.now();
    const trace = { origin, url: String(address), hops: [], ms: 0 };
    const timer = AbortSignal.timeout(TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timer]) : timer;
    let url = new URL(address), requestOrigin = origin;
    try {
        for (let redirects = 0; redirects <= 4; redirects++) {
            const headers = new Headers(options.headers);
            headers.set('Origin', requestOrigin);
            if (headers.has('X-Return-Format')) {
                const response = await fetchImpl(url, { method: 'OPTIONS', signal, redirect: 'manual', headers: {
                    Origin: requestOrigin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-return-format'
                } });
                const allowed = response.headers.get('access-control-allow-headers')?.toLowerCase().split(/,\s*/) || [];
                const methods = response.headers.get('access-control-allow-methods')?.toUpperCase().split(/,\s*/) || [];
                const preflight = { status: response.status, acao: response.headers.get('access-control-allow-origin'),
                    allowedHeaders: allowed, methods };
                preflight.ok = response.ok && corsAllows(preflight.acao, requestOrigin)
                    && (allowed.includes('x-return-format') || allowed.includes('*')) && methods.includes('GET');
                (trace.preflights ||= []).push(preflight);
                await response.body?.cancel();
            }
            const response = await fetchImpl(url, { ...options, headers, signal, redirect: 'manual' });
            const hop = { url: url.href, origin: requestOrigin, status: response.status,
                connectSrc: connectAllows(url, policy, origin), acao: response.headers.get('access-control-allow-origin') };
            hop.cors = corsAllows(hop.acao, requestOrigin);
            trace.hops.push(hop);
            const location = response.headers.get('location');
            if ([301, 302, 303, 307, 308].includes(response.status) && location) {
                await response.body?.cancel();
                const next = new URL(location, url);
                if (!['http:', 'https:'].includes(next.protocol)) throw new Error('Nicht unterstützte Weiterleitung');
                if (url.origin !== next.origin) requestOrigin = 'null';
                url = next;
                continue;
            }
            const chunks = [];
            let size = 0;
            for await (const chunk of response.body || []) {
                size += chunk.byteLength;
                if (size > MAX_BODY_BYTES) throw new Error('Antwort größer als 8 MiB');
                chunks.push(chunk);
            }
            const body = Buffer.concat(chunks).toString('utf8');
            trace.excerpt = excerpt(body);
            trace.ms = Math.round(performance.now() - started);
            return { trace, response: new Response([204, 205, 304].includes(response.status) ? null : body,
                { status: response.status, headers: response.headers }) };
        }
        throw new Error('Mehr als vier Weiterleitungen');
    } catch (error) {
        trace.error = [error.message, error.cause?.code, error.cause?.message].filter(Boolean).join(' / ');
        trace.ms = Math.round(performance.now() - started);
        return { trace, error };
    }
}

const memoryStorage = records => ({ getItem: key => records[key] ?? null });

/** Only transport is instrumented; selection, parsers and validation stay in the application readers. */
export async function probeSource(source, year, policy, { fetchImpl = nativeFetch, upstream = [] } = {}) {
    const result = { source: source.label, kind: source.kind, year, code: source.code, runs: [], notes: [], grade: 'GRÜN' };
    for (const origin of source.offline ? [null] : ORIGINS) {
        const run = { origin, requests: [], upstream: [], appMessages: [] };
        const cache = new Map();
        const instrumentedFetch = async (url, options = {}) => {
            if (!source.matches(String(url))) throw new AppError(isolated);
            // App retries replay the same response, keeping live traffic to one request per URL and Origin.
            const key = String(url);
            if (!cache.has(key)) cache.set(key, fetchTrace(url, options, origin, policy, fetchImpl));
            const captured = await cache.get(key);
            if (!run.requests.includes(captured.trace)) run.requests.push(captured.trace);
            if (captured.error) throw captured.error;
            return captured.response.clone();
        };
        const previousFetch = globalThis.fetch, previousInfo = console.info, previousError = console.error;
        const startUpstream = upstream.length;
        try {
            globalThis.fetch = instrumentedFetch;
            console.info = (...args) => run.appMessages.push(args);
            console.error = (...args) => run.appMessages.push(args);
            const storage = memoryStorage(source.records || {});
            const readers = source.kind === 'inflation' ? createInflationReaders({ fetchImpl: instrumentedFetch })
                : createAnnualMarketDataReaders({ storage });
            run.value = await readers[source.method]({ targetYear: year });
            if (source.expectManualCape && (run.value.capeRatio !== null || !run.value.manualHint?.includes('CAPE nicht automatisch ermittelt'))) {
                throw new Error('Gespeicherter Altwert wurde automatisch übernommen oder der Handeingabe-Hinweis fehlt');
            }
            if (source.capeSource && run.value.capeSource !== source.capeSource) {
                throw new Error(run.value.errors?.filter(message => !message.includes(isolated)).join('; ') || 'Kein CAPE-Wert dieser Quelle');
            }
            if (source.kind === 'cape' && !source.offline && run.value.capeAsOf) {
                const [valueYear, valueMonth] = run.value.capeAsOf.split('-');
                const dateToken = new RegExp(`\\b${valueYear}[.\\-/]0?${Number(valueMonth)}\\b`);
                for (const captured of cache.values()) {
                    const { response, trace } = await captured;
                    if (response) {
                        const line = (await response.clone().text()).split(/\r?\n/).find(text => dateToken.test(text));
                        if (line) trace.excerpt = excerpt(line);
                    }
                }
            }
        } catch (error) {
            const attempts = error.context?.attempts?.filter(attempt => !attempt.error.includes(isolated));
            run.error = attempts?.length ? attempts.map(attempt => attempt.error).join('; ') : error.message;
        } finally {
            globalThis.fetch = previousFetch;
            console.info = previousInfo;
            console.error = previousError;
            run.upstream = upstream.slice(startUpstream);
        }
        if (run.error || !source.offline && !run.requests.length) result.grade = 'ROT';
        for (const request of run.requests) {
            if (request.error || request.preflights?.some(item => !item.ok)) result.grade = 'ROT';
            for (const hop of request.hops) {
                if (!hop.connectSrc || !hop.cors || hop.status >= 400) result.grade = 'ROT';
            }
        }
        result.runs.push(run);
    }
    result.notes.push(...new Set(result.runs.flatMap(run => [
        ...(run.error ? [run.error] : []),
        ...run.requests.flatMap(request => request.hops.flatMap(hop => [
            ...(!hop.connectSrc ? [`connect-src fehlt: ${new URL(hop.url).origin}`] : []),
            ...(!hop.cors ? [`CORS fehlt: Origin ${hop.origin}, ACAO ${hop.acao ?? '(fehlt)'}`] : [])
        ]))
    ])));
    return result;
}

function caution(row, message) {
    if (row.grade === 'GRÜN') row.grade = 'GELB';
    row.notes.push(message);
}

export function plausibility(rows, year, monthlyCape = {}) {
    const cpi = GERMAN_CPI_RESEARCH_CHAIN.annualRates[year];
    // Return year t contains December t-1, so December 2024 lives under 2025.
    const cape = US_SHILLER_CAPE_CHAIN.observationsByReturnYear[year + 1]?.value ?? monthlyCape[`${year}-12`];
    for (const row of rows) {
        const values = row.runs.filter(run => !run.error && Number.isFinite(run.value?.capeRatio ?? run.value?.rate ?? run.value?.price)).map(run => run.value);
        if (row.kind === 'inflation') {
            row.notes.push(`Repo-CPI ${year}: ${number(cpi)} %; HICP und CPI haben verschiedene Warenkörbe`);
            if (values.some(value => Math.abs(value.rate - cpi) > 0.3)) caution(row, 'Abweichung vom Repo-CPI > 0,3 Prozentpunkte');
        }
        if (row.kind === 'cape') {
            row.notes.push(Number.isFinite(cape) ? `Repo Dezember ${year}: ${number(cape)} (Dezember t entspricht Reihenjahr t+1)` : `Kein Dezember-${year}-Vergleich im Repo`);
            for (const value of values) {
                if (value.capeFetchStatus === 'warn_stale_source') { row.grade = 'ROT'; row.notes.push('Veralteter CAPE darf nicht automatisch übernommen werden'); }
                if (!value.capeAsOf?.startsWith(`${year}-12`)) caution(row, `Stichtag ${value.capeAsOf} passt nicht zu Dezember ${year}; ${row.offline ? 'gespeicherter Rückfall' : 'letzter verfügbarer Stand im Abschlussjahr'}`);
                if (Number.isFinite(cape)) row.notes.push(`Differenz zum Dezember-Repo: ${number(value.capeRatio - cape)}${value.capeAsOf?.startsWith(`${year}-12`) ? '' : ' (verschiedene Stichtage)'}`);
                const sameMonth = monthlyCape[value.capeAsOf?.slice(0, 7)];
                if (Number.isFinite(sameMonth)) {
                    row.notes.push(`Repo-CAPE gleicher Monat ${value.capeAsOf.slice(0, 7)}: ${number(sameMonth)}`);
                    if (Math.abs(value.capeRatio - sameMonth) > 0.05) {
                        row.grade = 'ROT';
                        row.notes.push('Plausibilitätsfehler: CAPE gleicher Monat weicht mehr als Rundung (0,05) ab; Quellspalte prüfen');
                    }
                }
            }
        }
        if (row.kind === 'etf') row.notes.push('App-Prüfung: VWCE.DE, positiver Kurs, 27.–31.12.; kein festgeschriebener VWCE-Jahresschlusskurs im Repo');
    }
    // Check the two configured rates separately for both tested Origins.
    for (const origin of ORIGINS) {
        const comparable = rows.filter(row => row.kind === 'inflation').flatMap(row => {
            const run = row.runs.find(item => item.origin === origin && !item.error && Number.isFinite(item.value?.rate));
            return run ? [{ row, rate: run.value.rate }] : [];
        });
        const span = comparable.length >= 2 ? Math.max(...comparable.map(item => item.rate)) - Math.min(...comparable.map(item => item.rate)) : null;
        for (const row of rows.filter(item => item.kind === 'inflation')) {
            row.notes.push(`${origin}: ${comparable.length}/2 Raten, Spannweite ${number(span)} Prozentpunkte`);
            if (span > 0.3 && comparable.some(item => item.row === row)) caution(row, 'Inflationsquellen weichen >0,3 Prozentpunkte voneinander ab');
            if (comparable.length < 2) caution(row, 'Zweiquellenvergleich unvollständig');
        }
    }
}

export function compareYahooRequests(rust, node, request) {
    const fields = { symbol: 'VWCE.DE', period1: String(request.period1), period2: String(request.period2), interval: '1d' };
    const rustChart = rust.match(/fn handle_chart[\s\S]*?"(https:[^"]+)"/)[1];
    const nodeChart = node.match(/const proxyChart[\s\S]*?const url = `([^`]+)`/)[1];
    const args = Object.values(fields);
    let index = 0;
    const rustUrl = rustChart.replace(/\{\}/g, () => encodeURIComponent(args[index++]));
    const nodeUrl = nodeChart.replace(/\$\{encodeURIComponent\(([^)]+)\)\}/g,
        (_, key) => encodeURIComponent(fields[key] ?? (key === "interval || '1d'" ? '1d' : 'UNBEKANNT')));
    const rustFetch = rust.slice(rust.indexOf('fn fetch_json'), rust.indexOf('fn pick_chart_candidate'));
    const nodeFetch = node.slice(node.indexOf('const fetchJson'), node.indexOf('const pickChartCandidate'));
    const rustHeaders = { 'User-Agent': rustFetch.match(/\.user_agent\("([^"]+)"\)/)[1],
        ...Object.fromEntries([...rustFetch.matchAll(/\.header\("([^"]+)", "([^"]+)"\)/g)].map(match => match.slice(1, 3))) };
    const nodeHeaders = Object.fromEntries([...nodeFetch.matchAll(/(?:'([^']+)'|(Accept|Connection)):\s*'([^']+)'/g)]
        .map(match => [match[1] || match[2], match[3]]));
    const differences = [...new Set([...Object.keys(rustHeaders), ...Object.keys(nodeHeaders)])]
        .filter(key => rustHeaders[key] !== nodeHeaders[key])
        .map(key => `${key}: Rust=${rustHeaders[key] ?? '(nicht explizit gesetzt)'}, Node=${nodeHeaders[key] ?? '(nicht explizit gesetzt)'}`);
    return { rustUrl, nodeUrl, sameUrl: rustUrl === nodeUrl, rustHeaders, nodeHeaders, differences,
        limits: 'Node: kein Redirect-Follow, 4 s Socket-Inaktivität; Rust/reqwest: Redirect-Follow, 4 s Gesamtzeit. Yahoo liegt hinter dem lokalen Dienst; WebView-CSP/CORS gelten dort nicht.' };
}

function printRow(row) {
    const traces = row.runs.flatMap(run => run.requests);
    const reachable = row.offline ? 'entfällt (lokal)' : row.unconfigured ? 'ungeprüft' : traces.some(trace => trace.hops.length) ? 'ja' : 'nein';
    const status = traces.map(trace => trace.hops.map(hop => hop.status).join('→') || '—').join('/') || '—';
    const duration = traces.map(trace => `${trace.ms} ms`).join('/') || '—';
    const values = row.runs.map(run => run.error ? '—' : row.kind === 'inflation' ? `${number(run.value.rate)} % (${run.value.year})`
        : row.kind === 'etf' ? `${number(run.value.price)} EUR (${run.value.asOf})`
            : run.value.manualHint || `${number(run.value.capeRatio)} (${run.value.capeAsOf})`).join('/');
    row.notes = [...new Set(row.notes)];
    console.log(`${row.source} · erreichbar ${reachable} · HTTP ${status} · ${duration} · Wert ${values || '—'} · Plausibilität ${row.notes.join('; ') || 'kein lesbarer Wert'} · ${row.grade}`);
}

function argumentsForProbe(args) {
    let year = new Date().getFullYear() - 1;
    const proxies = [];
    for (let index = 0; index < args.length; index++) {
        const key = args[index], value = args[++index];
        if (key === '--jahr' && /^\d{4}$/.test(value || '')) year = Number(value);
        else if (key === '--etf-proxy' && value) {
            const url = new URL(value.replace('{url}', 'placeholder'));
            if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
                throw new Error('--etf-proxy verlangt eine lokale Proxyvorlage ohne Zugangsdaten');
            }
            proxies.push(value);
        } else throw new Error('Aufruf: npm run probe:jahreswechsel [-- --jahr JJJJ] [--etf-proxy lokale-URL-Vorlage]');
    }
    if (year < 1900 || year >= new Date().getFullYear()) throw new Error('Nur abgeschlossene Kalenderjahre ab 1900 sind zulässig');
    return { year, proxies };
}

export async function main(args = process.argv.slice(2)) {
    const { year, proxies } = argumentsForProbe(args);
    const [config, rust, node] = await Promise.all([
        fs.readFile(new URL('src-tauri/tauri.conf.json', ROOT), 'utf8').then(JSON.parse),
        fs.readFile(new URL('src-tauri/src/lib.rs', ROOT), 'utf8'),
        fs.readFile(new URL('tools/yahoo-proxy.cjs', ROOT), 'utf8')
    ]);
    const policy = config.app.security.csp['connect-src'];
    const capeMethod = US_SHILLER_CAPE_CHAIN.method;
    const { cells } = readBiff8Sheet(await fs.readFile(new URL(`data/historical/us-shiller-cape-chain/originals/${US_SHILLER_CAPE_CHAIN.sourceFile.fileName}`, ROOT)), capeMethod.sourceSheet);
    const monthlyCape = Object.fromEntries([...cells.values()].flatMap(row => {
        const date = row.get(capeMethod.sourceDateColumnZeroBased), value = row.get(capeMethod.sourceCapeColumnZeroBased);
        return Number.isFinite(date) && date > 1800 && Number.isFinite(value) ? [[date.toFixed(2).replace('.', '-'), value]] : [];
    }));
    const parity = compareYahooRequests(rust, node, createAnnualMarketDataRequest(`calendar-year:${year}`));
    console.log(`Liveprobe Jahreswechsel ${year} · ${new Date().toISOString()} · Node ${process.version}`);
    console.log(`Pro Quelle GETs für HTTP-/HTTPS-Tauri-Origin, CAPE zusätzlich mit OPTIONS für HTML-Kopfzeile; je Abruf höchstens ${TIMEOUT_MS} ms; App-Retries aus Transportcache. Keine Nutzerdaten.`);
    console.log(`connect-src: ${policy}`);
    console.log('OECD aus der App-Quellenreihe genommen: SDMX DF_PRICES_ALL, DEU.A.N.CPI.PA._T.N.GY liefert für einzelne Jahre weiter HTTP 500; aktiver Inflationsweg EZB → Weltbank.');
    console.log(`Yahoo-Anfragevergleich: ${JSON.stringify(parity)}`);
    const upstream = [];
    const previousRequest = https.request;
    // Observe the real development service without changing its URL, headers or response.
    https.request = function (url, options, callback) {
        const entry = { url: String(url), headers: options.headers, role: 'Server-Upstream; keine WebView-CORS/CSP-Anfrage' };
        upstream.push(entry);
        const started = performance.now();
        const req = previousRequest.call(this, url, options, response => {
            entry.status = response.statusCode;
            entry.location = response.headers.location || null;
            let preview = '';
            response.on('data', chunk => { if (preview.length < 600) preview += chunk.toString().slice(0, 600 - preview.length); });
            response.on('end', () => { entry.ms = Math.round(performance.now() - started); entry.excerpt = excerpt(preview); });
            callback(response);
        });
        req.on('error', error => { entry.error = error.message; entry.ms = Math.round(performance.now() - started); });
        return req;
    };
    const server = createRequire(import.meta.url)('../tools/yahoo-proxy.cjs').createServer();
    try {
        server.listen(8787, '127.0.0.1');
        await once(server, 'listening');
        console.log('Entwicklungsersatz tools/yahoo-proxy.cjs auf 127.0.0.1:8787 gestartet (kein EXE-Binary ausgeführt).');
        const sources = [
            { label: 'ETF VWCE.DE / lokaler Yahoo-Dienst', kind: 'etf', method: 'prepareETF', code: 'app/shared/annual-marketdata.js:339',
                matches: url => new URL(url).origin === 'http://127.0.0.1:8787' },
            ...proxies.map((proxy, index) => ({ label: `ETF Custom Proxy ${index + 1}`, kind: 'etf', method: 'prepareETF',
                code: 'app/shared/annual-marketdata.js:355', records: { etfProxyUrl: proxy },
                matches: url => url.startsWith(proxy.split('{url}')[0])
                    && !(new URL(url).origin === 'http://127.0.0.1:8787' && new URL(url).searchParams.has('symbol')) })),
            ...[['EZB (HICP)', 'data-api.ecb.europa.eu', 428], ['Weltbank (CPI)', 'api.worldbank.org', 455]]
                .map(([label, host, line]) => ({ label, kind: 'inflation', method: 'prepareInflation',
                    code: `app/balance/balance-annual-inflation.js:${line}`, matches: url => new URL(url).hostname === host })),
            ...[CAPE_SOURCES.PRIMARY].map(source => ({ label: source.label, capeSource: source.id,
                kind: 'cape', method: 'prepareCape', code: 'app/shared/annual-marketdata.js:prepareCape', matches: url => new URL(url).hostname === 'r.jina.ai' }))
        ];
        const rows = [];
        for (const source of sources) {
            const row = await probeSource(source, year, policy, { upstream });
            if (source.kind === 'etf' && (!parity.sameUrl || parity.differences.length)) caution(row, 'Node-/Rust-Anfragen nicht vollständig identisch; siehe Yahoo-Anfragevergleich');
            rows.push(row);
        }
        const storedReference = US_SHILLER_CAPE_CHAIN.observationsByReturnYear[2025];
        const stored = await probeSource({ label: 'CAPE / Ausfallhinweis mit gespeichertem Stand (Dezember 2024)', kind: 'cape',
            method: 'prepareCape', expectManualCape: true, matches: () => false, offline: true,
            code: 'app/shared/annual-marketdata.js:prepareCape', records: { [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ capeMeta: {
                capeRatio: storedReference.value, capeAsOf: '2024-12-01', capeSource: 'repo_reference_only' } }) } }, year, policy);
        stored.offline = true;
        stored.notes.push('Nur flüchtiger Speicher mit öffentlichem Repo-Wert; Netz gesperrt, Altwert nicht übernommen, Handeingabe-Hinweis geprüft');
        rows.push(stored);
        plausibility(rows, year, monthlyCape);
        if (!proxies.length) rows.splice(1, 0, { source: 'ETF / optionaler Custom Proxy', kind: 'etf', year, grade: 'GELB', unconfigured: true, runs: [], notes: [
            'Nicht konfiguriert; keine feste Ersatzadresse im App-Code. Einzelprüfung mit --etf-proxy lokale-URL-Vorlage; Handkurs bleibt manuell'
        ], code: 'app/shared/annual-marketdata.js:355' });
        rows.forEach(printRow);
        console.log('Belege: Reihenfolge der Netzläufe HTTP-Origin, HTTPS-Origin. Antwortauszüge höchstens zwei Zeilen. ROT gilt auch bei lesbaren Werten mit fehlender CORS-/CSP-Freigabe.');
        rows.forEach(row => console.log(JSON.stringify(row)));
        console.log(`Ergebnis: ${rows.filter(row => row.grade === 'GRÜN').length} GRÜN, ${rows.filter(row => row.grade === 'GELB').length} GELB, ${rows.filter(row => row.grade === 'ROT').length} ROT. Exitcode 1 bei ROT, sonst 0.`);
        if (rows.some(row => row.grade === 'ROT')) process.exitCode = 1;
        return rows;
    } finally {
        server.closeAllConnections();
        if (server.listening) await new Promise(resolve => server.close(resolve));
        https.request = previousRequest;
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    main().catch(error => { console.error(`Liveprobe abgebrochen: ${error.message}`); process.exitCode = 2; });
}
