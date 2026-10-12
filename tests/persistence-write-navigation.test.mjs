import { createNavigationGuard, createNavigationOperationLifecycle } from '../app/shared/navigation-guard.js';
import { PersistenceFacade as persistence, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { importFullPersistenceBackup, buildFullPersistenceBackup, bindFullBackupImport } from '../app/shared/persistence-backup.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { PROFILE_STORAGE_KEYS } from '../app/profile/profile-state.js';
import { createSnapshotHandlers } from '../app/balance/balance-binder-snapshots.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { BALANCE_UPDATE_MODE, persistBalanceUpdate } from '../app/balance/balance-update-pipeline.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
function unload(guard) { let blocked = false; guard.beforeUnload({ preventDefault() { blocked = true; } }); return blocked; }
function fixture(initial = { sim_old: 'bytes: ä 1.00' }) {
    const records = { ...initial }, snapshots = new Map();
    const gates = {}, entered = {};
    let writes = 0, reads = 0;
    const adapter = {
        name: 'navigation-memory', async open() {},
        async loadAll() { reads++; if (gates.read) { entered.read = true; await gates.read.promise; } return { ...records }; },
        async saveBatch({ deletes, upserts }) {
            writes++;
            const gate = gates[`write${writes}`];
            if (gate) { entered[`write${writes}`] = true; await gate.promise; }
            if (gates.failWrite === writes) throw new Error('SYNTHETIC_WRITE_FAILURE');
            deletes.forEach(key => { delete records[key]; });
            upserts.forEach(([key, value]) => { records[key] = value; });
        },
        async writeSnapshot(snapshot) { if (gates.snapshot) { entered.snapshot = true; await gates.snapshot.promise; } snapshots.set(snapshot.id, snapshot); },
        async readSnapshot(id) { if (gates.snapshotRead) { entered.snapshotRead = true; await gates.snapshotRead.promise; } return snapshots.get(id); },
        async listSnapshots() { return [...snapshots.values()]; },
        async deleteSnapshot(id) { if (gates.delete) { entered.delete = true; await gates.delete.promise; } snapshots.delete(id); }
    };
    const statuses = [];
    const guard = createNavigationGuard({ decide: async () => true, status: message => statuses.push(message) });
    return { adapter, records, snapshots, gates, entered, guard, statuses, get writes() { return writes; }, get reads() { return reads; } };
}
async function initialize(f) { resetPersistenceForTests(f.adapter); await persistence.init({ installLifecycleHooks: false }); }
const backup = () => buildFullPersistenceBackup({ storage: { exportAllSync: () => ({ records: { sim_new: 'target: 2.00' } }) } });

for (const stage of ['flush', 'snapshot', 'snapshotRead']) {
    const f = fixture(); await initialize(f);
    const hold = deferred();
    const originalFlush = persistence.flush;
    if (stage === 'flush') persistence.flush = async () => { f.entered.flush = true; await hold.promise; return true; };
    else f.gates[stage] = hold;
    try {
        const task = importFullPersistenceBackup(backup(), { guard: f.guard }).catch(error => error);
        await tick(); assert(f.entered[stage], `${stage}: echte Importvorbereitung erreicht`);
        const navigation = f.guard.prepare(); await tick();
        assert(f.guard.reasons().some(reason => reason.phase === 'cancelling'), `${stage}: Kündigung wartet auf Vorbereitung`);
        assertEqual(f.writes, 0, `${stage}: kein vorzeitiger Bestandswrite`);
        hold.resolve(); const result = await task;
        assertEqual(result.name, 'AbortError', `${stage}: Abbruch erreicht keine Importsuccessmeldung`);
        const attempt = await navigation;
        assert(attempt && f.guard.validate(attempt), `${stage}: bestätigtes Handlerende erlaubt Wechsel`);
        assertEqual(JSON.stringify(f.records), JSON.stringify({ sim_old: 'bytes: ä 1.00' }), `${stage}: Bestandsbytes bleiben unverändert`);
        f.guard.end(attempt);
    } finally { persistence.flush = originalFlush; }
}
for (const rollbackFails of [false, true]) {
    const f = fixture(); await initialize(f);
    f.gates.write1 = deferred(); f.gates.write2 = deferred();
    if (rollbackFails) f.gates.failWrite = 2;
    const validation = deferred(); let validationEntered = false;
    const task = importFullPersistenceBackup(backup(), { guard: f.guard, validateAfterLoad: async () => { validationEntered = true; await validation.promise; return false; } });
    await tick(); assert(f.entered.write1, 'Echter Vollimport hält ersten Bestandswrite');
    assertEqual(await f.guard.prepare(), null, 'App-Link ist im Write gesperrt');
    assert(unload(f.guard), 'Native Navigation ist im Write geschützt');
    let competing;
    try { await persistence.replaceLiveRecords({ sim_other: 'forbidden' }, { guard: f.guard }); } catch (error) { competing = error; }
    assertEqual(competing.code, 'NAVIGATION_WRITE_BUSY', 'Fremder Replace startet im Commit nicht');
    f.gates.write1.resolve(); await tick(); assert(validationEntered, 'Postvalidierung hält denselben Besitzer');
    assertEqual(await f.guard.prepare(), null, 'Postvalidierung hält App-Link gesperrt');
    validation.resolve(); await tick(); assert(f.entered.write2, 'Echter kompensierender Rollback wurde erreicht');
    assert(unload(f.guard), 'Rollback hält nativen Schutz');
    assertEqual(await f.guard.prepare(), null, 'Verzögerter Rollback hält App-Link gesperrt');
    f.gates.write2.resolve(); const result = await task;
    assertEqual(result.code, rollbackFails ? 'rollback_failed' : 'restore_rolled_back', 'Bestehender Rollbackcode bleibt erhalten');
    assert(f.snapshots.has(result.recoverySnapshotId), 'Recovery-Snapshot bleibt nach Rollback erreichbar');
    assert(result.message.includes('Wiederherstellungspunkt') && result.message.includes('Daten & Sicherung'), 'Fehler erhält verständliches Recoveryziel');
    assert(!/snapshot_|restore_rolled_back|rollback_failed|POST_VALIDATE|RESTORE/.test(result.message)
        && !result.message.includes(result.recoverySnapshotId), 'Haupttext enthält keine technischen Restoredetails');
    assertEqual(result.message.includes('Dein bisheriger Stand ist unverändert.'), !rollbackFails, 'Nur bestätigter Rollback bestätigt unveränderten Stand');
    if (rollbackFails) assert(result.message.includes('nicht bestätigt') && result.message.includes('wiederherstellen'), 'Unbestätigter Rollback nennt nötige Wiederherstellung');
    if (!rollbackFails) assertEqual(JSON.stringify(f.records), JSON.stringify({ sim_old: 'bytes: ä 1.00' }), 'Rollback ist bytegleich');
    assertEqual(f.guard.reasons().length, 0, 'Fehlerende löst nur den eigenen Besitzer');
}
{
    const f = fixture(); await initialize(f);
    f.gates.snapshot = deferred();
    const snapshotTask = SnapshotArchive.createSnapshot({ id: 'standalone', records: { sim_old: 'snapshot' } }, { guard: f.guard });
    await tick(); assert(unload(f.guard), 'Archivcreate ist durch bestätigten Abschluss geschützt');
    assertEqual(await f.guard.prepare(), null, 'Standalone-Archivwrite hält App-Link');
    f.gates.snapshot.resolve(); await snapshotTask;
    f.gates.delete = deferred();
    const deleteTask = SnapshotArchive.deleteSnapshot('standalone', { guard: f.guard }); await tick();
    assert(unload(f.guard), 'Archivdelete hält Schutz bis Adapterende');
    f.gates.delete.resolve(); await deleteTask;
    assertEqual(f.snapshots.size, 0, 'Bestätigtes Delete entfernt nur den Snapshot');
}
{
    const f = fixture(); await initialize(f);
    const lifecycle = createNavigationOperationLifecycle({ guard: f.guard });
    const gate = deferred(); let innerEnded = false;
    const task = lifecycle.run({}, async operation => {
        operation.commit();
        await SnapshotArchive.createSnapshot({ id: 'nested', records: { sim_old: 'snapshot' } }, { navigationOperation: operation });
        innerEnded = true; await gate.promise;
    });
    await tick(); assert(innerEnded, 'Innerer Archivwrite endet');
    assertEqual(await f.guard.prepare(), null, 'Inneres Ende gibt äußeren Commit nicht frei');
    gate.resolve(); await task;
    const reservation = await f.guard.prepare();
    let rejected;
    try { await persistence.replaceRecordsTransactional({ sim_new: 'forbidden' }, { guard: f.guard }); } catch (error) { rejected = error; }
    assertEqual(rejected.code, 'NAVIGATION_WRITE_BUSY', 'Reservierte Navigation sperrt neue Schreibaktionen');
    f.guard.end(reservation);
}
for (const full of [false, true]) for (const foreign of ['none', 'input', 'commit', 'dom-input']) {
    const initialState = JSON.stringify({ inputs: { aktuellesAlter: 67 }, marker: 'old bytes' });
    const registry = JSON.stringify({ version: 1, profiles: { a: { meta: { name: 'A' }, data: {} }, b: { meta: { name: 'B' }, data: { profile_tagesgeld: '777' } } } });
    const f = fixture({ [CONFIG.STORAGE.LS_KEY]: initialState, [PROFILE_STORAGE_KEYS.registry]: registry, [PROFILE_STORAGE_KEYS.current]: 'a', [PROFILE_STORAGE_KEYS.active]: 'a', [CONFIG.STORAGE.MIGRATION_FLAG]: '1', ui_panel_state: 'technical' });
    await initialize(f);
    const targetState = JSON.stringify({ inputs: { aktuellesAlter: 68 }, marker: 'snapshot bytes' });
    const saved = await SnapshotArchive.createSnapshot({ id: 'restore-fixture', activeProfileId: 'a', kind: full ? 'full-backup-import-recovery' : 'manual', records: { ...f.records, [CONFIG.STORAGE.LS_KEY]: targetState } });
    f.gates.write1 = deferred(); let reloads = 0;
    const listeners = new Map();
    const doc = { addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener(type) { listeners.delete(type); } };
    const original = { restore: StorageManager.restoreSnapshot, error: UIRenderer.handleActionError, clear: UIRenderer.clearActionError };
    const errors = [];
    UIRenderer.handleActionError = (error, scope) => errors.push({ error, scope });
    UIRenderer.clearActionError = () => {};
    StorageManager.restoreSnapshot = (key, handle, options) => original.restore.call(StorageManager, key, handle, { ...options, guard: f.guard, document: doc, reload: () => { reloads++; } });
    const confirmation = deferred(); let questions = 0;
    const handlers = createSnapshotHandlers({ dom: {}, appState: {},
        decide: () => { questions++; return confirmation.promise; },
        navigationLifecycle: createNavigationOperationLifecycle({ guard: f.guard }) });
    try {
    const task = handlers.handleSnapshotActions({ target: { closest: selector => selector === '.restore-snapshot' ? { dataset: { key: saved.id } } : null } });
    await tick();
    assertEqual(questions, 1, 'Echter Snapshotrestore wartet auf die Seitendialogentscheidung');
    assertEqual(f.writes, 0, 'Offene Restoreentscheidung startet keinen Bestandswrite');
    assertEqual(reloads, 0, 'Offene Restoreentscheidung lädt nicht neu');
    confirmation.resolve(true);
    await tick(); assert(f.entered.write1, 'Echter Snapshotrestore erreicht Bestandswrite');
    assert(unload(f.guard), 'Restore schützt nativen Reload bis Bestätigung');
    if (foreign === 'dom-input') listeners.get('input')();
    if (foreign === 'input') f.guard.register('new-input', { read: () => ({ dirty: true, revision: 1 }) });
    if (foreign === 'commit') {
        let phase = 'commit';
        const foreignOwner = f.guard.register('foreign-commit', { read: () => ({ phase }) });
        phase = 'idle'; foreignOwner.notify();
    }
    f.gates.write1.resolve(); const result = await task;
    assertEqual(reloads, foreign !== 'none' ? 0 : 1, 'Neue Eingaben verhindern Reload; unveränderter Erfolg lädt einmal');
    assertEqual(result.status, foreign === 'none' ? 'restored' : 'reload_required', 'Restore unterscheidet gespeicherten Stand ohne Reload');
    if (foreign !== 'none') {
        assertEqual(errors[0]?.scope, 'snapshots', 'Gespeicherter Restore ohne Reload meldet sich am Snapshot-Aktionsort');
        assert(errors[0]?.error.message.includes('Snapshot gespeichert') && errors[0]?.error.message.includes('nicht neu geladen')
            && errors[0]?.error.message.includes('jetzt neu laden'), 'Snapshot-Hinweis erklärt Speicherung und erforderlichen Reload');
        let inputError;
        try {
            persistBalanceUpdate({ mode: BALANCE_UPDATE_MODE.PERSIST_INPUTS, storageManager: StorageManager,
                persistentState: JSON.parse(initialState), inputData: { aktuellesAlter: 99 } });
        } catch (error) { inputError = error; }
        assertEqual(inputError?.code, 'PERSISTENCE_RELOAD_REQUIRED', 'Echter PERSIST_INPUTS-Pfad sperrt veraltete Eingaben');
        assert(inputError?.message.includes('neu laden'), 'Abgewiesenes Speichern fordert Reload sichtbar an');
        let profileError;
        try { persistence.setItemSync(PROFILE_STORAGE_KEYS.registry, registry); } catch (error) { profileError = error; }
        assertEqual(profileError?.code, 'PERSISTENCE_RELOAD_REQUIRED', 'Veraltete Profilkopien können Restore ebenfalls nicht überschreiben');
        await persistence.flush();
    } else assertEqual(errors.length, 0, 'Bestätigter Reload braucht keinen Fehlerhinweis');
    assertEqual(listeners.size, 0, 'Restoreende entfernt gewöhnliche Eingabelistener');
    assertEqual(f.records[CONFIG.STORAGE.LS_KEY], targetState, 'Restorewerte bleiben exakt');
    assertEqual(f.records.ui_panel_state, 'technical', 'Technische Einstellungen bleiben erhalten');
    assertEqual(JSON.parse(f.records[PROFILE_STORAGE_KEYS.registry]).profiles.b.data.profile_tagesgeld, '777', 'Anderes Profil bleibt erhalten');
    assertEqual(JSON.stringify(f.snapshots.get(saved.id)), JSON.stringify(saved), 'Archivierte Records werden nie verändert');
    f.guard.revokeNative();
    } finally {
        StorageManager.restoreSnapshot = original.restore; UIRenderer.handleActionError = original.error;
        UIRenderer.clearActionError = original.clear;
    }
}
for (const outcome of ['cancelled', 'rollback', 'flush']) {
    const stateKey = CONFIG.STORAGE.LS_KEY;
    const initial = JSON.stringify({ inputs: { aktuellesAlter: 67 } });
    const restored = JSON.stringify({ inputs: { aktuellesAlter: 68 } });
    const f = fixture({ [stateKey]: initial }); await initialize(f);
    const saved = await SnapshotArchive.createSnapshot({ id: 'restore-outcome', kind: 'full-backup-import-recovery', records: { [stateKey]: restored } });
    const guard = outcome === 'cancelled' ? createNavigationGuard({ decide: async () => false }) : f.guard;
    if (outcome === 'cancelled') guard.register('unsaved-input', { read: () => ({ dirty: true }) });
    if (outcome === 'rollback') f.gates.failWrite = 1;
    const originalFlush = persistence.flush;
    if (outcome === 'flush') persistence.flush = async () => false;
    let result, failure, reloads = 0;
    try { result = await StorageManager.restoreSnapshot(saved.id, null, { guard, reload: () => { reloads++; } }); }
    catch (error) { failure = error; }
    finally { persistence.flush = originalFlush; }
    assertEqual(reloads, 0, `${outcome}: Restoreabschluss lädt nicht neu`);
    assertEqual(f.records[stateKey], initial, `${outcome}: bestätigter Bestand bleibt nachvollziehbar`);
    if (outcome === 'rollback') assertEqual(failure?.code, 'restore_rolled_back', 'Restorewritefehler bestätigt echten kompensierenden Rollback');
    else if (outcome === 'flush') assertEqual(failure?.message, 'PERSISTENCE_FLUSH_FAILED', 'Fehlender Vorflush stoppt vor Punkt und Zielmutation');
    else assertEqual(result?.status, 'cancelled', `${outcome}: eindeutiges Restoreergebnis`);
    let writeError;
    try { persistence.setItemSync(stateKey, initial); } catch (error) { writeError = error; }
    assertEqual(writeError?.code, undefined,
        `${outcome}: ohne Zielwrite oder nach bestätigtem Rollback bleibt das Formular nutzbar`);
    if (outcome === 'cancelled') assertEqual(f.writes, 0, 'Abgelehnte Restoreentscheidung startet keinen Bestandswrite');
}
{
    const f = fixture(); await initialize(f);
    const handlers = {}, status = { dataset: {}, textContent: '' };
    const button = { addEventListener(type, handler) { handlers[`button:${type}`] = handler; } };
    const fileInput = { value: 'selected', files: [{}], addEventListener(type, handler) { handlers[`file:${type}`] = handler; }, click() {} };
    const oldReader = globalThis.FileReader; let reader, reloads = 0, downloads = 0;
    globalThis.FileReader = class { readAsText() { reader = this; } };
    try {
        bindFullBackupImport({ document: {}, button, fileInput, status, guard: f.guard, confirmImport: () => true, reload: () => { reloads++; }, createRecoveryBackup: async () => { downloads++; return { skipped: false }; } });
        const task = handlers['file:change'](); await tick();
        const navigation = f.guard.prepare(); await tick();
        reader.result = JSON.stringify(backup()); reader.onload(); await task;
        const attempt = await navigation;
        assert(attempt, 'Echter FileReaderhandler bestätigt erst vollständiges Abbruchende');
        assertEqual(downloads, 0, 'Dateikündigung startet keinen Recoveryexport');
        assertEqual(f.writes, 0, 'Dateikündigung startet keinen Bestandswrite');
        assertEqual(reloads, 0, 'Dateikündigung lädt nicht neu');
        assertEqual(fileInput.value, '', 'Dateikündigung setzt Fileinput zurück');
        f.guard.end(attempt);
        globalThis.FileReader = class { readAsText() { this.result = JSON.stringify(backup()); this.onload(); } };
        await handlers['file:change']();
        assertEqual(reloads, 1, 'Vollimporthandler lädt nach bestätigtem Write genau einmal');
        assertEqual(f.records.sim_new, 'target: 2.00', 'Erfolg liegt ohne Testflush im Backend');
        assertEqual(downloads, 1, 'Nur Recoverydownload, kein Profilbundleexport');
        f.guard.revokeNative();
        await new Promise(resolve => setTimeout(resolve, 0));
        const originalFlush = persistence.flush;
        let flushes = 0;
        persistence.flush = async () => { if (++flushes === 2) throw new Error('SYNTHETIC_FINAL_FLUSH'); return originalFlush(); };
        try {
            await handlers['file:change']();
            assertEqual(reloads, 1, 'Fehlgeschlagener letzter Flush löst keinen weiteren Reload aus');
            assertEqual(status.dataset.kind, 'error', 'Letzter Flushfehler zeigt keinen Erfolgsstatus');
            assert(status.textContent.includes('SYNTHETIC_FINAL_FLUSH'), 'Letzter Flushfehler bleibt ortsfest sichtbar');
        } finally { persistence.flush = originalFlush; }

    } finally { globalThis.FileReader = oldReader; }
}
// Echte Importbinderfehler: nur der sichtbare Text wird vereinfacht, Codes bleiben in der API.
for (const rollbackFails of [false, true]) {
    const f = fixture(); await initialize(f);
    f.gates.failWrite = rollbackFails ? 2 : 1;
    const handlers = {}, status = { dataset: {}, textContent: '' };
    const button = { addEventListener() {} }, fileInput = { files: [{}], value: 'chosen', addEventListener(type, fn) { handlers[type] = fn; } };
    const oldReader = globalThis.FileReader; let reloads = 0;
    globalThis.FileReader = class { readAsText() { this.result = JSON.stringify(backup()); this.onload(); } };
    if (rollbackFails) {
        // Den ersten Write anwenden, dann Postvalidierung durch absichtlich falschen Readback scheitern lassen.
        const loadAll = f.adapter.loadAll;
        f.adapter.loadAll = async () => { const records = await loadAll(); return f.writes === 1 ? { sim_wrong: 'SYNTHETIC_RESTORE_DETAIL' } : records; };
    }
    try {
        bindFullBackupImport({ document: {}, button, fileInput, status, guard: f.guard, confirmImport: () => true,
            reload: () => { reloads++; }, createRecoveryBackup: async () => ({ skipped: false }) });
        await handlers.change();
        assertEqual(status.dataset.kind, 'error', 'Importbinder markiert Restorefehler als Fehler');
        assert(status.textContent.includes('Wiederherstellungspunkt') && status.textContent.includes('Daten & Sicherung'), 'Importstatus nennt verständlichen Wiederherstellungsweg');
        assert(!/snapshot_|\[restore_rolled_back\]|\[rollback_failed\]|SYNTHETIC|RESTORE/.test(status.textContent), 'Importstatus enthält keine technischen Kennungen oder Restoremeldungen');
        assertEqual(status.textContent.includes('Dein bisheriger Stand ist unverändert.'), !rollbackFails, 'Importstatus bestätigt unveränderten Stand nur nach bestätigtem Rollback');
        assertEqual(reloads, 0, 'Restorefehler lädt nicht neu');
        assertEqual(f.snapshots.size, 1, 'Restorefehler erhält Recoverypunkt');
    } finally { globalThis.FileReader = oldReader; }
}
for (const phase of ['preparing', 'running', 'commit', 'decision']) {
    const f = fixture(); await initialize(f);
    const guard = phase === 'decision' ? createNavigationGuard({ decide: async () => false }) : f.guard;
    const owner = guard.register('foreign-action', { read: () => phase === 'decision' ? { dirty: true } : { phase } });
    const handlers = {}, status = { dataset: {}, textContent: '' };
    const button = { addEventListener() {} };
    const fileInput = { value: 'chosen', files: [{}], addEventListener(type, handler) { handlers[type] = handler; } };
    const originalReader = globalThis.FileReader;
    let downloads = 0, reloads = 0;
    globalThis.FileReader = class { readAsText() { this.result = JSON.stringify(backup()); this.onload(); } };
    try {
        bindFullBackupImport({ document: {}, button, fileInput, status, guard, confirmImport: () => true,
            reload: () => { reloads++; }, createRecoveryBackup: async () => { downloads++; return { skipped: false }; } });
        await handlers.change();
        assert(status.textContent.includes(phase === 'decision' ? 'Import abgebrochen' : 'Eine andere Aktion läuft'), `${phase}: Vollimport erklärt Abbruch oder laufende Aktion`);
        assert(!status.textContent.includes('wird erstellt...'), `${phase}: kein irreführender Dauerstatus`);
        assertEqual(f.writes, 0, `${phase}: kein Bestandswrite bei abgewiesenem Vollimport`);
        assertEqual(reloads, 0, `${phase}: kein Reload bei abgewiesenem Vollimport`);
        assertEqual(downloads, phase === 'decision' ? 1 : 0, `${phase}: nur Verlustdialog-Abbruch behält Recoverydownload`);
        assertEqual(f.snapshots.size, phase === 'decision' ? 1 : 0, `${phase}: Recovery-Snapshot bleibt nach Verlustdialog-Abbruch erhalten`);
        assertEqual(fileInput.value, '', `${phase}: Dateiwahl ist für Wiederholung zurückgesetzt`);
    } finally { globalThis.FileReader = originalReader; owner.unregister(); }
}
{
    const f = fixture(); await initialize(f);
    f.gates.read = deferred();
    const task = persistence.replaceRecordsTransactional({ sim_new: 'forbidden' }, { guard: f.guard }).catch(error => error);
    await tick(); assert(f.entered.read, 'Facade-Vorreadback ist kündigbare Vorbereitung');
    const navigation = f.guard.prepare(); await tick(); f.gates.read.resolve();
    assertEqual((await task).name, 'AbortError', 'Facade-Kündigung verhindert Replace nach Vorreadback');
    const attempt = await navigation; assert(attempt, 'Vorreadback bestätigt vollständiges Abbruchende');
    assertEqual(f.writes, 0, 'Kündigung erzeugt keinen ersten Write'); f.guard.end(attempt);
}
for (const action of ['create', 'delete']) {
    const f = fixture(); await initialize(f);
    let error;
    try {
        if (action === 'create') await SnapshotArchive.createSnapshot({ id: 'failure', records: {} }, { guard: f.guard, storage: { writeSnapshot: async () => false } });
        else await SnapshotArchive.deleteSnapshot('existing', { guard: f.guard, storage: { deleteSnapshot: async () => false } });
    } catch (caught) { error = caught; }
    assert(error, `${action}: Adapter-false bestätigt keinen Archiverfolg`);
    assertEqual(f.guard.reasons().length, 0, `${action}: Archivfehler beendet nur seinen eigenen Besitzer`);
}
// Exakte und präfixbezogene Besitzer schützen Set und Remove unabhängig voneinander.
{
    const f = fixture({ sim_old: 'alt', household_simulator_needs_v1: 'marker', outside: 'alt' });
    await initialize(f);
    const keys = ['household_simulator_needs_v1', 'household_simulator_needs_warning_ack_v1'];
    const first = persistence.blockSyncWrites(keys, 'Bitte neu laden.', { prefixes: ['sim_'] });
    const second = persistence.blockSyncWrites(['sim_old'], 'Zweiter Besitzer.');
    const blocked = (key, remove = false) => {
        let error;
        try { if (remove) persistence.removeItemSync(key); else persistence.setItemSync(key, 'veraltet'); } catch (caught) { error = caught; }
        return error?.code;
    };
    for (const key of ['sim_old', 'sim_new', ...keys]) for (const remove of [false, true]) {
        assertEqual(blocked(key, remove), 'PERSISTENCE_RELOAD_REQUIRED', `${key}: ${remove ? 'Remove' : 'Set'} präfix-/haushaltsgeschützt`);
    }
    persistence.setItemSync('outside', 'neu'); persistence.setItemSync('other', 'neu'); persistence.removeItemSync('other');
    await persistence.flush();
    assertEqual(f.records.outside, 'neu', 'Writes außerhalb der Sperre bleiben möglich');
    assertEqual(f.records.sim_old, 'alt', 'Geschützter Backendbestand unverändert');
    assertEqual(f.records.sim_new, undefined, 'Geschützter neuer Schlüssel nicht angelegt');
    first();
    assertEqual(blocked('sim_old'), 'PERSISTENCE_RELOAD_REQUIRED', 'Überlappender exakter Besitzer bleibt nach Präfixfreigabe gesperrt');
    persistence.setItemSync('sim_new', 'freigegeben');
    assertEqual(persistence.getItemSync('sim_new'), 'freigegeben', 'Präfixbesitzer unabhängig freigegeben');
    second(); persistence.setItemSync('sim_old', 'freigegeben');
    assertEqual(persistence.getItemSync('sim_old'), 'freigegeben', 'Bestehender exakter blockSyncWrites-Aufruf unabhängig freigegeben');
    const third = persistence.blockSyncWrites([], 'Präfix bleibt.', { prefixes: ['sim_'] });
    const fourth = persistence.blockSyncWrites(['sim_old'], 'Exakt.'); fourth();
    assertEqual(blocked('sim_old', true), 'PERSISTENCE_RELOAD_REQUIRED', 'Exakte Freigabe löst Präfixbesitzer nicht');
    third(); await persistence.flush();
}
resetPersistenceForTests();

// Entscheidungs-Promise gehört zur Vorbereitung; vor Auflösung keine Sicherung/Ersetzung.
for (const outcome of ['cancel', 'accept', 'stale', 'missing-dom']) {
    const f = fixture(); await initialize(f);
    const handlers = {}, status = { dataset: {}, textContent: '' };
    const button = { addEventListener() {} }, fileInput = { files: [{}], value: 'chosen', addEventListener(type, fn) { handlers[type] = fn; } };
    const hold = deferred(); let questions = 0, downloads = 0, reloads = 0;
    const oldReader = globalThis.FileReader;
    globalThis.FileReader = class { readAsText() { this.result = JSON.stringify(backup()); this.onload(); } };
    try {
        bindFullBackupImport({ document: {}, button, fileInput, status, guard: f.guard,
            ...(outcome === 'missing-dom' ? {} : { confirmImport: () => { questions++; return hold.promise; } }),
            reload: () => { reloads++; }, createRecoveryBackup: async () => { downloads++; return { skipped: false }; } });
        const task = handlers.change(); await tick();
        assertEqual(downloads, 0, 'Offene Entscheidung erzeugt keinen Recoverydownload');
        assertEqual(f.writes, 0, 'Offene Entscheidung erzeugt keine Bestandswrites');
        if (outcome !== 'missing-dom') {
            await handlers.change(); assertEqual(questions, 1, 'Doppelter Import öffnet keine zweite Rückfrage');
            if (outcome === 'stale') persistence.setItemSync('sim_old', 'neuer Bestand');
            hold.resolve(outcome !== 'cancel');
        }
        await task;
        assertEqual(downloads, outcome === 'accept' ? 1 : 0, 'Nur ausdrückliche aktuelle Zustimmung sichert vor Ersetzung');
        assertEqual(reloads, outcome === 'accept' ? 1 : 0, 'Nur ausdrückliche aktuelle Zustimmung lädt neu');
        assertEqual(persistence.getItemSync('sim_old'), outcome === 'accept' ? null : outcome === 'stale' ? 'neuer Bestand' : 'bytes: ä 1.00', 'Abbruch/fehlendes DOM/Quellwechsel erhalten vorherige Bytes');
        assertEqual(fileInput.value, '', 'Entscheidungsende räumt Dateifeld auf');
        assertEqual(f.guard.reasons().length, 0, 'Entscheidungsende gibt Vorbereitung frei');
    } finally { globalThis.FileReader = oldReader; }
}
