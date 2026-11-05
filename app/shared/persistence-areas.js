import { createLocalStorageAdapter } from './persistence-adapter-localstorage.js';
import { createIndexedDbAdapter } from './persistence-adapter-indexeddb.js';
import { createTauriJsonFileAdapter } from './persistence-adapter-tauri.js';
import { detectRuntime } from './runtime-env.js';
import { AREA_CONTROL_KEY, PLAY_DB_NAME, scopeWebStorage, validateAreaControl } from './persistence-area-storage.js';
import { FIRST_HOUSEHOLD, HOUSEHOLD_REGISTRY_KEY, defaultHouseholdRegistry, householdStorageArea, newHouseholdId,
    normalizeHouseholdName, repairGeneration, validateHouseholdRegistry } from './household-registry.js';
export { validateAreaControl } from './persistence-area-storage.js';

const READY_KEY = 'playAreaReady';
const HOUSEHOLD_READY_KEY = 'householdReady';
export const HOUSEHOLD_CORRUPT_KEY = `${HOUSEHOLD_REGISTRY_KEY}_corrupt`;
const realControl = () => ({ version: 1, activeArea: 'echt', source: null, startedAt: null });
/** Bereichsadapter für die Fassade; der Vergleichszugang bleibt rein lesend.
 *
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function createPersistenceAreas(options = {}) {
    const win = options.window || globalThis.window;
    const runtime = detectRuntime(win);
    const invoke = options.invoke || win?.__TAURI__?.core?.invoke || globalThis.__TAURI__?.core?.invoke;
    const local = options.localStorage || win?.localStorage || globalThis.localStorage;
    const indexedDB = options.indexedDB || globalThis.indexedDB;
    const tauri = runtime === 'tauri';
    const useIndexedDB = !tauri && runtime === 'browser' && Boolean(indexedDB?.open);
    let expectedControl, expectedRegistry, registry = defaultHouseholdRegistry();
    const loadRegistry = async () => tauri
        ? await invoke('load_app_state', { target: 'households' }) || null
        : local?.getItem(HOUSEHOLD_REGISTRY_KEY) ?? null;
    // HV-4: Verzeichnis nur schreiben, wenn seine Generation noch die gelesene ist (Rust prüft unter Sperre).
    const generationArgs = () => ({ expectedGeneration: registry.generation });
    const saveRegistry = async (next, { force = false } = {}) => {
        const raw = JSON.stringify(next);
        if (tauri) await invoke('save_app_state', { target: 'households', content: raw, ...(force ? {} : generationArgs()) });
        else {
            if (!local) throw new Error('Haushaltsverzeichnis ist nicht verfügbar.');
            local.setItem(HOUSEHOLD_REGISTRY_KEY, raw);
        }
        if (await loadRegistry() !== raw) throw new Error('Haushaltsverzeichnis konnte nicht bestätigt werden.');
        expectedRegistry = raw; registry = validateHouseholdRegistry(raw);
    };
    // Ein beschädigtes Verzeichnis wird gesichert; geöffnet wird Haushalt 1 mit Warnung, die Bereiche der übrigen Haushalte bleiben liegen.
    const resolveRegistry = async () => {
        let raw = null;
        try { raw = await loadRegistry(); registry = validateHouseholdRegistry(raw); expectedRegistry = raw; return null; }
        catch {
            if (tauri) await invoke('quarantine_app_state', { target: 'households' });
            else local?.setItem(HOUSEHOLD_CORRUPT_KEY, String(raw));
            // Eindeutige Generation: keine alte Seite aus einer früheren Reparatur wird wieder schreibberechtigt.
            await saveRegistry({ ...defaultHouseholdRegistry(), generation: repairGeneration() }, { force: true });
            return { code: 'household-registry-invalid', message: 'Das Haushaltsverzeichnis war beschädigt und wurde gesichert. Geöffnet ist Haushalt 1; weitere Haushalte sind erst nach einer Reparatur wieder erreichbar.' };
        }
    };
    const loadControl = async () => tauri
        ? await invoke('load_app_state', { target: 'control' }) || null
        : local?.getItem(AREA_CONTROL_KEY) ?? null;
    const saveControl = async control => {
        const raw = JSON.stringify(control);
        if (tauri) await invoke('save_app_state', { target: 'control', content: raw, ...generationArgs() });
        else {
            if (!local) throw new Error('Speicherbereichssteuerung ist nicht verfügbar.');
            local.setItem(AREA_CONTROL_KEY, raw);
        }
        if (await loadControl() !== raw) throw new Error('Speicherbereich konnte nicht bestätigt werden.');
        expectedControl = raw;
    };
    function makeAdapter(area, skipLegacySnapshotMigration = false) {
        if (tauri) return createTauriJsonFileAdapter({ invoke, area, skipLegacySnapshotMigration, expectedGeneration: () => registry.generation });
        if (useIndexedDB) return createIndexedDbAdapter({ indexedDB, area, skipLegacySnapshotMigration });
        return createLocalStorageAdapter(() => local, { area });
    }
    // HV-2: Echt- und Spielorte des geöffneten Haushalts; Haushalt 1 behält die bisherigen Namen.
    const places = () => {
        const id = registry.active === FIRST_HOUSEHOLD ? null : registry.active;
        return { id, scope: id ? { household: id } : {}, real: householdStorageArea(registry, 'echt'), play: householdStorageArea(registry, 'spiel'),
            realDb: id ? `ruhestand-suite-hh-${id}` : 'ruhestand-suite', playDb: id ? `ruhestand-suite-hh-${id}-spiel` : PLAY_DB_NAME };
    };
    async function removePlay() {
        const p = places();
        if (tauri) await invoke('delete_play_state', { ...p.scope, ...generationArgs() });
        else if (indexedDB?.deleteDatabase) await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(p.playDb);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error || new Error('Spielbereich konnte nicht gelöscht werden.'));
            request.onblocked = () => reject(new Error('Spielbereich ist noch auf einer anderen Seite geöffnet. Bitte diese schließen.'));
        });
        scopeWebStorage(local, p.play)?.clear();
        scopeWebStorage(win?.sessionStorage, p.play)?.clear();
    }
    // Alle Orte eines weiteren Haushalts (echt, Spiel, Sitzung, Ordnerzugriff); jeder Ort wird versucht,
    // Fehler werden gesammelt und als Liste der verbliebenen Orte zurückgegeben.
    async function removeHouseholdStorage(id) {
        const failed = [];
        if (id === FIRST_HOUSEHOLD) throw new Error('Haushalt 1 lässt sich nicht löschen.');
        // Rust löscht nur unverzeichnete Haushalte (unter Sperre geprüft); daher ohne Generation.
        if (tauri) await invoke('delete_household_state', { household: id }).catch(error => failed.push(String(error?.message || error)));
        // Der Ordnerzugriff liegt unabhängig vom Hauptspeicher in IndexedDB, auch unter Tauri.
        const databases = [...(tauri ? [] : [`ruhestand-suite-hh-${id}`, `ruhestand-suite-hh-${id}-spiel`]), `ruhestand-suite-snapshot-handles-hh-${id}`];
        if (indexedDB?.deleteDatabase) {
            for (const name of databases) {
                await new Promise(resolve => {
                    try {
                        const request = indexedDB.deleteDatabase(name);
                        request.onsuccess = () => resolve();
                        request.onerror = () => { failed.push(name); resolve(); };
                        request.onblocked = () => { failed.push(`${name} (noch geöffnet)`); resolve(); };
                    } catch { failed.push(name); resolve(); }
                });
            }
        }
        for (const [label, storage] of [['Web Storage', local], ['Sitzung', win?.sessionStorage]]) {
            for (const area of [`hh:${id}`, `hhspiel:${id}`]) {
                try { scopeWebStorage(storage, area)?.clear(); } catch { failed.push(`${label} ${area}`); }
            }
        }
        return failed;
    }
    /** @returns {Promise<'yes' | 'no' | 'unknown'>} */
    const registration = async id => {
        try { return validateHouseholdRegistry(await loadRegistry()).households.some(entry => entry.id === id) ? 'yes' : 'no'; }
        catch { return 'unknown'; }
    };
    // Bereich einer gescheiterten Neuanlage entfernen, aber nur, wenn er sicher nicht verzeichnet ist; Reste ausdrücklich melden.
    async function cleanupUnregistered(id, error) {
        const state = await registration(id);
        if (state === 'unknown') return Object.assign(new Error(`${error?.message || error} Ob der neue Haushalt verzeichnet ist, ist ungeklärt; seine Daten bleiben erhalten. Bitte die App neu starten.`), { code: 'household-state-unclear', cause: error });
        if (state === 'yes') return error;
        let left;
        try { left = await removeHouseholdStorage(id); } catch (cause) { left = [String(cause?.message || cause)]; }
        if (!left.length) return error;
        return Object.assign(new Error(`${error?.message || error} Reste des abgebrochenen Haushalts konnten nicht vollständig entfernt werden.`),
            { code: 'household-cleanup-incomplete', cause: error, failed: left });
    }
    // Ohne Upgrade, Migration oder Quarantäne: auch Archive werden nur gelesen.
    async function readRealStore(storeName, project, databaseName = places().realDb) {
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
            let control, warning = await resolveRegistry();
            try {
                expectedControl = await loadControl();
                control = validateAreaControl(expectedControl);
            } catch {
                // Die Verzeichniswarnung wiegt schwerer und bleibt stehen.
                warning ||= { code: 'storage-area-control-invalid', message: 'Der Spielbereich konnte nicht gelesen werden und wurde verworfen. Deine echten Daten bleiben erhalten.' };
                if (tauri) await invoke('quarantine_app_state', { target: 'control', ...generationArgs() });
                await saveControl(realControl());
                control = realControl();
            }
            // HV-2: Ein Spielbereich gehört genau einem Haushalt; gehört er nicht zum geöffneten, endet er (Daten bleiben liegen).
            if (control.activeArea === 'spiel' && (control.household || FIRST_HOUSEHOLD) !== registry.active) {
                warning ||= { code: 'storage-area-incomplete', message: 'Der Spielbereich gehörte zu einem anderen Haushalt und wurde beendet. Deine echten Daten bleiben erhalten.' };
                await saveControl(realControl());
                control = realControl();
            }
            if (registry.active !== FIRST_HOUSEHOLD) {
                // Weiterer Haushalt: nie Altmigration; ohne Fertigmarker zurück zu Haushalt 1 mit Warnung und Merker für den Rückweg.
                const probe = makeAdapter(places().real, true);
                try {
                    await probe.open();
                    let ready = await probe.readMetadata(HOUSEHOLD_READY_KEY);
                    if (typeof ready === 'string') ready = JSON.parse(ready);
                    if (ready?.id !== registry.active) throw new Error('Haushalt nicht vollständig angelegt.');
                } catch {
                    const lost = registry.active;
                    const missing = registry.households.find(entry => entry.id === lost)?.name || 'Der Haushalt';
                    if (control.activeArea === 'spiel') { await saveControl(realControl()); control = realControl(); }
                    await saveRegistry({ ...registry, active: FIRST_HOUSEHOLD, generation: registry.generation + 1,
                        households: registry.households.map(entry => entry.id === lost ? { ...entry, missing: true } : entry) });
                    warning = { code: 'household-area-missing', message: `${missing} konnte nicht geöffnet werden. Geöffnet ist Haushalt 1.` };
                } finally { probe.close?.(); }
            }
            const p = places();
            let adapter = makeAdapter(control.activeArea === 'spiel' ? p.play : p.real, Boolean(warning) || Boolean(p.id));
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
                    adapter = makeAdapter(p.real, true);
                }
            }
            if (control.activeArea === 'echt') await removePlay();
            return { adapter, control, warning, registry, storageArea: control.activeArea === 'spiel' ? p.play : p.real };
        },
        households() { return structuredClone(registry); },
        // HV-4: native Abweisung eines Writes (Generation) meldet die Fassade hierher.
        contextChanged() { options.onAreaChanged?.(); },
        async assertCurrent() {
            if (await loadControl() !== expectedControl || await loadRegistry() !== expectedRegistry) {
                options.onAreaChanged?.();
                throw Object.assign(new Error('Speicherbereich geändert. Bitte neu laden; Eingaben werden bis dahin nicht gespeichert.'), { code: 'PERSISTENCE_RELOAD_REQUIRED' });
            }
        },
        async activate({ records, snapshots = [], source, startedAt = new Date().toISOString() }) {
            if (!['copy', 'demo'].includes(source) || !records || typeof records !== 'object' || Array.isArray(records)
                || Object.values(records).some(value => typeof value !== 'string') || !Number.isFinite(Date.parse(startedAt))) {
                throw new Error('Ungültige Spielbereichsdaten.');
            }
            await this.assertCurrent();
            await removePlay();
            const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
            const p = places();
            const control = { version: 1, activeArea: 'spiel', source, startedAt, id, phase: 'preparing', ...(p.id ? { household: p.id } : {}) };
            const play = makeAdapter(p.play);
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
            const p = places();
            const real = makeAdapter(p.real, true);
            const raw = tauri ? await invoke('load_app_state', { target: 'live', ...p.scope }) : null;
            const rows = useIndexedDB ? await readRealStore('kv', row => row, p.realDb) : null;
            const before = await this.readRealRecords();
            await real.open();
            return {
                adapter: real,
                async rollback() {
                    if (tauri) {
                        await invoke('save_app_state', { target: 'live', ...p.scope, content: raw, ...generationArgs() });
                        if (await invoke('load_app_state', { target: 'live', ...p.scope }) !== raw) throw new Error('Rohbestand konnte nicht zurückgeholt werden.');
                    } else if (useIndexedDB) {
                        const request = indexedDB.open(p.realDb);
                        const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
                        try {
                            const current = await real.loadAll(), tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv');
                            Object.keys(current).forEach(key => store.delete(key));
                            rows.forEach(row => store.put(row));
                            await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); });
                        } finally { db.close(); }
                        if (JSON.stringify(await readRealStore('kv', row => row, p.realDb)) !== JSON.stringify(rows)) throw new Error('Rohbestand konnte nicht zurückgeholt werden.');
                    } else {
                        const storage = scopeWebStorage(local, p.real);
                        // Das inzwischen angelegte Archiv bleibt als Rückkehrpunkt erhalten.
                        const archive = storage.getItem('rs_snapshot_archive_v1');
                        // HV-2: Der private Fertigmarker eines weiteren Haushalts ist kein Fachrecord und muss die Rücknahme überleben.
                        const marker = p.id ? storage.getItem(`metadata.${HOUSEHOLD_READY_KEY}`) : null;
                        storage.clear();
                        Object.entries(before).forEach(([key, value]) => storage.setItem(key, value));
                        if (archive !== null) storage.setItem('rs_snapshot_archive_v1', archive);
                        if (marker !== null) storage.setItem(`metadata.${HOUSEHOLD_READY_KEY}`, marker);
                        if (p.id && storage.getItem(`metadata.${HOUSEHOLD_READY_KEY}`) !== marker) throw new Error('Fertigmarker konnte nicht zurückgeholt werden.');
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
            const p = places();
            const capture = storage => Object.fromEntries(Array.from({ length: storage?.length || 0 }, (_, i) => storage.key(i)).map(key => [key, storage.getItem(key)]));
            const playLocal = scopeWebStorage(local, p.play), playSession = scopeWebStorage(win?.sessionStorage, p.play);
            const localBefore = capture(playLocal), sessionBefore = capture(playSession);
            const files = tauri ? await Promise.all(['spiel', 'spielsnapshots'].map(async target => [target, await invoke('load_app_state', { target, ...p.scope })])) : [];
            const stores = useIndexedDB ? await Promise.all(['kv', 'metadata', 'snapshots'].map(async name => [name, await readRealStore(name, row => row, p.playDb)])) : [];
            let deleting = false;
            try {
                await saveControl(realControl());
                adapter?.close?.(); deleting = true;
                await removePlay();
            } catch (cause) {
                // HV-4: Hat ein anderes Fenster inzwischen übernommen (neuer Spielbereich, Haushaltswechsel),
                // wird nichts zurückgeschrieben – sonst würde dessen neuer Stand überschrieben.
                if (/HOUSEHOLD_CONTEXT_CHANGED/.test(String(cause?.message || cause)) || cause?.code === 'PERSISTENCE_RELOAD_REQUIRED') {
                    options.onAreaChanged?.();
                    throw cause?.code === 'PERSISTENCE_RELOAD_REQUIRED' ? cause
                        : Object.assign(new Error('Ein anderes Fenster hat inzwischen den Speicherbereich geändert. Bitte neu laden und Daten & Sicherung prüfen.'), { code: 'PERSISTENCE_RELOAD_REQUIRED', cause });
                }
                try {
                    if (deleting) {
                        for (const [target, content] of files) if (content) {
                            await invoke('save_app_state', { target, ...p.scope, content, ...generationArgs() });
                            if (await invoke('load_app_state', { target, ...p.scope }) !== content) throw new Error('Spieldatei konnte nicht zurückgeholt werden.');
                        }
                        if (useIndexedDB) {
                            const recovery = makeAdapter(p.play, true);
                            await recovery.open(); recovery.close();
                            const request = indexedDB.open(p.playDb);
                            const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
                            try {
                                const current = await Promise.all(stores.map(async ([name]) => [name, await readRealStore(name, row => row, p.playDb)]));
                                const tx = db.transaction(stores.map(([name]) => name), 'readwrite');
                                for (const [name, rows] of current) rows.forEach(row => tx.objectStore(name).delete(row.key));
                                for (const [name, rows] of stores) rows.forEach(row => tx.objectStore(name).put(row));
                                await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); });
                            } finally { db.close(); }
                            for (const [name, rows] of stores) if (JSON.stringify(await readRealStore(name, row => row, p.playDb)) !== JSON.stringify(rows)) throw new Error('Spielbestand konnte nicht zurückgeholt werden.');
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
        // Neuer Haushalt: leeren Bereich anlegen und bestätigen, erst dann ins Verzeichnis.
        async createHousehold(name, createdAt = new Date().toISOString(), records = null) {
            await this.assertCurrent();
            const displayName = normalizeHouseholdName(name);
            const current = JSON.parse(expectedControl || 'null');
            if (current && current.activeArea !== 'echt') throw new Error('Erst den Spielbereich beenden.');
            let id;
            do id = newHouseholdId(); while (registry.households.some(entry => entry.id === id));
            const adapter = makeAdapter(householdStorageArea({ active: id }, 'echt'), true);
            try {
                await adapter.open();
                if (Object.keys(await adapter.loadAll()).length) throw new Error('Neuer Haushaltsbereich ist nicht leer.');
                // HV-3: Übergabedatei erst vollständig schreiben und zurücklesen, dann Fertigmarker und Verzeichnis.
                if (records) {
                    await adapter.saveBatch({ upserts: Object.entries(records), deletes: [] });
                    const back = adapter.readPersistedRecords ? await adapter.readPersistedRecords() : await adapter.loadAll();
                    if (Object.keys(back).length !== Object.keys(records).length || Object.entries(records).some(([key, value]) => back[key] !== value)) {
                        throw new Error('Die Übergabedatei konnte nicht vollständig gespeichert werden.');
                    }
                }
                await adapter.writeMetadata(HOUSEHOLD_READY_KEY, { id });
                let ready = await adapter.readMetadata(HOUSEHOLD_READY_KEY);
                if (typeof ready === 'string') ready = JSON.parse(ready);
                if (ready?.id !== id) throw new Error('Neuer Haushalt konnte nicht bestätigt werden.');
            } catch (error) {
                adapter.close?.();
                throw await cleanupUnregistered(id, error);
            } finally { adapter.close?.(); }
            try {
                await saveRegistry({ ...registry, active: id, generation: registry.generation + 1,
                    households: [...registry.households, { id, name: displayName, createdAt }] });
            } catch (error) {
                // Steht der Haushalt trotz gescheiterter Bestätigung im Verzeichnis (anderes Fenster hat danach geändert),
                // ist er angelegt und seine Daten bleiben.
                if (await registration(id) === 'yes') return id;
                throw await cleanupUnregistered(id, error);
            }
            return id;
        },
        async switchHousehold(id) {
            await this.assertCurrent();
            const current = JSON.parse(expectedControl || 'null');
            if (current && current.activeArea !== 'echt') throw new Error('Erst den Spielbereich beenden.');
            if (!registry.households.some(entry => entry.id === id)) throw new Error('Unbekannter Haushalt.');
            if (registry.active === id) return false;
            await saveRegistry({ ...registry, active: id, generation: registry.generation + 1 });
            return true;
        },
        // HV-2 Verwaltung: Umbenennen ändert nur den Anzeigenamen, nie Orte oder Personen.
        async renameHousehold(id, name) {
            await this.assertCurrent();
            const displayName = normalizeHouseholdName(name);
            if (!registry.households.some(entry => entry.id === id)) throw new Error('Unbekannter Haushalt.');
            await saveRegistry({ ...registry, generation: registry.generation + 1,
                households: registry.households.map(entry => entry.id === id ? { ...entry, name: displayName } : entry) });
        },
        // Endgültig: erst aus dem Verzeichnis, dann alle Orte dieses Haushalts (echt, Spiel, Sitzung, Ordnerzugriff).
        async deleteHousehold(id, confirmName) {
            await this.assertCurrent();
            const current = JSON.parse(expectedControl || 'null');
            if (current && current.activeArea !== 'echt') throw new Error('Erst den Spielbereich beenden.');
            const entry = registry.households.find(item => item.id === id);
            if (!entry) throw new Error('Unbekannter Haushalt.');
            if (id === FIRST_HOUSEHOLD) throw new Error('Haushalt 1 lässt sich nicht löschen.');
            if (id === registry.active) throw new Error('Den geöffneten Haushalt kannst du nicht löschen. Wechsle zuerst in einen anderen.');
            if (String(confirmName ?? '').replace(/\s+/g, ' ').trim() !== entry.name) throw new Error('Der eingetippte Name stimmt nicht.');
            await saveRegistry({ ...registry, generation: registry.generation + 1, households: registry.households.filter(item => item.id !== id) });
            const failed = await removeHouseholdStorage(id);
            if (failed.length) throw Object.assign(new Error('Der Haushalt ist aus der Auswahl entfernt, seine Daten konnten aber nicht vollständig gelöscht werden.'), { code: 'household-delete-incomplete', failed });
        },
        // Rückweg für einen Haushalt, dessen Bereich beim Öffnen fehlte: Bereich wieder anlegen (vorhandene Reste bleiben) und öffnen.
        async rebuildHousehold(id) {
            await this.assertCurrent();
            const current = JSON.parse(expectedControl || 'null');
            if (current && current.activeArea !== 'echt') throw new Error('Erst den Spielbereich beenden.');
            const entry = registry.households.find(item => item.id === id);
            if (!entry?.missing) throw new Error('Dieser Haushalt braucht keinen neuen Bereich.');
            const adapter = makeAdapter(householdStorageArea({ active: id }, 'echt'), true);
            try {
                await adapter.open();
                await adapter.writeMetadata(HOUSEHOLD_READY_KEY, { id });
                let ready = await adapter.readMetadata(HOUSEHOLD_READY_KEY);
                if (typeof ready === 'string') ready = JSON.parse(ready);
                if (ready?.id !== id) throw new Error('Bereich konnte nicht bestätigt werden.');
            } finally { adapter.close?.(); }
            const { missing, ...restored } = entry;
            await saveRegistry({ ...registry, active: id, generation: registry.generation + 1,
                households: registry.households.map(item => item.id === id ? restored : item) });
        },
        // HV-3: Records eines verzeichneten Haushalts nur lesend (Übergabedatei); keine Migration, keine Quarantäne.
        async readHouseholdRecords(id) {
            await this.assertCurrent();
            const entry = registry.households.find(item => item.id === id);
            if (!entry || entry.missing) throw new Error('Dieser Haushalt lässt sich gerade nicht lesen.');
            const scope = id === FIRST_HOUSEHOLD ? {} : { household: id };
            if (tauri) {
                // Eigener Lesebefehl: keine Ordneranlage, keine Wiederherstellung aus .tmp/.bak.
                const raw = await invoke('read_household_state', scope);
                return raw ? JSON.parse(raw).records || {} : {};
            }
            if (!useIndexedDB) return makeAdapter(householdStorageArea({ active: id }, 'echt')).loadAll();
            return Object.fromEntries(await readRealStore('kv', row => [row.key, row.value], id === FIRST_HOUSEHOLD ? 'ruhestand-suite' : `ruhestand-suite-hh-${id}`));
        },
        async readRealRecords() {
            // Kein open mit Upgrade, keine Migration, keine Quarantäne im echten Bereich.
            if (tauri) {
                const raw = await invoke('load_app_state', { target: 'live', ...places().scope });
                return raw ? JSON.parse(raw).records || {} : {};
            }
            if (!useIndexedDB) return makeAdapter(places().real).loadAll();
            return Object.fromEntries(await readRealStore('kv', row => [row.key, row.value]));
        },
        async readRealSnapshots() {
            if (tauri) {
                const raw = await invoke('load_app_state', { target: 'snapshots', ...places().scope });
                return raw ? JSON.parse(raw).snapshots || [] : [];
            }
            // Im localStorage liegt das Archiv bereits als Record in der Kopie.
            return useIndexedDB ? readRealStore('snapshots', row => row.snapshot) : [];
        }
    };
}
