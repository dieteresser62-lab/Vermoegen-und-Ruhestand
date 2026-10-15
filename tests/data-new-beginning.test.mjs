import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { SnapshotArchive as A } from '../app/shared/snapshot-archive.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { createTauriJsonFileAdapter } from '../app/shared/persistence-adapter-tauri.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createNewBeginningController, assertNewBeginningAllowed, canConfirmNewBeginning } from '../app/data/data-new-beginning.js';
import { showNewBeginningDialog } from '../app/data/data-new-beginning-ui.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { previewSnapshotRestore, executeSnapshotRestore, recordIdentity } from '../app/shared/snapshot-restore.js';
import { bootstrapProfileContext } from '../app/profile/profile-storage.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

const store = (records = {}) => {
    const m = new Map(Object.entries(records));
    return { getItem: k => m.get(k) ?? null, setItem: (k,v) => m.set(k,String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
};
const legacy = 'ruhestandsmodell_snapshot_2026-01-20T11:48:21.709Z--Muster';
const original = { ...createMusterHaushaltRecords('2026-10-12'), [legacy]: '{ "alte": true }', ui_probe: 'open', layout_probe: '2', sim_result_probe: 'result' };
const registry = JSON.parse(original.rs_profiles_v1);
registry.profiles.outside = structuredClone(registry.profiles.muster_b);
registry.profiles.outside.meta.id = 'outside'; registry.profiles.outside.meta.name = 'Außenperson'; registry.profiles.outside.meta.belongsToHousehold = false;
registry.profiles.outside.data[legacy] = 'historisch'; registry.profiles.outside.data.ui_probe = 'offen';
original.rs_profiles_v1 = JSON.stringify(registry);
const confirmed = { withoutBackup: true, confirmed: true };
function adapter(seed = original) {
    const values = { ...seed }, points = new Map(), events = [];
    return { name: 'synthetic', values, points, events, fail: null,
        async open() {}, async loadAll() { if (this.fail === 'read') throw new Error('read'); return { ...values }; },
        async saveBatch({ upserts, deletes }) { events.push('batch'); deletes.forEach(k => delete values[k]); if (this.fail === 'delete') throw new Error('delete'); upserts.forEach(([k,v]) => values[k] = v); },
        async listSnapshots() { return [...points.values()]; },
        async writeSnapshot(p) { events.push('point'); if (this.fail === 'point') throw new Error('point'); points.set(p.id, structuredClone(p)); },
        async readSnapshot(id) { events.push('read-point'); const p = structuredClone(points.get(id)); if (this.fail === 'point-readback' && p.kind === 'new-beginning-before') p.label = 'changed'; return p; },
        async deleteSnapshot(id) { events.push('delete-point'); if (this.fail === 'archive-delete') throw new Error('archive-delete'); points.delete(id); }
    };
}
async function boot(a, win) { P.resetPersistenceForTests(a); setAppTestDate(null); await P.init({ window: win, installLifecycleHooks: false, installTauriCloseHook: false }); }
const make = (win, extra = {}) => createNewBeginningController({ guard: createNavigationGuard(), window: win, navigate: () => {}, ...extra });
async function mustReject(fn, label) { let error; try { await fn(); } catch(e) { error = e; } assert(Boolean(error),label); }

for (const kind of ['separate', 'localStorage', 'tauri']) {
    const local = store(kind === 'localStorage' ? original : { [legacy]: 'stale', profile_tagesgeld: 'old', ui_suite_sidebar_collapsed: 'true' });
    const session = store({ rs_history_fetch_session_v1: 'done', 'balance.annual-retry.once': 'retry' });
    const win = { localStorage: local, sessionStorage: session };
    const files = new Map([['main', JSON.stringify({ schemaVersion: 1, records: original, metadata: {} })]]);
    const a = kind === 'localStorage' ? createLocalStorageAdapter(local) : kind === 'tauri' ? createTauriJsonFileAdapter({ invoke: async (cmd,args={}) => {
        const target = args.target || 'main'; if (cmd === 'load_app_state') return files.get(target) || null;
        if (cmd === 'save_app_state') { files.set(target,args.content); return; } throw new Error(cmd);
    } }) : adapter();
    await boot(a,win);
    await A.createSnapshot({ id: 'older', records: { profile_tagesgeld: '5' }, label: 'Alter Punkt' });
    const old = JSON.stringify(await A.readSnapshot('older'));
    const before = await P.readPersistedRecords();
    const c = make(win); let navigations = 0;
    const inspector = await c.inspect(); assert(inspector.names.includes('Außenperson'), kind + ': alle Registry-Namen einschließlich Außenperson');
    const result = await make(win, { navigate: () => { navigations++; } }).execute(confirmed);
    assertEqual(result.status, 'restarted', kind + ': bestätigter Neustart');
    assertEqual(navigations,1,kind + ': Erststartnavigation genau einmal');
    const empty = await P.readPersistedRecords(k => k !== 'rs_snapshot_archive_v1');
    assertEqual(Object.keys(empty).length,0,kind + ': Hauptspeicher leer');
    assertEqual(session.length,0,kind + ': Sitzung leer');
    if (kind !== 'localStorage') assertEqual(local.length,0,kind + ': alte Browserkopien und UIpräferenzen gelöscht');
    assertEqual(JSON.stringify(await A.readSnapshot('older')),old,kind + ': bisheriger Punkt bytegleich erhalten');
    const point = await A.readSnapshot(result.snapshotId);
    for (const [key,value] of Object.entries(before).filter(([k]) => k !== 'rs_snapshot_archive_v1')) assertEqual(point.records[key],value,kind + ': Punkt erhält Rohbestand ' + key);
    if (a.events) assert(a.events.indexOf('point') < a.events.indexOf('read-point',a.events.indexOf('point')) && a.events.indexOf('read-point',a.events.indexOf('point')) < a.events.indexOf('batch'), 'Reihenfolge Punkt → Readback → Löschen');
    // Echte Leerstart-Erzeugung; nach Reload besitzt die neue Seite einen freien Cache.
    await boot(a,win); bootstrapProfileContext(); await P.flush();
    const startRecords = await P.readPersistedRecords();
    const welcome = projectOverviewFromRecords({ registry: JSON.parse(startRecords.rs_profiles_v1), activeId: startRecords.rs_current_profile,
        liveData: startRecords, now: new Date('2026-10-12T12:00:00Z') });
    assert(welcome.firstStart,kind + ': Leerstart ergibt Welcome');
    assert(welcome.occasion.annualState !== 'recovery',kind + ': deriveOverviewOccasion ohne alte Recovery');
    const preview = await previewSnapshotRestore(result.snapshotId);
    const restored = await executeSnapshotRestore(preview,{ guard: createNavigationGuard(), reload: () => {}, window: win });
    assertEqual(restored.status,'restored',kind + ': Vor Neu beginnen aus Leerstart zurückholen');
    const returned = await P.readPersistedRecords(k => k !== 'rs_snapshot_archive_v1');
    for (const [key,value] of Object.entries(before).filter(([k]) => k !== 'rs_snapshot_archive_v1')) assertEqual(returned[key],value,kind + ': Rückholen vollständiger Rohbestand ' + key);
    assertEqual(returned.rs_profiles_v1,before.rs_profiles_v1,kind + ': Außenperson und Profilschlüssel bytegleich zurück');
    if (kind !== 'localStorage') assertEqual(local.getItem('ui_suite_sidebar_collapsed'),'true',kind + ': Gerätepräferenz wiederhergestellt');
    await boot(a,win);
    const removed = await make(win).execute({ ...confirmed, deleteSnapshots: true });
    assertEqual(removed.status,'restarted',kind + ': Neustart mit Archivlöschung');
    assertEqual((await A.listSnapshots()).length,0,kind + ': auch Snapshots leer');
    assertEqual(Object.keys(await P.readPersistedRecords()).length,0,kind + ': Hauptspeicher einschließlich Fallbackcontainer leer');
}

for (const failure of ['point','point-readback','delete','archive-delete']) {
    const a = adapter(); await boot(a); await A.createSnapshot({ id:'older', records:{}, label:'old' }); a.events.length=0; a.fail=failure;
    let navigated=false; const result = await make(undefined,{ navigate:()=>{ navigated=true; } }).execute({ ...confirmed, deleteSnapshots: failure==='archive-delete' });
    assertEqual(result.status,'failed',failure + ': sichtbarer Fehler'); assert(!navigated,failure + ': keine Erfolgsmeldung durch Navigation');
    if (failure.startsWith('point')) {
        assertEqual(recordIdentity(a.values),recordIdentity(original),'Punkt scheitert → nichts gelöscht: ' + failure);
        assert(!a.events.includes('batch'),failure + ': kein Löschbatch');
    } else if (failure==='delete') {
        assert(Boolean(result.snapshotId),'Teilfehler nennt vorhandenen Punkt Vor Neu beginnen');
        assertEqual((await A.readSnapshot(result.snapshotId)).records.rs_profiles_v1,original.rs_profiles_v1,'Teilfehler hat vollständigen Rückweg');
    } else assert(!result.snapshotId,'Archivlöschung legt keinen neuen Punkt an');
}
// Tauri muss echte IPC-Readbacks prüfen, auch wenn der Save Erfolg meldet.
for (const failure of ['snapshot-bytes', 'main-write']) {
    const files = new Map([['main', JSON.stringify({ schemaVersion: 1, records: original, metadata: {} })]]);
    const a = createTauriJsonFileAdapter({ invoke: async (command, args = {}) => {
        const target = args.target || 'main';
        if (command === 'load_app_state') return files.get(target) || null;
        if (command === 'save_app_state') {
            if (failure === 'snapshot-bytes' && target === 'snapshots') {
                const archive = JSON.parse(args.content); archive.snapshots[0].label = 'veränderte Datei'; files.set(target, JSON.stringify(archive)); return;
            }
            if (failure === 'main-write' && target === 'main' && Object.keys(JSON.parse(args.content).records).length === 0) return;
            files.set(target, args.content); return;
        }
        throw new Error(command);
    } });
    await boot(a); let navigation = false;
    const result = await make(undefined, { navigate: () => { navigation = true; } }).execute(confirmed);
    assertEqual(result.status, 'failed', 'Tauri tatsächlicher Dateifehler erkannt: ' + failure);
    assert(!navigation, 'Tauri Dateifehler verhindert Erststartnavigation: ' + failure);
    assertEqual(recordIdentity(await P.readPersistedRecords()), recordIdentity(original), 'Tauri Hauptdatei erhalten trotz scheinbar erfolgreichem Save: ' + failure);
    if (failure === 'main-write') assert(Boolean(result.snapshotId), 'Tauri Löschfehler verweist auf verifizierten Rückkehrpunkt');
}
for (const condition of ['trial','recovery','corrupt','unreadable','pending']) {
    const a=adapter(); await boot(a);
    const opts={};
    if(condition==='trial') { P.setItemSync('rs_probelauf_state_v1','broken'); await P.flush(); }
    if(condition==='recovery') opts.recovery=true;
    if(condition==='corrupt') { P.setItemSync('rs_profiles_v1','{'); await P.flush(); }
    if(condition==='unreadable') a.fail='read';
    if(condition==='pending') { const state=JSON.parse(P.getItemSync(CONFIG.STORAGE.LS_KEY)); state.annualPeriodMetadata={ schemaVersion:1,lastCommittedPeriod:null,pendingCommit:{ periodId:'calendar-year:2026',phase:'writes_started',snapshotId:'point' } }; P.setItemSync(CONFIG.STORAGE.LS_KEY,JSON.stringify(state)); await P.flush(); }
    await mustReject(()=>assertNewBeginningAllowed(opts),'Sperre bei Spielbereich/Recovery/Speicherfehler: ' + condition);
    a.events.length=0;
    const result=await make(undefined,{ recovery:()=>condition==='recovery' }).execute(confirmed);
    assertEqual(result.status,'failed',condition + ': auch API vor Löschung gesperrt'); assert(!a.events.includes('batch'),condition + ': kein Löschwrite');
}
for(const saved of [false,true]) for(const without of [false,true]) for(const confirmed of [false,true]) {
    assertEqual(canConfirmNewBeginning({ backupSaved:saved,withoutBackup:without,confirmed }),confirmed&&(saved||without),'Dialog-Freigabelogik: Sicherung/Verzicht plus Bestätigung');
}
assert(!canConfirmNewBeginning({...confirmed,busy:true}),'Laufender Dialog bleibt gesperrt');
P.resetPersistenceForTests();

// Echter Dialogbinder: Freigabe, Exportfehler, Warnhinweis und Escape/Rückfokus.
function dialogDoc() {
    const doc=createPresentationTestDocument(), create=doc.createElement.bind(doc);
    doc.createElement=tag=>{ const el=create(tag); el.dataset={}; el.classList={ add:token=>el.className+=' '+token }; el.focus=()=>doc.activeElement=el;
        el.removeEventListener=type=>el.events.delete(type); el.showModal=()=>el.open=true; el.close=()=>el.open=false; return el; };
    doc.getElementById=id=>doc.nodes.find(node=>{ if(node.id!==id) return false; let parent=node; while(parent&&parent!==doc.body) parent=parent.parentNode; return parent===doc.body; })||null;
    return doc;
}
const doc=dialogDoc(), opener=doc.createElement('button'); doc.body.appendChild(opener);
opener.disabled = true;
let exports=0, rejectBackup=true;
const stub={ blocked:false, inspect:async()=>({}), execute:async()=>({status:'cancelled'}) };
const task=showNewBeginningDialog(doc,{ controller:stub,opener,names:['Muster A','Außenperson'],backup:async()=>{ exports++; if(rejectBackup) throw new Error('Ausgabe abgebrochen'); } });
const check=(id,value)=>{ const el=doc.getElementById(id); el.checked=value; el.events.get('change')(); };
const accept=doc.getElementById('newBeginningConfirm');
assert(accept.disabled,'Echter Dialog startet gesperrt');
check('newBeginningConfirmed',true); assert(accept.disabled,'Bestätigung allein genügt nicht');
await doc.getElementById('newBeginningBackup').events.get('click')(); assert(accept.disabled,'Exportfehler gibt Dialog nicht frei');
rejectBackup=false; await doc.getElementById('newBeginningBackup').events.get('click')(); assert(!accept.disabled,'Erfolgreicher bestehender Export gibt Dialog frei');
assertEqual(exports,2,'Dialog nutzt genau den bestehenden Exportcallback');
check('newBeginningDeleteSnapshots',true); assert(!doc.getElementById('newBeginningWarning').hidden,'Archivlöschung zeigt deutliche Warnung');
doc.getElementById('newBeginningDialog').events.get('keydown')({ key:'Escape',preventDefault(){} }); await task;
assert(doc.activeElement === opener && !opener.disabled,'Escape bricht ab und gibt Rückfokus');
const withoutTask=showNewBeginningDialog(doc,{controller:stub,opener,names:[]});
check('newBeginningWithoutBackup',true); check('newBeginningConfirmed',true); check('newBeginningDeleteSnapshots',true);
assert(doc.getElementById('newBeginningWarning').textContent.includes('keinen Rückweg'),'Ohne Sicherung und Punkte warnt vor endgültigem Verlust');
assert(!doc.getElementById('newBeginningConfirm').disabled,'Ausdrücklicher Verzicht und Bestätigung erlauben Aktion');
doc.getElementById('newBeginningCancel').events.get('click')(); await withoutTask;
