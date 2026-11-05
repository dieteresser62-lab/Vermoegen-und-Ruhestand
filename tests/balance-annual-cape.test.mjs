import fs from 'node:fs';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { createMarketdataHandlers } from '../app/balance/balance-annual-marketdata.js';
import { createAnnualMarketDataReaders, validateAnnualPreparationValue } from '../app/shared/annual-marketdata.js';
import { parseShillerCapeTable, isCapeCurrentForYear } from '../app/shared/shiller-cape.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord } from '../app/profile/household-plan.js';

const fixture = name => fs.readFileSync(new URL(`fixtures/annual-marketdata/${name}`, import.meta.url), 'utf8');
const page = fixture('shiller-download-2026-10.html');
const table = fixture('shiller-data-2026-10.html');
const previous = { storage: global.localStorage, fetch: global.fetch, date: getAppTestDate() };
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
    let updates = 0;
    const dom = { inputs: { marketCapeRatio: { value: '27' }, capeRatio: { value: '27' } }, controls: {} };
    const handlers = createMarketdataHandlers({ dom, now, appState: {}, debouncedUpdate: () => updates++ });
    const readers = createAnnualMarketDataReaders({ storage, now });
    global.fetch = mockSource();
    for (const [year, expected] of [[2024, 37.7111916964346], [2025, 39.5816409932426]]) {
        seed(); calls.length = 0;
        const before = storage.getItem(CONFIG.STORAGE.LS_KEY);
        const result = await readers.prepareCape({ targetYear: year });
        assertClose(result.capeRatio, expected, 1e-12, 'Original-CAPE statt TR CAPE oder letzter Zahl');
        assertEqual(result.capeAsOf, `${year}-12-01`, 'Neuster Monat im Zieljahr statt späterer Jahre');
        assertEqual(result.capeFetchStatus, 'ok_primary', 'Aktueller Download liefert Jahreswert');
        assertEqual(calls.length, 2, 'Seite und verlinkte XLS einmal abgerufen');
        assert(calls.every(url => url.startsWith('https://r.jina.ai/') && !url.includes('yale.edu')), 'Nur erlaubter Readerhost, kein Yale');
        assertEqual(storage.getItem(CONFIG.STORAGE.LS_KEY), before, 'Vorbereitung ist schreibfrei');
    }
    const current = await handlers.prepareCape({ targetYear: 2025 });
    const preparedCalls = calls.length;
    await handlers.handleFetchCapeAuto({ preparedResult: current });
    assertEqual(calls.length, preparedCalls, 'Übernahme lädt nicht erneut');
    assertEqual(updates, 1, 'Frischer Wert aktualisiert das Formular');
    assertEqual(dom.inputs.marketCapeRatio.value, '39.6', 'Bestehende Balance-Eingabe übernimmt gültigen Wert');

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
        seed(); calls.length = 0; updates = 0;
        global.fetch = failure === 'missing' ? async () => { throw new Error('Keine Antwort'); }
            : mockSource(small('2025.09', failure === 'no-header' ? 'Kennzahl' : 'CAPE'));
        const before = storage.getItem(CONFIG.STORAGE.LS_KEY), input = dom.inputs.marketCapeRatio.value;
        const result = await handlers.handleFetchCapeAuto();
        assertEqual(result.capeRatio, null, `${failure}: kein automatischer Altwert`);
        assertEqual(result.capeFetchStatus, 'error_no_source_no_stored', `${failure}: Handeingabe erforderlich`);
        assert(result.manualHint.includes('CAPE nicht automatisch ermittelt') && result.manualHint.includes('37,71') && result.manualHint.includes('Dezember 2024'), `${failure}: letzter Wert und Monatsstand im Hinweis`);
        assert(result.manualHint.includes('shillerdata.com') && result.manualHint.includes('Spalte CAPE'), 'Handquelle genannt');
        assertEqual(storage.getItem(CONFIG.STORAGE.LS_KEY), before, 'Fehlabruf verändert keinen gespeicherten Stand');
        assertEqual(dom.inputs.marketCapeRatio.value, input, 'Fehlabruf verändert keine Balance-Eingabe');
        assertEqual(updates, 0, 'Kein Update mit Altwert');
        let rejected = false;
        try { validateAnnualPreparationValue('cape', result, 2025); } catch (error) { rejected = error.message.includes('Zuletzt gespeichert:'); }
        assert(rejected, 'Jahresvorbereitung erhält den Handeingabe-Hinweis');
    }
    // Auch ein zeitlich passender gespeicherter Wert wird nicht still bestätigt.
    seed('2025-12-01');
    const failed = await readers.prepareCape({ targetYear: 2025 });
    assertEqual(failed.capeRatio, null, 'Gespeicherter Wert bleibt Hinweis, auch mit passendem Stand');
    // HS-1c: Planstand hat Vorrang vor abweichenden alten Balance-Metadaten.
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
    assertEqual(planFallback.capeRatio, null, 'HS-1c gespeicherter Planwert braucht laut Datenquellen weiterhin Handbestätigung');
    assertEqual(JSON.stringify([...records]), beforePlan, 'HS-1c Vorbereitung schreibt keine Altdaten um');
    records.clear(); global.fetch = async () => { throw new Error('Offline'); };
    const empty = await readers.prepareCape({ targetYear: 2025 });
    assert(empty.manualHint.includes('kein Wert') && empty.manualHint.includes('Stand unbekannt'), 'Ohne Speicherstand bleibt Herkunft ehrlich');

    setAppTestDate('2027-01-02');
    let network = 0; global.fetch = () => { network++; throw new Error('Unerwartetes Netz'); };
    const syntheticHandlers = createMarketdataHandlers({ dom, appState: {}, debouncedUpdate: () => {} });
    const synthetic = await syntheticHandlers.handleFetchCapeAuto();
    assertEqual(synthetic.capeRatio, 28.5, 'Spielbereich erhält synthetischen CAPE');
    assertEqual(synthetic.capeAsOf, '2026-12-31', 'Synthetischer Stand gehört zum Abschlussjahr');
    assertEqual(synthetic.capeSource, 'Spielbereich · synthetisch', 'Synthetische Herkunft bleibt sichtbar');
    assertEqual(network, 0, 'Spielbereich benötigt keinen Netzabruf');
} finally {
    setAppTestDate(previous.date);
    if (previous.storage === undefined) delete global.localStorage; else global.localStorage = previous.storage;
    if (previous.fetch === undefined) delete global.fetch; else global.fetch = previous.fetch;
}
