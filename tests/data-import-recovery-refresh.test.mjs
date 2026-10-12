import fs from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { bindDataExchange } from '../app/data/data-exchange.js';
import { buildFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { initDataPage } from '../app/data/data-page.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { PersistenceFacade as p, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createBalanceExportDocument } from '../app/balance/balance-binder-imports.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { readDataModel } from '../app/data/data-model.js';
import { renderDataPage } from '../app/data/data-renderer.js';

const previous = { document:globalThis.document, window:globalThis.window, location:globalThis.location, FileReader:globalThis.FileReader };
const balanceSource = fs.readFileSync(new URL('../Balance.html', import.meta.url),'utf8');
const pageSource = fs.readFileSync(new URL('../Daten-Sicherung.html', import.meta.url),'utf8');
function makeDocument(decision, readWrites) {
    const doc = createPresentationTestDocument();
    const create = doc.createElement.bind(doc);
    doc.createElement = tag => {
        const node = create(tag); node.dataset = {}; node.focus = () => {};
        node.removeEventListener = type => node.events.delete(type);
        node.classList = { contains: value => node.className.split(' ').includes(value) };
        node.close = () => { node.open = false; };
        node.showModal = () => { node.open = true; queueMicrotask(() => doc.nodes.find(item => decision ? item.dataset?.pageDialogAccept === '' : item.dataset?.pageDialogCancel === '').click()); };
        return node;
    };
    for (const match of pageSource.matchAll(/\bid="([^"]+)"/g)) {
        if (doc.getElementById(match[1])) continue;
        const node=doc.createElement('div'); node.id=match[1]; doc.body.appendChild(node);
    }
    const inputs=[];
    for (const match of balanceSource.matchAll(/<(input|select)\b([^>]*\bid="([^"]+)"[^>]*)>([\s\S]*?)(?=<\/select>|<input|<\/div|\n|$)/g)) {
        const node=doc.createElement(match[1]); node.id=match[3]; node.type=/type="([^"]+)"/.exec(match[2])?.[1] || 'text';
        node.value=/value="([^"]*)"/.exec(match[2])?.[1] || '';
        if(match[1]==='select') node.value=/<option[^>]*value="([^"]*)"[^>]*selected/.exec(match[4])?.[1] || /<option[^>]*value="([^"]*)"/.exec(match[4])?.[1] || '';
        node.checked=/\bchecked\b/.test(match[2]); node.className=/class="([^"]*)"/.exec(match[2])?.[1] || '';
        doc.body.appendChild(node); inputs.push(node);
    }
    doc.contains=()=>true;
    doc.documentElement={dataset:{suitePage:'data'}};
    doc.querySelectorAll=()=>[];
    const listeners=new Map(), eventTasks=[], importErrors=[];
    doc.addEventListener=(type,fn)=>{
        if(!listeners.has(type)) listeners.set(type,new Set());
        listeners.get(type).add(fn);
    };
    doc.removeEventListener=(type,fn)=>listeners.get(type)?.delete(fn);
    // Nur DOM-Ereigniszustellung beobachten; der Refresh-Empfänger kommt vom Seitenstart.
    doc.dispatchEvent=event=>{
        if(event.type==='overview-backup-changed') importErrors.push({
            status:doc.getElementById('fullBackupStatus').textContent,
            technical:doc.getElementById('dataBackupTechnical').textContent,
            writes:readWrites()
        });
        for(const fn of listeners.get(event.type)||[]) eventTasks.push(Promise.resolve(fn(event)));
        return true;
    };
    const win={ EngineAPI:{...EngineAPI}, addEventListener(){}, removeEventListener(){},
        location:{search:'',hash:'',reload(){throw new Error('Unerwarteter Reload');}},
        fetch:async()=>({ok:true,text:async()=>balanceSource}), DOMParser:class { parseFromString(){return {querySelectorAll:()=>inputs};} } };
    doc.getElementById('suiteNavigation').querySelector=()=>({href:'Daten-Sicherung.html'});
    doc.defaultView=win;
    return {doc,win,eventTasks,importErrors};
}
try {
    for (const mode of ['balance-final','balance-refresh-error','full-reload-error','full-write-error','full-after-recovery','balance-invalid','balance-cancel','full-invalid','full-cancel']) {
        const records=createMusterHaushaltRecords('2026-09-01'), points=new Map();
        let writes=0, failWrite=false;
        resetPersistenceForTests({name:mode,loadAll:async()=>({...records}), saveBatch:async batch=>{
            if(failWrite && batch.upserts.some(([key])=>key==='sim_next')) {failWrite=false;throw new Error('SYNTHETIC_IMPORT_WRITE_FAILED');}
            writes++; for(const key of batch.deletes) delete records[key]; for(const [key,value] of batch.upserts) records[key]=value;
        }, writeSnapshot:async point=>points.set(point.id,point),readSnapshot:async id=>points.get(id),listSnapshots:async()=>[...points.values()]});
        await p.init({installLifecycleHooks:false,installTauriCloseHook:false});
        const {doc,win,eventTasks,importErrors}=makeDocument(!mode.endsWith('cancel'),()=>writes);
        globalThis.document=doc; globalThis.window=win; globalThis.location=win.location;
        const refresh=async()=>renderDataPage(doc,await readDataModel(p));
        if(mode.startsWith('full')) {
            await initDataPage(doc,win);
            assertEqual(doc.documentElement.dataset.dataReady,'true',mode+': produktiver Seitenstart abgeschlossen');
            assert(doc.getElementById('fullBackupImportFile').events.has('change'),mode+': Importbinder stammt vom Seitenstart');
            assertEqual(doc.getElementById('dataSnapshotList').children.length,0,mode+': Seitenstart zeigt noch keinen Wiederherstellungspunkt');
        } else await refresh();
        const originalRecords={...records}, beforeWrites=writes;
        if(mode.startsWith('balance')) {
            const state=JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
            for(const key of ['goldBestand','zielLiquiditaetJahre','runwayMinM','runwayTargetM']) delete state.inputs[key];
            const file=createBalanceExportDocument(state);
            const replace=StorageManager.replaceStateFromImport;
            let afterReplace=false;
            win.EngineAPI.simulateSingleYear=(...args)=>{ if(afterReplace) throw new Error('SYNTHETIC_FINAL_ENGINE_FAILED'); return EngineAPI.simulateSingleYear(...args); };
            try {
                StorageManager.replaceStateFromImport=async(...args)=>{ const receipt=await replace.apply(StorageManager,args); afterReplace=true; return receipt; };
                let finish;
                const finished = new Promise(resolve => { finish = resolve; });
                const controller=bindDataExchange(doc,{win,guard:createNavigationGuard({decide:async()=>true}),refresh:async()=>{
                    await refresh(); if(mode==='balance-refresh-error') throw new Error('SYNTHETIC_REFRESH_FAILED');
                }});
                const run = controller.run.bind(controller);
                controller.run = (...args) => run(...args).then(result => {
                    queueMicrotask(finish); return result;
                }, error => { queueMicrotask(finish); throw error; });
                const input=doc.getElementById('dataBalanceFile'); input.files=[{text:async()=>mode==='balance-invalid'?'ungültige Datei':JSON.stringify(file)}];
                input.events.get('change')({target:input});
                await finished;
                assert(!controller.busy,mode+': echter Binder beendet den Import');
            } finally {StorageManager.replaceStateFromImport=replace;}
        } else {
            const file=buildFullPersistenceBackup({storage:{exportAllSync:()=>({records:{sim_next:'synthetisch'}})},window:win});
            globalThis.FileReader=class { readAsText(){this.result=mode==='full-invalid'?'ungültige Datei':JSON.stringify(file);this.onload();} };
            const guard=getPageNavigationGuard(doc,win);
            const reload=guard.reload.bind(guard);
            guard.reload=async options=>{
                if(mode==='full-reload-error') throw new Error('SYNTHETIC_RELOAD_BOUNDARY_FAILED');
                failWrite=mode==='full-write-error';
                return reload(options);
            };
            const readSnapshot=p.readSnapshot;
            let reads=0;
            try {
                // Zusätzlicher Dienstread nach bestätigtem Archivwrite, vor guard.reload.
                if(mode==='full-after-recovery') p.readSnapshot=async(...args)=>{
                    const point=await readSnapshot.apply(p,args); if(++reads===1) throw new Error('SYNTHETIC_PREPARED_RECOVERY_FAILED'); return point;
                };
                const input=doc.getElementById('fullBackupImportFile');input.files=[{}];
                await input.events.get('change')(); await Promise.all(eventTasks);
            } finally { p.readSnapshot=readSnapshot; }
        }
        const financialKeys=Object.keys(originalRecords).filter(key=>!key.startsWith('snapshot_'));
        for(const key of financialKeys) {
            if(key==='rs_profiles_v1' && mode.startsWith('balance') && points.size) {
                const before=JSON.parse(originalRecords[key]), after=JSON.parse(records[key]);
                // Die bestehende Recovery aktualisiert Registry-Metadaten; Fachrohstrings bleiben exakt.
                for(const [id,profile] of Object.entries(before.profiles))
                    for(const [field,value] of Object.entries(profile.data))
                        assert(after.profiles[id].data[field]===value,mode+': Profil-Finanzrohstring bleibt bytegleich: '+id+'/'+field);
            } else assert(records[key]===originalRecords[key],mode+': vorhandener Finanzrohstring bleibt bytegleich: '+key);
        }
        assertEqual(records.sim_next,undefined,mode+': keine importierten Finanzdaten nach Fehler/Abbruch');
        if(mode.endsWith('invalid') || mode.endsWith('cancel')) {
            assertEqual(points.size,0,mode+': kein Wiederherstellungspunkt');
            assertEqual(writes,beforeWrites,mode+': kein Fachwrite');
            if(mode.startsWith('full')) assertEqual(importErrors.length,0,mode+': kein Archivrefresh vor Recoveryerzeugung');
        } else {
            assertEqual(points.size,1,mode+': genau ein bestätigter Wiederherstellungspunkt: '+doc.getElementById('dataExchangeTechnical').textContent+doc.getElementById('fullBackupStatus').textContent);
            const visible=doc.getElementById('dataSnapshotList').children.flatMap(row=>row.children).find(node=>node.dataset?.restorePreview)?.dataset.restorePreview;
            assertEqual(visible,[...points.keys()][0],mode+': sichtbare Punkt-ID stimmt ohne Reload mit Archiv-ID überein');
            const technical=doc.getElementById(mode.startsWith('balance')?'dataExchangeTechnical':'dataBackupTechnical').textContent;
            assert(mode.startsWith('balance')?technical.includes('abschließende Prüfung'):mode==='full-reload-error'?technical.includes('SYNTHETIC_RELOAD_BOUNDARY_FAILED'):mode==='full-after-recovery'?technical.includes('SYNTHETIC_PREPARED_RECOVERY_FAILED'):technical.includes('Dein bisheriger Stand ist unverändert'),mode+': ursprünglicher Importfehler bleibt sichtbar');
            if(mode.startsWith('full')) {
                assertEqual(importErrors.length,1,mode+': produktiver Fehlerpfad meldet die Archivänderung');
                assertEqual(doc.getElementById('fullBackupStatus').textContent,importErrors[0].status,mode+': Seitenrefresh bewahrt die ursprüngliche Hauptmeldung');
                assertEqual(doc.getElementById('dataBackupTechnical').textContent,importErrors[0].technical,mode+': Seitenrefresh bewahrt die ursprüngliche technische Ursache');
                assertEqual(doc.getElementById('fullBackupStatus').dataset.kind,'error',mode+': Seitenrefresh bewahrt den Fehlerstatus');
                assertEqual(writes,importErrors[0].writes,mode+': Ereignisrefresh bleibt schreibfrei');
            }
        }
    }
} finally { Object.assign(globalThis,previous);resetPersistenceForTests(); }
