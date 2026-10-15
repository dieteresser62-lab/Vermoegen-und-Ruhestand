import { createLocalStorageAdapter } from './persistence-adapter-localstorage.js';
import { createIndexedDbAdapter } from './persistence-adapter-indexeddb.js';
import { createTauriJsonFileAdapter } from './persistence-adapter-tauri.js';
import { detectRuntime } from './runtime-env.js';
import { AREA_CONTROL_KEY, PLAY_DB_NAME, scopeWebStorage, validateAreaControl } from './persistence-area-storage.js';
export { validateAreaControl } from './persistence-area-storage.js';

const READY_KEY = 'playAreaReady';
const realControl = () => ({ version: 1, activeArea: 'echt', source: null, startedAt: null });
/** Bereichsadapter für die Fassade; der Vergleichszugang bleibt rein lesend. */
export function createPersistenceAreas(options = {}) {
    const win = options.window || globalThis.window;
    const runtime = detectRuntime(win);
    const invoke = options.invoke || win?.__TAURI__?.core?.invoke || globalThis.__TAURI__?.core?.invoke;
    const local = options.localStorage || win?.localStorage || globalThis.localStorage;
    const indexedDB = options.indexedDB || globalThis.indexedDB;
    const tauri = runtime === 'tauri';
    const useIndexedDB = !tauri && runtime === 'browser' && Boolean(indexedDB?.open);
    let expectedControl;
    const loadControl = async () => tauri
        ? await invoke('load_app_state', { target: 'control' }) || null
        : local?.getItem(AREA_CONTROL_KEY) ?? null;
    const saveControl = async control => {
        const raw = JSON.stringify(control);
        if (tauri) await invoke('save_app_state', { target: 'control', content: raw });
        else {
            if (!local) throw new Error('Speicherbereichssteuerung ist nicht verfügbar.');
            local.setItem(AREA_CONTROL_KEY, raw);
        }
        if (await loadControl() !== raw) throw new Error('Speicherbereich konnte nicht bestätigt werden.');
        expectedControl = raw;
    };
    function makeAdapter(area, skipLegacySnapshotMigration = false) {
        if (tauri) return createTauriJsonFileAdapter({ invoke, area, skipLegacySnapshotMigration });
        if (useIndexedDB) return createIndexedDbAdapter({ indexedDB, area, skipLegacySnapshotMigration });
        return createLocalStorageAdapter(() => local, { area });
    }
    async function removePlay() {
        if (tauri) await invoke('delete_play_state');
        else if (indexedDB?.deleteDatabase) await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(PLAY_DB_NAME);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error || new Error('Spielbereich konnte nicht gelöscht werden.'));
            request.onblocked = () => reject(new Error('Spielbereich ist noch auf einer anderen Seite geöffnet. Bitte diese schließen.'));
        });
        scopeWebStorage(local, 'spiel')?.clear();
        scopeWebStorage(win?.sessionStorage, 'spiel')?.clear();
    }
    // Ohne Upgrade, Migration oder Quarantäne: auch Archive werden nur gelesen.
    async function readRealStore(storeName, project, databaseName = 'ruhestand-suite') {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName);
            let absent = false;
            request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
            request.onerror = () => absent ? resolve([]) : reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return; }
                const rows = [], tx = db.transaction(storeName, 'readonly');
                const cursorRequest = tx.objectStore(storeName).openCursor();
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor) return;
                    rows.push(project(cursor.value)); cursor.continue();
                };
                tx.oncomplete = () => { db.close(); resolve(rows); };
                tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
            };
        });
    }
    return {
        makeAdapter,
        localStorage: area => scopeWebStorage(local, area),
        async resolve() {
            let control, warning = null;
            try {
                expectedControl = await loadControl();
                control = validateAreaControl(expectedControl);
            } catch {
                warning = { code: 'storage-area-control-invalid', message: 'Der Spielbereich konnte nicht gelesen werden und wurde verworfen. Deine echten Daten bleiben erhalten.' };
                if (tauri) await invoke('quarantine_app_state', { target: 'control' });
                await saveControl(realControl());
                control = realControl();
            }
            let adapter = makeAdapter(control.activeArea, Boolean(warning));
            if (control.activeArea === 'spiel') {
                try {
                    await adapter.open();
                    let ready = await adapter.readMetadata(READY_KEY);
                    if (typeof ready === 'string') ready = JSON.parse(ready);
                    if (ready?.id !== control.id) throw new Error('Spielbereich wurde nicht vollständig angelegt.');
                } catch {
                    adapter.close?.();
                    warning = { code: 'storage-area-incomplete', message: 'Der unvollständige Spielbereich wurde verworfen. Deine echten Daten bleiben erhalten.' };
                    await saveControl(realControl());
                    control = realControl();
                    adapter = makeAdapter('echt', true);
                }
            }
            if (control.activeArea === 'echt') await removePlay();
            return { adapter, control, warning };
        },
        async assertCurrent() {
            if (await loadControl() !== expectedControl) throw new Error('Speicherbereich geändert. Bitte neu laden; Eingaben werden bis dahin nicht gespeichert.');
        },
        async activate({ records, snapshots = [], source, startedAt = new Date().toISOString() }) {
            if (!['copy', 'demo'].includes(source) || !records || typeof records !== 'object' || Array.isArray(records)
                || Object.values(records).some(value => typeof value !== 'string') || !Number.isFinite(Date.parse(startedAt))) {
                throw new Error('Ungültige Spielbereichsdaten.');
            }
            await this.assertCurrent();
            await removePlay();
            const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
            const control = { version: 1, activeArea: 'spiel', source, startedAt, id, phase: 'preparing' };
            const play = makeAdapter('spiel');
            try {
                await saveControl(control);
                await play.open();
                await play.saveBatch({ upserts: Object.entries(records), deletes: [] });
                for (const snapshot of snapshots) {
                    if (play.writeSnapshot) await play.writeSnapshot(snapshot);
                    else {
                        const archive = JSON.stringify({ schemaVersion: 1, snapshots, savedAt: startedAt });
                        await play.saveBatch({ upserts: [['rs_snapshot_archive_v1', archive]], deletes: [] });
                        break;
                    }
                }
                const confirmed = await play.loadAll();
                if (Object.entries(records).some(([key, value]) => confirmed[key] !== value)) throw new Error('Spielbereich konnte nicht bestätigt werden.');
                for (const snapshot of snapshots) {
                    const read = play.readPersistedSnapshot || play.readSnapshot;
                    if (read && JSON.stringify(await read.call(play, snapshot.id)) !== JSON.stringify(snapshot)) throw new Error('Spiel-Sicherungspunkt konnte nicht bestätigt werden.');
                }
                await play.writeMetadata(READY_KEY, { id });
                let ready = await play.readMetadata(READY_KEY);
                if (typeof ready === 'string') ready = JSON.parse(ready);
                if (ready?.id !== id) throw new Error('Spielbereich-Fertigmarker konnte nicht bestätigt werden.');
                await saveControl({ ...control, phase: 'active' });
            } catch (error) {
                play.close?.();
                await saveControl(realControl());
                await removePlay();
                throw error;
            } finally { play.close?.(); }
        },
        async discard(adapter) {
            await this.assertCurrent();
            // Ab hier dürfen alte Seiten nicht mehr schreiben. Bei einem Absturz
            // wird ein verbliebener Spielbereich beim nächsten Start entfernt.
            await saveControl(realControl());
            adapter?.close?.();
            await removePlay();
        },
        // Nur die ausdrücklich bestätigte Übernahme erhält diesen Schreibzugang.
        // Kein Bereichswechsel, keine Migration, kein Austausch des Spiel-Caches.
        async openRealTransfer() {
            await this.assertCurrent();
            const real = makeAdapter('echt', true);
            const raw = tauri ? await invoke('load_app_state', { target: 'live' }) : null;
            const rows = useIndexedDB ? await readRealStore('kv', row => row) : null;
            const before = await this.readRealRecords();
            await real.open();
            return {
                adapter: real,
                async rollback() {
                    if (tauri) {
                        await invoke('save_app_state', { target: 'live', content: raw });
                        if (await invoke('load_app_state', { target: 'live' }) !== raw) throw new Error('Rohbestand konnte nicht zurückgeholt werden.');
                    } else if (useIndexedDB) {
                        const request = indexedDB.open('ruhestand-suite');
                        const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
                        try {
                            const current = await real.loadAll(), tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv');
                            Object.keys(current).forEach(key => store.delete(key));
                            rows.forEach(row => store.put(row));
                            await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); });
                        } finally { db.close(); }
                        if (JSON.stringify(await readRealStore('kv', row => row)) !== JSON.stringify(rows)) throw new Error('Rohbestand konnte nicht zurückgeholt werden.');
                    } else {
                        const storage = scopeWebStorage(local, 'echt');
                        // Das inzwischen angelegte Archiv bleibt als Rückkehrpunkt erhalten.
                        const archive = storage.getItem('rs_snapshot_archive_v1');
                        storage.clear();
                        Object.entries(before).forEach(([key, value]) => storage.setItem(key, value));
                        if (archive !== null) storage.setItem('rs_snapshot_archive_v1', archive);
                        const identity = records => JSON.stringify(Object.entries(records).filter(([key]) => key !== 'rs_snapshot_archive_v1').sort());
                        if (identity(await real.loadAll()) !== identity(before)) throw new Error('Rohbestand konnte nicht zurückgeholt werden.');
                    }
                },
                close() { real.close?.(); }
            };
        },
        async finishTransfer(adapter) {
            await this.assertCurrent();
            const previous = expectedControl;
            const capture = storage => Object.fromEntries(Array.from({ length: storage?.length || 0 }, (_, i) => storage.key(i)).map(key => [key, storage.getItem(key)]));
            const playLocal = scopeWebStorage(local, 'spiel'), playSession = scopeWebStorage(win?.sessionStorage, 'spiel');
            const localBefore = capture(playLocal), sessionBefore = capture(playSession);
            const files = tauri ? await Promise.all(['spiel', 'spielsnapshots'].map(async target => [target, await invoke('load_app_state', { target })])) : [];
            const stores = useIndexedDB ? await Promise.all(['kv', 'metadata', 'snapshots'].map(async name => [name, await readRealStore(name, row => row, PLAY_DB_NAME)])) : [];
            let deleting = false;
            try {
                await saveControl(realControl());
                adapter?.close?.(); deleting = true;
                await removePlay();
            } catch (cause) {
                try {
                    if (deleting) {
                        for (const [target, content] of files) if (content) {
                            await invoke('save_app_state', { target, content });
                            if (await invoke('load_app_state', { target }) !== content) throw new Error('Spieldatei konnte nicht zurückgeholt werden.');
                        }
                        if (useIndexedDB) {
                            const recovery = makeAdapter('spiel', true);
                            await recovery.open(); recovery.close();
                            const request = indexedDB.open(PLAY_DB_NAME);
                            const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
                            try {
                                const current = await Promise.all(stores.map(async ([name]) => [name, await readRealStore(name, row => row, PLAY_DB_NAME)]));
                                const tx = db.transaction(stores.map(([name]) => name), 'readwrite');
                                for (const [name, rows] of current) rows.forEach(row => tx.objectStore(name).delete(row.key));
                                for (const [name, rows] of stores) rows.forEach(row => tx.objectStore(name).put(row));
                                await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); });
                            } finally { db.close(); }
                            for (const [name, rows] of stores) if (JSON.stringify(await readRealStore(name, row => row, PLAY_DB_NAME)) !== JSON.stringify(rows)) throw new Error('Spielbestand konnte nicht zurückgeholt werden.');
                        }
                        const restore = (storage, records) => {
                            if (!storage) return;
                            storage.clear(); Object.entries(records).forEach(([key, value]) => storage.setItem(key, value));
                            const identity = value => JSON.stringify(Object.entries(value).sort());
                            if (identity(capture(storage)) !== identity(records)) throw new Error('Spielcache konnte nicht zurückgeholt werden.');
                        };
                        restore(playLocal, localBefore); restore(playSession, sessionBefore);
                        await adapter.open();
                    }
                    await saveControl(JSON.parse(previous));
                } catch (rollbackError) {
                    throw Object.assign(new Error('Übernahme fehlgeschlagen; der Spielbereich konnte nicht vollständig zurückgeholt werden. Bitte neu laden und Daten & Sicherung prüfen.'), { cause, rollbackError, code: 'rollback_failed' });
                }
                throw cause;
            }
        },
        async readRealRecords() {
            // Kein open mit Upgrade, keine Migration, keine Quarantäne im echten Bereich.
            if (tauri) {
                const raw = await invoke('load_app_state', { target: 'live' });
                return raw ? JSON.parse(raw).records || {} : {};
            }
            if (!useIndexedDB) return makeAdapter('echt').loadAll();
            return Object.fromEntries(await readRealStore('kv', row => [row.key, row.value]));
        },
        async readRealSnapshots() {
            if (tauri) {
                const raw = await invoke('load_app_state', { target: 'snapshots' });
                return raw ? JSON.parse(raw).snapshots || [] : [];
            }
            // Im localStorage liegt das Archiv bereits als Record in der Kopie.
            return useIndexedDB ? readRealStore('snapshots', row => row.snapshot) : [];
        }
    };
}
