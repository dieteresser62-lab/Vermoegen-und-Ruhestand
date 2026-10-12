import { balanceStorageFixture, STORAGE_FIXTURE_KINDS, installBalanceStorageForm } from './helpers/balance-storage-fixtures.mjs';
import { legacyAnnualOracle } from './helpers/balance-legacy-annual-oracle.mjs';
import { computeAnnualPlanUpdate, annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords, commitAnnualPlanUpdate, evaluateAnnualDraft } from '../app/balance/balance-annual-storage-commit.js';
import { EngineAPI } from '../engine/index.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord, readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { ANNUAL_PLAN_RECORD_KEY, buildAnnualPlanRecord, readAnnualPlanRecord } from '../app/profile/annual-plan-record.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { PersistenceFacade, resetPersistenceRuntimeForTests } from '../app/shared/persistence-facade.js';
import { appNow, setAppTestDate, getAppTestDate } from '../app/shared/app-clock.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { buildSnapshot } from '../app/shared/snapshot-archive.js';
import { buildSnapshotRestorePlan } from '../app/shared/snapshot-restore.js';

const clock = () => new Date('2027-01-02T12:00:00Z');
const marketData = { inflation: { rate: 2.14, year: 2026, source: 'ECB (HICP)', dataAsOf: '2027-01-01', fetchStatus: 'ok_primary_ecb',
    metric: 'consumer_prices_all_items_annual_average_growth_pct' },
    etf: { price: 160.2, date: new Date('2026-12-31'), asOf: '2026-12-31', ticker: 'VWCE.DE', source: 'Test', targetYear: 2026 },
    cape: { capeRatio: 28.55, capeAsOf: '2026-12-01', capeSource: 'yale_ie_data_xls', capeFetchStatus: 'ok_primary', capeUpdatedAt: clock().toISOString() } };
function fixture(kind = 'Muster-Haushalt', strategy = 'standard', cape = 25) {
    const fixture = balanceStorageFixture(kind, strategy, cape);
    const { records, scope, values } = fixture;
    // Der bestätigte Altbestand kommt wie im produktiven H1-Weg mit migriertem Plan an.
    if (!records[HOUSEHOLD_PLAN_KEY]) records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope, values }], { now: clock }).raw;
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
    state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null,
        pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: { '2026': { months: {} } } });
    return fixture;
}
const saved = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage,
    toast: UIRenderer.toast, error: UIRenderer.handleActionError, date: getAppTestDate(), Date: globalThis.Date };
try {
    delete globalThis.document; delete globalThis.window;
    const { records, scope } = fixture();
    const storage = annualRecordStorage(records);
    const before = JSON.stringify(storage.records);
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, scope, storage });
    assertEqual(JSON.stringify(storage.records), before, 'DOM-freie Fortschreibung verändert keine Rohbytes');
    assertEqual(draft.values.floorBedarf, 30642, 'Bedarf verwendet ungerundete Inflationsrate und Europrojektion');
    assertEqual(draft.values.minimumFlexAnnual, 7661, 'Mindest-Flex wird fortgeschrieben, nicht begrenzt');
    assertEqual(draft.values.flexBedarf, 30642, 'Flexbedarf folgt derselben Inflationsprojektion');
    assertEqual(draft.values.flexBudgetAnnual, 7150, 'Flexbudget folgt der bisherigen Europräzision');
    assertEqual(draft.values.flexBudgetRecharge, 5107, 'Flexbudget-Aufladung folgt der bisherigen Europräzision');
    const projectedState = JSON.parse(draft.records[CONFIG.STORAGE.LS_KEY]);
    assertEqual(projectedState.needsAdjustedForInflationYear, 2027, 'Bedarfsmarker gehört zum Folgeplanungsjahr');
    assertEqual(projectedState.lastInflationAppliedAtYear, 2027, 'Faktormarker gehört zum Folgeplanungsjahr');
    assertEqual(projectedState.inputs.endeVJ, 160, 'ETF-Schlusskurs bleibt ganzzahlig');
    assertEqual(projectedState.inputs.endeVJ_1, draft.before.readerInputData.endeVJ, 'Nachrückkette übernimmt den vorigen Jahresstand');
    assertEqual(draft.values.cape.value, 28.6, 'CAPE-Planwert hält eine Dezimalstelle');
    assertEqual(projectedState.capeMeta.capeRatio, 28.55, 'CAPE-Herkunftsrecord hält die Quellpräzision');
    for (const delta of [-1, 0, 1]) {
        const ath = draft.before.readerInputData.ath;
        const price = ath + delta;
        const projected = computeAnnualPlanUpdate({ targetYear: 2026, scope, storage, now: clock,
            marketData: { ...marketData, etf: { ...marketData.etf, price } } });
        const state = JSON.parse(projected.records[CONFIG.STORAGE.LS_KEY]);
        assertEqual(state.inputs.ath, Math.max(price, ath), 'ATH ändert sich nur bei echter Überschreitung');
        assertEqual(state.inputs.jahreSeitAth, delta >= 0 ? 0 : draft.before.readerInputData.jahreSeitAth + 1, 'ATH-Gleichstand setzt Jahre seit ATH bereits zurück');
    }

    assertEqual(JSON.parse(draft.records[CONFIG.STORAGE.LS_KEY]).lastState.cumulativeInflationFactor,
        JSON.parse(records[CONFIG.STORAGE.LS_KEY]).lastState.cumulativeInflationFactor * 1.021, 'Kumulierter Faktor verwendet angezeigte Inflationspräzision');
    assertEqual(JSON.stringify(draft.ageByPerson), JSON.stringify({ muster_a: 68, muster_b: 65 }), 'Alter wird zum 01.01. des Planungsjahres projiziert');
    const prepared = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now: clock });
    assertEqual(JSON.stringify(prepared.receipt.recommended), JSON.stringify(prepared.receipt.adopted), 'Ohne Planpatch sind beide Belegzweige bytegleich');
    assertEqual(prepared.receipt.periodId, 'calendar-year:2026', 'Beleg verweist auf abgeschlossene Periode');
    assertEqual(prepared.receipt.year, 2027, 'Beleg gehört zum folgenden Planungsjahr');
    assertEqual(prepared.receipt.committedAt, clock().toISOString(), 'Beleg übernimmt bestätigten Abschlusszeitpunkt');
    const changed = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now: clock,
        adoptedPlanPatch: { flexBedarf: 40000, cape: { value: draft.values.cape.value } } });
    assertEqual(JSON.stringify(changed.receipt.recommended), JSON.stringify(prepared.receipt.recommended), 'Planpatch bewahrt die ursprüngliche Empfehlung');
    assertEqual(JSON.stringify(changed.receipt.adjustedFields), JSON.stringify(['flexBedarf']), 'Nur tatsächlich geänderte Planfelder werden belegt');
    for (const patch of [{ monthlyWithdrawal: 1 }, { minimumFlexAnnual: 999999 }, { decumulation: { unknown: 2 } }]) {
        let rejected = false; try { prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, adoptedPlanPatch: patch, now: clock }); } catch { rejected = true; }
        assert(rejected, 'Unzulässiger Planpatch wird vor dem Write abgewiesen');
    }
    let writes = 0;
    const persistence = { flush: async () => true, replaceRecordsTransactional: async (next, options) => {
        writes++;
        for (const key of Object.keys(next)) assert(options.allowKey(key), 'Fachwrite umfasst ausschließlich erlaubte Zielrecords');
        assertEqual(options.expectedRecords[HOUSEHOLD_PLAN_KEY], records[HOUSEHOLD_PLAN_KEY], 'Fachwrite bindet ursprüngliche Planbytes');
        for (const [key, raw] of Object.entries(next)) storage.setItem(key, raw);
        options.postValidate(storage.records);
    } };
    await commitAnnualPlanUpdate({ draft, storage, persistence, engineApi: EngineAPI, now: clock });
    assertEqual(writes, 1, 'Plan, Engine-States, Verlauf, Marker und Beleg werden gemeinsam geschrieben');
    assertEqual(JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY)).annualPeriodMetadata.pendingCommit, null, 'Write schließt die Jahresperiode vollständig ab');
    const receiptBytes = storage.getItem(ANNUAL_PLAN_RECORD_KEY);
    await commitAnnualPlanUpdate({ targetYear: 2026, storage, persistence, engineApi: EngineAPI, now: clock });
    assertEqual(writes, 1, 'Bestätigte Wiederholung rechnet und schreibt nicht erneut');
    assertEqual(storage.getItem(ANNUAL_PLAN_RECORD_KEY), receiptBytes, 'Bestätigte Wiederholung bewahrt Belegbytes');
    const stale = annualRecordStorage(records);
    stale.setItem('rs_current_profile', 'muster_b');
    let staleRejected = false;
    try { await commitAnnualPlanUpdate({ draft, storage: stale, persistence, engineApi: EngineAPI, now: clock }); } catch { staleRejected = true; }
    assert(staleRejected, 'Profilwechsel seit Vorbereitung verhindert den Write');
    assertEqual(writes, 1, 'Veralteter Kandidat löst keinen Fachwrite aus');

    // Auswahljahr ist Ansichtsmetadatum; beide Ausgangsjahre enden im selben Planjahr.
    for (const activeYear of [2026, 2027]) {
        const sample = fixture();
        const years = {
            '2026': { months: { '12': { profiles: { muster_a: { categories: { wohnen: 1234 }, total: 1234 } } } } },
            '2027': { months: { '1': { profiles: { muster_a: { categories: { wohnen: 2345 }, total: 2345 } } } } }
        };
        sample.records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear, years });
        const live = annualRecordStorage(sample.records);
        const before = JSON.stringify(live.records);
        const annualDraft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage: live, now: clock });
        const prepared = prepareAnnualCommitRecords(annualDraft, { engineApi: EngineAPI, now: clock });
        assertEqual(JSON.stringify(live.records), before, `${activeYear}: Vorbereitung bewahrt sämtliche Livequellen`);
        assertEqual(JSON.parse(prepared.records.balance_expenses_v1).activeYear, 2027, `${activeYear}: isolierter Entwurf setzt genau das Folgejahr`);
        let batches = 0;
        const persistence = { flush: async () => true, replaceRecordsTransactional: async (next, options) => {
            batches++;
            assertEqual(options.expectedRecords.balance_expenses_v1, sample.records.balance_expenses_v1, 'Ausgabenquelle bleibt an ursprüngliche Rohbytes gebunden');
            for (const [key, raw] of Object.entries(next)) live.setItem(key, raw);
            options.postValidate(live.records);
        } };
        await commitAnnualPlanUpdate({ draft: annualDraft, storage: live, persistence, engineApi: EngineAPI, now: clock });
        assertEqual(batches, 1, `${activeYear}: kein zusätzlicher Fachwrite zum Angleichen der Auswahl`);
        const expenses = JSON.parse(live.getItem('balance_expenses_v1'));
        assertEqual(expenses.activeYear, 2027, `${activeYear}: Abschluss springt nicht über das Folgejahr hinaus`);
        assertEqual(JSON.stringify(expenses.years), JSON.stringify(years), `${activeYear}: Monats- und Kategoriedaten bleiben erhalten`);
        const confirmed = JSON.stringify(live.records);
        await commitAnnualPlanUpdate({ targetYear: 2026, storage: live, persistence, engineApi: EngineAPI, now: clock });
        assertEqual(batches, 1, `${activeYear}: bestätigte Periode erzeugt keinen zweiten Jahresbatch`);
        assertEqual(JSON.stringify(live.records), confirmed, `${activeYear}: Wiederholung bewahrt alle bestätigten Records`);
    }
    for (const raw of ['{', '{"version":99,"activeYear":2027,"years":{}}', '{"version":1,"activeYear":2027,"years":[]}']) {
        const sample = fixture();
        sample.records.balance_expenses_v1 = raw;
        const live = annualRecordStorage(sample.records), before = JSON.stringify(live.records);
        let writes = 0, error;
        try {
            await commitAnnualPlanUpdate({ targetYear: 2026, marketData, storage: live, engineApi: EngineAPI, now: clock,
                persistence: { flush: async () => true, replaceRecordsTransactional: async () => { writes++; } } });
        } catch (caught) { error = caught; }
        assertEqual(error?.name, 'ExpensesStoreCorruptionError', 'Storekorruption wird weiterhin ausdrücklich abgewiesen');
        assertEqual(writes, 0, 'Beschädigter Store erzeugt keinen Jahresbatch');
        assertEqual(JSON.stringify(live.records), before, 'Beschädigte Ausgabenrohbytes werden nicht durch einen leeren Store ersetzt');
    }

    // Backend-/Cacheprobe über die echte Facade; jede Jahrestransaktion enthält Plan und Beleg.
    for (const fault of ['none', 'with-receipt', 'write', 'readback', 'rollback', 'prepare', 'late-plan', 'late-profile', 'late-membership', 'late-raw', 'late-expenses']) {
        const sample = fixture();
        if (fault === 'with-receipt') sample.records[ANNUAL_PLAN_RECORD_KEY] = buildAnnualPlanRecord(null, {
            targetYear: 2025, scope: sample.scope, committedAt: '2026-01-02T12:00:00Z', recommended: prepared.receipt.recommended }).raw;
        const backend = new Map(Object.entries(sample.records));
        const baseline = JSON.stringify(Object.fromEntries(backend));
        let armed = false, corrupted = false, attempted = false, annualWrites = 0;
        const adapter = { async open() {}, async loadAll() {
            const actual = Object.fromEntries(backend);
            if (corrupted) { corrupted = false; actual[ANNUAL_PLAN_RECORD_KEY] = '{}'; }
            return actual;
        }, async saveBatch({ upserts, deletes }) {
            const annual = upserts.some(([key]) => key === ANNUAL_PLAN_RECORD_KEY);
            if (armed && annual) {
                annualWrites++;
                assert(upserts.some(([key]) => key === HOUSEHOLD_PLAN_KEY), 'Backendprobe: Fachwrite enthält gemeinsamen Plan');
                assert(upserts.some(([key]) => key === CONFIG.STORAGE.LS_KEY) && upserts.some(([key]) => key === 'rs_profiles_v1'), 'Backendprobe: Fachwrite enthält State und Profile');
                if (fault === 'write') { attempted = true; throw new Error('ANNUAL_WRITE_INJECTED'); }
            }
            if (armed && attempted && fault === 'rollback' && !annual) throw new Error('ANNUAL_ROLLBACK_INJECTED');
            deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, raw]) => backend.set(key, raw));
            if (armed && annual && ['readback', 'rollback'].includes(fault)) { attempted = true; corrupted = true; }
        } };
        PersistenceFacade.resetPersistenceForTests(adapter); await PersistenceFacade.init({ installLifecycleHooks: false });
        const live = (await import('../app/shared/persistence-facade.js')).persistenceStorage;
        const annualDraft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage: live, now: clock });
        if (fault === 'late-plan') live.setItem(HOUSEHOLD_PLAN_KEY, sample.records[HOUSEHOLD_PLAN_KEY].replace('30000', '30001'));
        if (fault === 'late-profile') live.setItem('rs_current_profile', 'muster_b');
        if (fault === 'late-membership') {
            const registry = JSON.parse(live.getItem('rs_profiles_v1'));
            registry.profiles.muster_b.meta.belongsToHousehold = false;
            live.setItem('rs_profiles_v1', JSON.stringify(registry));
        }
        if (fault === 'late-raw') live.setItem('profile_tagesgeld', '42');
        if (fault === 'late-expenses') live.setItem('balance_expenses_v1', JSON.stringify({ version: 1, activeYear: 2027, years: { '2027': { months: {} } } }));
        const changedSource = fault.startsWith('late-') ? JSON.stringify(live.records || PersistenceFacade.exportAllSync().records) : null;
        armed = true;
        let error;
        try { await commitAnnualPlanUpdate({ draft: annualDraft, storage: live, persistence: PersistenceFacade,
            engineApi: fault === 'prepare' ? { simulateSingleYear() { throw new Error('ANNUAL_PREPARE_INJECTED'); } } : EngineAPI, now: clock }); } catch (caught) { error = caught; }
        if (['none', 'with-receipt'].includes(fault)) {
            assert(!error, 'Backendprobe: Jahresabschluss ist dauerhaft bestätigt');
            assertEqual(annualWrites, 1, 'Backendprobe: genau ein erfolgreicher fachlicher Jahreswrite');
            assert(!Object.hasOwn(JSON.parse(live.getItem(CONFIG.STORAGE.LS_KEY)).inputs, 'aktuellesAlter'), 'Jahreswrite speichert keine Personenprojektion als Wahrheit');
            const snapshot = buildSnapshot({ records: sample.records, activeProfileId: sample.records.rs_current_profile,
                kind: 'annual-close-pre-mutation', restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback', liveKeyMode: 'snapshot-full' } });
            const restored = buildSnapshotRestorePlan(snapshot, await PersistenceFacade.readPersistedRecords());
            assertEqual(restored.records[HOUSEHOLD_PLAN_KEY], sample.records[HOUSEHOLD_PLAN_KEY], 'Vorabschluss-Restore übernimmt ursprüngliche Planbytes');
            assertEqual(restored.records.rs_profiles_v1, sample.records.rs_profiles_v1, 'Vorabschluss-Restore übernimmt alle ursprünglichen Profilbytes');
            if (fault === 'none') assert(restored.changes.some(change => change.key === ANNUAL_PLAN_RECORD_KEY && change.action === 'removed'), 'Vorabschluss-Restore entfernt den neu geschriebenen Jahresbeleg');
            else assertEqual(restored.records[ANNUAL_PLAN_RECORD_KEY], sample.records[ANNUAL_PLAN_RECORD_KEY], 'Vorabschluss-Restore schützt frühere Belegrohbytes');
            await PersistenceFacade.replaceRecordsTransactional(restored.records, { allowKey: restored.allowKey });
            assertEqual(JSON.stringify(await PersistenceFacade.readPersistedRecords()), baseline, 'Vorabschluss-Restore stellt Plan, Profile, Marker und Verlauf vollständig zurück');
        } else {
            assert(error, fault + ': Fehler wird sichtbar, niemals Erfolg gemeldet');
            if (fault === 'rollback') {
                assertEqual(error.code, 'rollback_failed', 'Unbestätigte Rücknahme behält ihre technische Fehlerklasse');
                assert(PersistenceFacade.hasSyncWriteBlocks(), 'Unbestätigte Rücknahme blockiert weitere Writes');
                let blocked = false; try { await commitAnnualPlanUpdate({ draft: annualDraft, storage: live, engineApi: EngineAPI, now: clock }); } catch { blocked = true; }
                assert(blocked, 'Wiederholung nach unbestätigter Rücknahme bleibt gesperrt');
            } else if (!fault.startsWith('late-')) assertEqual(JSON.stringify(await PersistenceFacade.readPersistedRecords()), baseline, fault + ': vollständiger Fachrecordsatz bleibt beziehungsweise wird zurückgenommen');
            if (fault === 'prepare' || fault.startsWith('late-')) assertEqual(annualWrites, 0, fault + ': Fehler vor Write löst keine Jahrestransaktion aus');
            if (fault.startsWith('late-')) assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), changedSource, fault + ': veränderte Fremdquelle wird nicht überschrieben');
            if (fault === 'prepare') {
                await commitAnnualPlanUpdate({ targetYear: 2026, marketData, storage: live, persistence: PersistenceFacade, engineApi: EngineAPI, now: clock });
                const confirmed = JSON.parse(live.getItem(CONFIG.STORAGE.LS_KEY));
                const plan = readBalanceHouseholdPlan({ storage: live });
                assertEqual(plan.entry.values.floorBedarf, 30642, 'Wiederaufnahme nach vorbereiteter Quelle inflationiert den Bedarf genau einmal');
                assertEqual(confirmed.inputs.endeVJ_1, annualDraft.before.readerInputData.endeVJ, 'Wiederaufnahme nach Vorbereitungsfehler dreht die Kette genau einmal');
            }
        }
    }

    // Unabhängiger DOM-Ablauf mit echten alten Handlern und derselben Engine.
    // Eine feste normale Fachuhr darf offizielle vorbereitete Providerwerte
    // nicht nebenbei in den synthetischen Probelaufmodus versetzen.
    setAppTestDate(null);
    globalThis.Date = class extends saved.Date {
        constructor(...args) { super(...(args.length ? args : ['2027-01-02T12:00:00Z'])); }
        static now() { return new saved.Date('2027-01-02T12:00:00Z').getTime(); }
        static [Symbol.hasInstance](value) { return value instanceof saved.Date; }
    };
    UIRenderer.toast = () => {}; UIRenderer.handleActionError = error => { throw error; };
    for (const kind of STORAGE_FIXTURE_KINDS) for (const strategy of ['standard', '3_bucket_jilge']) for (const cape of [0, 25]) {
        resetPersistenceRuntimeForTests();
        const sample = fixture(kind, strategy, cape);
        const isolated = annualRecordStorage(sample.records);
        globalThis.localStorage = isolated; globalThis.window = { EngineAPI };
        globalThis.document = { getElementById: () => null };
        PersistenceFacade.resetPersistenceForTests(createLocalStorageAdapter(isolated));
        await PersistenceFacade.init({ installLifecycleHooks: false });
        const oldInputs = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]).inputs;
        const dom = installBalanceStorageForm(oldInputs, sample.values);
        dom.inputs.aktuellesAlter ||= { value: '67' };
        dom.controls.btnJahresUpdate = { innerHTML: '', disabled: false };
        const callsOld = [], callsNew = [];
        const recorder = calls => ({ ...EngineAPI, simulateSingleYear: (input, lastState) => {
            calls.push(JSON.stringify({ input, lastState })); return EngineAPI.simulateSingleYear(input, lastState);
        } });
        const old = await legacyAnnualOracle({ dom, marketData, targetYear: 2026, engineApi: recorder(callsOld) });
        const annualDraft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage: annualRecordStorage(sample.records), now: appNow });
        const result = evaluateAnnualDraft(annualDraft, { engineApi: recorder(callsNew), now: clock });
        assertEqual(JSON.stringify(result.inputData), JSON.stringify(old.inputData), `${kind}/${strategy}/${cape}: vollständige Eingaben entsprechen DOM-Orakel`);
        assertEqual(callsNew[0], callsOld.at(-1), `${kind}/${strategy}/${cape}: Engineargument und LastState entsprechen DOM-Orakel`);
        assertEqual(JSON.stringify(result.modelResult), JSON.stringify(old.modelResult), `${kind}/${strategy}/${cape}: Jahresergebnis entspricht DOM-Orakel`);
        const finalized = prepareAnnualCommitRecords(annualDraft, { engineApi: EngineAPI, now: appNow });
        const finalRecords = { ...sample.records, ...finalized.records };
        const oldState = JSON.parse(old.records[CONFIG.STORAGE.LS_KEY]);
        assertEqual(JSON.stringify(finalized.state.lastState), JSON.stringify(oldState.lastState), `${kind}/${strategy}/${cape}: endgültiger LastState entspricht DOM-Orakel`);
        assertEqual(JSON.stringify(finalized.state.wealthHistory), JSON.stringify(oldState.wealthHistory), `${kind}/${strategy}/${cape}: tatsächlicher Jahresverlauf entspricht DOM-Orakel`);
        assertEqual(JSON.stringify(finalized.state.annualPeriodMetadata), JSON.stringify(oldState.annualPeriodMetadata), `${kind}/${strategy}/${cape}: endgültige Jahresmarker entsprechen DOM-Orakel`);
        assertEqual(finalized.records[HOUSEHOLD_PLAN_KEY], old.records[HOUSEHOLD_PLAN_KEY], `${kind}/${strategy}/${cape}: gemeinsame Planrohbytes entsprechen DOM-Orakel`);
        assertEqual(finalized.records.balance_expenses_v1, old.records.balance_expenses_v1, `${kind}/${strategy}/${cape}: Ausgabenjahreswechsel entspricht DOM-Orakel`);
        assertEqual(finalRecords.overview_balance_summary_v1, old.records.overview_balance_summary_v1, `${kind}/${strategy}/${cape}: endgültige Summaryrohbytes entsprechen DOM-Orakel`);
        for (const key of Object.keys(oldState)) {
            assertEqual(JSON.stringify(finalized.state[key]), JSON.stringify(oldState[key]), `${kind}/${strategy}/${cape}: vorhandenes Hauptstatefeld ${key} entspricht DOM-Orakel`);
        }
        const { balanceInputFields, ...commonState } = finalized.state;
        assertEqual(JSON.stringify(commonState), JSON.stringify(oldState), `${kind}/${strategy}/${cape}: vollständige gemeinsame Hauptstatebytes entsprechen DOM-Orakel`);
        assert(balanceInputFields && balanceInputFields.endeVJ.value === '160', `${kind}/${strategy}/${cape}: zusätzliche H3-Feldprojektion zeigt bestätigten Marktstand`);
        const oldProfiles = JSON.parse(old.records.rs_profiles_v1).profiles;
        const finalProfiles = JSON.parse(finalRecords.rs_profiles_v1).profiles;
        for (const id of Object.keys(oldProfiles)) {
            const oldProfile = JSON.parse(oldProfiles[id].data[CONFIG.STORAGE.LS_KEY]);
            const finalProfile = JSON.parse(finalProfiles[id].data[CONFIG.STORAGE.LS_KEY]);
            for (const key of Object.keys(oldProfile)) {
                assertEqual(JSON.stringify(finalProfile[key]), JSON.stringify(oldProfile[key]), `${kind}/${strategy}/${cape}/${id}: gespeichertes ${key} entspricht DOM-Orakel`);
            }
            assertEqual(finalProfiles[id].data.overview_balance_summary_v1, oldProfiles[id].data.overview_balance_summary_v1, `${kind}/${strategy}/${cape}/${id}: gemeinsame Summaryrohbytes entsprechen DOM-Orakel`);
            const { balanceInputFields: extraFields, ...commonProfile } = finalProfile;
            assertEqual(JSON.stringify(commonProfile), JSON.stringify(oldProfile), `${kind}/${strategy}/${cape}/${id}: vollständige gemeinsame Profilstatebytes entsprechen DOM-Orakel`);

        }
        // Nur die getrennt geprüften neuen H3-Projektions-/Belegfelder ausnehmen;
        // alle bisherigen Fachrecords bleiben einschließlich Rohserialisierung gleich.
        const commonRecords = { ...finalRecords, [CONFIG.STORAGE.LS_KEY]: JSON.stringify(commonState) };
        const commonRegistry = JSON.parse(commonRecords.rs_profiles_v1);
        for (const profile of Object.values(commonRegistry.profiles)) {
            const { balanceInputFields: fields, ...state } = JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]);
            profile.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        }
        commonRecords.rs_profiles_v1 = JSON.stringify(commonRegistry);
        delete commonRecords[ANNUAL_PLAN_RECORD_KEY];
        const rawBytes = records => JSON.stringify(Object.entries(records).sort(([a], [b]) => a.localeCompare(b)));
        assertEqual(rawBytes(commonRecords), rawBytes(old.records), `${kind}/${strategy}/${cape}: sämtliche gemeinsamen Fachrohbytes entsprechen DOM-Orakel`);



    }
} finally {
    for (const key of ['document', 'window', 'localStorage']) if (saved[key] === undefined) delete globalThis[key]; else globalThis[key] = saved[key];
    globalThis.Date = saved.Date;
    UIRenderer.toast = saved.toast; UIRenderer.handleActionError = saved.error; setAppTestDate(saved.date); resetPersistenceRuntimeForTests();
}
