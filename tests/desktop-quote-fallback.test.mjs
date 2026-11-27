import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fetchProxyPrice, probeSearchQuote } from '../app/tranches/tranchen-price-service.js';

const require = createRequire(import.meta.url);
const https = require('node:https');
const { createServer } = require('../tools/yahoo-proxy.cjs');
const nowSeconds = Math.floor(Date.now() / 1000);

function chartQuote(symbol, regularMarketTime, regularMarketPrice = 100) {
    return { chart: { result: [{ meta: { symbol, currency: 'EUR', regularMarketTime, regularMarketPrice } }] } };
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

const proxy = createServer();

const allowedOrigins = ['tauri://localhost', 'https://tauri.localhost', 'http://tauri.localhost',
    'http://localhost', 'http://127.0.0.1:65535', 'http://localhost:00080'];
const otherOrigins = [undefined, 'null', 'https://example.invalid', 'https://localhost',
    'http://localhost:8000.example.invalid', 'http://127.0.0.10', 'http://localhost:8000/',
    'http://localhost:', 'http://localhost:+80', 'http://localhost:0', 'http://localhost:65536', 'http://localhost:000080'];
for (const method of ['GET', 'OPTIONS']) {
    for (const origin of [...allowedOrigins, ...otherOrigins]) {
        proxy.emit('request', { method, url: '/quote', headers: { host: 'localhost', origin } }, {
            writeHead(status, headers) {
                assertEqual(status, method === 'OPTIONS' ? 204 : 400, `${method}: bisheriger Antwortstatus`);
                assertEqual(headers['Access-Control-Allow-Origin'], allowedOrigins.includes(origin) ? origin : undefined,
                    `${method}: CORS-Freigabe für ${origin}`);
            },
            end() {}
        });
    }
}

const requestedUrls = [];
const upstreamUrls = [];
function fetchFromProxy(url) {
    const { pathname, search } = new URL(url);
    requestedUrls.push(pathname + search);
    return new Promise(resolve => {
        let status;
        proxy.emit('request', { method: 'GET', url: pathname + search, headers: { host: 'localhost' } }, {
            writeHead(code) { status = code; },
            end(body) { resolve(new Response(body, { status })); }
        });
    });
}

const originalRequest = https.request;
try {
    https.request = (url, _options, onResponse) => {
        upstreamUrls.push(url);
        const symbol = new URL(url).pathname.split('/').at(-1);
        const responses = {
            'MUSTER.DE': [200, JSON.stringify(chartQuote(symbol, nowSeconds - 60))],
            'MUSTER.SG': [200, JSON.stringify(chartQuote(symbol, nowSeconds - 120))],
            'MUSTER.DU': [503, '{}'],
            'MUSTER.MU': [404, 'Symbol fehlt'],
            'LIMIT.DE': [429, 'Abruflimit erreicht']
        };
        const [statusCode, body] = responses[symbol] || [503, '{}'];
        const request = new EventEmitter();
        request.setTimeout = () => {};
        request.end = () => {
            const response = new EventEmitter();
            response.statusCode = statusCode;
            response.resume = () => {};
            onResponse(response);
            response.emit('data', body);
            response.emit('end');
        };
        return request;
    };

    const options = { fetchImpl: fetchFromProxy, nowSeconds };
    const quote = await probeSearchQuote('MUSTER.DE', null, options);
    assertEqual(quote.price, 100, 'Xetra-Kurs kommt trotz 404 und 503 an Zusatzbörsen');
    assertEqual(requestedUrls.join(','), [
        '/quote?symbol=MUSTER.DE', '/quote?symbol=MUSTER.SG&einmal=1',
        '/quote?symbol=MUSTER.DU&einmal=1', '/quote?symbol=MUSTER.MU&einmal=1'
    ].join(','), 'Vier Vermittlerabfragen, einmal=1 nur für die drei Zusatzbörsen');
    assertEqual(upstreamUrls.map(url => url.split('?')[0]).join(','), ['DE', 'SG', 'DU', 'MU'].map(
        suffix => `https://query1.finance.yahoo.com/v8/finance/chart/MUSTER.${suffix}`
    ).join(','), 'Je Börse genau eine Yahoo-Abfrage, auch bei 404 und 503');

    requestedUrls.length = upstreamUrls.length = 0;
    for (const [symbol, code] of [['MUSTER.MU', 'SYMBOL_NOT_FOUND'], ['LIMIT.DE', 'PROVIDER_RATE_LIMITED']]) {
        const error = await fetchProxyPrice(symbol, undefined, options).catch(error => error);
        assertEqual(error.code, code, 'Der Proxy meldet den HTTP-Status auch ohne JSON-Fehlerantwort');
    }
    assertEqual(requestedUrls.length, 2, 'JS wiederholt einen gemeldeten 404 oder 429 nicht');
    assertEqual(upstreamUrls.length, 2, '404 und 429 beenden auch beim eingetragenen Kürzel den ersten Yahoo-Weg');
} finally {
    https.request = originalRequest;
}

const probeNowSeconds = Date.parse('2026-11-23T18:00:00Z') / 1000;
const probeQuote = (symbol, price, age) => ({
    symbol, price, currency: 'EUR', asOf: probeNowSeconds - age, source: 'yahoo-chart'
});

{
    const timers = new Set();
    const timeouts = [];
    const requests = [];
    const hangingSignals = [];
    const headers = deferred();
    const body = deferred();
    const bodyStarted = deferred();
    const response = (symbol, price, age) => new Response(JSON.stringify(probeQuote(symbol, price, age)));
    const quote = probeSearchQuote('MUSTER.DE', null, {
        nowSeconds: probeNowSeconds,
        retries: 3,
        schedule(fn, delay) {
            timeouts.push(delay);
            timers.add(fn);
            return fn;
        },
        unschedule: fn => timers.delete(fn),
        fetchImpl: async (url, { signal }) => {
            const symbol = new URL(url).searchParams.get('symbol');
            requests.push(symbol);
            if (symbol === 'MUSTER.SG') {
                hangingSignals.push(signal);
                return headers.promise;
            }
            if (symbol === 'MUSTER.DU') {
                hangingSignals.push(signal);
                return { ok: true, json() { bodyStarted.resolve(); return body.promise; } };
            }
            if (symbol === 'MUSTER.MU') return new Response('{}', { status: 404 });
            return response(symbol, 100, 60);
        }
    });
    await Promise.race([bodyStarted.promise, quote]);
    assertEqual(hangingSignals.length, 2, 'Eine Börse hängt vor den Headern, die andere beim Antwortinhalt');
    assertEqual(timeouts.join(','), '3000,3000,3000', 'Die vollständige Abendbörsenantwort hat drei Sekunden Zeit');
    for (const expire of timers) expire();
    const result = await quote;
    assertEqual(result.price, 100, 'Xetra kommt nach Ablauf der Frist trotz hängender Abendbörsen');
    assert(hangingSignals.every(signal => signal.aborted), 'Die Frist bricht die hängenden Abfragen ab');
    assertEqual(requests.join(','), 'MUSTER.DE,MUSTER.SG,MUSTER.DU,MUSTER.MU', 'Abendbörsen werden nach Timeout nicht erneut angefragt');
    headers.resolve(response('MUSTER.SG', 102, 10));
    body.resolve(await response('MUSTER.DU', 104, 5).json());
    assertEqual(result.price, 100, 'Späte Ergebnisse verändern den gelieferten Xetra-Kurs nicht');
}

{
    let elapsed = 0;
    const result = await probeSearchQuote('MUSTER.DE', null, {
        nowSeconds: probeNowSeconds, now: () => elapsed,
        schedule: () => 0, unschedule: () => {},
        fetchImpl: async url => {
            const symbol = new URL(url).searchParams.get('symbol');
            if (symbol !== 'MUSTER.DE' && symbol !== 'MUSTER.SG') return new Response('{}', { status: 404 });
            return { ok: true, async json() {
                if (symbol === 'MUSTER.SG') {
                    elapsed = 3001;
                    return probeQuote(symbol, 102, 10);
                }
                return probeQuote(symbol, 100, 60);
            } };
        }
    });
    assertEqual(result.price, 100, 'Eine verspätete Antwort bleibt auch vor dem Timeraufruf unbeachtet');
}
