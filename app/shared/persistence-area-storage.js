// Steuerung und Spielschlüssel liegen außerhalb des echten Schlüsselraums.
export const AREA_CONTROL_KEY = 'rs_storage_area_control_v1';
export const PLAY_STORAGE_PREFIX = 'rs_spiel_v1:';
export const PLAY_DB_NAME = 'ruhestand-suite-spiel';

let activeArea = null;
export function setStorageArea(area) { activeArea = area; }
export function getStorageArea() { return activeArea; }
export function isAreaStorageKey(key) {
    return key === AREA_CONTROL_KEY || String(key).startsWith(PLAY_STORAGE_PREFIX);
}

export function validateAreaControl(raw) {
    if (raw === null || raw === '') return { version: 1, activeArea: 'echt', source: null, startedAt: null };
    const control = JSON.parse(raw);
    if (control?.version !== 1 || !['echt', 'spiel'].includes(control.activeArea)
        || (control.activeArea === 'spiel' && (!['copy', 'demo'].includes(control.source)
            || typeof control.id !== 'string' || !control.id || control.phase !== 'active'
            || typeof control.startedAt !== 'string' || !Number.isFinite(Date.parse(control.startedAt))))) {
        throw new Error('Ungültiger Speicherbereichs-Steuerdatensatz.');
    }
    return control;
}

/** Der synchrone Fallback löst denselben Vertrag vor seinem ersten Zugriff auf. */
export function resolveLocalArea(storage) {
    let control, warning = null;
    try {
        control = validateAreaControl(storage?.getItem(AREA_CONTROL_KEY) ?? null);
        if (control.activeArea === 'spiel') {
            const ready = JSON.parse(storage?.getItem(`${PLAY_STORAGE_PREFIX}metadata.playAreaReady`) || 'null');
            if (ready?.id !== control.id) throw new Error('Spielbereich unvollständig.');
        }
    } catch {
        control = validateAreaControl(null);
        warning = { code: 'storage-area-control-invalid', message: 'Der Spielbereich konnte nicht gelesen werden und wurde verworfen. Deine echten Daten bleiben erhalten.' };
        storage?.setItem(AREA_CONTROL_KEY, JSON.stringify(control));
    }
    if (control.activeArea === 'echt') scopeWebStorage(storage, 'spiel')?.clear();
    return { control, warning };
}

/** Storage-Vertrag mit logischen Schlüsseln; echt behält seine bisherigen Bytes. */
export function scopeWebStorage(storage, area = 'echt') {
    if (!storage) return null;
    const prefix = area === 'spiel' ? PLAY_STORAGE_PREFIX : '';
    const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i))
        .filter(key => key && (prefix ? key.startsWith(prefix) : !isAreaStorageKey(key)))
        .map(key => key.slice(prefix.length));
    const physical = key => {
        if (isAreaStorageKey(String(key))) throw new Error('Reservierter Speicherbereichsschlüssel.');
        return prefix + String(key);
    };
    return {
        getItem: key => storage.getItem(physical(key)),
        setItem: (key, value) => storage.setItem(physical(key), String(value)),
        removeItem: key => storage.removeItem(physical(key)),
        key: index => keys()[index] ?? null,
        get length() { return keys().length; },
        clear() { keys().forEach(key => storage.removeItem(prefix + key)); }
    };
}

const sessions = new WeakMap();
/** Fachliche Sitzungsmerker bleiben ebenfalls im aktiven Bereich. */
export function areaSessionStorage(storage = globalThis.window?.sessionStorage || globalThis.sessionStorage) {
    if (!storage) return storage;
    if (activeArea === null) {
        const win = globalThis.window;
        if (win?.__TAURI__ || win?.__TAURI_INTERNALS__ || globalThis.indexedDB?.open) throw new Error('Speicherbereich ist noch nicht aufgelöst.');
        activeArea = resolveLocalArea(win?.localStorage || globalThis.localStorage).control.activeArea;
    }
    if (activeArea === 'echt') return storage;
    if (!sessions.has(storage)) sessions.set(storage, scopeWebStorage(storage, 'spiel'));
    return sessions.get(storage);
}
