/** Gemeinsame Staffel im Haushalt, eigene Staffel für Außenpersonen. */
import { careSettingsFromRecord } from './care-benefits.js';
import { readCareValues } from './household-care-values.js';

/**
 * @param key Schlüssel des Eintrags.
 * @returns {boolean} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export const isCareSettingKey = key => /^sim_pflege/.test(key);

/**
 * @param storage Speicherzugriff des Aufrufers.
 * @param profileId Kennung der Person.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function careSettingsStorage(storage, profileId = storage.getItem('rs_current_profile') || storage.getItem('rs_active_profile')) {
    const raw = storage.getItem('rs_profiles_v1');
    let registry;
    try { registry = raw ? JSON.parse(raw) : null; } catch { return storage; }
    const profiles = registry?.profiles || {};
    const current = storage.getItem('rs_current_profile') || storage.getItem('rs_active_profile');
    const member = profiles[profileId]?.meta?.belongsToHousehold !== false;
    const owner = member ? Object.keys(profiles).find(id => profiles[id].meta?.belongsToHousehold !== false) : profileId;
    if (!owner || owner === current) return storage;
    return {
        getItem(key) { return profiles[owner].data?.[key] ?? null; },
        setItem(key, value) {
            // Registry vor jedem Schreiben neu lesen, damit parallele Autosaves erhalten bleiben.
            const latest = JSON.parse(storage.getItem('rs_profiles_v1'));
            latest.profiles[owner].data[key] = String(value);
            storage.setItem('rs_profiles_v1', JSON.stringify(latest));
            profiles[owner].data[key] = String(value);
        }
    };
}

/**
 * @param storage Speicherzugriff des Aufrufers.
 * @param profileId Kennung der Person.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function readProfileCareSettings(storage, profileId) {
    const source = careSettingsStorage(storage, profileId);
    const keys = ['sim_pflegeKostenStaffelPreset', ...[1, 2, 3, 4, 5].map(g => `sim_pflegeStufe${g}Form`)];
    return { ...careSettingsFromRecord(Object.fromEntries(keys.map(key => [key, source.getItem(key)]))),
        careValues: readCareValues(storage) };
}
