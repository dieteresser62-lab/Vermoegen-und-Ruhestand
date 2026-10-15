export class MemoryWebStorage {
    records = new Map();
    get length() { return this.records.size; }
    key(index) { return [...this.records.keys()][index] ?? null; }
    getItem(key) { return this.records.get(String(key)) ?? null; }
    setItem(key, value) { this.records.set(String(key), String(value)); }
    removeItem(key) { this.records.delete(String(key)); }
}

/** Named databases, independent connections and transaction completion after requests. */
export function fakeAreaIndexedDB() {
    const databases = new Map(), mutations = [], faults = { afterWrite: null, afterDelete: null };
    function connection(data, name) {
        let closed = false;
        const db = {
            objectStoreNames: { contains: key => data.stores.has(key) },
            createObjectStore(key) { data.stores.set(key, new Map()); mutations.push([name, 'schema', key]); },
            close() { closed = true; data.connections.delete(db); },
            transaction(names, mode = 'readonly') {
                if (closed) throw new Error('closed connection');
                let pending = 0, completed = false;
                const tx = { error: null, abort() { tx.error = new Error('aborted'); tx.onabort?.(); } };
                const done = () => setTimeout(() => {
                    if (!pending && !completed) { completed = true; tx.oncomplete?.(); }
                }, 0);
                tx.objectStore = storeName => {
                    if (!(Array.isArray(names) ? names : [names]).includes(storeName)) throw new Error('store outside transaction');
                    const store = data.stores.get(storeName);
                    if (!store) throw new Error('missing store');
                    const write = (action, key) => {
                        if (mode !== 'readwrite') throw new Error('read-only transaction');
                        mutations.push([name, storeName, action, key]);
                    };
                    return {
                        put(row) { write('put', row.key); store.set(String(row.key), structuredClone(row)); faults.afterWrite?.({ name, storeName, key: row.key }); },
                        delete(key) { write('delete', key); store.delete(String(key)); faults.afterWrite?.({ name, storeName, key }); },
                        get(key) {
                            const request = {}; pending++;
                            setTimeout(() => { request.result = structuredClone(store.get(String(key))); request.onsuccess?.(); pending--; done(); }, 0);
                            return request;
                        },
                        openCursor() {
                            const request = {}, rows = [...store.values()].map(row => structuredClone(row));
                            let index = 0; pending++;
                            const next = () => setTimeout(() => {
                                request.result = index < rows.length ? { value: rows[index++], continue: next } : null;
                                request.onsuccess?.();
                                if (!request.result) { pending--; done(); }
                            }, 0);
                            next(); return request;
                        }
                    };
                };
                done(); return tx;
            }
        };
        data.connections.add(db);
        return db;
    }
    return {
        databases, mutations, faults,
        open(name, version) {
            const request = {};
            setTimeout(() => {
                let data = databases.get(name);
                const upgrading = !data || version > data.version;
                if (!data) { data = { version: version || 1, stores: new Map(), connections: new Set() }; databases.set(name, data); }
                let aborted = false;
                request.transaction = { abort() { aborted = true; databases.delete(name); } };
                request.result = connection(data, name);
                if (upgrading) { data.version = version || 1; request.onupgradeneeded?.(); }
                if (aborted) { request.result.close(); request.onerror?.(); } else request.onsuccess?.();
            }, 0);
            return request;
        },
        deleteDatabase(name) {
            const request = {};
            setTimeout(() => {
                const data = databases.get(name);
                for (const db of [...data?.connections || []]) db.onversionchange?.();
                if (data?.connections.size) { request.onblocked?.(); return; }
                if (data) { databases.delete(name); mutations.push([name, 'deleteDatabase']); }
                if (faults.afterDelete?.(name)) { request.error = new Error('simulierter Löschfehler'); request.onerror?.(); return; }
                request.onsuccess?.();
            }, 0);
            return request;
        },
        bytes(name) {
            const data = databases.get(name);
            return JSON.stringify(data && { version: data.version, stores: [...data.stores].map(([key, rows]) => [key, [...rows]]) });
        }
    };
}

export function fakeAreaTauri() {
    const files = new Map(), calls = [];
    return { files, calls, async invoke(command, args = {}) {
        const target = args.target || 'live';
        calls.push({ command, target });
        if (command === 'load_app_state') return files.get(target) || '';
        if (command === 'save_app_state') { files.set(target, args.content); return; }
        if (command === 'quarantine_app_state') {
            if (!files.has(target)) return '';
            const path = `${target}.corrupt.json`;
            files.set(path, files.get(target)); files.delete(target); return path;
        }
        if (command === 'delete_play_state') { files.delete('spiel'); files.delete('spielsnapshots'); return; }
        throw new Error(`Unexpected invoke ${command}`);
    } };
}
