import { createManualAnnualValue, validateAnnualPreparationValue, createAnnualMarketDataReaders } from '../app/shared/annual-marketdata.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import {
    ANNUAL_MARKET_DATA_META_KEY,
    createAnnualMarketDataRequest,
    selectAnnualCloseQuote
} from '../app/balance/balance-annual-marketdata.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';

console.log('--- Balance Annual Marketdata Tests ---');

function unix(isoDateTime) {
    return Math.floor(new Date(isoDateTime).getTime() / 1000);
}

function yahooChart(timestamps, closes) {
    return {
        chart: {
            result: [{
                timestamp: timestamps,
                indicators: { quote: [{ close: closes }] }
            }]
        }
    };
}

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

function seedAnnualState(periodId = 'calendar-year:2025', marketDataMeta) {
    const state = {
        annualPeriodMetadata: {
            schemaVersion: 1,
            lastCommittedPeriod: null,
            pendingCommit: {
                periodId,
                phase: 'writes_started',
                snapshotId: 'snapshot-2025'
            }
        }
    };
    if (marketDataMeta !== undefined) state[ANNUAL_MARKET_DATA_META_KEY] = marketDataMeta;
    localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state));
}

function createDom() {
    return {
        inputs: {
            endeVJ: { value: '120' },
            endeVJ_1: { value: '110' },
            endeVJ_2: { value: '100' },
            endeVJ_3: { value: '90' },
            ath: { value: '150' },
            jahreSeitAth: { value: '2' }
        },
        controls: {}
    };
}

function createHandlers() {
    return { calls: { update: 0 }, handlers: createAnnualMarketDataReaders() };
}

function okJsonResponse(data) {
    return {
        ok: true,
        json: async () => data
    };
}

const previous = {
    testDate: getAppTestDate(),
    fetch: global.fetch,
    localStorage: global.localStorage,
    toast: UIRenderer.toast,
    clearActionError: UIRenderer.clearActionError,
    handleError: UIRenderer.handleActionError
};

const actionResets = [];
try {
    setAppTestDate(null);
    UIRenderer.clearActionError = scope => { actionResets.push(scope); };
    const toasts = [];
    UIRenderer.toast = (text, type = true) => { toasts.push({ text, type }); };
    UIRenderer.handleActionError = () => {};

    console.log('Test 1: period id creates a stable UTC year-end request window');
    {
        const request = createAnnualMarketDataRequest('calendar-year:2025');
        assertEqual(request.targetYear, 2025, 'Zieljahr stammt aus der Perioden-ID');
        assertEqual(request.windowStart, '2025-12-27', 'Abruffenster beginnt am 27.12.');
        assertEqual(request.windowEnd, '2025-12-31', 'Abruffenster endet fachlich am 31.12.');
    }

    console.log('Test 2: malformed or unsupported period ids are rejected');
    {
        assertEqual(createAnnualMarketDataRequest('calendar-year:2025-extra'), null, 'Perioden-ID mit Suffix wird abgelehnt');
        assertEqual(createAnnualMarketDataRequest('year:2025'), null, 'Falscher Prefix wird abgelehnt');
        assertEqual(createAnnualMarketDataRequest('calendar-year:0999'), null, 'Jahr ausserhalb des Contracts wird abgelehnt');
        assertEqual(createAnnualMarketDataRequest(null), null, 'Fehlende Perioden-ID wird abgelehnt');
    }

    console.log('Test 3: latest valid target-year close wins independently of response order');
    {
        const data = yahooChart(
            [
                unix('2026-01-02T16:30:00Z'),
                unix('2025-12-30T16:30:00Z'),
                unix('2025-07-01T16:30:00Z'),
                unix('2025-12-29T16:30:00Z')
            ],
            [999, 131.25, 120, 130]
        );
        const quote = selectAnnualCloseQuote(data, {
            targetYear: 2025,
            ticker: 'VWCE.DE',
            source: 'Testquelle'
        });
        assertClose(quote.price, 131.25, 1e-9, 'Letzter gueltiger Schlusskurs wird gewaehlt');
        assertEqual(quote.asOf, '2025-12-30', 'Folgejahr und Jahresmitte werden nicht als Stichtag verwendet');
        assertEqual(quote.targetYear, 2025, 'Quote behaelt das explizite Zieljahr');
        assertEqual(quote.source, 'Testquelle', 'Quote behaelt die pruefbare Quelle');
    }

    console.log('Test 4: 27 December through 31 December are inclusive');
    {
        const quote27 = selectAnnualCloseQuote(
            yahooChart([unix('2025-12-27T12:00:00Z')], [125]),
            { targetYear: 2025 }
        );
        const quote31 = selectAnnualCloseQuote(
            yahooChart([unix('2025-12-31T12:00:00Z')], [132]),
            { targetYear: 2025 }
        );
        assertEqual(quote27.asOf, '2025-12-27', '27.12. ist als untere Grenze gueltig');
        assertEqual(quote31.asOf, '2025-12-31', '31.12. ist als obere Grenze gueltig');
    }

    console.log('Test 5: weekend and holiday gaps keep the last available close');
    {
        const quote = selectAnnualCloseQuote(
            yahooChart(
                [unix('2022-12-29T16:30:00Z'), unix('2022-12-30T16:30:00Z')],
                [96, 97]
            ),
            { targetYear: 2022 }
        );
        assertEqual(quote.asOf, '2022-12-30', 'Freitag bleibt letzter Kurs vor dem Wochenend-Jahresende');
        assertEqual(quote.price, 97, 'Der Preis des letzten Handelstags wird verwendet');
    }

    {
        const stamps = ['2025-12-30T22:59:00Z', '2025-12-30T23:00:00Z', '2025-12-31T23:00:00Z'].map(unix);
        const options = { targetYear: 2025 };
        assertEqual(selectAnnualCloseQuote(yahooChart(stamps.slice(0, 1), [130]), options).asOf, '2025-12-30',
            '23:59 Uhr in Berlin zählt zum 30. Dezember');
        const quote = selectAnnualCloseQuote(yahooChart(stamps, [130, 131, 999]), options);
        assertEqual(quote.price, 131, 'Der Berliner 31. Dezember zählt, der Berliner 1. Januar entfällt');
        assertEqual(quote.asOf, '2025-12-31', 'Mitternacht in Berlin zählt zum 31. Dezember');
        assertEqual(quote.date.toISOString().slice(0, 10), quote.asOf, 'Date und asOf tragen denselben Handelstag');
        assertEqual(quote.timestamp, stamps[1], 'Der originale Yahoo-Zeitstempel bleibt erhalten');
        assertEqual(selectAnnualCloseQuote(yahooChart([unix('2025-12-26T23:00:00Z')], [125]), options).asOf,
            '2025-12-27', 'Auch Mitternacht in Berlin am 27. Dezember liegt im Fenster');
        const request = createAnnualMarketDataRequest('calendar-year:2025');
        assertEqual(new Date(request.period1 * 1000).toISOString(), '2025-12-26T23:00:00.000Z', 'Abruf beginnt am Berliner 27. Dezember');
        assertEqual(new Date(request.period2 * 1000).toISOString(), '2025-12-31T23:00:00.000Z', 'Abruf endet am Berliner Folgejahresbeginn');
    }

    console.log('Test 6: stale, wrong-year, empty and implausible quotes fail closed');
    {
        assertEqual(
            selectAnnualCloseQuote(yahooChart([unix('2025-12-26T16:30:00Z')], [130]), { targetYear: 2025 }),
            null,
            'Kurs vor dem 27.12. wird als unvollstaendige Versorgung abgelehnt'
        );
        assertEqual(
            selectAnnualCloseQuote(yahooChart([unix('2024-12-31T16:30:00Z')], [130]), { targetYear: 2025 }),
            null,
            'Kurs aus falschem Jahr wird abgelehnt'
        );
        assertEqual(selectAnnualCloseQuote(yahooChart([], []), { targetYear: 2025 }), null, 'Leere Quotes werden abgelehnt');
        assertEqual(
            selectAnnualCloseQuote(
                yahooChart(
                    [
                        unix('2025-12-27T16:30:00Z'),
                        unix('2025-12-29T16:30:00Z'),
                        unix('2025-12-30T16:30:00Z'),
                        unix('2025-12-31T16:30:00Z')
                    ],
                    [0, -1, Number.NaN, Number.POSITIVE_INFINITY]
                ),
                { targetYear: 2025 }
            ),
            null,
            'Nichtpositive und nichtendliche Preise werden abgelehnt'
        );
        assertEqual(
            selectAnnualCloseQuote(
                yahooChart(
                    [unix('2025-12-30T16:30:00Z'), unix('2025-12-31T16:30:00Z')],
                    [0.49, 100000.01]
                ),
                { targetYear: 2025 }
            ),
            null,
            'Offensichtliche Skalierungsfehler ausserhalb des ETF-Preiscontracts werden abgelehnt'
        );
        assert(
            selectAnnualCloseQuote(
                yahooChart(
                    [unix('2025-12-30T16:30:00Z'), unix('2025-12-31T16:30:00Z')],
                    [0.5, 100000]
                ),
                { targetYear: 2025 }
            ),
            'Die expliziten Preisgrenzen bleiben inklusive'
        );
        assertEqual(selectAnnualCloseQuote({ chart: { result: [] } }, { targetYear: 2025 }), null, 'Fehlende Quote-Struktur wird abgelehnt');
    }

    // ATH-1b (Gutachten P3-2): Das frühere „Nachrücken mit ETF“ ist entfernt. Jahresendstände und Allzeithoch schreibt nur der
    // Jahresabschluss (balance-annual-storage-Tests); hier bleibt der lesende Abruf des Jahresendkurses.
    console.log('Test 7: prepared year-end quote uses the chart window and writes nothing');
    {
        global.localStorage = createLocalStorageMock();
        seedAnnualState('calendar-year:2025');
        const dom = createDom(), beforeDom = JSON.stringify(dom.inputs), bytes = localStorage.getItem(CONFIG.STORAGE.LS_KEY);
        const { handlers, calls } = createHandlers();
        const requestedUrls = [];
        global.fetch = async url => {
            requestedUrls.push(String(url));
            return okJsonResponse(yahooChart([unix('2025-12-30T16:30:00Z')], [140.4]));
        };
        const result = await handlers.prepareETF({ targetYear: 2025 });
        const request = createAnnualMarketDataRequest('calendar-year:2025');
        assertEqual(requestedUrls.length, 1, 'Der Jahresabschluss fragt nur den Jahresendkurs ab');
        const requested = new URL(requestedUrls[0]);
        assertEqual(requested.pathname, '/chart', 'Jahresendkurs nutzt die historische Reihe');
        assertEqual(requested.searchParams.get('symbol'), 'VWCE.DE', 'Jahresendkurs bleibt bei Xetra ohne Zusatzbörsen');
        assertEqual(requested.searchParams.get('period1'), String(request.period1), 'Fetch verwendet period1 aus der Perioden-ID');
        assertEqual(requested.searchParams.get('period2'), String(request.period2), 'Fetch verwendet exklusives period2');
        assertEqual(result.price, 140.4, 'Vorbereiteter Kurs bleibt ungerundet');
        assertEqual(result.asOf, '2025-12-30', 'Resultat enthaelt maschinenlesbaren Stichtag');
        assertEqual(result.ticker, 'VWCE.DE', 'Resultat enthaelt Ticker');
        assertEqual(result.source, 'Yahoo Finance (lokaler Proxy)', 'Resultat enthaelt Quelle');
        assertEqual(JSON.stringify(dom.inputs), beforeDom, 'Abruf rotiert keine Marktdatenfelder');
        assertEqual(localStorage.getItem(CONFIG.STORAGE.LS_KEY), bytes, 'Abruf schreibt keine Metadaten');
        assertEqual(calls.update, 0, 'Abruf triggert kein Update');
        assert(!('handleNachrueckenMitETF' in handlers), 'Kein schreibender ETF-Handler mehr (Gutachten P3-2)');
    }

    console.log('Test 8: invalid annual coverage rejects the prepared quote');
    {
        global.localStorage = createLocalStorageMock();
        seedAnnualState();
        const { handlers } = createHandlers();
        global.fetch = async () => okJsonResponse(
            yahooChart(
                [unix('2025-12-26T16:30:00Z'), unix('2026-01-02T16:30:00Z')],
                [140, 141]
            )
        );
        let thrown = null;
        try {
            await handlers.prepareETF({ targetYear: 2025 });
        } catch (err) {
            thrown = err;
        }
        assert(thrown instanceof Error, 'Ungueltige Jahresendversorgung wirft einen Fehler');
    }

    {
        setAppTestDate('2027-01-02');
        let net = 0;
        global.fetch = () => { net++; throw new Error('Kein Netz'); };
        const { handlers } = createHandlers();
        const result = await handlers.prepareETF({ targetYear: 2026 });
        assertEqual(result.source, 'Spielbereich · synthetisch', 'ETF-Ergebnis nennt synthetische Herkunft');
        let rejected = false;
        try { await handlers.prepareETF({ targetYear: 2027 }); } catch { rejected = true; }
        assert(rejected, 'Künftige Jahresperiode scheitert vor Anbieteraufruf');
        assertEqual(net, 0, 'ETF erreicht keinen Fetchpfad, auch bei ungültiger Periode');
        setAppTestDate(null);
    }
    {
        setAppTestDate(null); global.localStorage = createLocalStorageMock();
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({ marker: 'ohne-pendingCommit' }));
        const dom = createDom(), before = JSON.stringify(dom.inputs), bytes = localStorage.getItem(CONFIG.STORAGE.LS_KEY);
        const { handlers } = createHandlers(); let requests = 0;
        global.fetch = async () => { requests++; return okJsonResponse(yahooChart([unix('2025-12-30T00:00:00Z')], [140.4])); };
        const prepared = await handlers.prepareETF({ targetYear: 2025 });
        assertEqual(JSON.stringify(dom.inputs), before, 'ETF-Vorababruf rotiert keine Formularwerte');
        assertEqual(localStorage.getItem(CONFIG.STORAGE.LS_KEY), bytes, 'ETF-Vorababruf benötigt keinen Commit und erhält Bytes');
        assertEqual(requests, 1, 'ETF-Vorababruf fragt genau einmal');
        global.fetch = async () => { throw new Error('offline'); };
        let error; try { await handlers.prepareETF({ targetYear: 2025 }); } catch (caught) { error = caught; }
        assert(error, 'Fehlender ETF-Vorabkurs bleibt Abruffehler');
        assertEqual(localStorage.getItem(CONFIG.STORAGE.LS_KEY), bytes, 'ETF-Abruffehler schreibt keine Metadaten');
        assertEqual(JSON.stringify(dom.inputs), before, 'ETF-Abruffehler erhält Formular');
    }
    console.log('Balance annual marketdata tests passed');
} finally {
    setAppTestDate(previous.testDate);
    UIRenderer.toast = previous.toast;
    UIRenderer.handleActionError = previous.handleError;
    UIRenderer.clearActionError = previous.clearActionError;
    if (previous.fetch === undefined) delete global.fetch; else global.fetch = previous.fetch;
    if (previous.localStorage === undefined) delete global.localStorage; else global.localStorage = previous.localStorage;
}

console.log('--- Balance Annual Marketdata Tests Completed ---');

// Handergänzungen verwenden den vorhandenen Ergebnisvertrag und keine eigenen Writes.
for (const [type, raw, field, value] of [['inflation', '0', 'rate', 0], ['inflation', '-2,5', 'rate', -2.5], ['cape', '30,2', 'capeRatio', 30.2], ['etf', '160.4', 'price', 160.4]]) {
    const result = createManualAnnualValue(type, raw, 2026);
    assertEqual(result[field], value, 'Manuelle Pflichtwerte bewahren gültige Zahlen einschließlich Nullinflation');
    assertEqual(validateAnnualPreparationValue(type, result, 2026)[field], value, 'Hand- und Abrufwert teilen denselben Vorbereitungsvertrag');
}
for (const [type, raw] of [['inflation', '51'], ['inflation', '-11'], ['inflation', ''], ['cape', '4'], ['cape', '81'], ['cape', 'NaN'], ['etf', '-1'], ['etf', '100001']]) {
    let rejected = false; try { createManualAnnualValue(type, raw, 2026); } catch { rejected = true; }
    assert(rejected, 'Unplausible Handergänzung ergibt keinen vorbereiteten Pflichtwert');
}

// Live-CAPE (Shiller): Parser, Jahresstichtag und lesender Abruf. Ehemals balance-annual-cape.test.mjs, jetzt am gemeinsamen Leser.
{
    const { parseShillerCapeTable, isCapeCurrentForYear } = await import('../app/shared/shiller-cape.js');
    const { createMusterHaushaltRecords } = await import('../app/demo/muster-haushalt.js');
    const { HOUSEHOLD_PLAN_KEY, buildPlanRecord } = await import('../app/profile/household-plan.js');
    const fs = await import('node:fs');
    const fixture = name => fs.readFileSync(new URL(`fixtures/annual-marketdata/${name}`, import.meta.url), 'utf8');
    const page = fixture('shiller-download-2026-10.html'), table = fixture('shiller-data-2026-10.html');
    const saved = { storage: global.localStorage, fetch: global.fetch, date: getAppTestDate() };
    const records = new Map();
    const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)) };
    const now = () => new Date('2026-10-22T10:00:00Z');
    const calls = [];
    const response = html => ({ ok: true, text: async () => html });
    const mockSource = (html = table) => async (url, options) => {
        calls.push(url);
        assertEqual(options.headers['X-Return-Format'], 'html', 'HTML erhält leere Zellen und die CAPE-Spalte');
        return response(url.includes('img1.wsimg.com') ? html : page);
    };
    const seed = (capeAsOf = '2024-12-01') => storage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({
        capeMeta: { capeRatio: 37.7111916964346, capeAsOf, capeSource: 'stored_last_value' }, marker: 'erhalten'
    }));
    try {
        setAppTestDate(null); global.localStorage = storage;
        const readers = createAnnualMarketDataReaders({ storage, now });
        global.fetch = mockSource();
        let current;
        for (const [year, expected] of [[2024, 37.7111916964346], [2025, 39.5816409932426]]) {
            seed(); calls.length = 0;
            const before = storage.getItem(CONFIG.STORAGE.LS_KEY);
            const result = await readers.prepareCape({ targetYear: year });
            current = result;
            assertClose(result.capeRatio, expected, 1e-12, 'Original-CAPE statt TR CAPE oder letzter Zahl');
            assertEqual(result.capeAsOf, `${year}-12-01`, 'Neuster Monat im Zieljahr statt späterer Jahre');
            assertEqual(result.capeFetchStatus, 'ok_primary', 'Aktueller Download liefert Jahreswert');
            assertEqual(calls.length, 2, 'Seite und verlinkte XLS einmal abgerufen');
            assert(calls.every(url => url.startsWith('https://r.jina.ai/') && !url.includes('yale.edu')), 'Nur erlaubter Readerhost, kein Yale');
            assertEqual(storage.getItem(CONFIG.STORAGE.LS_KEY), before, 'Vorbereitung ist schreibfrei');
        }
        storage.setItem(CONFIG.STORAGE.LS_KEY, '{kaputt'); calls.length = 0;
        const corrupt = await readers.prepareCape({ targetYear: 2025 });
        assertEqual(corrupt.capeFetchStatus, 'ok_primary', 'Beschädigter Balance-Stand blockiert den CAPE-Abruf nicht');
        assertEqual(calls.length, 2, 'Auch mit beschädigtem Stand werden Seite und Tabelle abgerufen');
        assert(corrupt.storedCapeWarning.includes('Balance-Stand'), 'CAPE-Vorbereitung nennt den beschädigten Stand');
        assertEqual(storage.getItem(CONFIG.STORAGE.LS_KEY), '{kaputt', 'Der Abruf ändert den beschädigten Stand nicht');
        global.fetch = async () => { throw new Error('Offline'); };
        const corruptOffline = await readers.prepareCape({ targetYear: 2025 });
        assertEqual(corruptOffline.capeFetchStatus, 'error_no_source_no_stored', 'Beschädigter Stand und Abruffehler erfordern Handeingabe');
        assertEqual(corruptOffline.lastStoredCape, null, 'Beschädigter Stand liefert keinen Altwert');
        assertEqual(corruptOffline.storedCapeWarning, corrupt.storedCapeWarning, 'Die Warnung bleibt auch beim Abruffehler erhalten');
        assertEqual(corruptOffline.errors[0], 'Offline', 'Der ursprüngliche Abruffehler bleibt erhalten');
        assert(corruptOffline.manualHint.includes('kein Wert') && corruptOffline.manualHint.includes('Trage den aktuellen Wert'), 'Der Hinweis erklärt die Handeingabe ohne Altwert');
        seed();
        const small = (date, header = 'CAPE') => `<table><tr><td>Date</td><td>TR CAPE</td><td>${header}</td><td>Returns</td></tr><tr><td>${date}</td><td>42.35</td><td sdval="39.5816409932426">39.58</td><td>40.83</td></tr></table>`;
        assertClose(parseShillerCapeTable(small('2025.1'), 2025).capeRatio, current.capeRatio, 1e-12, 'Kopf bestimmt auch verschobene CAPE-Spalte');
        assertEqual(parseShillerCapeTable(small('2025.1'), 2025).capeAsOf, '2025-10-01', 'Shiller .1 bezeichnet Oktober');
        assertEqual(parseShillerCapeTable(small('2025.01'), 2025).capeAsOf, '2025-01-01', 'Shiller .01 bezeichnet Januar');
        assertEqual(parseShillerCapeTable(small('2025.12', 'unbekannt'), 2025), null, 'Fehlender CAPE-Kopf erlaubt kein Raten');
        assertEqual(parseShillerCapeTable('2025.12 foo bar 39.58', 2025), null, 'Text ohne Zellen wird nicht geraten');
        assert(isCapeCurrentForYear('2025-10-01', 2025), 'Ab Oktober zulässig');
        assert(!isCapeCurrentForYear('2025-09-30', 2025) && !isCapeCurrentForYear('2026-10-01', 2025), 'September und anderes Jahr nicht zulässig');
        assert(!isCapeCurrentForYear('2025-11-31', 2025), 'Ungültiges Kalenderdatum abweisen');
        for (const failure of ['old', 'missing', 'no-header']) {
            seed(); calls.length = 0;
            global.fetch = failure === 'missing' ? async () => { throw new Error('Keine Antwort'); }
                : mockSource(small('2025.09', failure === 'no-header' ? 'Kennzahl' : 'CAPE'));
            const before = storage.getItem(CONFIG.STORAGE.LS_KEY);
            const result = await readers.prepareCape({ targetYear: 2025 });
            assertEqual(result.capeRatio, null, `${failure}: kein automatischer Altwert`);
            assertEqual(result.capeFetchStatus, 'error_no_source_no_stored', `${failure}: Handeingabe erforderlich`);
            assert(result.manualHint.includes('CAPE nicht automatisch ermittelt') && result.manualHint.includes('37,71') && result.manualHint.includes('Dezember 2024'), `${failure}: letzter Wert und Monatsstand im Hinweis`);
            assert(result.manualHint.includes('shillerdata.com') && result.manualHint.includes('Spalte CAPE'), 'Handquelle genannt');
            assertEqual(storage.getItem(CONFIG.STORAGE.LS_KEY), before, 'Fehlabruf verändert keinen gespeicherten Stand');
            let rejected = false;
            try { validateAnnualPreparationValue('cape', result, 2025); } catch (error) { rejected = error.message.includes('Zuletzt gespeichert:'); }
            assert(rejected, 'Jahresvorbereitung erhält den Handeingabe-Hinweis');
        }
        seed('2025-12-01');
        const failed = await readers.prepareCape({ targetYear: 2025 });
        assertEqual(failed.capeRatio, null, 'Gespeicherter Wert bleibt Hinweis, auch mit passendem Stand');
        const planned = createMusterHaushaltRecords('2026-10-22', 'max-erika');
        const entry = Object.values(JSON.parse(planned[HOUSEHOLD_PLAN_KEY]).entries)[0];
        planned[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(planned[HOUSEHOLD_PLAN_KEY], [{ scope: entry.scope,
            values: { ...entry.values, cape: { value: 27.4, asOf: '2025-12-01', source: 'manuell' } } }]).raw;
        for (const [key, value] of Object.entries(planned)) records.set(key, value);
        seed('2025-12-01');
        global.fetch = async () => { throw new Error('Offline'); };
        const beforePlan = JSON.stringify([...records]);
        const planFallback = await readers.prepareCape({ targetYear: 2025 });
        assertEqual(planFallback.lastStoredCape.capeRatio, 27.4, 'HS-1c manueller Plan-CAPE ist der letzte gespeicherte Stand');
        assertEqual(planFallback.lastStoredCape.capeSource, 'manuell', 'HS-1c Herkunft stammt aus dem Plan');
        assertEqual(planFallback.capeRatio, null, 'HS-1c gespeicherter Planwert braucht weiterhin Handbestätigung');
        assertEqual(JSON.stringify([...records]), beforePlan, 'HS-1c Vorbereitung schreibt keine Altdaten um');
        records.clear();
        const empty = await readers.prepareCape({ targetYear: 2025 });
        assert(empty.manualHint.includes('kein Wert') && empty.manualHint.includes('Stand unbekannt'), 'Ohne Speicherstand bleibt Herkunft ehrlich');
        setAppTestDate('2027-01-02');
        let network = 0; global.fetch = () => { network++; throw new Error('Unerwartetes Netz'); };
        const synthetic = await createAnnualMarketDataReaders().prepareCape({ targetYear: 2026 });
        assertEqual(synthetic.capeRatio, 28.5, 'Spielbereich erhält synthetischen CAPE');
        assertEqual(synthetic.capeAsOf, '2026-12-31', 'Synthetischer Stand gehört zum Abschlussjahr');
        assertEqual(synthetic.capeSource, 'Spielbereich · synthetisch', 'Synthetische Herkunft bleibt sichtbar');
        assertEqual(network, 0, 'Spielbereich benötigt keinen Netzabruf');
    } finally {
        setAppTestDate(saved.date);
        if (saved.storage === undefined) delete global.localStorage; else global.localStorage = saved.storage;
        if (saved.fetch === undefined) delete global.fetch; else global.fetch = saved.fetch;
    }
}
