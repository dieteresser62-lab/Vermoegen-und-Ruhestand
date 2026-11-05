import { HOUSEHOLD_PLAY_PREFIX, HOUSEHOLD_REGISTRY_KEY, HOUSEHOLD_STORAGE_PREFIX, areaHousehold, defaultHouseholdRegistry, householdStorageArea, isHouseholdId, isPlayArea,
    repairGeneration, validateHouseholdRegistry } from './household-registry.js';

// Steuerung, Haushaltsverzeichnis, Spiel- und Haushaltsschlüssel liegen außerhalb des echten Schlüsselraums.
export const AREA_CONTROL_KEY = 'rs_storage_area_control_v1';
export const PLAY_STORAGE_PREFIX = 'rs_spiel_v1:';
export const PLAY_DB_NAME = 'ruhestand-suite-spiel';

let activeArea = null;
let pendingRepairWarning = null;
/**
 * @param area Wert für den bestehenden Aufrufvertrag.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function setStorageArea(area) { activeArea = area; }
/**
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function getStorageArea() { return activeArea; }
/**
 * @param key Schlüssel des Eintrags.
 * @returns {boolean} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function isAreaStorageKey(key) {
    const text = String(key);
    return text === AREA_CONTROL_KEY || text.startsWith(HOUSEHOLD_REGISTRY_KEY)
        || text.startsWith(PLAY_STORAGE_PREFIX) || text.startsWith(HOUSEHOLD_STORAGE_PREFIX) || text.startsWith(HOUSEHOLD_PLAY_PREFIX);
}

/** @param {string} area echt, spiel oder hh:<Kennung> @returns {string} */
export function areaStoragePrefix(area = 'echt') {
    if (area === 'echt') return '';
    if (area === 'spiel') return PLAY_STORAGE_PREFIX;
    const household = areaHousehold(area);
    if (!household) throw new Error('Unbekannter Speicherbereich.');
    return `${isPlayArea(area) ? HOUSEHOLD_PLAY_PREFIX : HOUSEHOLD_STORAGE_PREFIX}${household}:`;
}

/**
 * @param raw Rohwert vor der bestehenden Prüfung.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function validateAreaControl(raw) {
    if (raw === null || raw === '') return { version: 1, activeArea: 'echt', source: null, startedAt: null };
    const control = JSON.parse(raw);
    // HV-2: Ein Spielbereich nennt den Haushalt, dem er gehört; ohne Angabe gehört er Haushalt 1.
    if (control?.household !== undefined && (control.activeArea !== 'spiel' || !isHouseholdId(control.household))) throw new Error('Ungültiger Speicherbereichs-Steuerdatensatz.');
    if (control?.version !== 1 || !['echt', 'spiel'].includes(control.activeArea)
        || (control.activeArea === 'spiel' && (!['copy', 'demo'].includes(control.source)
            || typeof control.id !== 'string' || !control.id || control.phase !== 'active'
            || typeof control.startedAt !== 'string' || !Number.isFinite(Date.parse(control.startedAt))))) {
        throw new Error('Ungültiger Speicherbereichs-Steuerdatensatz.');
    }
    return control;
}

/** Warnung eines frühen Aufrufs ohne Meldeweg; die asynchrone Initialisierung übernimmt sie ebenfalls. */
export function takePendingAreaWarning() { const warning = pendingRepairWarning; pendingRepairWarning = null; return warning; }

/** Der synchrone Fallback löst denselben Vertrag vor seinem ersten Zugriff auf.
 *
 * @param storage Speicherzugriff des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function resolveLocalArea(storage) {
    // Wie im asynchronen Weg: beschädigtes Verzeichnis sichern, Haushalt 1 mit Warnung öffnen.
    let registry, registryWarning = null;
    const rawRegistry = storage?.getItem(HOUSEHOLD_REGISTRY_KEY) ?? null;
    try { registry = validateHouseholdRegistry(rawRegistry); }
    catch {
        storage?.setItem(`${HOUSEHOLD_REGISTRY_KEY}_corrupt`, String(rawRegistry));
        registry = { ...defaultHouseholdRegistry(), generation: repairGeneration() };
        storage?.setItem(HOUSEHOLD_REGISTRY_KEY, JSON.stringify(registry));
        registryWarning = { code: 'household-registry-invalid', message: 'Das Haushaltsverzeichnis war beschädigt und wurde gesichert. Geöffnet ist Haushalt 1; weitere Haushalte sind erst nach einer Reparatur wieder erreichbar.' };
    }
    // Eine Warnung aus einem früheren Aufruf ohne Meldeweg (areaSessionStorage) geht hier weiter.
    let control, warning = registryWarning || pendingRepairWarning;
    pendingRepairWarning = null;
    try {
        control = validateAreaControl(storage?.getItem(AREA_CONTROL_KEY) ?? null);
        if (control.activeArea === 'spiel') {
            // HV-2: Der Spielbereich gehört genau einem Haushalt, und nur dieser darf offen sein.
            if ((control.household || 'h1') !== registry.active) throw new Error('Spielbereich gehört zu einem anderen Haushalt.');
            const ready = JSON.parse(storage?.getItem(`${areaStoragePrefix(householdStorageArea(registry, 'spiel'))}metadata.playAreaReady`) || 'null');
            if (ready?.id !== control.id) throw new Error('Spielbereich unvollständig.');
        }
    } catch {
        control = validateAreaControl(null);
        warning ||= { code: 'storage-area-control-invalid', message: 'Der Spielbereich konnte nicht gelesen werden und wurde verworfen. Deine echten Daten bleiben erhalten.' };
        storage?.setItem(AREA_CONTROL_KEY, JSON.stringify(control));
    }
    if (registry.active !== 'h1') {
        // Wie im asynchronen Weg: ohne Fertigmarker zurück zu Haushalt 1 mit Warnung.
        let ready = null;
        try { ready = JSON.parse(storage?.getItem(`${areaStoragePrefix(householdStorageArea(registry, 'echt'))}metadata.householdReady`) || 'null'); } catch { ready = null; }
        if (ready?.id !== registry.active) {
            const missing = registry.households.find(entry => entry.id === registry.active)?.name || 'Der Haushalt';
            const lost = registry.active;
            // Der Eintrag bleibt und wird für den Rückweg in der Verwaltung markiert.
            registry = { ...registry, active: 'h1', generation: registry.generation + 1,
                households: registry.households.map(entry => entry.id === lost ? { ...entry, missing: true } : entry) };
            storage?.setItem(HOUSEHOLD_REGISTRY_KEY, JSON.stringify(registry));
            if (control.activeArea === 'spiel') { control = validateAreaControl(null); storage?.setItem(AREA_CONTROL_KEY, JSON.stringify(control)); }
            warning = { code: 'household-area-missing', message: `${missing} konnte nicht geöffnet werden. Geöffnet ist Haushalt 1.` };
        }
    }
    // Liegengebliebene Spielrecords gehören dem geöffneten Haushalt und werden nur dort bereinigt.
    if (control.activeArea === 'echt') scopeWebStorage(storage, householdStorageArea(registry, 'spiel'))?.clear();
    return { control, warning, registry, area: householdStorageArea(registry, control.activeArea) };
}

/** Storage-Vertrag mit logischen Schlüsseln; echt behält seine bisherigen Bytes.
 *
 * @param storage Speicherzugriff des Aufrufers.
 * @param {string} area Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function scopeWebStorage(storage, area = 'echt') {
    if (!storage) return null;
    const prefix = areaStoragePrefix(area);
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
/** Fachliche Sitzungsmerker bleiben ebenfalls im aktiven Bereich.
 *
 * @param storage Speicherzugriff des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function areaSessionStorage(storage = globalThis.window?.sessionStorage || globalThis.sessionStorage) {
    if (!storage) return storage;
    if (activeArea === null) {
        const win = globalThis.window;
        if (win?.__TAURI__ || win?.__TAURI_INTERNALS__ || globalThis.indexedDB?.open) throw new Error('Speicherbereich ist noch nicht aufgelöst.');
        const resolved = resolveLocalArea(win?.localStorage || globalThis.localStorage);
        activeArea = resolved.area; pendingRepairWarning = resolved.warning;
    }
    // Auch Haushalt 1 sieht fremde Haushalts- und Spielschlüssel nicht (Aufzählung, Bereinigung).
    let scoped = sessions.get(storage);
    if (!scoped?.has(activeArea)) sessions.set(storage, scoped = new Map([...(scoped || []), [activeArea, scopeWebStorage(storage, activeArea)]]));
    return scoped.get(activeArea);
}
