import { prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { annualServiceFixture, readyAnnualFixture } from './helpers/balance-storage-fixtures.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { bindOverviewAnnualClose } from '../app/overview/overview-annual-close.js';
import { projectOverviewFromRecords } from '../app/overview/overview-main.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { appNow, getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { annualUntil } from './overview-annual-close.test.mjs?fixture';
import { CONFIG } from '../app/balance/balance-config.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';

// Jede Bestandsart läuft in einem eigenen Prozess.
export async function runGoldenMatrix(kind) {
// H4: Goldenmatrix über den tatsächlichen Startseitenbinder und Schritt 6 (die Balance hat keinen eigenen Abschluss mehr).
const previousPage = { doc: globalThis.document, win: globalThis.window, date: getAppTestDate(), toast: UIRenderer.toast, snapshot: SnapshotArchive.createSnapshot };
const restoreLocks = installAnnualLocks();
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
        const run = async () => {
            const env = await annualServiceFixture({ sample });
            const { doc } = createDialogFixture(); const win = { document: doc, EngineAPI }; globalThis.document = doc; globalThis.window = win;
            let model, controls;
            const refresh = () => { model = projectOverviewFromRecords({ registry: JSON.parse(env.storage.getItem('rs_profiles_v1')), activeId: env.storage.getItem('rs_current_profile'), liveData: env.persistence.exportAllSync().records, now: appNow() }); };
            refresh();
            let closing;
            const focus = doc.createElement('section'); focus.id = 'overviewFocus'; doc.body.append(focus);
            controls = bindOverviewAnnualClose({ doc, win, getModel: () => model, refresh, now: appNow, engineLoader: { load: async () => EngineAPI },
                coordinatorOptions: { snapshotId: 'annual-before' } });
            closing = controls.start();
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
            // GN-1 (FR-68 Punkt 7): Vorschläge werden genau übernommen; eine Rundung ist keine Anpassung mehr.
            const roundedFields = [];
            const expectedFields = adjusted ? [...new Set(['floorBedarf', 'flexBedarf', ...roundedFields, 'decumulation.bondTargetFactor'])] : roundedFields;
            assertEqual(receipt.adjusted, expectedFields.length > 0, label + ': Anpassungsentscheidung nur bei bewusster Änderung');
            assertEqual(JSON.stringify(receipt.adjustedFields), JSON.stringify(expectedFields), label + ': genaue Feldpfade der bewussten Änderung');
            if (!adjusted) for (const path of ['floorBedarf', 'flexBedarf', 'minimumFlexAnnual']) assertEqual(receipt.adopted.snapshot.plan[path], receipt.recommended.snapshot.plan[path], label + ': vorausgewählter Vorschlag genau übernommen');
            await doc.getElementById('annualCloseBtn').fire('click');
            controls.dispose();
            return { records, result };
        };
        await run();
    }
} finally {
    SnapshotArchive.createSnapshot = previousPage.snapshot; UIRenderer.toast = previousPage.toast;
    globalThis.document = previousPage.doc; globalThis.window = previousPage.win; setAppTestDate(previousPage.date);
    restoreLocks(); PersistenceFacade.resetPersistenceRuntimeForTests();
}
}
