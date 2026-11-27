import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { UIUtils } from '../app/balance/balance-utils.js';
import {
    INFLATION_RESULT_METRIC,
    createInflationReaders
} from '../app/balance/balance-annual-inflation.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { CONFIG } from '../app/balance/balance-config.js';

console.log('--- Balance Annual Inflation Tests ---');

const TARGET_YEAR = 2025;
const NOW = new Date('2026-07-14T10:00:00.000Z');

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: key => (store.has(String(key)) ? store.get(String(key)) : null),
        setItem: (key, value) => { store.set(String(key), String(value)); },
        removeItem: key => { store.delete(String(key)); },
        clear: () => { store.clear(); },
        key: index => Array.from(store.keys())[index] || null,
        get length() { return store.size; }
    };
}

function createDom() {
    return {
        inputs: {
            aktuellesAlter: { value: '60' },
            inflation: { value: '2' },
            floorBedarf: { value: '1000' },
            flexBedarf: { value: '500' },
            minimumFlexAnnual: { value: '250' },
            flexBudgetAnnual: { value: '300' },
            flexBudgetRecharge: { value: '200' }
        },
        controls: {}
    };
}

function createResponse(payload, { status = 200, headers = {} } = {}) {
    const normalizedHeaders = new Map(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
    );
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: name => normalizedHeaders.get(String(name).toLowerCase()) || null },
        json: async () => payload
    };
}

function createEcbPayload({ year = TARGET_YEAR, rate = 2.2, suffix = 'AVR' } = {}) {
    return {
        header: { prepared: '2026-01-30T11:15:00Z' },
        structure: {
            dimensions: {
                series: [
                    { id: 'FREQ', values: [{ id: 'A' }] },
                    { id: 'REF_AREA', values: [{ id: 'DE' }] },
                    { id: 'ADJUSTMENT', values: [{ id: 'N' }] },
                    { id: 'ICP_ITEM', values: [{ id: '000000' }] },
                    { id: 'DATA_PROVIDER', values: [{ id: '4D0' }] },
                    { id: 'ICP_SUFFIX', values: [{ id: suffix }] }
                ],
                observation: [
                    { id: 'TIME_PERIOD', values: [{ id: String(year) }] }
                ]
            }
        },
        dataSets: [{
            series: {
                '0:0:0:0:0:0': { observations: { 0: [rate] } }
            }
        }]
    };
}

function createWorldBankPayload({
    year = TARGET_YEAR,
    rate = 2.3,
    indicator = 'FP.CPI.TOTL.ZG'
} = {}) {
    return [
        { lastupdated: '2026-06-20' },
        [{
            indicator: { id: indicator },
            countryiso3code: 'DEU',
            date: String(year),
            value: rate
        }]
    ];
}

function createHandlers(dom, options = {}) {
    return createInflationReaders({
        fetchImpl: options.fetchImpl,
        now: () => new Date(NOW),
        timeoutMs: 100,
        setTimeoutImpl: options.setTimeoutImpl || (() => 1),
        clearTimeoutImpl: options.clearTimeoutImpl || (() => {})
    });
}

const previous = {
    localStorage: global.localStorage,
    toast: UIRenderer.toast,
    clearActionError: UIRenderer.clearActionError,
    handleError: UIRenderer.handleActionError,
    testDate: getAppTestDate(),
    consoleError: console.error
};

const actionResets = [];
try {
    setAppTestDate(null);
    UIRenderer.clearActionError = scope => { actionResets.push(scope); };
    global.localStorage = createLocalStorageMock();
    const toasts = [];
    UIRenderer.toast = (text, type = true) => { toasts.push({ text, type }); };
    UIRenderer.handleActionError = () => {};
    console.error = () => {};

    console.log('Test 4: ECB returns the exact annual-average contract before financial mutation');
    {
        localStorage.clear();
        const dom = createDom();
        const seenSignals = [];
        const cleared = [];
        const handlers = createHandlers(dom, {
            fetchImpl: async (url, options) => {
                assert(url.includes('HICP/A.DE.N.000000.4D0.AVR'), 'ECB request should select annual HICP average growth');
                assert(url.includes(`startPeriod=${TARGET_YEAR}`), 'ECB request should select the completed target year');
                seenSignals.push(options.signal);
                return createResponse(createEcbPayload());
            },
            setTimeoutImpl: () => 41,
            clearTimeoutImpl: id => { cleared.push(id); }
        });

        const result = await handlers.prepareInflation({ targetYear: TARGET_YEAR });
        assertEqual(result.year, TARGET_YEAR, 'Inflation result should expose the exact target year');
        assertEqual(result.metric, INFLATION_RESULT_METRIC, 'Inflation result should expose the shared metric');
        assertEqual(result.fetchStatus, 'ok_primary_ecb', 'Inflation result should expose the primary fetch status');
        assertEqual(result.dataAsOf, '2026-01-30T11:15:00Z', 'Inflation result should expose source data vintage');
        assert(seenSignals[0] instanceof AbortSignal, 'ECB request should receive an AbortSignal');
        assertEqual(cleared[0], 41, 'ECB timeout should be cleaned up after success');
    }

    console.log('Test 5: wrong ECB year is rejected and World Bank fallback preserves deflation');
    {
        localStorage.clear();
        const dom = createDom();
        const calls = [];
        const handlers = createHandlers(dom, {
            fetchImpl: async url => {
                calls.push(url);
                if (url.includes('data-api.ecb.europa.eu')) {
                    return createResponse(createEcbPayload({ year: TARGET_YEAR - 1, rate: 9 }));
                }
                return createResponse(createWorldBankPayload({ rate: -0.5 }));
            }
        });

        const result = await handlers.prepareInflation({ targetYear: TARGET_YEAR });
        assertEqual(calls.length, 2, 'Wrong-year ECB data should trigger exactly one fallback');
        assertEqual(result.source, 'World Bank (CPI)', 'World Bank should resolve the rejected ECB response');
        assertEqual(result.fetchStatus, 'ok_fallback_world_bank', 'Fallback path should be explicit');
        assertClose(result.rate, -0.5, 0.0001, 'Negative World Bank inflation should remain negative');
    }

    console.log('Test 6: ohne kompatible EZB- und Weltbankdaten bleibt die Handeingabe');
    {
        const calls = [];
        const handlers = createHandlers(createDom(), { fetchImpl: async url => {
            calls.push(url);
            return createResponse({}, { status: 503 });
        } });
        let rejected = false;
        try { await handlers.prepareInflation({ targetYear: TARGET_YEAR }); } catch { rejected = true; }
        assert(rejected, 'Fehlende Inflation bleibt ergänzbar');
        assertEqual(calls.length, 2, 'Nur EZB und Weltbank werden versucht');
        assert(!calls.some(url => url.includes('oecd.org')), 'Instabiler OECD-Weg ist aus der Reihe genommen');
    }

    console.log('Test 7: unavailable, out-of-range, and incompatible data are rejected');
    {
        localStorage.clear();
        const dom = createDom();
        const cleared = [];
        const handlers = createHandlers(dom, {
            fetchImpl: async url => {
                if (url.includes('data-api.ecb.europa.eu')) {
                    return createResponse(createEcbPayload({ rate: 60 }));
                }
                if (url.includes('api.worldbank.org')) {
                    return createResponse(createWorldBankPayload({ rate: null }));
                }
                throw new Error('Unerwartete dritte Inflationsquelle');
            },
            setTimeoutImpl: (() => {
                let id = 0;
                return () => ++id;
            })(),
            clearTimeoutImpl: id => { cleared.push(id); }
        });

        let rejected = false;
        try {
            await handlers.prepareInflation({ targetYear: TARGET_YEAR });
        } catch (err) {
            rejected = true;
            assertEqual(err.context.attempts.length, 2, 'Failed result should retain all source attempts');
        }
        assert(rejected, 'Unacceptable data from all sources should reject');
        assertEqual(cleared.length, 2, 'Every failed request should clean up its timeout');
    }

    console.log('Test 8: timeout aborts one source, cleans up, and permits the next source');
    {
        localStorage.clear();
        const dom = createDom();
        const timeoutCallbacks = [];
        const cleared = [];
        let requestCount = 0;
        const handlers = createHandlers(dom, {
            setTimeoutImpl: callback => {
                timeoutCallbacks.push(callback);
                return timeoutCallbacks.length;
            },
            clearTimeoutImpl: id => { cleared.push(id); },
            fetchImpl: async (url, options) => {
                requestCount++;
                if (url.includes('data-api.ecb.europa.eu')) {
                    timeoutCallbacks[timeoutCallbacks.length - 1]();
                    assert(options.signal.aborted, 'Timed-out ECB request should be aborted');
                    const abortError = new Error('aborted');
                    abortError.name = 'AbortError';
                    throw abortError;
                }
                return createResponse(createWorldBankPayload({ rate: 1.8 }));
            }
        });

        const result = await handlers.prepareInflation({ targetYear: TARGET_YEAR });
        assertEqual(requestCount, 2, 'Timeout should continue with the next source');
        assertEqual(result.fetchStatus, 'ok_fallback_world_bank', 'Timeout fallback should report its source path');
        assertEqual(cleared.length, 2, 'Timed-out and successful requests should both clean up timers');
    }

    console.log('Synthetische Inflation: Fachuhr vor injiziertem Normaldatum, null Provideraufrufe');
    {
        localStorage.clear();
        setAppTestDate('2027-01-02');
        const dom = createDom();
        let calls = 0;
        const handlers = createHandlers(dom, { fetchImpl: () => { calls++; throw new Error('Kein Netz'); } });
        const result = await handlers.prepareInflation({ targetYear: 2026 });
        assertEqual(result.year, 2026, 'Bestätigte Fachuhr bestimmt Abschlussjahr');
        assertEqual(result.rate, 2.5, 'Fester Jahreswert');
        assertEqual(result.source, 'Spielbereich · synthetisch', 'Sichtbare Herkunft');
        assertEqual(result.dataAsOf, '2026-12-31', 'Fester Jahresdatenstand');
        assertEqual(result.fetchStatus, 'ok_synthetic', 'Synthetischer Erfolgsstatus');
        assertEqual(calls, 0, 'Kein Inflationsprovider erreicht');
        setAppTestDate(null);
    }
    {
        localStorage.clear(); setAppTestDate(null);
        const dom = createDom(), before = JSON.stringify(dom.inputs);
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({ capeMeta: { capeRatio: 28 }, marker: 'read-only' }));
        const bytes = localStorage.getItem(CONFIG.STORAGE.LS_KEY);
        let requests = 0;
        const handlers = createHandlers(dom, { fetchImpl: async () => { requests++; return createResponse(createEcbPayload()); } });
        const prepared = await handlers.prepareInflation({ targetYear: TARGET_YEAR });
        assertEqual(JSON.stringify(dom.inputs), before, 'Inflationsvorabruf ändert keine Formularwerte');
        assertEqual(localStorage.getItem(CONFIG.STORAGE.LS_KEY), bytes, 'Inflationsvorabruf erhält alle Rohbytes');
        assertEqual(requests, 1, 'Genau ein erfolgreicher Quellenabruf');
        const failureDom = createDom(), failureBefore = JSON.stringify(failureDom.inputs);
        const failureBytes = localStorage.getItem(CONFIG.STORAGE.LS_KEY);
        let error;
        try { await createHandlers(failureDom, { fetchImpl: async () => { throw new Error('offline'); } }).prepareInflation({ targetYear: TARGET_YEAR }); } catch (caught) { error = caught; }
        assert(error, 'Alle Inflationsquellenfehler bleiben lesend sichtbar');
        assertEqual(JSON.stringify(failureDom.inputs), failureBefore, 'Fehlgeschlagener Vorabruf erhält Formular');
        assertEqual(localStorage.getItem(CONFIG.STORAGE.LS_KEY), failureBytes, 'Fehlgeschlagener Vorabruf erhält Rohbytes');
    }
    console.log('Balance annual inflation tests passed');
} finally {
    setAppTestDate(previous.testDate);
    console.error = previous.consoleError;
    UIRenderer.handleActionError = previous.handleError;
    UIRenderer.clearActionError = previous.clearActionError;
    UIRenderer.toast = previous.toast;
    if (previous.localStorage === undefined) delete global.localStorage;
    else global.localStorage = previous.localStorage;
}

console.log('--- Balance Annual Inflation Tests Completed ---');

// Lesende Altstandsprojektion: Jahr und Provider werden nicht aus dem Kalender erfunden.
const { readBalanceInflationSource } = await import('../app/balance/balance-inflation-source.js');
for (const [state, expectedValue, expectedYear, sourceText] of [
    [{ inputs: { inflation: 1.7 } }, 1.7, null, 'Jahr und Herkunft nicht belegt'],
    [{ inputs: { inflation: -0.3 } }, -0.3, null, 'Jahr und Herkunft nicht belegt'],
    [{ inputs: { inflation: 1.7 }, annualMarketDataMeta: { inflation: { year: 2024, rate: 1.7, source: 'Belegte Testquelle' } } }, 1.7, 2024, 'Belegte Testquelle'],
    [{ inputs: { inflation: 1.7 }, annualMarketDataMeta: { inflation: { year: 2024, rate: 9, source: 'Abweichender Altbeleg' } } }, 1.7, null, 'Jahr und Herkunft nicht belegt'],
    [{ inputs: { inflation: 2 }, annualPeriodMetadata: { lastCommittedPeriod: 'calendar-year:2023' } }, 2, 2023, 'Gespeicherter bestätigter Jahresstand']
]) {
    const raw = JSON.stringify(state);
    const source = readBalanceInflationSource({ storage: { getItem: key => key === CONFIG.STORAGE.LS_KEY ? raw : null } });
    assertEqual(source.value, expectedValue, 'Altinflation übernimmt vorhandenen Wert einschließlich Deflation');
    assertEqual(source.year, expectedYear, 'Altinflation verwendet ausschließlich belegtes Jahr');
    assert(source.source.includes(sourceText), 'Altinflation behauptet keine abweichende Providerherkunft');
}

// prepareAnnualNeeds: Rundung, Fehlerfälle und Formatierung der fortgeschriebenen Bedarfe.
{
    const { prepareAnnualNeeds } = await import('../app/balance/balance-annual-inflation.js');
    const inputs = { floorBedarf: { value: '1.000' }, flexBedarf: { value: '500' }, minimumFlexAnnual: { value: '250' },
        flexBudgetAnnual: { value: '300' }, flexBudgetRecharge: { value: '200' } };
    const up = prepareAnnualNeeds(inputs, 2);
    assertClose(up.factor, 1.02, 1e-12, 'Faktor folgt der Rate');
    assertEqual(up.entries.length, 5, 'Alle fünf Bedarfsfelder werden fortgeschrieben');
    assertClose(up.entries.find(e => e.id === 'floorBedarf').nextAmount, 1020, 0.01, 'Positive Inflation hebt den Bedarf');
    assertEqual(up.entries.find(e => e.id === 'floorBedarf').formattedValue, UIUtils.formatNumber(1020), 'Formatierter Wert nutzt die Zahlenanzeige');
    assertClose(prepareAnnualNeeds(inputs, -5).entries.find(e => e.id === 'floorBedarf').nextAmount, 950, 0.01, 'Deflation senkt den Bedarf');
    assertClose(prepareAnnualNeeds(inputs, -10).entries[0].nextAmount, 900, 0.01, 'Untere Grenze -10 % gilt');
    assertClose(prepareAnnualNeeds(inputs, 50).entries[0].nextAmount, 1500, 0.01, 'Obere Grenze 50 % gilt');
    assertEqual(prepareAnnualNeeds({ floorBedarf: { value: '1.000' } }, 0).entries.length, 1, 'Fehlende Felder werden übersprungen');
    for (const [rate, value] of [[-10.1, '1.000'], [50.1, '1.000'], [Number.NaN, '1.000'], [2, '-5']]) {
        let rejected = false;
        try { prepareAnnualNeeds({ floorBedarf: { value } }, rate); } catch { rejected = true; }
        assert(rejected, `Ungültig abgewiesen: Rate ${rate}, Betrag ${value}`);
    }
}
