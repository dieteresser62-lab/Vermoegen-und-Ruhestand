import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { createProfilverbundHandlers } from '../app/balance/balance-main-profilverbund.js';
import { evaluateBalanceFileInputs } from '../app/balance/balance-file-service.js';
import { evaluateBalanceMarketPreview } from '../app/balance/balance-market-preview-runtime.js';
import { prepareMarketPreview } from '../app/balance/balance-market-preview.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { DAILY_PRICES_KEY, emptyHistorySymbol, historyDay } from '../app/tranches/tranchen-history-store.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { OVERVIEW_SUMMARY_KEY, readOverviewSummaries } from '../app/overview/overview-storage.js';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { UIReader } from '../app/balance/balance-reader.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { MockDocument, MockEvent } from './helpers/balance-page-fixture.mjs';
import { installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';

const json = JSON.stringify, now = new Date('2026-10-30T12:00:00Z');
const inputs = { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 };
const prices = points => ({ version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR',
    days: points.map(([date]) => historyDay(date)), closes: points.map(([, price]) => price) } } });
function fixture(household = 'max-erika') {
    const records = createMusterHaushaltRecords('2026-10-30', household);
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const profile of Object.values(registry.profiles)) {
        const state = JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]);
        state.inputs = { ...state.inputs, ...inputs };
        state.profilverbundHouseholdInputs = { ...state.profilverbundHouseholdInputs, ...inputs };
        for (const [key, value] of Object.entries(inputs)) (state.balanceInputFields ||= {})[key] = { value: String(value), checked: false };
        profile.data[CONFIG.STORAGE.LS_KEY] = json(state);
    }
    records.rs_profiles_v1 = json(registry);
    records[CONFIG.STORAGE.LS_KEY] = registry.profiles[records.rs_current_profile].data[CONFIG.STORAGE.LS_KEY];
    records[DAILY_PRICES_KEY] = json(prices([['2026-07-14', 200], ['2026-10-30', 170]]));
    const storage = { getItem: key => records[key] ?? null, key: i => Object.keys(records)[i] ?? null,
        get length() { return Object.keys(records).length; } };
    const calculation = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
    const handlers = createProfilverbundHandlers({ dom: {}, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
    const options = { inputData: calculation.inputData, persistentState: calculation.history.persistentState,
        profiles: calculation.profiles, profileId: calculation.profileId, engineApi: EngineAPI, publish: true,
        planInputs: calculation.householdPlan.entry.values,
        profilverbundHandlers: { runProfilverbundProfileSimulations: (input, profiles, state, { publish = true } = {}) =>
            handlers.runProfilverbundProfileSimulations(input, profiles, state,
                { engineApi: EngineAPI, publish, withdrawalMode: calculation.householdPlan.entry.values.householdWithdrawalMode }) } };
    return { records, storage, calculation, options, context: { storage, calculation, now } };
}
function assertBase(result, base, label) {
    assertEqual(json(result.modelResult), json(base.modelResult), label + ': vollständiges Basis-Ergebnis bytegleich');
    assertEqual(json(result.profilverbundRuns), json(base.profilverbundRuns), label + ': Basis-Profilaktionen bytegleich');
    assertEqual(result.marketPreview.withoutQuote, true, label + ': ohne Kurs');
    assertEqual(result.marketPreview.readingsEqual, true, label + ': gleiche Lesarten');
    assertEqual(result.marketPreview.comparison.state, 'not_reliable', label + ': Budgetvergleich nicht belastbar');
    assert(Boolean(result.marketPreview.comparison.reason), label + ': Budgetvergleich mit Grund');
}
const savedGlobals = Object.fromEntries(['window', 'document', 'Event'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const savedDate = getAppTestDate(), savedError = console.error, savedInfo = console.info;
const restoreLocks = installAnnualLocks();
try {
    globalThis.window = {};
    setAppTestDate('2026-10-30');
    const errors = [];
    console.error = (...args) => errors.push(args);
    console.info = () => {};

    // JSON-/Registryfehler, Projektion und Datum dürfen die vorhandene Basis nie verwerfen.
    for (const [label, change] of [
        ['Registry-JSON', f => { f.records.rs_profiles_v1 = '{broken'; }],
        ['Registrystruktur', f => { f.records.rs_profiles_v1 = json({ profiles: null }); }],
        ['Datum', f => { f.context.now = new Date(NaN); }],
        ['Speicherlesefehler', f => { f.context.storage = { get length() { throw new Error('Synthetischer Lesefehler'); } }; }]
    ]) {
        const f = fixture(), base = evaluateBalanceFileInputs(f.options);
        change(f);
        const before = json(f.records), previousErrors = errors.length;
        const result = evaluateBalanceFileInputs({ ...f.options, marketPreviewContext: f.context });
        assertBase(result, base, label);
        assertEqual(result.marketPreview.yearEndDate, null, label + ': kein erfundenes Bezugsdatum');
        assertEqual(errors.length, previousErrors + 1, label + ': Fehler nur in Konsole');
        assertEqual(json(f.records), before, label + ': alle Speicherbytes erhalten');
    }
    // Auch ein Fehler nach der Regelrechnung nimmt veröffentlichte Vorschauaktionen zurück.
    for (const failure of ['engine', 'projection']) {
        const f = fixture();
        let base, baseActions, baseDistribution;
        const result = evaluateBalanceMarketPreview(f.options, f.context, options => {
            if (options.inputData.ath === 200 && failure === 'engine') throw new Error('Synthetischer Vorschaufehler');
            const evaluated = evaluateBalanceFileInputs(options);
            if (!base) { base = evaluated; baseActions = window.__profilverbundActionResults; baseDistribution = window.__profilverbundDistribution; }
            if (options.inputData.ath === 200 && failure === 'projection') evaluated.modelResult.ui.market = null;
            return evaluated;
        });
        assertBase(result, base, failure);
        assertEqual(window.__profilverbundActionResults, baseActions, failure + ': Basis-Profilaktionen wiederhergestellt');
        assertEqual(window.__profilverbundDistribution, baseDistribution, failure + ': Basis-Verteilung wiederhergestellt');
    }
    const baseError = new Error('Synthetischer Basisfehler');
    let thrown;
    try { evaluateBalanceMarketPreview(fixture().options, fixture().context, () => { throw baseError; }); }
    catch (error) { thrown = error; }
    assertEqual(thrown, baseError, 'Fehler der Basisrechnung bleibt regulärer Fehler');

    // Der bereits in endeVJ enthaltene Schluss darf die Jahresreihe nicht nochmals verschieben.
    for (const date of ['2025-12-31', '2025-12-30']) {
        const dailyPrices = prices([[date, 150]]);
        const prepared = prepareMarketPreview({ inputs, dailyPrices, today: '2026-10-30', yearEndDate: '2025-12-31', hasAnnualClose: true });
        assertEqual(prepared.withoutQuote, true, date + ': alter Schluss zählt nicht als Tageskurs');
        assertEqual(prepared.withoutQuoteReason, 'kein Tageskurs seit Jahresende VJ', date + ': genauer Anzeigegrund');
        assertEqual(json(prepared.ruleInputs), json(inputs), date + ': Regelinputs unverändert');
        assertEqual(json(prepared.highInputs), json(inputs), date + ': Hochinputs unverändert');
        const f = fixture(), base = evaluateBalanceFileInputs(f.options);
        f.records[DAILY_PRICES_KEY] = json(dailyPrices);
        let calls = 0;
        const result = evaluateBalanceMarketPreview(f.options, f.context, options => { calls++; return evaluateBalanceFileInputs(options); });
        assertBase(result, base, date);
        assertEqual(calls, 1, date + ': nur Basisrechnung');
        assertEqual(result.marketPreview.withoutQuoteReason, 'kein Tageskurs seit Jahresende VJ', date + ': Grund bis zur Projektion');
    }
    const fresh = prepareMarketPreview({ inputs, dailyPrices: prices([['2026-01-01', 151]]),
        today: '2026-10-30', yearEndDate: '2025-12-31', hasAnnualClose: true });
    assertEqual(fresh.quote.asOf, '2026-01-01', 'Erster Schluss nach Jahresende zählt');

    for (const [expected, change] of [
        ['unclear', state => { state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2028', pendingCommit: null }; }],
        ['recovery', state => { state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null,
            pendingCommit: { periodId: 'calendar-year:2026', phase: 'snapshot_confirmed', snapshotId: 'synthetic' } }; }],
        ['unavailable', null]
    ]) {
        const f = fixture(), base = evaluateBalanceFileInputs(f.options);
        if (change) { const state = JSON.parse(f.records[CONFIG.STORAGE.LS_KEY]); change(state); f.records[CONFIG.STORAGE.LS_KEY] = json(state); }
        else f.records.depot_tranchen = '{broken';
        const model = projectOverviewFromRecords({ registry: JSON.parse(f.records.rs_profiles_v1), activeId: f.records.rs_current_profile,
            liveData: f.records, now, balanceSingleFallback: true });
        assertEqual(model.occasion.annualState, expected, expected + ': tatsächlicher Jahreszustand im Übersichtsmodell');
        const result = evaluateBalanceFileInputs({ ...f.options, marketPreviewContext: f.context });
        assertBase(result, base, expected);
        assertEqual(result.marketPreview.yearEndDate, null, expected + ': kein stiller Datumsfallback');
    }
    for (const missing of ['activeId', 'model']) {
        const f = fixture(), base = evaluateBalanceFileInputs(f.options);
        if (missing === 'activeId') delete f.records.rs_current_profile;
        else f.records.rs_profiles_v1 = json({ profiles: {} });
        const result = evaluateBalanceFileInputs({ ...f.options, marketPreviewContext: f.context });
        assertBase(result, base, missing);
        assertEqual(result.marketPreview.yearEndDate, null, missing + ': kein stiller Datumsfallback');
    }

    // Echter Balance-Update samt Summarywriter und echter Engine für Paar und Einzelperson.
    globalThis.document = new MockDocument();
    globalThis.Event = MockEvent;
    globalThis.window = { EngineAPI, addEventListener() {}, location: { href: 'http://localhost/Balance.html', hash: '' } };
    const main = await import('../app/balance/balance-main.js');
    for (const household of ['max-erika', 'renate']) {
        const f = fixture(household);
        delete f.records[DAILY_PRICES_KEY];
        const backend = { ...f.records };
        P.resetPersistenceForTests({ name: 'mh-1b-memory', async loadAll() { return { ...backend }; },
            async saveBatch({ deletes, upserts }) { deletes.forEach(key => delete backend[key]); Object.assign(backend, Object.fromEntries(upserts)); } });
        await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const initial = await main.init();
        assert(initial.ok, household + ': echter Balance-Start erfolgreich: ' + (initial.error?.message || ''));
        await initial.overviewPersistence;
        setAppTestDate('2026-10-30');
        const baseline = main.update({ mode: 'preview' });
        assert(baseline.ok, household + ': Basis-Update erfolgreich');
        assertEqual(await baseline.overviewPersistence, true, household + ': Basis-Summary dauerhaft gespeichert');
        const summary = persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY);
        assertEqual(Object.values(readOverviewSummaries(summary))[0].status, 'fest', household + ': Jahresabschluss als Basis belegt');
        const summaries = () => Object.fromEntries(Object.entries(JSON.parse(persistenceStorage.getItem('rs_profiles_v1')).profiles)
            .map(([id, profile]) => [id, profile.data[OVERVIEW_SUMMARY_KEY]]));
        const registrySummaries = json(summaries());
        const marketFields = Object.fromEntries(Object.keys(inputs).map(key => [key, document.getElementById(key).value]));
        for (const price of [170, 80]) {
            persistenceStorage.setItem(DAILY_PRICES_KEY, json(prices([['2026-07-14', 200], ['2026-10-30', price]])));
            const current = main.update({ mode: 'preview' });
            assert(current.ok, household + ': Tageskurs-Update erfolgreich');
            assertEqual(await current.overviewPersistence, true, household + ': Tageskurs-Summary bestätigt');
            assertEqual(current.modelResult.input.endeVJ, price, household + ': Balance-Anzeige verwendet Tageskurs ' + price);
            assert(current.modelResult.ui.market.sKey !== baseline.modelResult.ui.market.sKey, household + ': Tageskurs ändert tatsächlich die Marktphase');
            assertEqual(persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY), summary, household + ': rs_overview_summary bytegleich bei Kurs ' + price);
            assertEqual(json(summaries()), registrySummaries, household + ': Summarykopien aller Profile bytegleich bei Kurs ' + price);
            assertEqual(backend[OVERVIEW_SUMMARY_KEY], summary, household + ': bestätigter Backendread bytegleich');
            const entry = Object.values(readOverviewSummaries(summary))[0];
            assertEqual(entry.marketPhase, baseline.modelResult.ui.market.szenarioText, household + ': Marktphase aus Jahresbasis');
            assertEqual(json(Object.fromEntries(Object.keys(inputs).map(key => [key, document.getElementById(key).value]))), json(marketFields), household + ': Jahresmarktdaten unverändert');
            if (price === 80) {
                assert(current.modelResult.ui.spending.monatlicheEntnahme !== baseline.modelResult.ui.spending.monatlicheEntnahme,
                    household + ': Gegenprobe mit tatsächlich abweichender Entnahme');
                assert(json(current.modelResult.ui.action) !== json(baseline.modelResult.ui.action), household + ': Gegenprobe mit tatsächlich abweichender Aktion');
            }
        }
        UIReader.planFormSource = null;
        P.resetPersistenceRuntimeForTests();
    }
} finally {
    restoreLocks();
    P.resetPersistenceRuntimeForTests();
    setAppTestDate(savedDate);
    console.error = savedError; console.info = savedInfo;
    for (const [key, descriptor] of Object.entries(savedGlobals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
}
