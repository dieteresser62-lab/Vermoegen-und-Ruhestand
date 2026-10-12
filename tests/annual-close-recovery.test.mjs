import { createAnnualMonthSession } from '../app/shared/annual-close-session.js';
import { overviewAnnualFixture, annualUntil } from './overview-annual-close.test.mjs?fixture';
import { annualServiceFixture, readyAnnualFixture, annualTestNow, installAnnualLocks, installBalanceStorageForm } from './helpers/balance-storage-fixtures.mjs';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { UIBinder, initUIBinder, preserveUIBinderStateForTests } from '../app/balance/balance-binder.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { createAnnualSnapshot } from '../app/shared/annual-coordinator.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { projectAnnualCloseRecovery } from '../app/shared/annual-close-recovery.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { dialogElements } from '../app/shared/close-dialog.js';
import { captureCashPeople } from '../app/profile/profile-cash-update.js';
import { storeMonthProvision, readMonthProvision, OVERVIEW_MONTH_KEY, overviewScope } from '../app/overview/overview-storage.js';

const old = { doc: globalThis.document, win: globalThis.window, date: getAppTestDate(), toast: UIRenderer.toast, error: UIRenderer.handleActionError };
const locks = installAnnualLocks(), restoreBinder = preserveUIBinderStateForTests();
const text = root => dialogElements(root).map(node => node.textContent).join(' ');
async function balanceFixture() {
    const sample = readyAnnualFixture(), env = await annualServiceFixture({ sample });
    const { doc } = createDialogFixture(); globalThis.document = doc; globalThis.window = { document: doc };
    const dom = installBalanceStorageForm(JSON.parse(env.storage.getItem(CONFIG.STORAGE.LS_KEY)).inputs, sample.values);
    dom.controls = { jahresabschlussBtn: doc.createElement('button'), btnJahresUpdate: doc.createElement('button') };
    dom.expenses = { yearSelect: { value: '2026' } }; dom.containers = {}; dom.outputs = {};
    initUIBinder(dom, {}, () => ({ ok: true }), () => {});
    return { ...env, doc, get handlers() { return preserveUIBinderStateForTests().handlers; },
        open: () => UIBinder.handleJahresabschluss(), close() { this.handlers.closeCoordinator.dispose(); } };
}
try {
    setAppTestDate('2027-01-02'); UIRenderer.toast = () => {}; UIRenderer.handleActionError = () => {};
    for (const page of ['overview', 'balance']) for (const kind of ['empty', 'etf', 'invalid']) {
        const options = kind === 'invalid' ? { engineLoader: { load: async () => { throw new Error('ENGINE_INJECTED'); } } }
            : { prepareMarketData: async () => {
                if (kind === 'empty') throw new Error('ABRUF_INJECTED');
                return { ok: false, results: { errors: [{ step: 'ETF & Nachrücken', error: 'offline' }] } };
            } };
        const f = page === 'overview' ? await overviewAnnualFixture({ coordinatorOptions: options }) : await balanceFixture();
        let point;
        if (page === 'balance') {
            point = await createAnnualSnapshot({ storage: f.storage, archive: SnapshotArchive, profileId: f.storage.getItem('rs_current_profile'),
                label: 'Synthetischer Jahrespunkt', date: annualTestNow(), check: () => {}, snapshotId: 'synthetic / ä & point' });
            const snapshot = await SnapshotArchive.readSnapshot(point);
            f.handlers.snapshots.handleJahresabschluss = async () => kind === 'invalid' ? { status: 'invalid', error: new Error('ENGINE_INJECTED') }
                : { status: 'incomplete_recovery', recovery: { snapshotId: point, periodId: 'calendar-year:2026' },
                    ...(kind === 'etf' ? { results: { targetYear: 2026, errors: [{ step: 'ETF & Nachrücken', error: 'offline' }] },
                        retryContext: { snapshotId: point, periodId: 'calendar-year:2026' } } : {}) };
            assert(snapshot.label === 'Synthetischer Jahrespunkt', 'Balance-Recoverytest verwendet echten Archivpunkt');
        }
        let navigated = null;
        const create = f.doc.createElement;
        f.doc.createElement = tag => { const node = create(tag); if (tag === 'a') node.click = () => { navigated = node.getAttribute('href'); }; return node; };
        const running = f.open(); await prepareCloseFixture(f.doc); await annualUntil(() => f.doc.getElementById('annualConfirmBtn')?.disabled === false);
        await f.doc.getElementById('annualConfirmBtn').fire('click'); const result = await running;
        const root = f.doc.getElementById('balanceAnnualClose'), load = root.querySelector('#annualLoadRecovery');
        assert(root.dataset.annualYearResult !== 'confirmed', page + '/' + kind + ': keine vorgetäuschte Jahresbestätigung');
        assertEqual(Boolean(load), kind !== 'invalid', page + '/' + kind + ': allgemeiner Ladeknopf nur bei Recovery');
        if (kind !== 'invalid') {
            const recovery = await projectAnnualCloseRecovery(result, { archive: SnapshotArchive });
            assert(text(root).includes(recovery.label) && text(root).includes('Gesichert am'), page + '/' + kind + ': vorhandenes Archivlabel und Datum sichtbar');
            assert(text(root).includes('nicht vollständig bestätigt'), page + '/' + kind + ': ruhige vollständige Recoverymeldung');
            assertEqual(Boolean(root.querySelector('#annualHandPrice') && !f.doc.getElementById('annualRetryBtn').hidden), kind === 'etf', page + '/' + kind + ': ETF-Handkursweg nur mit Retrykontext');
            await load.fire('click');
            assertEqual(navigated, 'Daten-Sicherung.html?punkt=' + encodeURIComponent(recovery.snapshotId) + '#wiederherstellung', page + '/' + kind + ': Ladeknopf trägt die korrekte konkrete Kennung');
        } else await f.doc.getElementById('annualCloseBtn').fire('click');
        f.close();
    }
    for (const page of ['overview', 'balance']) {
        let failFactory = true;
        const f = page === 'overview' ? await overviewAnnualFixture({ monthFactory: async options => {
            if (failFactory) { failFactory = false; throw new Error('SESSION_INJECTED'); }
            return createAnnualMonthSession(options);
        } }) : await balanceFixture();
        if (page === 'balance') {
            const readModel = f.handlers.getAnnualModel;
            f.handlers.getAnnualModel = () => {
                const model = readModel();
                return failFactory && model.occasion.annualState === 'done' ? { ...model, summary: null } : model;
            };
        }
        const running = f.open(); await prepareCloseFixture(f.doc); await annualUntil(() => f.doc.getElementById('annualConfirmBtn')?.disabled === false);
        await f.doc.getElementById('annualConfirmBtn').fire('click'); await running;
        const afterYear = await f.persistence.readPersistedRecords();
        assert(text(f.doc.getElementById('balanceAnnualClose')).includes('Jahr gespeichert'), page + ': Sitzungserzeugungsfehler erhält sichtbaren Jahreserfolg');
        assert(f.doc.getElementById('annualMonthStepConfirm'), page + ': Sitzungserzeugungsfehler bietet Monatsretry');
        assertEqual(f.snapshots.size, 1, page + ': Erzeugungsfehler hat noch keinen Monatspunkt');
        failFactory = false;
        await f.doc.getElementById('annualMonthStepConfirm').fire('click');
        assert(f.doc.querySelector('[data-annual-combined-result="C"]'), page + ': Retry erzeugt den kombinierten Beleg');
        const afterMonth = await f.persistence.readPersistedRecords();
        for (const key of [CONFIG.STORAGE.LS_KEY, ANNUAL_PLAN_RECORD_KEY, 'household_plan_v1', 'profile_tagesgeld'])
            assertEqual(afterMonth[key], afterYear[key], page + ': Monatsretry erhält ' + key + ' bytegleich');
        assertEqual(f.snapshots.size, 2, page + ': Monatsretry besitzt eigenen bestätigten Punkt');
        assertEqual(f.batches.filter(batch => batch.upserts.some(([key]) => key === ANNUAL_PLAN_RECORD_KEY)).length, 1, page + ': Fabrikretry wiederholt keinen Jahreswrite');
        await f.doc.getElementById('annualConfirmBtn').fire('click'); f.close();
    }
    // Der Einzelprofil-Fallback des Monatswriters bleibt an den echten Umfang
    // gebunden, auch wenn sich die Mitgliedschaft während des Vorflushs ändert.
    for (const withCash of [false, true]) for (const changeScope of [false, true]) {
        const sample = readyAnnualFixture('Einzelprofil'), env = await annualServiceFixture({ sample });
        const activeId = sample.records.rs_current_profile;
        const cash = withCash ? { people: captureCashPeople({ storage: env.storage, ids: sample.scope.ids, activeId }),
            values: { [activeId]: Number(sample.records.profile_tagesgeld) } } : undefined;
        const before = env.storage.getItem(CONFIG.STORAGE.LS_KEY);
        const options = { storage: env.storage, persistence: env.persistence, archive: SnapshotArchive,
            guard: null, isBlocked: () => false, now: annualTestNow, flush: async () => {
                if (changeScope) {
                    const registry = JSON.parse(env.storage.getItem('rs_profiles_v1'));
                    registry.profiles.foreign = structuredClone(registry.profiles[activeId]);
                    registry.profiles.foreign.meta = { ...registry.profiles.foreign.meta, id: 'foreign', belongsToHousehold: true };
                    env.storage.setItem('rs_profiles_v1', JSON.stringify(registry));
                }
                return env.persistence.flush();
            } };
        let saved = false;
        try { saved = await storeMonthProvision({ month: '2026-12', scope: sample.scope, expectedProfileId: activeId, cash }, options); }
        catch (error) { assertEqual(error.message, 'OVERVIEW_CONTEXT_CHANGED', 'Cash-Monatswrite weist geänderten Umfang ab'); }
        assertEqual(saved, !changeScope, `${withCash}/${changeScope}: Einzelprofil ohne Mitgliedschaft oder geänderter Umfang`);
        assertEqual(Boolean(readMonthProvision(env.storage.getItem(OVERVIEW_MONTH_KEY), '2026-12', sample.scope)), !changeScope,
            'Einzelbeleg entsteht ausschließlich für den weiterhin gültigen Umfang');
        assertEqual(env.storage.getItem(CONFIG.STORAGE.LS_KEY), before, 'Monatswriter verändert keinen Jahresstate');
        if (changeScope) {
            assertEqual(env.snapshots.size, 0, 'Umfangwechsel vor dem Write erzeugt keinen Monatsvorabpunkt');
            assertEqual(await storeMonthProvision({ month: '2026-12', scope: overviewScope('single', ['foreign']),
                expectedProfileId: activeId, cash }, options), false, 'Fremder Einzelumfang umgeht den Umfangguard nicht');
        }
    }
    for (const changedKey of ['profile_tagesgeld', 'household_plan_v1']) {
        const sample = readyAnnualFixture('Einzelprofil'), env = await annualServiceFixture({ sample });
        const activeId = sample.records.rs_current_profile;
        const cash = { people: captureCashPeople({ storage: env.storage, ids: sample.scope.ids, activeId }),
            values: { [activeId]: Number(sample.records.profile_tagesgeld) } };
        const changed = changedKey === 'profile_tagesgeld' ? '777' : sample.records[changedKey] + ' ';
        const monthBefore = env.storage.getItem(OVERVIEW_MONTH_KEY);
        let rejected = false;
        try {
            await storeMonthProvision({ month: '2026-12', scope: sample.scope, expectedProfileId: activeId, cash }, {
                storage: env.storage, persistence: env.persistence, guard: null, now: annualTestNow,
                flush: () => env.persistence.flush(), isBlocked: () => false,
                archive: { ...SnapshotArchive, async createSnapshot(...args) {
                    const point = await SnapshotArchive.createSnapshot(...args);
                    env.storage.setItem(changedKey, changed);
                    return point;
                } }
            });
        } catch (error) { rejected = error.message === 'OVERVIEW_SOURCE_CHANGED'; }
        assert(rejected, changedKey + ': echte Finanzänderung während des Vorabpunkts bleibt abgewiesen');
        assertEqual(env.storage.getItem(changedKey), changed, 'Quellenvergleich ersetzt fremde Finanzbytes nicht');
        assertEqual(env.storage.getItem(OVERVIEW_MONTH_KEY), monthBefore, 'Abgewiesene Quelle bewahrt vorhandene Monatsrohbytes');
        assertEqual(readMonthProvision(env.storage.getItem(OVERVIEW_MONTH_KEY), '2026-12', sample.scope), null, 'Abgewiesene Quelle erhält keinen Dezemberbeleg');
    }
} finally {
    restoreBinder(); locks(); globalThis.document = old.doc; globalThis.window = old.win; setAppTestDate(old.date);
    UIRenderer.toast = old.toast; UIRenderer.handleActionError = old.error; PersistenceFacade.resetPersistenceRuntimeForTests();
}
