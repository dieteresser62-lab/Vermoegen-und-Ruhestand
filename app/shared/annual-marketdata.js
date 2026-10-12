import { marketPriceAdapter, isSyntheticPriceMode } from './market-price-adapter.js';
import { appNow } from './app-clock.js';
import { SYNTHETIC_MARKET_SOURCE } from './probelauf-prices.js';
import { AppError, CONFIG } from '../balance/balance-config.js';
import { loadStoredBalanceStateFromData } from '../profile/profile-state.js';
import { deriveCompletedCalendarYear } from '../balance/balance-annual-period.js';
import { persistenceStorage } from './persistence-facade.js';
import { createInflationReaders, validateInflationResult, INFLATION_RESULT_METRIC } from '../balance/balance-annual-inflation.js';
const CAPE_PLAUSIBILITY_MIN = 5;
const CAPE_PLAUSIBILITY_MAX = 80;
const CAPE_STALE_MONTHS = 18;
const CAPE_FETCH_TIMEOUT_MS = 20000;
const LOCAL_PROXY_FETCH_TIMEOUT_MS = 8000;
const LOCAL_PROXY_FETCH_RETRIES = 3;
export const ANNUAL_PERIOD_METADATA_KEY = 'annualPeriodMetadata';
const ANNUAL_PERIOD_PREFIX = 'calendar-year:';
const ANNUAL_CLOSE_WINDOW_START_DAY = 27;
const ANNUAL_CLOSE_WINDOW_END_DAY = 31;
// Broad VWCE.DE guard: keeps the existing whole-euro UI value positive and rejects proxy scaling failures.
const ANNUAL_CLOSE_PRICE_MIN = 0.5;
const ANNUAL_CLOSE_PRICE_MAX = 100000;

export const ANNUAL_MARKET_DATA_META_KEY = 'annualMarketDataMeta';
export const ANNUAL_MARKET_DATA_SCHEMA_VERSION = 1;

export const CAPE_SOURCES = {
    PRIMARY: {
        id: 'yale_ie_data_xls',
        label: 'Yale ie_data.xls (via r.jina.ai)',
        url: 'https://r.jina.ai/http://www.econ.yale.edu/~shiller/data/ie_data.xls'
    },
    MIRROR: {
        id: 'shillerdata_mirror',
        label: 'shillerdata mirror (via r.jina.ai)',
        url: 'https://r.jina.ai/http://www.shillerdata.com/market-data/'
    },
    STORED: {
        id: 'stored_last_value',
        label: 'Lokaler letzter CAPE-Stand'
    }
};

function isoDateFromUtcParts(year, month, day) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isPlausibleAnnualClosePrice(value) {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= ANNUAL_CLOSE_PRICE_MIN &&
        value <= ANNUAL_CLOSE_PRICE_MAX
    );
}

export function createAnnualMarketDataRequest(periodId) {
    if (typeof periodId !== 'string' || !periodId.startsWith(ANNUAL_PERIOD_PREFIX)) return null;
    const yearText = periodId.slice(ANNUAL_PERIOD_PREFIX.length);
    if (!/^\d{4}$/.test(yearText)) return null;
    const targetYear = Number(yearText);
    if (!Number.isInteger(targetYear) || targetYear < 1900 || targetYear > 9999) return null;
    if (periodId !== `${ANNUAL_PERIOD_PREFIX}${targetYear}`) return null;

    const period1 = Math.floor(Date.UTC(targetYear, 11, ANNUAL_CLOSE_WINDOW_START_DAY) / 1000);
    const period2 = Math.floor(Date.UTC(targetYear + 1, 0, 1) / 1000);
    if (!Number.isFinite(period1) || !Number.isFinite(period2)) return null;

    return {
        periodId,
        targetYear,
        windowStart: isoDateFromUtcParts(targetYear, 12, ANNUAL_CLOSE_WINDOW_START_DAY),
        windowEnd: isoDateFromUtcParts(targetYear, 12, ANNUAL_CLOSE_WINDOW_END_DAY),
        period1,
        period2
    };
}

export function createManualAnnualQuote(value, periodId) {
    const request = createAnnualMarketDataRequest(periodId);
    const price = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!request || !isPlausibleAnnualClosePrice(price) || !isPlausibleAnnualClosePrice(Math.round(price))) {
        throw new AppError('Bitte einen plausiblen positiven ETF-Schlusskurs eingeben.');
    }
    return { price, date: new Date(`${request.windowEnd}T00:00:00Z`), asOf: request.windowEnd,
        ticker: 'VWCE.DE', source: 'Manueller Schlusskurs', targetYear: request.targetYear };
}

/** Dieselben Ergebnisformen und Plausibilitätsgrenzen für Abruf und Handergänzung. */
export function validateAnnualPreparationValue(type, value, targetYear) {
    if (type === 'inflation') return validateInflationResult(value, targetYear);
    if (type === 'etf') return validatePreparedAnnualQuote(value, createAnnualMarketDataRequest(`calendar-year:${targetYear}`));
    if (!value || !isCapePlausible(value.capeRatio) || !value.capeSource
        || value.capeFetchStatus === 'error_no_source_no_stored') throw new AppError('Bitte einen plausiblen US Shiller CAPE zwischen 5 und 80 ergänzen.');
    return Object.freeze({ ...value });
}

export function createManualAnnualValue(type, raw, targetYear) {
    const text = String(raw ?? '').trim();
    if (!text || !/^-?\d+(?:[.,]\d+)?$/.test(text)) throw new AppError('Bitte eine gültige Zahl eingeben.');
    const value = Number(text.replace(',', '.'));
    if (type === 'etf') return createManualAnnualQuote(value, `calendar-year:${targetYear}`);
    const source = 'Manuelle Ergänzung';
    return validateAnnualPreparationValue(type, type === 'inflation'
        ? { rate: value, year: targetYear, metric: INFLATION_RESULT_METRIC, source,
            dataAsOf: `${targetYear}-12-31`, fetchStatus: 'ok_manual' }
        : { capeRatio: value, capeAsOf: `${targetYear}-12-31`, capeSource: source,
            // Bestehender Status für lokale Ersatzwerte; die Herkunft bleibt ausdrücklich manuell.
            sourceLabel: source, capeFetchStatus: 'ok_fallback_stored', capeUpdatedAt: appNow().toISOString() }, targetYear);
}

export function validatePreparedAnnualQuote(quote, request) {
    if (!quote || quote.targetYear !== request.targetYear || quote.ticker !== 'VWCE.DE'
        || !isPlausibleAnnualClosePrice(quote.price) || !isPlausibleAnnualClosePrice(Math.round(quote.price))
        || typeof quote.asOf !== 'string' || quote.asOf < request.windowStart || quote.asOf > request.windowEnd
        || !/^\d{4}-12-\d{2}$/.test(quote.asOf) || !quote.source
        || !(quote.date instanceof Date) || !Number.isFinite(quote.date.getTime())
        || quote.date.toISOString().slice(0, 10) !== quote.asOf) {
        throw new AppError('Der vorbereitete ETF-Schlusskurs ist ungültig.');
    }
    return Object.freeze({ ...quote });
}

export function selectAnnualCloseQuote(data, {
    targetYear,
    ticker = 'VWCE.DE',
    source = 'Yahoo Finance'
} = {}) {
    if (!Number.isInteger(targetYear) || targetYear < 1900 || targetYear > 9999) return null;
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(timestamps) || !Array.isArray(closes)) return null;

    let selected = null;
    const length = Math.min(timestamps.length, closes.length);
    for (let index = 0; index < length; index += 1) {
        const timestamp = timestamps[index];
        const price = closes[index];
        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) continue;
        if (!isPlausibleAnnualClosePrice(price)) continue;

        const date = new Date(timestamp * 1000);
        if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== targetYear) continue;
        const month = date.getUTCMonth() + 1;
        const day = date.getUTCDate();
        if (
            month !== 12 ||
            day < ANNUAL_CLOSE_WINDOW_START_DAY ||
            day > ANNUAL_CLOSE_WINDOW_END_DAY
        ) continue;

        if (!selected || timestamp > selected.timestamp) {
            selected = {
                price,
                date,
                asOf: isoDateFromUtcParts(targetYear, month, day),
                timestamp,
                ticker,
                source,
                targetYear
            };
        }
    }
    return selected;
}

export function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function parseDateTokenToIso(token) {
    if (!token) return null;
    const text = String(token).trim();
    const m = text.match(/^((?:18|19|20)\d{2})[.\-\/](\d{1,2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
    return `${String(year)}-${String(month).padStart(2, '0')}-01`;
}

function monthsOld(isoDate, now = appNow()) {
    if (!isoDate) return Infinity;
    const date = new Date(isoDate);
    if (!Number.isFinite(date.getTime())) return Infinity;
    return ((now.getUTCFullYear() - date.getUTCFullYear()) * 12)
        + (now.getUTCMonth() - date.getUTCMonth());
}

export function isCapePlausible(value) {
    return Number.isFinite(value) && value > CAPE_PLAUSIBILITY_MIN && value < CAPE_PLAUSIBILITY_MAX;
}

function parseCapeFromShillerText(text) {
    if (!text || typeof text !== 'string') return null;
    const lines = text.split(/\r?\n/);
    let best = null;
    for (const line of lines) {
        if (!line || line.length < 8) continue;
        const dateMatch = line.match(/\b(?:18|19|20)\d{2}[.\-\/](?:0?[1-9]|1[0-2])\b/);
        if (!dateMatch) continue;
        const isoDate = parseDateTokenToIso(dateMatch[0]);
        if (!isoDate) continue;
        const numericTokens = (line.match(/-?\d+(?:[.,]\d+)?/g) || [])
            .map(token => Number(token.replace(',', '.')))
            .filter(Number.isFinite);
        if (numericTokens.length === 0) continue;
        const candidateCape = numericTokens[numericTokens.length - 1];
        if (!isCapePlausible(candidateCape)) continue;
        if (!best || isoDate > best.capeAsOf) {
            best = {
                capeRatio: Number(candidateCape.toFixed(2)),
                capeAsOf: isoDate
            };
        }
    }
    return best;
}

async function fetchTextWithTimeout(url, timeoutMs = CAPE_FETCH_TIMEOUT_MS, operation) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    operation?.check();
    operation?.controller.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.text();
    } catch (err) {
        const message = String(err?.message || '');
        if (err?.name === 'AbortError' || message.includes('signal is aborted')) {
            throw new Error(`Timeout nach ${timeoutMs} ms`);
        }
        throw err;
    } finally {
        operation?.controller.signal?.removeEventListener('abort', abort);
        clearTimeout(timer);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetriableProxyError(err) {
    const message = String(err?.message || '').toLowerCase();
    return (
        err?.name === 'AbortError' ||
        message.includes('failed to fetch') ||
        message.includes('networkerror') ||
        message.includes('load failed') ||
        message.includes('fetch failed') ||
        message.includes('signal is aborted') ||
        message.includes('http 502') ||
        message.includes('http 503') ||
        message.includes('http 504')
    );
}

async function fetchJsonWithTimeout(url, timeoutMs, operation) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    operation?.check();
    operation?.controller.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            cache: 'no-store',
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (err) {
        const message = String(err?.message || '');
        if (err?.name === 'AbortError' || message.includes('signal is aborted')) {
            throw new Error(`Timeout nach ${timeoutMs} ms`);
        }
        throw err;
    } finally {
        operation?.controller.signal?.removeEventListener('abort', abort);
        clearTimeout(timer);
    }
}

async function fetchLocalProxyJsonWithRetry(url, {
    retries = LOCAL_PROXY_FETCH_RETRIES,
    timeoutMs = LOCAL_PROXY_FETCH_TIMEOUT_MS,
    operation
} = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < retries; attempt++) {
        operation?.check();
        try {
            const data = await fetchJsonWithTimeout(url, timeoutMs, operation);
            operation?.check();
            return data;
        } catch (err) {
            operation?.check();
            lastError = err;
            if (!isRetriableProxyError(err) || attempt === retries - 1) {
                throw err;
            }
            await sleep(250 * (attempt + 1));
        }
    }
    throw lastError || new Error('Proxy request failed');
}

/** Bestehende Quellen und Fallbacks, ausschließlich lesend. */
export function createAnnualMarketDataReaders({ storage = persistenceStorage, now = appNow, ...inflationOptions } = {}) {
    const fetchVanguardETFPrice = async (request, operation) => {
        operation?.check();
        if (isSyntheticPriceMode()) {
            const quote = await marketPriceAdapter('annual', { symbol: 'VWCE.DE', year: request.targetYear }, () => { throw new Error('Unerwarteter Kursnetzpfad.'); });
            operation?.check();
            return quote;
        }
        const ticker = 'VWCE.DE'; // Vanguard FTSE All-World in EUR (Xetra)
        const isin = 'IE00BK5BQT80'; // ISIN für alternative APIs
        const LOCAL_YAHOO_PROXY = 'http://127.0.0.1:8787';
        const { period1, period2, targetYear, windowStart, windowEnd } = request;

        // Strategie 1: Yahoo Finance ueber lokalen Proxy
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1d`;
        const parseYahooResponse = (data, sourceLabel) => {
            return selectAnnualCloseQuote(data, {
                targetYear,
                ticker,
                source: sourceLabel
            });
        };
        try {
            const proxyUrl = `${LOCAL_YAHOO_PROXY}/chart?symbol=${encodeURIComponent(ticker)}&period1=${period1}&period2=${period2}&interval=1d`;
            const data = await fetchLocalProxyJsonWithRetry(proxyUrl, { operation });
            const parsed = parseYahooResponse(data, 'Yahoo Finance (lokaler Proxy)');
            if (parsed) return parsed;
        } catch (err) {
            operation.check();
            // Yahoo Finance via local proxy failed, try fallback
        }

        const buildProxyUrl = (template, targetUrl) => {
            if (template.includes('{url}')) {
                return template.replace('{url}', encodeURIComponent(targetUrl));
            }
            return `${template}${encodeURIComponent(targetUrl)}`;
        };
        const proxyEntries = [];
        const rawCustomProxy = storage.getItem('etfProxyUrls') || storage.getItem('etfProxyUrl');
        if (rawCustomProxy) {
            let customList = [];
            try {
                const parsed = JSON.parse(rawCustomProxy);
                if (Array.isArray(parsed)) customList = parsed;
                else if (typeof parsed === 'string') customList = [parsed];
            } catch (err) {
                customList = [rawCustomProxy];
            }
            const isLocalUrl = (url) => {
                try {
                    const parsed = new URL(url.replace('{url}', 'placeholder'));
                    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
                } catch { return false; }
            };
            customList
                .filter(entry => typeof entry === 'string' && entry.trim().length > 0 && isLocalUrl(entry.trim()))
                .forEach(entry => {
                    proxyEntries.push({
                        name: 'Custom Proxy',
                        template: entry.trim()
                    });
                });
        }

        for (const proxy of proxyEntries) {
            operation.check();
            try {
                const proxyUrl = buildProxyUrl(proxy.template, yahooUrl);
                const data = await fetchLocalProxyJsonWithRetry(proxyUrl, { operation });
                const parsed = parseYahooResponse(data, proxy.name);
                if (parsed) return parsed;
            } catch (err) {
                operation.check();
                // Yahoo Finance via proxy failed, try next
            }
        }

        // Alle Strategien fehlgeschlagen
        throw new AppError(
            `ETF-Daten konnten nicht abgerufen werden.\n\n` +
            `Ticker: ${ticker} (ISIN: ${isin})\n` +
            `Zieljahr: ${targetYear}\n` +
            `Gueltiger Jahresendstichtag: ${windowStart} bis ${windowEnd}\n\n` +
            `Getestete APIs:\n` +
            `- Yahoo Finance via lokalem Proxy (localhost:8787)\n` +
            `- Optional: Custom Proxy (localStorage etfProxyUrl/etfProxyUrls)\n\n` +
            `Hinweise:\n` +
            `- Nutze den Handkurs im Jahresdialog\n` +
            `- Korrigiere vorhandene Marktdaten unter Bedarf & Strategie\n` +
            `- Optional: localStorage "etfProxyUrl" oder "etfProxyUrls" setzen\n` +
            `- Pruefe die Browser-Konsole (F12) fuer Details`
        );
    };

    // Interne Absicherung direkter Handleraufrufe, kein zusätzlicher Balance-Nutzerpfad.
    // Rückgabe und nested-Fehlergrenze des Jahresschritts bleiben erhalten.
    const readStoredCapeMeta = () => {
        const loaded = loadStoredBalanceStateFromData({ [CONFIG.STORAGE.LS_KEY]: storage.getItem(CONFIG.STORAGE.LS_KEY) });
        if (['corrupt', 'unavailable'].includes(loaded.status)) throw loaded.error || new Error('CAPE-Speicherquelle ist nicht lesbar.');
        const state = loaded.value || {};
        const meta = state.capeMeta || {};
        return {
            capeRatio: toNumber(meta.capeRatio),
            capeAsOf: meta.capeAsOf || null,
            capeSource: meta.capeSource || null,
            capeFetchStatus: meta.capeFetchStatus || null,
            capeUpdatedAt: meta.capeUpdatedAt || null
        };
    };

    const attemptCapeSource = async (source, operation) => {
        const text = await fetchTextWithTimeout(source.url, CAPE_FETCH_TIMEOUT_MS, operation);
        operation.check();
        const parsed = parseCapeFromShillerText(text);
        if (!parsed || !isCapePlausible(parsed.capeRatio)) {
            throw new Error('CAPE Parsing lieferte keinen plausiblen Wert');
        }
        return {
            capeRatio: parsed.capeRatio,
            capeAsOf: parsed.capeAsOf,
            capeSource: source.id
        };
    };

    const prepareCape = async ({ targetYear = deriveCompletedCalendarYear(now()), signal } = {}) => {
        const navigationOperation = { controller: { signal }, check() { signal?.throwIfAborted(); } };
        navigationOperation.check();
        const nowIso = now().toISOString();
        const errors = [];
        const stored = readStoredCapeMeta();
        let resolved = null;
        let fetchStatus = 'error_no_source_no_stored';

        const synthetic = isSyntheticPriceMode();
        if (synthetic) {
            navigationOperation.check();
            resolved = await marketPriceAdapter('cape', { year: targetYear }, () => { throw new Error('Unerwarteter CAPE-Netzpfad.'); });
            navigationOperation.check();
            fetchStatus = 'ok_synthetic';
        }

        if (!synthetic) {
            try {
                resolved = await attemptCapeSource(CAPE_SOURCES.PRIMARY, navigationOperation);
                fetchStatus = 'ok_primary';
            } catch (err) {
                navigationOperation.check();
                errors.push(`Primary fehlgeschlagen: ${err?.message || 'unbekannt'}`);
            }
        }

        if (!synthetic && !resolved) {
            try {
                resolved = await attemptCapeSource(CAPE_SOURCES.MIRROR, navigationOperation);
                fetchStatus = 'ok_fallback_mirror';
            } catch (err) {
                navigationOperation.check();
                errors.push(`Mirror fehlgeschlagen: ${err?.message || 'unbekannt'}`);
            }
        }

        if (!synthetic && !resolved && Number.isFinite(stored.capeRatio) && stored.capeRatio > 0) {
            resolved = {
                capeRatio: stored.capeRatio,
                capeAsOf: stored.capeAsOf || null,
                capeSource: CAPE_SOURCES.STORED.id
            };
            fetchStatus = 'ok_fallback_stored';
        }

        if (!synthetic && resolved && monthsOld(resolved.capeAsOf, now()) > CAPE_STALE_MONTHS) {
            fetchStatus = 'warn_stale_source';
        }

        navigationOperation.check();
        if (resolved) {
            if (errors.length > 0) {
                console.info('[CAPE] Resolved with fallback path', {
                    fetchStatus,
                    resolvedSource: resolved.capeSource,
                    nonFatalErrors: errors
                });
            }
            const persistedMeta = {
                capeRatio: resolved.capeRatio,
                capeAsOf: resolved.capeAsOf,
                capeSource: resolved.capeSource,
                capeFetchStatus: fetchStatus,
                capeUpdatedAt: nowIso
            };
            return {
                ...persistedMeta,
                sourceLabel: resolved.capeSource === SYNTHETIC_MARKET_SOURCE ? SYNTHETIC_MARKET_SOURCE
                    : (resolved.capeSource === CAPE_SOURCES.PRIMARY.id)
                    ? CAPE_SOURCES.PRIMARY.label
                    : (resolved.capeSource === CAPE_SOURCES.MIRROR.id)
                        ? CAPE_SOURCES.MIRROR.label
                        : CAPE_SOURCES.STORED.label,
                errors
            };
        }

        const errorMeta = {
            capeRatio: Number.isFinite(stored.capeRatio) ? stored.capeRatio : null,
            capeAsOf: stored.capeAsOf || null,
            capeSource: stored.capeSource || null,
            capeFetchStatus: fetchStatus,
            capeUpdatedAt: nowIso
        };
        console.error('[CAPE] No source available and no stored fallback', {
            fetchStatus,
            errors,
            storedMeta: stored
        });
        return {
            ...errorMeta,
            sourceLabel: errorMeta.capeSource || 'keine',
            errors
        };
    };

    const prepareETF = async ({ targetYear, signal } = {}) => {
        const request = createAnnualMarketDataRequest(`calendar-year:${targetYear}`);
        if (!request || targetYear > deriveCompletedCalendarYear(now())) throw new AppError('Das Abschlussjahr ist ungültig.');
        const operation = { controller: { signal }, check() { signal?.throwIfAborted(); } };
        operation.check();
        const result = await fetchVanguardETFPrice(request, operation);
        operation.check();
        return validatePreparedAnnualQuote(result, request);
    };
    return { ...createInflationReaders({ now, ...inflationOptions }), prepareETF, prepareCape, fetchVanguardETFPrice };
}

/** Ein gemeinsamer Ergebnisvertrag für beide Seiteneinstiege. */
export async function prepareAnnualMarketData({ targetYear, manualPrice, preparedMarketData, signal, onProgress,
    readers = createAnnualMarketDataReaders(), now = appNow } = {}) {
    const results = { startTime: now().getTime(), errors: [] };
    for (const [key, label, prepare] of [['inflation', 'Inflation', readers.prepareInflation],
        ['etf', 'ETF & Nachrücken', readers.prepareETF], ['cape', 'CAPE', readers.prepareCape]]) {
        try {
            signal?.throwIfAborted();
            onProgress?.(`${label} wird vorbereitet …`);
            results[key] = key === 'etf' && manualPrice !== undefined
                ? createManualAnnualQuote(manualPrice, `calendar-year:${targetYear}`)
                : preparedMarketData?.[key] || await prepare({ targetYear, signal });
            signal?.throwIfAborted();
            if (key === 'cape' && results[key].capeFetchStatus === 'error_no_source_no_stored') throw new Error('Keine CAPE-Quelle verfügbar und kein lokaler Stand vorhanden.');
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            results.errors.push({ step: label, error: error.message });
        }
    }
    results.endTime = now().getTime();
    return { ok: !results.errors.length, results, marketData: results };
}
