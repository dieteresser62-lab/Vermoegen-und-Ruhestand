import { marketPriceAdapter, isSyntheticPriceMode } from '../shared/market-price-adapter.js';
import { appNow } from '../shared/app-clock.js';
// @ts-check

export const LOCAL_YAHOO_PROXY = 'http://127.0.0.1:8787';
export const QUOTE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const QUOTE_FUTURE_TOLERANCE_SECONDS = 5 * 60;

const LOCAL_PROXY_RETRIES = 2;
const LOCAL_PROXY_TIMEOUT_MS = 3500;
const YAHOO_SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,32}$/;

export class QuoteError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'QuoteError';
        this.code = code;
        this.details = details;
    }
}

function createQuoteError(code, message, details = {}) {
    return new QuoteError(code, message, details);
}

export function normalizeYahooSymbol(symbol) {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (!YAHOO_SYMBOL_PATTERN.test(normalized) || normalized.includes('@')) {
        throw createQuoteError(
            'INVALID_SYMBOL',
            `Ungueltiges Yahoo-Symbol: ${normalized || '(leer)'}`,
            { symbol: normalized }
        );
    }
    return normalized;
}

function normalizeFetchError(error, timedOut) {
    if (error instanceof QuoteError) return error;
    const message = String(error?.message || error || 'Unbekannter Netzwerkfehler');
    if (timedOut) {
        return createQuoteError('REQUEST_TIMEOUT', `Proxy-Timeout: ${message}`);
    }
    if (error?.name === 'AbortError' || message.toLowerCase().includes('aborted')) {
        return createQuoteError('REQUEST_ABORTED', 'Kursabruf wurde abgebrochen.');
    }
    return createQuoteError('PROXY_UNREACHABLE', `Lokaler Kursproxy nicht erreichbar: ${message}`);
}

function checkRequestBudget(options = {}) {
    const now = options.now || Date.now;
    const remaining = Number.isFinite(options.deadline) ? options.deadline - now() : Infinity;
    if (remaining <= 0) throw createQuoteError('STARTUP_TIMEOUT', 'Gesamtzeitlimit für Kursabruf erreicht.');
    if (options.signal?.aborted) throw createQuoteError('REQUEST_ABORTED', 'Kursabruf wurde abgebrochen.');
    return remaining;
}

async function fetchHeadersWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const externalSignal = options?.signal;
    let timedOut = false;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);

    if (externalSignal?.aborted) {
        throw createQuoteError('REQUEST_ABORTED', 'Kursabruf wurde abgebrochen.');
    }
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    try {
        return await (options.fetchImpl || globalThis.fetch)(url, { ...options, signal: controller.signal });
    } catch (error) {
        throw normalizeFetchError(error, timedOut);
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', abortFromExternal);
    }
}

// Der Timeout umfasst Headers UND Body; die Race beendet auch Abort ignorierende Provider.
async function fetchWithTimeout(url, options, timeoutMs) {
    if (!Number.isFinite(options.deadline)) {
        // Manuelle Abrufe behalten ihren bisherigen Abbruchende-/Headervertrag.
        const res = await fetchHeadersWithTimeout(url, { cache: 'no-store', signal: options.signal, fetchImpl: options.fetchImpl }, timeoutMs);
        try { return { res, data: await res.json() }; }
        catch { throw createQuoteError('INVALID_RESPONSE', 'Proxy-Antwort ist kein gueltiges JSON.'); }
    }
    const remaining = checkRequestBudget(options);
    const controller = new AbortController();
    const externalSignal = options.signal;
    const schedule = options.schedule || setTimeout;
    const unschedule = options.unschedule || clearTimeout;
    let timedOut = false, rejectBoundary;
    const boundary = new Promise((_, reject) => { rejectBoundary = reject; });
    const abortFromExternal = () => {
        controller.abort(externalSignal?.reason);
        rejectBoundary(createQuoteError('REQUEST_ABORTED', 'Kursabruf wurde abgebrochen.'));
    };
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    const timer = schedule(() => {
        timedOut = true;
        controller.abort();
        rejectBoundary(createQuoteError(remaining <= timeoutMs ? 'STARTUP_TIMEOUT' : 'REQUEST_TIMEOUT', 'Kursabruf antwortet nicht rechtzeitig.'));
    }, Math.min(timeoutMs, remaining));
    const request = async () => {
        if (timedOut) throw createQuoteError('REQUEST_TIMEOUT', 'Proxy-Timeout.');
        checkRequestBudget(options);
        const res = await (options.fetchImpl || globalThis.fetch)(url, { cache: 'no-store', signal: controller.signal });
        checkRequestBudget(options);
        if (controller.signal.aborted) throw createQuoteError('REQUEST_TIMEOUT', 'Proxy-Timeout.');
        let data;
        try { data = await res.json(); }
        catch { throw createQuoteError('INVALID_RESPONSE', 'Proxy-Antwort ist kein gueltiges JSON.'); }
        checkRequestBudget(options);
        if (controller.signal.aborted) throw createQuoteError('REQUEST_TIMEOUT', 'Proxy-Timeout.');
        return { res, data };
    };
    try {
        return await Promise.race([boundary, request()]);
    } catch (error) {
        throw normalizeFetchError(error, timedOut);
    } finally {
        unschedule(timer);
        externalSignal?.removeEventListener('abort', abortFromExternal);
    }
}

function sleep(ms, signal, options = {}) {
    const schedule = options.schedule || setTimeout;
    const unschedule = options.unschedule || clearTimeout;
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(createQuoteError('REQUEST_ABORTED', 'Kursabruf wurde abgebrochen.'));
            return;
        }
        const onAbort = () => {
            unschedule(timer);
            reject(createQuoteError('REQUEST_ABORTED', 'Kursabruf wurde abgebrochen.'));
        };
        const timer = schedule(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve(undefined);
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function proxyErrorFromResponse(data, status) {
    const reportedCode = typeof data?.code === 'string' ? data.code : '';
    const fallbackCode = status === 404
        ? 'SYMBOL_NOT_FOUND'
        : status === 429
            ? 'PROVIDER_RATE_LIMITED'
            : status === 504
                ? 'PROVIDER_TIMEOUT'
                : status >= 500
                    ? 'PROVIDER_UNAVAILABLE'
                    : 'PROXY_HTTP_ERROR';
    const code = reportedCode || fallbackCode;
    const message = typeof data?.message === 'string' && data.message.trim()
        ? data.message.trim()
        : `Proxy HTTP ${status}`;
    return createQuoteError(code, message, { status });
}

function isRetriableProxyError(error) {
    return [
        'REQUEST_TIMEOUT',
        'PROXY_UNREACHABLE',
        'PROVIDER_TIMEOUT',
        'PROVIDER_UNAVAILABLE'
    ].includes(error?.code);
}

async function fetchProxyJson(proxyUrl, options = {}) {
    const retries = Number.isInteger(options.retries) ? Math.max(1, options.retries) : LOCAL_PROXY_RETRIES;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : LOCAL_PROXY_TIMEOUT_MS;
    const now = options.now || Date.now;
    for (let attempt = 0; attempt < retries; attempt += 1) {
        checkRequestBudget(options);
        const startedAt = now();
        options.onRequestStart?.(startedAt);
        let lastError;
        try {
            const { res, data } = await fetchWithTimeout(proxyUrl, options, timeoutMs);
            if (!res.ok || data?.status === 'error') throw proxyErrorFromResponse(data, res.status);
            return data;
        } catch (error) {
            lastError = error instanceof QuoteError ? error : normalizeFetchError(error, false);
            if (!isRetriableProxyError(lastError) || attempt === retries - 1 || options.signal?.aborted) throw lastError;
        } finally {
            options.onRequestDuration?.(Math.max(0, now() - startedAt));
        }
        const backoff = 200 * (attempt + 1);
        // Ein Retry darf nicht schon durch seinen Rückoff sicher außerhalb der Frist liegen.
        if (checkRequestBudget(options) <= backoff) throw createQuoteError('STARTUP_TIMEOUT', 'Restzeit reicht nicht für Wiederholung.');
        await sleep(backoff, options.signal, options);
        checkRequestBudget(options);
    }
}

export function normalizeQuote(rawQuote, requestedSymbol, options = {}) {
    const requested = normalizeYahooSymbol(requestedSymbol);
    if (!rawQuote || typeof rawQuote !== 'object' || Array.isArray(rawQuote)) {
        throw createQuoteError('INVALID_RESPONSE', 'Proxy-Antwort enthaelt kein Quote-Objekt.');
    }

    let responseSymbol;
    try {
        responseSymbol = normalizeYahooSymbol(rawQuote.symbol);
    } catch {
        throw createQuoteError('INVALID_RESPONSE', 'Proxy-Antwort enthaelt kein gueltiges Symbol.');
    }
    if (responseSymbol !== requested) {
        throw createQuoteError(
            'SYMBOL_MISMATCH',
            `Antwortsymbol ${responseSymbol} entspricht nicht der Anfrage ${requested}.`,
            { requested, received: responseSymbol }
        );
    }

    const price = rawQuote.price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
        throw createQuoteError('INVALID_PRICE', 'Proxy-Antwort enthaelt keinen positiven endlichen Kurs.');
    }

    const currency = typeof rawQuote.currency === 'string'
        ? rawQuote.currency.trim().toUpperCase()
        : '';
    if (!currency) {
        throw createQuoteError('CURRENCY_MISSING', 'Proxy-Antwort enthaelt keine eindeutige Waehrung.');
    }
    if (currency !== 'EUR') {
        throw createQuoteError(
            'UNSUPPORTED_CURRENCY',
            `Waehrung ${currency} wird nicht unterstuetzt.`,
            { currency }
        );
    }

    const asOf = rawQuote.asOf;
    if (asOf === undefined || asOf === null || asOf === '') {
        throw createQuoteError('AS_OF_MISSING', 'Proxy-Antwort enthaelt keinen Kursstichtag.');
    }
    if (!Number.isInteger(asOf) || asOf <= 0) {
        throw createQuoteError('INVALID_AS_OF', 'Kursstichtag muss eine positive UTC-Unixsekunde sein.');
    }

    const nowSeconds = Number.isFinite(options.nowSeconds)
        ? Math.floor(options.nowSeconds)
        : Math.floor(appNow().getTime() / 1000);
    if (asOf > nowSeconds + QUOTE_FUTURE_TOLERANCE_SECONDS) {
        throw createQuoteError('QUOTE_FROM_FUTURE', 'Kursstichtag liegt unzulaessig weit in der Zukunft.');
    }
    if (nowSeconds - asOf > QUOTE_MAX_AGE_SECONDS) {
        throw createQuoteError('QUOTE_STALE', 'Kurs ist aelter als sieben Kalendertage.');
    }

    const source = typeof rawQuote.source === 'string' ? rawQuote.source.trim() : '';
    if (!source) {
        throw createQuoteError('INVALID_RESPONSE', 'Proxy-Antwort enthaelt keine Kursquelle.');
    }

    return Object.freeze({
        symbol: responseSymbol,
        price,
        currency,
        asOf,
        source
    });
}

export async function fetchProxyPrice(symbol, proxyBase = LOCAL_YAHOO_PROXY, options = {}) {
    const synthetic = isSyntheticPriceMode();
    const requestedSymbol = normalizeYahooSymbol(symbol);
    const base = proxyBase.replace(/\/$/, '');
    const url = `${base}/quote?symbol=${encodeURIComponent(requestedSymbol)}`;
    checkRequestBudget(options);
    const data = await marketPriceAdapter('quote', { symbol: requestedSymbol }, () => fetchProxyJson(url, options));
    checkRequestBudget(options);
    // ISIN-Aliase werden lokal zu einem kanonischen Kurssymbol aufgelöst.
    return normalizeQuote(data, synthetic ? data.symbol : requestedSymbol, options);
}

function normalizeSearchResultSymbol(result) {
    try {
        return normalizeYahooSymbol(result?.symbol);
    } catch {
        return null;
    }
}

export async function fetchProxySymbol(query, proxyBase = LOCAL_YAHOO_PROXY, nameHint, options = {}) {
    const synthetic = isSyntheticPriceMode();
    const url = `${proxyBase.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}`;
    checkRequestBudget(options);
    const adapted = await marketPriceAdapter('search', { query }, () => fetchProxyJson(url, options));
    checkRequestBudget(options);
    if (synthetic) return adapted;
    const data = adapted;
    const results = Array.isArray(data?.quotes) ? data.quotes : [];
    if (!results.length) return null;
    const q = String(query || '').trim().toUpperCase();
    const exact = results.find(result => normalizeSearchResultSymbol(result) === q);
    if (exact) return normalizeSearchResultSymbol(exact);

    if (nameHint) {
        const name = String(nameHint).trim().toUpperCase();
        const byName = results.find(result => {
            const candidateName = String(result?.shortname || result?.longname || '').toUpperCase();
            return candidateName.includes(name) && normalizeSearchResultSymbol(result);
        });
        if (byName) return normalizeSearchResultSymbol(byName);
    }
    return results.map(normalizeSearchResultSymbol).find(Boolean) || null;
}

function formatQuoteError(error) {
    const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN_ERROR';
    const message = error?.message || String(error);
    return `${code}: ${message}`;
}

/** Strukturierter Befund; die bestehende Textbedienung delegiert hierher. */
export async function probeProxyHealth({ proxyBase = LOCAL_YAHOO_PROXY, ...options } = {}) {
    const attemptedAt = appNow().getTime(), startedAt = performance.now();
    try {
        const data = await marketPriceAdapter('health', {}, () => fetchProxyJson(`${proxyBase.replace(/\/$/, '')}/search?q=VWCE`, options));
        if (!isSyntheticPriceMode() && !Array.isArray(data?.quotes)) throw createQuoteError('INVALID_RESPONSE', 'Dienstantwort enthält keine Trefferliste.');
        return { status: 'available', attemptedAt, synthetic: isSyntheticPriceMode(), durationMs: Math.round(performance.now() - startedAt), count: data?.quotes?.length || 0 };
    } catch (error) {
        return { status: error.code === 'REQUEST_ABORTED' ? 'cancelled' : 'offline', attemptedAt,
            durationMs: Math.round(performance.now() - startedAt), code: error.code, error: formatQuoteError(error) };
    }
}
export async function checkProxyHealth(statusEl, proxyBase = LOCAL_YAHOO_PROXY) {
    statusEl.textContent = `Proxy-Check laeuft... (${proxyBase.replace(/\/$/, '')})`;
    const report = await probeProxyHealth({ proxyBase });
    const stamp = new Date(report.attemptedAt).toLocaleString('de-DE');
    statusEl.textContent = report.synthetic ? 'Spielbereich: synthetische Kursquelle bereit; kein Netzwerkabruf.'
        : report.status === 'available' ? `Proxy OK (${stamp}) - Antwort in ${report.durationMs} ms, Treffer: ${report.count}.`
            : `Proxy FEHLER (${stamp}) nach ${report.durationMs} ms - ${report.error}`;
    return report;
}

export function quoteErrorDetails(error, fallbackSymbol) {
    return {
        code: typeof error?.code === 'string' ? error.code : 'QUOTE_FAILED',
        message: error?.message || 'Kursabruf fehlgeschlagen.',
        symbol: fallbackSymbol || 'unbekannt'
    };
}

function selectMostSpecificQuoteError(errors, fallbackSymbol) {
    const priority = [
        'UNSUPPORTED_CURRENCY',
        'CURRENCY_MISSING',
        'QUOTE_STALE',
        'QUOTE_FROM_FUTURE',
        'AS_OF_MISSING',
        'SYMBOL_MISMATCH',
        'INVALID_PRICE',
        'INVALID_RESPONSE',
        'PROVIDER_RATE_LIMITED',
        'PROVIDER_TIMEOUT',
        'PROVIDER_UNAVAILABLE',
        'PROXY_UNREACHABLE',
        'REQUEST_TIMEOUT',
        'REQUEST_ABORTED',
        'SYMBOL_NOT_FOUND',
        'INVALID_SYMBOL'
    ];
    const selected = priority
        .map(code => errors.find(item => item?.code === code))
        .find(Boolean) || errors[0];
    return quoteErrorDetails(selected, fallbackSymbol);
}

export function createBatchQuoteFetcher(signal, { deduplicateSearchNames = false, ...options } = {}) {
    const quoteRequests = new Map(), searchRequests = new Map();
    const now = options.now || Date.now;
    const check = () => {
        checkRequestBudget(options);
        if (!signal.aborted) return;
        const error = new Error('Kursbatch wurde abgebrochen.');
        error.name = 'AbortError'; error.code = 'REQUEST_ABORTED';
        throw error;
    };
    const request = (map, key, load) => {
        check();
        if (!map.has(key)) {
            const entry = { startedAt: undefined, durationMs: undefined, pending: false };
            map.set(key, entry);
            entry.promise = load({ ...options, signal,
                onRequestStart: stamp => { entry.startedAt = stamp; entry.pending = true; },
                onRequestDuration: duration => { entry.durationMs = duration; entry.pending = false; }
            });
        }
        return map.get(key);
    };
    const quoteEntry = symbol => request(quoteRequests, String(symbol || '').trim().toUpperCase(),
        requestOptions => fetchProxyPrice(symbol, LOCAL_YAHOO_PROXY, requestOptions));
    const searchEntry = (query, nameHint) => request(searchRequests,
        `${String(query || '').trim().toUpperCase()}|${deduplicateSearchNames ? '' : String(nameHint || '').trim().toUpperCase()}`,
        requestOptions => fetchProxySymbol(query, LOCAL_YAHOO_PROXY, nameHint, requestOptions));
    return {
        check,
        quote: symbol => quoteEntry(symbol).promise,
        search: (query, nameHint) => searchEntry(query, nameHint).promise,
        // Diagnose je Gruppe, aber auf der geteilten tatsächlichen Anfrage, ohne Quote-/Speicherfelder.
        forGroup() {
            let last;
            return { check,
                quote(symbol) { last = quoteEntry(symbol); return last.promise; },
                search(query, nameHint) { last = searchEntry(query, nameHint); return last.promise; },
                duration() { return last?.pending && Number.isFinite(last.startedAt)
                    ? Math.max(0, now() - last.startedAt) : last?.durationMs; }
            };
        }
    };
}

export async function resolveTrancheQuote(tranche, fetcher) {
    const ticker = String(tranche.ticker || '').trim();
    const isin = String(tranche.isin || '').trim();
    const symbols = [...new Set([ticker, isin].filter(Boolean))];
    if (!symbols.length) return { status: 'skipped' };

    const errors = [];
    for (const symbol of symbols) {
        fetcher.check();
        try {
            const quote = await fetcher.quote(symbol);
            fetcher.check();
            return { status: 'updated', quote };
        } catch (error) {
            if (error?.code === 'STARTUP_TIMEOUT') throw error;
            errors.push(error);
        }

        fetcher.check();
        try {
            const resolved = await fetcher.search(symbol, tranche.name);
            fetcher.check();
            if (resolved) {
                const quote = await fetcher.quote(resolved);
                fetcher.check();
                return { status: 'updated', quote };
            }
        } catch (error) {
            if (error?.code === 'STARTUP_TIMEOUT') throw error;
            errors.push(error);
        }
    }

    return {
        status: 'failed',
        ...selectMostSpecificQuoteError(errors, ticker || isin)
    };
}
