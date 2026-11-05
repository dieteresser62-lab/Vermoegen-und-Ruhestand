// Verzeichnis der Haushalte (HV-1). Es liegt außerhalb aller Haushaltsbereiche
// und enthält keine Finanzdaten: nur Kennung, Name, Anlagezeit und den aktiven Haushalt.
export const HOUSEHOLD_REGISTRY_KEY = 'rs_households_v1';
export const HOUSEHOLD_STORAGE_PREFIX = 'rs_hh_v1:';
// HV-2: Spielbereich eines weiteren Haushalts.
export const HOUSEHOLD_PLAY_PREFIX = 'rs_hhspiel_v1:';
export const FIRST_HOUSEHOLD = 'h1';
export const HOUSEHOLD_NAME_MAX = 40;
const HOUSEHOLD_ID = /^[a-z0-9]{12}$/;
const AREA_PREFIX = 'hh:';
const PLAY_AREA_PREFIX = 'hhspiel:';

/** @returns {{version: 1, active: string, generation: number, households: {id: string, name: string, createdAt: string|null, missing?: boolean}[]}} */
export function defaultHouseholdRegistry() {
    return { version: 1, active: FIRST_HOUSEHOLD, generation: 0, households: [{ id: FIRST_HOUSEHOLD, name: '', createdAt: null }] };
}

/** @param {unknown} id @returns {boolean} */
export function isHouseholdId(id) {
    return typeof id === 'string' && HOUSEHOLD_ID.test(id);
}

/** @param {unknown} name @returns {string} */
export function normalizeHouseholdName(name) {
    const text = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Bitte einen Namen für den Haushalt eingeben.');
    if (text.length > HOUSEHOLD_NAME_MAX) throw new Error(`Der Name darf höchstens ${HOUSEHOLD_NAME_MAX} Zeichen haben.`);
    return text;
}

const invalid = () => Object.assign(new Error('Das Haushaltsverzeichnis ist beschädigt. Die App speichert nichts, bis es repariert ist.'), { code: 'household-registry-invalid' });

/** Fehlt das Verzeichnis, gibt es nur Haushalt 1; ein beschädigtes Verzeichnis fällt nie still auf Haushalt 1 zurück.
 * @param {string|null|undefined} raw
 * @returns {ReturnType<typeof defaultHouseholdRegistry>} */
export function validateHouseholdRegistry(raw) {
    // Nur ein fehlendes Verzeichnis bedeutet Haushalt 1; ein vorhandenes leeres ist beschädigt.
    if (raw === null || raw === undefined) return defaultHouseholdRegistry();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw invalid(); }
    const list = parsed?.households;
    if (parsed?.version !== 1 || !Number.isSafeInteger(parsed.generation) || parsed.generation < 0
        || !Array.isArray(list) || !list.length || list[0]?.id !== FIRST_HOUSEHOLD) throw invalid();
    const ids = new Set();
    const households = list.map((entry, index) => {
        const id = entry?.id;
        if ((index === 0 ? id !== FIRST_HOUSEHOLD : !isHouseholdId(id)) || ids.has(id)) throw invalid();
        ids.add(id);
        if (typeof entry.name !== 'string' || entry.name.length > HOUSEHOLD_NAME_MAX || (index > 0 && !entry.name.trim())) throw invalid();
        if (entry.createdAt !== null && (typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt)))) throw invalid();
        // HV-2: `missing` merkt einen Haushalt, dessen Bereich beim Öffnen fehlte (Rückweg in der Verwaltung).
        if (entry.missing !== undefined && (index === 0 || entry.missing !== true)) throw invalid();
        return { id, name: entry.name, createdAt: entry.createdAt, ...(entry.missing ? { missing: true } : {}) };
    });
    if (!ids.has(parsed.active)) throw invalid();
    return { version: 1, active: parsed.active, generation: parsed.generation, households };
}

/** Speicherbereich des aktiven Haushalts; Haushalt 1 nutzt weiter echt/spiel.
 * @param {{active: string}} registry @param {string} mode @returns {string} */
export function householdStorageArea(registry, mode) {
    if (registry.active === FIRST_HOUSEHOLD) return mode;
    return `${mode === 'spiel' ? PLAY_AREA_PREFIX : AREA_PREFIX}${registry.active}`;
}

/** @param {unknown} area @returns {string|null} Kennung eines weiteren Haushalts (echt oder Spiel), sonst null. */
export function areaHousehold(area) {
    if (typeof area !== 'string') return null;
    const prefix = area.startsWith(PLAY_AREA_PREFIX) ? PLAY_AREA_PREFIX : area.startsWith(AREA_PREFIX) ? AREA_PREFIX : null;
    if (!prefix) return null;
    const id = area.slice(prefix.length);
    if (!isHouseholdId(id)) throw new Error('Ungültiger Haushaltsbereich.');
    return id;
}

/** Spielbereich von Haushalt 1 oder eines weiteren Haushalts. @param {unknown} area */
export const isPlayArea = area => area === 'spiel' || (typeof area === 'string' && area.startsWith(PLAY_AREA_PREFIX));

/** Generation für ein repariertes Verzeichnis: zufällig, damit kein alter Rohwert wiederkehrt. @returns {number} */
export function repairGeneration() {
    const [high, low] = globalThis.crypto.getRandomValues(new Uint32Array(2));
    return (high % 2 ** 20) * 2 ** 32 + low + 1;
}

/** @returns {string} */
export function newHouseholdId() {
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => 'abcdefghijklmnopqrstuvwxyz0123456789'[byte % 36]).join('');
}
