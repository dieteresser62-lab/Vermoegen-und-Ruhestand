import fs from 'node:fs/promises';
import { connectAllows, corsAllows, fetchTrace, probeSource, compareYahooRequests, plausibility } from '../scripts/liveprobe-jahreswechsel.mjs';
import { createAnnualMarketDataRequest } from '../app/shared/annual-marketdata.js';

const origin = 'http://tauri.localhost';
const policy = "'self' https://api.worldbank.org https://data-api.ecb.europa.eu";
assertEqual(corsAllows('*', origin), true, 'Wildcard-CORS erlaubt den Tauri-Origin');
assertEqual(corsAllows('null', origin), false, 'ACAO null erlaubt keinen Tauri-Origin');
assertEqual(connectAllows('https://api.worldbank.org.evil.invalid', policy, origin), false, 'CSP verlangt den tatsächlichen Host');

const redirected = await fetchTrace('https://api.worldbank.org/data', {}, origin, policy, async (url, options) => {
    if (url.hostname === 'api.worldbank.org') return new Response(null, { status: 302,
        headers: { location: 'https://other.invalid/data', 'access-control-allow-origin': '*' } });
    assertEqual(options.headers.get('origin'), 'null', 'Cross-Origin-Redirect taintet Origin wie im Browser');
    return new Response('{}', { headers: { 'access-control-allow-origin': '*' } });
});
assertEqual(redirected.trace.hops.length, 2, 'Beide Redirect-Hosts werden erfasst');
assertEqual(redirected.trace.hops[1].connectSrc, false, 'Fehlender Redirect-Host in CSP wird erkannt');

const preflight = await fetchTrace('https://r.jina.ai/https://example.com/ie_data.xls',
    { headers: { 'X-Return-Format': 'html' } }, origin, 'https://r.jina.ai', async (url, options) => {
        if (options.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
            'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET',
            'access-control-allow-headers': 'x-return-format'
        } });
        return new Response('<table></table>', { headers: { 'access-control-allow-origin': origin } });
    });
assertEqual(preflight.trace.preflights[0].ok, true, 'CAPE-HTML-Abruf prüft die CORS-Vorabfreigabe');

const source = { label: 'Weltbank', kind: 'inflation', method: 'prepareInflation',
    matches: url => new URL(url).hostname === 'api.worldbank.org' };
let calls = 0;
const payload = [{ lastupdated: '2026-01-01' }, [{ indicator: { id: 'FP.CPI.TOTL.ZG' },
    countryiso3code: 'DEU', date: '2024', value: 2.2 }]];
const missingCors = await probeSource(source, 2024, policy, { fetchImpl: async url => {
    calls++;
    assertEqual(url.hostname, 'api.worldbank.org', 'Nur ausgewählte Quelle gelangt ins Netz');
    return new Response(JSON.stringify(payload));
} });
assertEqual(calls, 2, 'Ein echter Transportaufruf je Tauri-Origin');
assertEqual(missingCors.runs[0].value.rate, 2.2, 'Echter App-Parser liest isolierten Weltbank-Ersatzweg');
assertEqual(missingCors.grade, 'ROT', 'Lesbarer Node-Wert ohne CORS bleibt ROT');
const valid = await probeSource(source, 2024, policy, { fetchImpl: async () => new Response(JSON.stringify(payload),
    { headers: { 'access-control-allow-origin': '*' } }) });
assertEqual(valid.grade, 'GRÜN', 'Gültiger App-Wert mit CSP und CORS ist GRÜN');
const unavailable = await probeSource(source, 2024, policy, { fetchImpl: async () => new Response('Internal server error', { status: 500 }) });
assertEqual(unavailable.runs[0].error, 'World Bank antwortete mit HTTP 500.', 'Absichtlich gesperrte Quellen werden nicht als echte Netzfehler ausgegeben');

const wrongCape = { kind: 'cape', notes: [], grade: 'GRÜN', runs: [{ value: {
    capeRatio: 39.48, capeAsOf: '2023-09-01', capeFetchStatus: 'warn_stale_source' } }] };
plausibility([wrongCape], 2024, { '2023-09': 29.799681861350244 });
assertEqual(wrongCape.grade, 'ROT', 'Falscher CAPE gleicher Monat bleibt trotz plausiblem Zahlenbereich ROT');
assertEqual(wrongCape.notes.some(note => note.includes('verschiedene Stichtage')), true, 'Dezembervergleich nennt abweichende Stichtage');

const failed = await fetchTrace('https://api.worldbank.org/data', {}, origin, policy, async () => {
    throw Object.assign(new Error('Netz gesperrt'), { cause: { code: 'EPERM' } });
});
assertEqual(failed.trace.hops.length, 0, 'Netzfehler erfindet keinen HTTP-Status');
assertEqual(failed.trace.error.includes('EPERM'), true, 'Netzfehler bleibt im Beleg');

const [rust, node] = await Promise.all([
    fs.readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../tools/yahoo-proxy.cjs', import.meta.url), 'utf8')
]);
const parity = compareYahooRequests(rust, node, createAnnualMarketDataRequest('calendar-year:2024'));
assertEqual(parity.sameUrl, true, 'Reale Rust-/Node-Chart-URLs stimmen überein');
assertEqual(parity.differences.some(item => item.startsWith('Connection:')), true, 'Zusätzlicher Connection-Header bleibt sichtbar');
