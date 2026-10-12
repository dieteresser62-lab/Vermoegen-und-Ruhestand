import { prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { createBalancePageFixture } from './helpers/balance-page-fixture.mjs';
import { annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { initUIRenderer } from '../app/balance/balance-renderer.js';
import { balanceStorageFixture, installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { commitAnnualPlanUpdate } from '../app/balance/balance-annual-storage-commit.js';
import { createManualAnnualQuote } from '../app/balance/balance-annual-marketdata.js';
import { HOUSEHOLD_PLAN_KEY, readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { EngineAPI } from '../engine/index.mjs';
import { buildSnapshotRestorePlan } from '../app/shared/snapshot-restore.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { createAnnualOrchestrator } from './helpers/balance-legacy-annual-handlers.mjs';
import { createInflationHandlers } from '../app/balance/balance-annual-inflation.js';
import { createMarketdataHandlers } from '../app/balance/balance-annual-marketdata.js';
import {
    ANNUAL_PERIOD_METADATA_KEY,
    createSnapshotHandlers, consumeAnnualRetry, validateAnnualRetry, ANNUAL_RETRY_SESSION_KEY
} from '../app/balance/balance-binder-snapshots.js';
import {
    ANNUAL_PERIOD_STATUS,
    createAnnualPeriodPlan,
    LEGACY_PERIOD_DECISION,
    deriveCompletedCalendarYear
} from '../app/balance/balance-annual-period.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { PersistenceFacade, persistenceStorage, resetPersistenceRuntimeForTests } from '../app/shared/persistence-facade.js';
import { createBalanceWealthHistoryService } from '../app/balance/balance-wealth-history.js';
import { createManualWealthHistoryEntry } from '../types/wealth-history-contract.js';
import { createBalanceExportDocument } from '../app/balance/balance-binder-imports.js';
import { PROFILE_STORAGE_KEYS, PROFILE_VALUE_KEYS } from '../app/profile/profile-state.js';
import { UIBinder, initUIBinder, preserveUIBinderStateForTests } from '../app/balance/balance-binder.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { BALANCE_UPDATE_MODE } from '../app/balance/balance-update-pipeline.js';
import { OVERVIEW_MONTH_KEY, readMonthProvision } from '../app/overview/overview-storage.js';

console.log('--- Balance Annual Workflow Contract Tests ---');

const REFERENCE_DATE = new Date(2027, 0, 15, 12);
const TARGET_YEAR = deriveCompletedCalendarYear(REFERENCE_DATE);
const SOURCE = { tagesgeld: 12000.25, geldmarktEtf: 23000.5, depotwertAlt: 34000.75, depotwertNeu: 45000.125 };
const COMMIT_RESULT = { ok: true, inputData: SOURCE, modelResult: { newState: { tagesgeld: 1, geldmarktEtf: 2, depotwertAlt: 3, depotwertNeu: 4 } } };
const NEXT_YEAR = TARGET_YEAR + 1;

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

function seedBalanceState() {
    resetPersistenceRuntimeForTests();
    localStorage.setItem('profile_person_schema_version', '1');
    localStorage.setItem('profile_aktuelles_alter', '67');
    localStorage.setItem(PROFILE_STORAGE_KEYS.current, 'a');
    localStorage.setItem(PROFILE_STORAGE_KEYS.active, 'a');
    localStorage.setItem(PROFILE_STORAGE_KEYS.registry, JSON.stringify({ version: 1, profiles: {
        a: { meta: { id: 'a', name: 'A' }, data: {} },
        b: { meta: { id: 'b', name: 'B' }, data: { [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ wealthHistory: { schemaVersion: 1, entries: [createManualWealthHistoryEntry(SOURCE, '2026-02-01')] } }) } }
    } }));
    localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({
        inputs: { aktuellesAlter: 67, floorBedarf: 24000 },
        lastState: { cumulativeInflationFactor: 1 }
    }));
}

function createAnnualDom() {
    return {
        inputs: {
            profilName: { value: `Jahr ${TARGET_YEAR}` },
            aktuellesAlter: { value: '67' }
        },
        expenses: { yearSelect: { value: String(TARGET_YEAR) } },
        outputs: { snapshotList: null },
        controls: {
            btnJahresUpdate: { disabled: false, innerHTML: 'Jahres-Update' },
            btnJahresUpdateLog: { disabled: true }
        }
    };
}

let approveSnapshot = true;
const previous = {
    fetch: global.fetch,
    localStorage: global.localStorage,
    confirm: global.confirm,
    setTimeout: global.setTimeout,
    toast: UIRenderer.toast,
    handleError: UIRenderer.handleActionError,
    clearActionError: UIRenderer.clearActionError,
    createSnapshot: StorageManager.createSnapshot,
    listSnapshots: SnapshotArchive.listSnapshots,
    readSnapshot: SnapshotArchive.readSnapshot,
    document: globalThis.document, window: globalThis.window, testDate: getAppTestDate(),
    annual: UIBinder.handleJahresabschluss, expenses: UIBinder.openExpensesYear, tab: UIBinder.selectTab,
    restoreBinder: preserveUIBinderStateForTests()
};

const restoreLocks = installAnnualLocks();
try {
    // Initialer Übersichtslink: echte Seite, produktive Bindung und produktiver Speichercommit.
    for (const action of ['cancel', 'commit']) {
        console.log(`Initialer Jahreslink mit gespeichertem Folgejahr: ${action}`);
        const restoreBinder = preserveUIBinderStateForTests();
        const oldDate = getAppTestDate();
        const NativeDate = globalThis.Date, oldFetch = globalThis.fetch;
        const { records } = balanceStorageFixture('Einzelprofil');
        const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
        state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
        records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
        const years = {
            '2026': { months: { '12': { profiles: { muster_a: { categories: { wohnen: 1234 }, total: 1234 } } } } },
            '2027': { months: { '1': { profiles: { muster_a: { categories: { wohnen: 2345 }, total: 2345 } } } } }
        };
        const expensesRaw = JSON.stringify({ version: 1, activeYear: NEXT_YEAR, years });
        records.balance_expenses_v1 = expensesRaw;
        const registry = JSON.parse(records.rs_profiles_v1);
        Object.assign(registry.profiles.muster_a.data, { [CONFIG.STORAGE.LS_KEY]: records[CONFIG.STORAGE.LS_KEY], balance_expenses_v1: expensesRaw });
        records.rs_profiles_v1 = JSON.stringify(registry);
        const live = annualRecordStorage(records);
        const page = createBalancePageFixture({ storage: live, url: `https://example.test/Balance.html?year=${TARGET_YEAR}#jahresabschluss` });
        let binding;
        const settleUntil = async predicate => {
            for (let turn = 0; turn < 500; turn++) {
                if (predicate()) return;
                await new Promise(resolve => setTimeout(resolve, 2));
            }
            throw new Error('Initialer Jahreslink erreicht den erwarteten Seiten-/Dialogzustand nicht: ' + page.doc.body.textContent);
        };
        try {
            setAppTestDate(null);
            globalThis.Date = class extends NativeDate {
                constructor(...args) { super(...(args.length ? args : ['2027-01-02T12:00:00Z'])); }
                static now() { return new NativeDate('2027-01-02T12:00:00Z').getTime(); }
                static [Symbol.hasInstance](value) { return value instanceof NativeDate; }
            };
            globalThis.fetch = async value => {
                const url = new URL(value);
                const response = payload => ({ ok: true, headers: { get: () => null }, json: async () => payload });
                if (url.hostname === 'data-api.ecb.europa.eu') return response({});
                if (url.hostname === 'api.worldbank.org') return response([{ lastupdated: '2027-01-01' }, [{
                    indicator: { id: 'FP.CPI.TOTL.ZG' }, countryiso3code: 'DEU', date: '2026', value: 2.14
                }]]);
                if (url.hostname === '127.0.0.1' && url.pathname === '/chart') return response({ chart: { result: [{
                    meta: { symbol: 'VWCE.DE', currency: 'EUR', exchangeTimezoneName: 'Europe/Berlin' },
                    timestamp: [Math.floor(Date.UTC(2026, 11, 30) / 1000)], indicators: { quote: [{ close: [160.2] }] }
                }] } });
                if (url.hostname === 'r.jina.ai') return { ok: true, text: async () => '2026.12 100 28.55' };
                throw new Error('Unerwarteter Abruf in der Seitenprobe: ' + url.href);
            };
            page.win.EngineAPI = EngineAPI;
            PersistenceFacade.resetPersistenceForTests(createLocalStorageAdapter(live));
            await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
            // Eigene Modulinstanz bindet ihre DOMreferenzen an diese frische Seite.
            const main = await import(`../app/balance/balance-main.js?initial-annual-link=${action}`);
            const started = await main.init();
            assertEqual(started.ok, true, 'Produktiver Seitenstart liefert eine gültige Erstvorschau');
            binding = preserveUIBinderStateForTests();
            await prepareCloseFixture(page.doc);
            await settleUntil(() => page.doc.getElementById('balanceAnnualClose')?.open
                && page.doc.getElementById('annualConfirmBtn')?.disabled === false);
            assertEqual(binding.handlers.getAnnualModel().occasion.annualState, 'open', 'Echter Überblick bietet die offene Abschlussperiode an');
            assertEqual(JSON.parse(persistenceStorage.getItem('balance_expenses_v1')).activeYear, NEXT_YEAR,
                'Initialer Link erhält die gespeicherte Ausgaben-Seitenansicht; der Dialog verwendet die Abschlussperiode');
            assertEqual(persistenceStorage.getItem('balance_expenses_v1'), expensesRaw, 'Initialer Link bewahrt die Folgejahr-Auswahlrohbytes vor Bestätigung');
            assertEqual((await SnapshotArchive.listSnapshots()).length, 0, 'Initialer Link legt vor Bestätigung keinen Jahressnapshot an');
            assertEqual(StorageManager.loadState().annualPeriodMetadata.pendingCommit, null, 'Initialer Link beginnt keinen Pendingcommit');
            if (action === 'cancel') {
                await page.doc.getElementById('annualCloseBtn').fire('click');
                await settleUntil(() => !binding.handlers.closeCoordinator.active && !binding.dom.controls.jahresabschlussBtn.disabled);
                assertEqual(persistenceStorage.getItem('balance_expenses_v1'), expensesRaw, 'Linkabbruch bewahrt sämtliche Ausgabenrohbytes');
                assertEqual((await SnapshotArchive.listSnapshots()).length, 0, 'Linkabbruch erzeugt keinen Jahressnapshot');
                assertEqual(persistenceStorage.getItem(ANNUAL_PLAN_RECORD_KEY), records[ANNUAL_PLAN_RECORD_KEY] ?? null, 'Linkabbruch erzeugt keinen Jahresbeleg');
                const metadata = StorageManager.loadState().annualPeriodMetadata;
                assertEqual(metadata.pendingCommit, null, 'Linkabbruch bewahrt die offene Periode ohne Pendingcommit');
                assertEqual(metadata.lastCommittedPeriod, null, 'Linkabbruch bestätigt keine Periode');
            } else {
                await page.doc.getElementById('annualConfirmBtn').fire('click');
                await settleUntil(() => page.doc.getElementById('balanceAnnualClose')?.dataset.annualYearResult);
                assertEqual(page.doc.getElementById('balanceAnnualClose').dataset.annualYearResult, 'confirmed',
                    'Initialer Link bestätigt den produktiven Jahresabschluss statt incomplete_recovery');
                const persisted = await PersistenceFacade.readPersistedRecords();
                const metadata = JSON.parse(persisted[CONFIG.STORAGE.LS_KEY]).annualPeriodMetadata;
                assertEqual(metadata.lastCommittedPeriod, `calendar-year:${TARGET_YEAR}`, 'Persistenter Readback bestätigt die Kalenderperiode');
                assertEqual(metadata.pendingCommit, null, 'Persistenter Readback enthält keinen Recoverymarker');
                const expenses = JSON.parse(persisted.balance_expenses_v1);
                assertEqual(expenses.activeYear, NEXT_YEAR, 'Bereits gespeichertes Folgejahr wird nicht doppelt weitergestellt');
                assertEqual(JSON.stringify(expenses.years), JSON.stringify(years), 'Jahrescommit bewahrt Monats- und Kategoriedaten beider Jahre');
                assertEqual(binding.handlers.getAnnualModel().summary.year, NEXT_YEAR,
                    'Gemeinsame Abschlussprojektion zeigt das bestätigte Folgeplanjahr ohne Ausgaben-DOM');
                assert(!page.win.__profileRecoveryBlocker && !PersistenceFacade.hasSyncWriteBlocks(), 'Bestätigter Link erzeugt keinen Recoveryblocker');
                const points = await SnapshotArchive.listSnapshots();
                assertEqual(points.length, 2, 'Ein Hauptklick erzeugt getrennte Jahres- und Monatsvorabpunkte');
                assertEqual(points.filter(point => point.kind === 'annual-close-pre-mutation').length, 1, 'Jahresvorabpunkt bleibt einmalig');
                assertEqual(points.filter(point => point.kind === 'monthly-close-pre-mutation').length, 1, 'Monat erhält einen eigenen Vorabpunkt');
                const monthReceipt = readMonthProvision(persisted[OVERVIEW_MONTH_KEY], `${TARGET_YEAR}-12`, binding.handlers.getAnnualModel().scope);
                assert(monthReceipt, 'Initialer Jahreslink bestätigt auch Dezember dauerhaft ohne zweiten Klick');
                assert(page.doc.querySelector('[data-annual-combined-result="C"]'), 'Initialer Link zeigt den kombinierten Beleg');
                assert(persisted[ANNUAL_PLAN_RECORD_KEY], 'Produktiver Speichercommit schreibt den Jahresbeleg');
            }
        } finally {
            try {
                binding?.handlers.annual.closeAnnualModal();
                binding?.handlers.closeCoordinator.dispose();
                if (binding?.appState.debounceTimer) clearTimeout(binding.appState.debounceTimer);
                await PersistenceFacade.flush();
            } finally {
                initUIRenderer(null, null);
                restoreBinder();
                resetPersistenceRuntimeForTests();
                globalThis.Date = NativeDate;
                if (oldFetch === undefined) delete globalThis.fetch; else globalThis.fetch = oldFetch;
                setAppTestDate(oldDate);
                page.restore();
            }
        }
    }

    console.log('Test 1: Jahresupdate returns a stable result and reports step errors');
    {
        const calls = [];
        let modalResults = null;
        global.localStorage = createLocalStorageMock();
        seedBalanceState();
        localStorage.setItem('profile_tagesgeld', '50000');
        const confirmedTranches = JSON.stringify([{
            trancheId: 'annual-read-only-lot',
            name: 'Synthetischer Bestand',
            shares: 5,
            purchasePrice: 80,
            currentPrice: 100,
            category: 'equity',
            type: 'aktien_neu',
            tqf: 0.3
        }]);
        localStorage.setItem('depot_tranchen', confirmedTranches);
        global.setTimeout = (fn, delay) => { calls.push(`timeout:${delay}`); fn(); return 0; };
        UIRenderer.toast = () => {};
        UIRenderer.handleActionError = error => { throw error; };
        const dom = createAnnualDom();
        const inflationContract = {
            rate: 2.1,
            year: TARGET_YEAR,
            source: 'ECB (HICP)',
            dataAsOf: '2026-01-30T11:15:00Z',
            fetchStatus: 'ok_primary_ecb',
            metric: 'consumer_prices_all_items_annual_average_growth_pct'
        };
        const orchestrator = createAnnualOrchestrator({
            dom,
            debouncedUpdate: () => { calls.push('debouncedUpdate'); },
            handleFetchInflation: async () => { calls.push('inflation'); return inflationContract; },
            handleNachrueckenMitETF: async () => { calls.push('etf'); return { status: 'ok' }; },
            handleFetchCapeAuto: async () => ({
                capeFetchStatus: 'error_no_source_no_stored',
                errors: ['primary source failed']
            }),
            showUpdateResultModal: results => { modalResults = results; },
            setLastUpdateResults: () => {}
        });

        const resets = [];
        UIRenderer.clearActionError = scope => { resets.push(scope); };
        const result = await orchestrator.handleJahresUpdate({ failOnStepError: true });
        assertEqual(resets.join(','), 'annual', 'Direkter Jahresupdate bereinigt nur einmal den Annualbereich');
        assertEqual(result.ok, false, 'Fehlerhafter Teilschritt liefert explizit ok=false');
        assertEqual(dom.inputs.aktuellesAlter.value, '67', 'Jahresupdate projiziert festen Altalter-Fallback');
        assertEqual(localStorage.getItem(PROFILE_VALUE_KEYS.alter), '67', 'Jahresupdate schreibt kein Profilalter');
        assertEqual(result.results.inflation.year, TARGET_YEAR, 'Jahresupdate bewahrt das Inflations-Zieljahr');
        assertEqual(result.results.inflation.fetchStatus, 'ok_primary_ecb', 'Jahresupdate bewahrt den Inflations-Fetch-Status');
        assertEqual(modalResults.errors[0].step, 'CAPE', 'Fehlerprotokoll behaelt stabilen Step-Namen');
        assertEqual(dom.controls.btnJahresUpdate.disabled, false, 'Button-Sperre wird im finally geloest');
        assertEqual(localStorage.getItem('depot_tranchen'), confirmedTranches,
            'Beratendes Jahresupdate darf den realen Tranchenbestand nicht veraendern');
        resets.length = 0;
        await orchestrator.handleJahresUpdate({ failOnStepError: true, nested: true });
        assertEqual(resets.length, 0, 'Verschachtelter Jahresupdate bereinigt keine bereits entstandenen Jahresfehler');
        UIRenderer.clearActionError = previous.clearActionError;

    }

    // Der echte neue Fachwrite ersetzt die bisherigen getrennten Handler-Mocks.
    async function annualFixture(overrides = {}) {
        setAppTestDate('2027-01-02');
        const { records } = balanceStorageFixture('Einzelprofil');
        const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
        state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
        records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
        records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
        global.localStorage = createLocalStorageMock();
        for (const [key, raw] of Object.entries(records)) localStorage.setItem(key, raw);
        PersistenceFacade.resetPersistenceForTests(createLocalStorageAdapter(localStorage));
        await PersistenceFacade.init({ installLifecycleHooks: false });
        SnapshotArchive.listSnapshots = previous.listSnapshots;
        SnapshotArchive.readSnapshot = previous.readSnapshot;
        const dom = createAnnualDom();
        const marketData = { inflation: { rate: 2.14, year: TARGET_YEAR, source: 'ECB (HICP)', dataAsOf: '2027-01-01',
            fetchStatus: 'ok_primary_ecb', metric: 'consumer_prices_all_items_annual_average_growth_pct' },
            etf: { price: 160.2, date: new Date('2026-12-31'), asOf: '2026-12-31', ticker: 'VWCE.DE', source: 'Test', targetYear: TARGET_YEAR },
            cape: { capeRatio: 28.55, capeAsOf: '2026-12-01', capeSource: 'yale_ie_data_xls', capeFetchStatus: 'ok_primary', capeUpdatedAt: '2027-01-02T12:00:00Z' } };
        const calls = [], reports = [], session = createLocalStorageMock();
        const handlers = createSnapshotHandlers({ dom, appState: {}, getReferenceDate: () => new Date('2027-01-02T12:00:00Z'),
            engineLoader: { load: async () => EngineAPI },
            confirmAnnual: async () => ({}), decide: async () => true, validateLiveState: () => { calls.push('preflight'); return { ok: true }; },
            flushLiveState: () => PersistenceFacade.flush(), reportAnnualError: (error, action) => reports.push({ error, action }),
            sessionStore: () => session, reload: () => { calls.push('reload'); },
            runAnnualUpdate: async options => {
                calls.push('prepare');
                return { ok: true, marketData: { ...marketData, etf: options.manualPrice === undefined ? marketData.etf
                    : createManualAnnualQuote(options.manualPrice, `calendar-year:${TARGET_YEAR}`) }, results: { ...marketData, errors: [] } };
            },
            commitLiveState: async options => { calls.push('commit'); return commitAnnualPlanUpdate({ ...options, engineApi: EngineAPI, now: () => new Date('2027-01-02T12:00:00Z') }); },
            projectAnnualState: () => {
                const state = StorageManager.loadState();
                dom.expenses.yearSelect.value = '2027';
                for (const key of ['endeVJ', 'endeVJ_1', 'ath', 'inflation']) dom.inputs[key] = { value: String(state.inputs[key]) };
                dom.inputs.floorBedarf = { value: String(readBalanceHouseholdPlan().entry.values.floorBedarf) };
                dom.inputs.aktuellesAlter.value = '68';
            }, ...overrides });
        return { handlers, dom, calls, reports, records, session, marketData };
    }
    console.log('Test 2: gemeinsamer Fachwrite bestätigt Beleg, Plan, Verlauf und Periode');
    {
        UIRenderer.toast = () => {};
        const env = await annualFixture();
        delete env.dom.outputs.snapshotList;
        delete env.dom.controls.snapshotStatus;
        const result = await env.handlers.handleJahresabschluss({ confirmedPreparation: {} });
        assertEqual(result.status, 'already_committed', 'Echter Speicherabschluss bestätigt die Jahresperiode');
        assertEqual(StorageManager.loadState().annualPeriodMetadata.pendingCommit, null, 'Fachwrite entfernt Recoverymarker');
        assertEqual(JSON.parse(persistenceStorage.getItem(ANNUAL_PLAN_RECORD_KEY)).entries[JSON.stringify([2027, readBalanceHouseholdPlan().scope.key])].periodId,
            'calendar-year:2026', 'Gemeinsamer Fachwrite bestätigt den Jahresbeleg für das folgende Planungsjahr');
        assertEqual(StorageManager.loadState().wealthHistory.entries.filter(item => item.id === 'annual:2026').length, 1, 'Genau ein tatsächlicher Jahresendstand');
        assertEqual(env.reports.length, 0, 'Bestätigter Jahresabschluss ohne Balance-Liste meldet keinen Fehler');
        assertEqual((await SnapshotArchive.listSnapshots()).length, 1, 'Genau ein bestätigter Vorabschluss-Snapshot');
        env.dom.expenses.yearSelect.value = '2026';
        const receiptBytes = persistenceStorage.getItem(ANNUAL_PLAN_RECORD_KEY);
        assertEqual((await env.handlers.handleJahresabschluss()).status, 'already_committed', 'Wiederholung ist ein No-op');
        assertEqual(persistenceStorage.getItem(ANNUAL_PLAN_RECORD_KEY), receiptBytes, 'No-op erhält die Belegbytes');
        assertEqual(env.calls.filter(call => call === 'commit').length, 1, 'No-op startet keine zweite Jahresrechnung');
    }
    console.log('Test 3: fehlgeschlagene Vorprüfung bleibt ohne Snapshot und Fachwrite');
    {
        const env = await annualFixture({ validateLiveState: () => ({ ok: false, error: new Error('invalid inputs') }) });
        const before = JSON.stringify(await PersistenceFacade.readPersistedRecords());
        assertEqual((await env.handlers.handleJahresabschluss()).status, 'invalid', 'Vorprüfungsfehler bricht vor Jahresbeginn ab');
        assertEqual(JSON.stringify(await PersistenceFacade.readPersistedRecords()), before, 'Vorprüfungsfehler erhält sämtliche Rohbytes');
        assertEqual((await SnapshotArchive.listSnapshots()).length, 0, 'Vorprüfungsfehler erstellt keinen Snapshot');
    }
    console.log('Test 4: fehlgeschlagene Snapshotsicherung bleibt ohne Fachwrite');
    {
        const env = await annualFixture({ createAnnualSnapshot: async () => { throw new Error('QuotaExceededError'); } });
        assertEqual((await env.handlers.handleJahresabschluss()).status, 'invalid', 'Snapshotfehler meldet keine Recovery eines nicht gestarteten Abschlusses');
        assertEqual(env.calls.filter(call => call === 'prepare' || call === 'commit').length, 0, 'Snapshotfehler verhindert Vorbereitung und Fachwrite');
    }
    console.log('Test 5: Abruffehler, geschützter Restore und Handkurs-Wiederaufnahme');
    {
        let fail = true;
        const recoveryTargets = [];
        const env = await annualFixture({ openRecovery: id => recoveryTargets.push(id), runAnnualUpdate: async options => {
            if (fail) return { ok: false, results: { errors: [{ step: 'ETF & Nachrücken', error: 'Synthetischer ETF-Ausfall' }] } };
            return { ok: true, marketData: { ...env.marketData, etf: createManualAnnualQuote(options.manualPrice, `calendar-year:${TARGET_YEAR}`) }, results: { errors: [] } };
        } });
        const beforePlan = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
        const result = await env.handlers.handleJahresabschluss();
        assertEqual(result.status, 'incomplete_recovery', 'Abruffehler bewahrt den Snapshot als Recoverypunkt');
        assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), beforePlan, 'Abruffehler skaliert den Plan nicht');
        assertEqual(persistenceStorage.getItem(ANNUAL_PLAN_RECORD_KEY), null, 'Abruffehler erzeugt keinen Beleg');
        assertEqual(StorageManager.loadState().annualPeriodMetadata.pendingCommit.phase, 'writes_started', 'Recoverymarker zeigt die letzte bestätigte Phase');
        assert(result.retryContext.snapshotId, 'ETF-Ausfall bietet den ursprünglichen Snapshot für Handkursfortsetzung');
        assertEqual(env.reports.length, 1, 'Jahresfehler wird genau einmal gemeldet');
        env.reports[0].action.onActivate();
        assertEqual(recoveryTargets[0], result.retryContext.snapshotId, 'Recovery-Folgeaktion übergibt die bestätigte ursprüngliche Kennung');
        assertEqual((await env.handlers.handleJahresabschluss()).status, 'incomplete_recovery', 'Pending-Commit verhindert Wiederholung ohne Restore');
        const restore = StorageManager.restoreSnapshot;
        StorageManager.restoreSnapshot = async (id, handle, options) => {
            const point = await SnapshotArchive.readSnapshot(id);
            const plan = buildSnapshotRestorePlan(point, await PersistenceFacade.readPersistedRecords());
            await PersistenceFacade.replaceRecordsTransactional(plan.records, { allowKey: plan.allowKey });
            await options.reload(); return { status: 'restored' };
        };
        try {
            assertEqual((await env.handlers.retryAnnualWithManualPrice(result.retryContext, 160.4)).status, 'restored', 'Handkursfortsetzung schreibt erst den ursprünglichen Snapshot zurück');
            const request = consumeAnnualRetry(env.session);
            assertEqual(consumeAnnualRetry(env.session), null, 'Tabgebundener Auftrag wird genau einmal konsumiert');
            assert(await validateAnnualRetry(request, { dom: env.dom, getReferenceDate: () => new Date('2027-01-02') }), 'Wiederhergestellte Quellen passen zum Fortsetzungsauftrag');
            fail = false;
            assertEqual((await env.handlers.handleJahresabschluss({ resume: request })).status, 'already_committed', 'Handkurs-Wiederaufnahme bestätigt den Jahresabschluss');
            assertEqual(env.dom.inputs.floorBedarf.value, '30642', 'Bedarf wird nach Restore genau einmal inflationiert');
            assertEqual(env.dom.inputs.endeVJ_1.value, '143', 'Nachrückkette wird nach Restore genau einmal gedreht');
            assertEqual(StorageManager.loadState().annualMarketDataMeta.source, 'Manueller Schlusskurs', 'Marktherkunft weist den Handkurs aus');
            assertEqual((await SnapshotArchive.listSnapshots()).length, 1, 'Wiederaufnahme verwendet denselben Vorabschluss-Snapshot');
        } finally { StorageManager.restoreSnapshot = restore; }
    }
    console.log('Test 6: Doppelklick während der Vorbereitung startet nur einen Abschluss');
    {
        let release, entered;
        const reached = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        const env = await annualFixture({ runAnnualUpdate: async () => { entered(); await gate; return { ok: true, marketData: env.marketData, results: { errors: [] } }; } });
        const first = env.handlers.handleJahresabschluss(); await reached;
        assertEqual((await env.handlers.handleJahresabschluss()).status, 'in_flight', 'Doppelklick während Vorbereitung wird abgefangen');
        release();
        assertEqual((await first).status, 'already_committed', 'Erster Aufruf bestätigt denselben Abschluss');
        assertEqual(env.calls.filter(call => call === 'commit').length, 1, 'Doppelklick erzeugt genau einen Fachwrite');
    }

    setAppTestDate(previous.testDate);
    console.log('Test 7: interne Direktabrufe werden im verschachtelten Jahresupdate als Schrittfehler erfasst');
    for (const step of ['Inflation', 'ETF & Nachrücken']) {
        global.localStorage = createLocalStorageMock();
        seedBalanceState();
        const state = StorageManager.loadState();
        state[ANNUAL_PERIOD_METADATA_KEY] = {
            schemaVersion: 1,
            lastCommittedPeriod: null,
            pendingCommit: {
                periodId: 'calendar-year:2025',
                phase: 'writes_started',
                snapshotId: 'snapshot-2025'
            }
        };
        StorageManager.saveState(state);
        // Nur die UX-Pause überspringen; der zurückgehaltene ETF-Fetch behält seinen echten Timeout.
        global.setTimeout = (fn, delay, ...args) => {
            if (delay === 500) { fn(...args); return 0; }
            return previous.setTimeout(fn, delay, ...args);
        };
        UIRenderer.toast = () => {};
        let annualError = null;
        const resets = [];
        UIRenderer.clearActionError = scope => { resets.push(scope); annualError = null; };
        UIRenderer.handleActionError = error => { annualError = error.message; };

        const dom = createAnnualDom();
        for (const [key, value] of Object.entries({
            inflation: '2', floorBedarf: '1000',
            endeVJ: '120', endeVJ_1: '110', endeVJ_2: '100', endeVJ_3: '90',
            ath: '150', jahreSeitAth: '2'
        })) dom.inputs[key] = { value };
        dom.controls.btnFetchInflation = { disabled: false, innerHTML: 'Inflation abrufen' };
        dom.controls.btnNachrueckenMitETF = { disabled: false, innerHTML: 'ETF abrufen' };
        dom.controls.btnUndoNachruecken = { style: { display: 'none' } };

        let releaseFetch;
        const fetchGate = new Promise(resolve => { releaseFetch = resolve; });
        let fetchCalls = 0;
        const fetchImpl = () => { fetchCalls += 1; return fetchGate; };
        global.fetch = fetchImpl;
        const inflation = createInflationHandlers({
            dom, update: () => {}, debouncedUpdate: () => {}, fetchImpl,
            now: () => new Date('2026-07-14T10:00:00Z'),
            setTimeoutImpl: () => 1, clearTimeoutImpl: () => {}
        });
        const marketdata = createMarketdataHandlers({
            dom, appState: {}, debouncedUpdate: () => {}, applyAnnualInflation: () => {}
        });
        const isInflation = step === 'Inflation';
        const directHandler = isInflation ? inflation.handleFetchInflation : marketdata.handleNachrueckenMitETF;
        const button = isInflation ? dom.controls.btnFetchInflation : dom.controls.btnNachrueckenMitETF;
        const originalText = button.innerHTML;
        const orchestrator = createAnnualOrchestrator({
            dom, debouncedUpdate: () => {},
            handleFetchInflation: isInflation ? directHandler : async () => ({ rate: 2, year: 2025 }),
            handleNachrueckenMitETF: isInflation ? async () => ({ price: 140 }) : directHandler,
            handleFetchCapeAuto: async () => ({ capeFetchStatus: 'ok_primary' }),
            showUpdateResultModal: () => {}, setLastUpdateResults: () => {}
        });

        const first = directHandler();
        try {
            assertEqual(fetchCalls, 1, `${step}: Direktabruf läuft mit genau einem Fetch`);
            assertEqual(resets.join(','), 'annual', `${step}: Nur der erste Direktabruf bereinigt den Annualbereich`);
            annualError = 'Bestehender Annualfehler';
            assertEqual(await directHandler(), undefined, `${step}: Interne Sperre behält ihre leere Rückgabe`);
            let nestedError;
            try { await directHandler({ nested: true }); } catch (error) { nestedError = error; }
            assertEqual(nestedError?.context?.code, isInflation ? 'inflation_fetch_in_flight' : 'etf_fetch_in_flight',
                `${step}: Interner nested-Fehler behält seinen Code`);
            assertEqual(fetchCalls, 1, `${step}: Paralleler interner Direktaufruf startet keinen zweiten Fetch`);
            assertEqual(annualError, 'Bestehender Annualfehler', `${step}: Paralleler interner Direktaufruf erhält den Annualfehler`);

            const result = await orchestrator.handleJahresUpdate({ failOnStepError: true, nested: true });
            assertEqual(result.ok, false, `${step}: Laufender Direktabruf verhindert ein erfolgreiches Jahresupdate`);
            assertEqual(result.results.errors.length, 1, `${step}: Genau der blockierte Schritt wird als Fehler erfasst`);
            assertEqual(result.results.errors[0].step, step, `${step}: Fehlerprotokoll benennt den blockierten Schritt`);
            assert(result.results.errors[0].error.includes('Abruf läuft bereits'), `${step}: Schrittfehler benennt den laufenden Abruf`);
            assertEqual(result.results[isInflation ? 'inflation' : 'etf'], null, `${step}: Blockierter Schritt liefert kein scheinbares Ergebnis`);
            assertEqual(annualError, 'Bestehender Annualfehler', `${step}: Verschachtelter Aufruf erhält den Annualfehler`);
            assertEqual(resets.length, 1, `${step}: Jahresupdate bereinigt den Fehler nicht erneut`);
            await directHandler();
            assertEqual(fetchCalls, 1, `${step}: Abgewiesener Jahresschritt löst die Direktabrufsperre nicht`);
            assertEqual(button.disabled, true, `${step}: Direktabruf bleibt bis zum Fetch-Ende gesperrt`);
            assertEqual(dom.inputs.floorBedarf.value, '1000', `${step}: Zurückgehaltener Abruf ändert keinen Bedarf`);
            assertEqual(dom.inputs.endeVJ.value, '120', `${step}: Zurückgehaltener Abruf rückt keine Kurse nach`);
        } finally {
            const payload = isInflation ? {
                header: { prepared: '2026-01-30T11:15:00Z' },
                structure: { dimensions: {
                    series: Object.entries({
                        FREQ: 'A', REF_AREA: 'DE', ADJUSTMENT: 'N',
                        ICP_ITEM: '000000', DATA_PROVIDER: '4D0', ICP_SUFFIX: 'AVR'
                    }).map(([id, value]) => ({ id, values: [{ id: value }] })),
                    observation: [{ id: 'TIME_PERIOD', values: [{ id: '2025' }] }]
                } },
                dataSets: [{ series: { '0:0:0:0:0:0': { observations: { 0: [2.2] } } } }]
            } : {
                chart: { result: [{
                    timestamp: [Date.parse('2025-12-30T16:30:00Z') / 1000],
                    indicators: { quote: [{ close: [140.4] }] }
                }] }
            };
            releaseFetch({ ok: true, headers: { get: () => null }, json: async () => payload });
            const directResult = await first;
            assertEqual(directResult[isInflation ? 'year' : 'targetYear'], 2025, `${step}: Ursprünglicher Direktabruf liefert sein gültiges Ergebnis`);
        }
        assertEqual(button.disabled, false, `${step}: Erst der beendete Direktabruf löst die Knopfsperre`);
        assertEqual(button.innerHTML, originalText, `${step}: Knopfbeschriftung wird wiederhergestellt`);
        await directHandler();
        assertEqual(fetchCalls, 2, `${step}: Nach Abschluss ist ein neuer Direktabruf möglich`);
        assertEqual(resets.length, 2, `${step}: Neuer ausführbarer Direktabruf bereinigt seinen Fehlerbereich`);
    }

    console.log('Interner Orchestratorvertrag: Start, CAPE-Warnung, Erfolg und Reentranz');
    for (const capeFetchStatus of ['ok_primary', 'ok_fallback_mirror', 'ok_fallback_stored', 'warn_stale_source', '']) {
        global.localStorage = createLocalStorageMock();
        seedBalanceState();
        global.setTimeout = fn => { fn(); return 0; };
        const toasts = [];
        UIRenderer.toast = (text, type = true) => { toasts.push({ text, type }); };
        let releaseInflation;
        const gate = new Promise(resolve => { releaseInflation = resolve; });
        const orchestrator = createAnnualOrchestrator({
            dom: createAnnualDom(), debouncedUpdate: () => {},
            handleFetchInflation: () => gate,
            handleNachrueckenMitETF: async () => ({ price: 140 }),
            handleFetchCapeAuto: async () => ({ capeFetchStatus, capeAsOf: '2026-12-31' }),
            showUpdateResultModal: () => { throw new Error('Unerwartetes Fehlermodal'); },
            setLastUpdateResults: () => {}
        });
        const first = orchestrator.handleJahresUpdate();
        assertEqual(toasts[0].text, 'Starte Jahres-Update...', 'Start bleibt wortgleich');
        assertEqual(toasts[0].type, 'info', 'Jahresupdate-Start ist Hinweis');
        const duplicate = await orchestrator.handleJahresUpdate();
        assertEqual(JSON.stringify(duplicate), JSON.stringify({ ok: false, status: 'in_flight' }),
            'Interne Orchestratorsperre behält ihre Rückgabe');
        assertEqual(toasts.length, 1, 'Abgewiesener interner Aufruf erzeugt keinen zusätzlichen Toast');
        releaseInflation({ rate: 2 });
        assertEqual((await first).ok, true, 'Hinweistyp ändert nicht das Jahresupdate-Ergebnis');
        assertEqual(toasts.length, 1, 'Abrufe melden keinen unbestätigten Periodenerfolg vor dem finalen Flush');
    }

    // Befund 2: Der echte alte Jahreslink darf an der fachlichen Deaktivierung nicht enden.
    console.log('Befund 2: vollständiger Vorjahreslink öffnet den Erstjahrhinweis');
    {
        global.localStorage = createLocalStorageMock();
        seedBalanceState();
        setAppTestDate('2026-01-02');
        const liveState = { annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null },
            wealthHistory: { schemaVersion: 1, entries: [createManualWealthHistoryEntry(SOURCE, '2026-01-01')] } };
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(liveState));
        const { doc } = createDialogFixture(); globalThis.document = doc; globalThis.window = {};
        const recoveryLinks = [];
        const createElement = doc.createElement.bind(doc);
        doc.createElement = tag => {
            const element = createElement(tag);
            if (tag === 'a') element.click = () => { recoveryLinks.push(element); };
            return element;
        };
        const node = id => { const value = doc.createElement('button'); value.id = id; doc.body.append(value); return value; };
        for (const id of ['opener', 'balanceNextAnnual']) node(id);
        const elements = { get: id => doc.getElementById(({ modalTitle: 'balanceAnnualCloseTitle', modalResults: 'annualResults', modalCloseBtn: 'annualCloseBtn' })[id] || id),
            delete: id => doc.getElementById(id)?.remove(), set: (id, value) => { value.id = id; doc.body.append(value); } };
        const text = root => dialogElements(root).map(node => node.textContent).join(' ');
        const dom = createAnnualDom();
        dom.controls.jahresabschlussBtn = elements.get('opener');
        elements.get('balanceNextAnnual').disabled = true;
        let snapshots = 0, fetches = 0, updates = 0, yearChanges = 0;
        const errors = [], tabs = [], running = [];
        UIRenderer.handleActionError = error => errors.push(error.message);
        global.fetch = async () => { fetches++; throw new Error('Unerwarteter Abruf'); };
        StorageManager.createSnapshot = async () => { snapshots++; throw new Error('Unerwarteter Snapshot'); };
        UIBinder.openExpensesYear = () => { yearChanges++; };
        UIBinder.selectTab = tab => { tabs.push(tab); };
        initUIBinder(dom, {}, () => { updates++; return { ok: true }; }, () => { updates++; });
        UIBinder.handleJahresabschluss = function(options) {
            const promise = previous.annual.call(this, options); running.push(promise); return promise;
        };
        const title = node('overviewFocusTitle'), otherFocus = node('otherFocus');
        const manual = preserveUIBinderStateForTests().handlers.manual;
        const withAnnual = manual.withAnnual.bind(manual);
        let releasePreparation, preparationReached;
        manual.withAnnual = execute => withAnnual(async () => {
            preparationReached();
            await new Promise(resolve => { releasePreparation = resolve; });
            return execute();
        });
        const target = new URL('https://example.test/Balance.html?year=2025#jahresabschluss');
        // Bereite Seite: vorhandene Startmigration vor dem Bedien-Messfenster abschließen.
        StorageManager.loadState();
        const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
        for (let attempt = 0; attempt < 4; attempt++) {
            // Normales Titelziel, fehlendes/verborgenes Ziel und expliziter sichtbarer Öffner.
            if (attempt === 1) elements.delete('overviewFocusTitle');
            else elements.set('overviewFocusTitle', title);
            title.hidden = attempt === 2;
            const reached = new Promise(resolve => { preparationReached = resolve; });
            doc.activeElement = elements.get('opener');
            const entryTarget = attempt === 1 ? new URL('https://example.test/Balance.html?year=2025#abschluss') : target;
            assertEqual(attempt === 3 ? UIBinder.openNextAnnual({ opener: otherFocus }) : UIBinder.openOverviewTarget(entryTarget, { ready: true }), true, 'Neuer und alter bereiter Vorjahreslink erreichen denselben geschützten Dialog');
            await reached;
            otherFocus.focus();
            assertEqual(Boolean(doc.getElementById('balanceAnnualClose')), false, 'Linkbarriere liegt vor der Dialogöffnung');
            assertEqual(UIBinder.openOverviewTarget(target, { ready: true }), false, 'Doppelter Linkaufruf bleibt bis zum Handlerende gesperrt');
            releasePreparation();
            assertEqual((await running.at(-1)).status, 'not_applicable', 'Vorjahreslink endet im geschützten Hinweisstatus');
            assertEqual(elements.get('modalTitle').textContent, 'Erster Jahresabschluss', 'Vorjahreslink erhält den Erstjahrhinweistitel');
            assert(text(elements.get('modalResults')).includes('Erstes Planungsjahr 2026 · erster Jahresabschluss Anfang 2027'), 'Vorjahreslink erhält denselben Hinweistext');
            assert(!/Jahresabschluss unvollständig|Kein neuer Jahresabschluss\./.test(text(elements.get('modalResults'))), 'Vorjahreslink erzeugt keinen Fehlerdialog');
            assert(elements.get('annualConfirmBtn').hidden && !elements.get('annualHandPriceGroup'), 'Vorjahreslink bietet keinen Abschluss und Handkurs');
            await elements.get('modalCloseBtn').fire('click');
            const expected = attempt === 0 ? title : attempt === 3 ? otherFocus : elements.get('opener');
            assertEqual(doc.activeElement, expected, 'Linkhinweis gibt Fokus trotz asynchroner Änderung an das sichtbare Eintrittsziel zurück');
            if (attempt === 0) assertEqual(title.tabIndex, -1, 'Überblickstitel ist programmatisch fokussierbar');
            assertEqual(Boolean(doc.getElementById('balanceAnnualClose')), false, 'Linkdialog ist nach Schließen verborgen');
            assert(!doc.activeElement?.closest('dialog'), 'Linkfokus liegt außerhalb des geschlossenen Dialogs');
            assertEqual(getPageNavigationGuard(doc).reasons().length, 0, 'Linkende gibt Laufzeitsperren frei');
            assertEqual(liveState.annualPeriodMetadata.pendingCommit, null, 'Link erzeugt keinen Periodencommit');
        }
        manual.withAnnual = withAnnual;
        title.hidden = false;
        assertEqual(snapshots + fetches + updates + yearChanges, 0, 'Link erzeugt keine Abrufe, Snapshots, Fachwrites oder Vorbereitung 2025');
        assertEqual(errors.length, 0, 'Link setzt keinen Fehlerstatus');
        assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, 'Link erhält sämtliche Speicherbytes');

        assertEqual(UIBinder.openOverviewTarget(target), false, 'Unbereite Seite öffnet keinen Hinweis');
        assertEqual(UIBinder.openOverviewTarget(new URL('https://example.test/Balance.html?year=2024#jahresabschluss'), { ready: true }), false, 'Fremdes Linkjahr bleibt ungültig');
        dom.controls.jahresabschlussBtn.disabled = true;
        assertEqual(UIBinder.openOverviewTarget(target, { ready: true }), false, 'Technisch gesperrter Kopfknopf bleibt gesperrt');
        dom.controls.jahresabschlussBtn.disabled = false;
        globalThis.window.__profileRecoveryBlocker = true;
        assertEqual(UIBinder.openOverviewTarget(target, { ready: true }), false, 'Profil-Recovery wird nicht übergangen');
        delete globalThis.window.__profileRecoveryBlocker;
        const releaseWrites = PersistenceFacade.blockSyncWrites([], 'Synthetische Sperre');
        try { assertEqual(UIBinder.openOverviewTarget(target, { ready: true }), false, 'Persistenzsperre verhindert den Hinweisweg'); }
        finally { releaseWrites(); }
        const guard = getPageNavigationGuard(doc);
        const lease = guard.register(Symbol('synthetic-commit'), { read: () => ({ phase: 'commit' }) });
        try { assertEqual(UIBinder.openNextAnnual(), false, 'Technischer Commit blockiert auch den direkten Überblickszugang'); }
        finally { lease.unregister(); }

        liveState.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2025', snapshotId: 'synthetic-recovery', phase: 'writes_started' };
        persistenceStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(liveState));
        const recoveryBefore = JSON.stringify(PersistenceFacade.exportAllSync().records);
        dom.containers = { tabButtons: { querySelector: () => 'strategy' } };
        assertEqual(UIBinder.openOverviewTarget(target, { ready: true }), false, 'Deaktivierter Überblicksknopf sperrt auch Pending-Recovery');
        elements.get('balanceNextAnnual').disabled = false;
        assertEqual(UIBinder.openOverviewTarget(target, { ready: true }), true, 'Pending-Recovery führt zur Sicherungsverwaltung');
        assertEqual(tabs.at(-1), 'strategy', 'Pending-Recovery öffnet den Recoveryweg statt des Hinweises');
        assertEqual(recoveryLinks.length, 1, 'Pending-Recovery bedient genau einen zentralen Verweis ohne alten DOM-Anker');
        assertEqual(recoveryLinks[0].getAttribute('href'), 'Daten-Sicherung.html?punkt=synthetic-recovery#wiederherstellung', 'Pending-Recovery übergibt die unveränderte Punkt-ID');
        assert(recoveryLinks[0].hasAttribute('data-profile-handoff') && recoveryLinks[0].getAttribute('data-profile-handoff-export') === 'false', 'Pending-Recovery verwendet geschützten lokalen Handoff');
        assert(!doc.getElementById('balanceRecoveryLink') && !recoveryLinks[0].parentNode, 'Recovery benötigt keinen entfernten Anker und hinterlässt keinen Ersatzlink');
        assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), recoveryBefore, 'Recoverynavigation erhält sämtliche Speicherbytes');
        assertEqual(running.length, 4, 'Sperren und Recovery starten keinen weiteren Jahreshandler');

        // Ab Anfang 2027 bleibt die echte Vorbereitung für Abschluss 2026 erreichbar.
        setAppTestDate('2027-01-02');
        liveState.annualPeriodMetadata.pendingCommit = null;
        persistenceStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(liveState));
        elements.get('balanceNextAnnual').disabled = true;
        assertEqual(UIBinder.openOverviewTarget(new URL('https://example.test/Balance.html?year=2026#jahresabschluss'), { ready: true }), false, 'Außerhalb des Erstjahrs bleibt ein deaktivierter Überblicksknopf gesperrt');
        elements.get('balanceNextAnnual').disabled = false;
        UIBinder.openExpensesYear = year => { yearChanges++; dom.expenses.yearSelect.value = String(year); };
        assertEqual(UIBinder.openOverviewTarget(new URL('https://example.test/Balance.html?year=2026#jahresabschluss'), { ready: true }), true, 'Folgejahr erreicht den Abschluss 2026');
        for (let turn = 0; turn < 200 && (!elements.get('annualConfirmBtn') || elements.get('annualConfirmBtn').disabled); turn++) await Promise.resolve();
        assertEqual(elements.get('modalTitle').textContent, 'Dezember und Jahr 2026 abschließen', 'Folgejahr zeigt den echten Vorbereitungsdialog');
        assertEqual(elements.get('annualConfirmBtn').hidden, false, 'Folgejahr bietet Bestätigung an');
        assertEqual(elements.get('annualConfirmBtn').disabled, true, 'Fehlender gemeinsamer Plan im Legacy-Doppel sperrt die Jahresbestätigung auch nach Marktdatenabruf');
        await elements.get('modalCloseBtn').fire('click');
        assertEqual((await running.at(-1)).status, 'cancelled', 'Vorbereitung lässt sich ohne Jahreswrites abbrechen');
        liveState.annualPeriodMetadata.lastCommittedPeriod = 'calendar-year:2026';
        persistenceStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(liveState));
        dom.expenses.yearSelect.value = '2026';
        assertEqual((await UIBinder.handleJahresabschluss()).status, 'already_committed', 'Bestätigte Periode behält ihren bestehenden Status');
        assert(!doc.getElementById('balanceAnnualClose'), 'Bestätigte Periode wird nicht als Erstjahr umgedeutet');
        liveState.annualPeriodMetadata.schemaVersion = 99;
        persistenceStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(liveState));
        assertEqual((await UIBinder.handleJahresabschluss()).status, 'invalid', 'Echter Periodenfehler bleibt ein Fehler');
        assertEqual(errors.length, 1, 'Echter Periodenfehler wird weiterhin gemeldet');
        assertEqual(Boolean(doc.getElementById('balanceAnnualClose')), false, 'Echter Periodenfehler öffnet keinen Erstjahrhinweis');
        UIBinder.handleJahresabschluss = previous.annual;
        UIBinder.openExpensesYear = previous.expenses;
        UIBinder.selectTab = previous.tab;
        if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
        if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
        setAppTestDate(previous.testDate);
    }
    // Normaljahr: produktive Bindungen, synthetische Weiterleitung und echte Vorbereitung.
    {
        global.localStorage = createLocalStorageMock();
        seedBalanceState();
        setAppTestDate('2027-01-02');
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({
            annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null },
            wealthHistory: { schemaVersion: 1, entries: [createManualWealthHistoryEntry(SOURCE, '2026-01-01')] }
        }));
        const restoreBinder = preserveUIBinderStateForTests();
        const { doc } = createDialogFixture();
        const listeners = new Map(), observers = new Map();
        const headEvents = [], running = [], focusAttempts = [], focusFailures = [], pending = new Set();
        const previousObserver = globalThis.MutationObserver;
        globalThis.document = doc; globalThis.window = {};
        globalThis.MutationObserver = class { constructor(callback) { this.callback = callback; } observe(target) { observers.set(target, this.callback); } };
        const nativeAdd = doc.addEventListener.bind(doc), nativeRemove = doc.removeEventListener.bind(doc);
        doc.addEventListener = (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); nativeAdd(type, fn); };
        doc.removeEventListener = (type, fn) => { listeners.get(type)?.delete(fn); nativeRemove(type, fn); };
        const emit = (type, event) => { for (const fn of [...listeners.get(type) || []]) fn(event); };
        const node = id => {
            const value = doc.createElement('button'); value.id = id; doc.body.append(value);
            let disabled = false;
            Object.defineProperty(value, 'disabled', { get: () => disabled, set(next) { disabled = Boolean(next); if (observers.has(value)) queueMicrotask(() => observers.get(value)?.()); } });
            value.dispatchClick = (isTrusted = false) => {
                if (value.disabled) return;
                const event = { target: value, currentTarget: value, isTrusted };
                if (id === 'jahresabschlussBtn') headEvents.push({ event, entryTarget: value });
                for (const fn of value.listeners.get('click') || []) fn(event);
                event.currentTarget = null;
            };
            value.click = () => value.dispatchClick(false);
            value.focus = () => { focusAttempts.push(value); if (!value.disabled) doc.activeElement = value; };
            return value;
        };
        for (const id of ['jahresabschlussBtn', 'btnJahresUpdate', 'balanceMarketUpdate', 'balanceNextAnnual', 'otherFocus', 'shiftedFocus']) node(id);
        const elements = { get: id => doc.getElementById(({ modalTitle: 'balanceAnnualCloseTitle', modalResults: 'annualResults', modalCloseBtn: 'annualCloseBtn' })[id] || id) };
        const dom = createAnnualDom();
        dom.containers = {}; dom.outputs = {};
        dom.controls = { jahresabschlussBtn: elements.get('jahresabschlussBtn'), btnJahresUpdate: elements.get('btnJahresUpdate') };
        let snapshots = 0, fetches = 0, updates = 0, periodCommits = 0;
        const errors = [];
        UIRenderer.handleActionError = error => errors.push(error.message);
        global.fetch = async () => { fetches++; throw new Error('Unerwarteter Fachabruf'); };
        StorageManager.createSnapshot = async () => { snapshots++; throw new Error('Unerwarteter Recovery-Snapshot'); };
        // Erforderliche Startmigrationen gehören nicht zum Bedien-Messfenster.
        StorageManager.loadState();
        initUIBinder(dom, {}, options => {
            updates++;
            if (options?.mode === BALANCE_UPDATE_MODE.COMMIT_PERIOD) periodCommits++;
            return { ok: true };
        }, () => { updates++; });
        UIBinder.handleJahresabschluss = function(options) {
            const promise = previous.annual.call(this, options);
            running.push(promise); pending.add(promise);
            promise.then(() => pending.delete(promise), () => pending.delete(promise));
            return promise;
        };
        const manual = preserveUIBinderStateForTests().handlers.manual;
        const withAnnual = manual.withAnnual.bind(manual);
        const settleUntil = async predicate => {
            for (let turn = 0; turn < 200; turn++) { if (predicate()) return; await Promise.resolve(); }
            throw new Error('Der echte Jahreshandler erreicht die erwartete Vorbereitungsphase nicht.');
        };
        const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
        try {
            UIBinder.bindUI();
            for (const access of ['balanceMarketUpdate', 'balanceNextAnnual', 'Alt+J', 'jahresabschlussBtn']) {
                console.log(`Normaljahr-Rückfokus: ${access}`);
                const expected = elements.get(access === 'Alt+J' ? 'otherFocus' : access);
                const eventsBefore = headEvents.length, runsBefore = running.length;
                // Der echte Kopfklick muss auch ohne vorherigen Kopfknopffokus funktionieren.
                (access === 'jahresabschlussBtn' ? elements.get('otherFocus') : expected).focus();
                if (access === 'Alt+J') {
                    let prevented = false;
                    emit('keydown', { altKey: true, key: 'j', preventDefault() { prevented = true; } });
                    assert(prevented, 'Der gebundene Alt+J-Handler verhindert die Standardaktion');
                } else if (access === 'jahresabschlussBtn') expected.dispatchClick(true);
                else expected.click();
                await settleUntil(() => doc.getElementById('balanceAnnualClose')?.open && running.length === runsBefore + 1);
                assertEqual(headEvents.length, eventsBefore + 1, `${access}: gebundener Pfad dispatcht genau ein Kopfereignis`);
                assertEqual(headEvents.at(-1).entryTarget, dom.controls.jahresabschlussBtn, `${access}: Kopfereignis enthält beim Eintritt currentTarget`);
                assertEqual(headEvents.at(-1).event.isTrusted, access === 'jahresabschlussBtn', `${access}: Ereignisherkunft bleibt getrennt vom Fokus`);
                assertEqual(headEvents.at(-1).event.currentTarget, null, `${access}: currentTarget ist nach dem Eintritt nicht mehr verfügbar`);
                assert(!getPageNavigationGuard(doc).reasons().some(reason => ['commit', 'preparing', 'running'].includes(reason.phase)), `${access}: lesende Vorbereitung hält keine Jahreslease`);
                assertEqual((await UIBinder.handleJahresabschluss()).status, 'in_flight', `${access}: Doppelzugang bleibt gesperrt`);
                assertEqual(elements.get('modalTitle').textContent, 'Dezember und Jahr 2026 abschließen', `${access}: echte Normaljahrvorbereitung`);
                assertEqual(elements.get('annualConfirmBtn').hidden, false, `${access}: regulärer Abschluss ist ausdrücklich bestätigbar`);
                assertEqual(elements.get('annualConfirmBtn').disabled, true, `${access}: unvollständige Legacyquellen geben keine Planbestätigung frei`);
                await elements.get('modalCloseBtn').fire('click');
                if (focusAttempts.at(-1) !== expected) focusFailures.push(`${access}: Modal-Rückfokusziel ${focusAttempts.at(-1)?.id}`);
                // Bei freigegebenen Eintrittselementen muss schon der Modalhandler zurückfokussieren.
                if (!expected.disabled && doc.activeElement !== expected) focusFailures.push(`${access}: sofort ${doc.activeElement?.id}`);
                assertEqual((await running[runsBefore]).status, 'cancelled', `${access}: Abbruch statt fachlichem Abschluss`);
                if (doc.activeElement !== expected) focusFailures.push(`${access}: nach Handlerende ${doc.activeElement?.id}`);
                assertEqual(Boolean(doc.getElementById('balanceAnnualClose')), false, `${access}: Dialog bleibt geschlossen`);
                if (doc.activeElement?.closest('dialog')) focusFailures.push(`${access}: Fokus im geschlossenen Dialog`);
                assert([dom.controls.jahresabschlussBtn, dom.controls.btnJahresUpdate,
                    elements.get('balanceMarketUpdate'), elements.get('balanceNextAnnual')].every(button => !button.disabled), `${access}: alle Zugangsbuttons sind freigegeben`);
                assertEqual(getPageNavigationGuard(doc).reasons().length, 0, `${access}: keine verbliebene Laufzeitsperre`);
                const live = StorageManager.loadState();
                assertEqual(live.annualPeriodMetadata.pendingCommit, null, `${access}: kein Pending-Commit`);
                assertEqual(live.annualPeriodMetadata.lastCommittedPeriod, null, `${access}: keine abgeschlossene Periode`);
            }
            assertEqual(snapshots + fetches + updates + periodCommits, 0, 'Lesende Probelaufvorbereitung und Abbruch erzeugen keine Netzabrufe, Snapshots, Updates oder Periodencommits');
            assertEqual(errors.length, 0, 'Vorbereitungsabbrüche erzeugen keinen Fehlerstatus');
            assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, 'Normaljahrabbrüche bewahren die Speicherbytes nach Startmigration');
            assertEqual(focusFailures.join('; '), '', 'Alle vier Normaljahrzugänge geben den Fokus an ihr Eintrittsziel zurück');
        } finally {
            try {
                if (doc.getElementById('balanceAnnualClose')?.open) await elements.get('modalCloseBtn').fire('click');
                await Promise.allSettled(running);
            } finally {
                manual.withAnnual = withAnnual;
                UIBinder.handleJahresabschluss = previous.annual;
                restoreBinder();
                listeners.clear(); observers.clear();
                if (previousObserver === undefined) delete globalThis.MutationObserver; else globalThis.MutationObserver = previousObserver;
                if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
                if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
                setAppTestDate(previous.testDate);
            }
        }
    }
    console.log('R-01: abweichende Überblicksprojektion endet mit Schutzmeldung ohne Vorbereitungsdialog');
    for (const planningStatus of [ANNUAL_PERIOD_STATUS.READY, ANNUAL_PERIOD_STATUS.LEGACY_CONFIRMATION_REQUIRED]) {
        const annualState = 'recovery';
        global.localStorage = createLocalStorageMock();
        seedBalanceState();
        setAppTestDate('2027-01-02');
        const metadata = planningStatus === ANNUAL_PERIOD_STATUS.READY
            ? { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null } : undefined;
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({ annualPeriodMetadata: metadata,
            wealthHistory: { schemaVersion: 1, entries: [createManualWealthHistoryEntry(SOURCE, '2026-01-01')] } }));
        const { doc } = createDialogFixture();
        globalThis.document = doc;
        globalThis.window = { __profileRecoveryBlocker: annualState === 'recovery' };
        const restoreBinder = preserveUIBinderStateForTests();
        const toasts = [], errors = [];
        let snapshots = 0, fetches = 0, updates = 0, running;
        UIRenderer.toast = message => toasts.push(message);
        UIRenderer.handleActionError = error => errors.push(error.message);
        global.fetch = async () => { fetches++; throw new Error('UNEXPECTED_FETCH'); };
        StorageManager.createSnapshot = async () => { snapshots++; throw new Error('UNEXPECTED_SNAPSHOT'); };
        StorageManager.loadState();
        initUIBinder(createAnnualDom(), {}, () => { updates++; return { ok: true }; }, () => { updates++; });
        const bound = preserveUIBinderStateForTests().handlers;
        assertEqual(bound.getAnnualModel().occasion.annualState, annualState, 'Echte Überblicksprojektion liegt außerhalb des Vorbereitungsgates');
        assertEqual(createAnnualPeriodPlan({ targetYear: TARGET_YEAR, currentAge: 67, metadata }).status,
            planningStatus, `Balance-Periodenplanung ist trotzdem ${planningStatus}`);
        const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
        try {
            running = UIBinder.handleJahresabschluss({ preparationFirst: planningStatus === ANNUAL_PERIOD_STATUS.READY });
            for (let turn = 0; turn < 200; turn++) await Promise.resolve();
            assert(!doc.getElementById('balanceAnnualClose'), `${annualState}: kein unerreichbarer Vorbereitungsdialog`);
            assertEqual((await running).status, 'cancelled', `${annualState}: Schutzweg bricht Jahresabschluss ab`);
            assert(toasts.some(message => message.includes('Jahresabschluss kann nicht vorbereitet werden')), `${annualState}: ausdrückliche Schutzmeldung`);
            assertEqual(snapshots + fetches + updates, 0, `${annualState}: keine Abrufe, Snapshots oder Jahreswrites`);
            assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, `${annualState}: Speicherbytes bleiben erhalten`);
            assertEqual(errors.length, 0, `${annualState}: kein unvollständiger Ergebnisdialog`);
            assertEqual(getPageNavigationGuard(doc).reasons().length, 0, `${annualState}: Jahreslease freigegeben`);
        } finally {
            if (doc.getElementById('balanceAnnualClose')?.open) await doc.getElementById('annualCloseBtn').fire('click');
            if (running) await running;
            bound.closeCoordinator.dispose();
            restoreBinder();
            if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
            if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
            setAppTestDate(previous.testDate);
        }
    }
    // Vor der Planungsgrenze gibt es weder Snapshot noch Ausgabenjahrkorrektur.
    {
        global.localStorage = createLocalStorageMock();
        seedBalanceState();
        const liveState = { wealthHistory: { schemaVersion: 1, entries: [createManualWealthHistoryEntry(SOURCE, '2026-01-01')] } };
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(liveState));
        const dom = createAnnualDom(); dom.expenses.yearSelect.value = '2025';
        let notices = 0, snapshots = 0, yearChanges = 0, updates = 0;
        StorageManager.createSnapshot = async () => { snapshots++; throw new Error('Kein Snapshot vor Planungsbeginn'); };
        const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
        const handlers = createSnapshotHandlers({ confirmAnnual: async () => ({}), decide: async () => approveSnapshot, dom, appState: {}, getReferenceDate: () => new Date(2026, 0, 2),
            showPlanningStart: ({ firstPlanningYear }) => { assertEqual(firstPlanningYear, 2026, 'Hinweis benennt das erste Planungsjahr'); notices++; },
            openExpensesYear: () => { yearChanges++; }, runAnnualUpdate: () => { updates++; } });
        for (const year of ['2025', '2026']) {
            dom.expenses.yearSelect.value = year;
            assertEqual((await handlers.handleJahresabschluss({ preparation: true })).status, 'not_applicable', 'Kopf/alter Link/Ausgabenjahr bieten keinen Abschluss 2025');
        }
        assertEqual(notices, 2, 'Hinweis ist bei jedem gültigen Öffnen erreichbar');
        assertEqual(snapshots, 0, 'Keine Recovery-Snapshots vor der Planungsgrenze');
        assertEqual(yearChanges, 0, 'Keine Ausgabenjahrkorrektur auf 2025');
        assertEqual(updates, 0, 'Keine Jahresfachwrites vor dem Beginn');
        assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, 'Erstjahrbedienung bewahrt sämtliche Speicherbytes');
    }

} finally {
    StorageManager.createSnapshot = previous.createSnapshot;
    SnapshotArchive.listSnapshots = previous.listSnapshots;
    SnapshotArchive.readSnapshot = previous.readSnapshot;
    UIRenderer.handleActionError = previous.handleError;
    UIRenderer.clearActionError = previous.clearActionError;
    UIRenderer.toast = previous.toast;
    if (previous.fetch === undefined) delete global.fetch; else global.fetch = previous.fetch;
    if (previous.setTimeout === undefined) delete global.setTimeout; else global.setTimeout = previous.setTimeout;
    if (previous.confirm === undefined) delete global.confirm; else global.confirm = previous.confirm;
    if (previous.localStorage === undefined) delete global.localStorage; else global.localStorage = previous.localStorage;
    if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
    setAppTestDate(previous.testDate);
    UIBinder.handleJahresabschluss = previous.annual;
    UIBinder.openExpensesYear = previous.expenses;
    UIBinder.selectTab = previous.tab;
    restoreLocks();
    previous.restoreBinder();
    resetPersistenceRuntimeForTests();
}

console.log('--- Balance Annual Workflow Contract Tests Completed ---');
