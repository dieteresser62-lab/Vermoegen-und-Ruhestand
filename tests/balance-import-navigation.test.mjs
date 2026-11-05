import { createNavigationGuard, createNavigationOperationLifecycle } from '../app/shared/navigation-guard.js';
import { createImportExportHandlers, createBalanceExportDocument } from '../app/balance/balance-binder-imports.js';
import { BALANCE_UPDATE_MODE } from '../app/balance/balance-update-pipeline.js';
import { PersistenceFacade as persistence, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { UIReader } from '../app/balance/balance-reader.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { CONFIG } from '../app/balance/balance-config.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const year = new Date().getFullYear() - 1;
const base = { inputs: { aktuellesAlter: 67, floorBedarf: 24000, flexBedarf: 12000, endeVJ: 120, endeVJ_1: 110, endeVJ_2: 100, endeVJ_3: 90, ath: 150, jahreSeitAth: 2 } };
const baseBytes = JSON.stringify(base);
const json = JSON.stringify(createBalanceExportDocument({ inputs: { ...base.inputs, aktuellesAlter: 68 } }));
const csv = ['Datum;Schluss', ...[3, 2, 1, 0].map((offset, i) => `30.12.${year - offset};${100 + i * 10}`)].join('\n');
function fixture(kind, stage, rollbackFails = false) {
    const records = { [CONFIG.STORAGE.LS_KEY]: baseBytes, [CONFIG.STORAGE.MIGRATION_FLAG]: '1', sim_other: 'unchanged bytes' }, snapshots = new Map();
    const hold = deferred(), rollback = deferred(), entered = {}, errors = [], toasts = [], modes = [];
    let writes = 0, restoredPreview = false;
    const adapter = {
        name: 'balance-navigation-memory', async open() {}, async loadAll() { return { ...records }; },
        async saveBatch({ upserts, deletes }) {
            writes++;
            if (writes === 1 && stage === 'write') { entered.write = true; await hold.promise; }
            if (writes === 2 && stage === 'rollback') { entered.rollback = true; await rollback.promise; if (rollbackFails) throw new Error('SYNTHETIC_ROLLBACK'); }
            deletes.forEach(key => { delete records[key]; }); upserts.forEach(([key, value]) => { records[key] = value; });
        },
        async writeSnapshot(snapshot) { if (stage === 'snapshot') { entered.snapshot = true; await hold.promise; } snapshots.set(snapshot.id, snapshot); },
        async readSnapshot(id) { if (stage === 'snapshotRead' && !entered.snapshotRead) { entered.snapshotRead = true; await hold.promise; } return snapshots.get(id); },
        async listSnapshots() { return [...snapshots.values()]; }
    };
    const guard = createNavigationGuard({ decide: async () => true });
    const dom = { inputs: Object.fromEntries(Object.entries(base.inputs).map(([id, value]) => [id, { value: String(value) }])) };
    for (const [id, value] of Object.entries({ marketCsvMode: 'current', marketCsvTargetYear: String(year), marketCsvExpectedAsOf: `${year}-12-30`, marketCsvInstrument: 'synthetic.de' })) dom.inputs[id] = { value };
    const target = { value: 'chosen', files: [{ name: 'synthetic.csv', text: async () => { if (stage === 'file') { entered.file = true; await hold.promise; } return kind === 'json' ? json : csv; } }] };
    const handlers = createImportExportHandlers({ dom, navigationLifecycle: createNavigationOperationLifecycle({ guard }),
        update: async ({ mode }) => {
            modes.push(mode);
            if (mode === BALANCE_UPDATE_MODE.PREVIEW) {
                if (modes.length === 1 && stage === 'preview') { entered.preview = true; await hold.promise; }
                if (modes.length > 1) restoredPreview = true;
                return { ok: true, inputData: { ...base.inputs, endeVJ: Number(dom.inputs.endeVJ.value) } };
            }
            entered.final = true;
            if (stage === 'final' || stage === 'rollback') await hold.promise;
            return { ok: stage !== 'rollback' };
        }
    });
    UIReader.applyStoredInputs = inputs => { Object.entries(inputs).forEach(([id, value]) => { if (dom.inputs[id]) dom.inputs[id].value = String(value); }); };
    UIReader.renderMarketDataProvenance = () => {};
    UIRenderer.clearActionError = () => {};
    UIRenderer.handleActionError = (error, action) => errors.push({ error, action });
    UIRenderer.toast = message => toasts.push(message);
    return { records, snapshots, adapter, guard, dom, target, handlers, hold, rollback, entered, errors, toasts, modes, get restoredPreview() { return restoredPreview; }, get writes() { return writes; } };
}
const original = { apply: UIReader.applyStoredInputs, provenance: UIReader.renderMarketDataProvenance, clear: UIRenderer.clearActionError, error: UIRenderer.handleActionError, toast: UIRenderer.toast, flush: persistence.flush };
try {
    const f = fixture('json', 'none'); resetPersistenceForTests(f.adapter); await persistence.init({ installLifecycleHooks: false });
    const replace = StorageManager.replaceStateFromImport, rollback = StorageManager.rollbackImportReplace;
    let rolledBack = 0;
    try {
        StorageManager.replaceStateFromImport = async (payload, options) => {
            const receipt = await replace.call(StorageManager, payload, options);
            options.navigationOperation.controller.abort();
            return receipt;
        };
        StorageManager.rollbackImportReplace = async (...args) => { rolledBack++; return rollback.apply(StorageManager, args); };
        const result = await f.handlers.handleImport({ target: f.target });
        assertEqual(rolledBack, 1, 'Kündigung nach Replace rollt Balancebestand zurück');
        assertEqual(result.status, 'cancelled', 'Kündigung nach Replace bleibt ein Balance-Abbruch');
        assertEqual(f.errors.length, 0, 'Kündigung nach Replace erzeugt keinen Aktionsfehler');
        assertEqual(f.toasts.length, 0, 'Kündigung nach Replace behauptet keinen Erfolg');
        assertEqual(f.records[CONFIG.STORAGE.LS_KEY], baseBytes, 'Kündigung nach Replace stellt ursprüngliche Bytes wieder her');
    } finally { StorageManager.replaceStateFromImport = replace; StorageManager.rollbackImportReplace = rollback; }
    for (const kind of ['json']) for (const stage of ['file', 'preview', 'flush', 'snapshot', 'snapshotRead']) {
        const f = fixture(kind, stage); resetPersistenceForTests(f.adapter); await persistence.init({ installLifecycleHooks: false });
        if (stage === 'flush') persistence.flush = async () => { f.entered.flush = true; await f.hold.promise; return true; };
        const task = f.handlers[kind === 'json' ? 'handleImport' : 'handleCsvImport']({ target: f.target }); await tick();
        assert(f.entered[stage], `${kind}/${stage}: echter Handler erreicht Vorbereitung`);
        const navigation = f.guard.prepare(); await tick();
        assert(f.guard.reasons().some(reason => reason.phase === 'cancelling'), `${kind}/${stage}: Kündigung wartet auf Handlerende`);
        f.hold.resolve(); const result = await task;
        const attempt = await navigation;
        assertEqual(result.status, 'cancelled', `${kind}/${stage}: bestätigte Kündigung endet als Abbruch`);
        assert(attempt, `${kind}/${stage}: alle Hilfswrites und UI-Cleanup sind vor Wechsel fertig`);
        assertEqual(f.writes, 0, `${kind}/${stage}: kein später Bestandscommit`);
        assertEqual(f.records[CONFIG.STORAGE.LS_KEY], baseBytes, `${kind}/${stage}: Bestandsbytes bleiben exakt`);
        assertEqual(f.dom.inputs.aktuellesAlter.value, '67', `${kind}/${stage}: temporäre UI ist zurückgesetzt`);
        assertEqual(f.dom.inputs.endeVJ.value, '120', `${kind}/${stage}: CSV-/Marktwerte sind zurückgesetzt`);
        assert(f.restoredPreview || stage === 'file', `${kind}/${stage}: PREVIEW der wiederhergestellten Eingaben beendet`);
        assertEqual(f.target.value, '', `${kind}/${stage}: Dateiauswahl zurückgesetzt`);
        assertEqual(f.toasts.length, 0, `${kind}/${stage}: kein falscher Erfolg`);
        f.guard.end(attempt); persistence.flush = original.flush;
    }
    for (const kind of ['json']) for (const stage of ['write', 'final', 'rollback']) for (const rollbackFails of stage === 'rollback' ? [false, true] : [false]) {
        const f = fixture(kind, stage, rollbackFails); resetPersistenceForTests(f.adapter); await persistence.init({ installLifecycleHooks: false });
        const task = f.handlers[kind === 'json' ? 'handleImport' : 'handleCsvImport']({ target: f.target }); await tick();
        assert(f.entered[stage === 'write' ? 'write' : 'final'], `${kind}/${stage}: erster Write oder Postvalidierung angehalten`);
        assertEqual(await f.guard.prepare(), null, `${kind}/${stage}: App-Link hält bis Commitende`);
        let blocked = false; f.guard.beforeUnload({ preventDefault() { blocked = true; } });
        assert(blocked, `${kind}/${stage}: nativer Reload erhält Schutz`);
        const competing = await f.handlers[kind === 'json' ? 'handleImport' : 'handleCsvImport']({ target: { files: [{ text: async () => kind === 'json' ? json : csv }], value: 'new' } });
        assertEqual(competing.status, 'in_flight', `${kind}/${stage}: neuer Import startet nicht während fremdem Commit`);
        assertEqual(f.errors.at(-1)?.action, kind === 'json' ? 'balance-import' : 'market-csv-import', `${kind}/${stage}: Zurückweisung hat den richtigen Aktionsort`);
        assert(f.errors.at(-1)?.error.message.includes('Eine andere Aktion läuft'), `${kind}/${stage}: Zurückweisung bleibt sichtbar`);
        f.errors.length = 0; // Nachweise des abgewiesenen Zweitimports getrennt vom ersten Import halten.
        f.hold.resolve(); await tick();
        if (stage === 'rollback') {
            assert(f.entered.rollback, `${kind}: echter Recoveryrollback erreicht`);
            assertEqual(await f.guard.prepare(), null, `${kind}: verzögerter Rollback gibt äußeren Besitzer nicht frei`);
            f.rollback.resolve();
        }
        await task;
        assertEqual(f.guard.reasons().length, 0, `${kind}/${stage}: vollständig beendeter Handler löst Schutz`);
        if (stage === 'rollback') {
            assertEqual(f.toasts.length, 0, `${kind}: Rollback meldet keinen Erfolg`);
            const error = f.errors[0]?.error;
            assertEqual(kind === 'json' ? error?.code : error?.context.code, rollbackFails ? 'rollback_failed' : 'post_replace_validation_failed', `${kind}: bestehender Fehlercode bleibt erhalten`);
            assert(f.snapshots.size === 1, `${kind}: Recovery bleibt erreichbar`);
            if (!rollbackFails) assertEqual(f.records[CONFIG.STORAGE.LS_KEY], baseBytes, `${kind}: Recoveryrollback ist bytegleich`);
        } else assertEqual(f.toasts.length, 1, `${kind}: erfolgreicher Import meldet einmal Erfolg`);
        assertEqual(f.records.sim_other, 'unchanged bytes', `${kind}: fremde fachliche Records bleiben unverändert`);
    }
    for (const kind of ['json']) for (const phase of ['preparing', 'running', 'commit']) {
        const f = fixture(kind, 'none'); resetPersistenceForTests(f.adapter); await persistence.init({ installLifecycleHooks: false });
        const owner = f.guard.register('foreign-action', { read: () => ({ phase }) });
        const result = await f.handlers[kind === 'json' ? 'handleImport' : 'handleCsvImport']({ target: f.target });
        assertEqual(result.status, 'in_flight', `${kind}/${phase}: fremde Aktion weist Import ab`);
        assertEqual(f.errors[0]?.action, kind === 'json' ? 'balance-import' : 'market-csv-import', `${kind}/${phase}: eigener Aktionsort erhält Hinweis`);
        assert(f.errors[0]?.error.message.includes('Eine andere Aktion läuft'), `${kind}/${phase}: Hinweis erklärt die Sperre`);
        assertEqual(f.writes, 0, `${kind}/${phase}: keine Bestandsmutation`);
        assertEqual(f.target.value, '', `${kind}/${phase}: erneute Dateiwahl möglich`);
        owner.unregister();
    }
    for (const rollbackFails of [false, true]) {
        const f = fixture('json', 'readback');
        resetPersistenceForTests(f.adapter); await persistence.init({ installLifecycleHooks: false });
        let reads = 0;
        const read = f.adapter.loadAll;
        f.adapter.loadAll = async () => {
            const result = await read();
            if (++reads === 2) return { ...result, [CONFIG.STORAGE.LS_KEY]: '{}' };
            return result;
        };
        if (rollbackFails) {
            const write = f.adapter.saveBatch;
            let writes = 0;
            f.adapter.saveBatch = batch => { if (++writes === 2) throw new Error('SYNTHETIC_INITIAL_REPLACE_ROLLBACK'); return write(batch); };
        }
        await f.handlers.handleImport({ target: f.target });
        assertEqual(f.toasts.length, 0, 'Backend-Readbackfehler meldet keinen Importerfolg');
        assertEqual(f.errors[0]?.error.code, rollbackFails ? 'rollback_failed' : 'storage_failed', 'Initialer Replace erhält bisherigen Fehlercode und Rollbackfehler');
        assert(f.errors[0]?.error.message.includes('Daten & Sicherung'), 'Initialer Readback-/Rollbackfehler erhält Recoveryziel');
        assertEqual(f.snapshots.size, 1, 'Recovery bleibt nach initialem Replacefehler erhalten');
        if (!rollbackFails) assertEqual(f.records[CONFIG.STORAGE.LS_KEY], baseBytes, 'Initialer Readbackrollback bestätigt ursprüngliche Bestandsbytes');
        assertEqual(f.guard.reasons().length, 0, 'Readbackfehler beendet seinen Besitzer erst nach Rollback');
    }

} finally {
    UIReader.applyStoredInputs = original.apply; UIReader.renderMarketDataProvenance = original.provenance;
    UIRenderer.clearActionError = original.clear; UIRenderer.handleActionError = original.error; UIRenderer.toast = original.toast;
    persistence.flush = original.flush; resetPersistenceForTests();
}
