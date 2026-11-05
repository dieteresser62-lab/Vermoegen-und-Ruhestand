export class MemoryWebStorage {
    records = new Map();
    get length() { return this.records.size; }
    key(index) { return [...this.records.keys()][index] ?? null; }
    getItem(key) { return this.records.get(String(key)) ?? null; }
    setItem(key, value) { this.records.set(String(key), String(value)); }
    removeItem(key) { this.records.delete(String(key)); }
}

/** Named databases, independent connections and transaction completion after requests. */
export function fakeAreaIndexedDB({ strictTransactions = false } = {}) {
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
                const assertActive = () => {
                    if (strictTransactions && completed) throw new Error('TransactionInactiveError');
                };
                const done = () => setTimeout(() => {
                    if (!pending && !completed) { completed = true; tx.oncomplete?.(); }
                }, 0);
                tx.objectStore = storeName => {
                    if (!(Array.isArray(names) ? names : [names]).includes(storeName)) throw new Error('store outside transaction');
                    const store = data.stores.get(storeName);
                    if (!store) throw new Error('missing store');
                    const write = (action, key) => {
                        assertActive();
                        if (mode !== 'readwrite') throw new Error('read-only transaction');
                        mutations.push([name, storeName, action, key]);
                    };
                    return {
                        put(row) { write('put', row.key); store.set(String(row.key), structuredClone(row)); faults.afterWrite?.({ name, storeName, key: row.key }); },
                        delete(key) { write('delete', key); store.delete(String(key)); faults.afterWrite?.({ name, storeName, key }); },
                        get(key) {
                            assertActive();
                            const request = {}; pending++;
                            setTimeout(() => { request.result = structuredClone(store.get(String(key))); request.onsuccess?.(); pending--; done(); }, 0);
                            return request;
                        },
                        openCursor() {
                            assertActive();
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
        // HV-1: weitere Haushalte liegen unter hh/<Kennung>/, Haushalt 1 behält die bisherigen Schlüssel.
        const target = args.household ? `hh/${args.household}/${args.target || 'live'}` : args.target || 'live';
        calls.push({ command, target });
        if (command === 'load_app_state') return files.get(target) || '';
        // HV-4: wie Rust – verändernde Befehle mit erwarteter Generation nur, wenn das Verzeichnis sie noch trägt.
        if (['save_app_state', 'delete_play_state', 'delete_household_state', 'quarantine_app_state'].includes(command) && args.expectedGeneration !== undefined) {
            const current = files.get('households') ? JSON.parse(files.get('households')).generation : 0;
            if (current !== args.expectedGeneration) throw new Error('HOUSEHOLD_CONTEXT_CHANGED: Der Haushalt wurde inzwischen gewechselt.');
        }
        if (command === 'save_app_state') { files.set(target, args.content); return; }
        if (command === 'read_household_state') return files.get(args.household ? `hh/${args.household}/live` : 'live') || '';
        if (command === 'quarantine_app_state') {
            if (!files.has(target)) return '';
            const path = `${target}.corrupt.json`;
            files.set(path, files.get(target)); files.delete(target); return path;
        }
        if (command === 'delete_play_state' && files.get('control') && JSON.parse(files.get('control')).activeArea === 'spiel') {
            throw new Error('HOUSEHOLD_CONTEXT_CHANGED: Inzwischen läuft ein neuer Spielbereich.');
        }
        if (command === 'delete_play_state') {
            const base = args.household ? `hh/${args.household}/` : '';
            files.delete(`${base}spiel`); files.delete(`${base}spielsnapshots`); return;
        }
        if (command === 'delete_household_state' && files.get('households') && JSON.parse(files.get('households')).households.some(entry => entry.id === args.household)) {
            throw new Error('Dieser Haushalt steht im Verzeichnis und wird nicht gelöscht.');
        }
        if (command === 'delete_household_state') { for (const key of [...files.keys()]) if (key.startsWith(`hh/${args.household}/`)) files.delete(key); return; }
        throw new Error(`Unexpected invoke ${command}`);
    } };
}
