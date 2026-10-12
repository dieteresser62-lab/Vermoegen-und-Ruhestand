import { prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { captureCashPeople } from '../app/profile/profile-cash-update.js';
import { annualServiceFixture, readyAnnualFixture, annualTestNow, STORAGE_FIXTURE_KINDS } from './helpers/balance-storage-fixtures.mjs';
import { createSnapshotHandlers } from '../app/balance/balance-binder-snapshots.js';
import { createAnnualSnapshot } from '../app/shared/annual-coordinator.js';
import { commitAnnualPlanUpdate } from '../app/balance/balance-annual-storage-commit.js';
import { EngineAPI } from '../engine/index.mjs';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { bindOverviewAnnualClose } from '../app/overview/overview-annual-close.js';
import { projectOverviewFromRecords } from '../app/overview/overview-main.js';
import { UIBinder, initUIBinder, preserveUIBinderStateForTests } from '../app/balance/balance-binder.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { installAnnualLocks, installBalanceStorageForm } from './helpers/balance-storage-fixtures.mjs';
import { appNow, getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { annualUntil } from './overview-annual-close.test.mjs?fixture';
import { CONFIG } from '../app/balance/balance-config.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';

// Jede Bestandsart läuft in einem eigenen Prozess; Dienstgegenprobe einmal.
export async function runGoldenMatrix(kind) {
if (kind === STORAGE_FIXTURE_KINDS[0]) {
const savedToast = UIRenderer.toast;
try {
    UIRenderer.toast = () => {};
    assert(typeof globalThis.document === 'undefined' && typeof globalThis.window === 'undefined', 'Beide Dienstadapter laufen ohne Seitenglobale');
    for (const kind of STORAGE_FIXTURE_KINDS) for (const strategy of ['standard', '3_bucket_jilge']) for (const cape of [0, 25]) {
        const label = `${kind}/${strategy}/${cape}`, sample = readyAnnualFixture(kind, strategy, cape);
        const run = async balance => {
            const env = await annualServiceFixture({ sample });
            const calls = [];
            const api = { ...EngineAPI, simulateSingleYear(input, lastState) {
                const output = EngineAPI.simulateSingleYear(input, lastState);
                calls.push(JSON.stringify({ input, lastState, output })); return output;
            } };
            const people = captureCashPeople({ ids: sample.scope.ids, activeId: sample.records.rs_current_profile });
            const cash = { people, values: Object.fromEntries(people.map(person => [person.id, person.value - 1.25])) };
            const options = { confirmedPreparation: { cash } };
            const service = balance ? createSnapshotHandlers({ dom: { inputs: {}, controls: {} }, appState: {},
                getReferenceDate: annualTestNow, getProfileId: () => env.storage.getItem('rs_current_profile'),
                confirmAnnual: env.options.confirmAnnual, flushLiveState: () => env.persistence.flush(),
                engineLoader: { load: async () => api }, operationLock: env.options.operationLock,
                createAnnualSnapshot: options => createAnnualSnapshot({ ...options, snapshotId: 'annual-before' }),
                runAnnualUpdate: env.options.prepareMarketData,
                reportAnnualError: env.options.reportError,
                commitLiveState: options => commitAnnualPlanUpdate({ ...options, storage: env.storage, persistence: env.persistence })
            }) : env.create({ engineLoader: { load: async () => api } });
            const result = await (balance ? service.handleJahresabschluss(options) : service.close(options));
            assertEqual(result.status, 'already_committed', label + ': produktiver Abschluss bestätigt');
            return { result, calls, records: await env.persistence.readPersistedRecords(), snapshots: [...env.snapshots.values()] };
        };
        const start = await run(false), balance = await run(true);
        assertEqual(JSON.stringify(balance.calls), JSON.stringify(start.calls), label + ': komplette Engineargumente und Ergebnisse bytegleich');
        assertEqual(JSON.stringify(balance.result), JSON.stringify(start.result), label + ': vollständige Dienstresultate bytegleich');
        assertEqual(JSON.stringify(balance.records), JSON.stringify(start.records), label + ': alle H3-Records einschließlich Plan, Beleg, Cash, Marker, Verlauf und Summary bytegleich');
        assertEqual(JSON.stringify(balance.snapshots), JSON.stringify(start.snapshots), label + ': vollständige Rückkehrpunkte ohne Feldfilter bytegleich');
    }
} finally { UIRenderer.toast = savedToast; PersistenceFacade.resetPersistenceRuntimeForTests(); }

}

// H4: dieselbe Goldenmatrix jetzt über beide tatsächlichen Seitenbinder und Schritt 6.
const previousPage = { doc: globalThis.document, win: globalThis.window, date: getAppTestDate(), toast: UIRenderer.toast, snapshot: SnapshotArchive.createSnapshot };
const restoreLocks = installAnnualLocks(), restoreBinder = preserveUIBinderStateForTests();
try {
    setAppTestDate('2027-01-02'); UIRenderer.toast = () => {};
    SnapshotArchive.createSnapshot = (record, options) => previousPage.snapshot.call(SnapshotArchive, { ...record, id: record.kind === 'annual-close-pre-mutation' ? 'annual-before' : 'month-before' }, options);
    for (const strategy of ['standard', '3_bucket_jilge']) for (const cape of [0, 25]) for (const adjusted of [false, true]) {
        const sample = readyAnnualFixture(kind, strategy, cape), label = `${kind}/${strategy}/${cape}/${adjusted}`;
        // Der Dienst-Altbestand enthält absichtlich alte Registrykopien. Für den
        // tatsächlichen UI-Start sind alle belegten Abschlussquellen konsistent.
        const registry = JSON.parse(sample.records.rs_profiles_v1);
        for (const profile of Object.values(registry.profiles)) {
            const state = JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]);
            state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
            profile.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        }
        sample.records.rs_profiles_v1 = JSON.stringify(registry);
        const run = async balance => {
            const env = await annualServiceFixture({ sample });
            const { doc } = createDialogFixture(); const win = { document: doc, EngineAPI }; globalThis.document = doc; globalThis.window = win;
            let model, controls;
            const refresh = () => { model = projectOverviewFromRecords({ registry: JSON.parse(env.storage.getItem('rs_profiles_v1')), activeId: env.storage.getItem('rs_current_profile'), liveData: env.persistence.exportAllSync().records, now: appNow() }); };
            refresh();
            let closing;
            if (balance) {
                const dom = installBalanceStorageForm(JSON.parse(env.storage.getItem(CONFIG.STORAGE.LS_KEY)).inputs, sample.values);
                dom.controls = { jahresabschlussBtn: doc.createElement('button'), btnJahresUpdate: doc.createElement('button'), btnJahresUpdateLog: doc.createElement('button') };
                dom.expenses = { yearSelect: { value: '2026' } }; dom.containers = {}; dom.outputs = {};
                initUIBinder(dom, {}, () => ({ ok: true }), () => {});
                closing = UIBinder.handleJahresabschluss();
            } else {
                const focus = doc.createElement('section'); focus.id = 'overviewFocus'; doc.body.append(focus);
                controls = bindOverviewAnnualClose({ doc, win, getModel: () => model, refresh, now: appNow, engineLoader: { load: async () => EngineAPI },
                    coordinatorOptions: { snapshotId: 'annual-before' } });
                closing = controls.start();
            }
            await prepareCloseFixture(doc); await annualUntil(() => doc.getElementById('annualConfirmBtn') && !doc.getElementById('annualConfirmBtn').disabled);
            if (adjusted) {
                await doc.getElementById('balanceAnnualClose').querySelector('[data-annual-plan-toggle]').fire('click');
                for (const [path, value] of [['floorBedarf', '20000'], ['flexBedarf', '30000'], ['decumulation.bondTargetFactor', '6']]) {
                    const field = doc.getElementById('annualPlan_' + path.replaceAll('.', '_')); field.value = value; await field.fire('input');
                }
                await annualUntil(() => !doc.getElementById('annualConfirmBtn').disabled);
            }
            await doc.getElementById('annualConfirmBtn').fire('click');
            const result = await closing, records = await env.persistence.readPersistedRecords();
            assertEqual(result.status, 'already_committed', label + ': tatsächlicher Seitenbinder bestätigt Jahr');
            assert(doc.querySelector('[data-annual-combined-result="C"]'), label + ': Hauptklick bestätigt Jahr UND Dezember');
            assertEqual(env.snapshots.size, 2, label + ': getrennte verifizierte Jahres- und Monatspunkte');
            const reloaded = projectOverviewFromRecords({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile, liveData: records, now: appNow() });
            assertEqual(reloaded.occasion.kind, 'play', label + ': erneut geladene Startseite hat keinen offenen Dezember');
            const receipt = Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries).find(entry => entry.year === 2027 && entry.scope.key === sample.scope.key);
            assertEqual(receipt.adjusted, adjusted, label + ': Anpassungsentscheidung im Beleg');
            assertEqual(JSON.stringify(receipt.adjustedFields), JSON.stringify(adjusted ? ['floorBedarf', 'flexBedarf', 'decumulation.bondTargetFactor'] : []), label + ': genaue Feldpfade');
            if (!adjusted) assertEqual(JSON.stringify(receipt.recommended), JSON.stringify(receipt.adopted), label + ': identische Empfehlung ohne Änderung');
            await doc.getElementById('annualCloseBtn').fire('click');
            if (balance) preserveUIBinderStateForTests().handlers.closeCoordinator.dispose(); else controls.dispose();
            return { records, result };
        };
        const start = await run(false), balance = await run(true);
        assertEqual(JSON.stringify(balance.records), JSON.stringify(start.records), label + ': tatsächliche Binder erzeugen bytegleiche H3-Records');
        assertEqual(JSON.stringify(balance.result), JSON.stringify(start.result), label + ': tatsächliche Binder liefern bytegleiche Ergebnisse');
    }
} finally {
    SnapshotArchive.createSnapshot = previousPage.snapshot; UIRenderer.toast = previousPage.toast;
    globalThis.document = previousPage.doc; globalThis.window = previousPage.win; setAppTestDate(previousPage.date);
    restoreBinder(); restoreLocks(); PersistenceFacade.resetPersistenceRuntimeForTests();
}
}
