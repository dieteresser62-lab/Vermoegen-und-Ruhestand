import { PersistenceFacade as P } from '../../app/shared/persistence-facade.js';
import { createPersistenceAreas } from '../../app/shared/persistence-areas.js';
import { AREA_CONTROL_KEY, PLAY_STORAGE_PREFIX } from '../../app/shared/persistence-area-storage.js';
import { createProbelaufController } from '../../app/shared/probelauf-state.js';
import { MemoryWebStorage, fakeAreaIndexedDB, fakeAreaTauri } from './persistence-area-backends.mjs';

/** Produktionsadapter mit getrennten, dauerhaft lesbaren Fake-Backends. */
export async function playFixture(kind = 'tauri', records = {}) {
    const local = new MemoryWebStorage(), session = new MemoryWebStorage();
    const tauri = kind === 'tauri' ? fakeAreaTauri() : null;
    const indexedDB = kind === 'indexeddb' ? fakeAreaIndexedDB() : null;
    const f = { local, session, tauri, indexedDB, writes: 0, snapshotWrites: 0, fail: false };
    const invoke = async (command, args = {}) => {
        if (command === 'save_app_state') {
            if (f.fail) { f.fail = false; throw new Error('Test-Commitfehler'); }
            f.writes++;
            if (['snapshots', 'spielsnapshots'].includes(args.target)) f.snapshotWrites++;
        }
        return tauri.invoke(command, args);
    };
    const win = { location: { href: 'http://localhost/index.html' }, localStorage: local, sessionStorage: session,
        ...(tauri ? { __TAURI__: { core: { invoke } } } : {}) };
    const options = { window: win, localStorage: local, indexedDB, invoke, installLifecycleHooks: false };
    const areas = createPersistenceAreas(options), real = areas.makeAdapter('echt');
    await real.open(); await real.saveBatch({ upserts: Object.entries(records), deletes: [] }); real.close?.();
    const realBytes = () => JSON.stringify({
        local: [...local.records].filter(([key]) => key !== AREA_CONTROL_KEY && !key.startsWith(PLAY_STORAGE_PREFIX)),
        session: [...session.records].filter(([key]) => !key.startsWith(PLAY_STORAGE_PREFIX)),
        backend: tauri ? [tauri.files.get('live'), tauri.files.get('snapshots')]
            : indexedDB ? [indexedDB.bytes('ruhestand-suite'), indexedDB.bytes('snapshotDB')] : null
    });
    const boot = async (controllerOptions = {}) => {
        P.resetPersistenceRuntimeForTests(); await P.init(options);
        const c = createProbelaufController({ win, reload() {}, restoreReload() {}, ...controllerOptions });
        await c.initialize(); return c;
    };
    // Workflowmessungen lesen die aktuellen Dateien, nicht den Facade-Cache.
    Object.defineProperties(f, {
        values: { get() { const play = P.getPersistenceStatus().reloadRequired
            ? (tauri?.files.get('control') && JSON.parse(tauri.files.get('control')).activeArea === 'spiel')
            : P.getPersistenceStatus().activeArea === 'spiel';
            const target = play ? 'spiel' : 'live';
            const read = () => JSON.parse(tauri?.files.get(target) || '{"records":{}}');
            return new Proxy({}, {
                get: (_, key) => read().records[key],
                set: (_, key, value) => { const data = read(); data.records[key] = value; tauri.files.set(target, JSON.stringify(data)); return true; },
                deleteProperty: (_, key) => { const data = read(); delete data.records[key]; tauri.files.set(target, JSON.stringify(data)); return true; },
                ownKeys: () => Reflect.ownKeys(read().records),
                getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true })
            }); } },
        points: { get() { const play = tauri?.files.get('control') && JSON.parse(tauri.files.get('control')).activeArea === 'spiel';
            return new Map((JSON.parse(tauri?.files.get(play ? 'spielsnapshots' : 'snapshots') || '{"snapshots":[]}').snapshots || []).map(p => [p.id, p])); } }
    });
    return Object.assign(f, { kind, win, options, areas, boot, realBytes });
}
