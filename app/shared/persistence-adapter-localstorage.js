// @ts-check

import { scopeWebStorage } from './persistence-area-storage.js';

function resolveStorage(storageProvider) {
    try {
        return typeof storageProvider === 'function' ? storageProvider() : storageProvider;
    } catch {
        return null;
    }
}

export function createLocalStorageAdapter(storageProvider = () => globalThis.localStorage, options = {}) {
    const getStorage = () => scopeWebStorage(resolveStorage(storageProvider), options.area);
    const isPrivateMetadata = key => options.area === 'spiel' && key === 'metadata.playAreaReady';

    return {
        name: 'localStorage',

        async open() {
            return true;
        },

        loadAllSync() {
            const storage = getStorage();
            const records = Object.create(null);
            if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
                return records;
            }
            for (let i = 0; i < storage.length; i += 1) {
                const key = storage.key(i);
                if (!key || isPrivateMetadata(key)) continue;
                const value = storage.getItem(key);
                if (value !== null && value !== undefined) records[key] = String(value);
            }
            return records;
        },

        async loadAll() {
            return this.loadAllSync();
        },

        getItemSync(key) {
            const storage = getStorage();
            return storage?.getItem(String(key)) ?? null;
        },

        setItemSync(key, value) {
            const storage = getStorage();
            storage?.setItem(String(key), String(value));
        },

        removeItemSync(key) {
            const storage = getStorage();
            storage?.removeItem(String(key));
        },

        keysSync() {
            return Object.keys(this.loadAllSync());
        },

        async saveBatch({ upserts = [], deletes = [] } = {}) {
            const storage = getStorage();
            if (!storage) return;
            if ([...deletes, ...upserts.map(([key]) => key)].some(isPrivateMetadata)) throw new Error('Spielbereich-Fertigmarker ist geschützt.');
            deletes.forEach(key => storage.removeItem(String(key)));
            upserts.forEach(([key, value]) => storage.setItem(String(key), String(value)));
        },

        async readMetadata(key) {
            return getStorage()?.getItem(`metadata.${key}`) ?? null;
        },

        async writeMetadata(key, value) {
            getStorage()?.setItem(`metadata.${key}`, JSON.stringify(value));
        }
    };
}

export default createLocalStorageAdapter;
