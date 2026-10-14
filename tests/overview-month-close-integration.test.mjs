import { prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { liveCashData } from '../app/profile/profile-cash-update.js';
import { loadProfileAssetValues, saveProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { projectOverview } from '../app/overview/overview-model.js';
import { bindOverviewMonthClose } from '../app/overview/overview-main.js';
import { overviewScope, storeOverviewSummary, readOverviewSummary, readMonthProvision, OVERVIEW_MONTH_KEY, OVERVIEW_SUMMARY_KEY } from '../app/overview/overview-storage.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { createNavigationOperationLifecycle } from '../app/shared/navigation-guard.js';
import { createProbelaufController } from '../app/shared/probelauf-state.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { switchProfile } from '../app/profile/profile-storage.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';

const nodesFor = node => [node, ...node.children.flatMap(nodesFor)];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function bounded(job) {
    let timer;
    try { return await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Integrationsfall ohne Abschluss')), 2000); })]); }
    finally { clearTimeout(timer); }
}
function dom() {
    const { doc } = createDialogFixture();
    const navigationOpened = deferred();
    const expensesPreviewOpened = deferred();
    const createElement = doc.createElement;
    doc.createElement = tag => {
        const node = createElement(tag), showModal = node.showModal;
        node.showModal = function () {
            showModal.call(this);
            if (this.id === 'navigationGuardDialog') navigationOpened.resolve();
            if (this.id === 'expensesImportPreview') expensesPreviewOpened.resolve(this);
        };
        return node;
    };
    const hosts = Object.fromEntries(['overviewFocus', 'overviewFocusTitle', 'overviewMonthStatus', 'suiteNavigationStatus',
        'navigationGuardDialog', 'navigationGuardStay', 'navigationGuardLeave', 'navigationGuardTitle', 'navigationGuardDescription'].map(id => {
            const node = doc.createElement(id === 'navigationGuardDialog' ? 'dialog' : 'div');
            node.id = id; doc.body.append(node); return [id, node];
        }));
    return { doc, hosts, navigationOpened, expensesPreviewOpened, renderButtons() {
        // Wie beim Seitenrefresh ersetzen neue Knöpfe die bisherigen Auslöser.
        hosts.overviewFocus.children.slice().forEach(node => node.remove());
        return [true, false].map(primary => {
            const button = doc.createElement('button'); button.setAttribute('data-overview-month', '');
            if (primary) button.setAttribute('data-overview-month-confirm', '');
            hosts.overviewFocus.append(button); return button;
        });
    } };
}
async function fixture({ hold = null, fail = false, snapshotFail = false, readback = false, rollbackFails = false, activeProbelauf = false, divergentCash = false } = {}) {
    const beforeGlobals = Object.fromEntries(['document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const oldDate = getAppTestDate();
    const { doc, hosts, navigationOpened, expensesPreviewOpened, renderButtons } = dom();
    const win = { document: doc, location: { href: 'http://localhost/index.html?probelauf=1' } };
    doc.defaultView = win;
    globalThis.document = doc; globalThis.window = win;
    setAppTestDate(null);
    const backend = new Map(), snapshots = new Map(), events = [], entered = deferred(), release = deferred();
    let armed = false, failed = false, corruptRead = false, sawMonth = false;
    const adapter = { name: 'overview-month-integration', async open() {},
        async loadAll() {
            events.push('read'); const records = Object.fromEntries(backend);
            if (corruptRead) { corruptRead = false; records.profile_tagesgeld = '999999'; }
            return records;
        },
        async saveBatch({ deletes, upserts }) {
            const stage = upserts.some(([key]) => key === OVERVIEW_MONTH_KEY) ? 'month' : 'before';
            events.push('write:' + stage);
            if (armed && rollbackFails && sawMonth && stage === 'before') throw new Error('Synthetischer Rollbackfehler');
            if (armed && stage === hold) { entered.resolve(); await release.promise; }
            if (armed && stage === 'month' && fail && !failed) { failed = true; throw new Error('Synthetischer Schreibfehler'); }
            deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, value]) => backend.set(key, value));
            events.push('confirmed:' + stage);
            if (armed && stage === 'month') { sawMonth = true; if (readback && !failed) { failed = true; corruptRead = true; } }
        },
        async listSnapshots() { return [...snapshots.values()]; },
        async readSnapshot(id) { return structuredClone(snapshots.get(id)); },
        async writeSnapshot(snapshot) {
            if (armed && hold === 'snapshot') { entered.resolve(); await release.promise; }
            if (armed && snapshotFail) { snapshotFail = false; throw new Error('OVERVIEW_SNAPSHOT_FAILED'); }
            snapshots.set(snapshot.id, structuredClone(snapshot));
        },
        async deleteSnapshot(id) { snapshots.delete(id); }
    };
    P.resetPersistenceForTests(adapter);
    await P.init({ window: win, installLifecycleHooks: false, installTauriCloseHook: false });
    const scope = overviewScope('household', ['a', 'b']);
    const registry = { version: 1, profiles: Object.fromEntries(['a', 'b', 'c'].map(id => [id,
        { meta: { id, name: id, belongsToHousehold: id !== 'c' }, data: { profile_tagesgeld: '100' } }])) };
    const liveData = { profile_tagesgeld: '100' };
    if (divergentCash) {
        registry.profiles.a.data.profile_cash_history_v1 = JSON.stringify({ version: 1, baselineValue: 110, entries: [{ date: '2026-09-01', value: 100 }] });
        liveData.profile_tagesgeld = '120.125';
        liveData.profile_cash_history_v1 = JSON.stringify({ version: 1, baselineValue: 130, entries: [{ date: '2026-10-01', value: 120.125 }] });
    }
    for (const [key, value] of Object.entries({ rs_profiles_v1: JSON.stringify(registry), rs_current_profile: 'a', rs_active_profile: 'a', ...liveData })) storage.setItem(key, value);
    const guard = getPageNavigationGuard(doc, win);
    await storeOverviewSummary({ year: 2026, scope, monthlyWithdrawal: 500, monthlyBudget: 800, createdAt: '2026-09-01T12:00:00Z' }, { expectedProfileId: 'a', guard });
    events.length = 0;
    let model, buttons, controls, viewDate = new Date(2026, 9, 8, 12);
    const project = () => projectOverview({ registry: JSON.parse(storage.getItem('rs_profiles_v1')), activeId: 'a',
        liveData: liveCashData(storage), now: viewDate });
    const refresh = () => {
        const projected = project();
        const committed = readMonthProvision(storage.getItem(OVERVIEW_MONTH_KEY), '2026-09', projected.scope);
        model = controls.projectModel({ ...projected, summary: readOverviewSummary(storage.getItem(OVERVIEW_SUMMARY_KEY), 2026, projected.scope),
            occasion: { kind: committed ? 'play' : 'monthly', month: '2026-09', previousYear: 2026, previousMonth: 9 } });
        buttons = renderButtons(); controls.syncButtons();
    };
    // Weder Store, Nachfrage noch Guardmethoden werden ersetzt.
    controls = bindOverviewMonthClose({ doc, win, getModel: () => model, refresh }); refresh();
    let controller = createProbelaufController({ win, guard, demoLoader: null, reload() {}, restoreReload() {} });
    await controller.initialize();
    if (activeProbelauf) {
        await controller.start(() => ({ source: 'copy', testDate: '2026-10-01' }));
        // Frisches Controller-/Facadeleben auf demselben dauerhaften Bestand.
        guard.revokeNative(); P.resetPersistenceForTests(adapter);
        await P.init({ window: win, installLifecycleHooks: false, installTauriCloseHook: false });
        controller = createProbelaufController({ win, guard, demoLoader: null, reload() {}, restoreReload() {} });
        await controller.initialize();
    }
    events.length = 0;
    armed = true;
    return { doc, win, guard, controller, backend, events, entered, release, refresh, navigationOpened, expensesPreviewOpened,
        get status() { return hosts.overviewMonthStatus.textContent; }, get buttons() { return buttons; }, get model() { return model; },
        get dialog() { return doc.body.children.find(node => node.id === 'overviewMonthConfirmation'); },
        changeViewDate(date) { viewDate = date; refresh(); },
        click: index => hosts.overviewFocus.fire('click', { target: buttons[index] }),
        accept() { this.acceptJob = (async () => { await prepareCloseFixture(doc); return nodesFor(this.dialog).find(node => Object.hasOwn(node.dataset, 'overviewMonthAccept')).fire('click'); })(); return this.acceptJob; },
        async done() {
            await this.acceptJob;
            assertEqual(this.dialog?.dataset.monthResult, 'confirmed', 'Echter Store lässt dauerhafte Ergebnisinstanz offen');
            await nodesFor(this.dialog).find(node => Object.hasOwn(node.dataset, 'overviewMonthAccept')).fire('click');
        },
        async discard() { if (hosts.navigationGuardDialog.open) await hosts.navigationGuardLeave.fire('click'); },
        fields() { return nodesFor(this.dialog).filter(node => node.dataset.tagesgeldPerson); },
        get snapshots() { return snapshots; },
        stay: () => hosts.navigationGuardStay.fire('click'),
        leave: () => hosts.navigationGuardLeave.fire('click'),
        get navigationDialog() { return hosts.navigationGuardDialog; },
        async close(job) {
            release.resolve(); await this.dialog?.fire('cancel'); await hosts.navigationGuardStay.fire('click');
            await this.discard();
            try { if (job) await bounded(job); }
            finally {
                P.resetPersistenceForTests(); setAppTestDate(oldDate);
                for (const [key, descriptor] of Object.entries(beforeGlobals)) {
                    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
                }
            }
        }
    };
}
async function assertCompetingActionsBlocked(f, label) {
    const before = JSON.stringify(Object.fromEntries(f.backend));
    const date = getAppTestDate();
    // Derselbe Operations-Lifecycle wie vor switchProfile im Profilmanager.
    const profileWrites = createNavigationOperationLifecycle({ guard: f.guard });
    let profileError;
    try { await profileWrites.run({}, operation => { operation.commit(); return switchProfile('b'); }); } catch (error) { profileError = error; }
    assertEqual(profileError?.code, 'NAVIGATION_WRITE_BUSY', label + ': Profilwechsel gesperrt');
    assertEqual(storage.getItem('rs_current_profile'), 'a', label + ': Profilidentität unverändert');
    const jump = await (f.controller.state ? f.controller.changeDate('2027-07-01')
        : f.controller.start(() => ({ source: 'copy', testDate: '2027-07-01' })));
    assertEqual(jump.status, 'cancelled', label + ': Datumssprung gesperrt');
    assertEqual(getAppTestDate(), date, label + ': Testuhr unverändert');
    let writeError;
    try { await SnapshotArchive.createSnapshot({ id: 'foreign', records: {} }, { guard: f.guard }); } catch (error) { writeError = error; }
    assertEqual(writeError?.code, 'NAVIGATION_WRITE_BUSY', label + ': fremder Writer gesperrt');
    assertEqual(JSON.stringify(Object.fromEntries(f.backend)), before, label + ': keine fremden dauerhaften Writes');
}

{
    const f = await fixture(); let job;
    try {
        setAppTestDate('2026-10-08');
        saveProfileAssetValues({ ...loadProfileAssetValues(storage), tagesgeld: 150 }, storage, { recordCashChange: true });
        await P.flush(); f.refresh();
        job = f.click(0);
        f.fields()[0].value = '90'; f.fields()[1].value = '80';
        await f.accept(); await f.done(); await bounded(job);
        const records = await P.readPersistedRecords();
        assertEqual(JSON.stringify(JSON.parse(records.profile_cash_history_v1).entries), '[{"date":"2026-10-08","value":90}]',
            'Monatsabschluss nach Handänderung am selben Tag ergibt genau einen Eintrag am Testdatum');
        const monthEvidence = records[OVERVIEW_MONTH_KEY];
        const registry = JSON.parse(records.rs_profiles_v1);
        const otherMonthEvidence = registry.profiles.b.data[OVERVIEW_MONTH_KEY];
        saveProfileAssetValues({ ...loadProfileAssetValues(storage), tagesgeld: 100 }, storage, { recordCashChange: true });
        await P.flush();
        assertEqual(JSON.parse(storage.getItem('profile_cash_history_v1')).entries.length, 0, 'Handänderung zurück zur Basis entfernt auch den Abschlusstag aus der Cashhistorie');
        assertEqual(storage.getItem(OVERVIEW_MONTH_KEY), monthEvidence, 'Monatsabschlussbeleg bleibt beim Entfernen des Cash-Tageseintrags bytegleich');
        assertEqual(JSON.parse(storage.getItem('rs_profiles_v1')).profiles.b.data[OVERVIEW_MONTH_KEY], otherMonthEvidence,
            'Abschlussbeleg der zweiten Person bleibt bytegleich');
    } finally { await f.close(job); }
}

// Derselbe Produktnachweis wird vor und nach der Reparatur für beide Knöpfe ausgeführt.
const failures = [];
for (const index of [1, 0]) {
    const f = await fixture(); let job;
    try {
        job = f.click(index);
        assert(f.dialog?.open, 'Beide Einstiege öffnen echte Monatsnachfrage'); await f.accept();
        await f.done(); await bounded(job);
        assertEqual(f.status, 'September abgeschlossen ✓', (index ? 'Bereitgestellt' : 'Bestätigen → Annehmen') + ': Erfolg nach echtem Store');
        assert(f.events.includes('write:month'), 'PersistenceFacade.flush erreicht das Backend');
        const records = await P.readPersistedRecords();
        assert(readMonthProvision(records[OVERVIEW_MONTH_KEY], '2026-09', f.model.scope), 'Backendlesen bestätigt Livehaken');
        const registry = JSON.parse(records.rs_profiles_v1);
        assert(['a', 'b'].every(id => readMonthProvision(registry.profiles[id].data[OVERVIEW_MONTH_KEY], '2026-09', f.model.scope)), 'Backendlesen bestätigt alle Scopeprofile');
        assertEqual(f.guard.reasons().length, 0, 'Erfolg löst Monatsbesitz');
    } catch (error) {
        failures.push(error); console.error(error.message);
        console.error(JSON.stringify({ writes: f.events.filter(event => event.startsWith('write:')),
            durableMonth: f.backend.get(OVERVIEW_MONTH_KEY) ?? null }));
    }
    finally { await f.close(job); }
}
if (failures.length) throw failures[0];

for (const index of [0, 1]) {
    const f = await fixture();
    const lease = f.guard.register(Symbol('foreign-month-commit'), { read: () => ({ phase: 'commit' }) });
    try {
        const before = JSON.stringify(Object.fromEntries(f.backend));
        await bounded(f.click(index));
        assert(!f.dialog && !f.status.includes('abgeschlossen'), 'Fremder Commit verhindert Nachfrage und Erfolg');
        assertEqual(f.events.filter(event => event.startsWith('write:')).length, 0, 'Fremder Commit verhindert Monatswrite');
        assertEqual(JSON.stringify(Object.fromEntries(f.backend)), before, 'Fremder Commit erhält dauerhafte Bytes');
    } finally { lease.unregister(); await f.close(); }
}

for (const hold of ['before', 'month']) {
    const f = await fixture({ hold, activeProbelauf: true }); let job;
    try {
        if (hold === 'before') { storage.setItem('profile_tagesgeld', '101'); f.refresh(); }
        job = f.click(1); void f.accept();
        await bounded(Promise.race([f.entered.promise, job.then(() => { throw new Error('Monatsabschluss erreicht Flushgrenze nicht'); })]));
        f.refresh();
        assert(f.buttons.every(button => button.disabled), hold + ': beide Knöpfe während Flush gesperrt');
        assertEqual(f.model.occasion.kind, 'monthly', hold + ': kein früher ruhiger Anlass');
        assert(!f.status.includes('abgeschlossen ✓'), hold + ': kein früher Erfolgsstatus');
        assertEqual(await f.guard.prepare(), null, hold + ': Navigation während Flush gesperrt');
        let unloadBlocked = false; f.guard.beforeUnload({ preventDefault() { unloadBlocked = true; } });
        assert(unloadBlocked, hold + ': nativer Wechsel geschützt');
        await assertCompetingActionsBlocked(f, hold);
        assertEqual(f.backend.get(OVERVIEW_MONTH_KEY), undefined, hold + ': noch kein dauerhafter Haken');
        f.release.resolve(); await f.done(); await bounded(job);
        assertEqual(f.status, 'September abgeschlossen ✓', hold + ': erst Backendbestätigung erlaubt Erfolg');
    } finally { await f.close(job); }
}

for (const outcome of ['stay', 'cancel', 'leave', 'foreign', 'jump']) {
    const f = await fixture({ activeProbelauf: outcome === 'jump' }); let job, navigation, foreign;
    try {
        job = f.click(0);
        assert(f.dialog?.open, outcome + ': echte Nachfrage offen');
        const profileWrites = createNavigationOperationLifecycle({ guard: f.guard });
        assert(!profileWrites.isBlocked(), outcome + ': sauberer Dialog meldet keinen fremden laufenden Writer');
        let writeError;
        try { await SnapshotArchive.createSnapshot({ id: 'foreign', records: {} }, { guard: f.guard }); } catch (error) { writeError = error; }
        assertEqual(writeError, undefined, outcome + ': sauberer Dialog blockiert eigene CSV-Folgejobs nicht');
        if (outcome === 'stay' || outcome === 'leave') {
            const dirtyLease = f.guard.register(Symbol('cash-draft'), { read: () => ({ phase: 'idle', dirty: true }) });
            navigation = f.guard.prepare();
            assert(f.navigationDialog.open, outcome + ': echter Navigationsdialog erreichbar');
            await (outcome === 'stay' ? f.stay() : f.leave());
            const attempt = await bounded(navigation);
            dirtyLease.unregister();
            if (outcome === 'stay') { assertEqual(attempt, null, 'Bleiben behält Monatsnachfrage'); await f.accept(); await f.done(); }
            else { assert(attempt, 'Wechsel erhält Guardzustimmung'); f.guard.end(attempt); await f.dialog.fire('cancel'); }
        } else if (outcome === 'jump') {
            const date = getAppTestDate();
            const dirtyLease = f.guard.register(Symbol('cash-draft'), { read: () => ({ phase: 'idle', dirty: true }) });
            navigation = f.controller.changeDate('2027-07-01');
            await bounded(f.navigationOpened.promise);
            await f.stay();
            dirtyLease.unregister();
            assertEqual((await bounded(navigation)).status, 'cancelled', 'Datumssprung während Monatsnachfrage braucht Zustimmung');
            assertEqual(getAppTestDate(), date, 'Abgelehnter Datumssprung erhält Testuhr');
            assert(f.dialog?.open, 'Abgelehnter Datumssprung erhält Monatsnachfrage');
            await f.dialog.fire('cancel');
        } else if (outcome === 'foreign') {
            foreign = f.guard.register(Symbol('foreign-after-confirmation'), { read: () => ({ phase: 'commit' }) });
            await f.accept(); foreign.unregister(); foreign = null; await f.dialog.fire('cancel');
        } else await f.dialog.fire('cancel');
        await bounded(job);
        assertEqual(Boolean(f.backend.get(OVERVIEW_MONTH_KEY)), outcome === 'stay', outcome + ': nur passende Bestätigung schreibt');
        assertEqual(f.status.includes('abgeschlossen ✓'), outcome === 'stay', outcome + ': kein fremder oder abgebrochener Erfolg');
    } finally { foreign?.unregister(); await f.close(job); }
}

const failed = await fixture({ fail: true }); let failedJob;
try {
    failedJob = failed.click(1); await failed.accept();
    assert(failed.dialog?.open, 'Backendfehler erhält dieselbe Dialoginstanz für Retry');
    assert(!failed.status.includes('abgeschlossen ✓'), 'Backendfehler bestätigt keinen Erfolg');
    assertEqual(storage.getItem(OVERVIEW_MONTH_KEY), null, 'Backendfehler nimmt Cachekandidaten zurück');
    assertEqual((await P.readPersistedRecords())[OVERVIEW_MONTH_KEY], undefined, 'Rollback hinterlässt keinen dauerhaften Haken');
    assertEqual(failed.guard.reasons().length, 0, 'Backendfehler löst Commitbesitz');
    await failed.accept(); await failed.done(); await bounded(failedJob);
    assertEqual(failed.status, 'September abgeschlossen ✓', 'Retry nach Backendfehler speichert dauerhaft');
    assertEqual(failed.snapshots.size, 1, 'Retry nach Snapshotfehler nutzt ursprünglichen Sicherungsbeleg');
} finally { await failed.close(failedJob); }

// Ein vom Browser erzwungener Close darf einen fehlgeschlagenen Commit nicht verwaisen lassen.
{
    const f = await fixture({ hold: 'month', fail: true }); let job, acceptJob;
    try {
        job = f.click(0); acceptJob = f.accept();
        await bounded(f.entered.promise);
        const closedDialog = f.dialog;
        closedDialog.close();
        assert(f.buttons.every(button => button.disabled), 'Nativer Close während Store hält den Start bis zum Commitende gesperrt');
        assert(f.guard.reasons().some(reason => reason.phase === 'commit'), 'Nativer Close erhält den laufenden Storebesitz');
        f.release.resolve(); await bounded(acceptJob); await bounded(job);
        assert(!f.dialog, 'Nativer Close mit Backendfehler entfernt den Monatsdialog nach Commitende');
        assertEqual(f.guard.reasons().length, 0, 'Nativer Close mit Backendfehler räumt die Monatslease auf');
        assert(f.buttons.every(button => !button.disabled), 'Startknopf bleibt nach nativem Close mit Backendfehler bedienbar');
        assert(f.doc.activeElement === f.buttons[0], 'Nativer Close mit Backendfehler fokussiert den aktuellen Startknopf');
        assertEqual((await P.readPersistedRecords())[OVERVIEW_MONTH_KEY], undefined, 'Fehlgeschlagener nativ geschlossener Auftrag hinterlässt keinen Monatshaken');
        job = f.click(0);
        assert(f.dialog?.open, 'Monatsdialog lässt sich nach nativem Close mit Backendfehler erneut öffnen');
        await f.accept(); await f.done(); await bounded(job);
        assertEqual(f.status, 'September abgeschlossen ✓', 'Erneuter Monatsabschluss nach nativem Close speichert erfolgreich');
    } finally { f.release.resolve(); if (acceptJob) await bounded(acceptJob); await f.close(job); }
}

// A+B ändern gemeinsam; Außenprofil und fremde Rohwerte bleiben bytegleich.
for (const outcome of ['cancel', 'escape', 'save']) {
    const f = await fixture(); let job;
    try {
        const before = JSON.stringify(Object.fromEntries(f.backend));
        const outside = JSON.stringify(JSON.parse(f.backend.get('rs_profiles_v1')).profiles.c);
        job = f.click(1);
        const fields = f.fields();
        assertEqual(fields.map(field => field.dataset.tagesgeldPerson).join(','), 'a,b', 'Genau zwei richtig zugeordnete Haushaltsfelder');
        fields[0].value = '90,125'; fields[1].value = '80.25';
        await f.click(0);
        if (outcome === 'save') { await f.accept(); await f.done(); }
        else { await f.dialog.fire(outcome === 'cancel' ? 'cancel' : 'keydown', { key: 'Escape' }); await f.discard(); }
        await bounded(job);
        if (outcome !== 'save') {
            assertEqual(JSON.stringify(Object.fromEntries(f.backend)), before, 'Abbruch und Escape erhalten dauerhafte Fachbytes');
            assertEqual(f.snapshots.size, 0, 'Abbruch und Escape erzeugen keinen Archivbeleg');
            continue;
        }
        const records = await P.readPersistedRecords();
        const profiles = JSON.parse(records.rs_profiles_v1).profiles;
        assertEqual(records.profile_tagesgeld, '90.125', 'Dauerhafter Livewert A');
        assertEqual(profiles.b.data.profile_tagesgeld, '80.25', 'Dauerhafter Registrywert B');
        assertEqual(JSON.parse(records.profile_cash_history_v1).entries.length, 1, 'Doppelklick hängt einen Cashbeleg an');
        assertEqual(JSON.parse(profiles.b.data.profile_cash_history_v1).entries.length, 1, 'Ein Cashbeleg für B');
        assertEqual(JSON.stringify(profiles.c), outside, 'Außenprofil bytegleich');
        assertEqual(f.snapshots.size, 1, 'Ein Wiederherstellungspunkt');
        const scope = f.model.scope;
        const { storeMonthProvision } = await import('../app/overview/overview-storage.js');
        const repeat = { month: '2026-09', scope, expectedProfileId: 'a', cash: { people: f.model.cashPeople, values: { a: 90.125, b: 80.25 } } };
        assert(await storeMonthProvision(repeat, { guard: f.guard }), 'Identische Wiederholung bestätigt bestehenden vollständigen Satz');
        assertEqual(f.snapshots.size, 1, 'Wiederholung erzeugt keinen zweiten Sicherungspunkt');
        P.resetPersistenceForTests({ name: 'Neustart', async open() {}, async loadAll() { return Object.fromEntries(f.backend); }, async saveBatch() {} });
        await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        assertEqual(storage.getItem('profile_tagesgeld'), '90.125', 'Neustart liest denselben dauerhaften Ist-Stand');
        assertEqual(storage.getItem('rs_profiles_v1'), records.rs_profiles_v1, 'Neustart liest vollständigen Registrycommit');
    } finally { await f.close(job); }
}

// Produktprojektion → Monatsdialog → Store: Livebelege dürfen von Registry A abweichen.
{
    const f = await fixture({ divergentCash: true }); let job;
    try {
        const outside = JSON.stringify(JSON.parse(f.backend.get('rs_profiles_v1')).profiles.c);
        const liveHistoryRaw = storage.getItem('profile_cash_history_v1');
        const liveHistory = JSON.parse(liveHistoryRaw);
        assertEqual(f.model.cashPeople.map(person => person.id).join(','), 'a,b', 'Produktmodell schließt Außenprofil C vor dem Monatsdialog aus');
        assertEqual(f.model.cashPeople[0].cashRaw, '120.125', 'Produktmodell übernimmt abweichenden aktiven Livecashrohwert');
        assertEqual(f.model.cashPeople[0].historyRaw, liveHistoryRaw, 'Produktmodell übernimmt abweichende aktive Livehistorie bytegleich');
        job = f.click(0);
        const fields = f.fields();
        assertEqual(fields.map(field => field.dataset.tagesgeldPerson).join(','), 'a,b', 'Monatsdialog verwendet die produktiv projizierten Personen');
        assertEqual(Number(fields[0].value.replace(',', '.')), 120.125, 'Monatsdialog zeigt den aktiven Livewert');
        assertEqual(f.doc.getElementById(fields[0].id + '-hint').textContent, 'zuletzt bestätigt am 01.10.2026: 120,125 €', 'Monatsdialog zeigt Kurzdatum mit Schlusspunkt und ungerundeten Livebetrag');
        assertEqual(f.doc.getElementById(fields[1].id + '-hint').textContent, 'Noch kein datierter Tagesgeld-Stand', 'Monatsdialog erfindet keinen fehlenden Beleg für B');
        fields[0].value = '90,125'; fields[1].value = '80.25';
        await f.accept(); await f.done(); await bounded(job);
        assertEqual(f.status, 'September abgeschlossen ✓', 'Projizierte Livebelege passieren die echte Staleprüfung und den Store');
        const records = await P.readPersistedRecords();
        const profiles = JSON.parse(records.rs_profiles_v1).profiles;
        const committedHistory = JSON.parse(records.profile_cash_history_v1);
        assertEqual(records.profile_tagesgeld, '90.125', 'Produktpfad speichert aktiven Tagesgeldstand dauerhaft');
        assertEqual(profiles.a.data.profile_tagesgeld, '90.125', 'Produktpfad speichert aktiven Stand auch in Registry');
        assertEqual(profiles.a.data.profile_cash_history_v1, records.profile_cash_history_v1, 'Registry und Livebestand bestätigen dieselbe aktive Historie');
        assertEqual(committedHistory.baselineValue, liveHistory.baselineValue, 'Neue Historie erhält die Livebasis statt veralteter Registrybasis');
        assertEqual(JSON.stringify(committedHistory.entries.slice(0, -1)), JSON.stringify(liveHistory.entries), 'Neue Historie erhält den bisherigen Livebeleg bytegleich');
        assertEqual(committedHistory.entries.at(-1).value, 90.125, 'Neue Historie bestätigt den Dialogwert');
        assertEqual(profiles.b.data.profile_tagesgeld, '80.25', 'Produktpfad speichert zweiten Haushaltsstand dauerhaft');
        assert(['a', 'b'].every(id => readMonthProvision(profiles[id].data[OVERVIEW_MONTH_KEY], '2026-09', f.model.scope)), 'Produktpfad bestätigt dauerhaften Monatsabschluss für beide Personen');
        assertEqual(JSON.stringify(profiles.c), outside, 'Produktpfad erhält Außenprofil bytegleich');
    } finally { await f.close(job); }
}

for (const rollbackFails of [false, true]) {
    const f = await fixture({ readback: true, rollbackFails }); let job;
    try {
        const before = Object.fromEntries(f.backend);
        job = f.click(0);
        f.fields()[0].value = '90'; f.fields()[1].value = '80';
        await f.accept();
        assert(f.dialog?.open && !f.dialog.dataset.monthResult && f.fields()[0].value === '90', 'Readback- und Rollbackfehler erhalten Ergebnisfreiheit und Cashentwurf');
        if (rollbackFails) assert(nodesFor(f.dialog).find(node => node.dataset.overviewMonthAccept !== undefined).disabled, 'Recovery sperrt den unzulässigen Retry');
        await f.dialog.fire('cancel'); await f.discard(); await bounded(job);
        assert(!f.status.includes('abgeschlossen ✓'), 'Readbackfehler bestätigt keinen Teilerfolg');
        if (rollbackFails) assert(f.status.includes('Wiederherstellung erforderlich'), 'Unbestätigter Rollback wird sichtbar als Recoverybedarf gemeldet');
        else {
            const records = await P.readPersistedRecords();
            assertEqual(records.profile_tagesgeld, before.profile_tagesgeld, 'Readbackrollback erhält ursprünglichen Cashstand');
            assertEqual(records.profile_cash_history_v1, before.profile_cash_history_v1, 'Readbackrollback entfernt eigenen Historienkandidaten');
            assertEqual(records.rs_profiles_v1, before.rs_profiles_v1, 'Readbackrollback erhält beide Registrycashstände');
        }
    } finally { await f.close(job); }
}

// Startseiten-Beispielbinder: echter Importdienst, Guard und dauerhafter Speicher.
for (const mode of ['normal', 'cancel', 'single', 'all', 'dialog', 'dialog-cancel', 'context', 'flush']) {
    const f = await fixture({ activeProbelauf: mode !== 'normal', hold: mode === 'flush' ? 'before' : null });
    let job, cancelImport = () => {};
    try {
        const { bindOverviewExampleExpenses } = await import('../app/overview/overview-example-expenses.js');
        const { EXAMPLE_SOURCE } = await import('../app/demo/beispielausgaben.js');
        const status = f.doc.createElement('p'); status.id = 'overviewExampleExpensesStatus'; f.doc.body.appendChild(status);
        const button = f.doc.createElement('button'); button.dataset.overviewExample = mode === 'single' ? 'one' : 'all';
        let current = { ...f.model, recovery: false, expenseBudget: 800, expenses: { year: 2026, month: 9 }, occasion: { ...f.model.occasion, kind: 'monthly' } };
        let confirmations = 0, choices = 0;
        const gate = deferred(), ready = deferred();
        const originalQuery = f.doc.querySelectorAll;
        f.doc.querySelectorAll = selector => selector.includes('[data-overview-example]') ? [button] : originalQuery(selector);
        const controls = bindOverviewExampleExpenses({ doc: f.doc, win: f.win, controller: f.controller,
            getModel: () => current, refresh: () => controls.syncButtons(),
            choose: async ({ people }) => { choices++; assertEqual(people.map(person => person.id).join(','), 'a,b', 'Personenwahl enthält nur Haushaltsumfang'); return 'b'; },
            confirm: async (targets, context) => { confirmations++; assertEqual(targets.length, mode === 'single' ? 1 : 2, 'Gesamtvorschau enthält exakt gewählte Ziele');
                if (mode === 'dialog' || mode === 'dialog-cancel') return (await import('../app/balance/balance-expenses-import.js')).requestExpensesPreview(targets, { doc: f.doc, ...context });
                if (mode === 'context') { ready.resolve(); return gate.promise; } return mode !== 'cancel'; }
        });
        // Auch vor dem Dialogaufbau abbrechen: kein offener Job darf importTail blockieren.
        cancelImport = () => {
            controls.projectModel({ ...current, activeId: 'fixture-cleanup' });
            gate.resolve(false);
        };
        const before = storage.getItem('balance_expenses_v1');
        const writesBefore = f.events.filter(event => event.startsWith('write:')).length;
        job = f.doc.getElementById('overviewFocus').fire('click', { target: { closest: selector => selector === '[data-overview-example]' ? button : null } });
        if (mode === 'dialog' || mode === 'dialog-cancel') {
            // Das Fake-DOM meldet das tatsächliche showModal, unabhängig von Import-/Parserawaits.
            const dialog = await bounded(Promise.race([f.expensesPreviewOpened.promise,
                job.then(() => { throw new Error('Ausgabenimport endet vor dem Öffnen der Vorschau'); })]));
            assertEqual(dialog, f.doc.getElementById('expensesImportPreview'), 'Geöffnete Vorschau ist der gemeinsame DOM-Dialog');
            assert(dialog?.open, 'Gemeinsame Vorschau wird als echter modaler DOM-Dialog geöffnet');
            assertEqual(storage.getItem('balance_expenses_v1'), before, 'DOM-Vorschau ist vor Bestätigung schreibfrei');
            assertEqual(f.events.filter(event => event.startsWith('write:')).length, writesBefore, 'DOM-Vorschau schreibt vor Bestätigung nicht ins Backend');
            const fields = nodesFor(dialog);
            assert(fields.some(node => node.dataset.expensesPreviewTotal !== undefined && node.textContent.startsWith('Gesamt:')), 'Sammelvorschau weist Gesamtsumme aus');
            if (mode === 'dialog-cancel') {
                cancelImport();
                await bounded(job);
                assert(!dialog.open && !f.doc.body.children.includes(dialog), 'Bereinigung schließt und entfernt offene Importvorschau');
                assertEqual(f.guard.reasons().length, 0, 'Bereinigung beendet Importbesitz vor den Folgemodi');
                assertEqual(f.events.filter(event => event.startsWith('write:')).length, writesBefore, 'Bereinigung der Vorschau bleibt dauerhaft schreibfrei');
            } else await fields.find(node => node.dataset.expensesPreviewAccept !== undefined).fire('click');
        }
        if (mode === 'context') { await ready.promise; current = { ...current, activeId: 'b' }; controls.projectModel(current); gate.resolve(true); }
        if (mode === 'flush') {
            await f.entered.promise;
            assert(button.disabled, 'Sammelknopf ist während bestätigtem Flush gesperrt');
            assertEqual((await f.controller.end(() => true)).status, 'cancelled', 'Probelaufende darf bestätigten Ausgabenwrite nicht überholen');
            f.release.resolve();
        }
        await bounded(job);
        if (['normal', 'cancel', 'dialog-cancel', 'context'].includes(mode)) {
            assertEqual(storage.getItem('balance_expenses_v1'), before, 'Abbruch und verweigerter Handler bleiben schreibfrei');
            assertEqual(confirmations, mode === 'normal' ? 0 : 1, 'Nur bestätigter aktiver Probelauf erreicht Vorschau');
        } else {
            const saved = JSON.parse(f.backend.get('balance_expenses_v1'));
            const ids = Object.keys(saved.years[2026].months[9].profiles);
            assertEqual(ids.join(','), mode === 'single' ? 'b' : 'a,b', 'Binder schreibt ausschließlich gewählte Personen und Abschlussmonat');
            assert(ids.every(id => saved.years[2026].months[9].profiles[id].source === EXAMPLE_SOURCE), 'Beispielherkunft dauerhaft bestätigt');
            assertEqual(storage.getItem('balance_expenses_v1'), f.backend.get('balance_expenses_v1'), 'Startseitenimport bestätigt Cache und Backend');
            assert(status.textContent.includes('Beispielausgaben importiert.'), 'Bestätigter Binder meldet Personenerfolg sichtbar');
        }
        assertEqual(choices, mode === 'single' ? 1 : 0, 'Nur Einzelaktion fragt Personenauswahl');
        assertEqual(button.disabled, false, 'Controls nach Erfolg, Abbruch und Kontextfehler wieder bedienbar');
    } finally { cancelImport(); await f.close(job); }
}

for (const boundary of ['preflush', 'snapshot']) {
    const f = await fixture({ snapshotFail: boundary === 'snapshot' }); let job;
    const originalFlush = P.flush; let first = true;
    try {
        const before = JSON.stringify(Object.fromEntries(f.backend));
        job = f.click(0); f.fields()[0].value = '90';
        const root = f.dialog;
        if (boundary === 'preflush') P.flush = async (...args) => {
            if (first) { first = false; return false; } return originalFlush(...args);
        };
        await f.accept(); P.flush = originalFlush;
        assert(f.dialog === root && root.open && !root.dataset.monthResult, boundary + ': Fehler erhält dieselbe Instanz ohne Erfolg');
        assertEqual(f.fields()[0].value, '90', boundary + ': Eingabe bleibt für Retry erhalten');
        assertEqual(JSON.stringify(Object.fromEntries(f.backend)), before, boundary + ': kein Fachrecord verändert');
        assertEqual(f.snapshots.size, 0, boundary + ': kein unbestätigter Archivbeleg');
        await f.accept();
        assert(f.dialog === root && root.dataset.monthResult === 'confirmed', boundary + ': Retry zeigt dauerhaftes Ergebnis im ursprünglichen Host');
        assertEqual(f.snapshots.size, 1, boundary + ': Retry erzeugt genau einen geprüften Sicherungspunkt');
        const saved = JSON.stringify(Object.fromEntries(f.backend));
        await f.done(); await bounded(job);
        assertEqual(JSON.stringify(Object.fromEntries(f.backend)), saved, boundary + ': Fertig verändert keine Backendbytes');
    } finally { P.flush = originalFlush; await f.close(job); }
}

{
    const f = await fixture({ hold: 'snapshot' }); let job, commit;
    try {
        const before = JSON.stringify(Object.fromEntries(f.backend));
        job = f.click(0); f.fields()[0].value = '90'; commit = f.accept();
        await bounded(f.entered.promise);
        f.changeViewDate(new Date(2026, 9, 9, 12)); f.release.resolve();
        await bounded(commit); await bounded(job);
        assertEqual(JSON.stringify(Object.fromEntries(f.backend)), before, 'Fachdatumswechsel an echter Snapshotgrenze verhindert verspätete Monats- und Cashwrites');
        assert(!f.status.includes('abgeschlossen ✓') && !f.dialog, 'Fachdatumswechsel erzeugt weder Erfolg noch verwaiste Ergebnisinstanz');
        assertEqual(f.guard.reasons().length, 0, 'Fachdatumswechsel beendet alle Monatsguardgründe');
    } finally { f.release.resolve(); if (commit) await bounded(commit); await f.close(job); }
}
