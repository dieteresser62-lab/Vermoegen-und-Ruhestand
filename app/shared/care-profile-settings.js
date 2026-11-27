/** Gemeinsame Staffel im Haushalt: Die Pflegeeinstellungen liegen beim ersten Profil. */
import { careSettingsFromRecord } from './care-benefits.js';
import { readCareValues } from './household-care-values.js';

/**
 * @param key Schlüssel des Eintrags.
 * @returns {boolean} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export const isCareSettingKey = key => /^sim_pflege/.test(key);

/** Speicher der Pflegeeinstellungen: das erste Profil des Haushalts, für die geöffnete Person der Livebestand.
 *
 * @param storage Speicherzugriff des Aufrufers.
 * @returns Speicheradapter des Preisbesitzers.
 */
export function careSettingsStorage(storage) {
    const raw = storage.getItem('rs_profiles_v1');
    let registry;
    try { registry = raw ? JSON.parse(raw) : null; } catch { return storage; }
    const profiles = registry?.profiles || {};
    const current = storage.getItem('rs_current_profile') || storage.getItem('rs_active_profile');
    const owner = Object.keys(profiles)[0];
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

/** Heutige Pflege der anderen Haushaltsperson (FR-73 P6), nur bei genau zwei Mitgliedern.
 *
 * @param storage Speicherzugriff des Aufrufers.
 * @param profileId Kennung der Person.
 * @returns {{grade: number, form?: string}|null} Pflegezustand der Partnerperson.
 */
export function partnerCareToday(storage, profileId) {
    let registry;
    try { registry = JSON.parse(storage.getItem('rs_profiles_v1') || 'null'); } catch { return null; }
    const profiles = registry?.profiles || {};
    const members = Object.keys(profiles);
    if (members.length !== 2 || !members.includes(profileId)) return null;
    const partner = members.find(id => id !== profileId);
    const data = profiles[partner].data || {};
    const care = { grade: Number(data.profile_care_grade_today ?? 0) || 0, ...(data.profile_care_form_today ? { form: data.profile_care_form_today } : {}) };
    return care.grade ? care : null;
}

/**
 * @param storage Speicherzugriff des Aufrufers.
 * @param profileId Kennung der Person.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function readProfileCareSettings(storage, profileId = storage.getItem('rs_current_profile') || storage.getItem('rs_active_profile')) {
    const source = careSettingsStorage(storage);
    const keys = ['sim_pflegeKostenStaffelPreset', ...[1, 2, 3, 4, 5].map(g => `sim_pflegeStufe${g}Form`)];
    return { ...careSettingsFromRecord(Object.fromEntries(keys.map(key => [key, source.getItem(key)]))),
        careValues: readCareValues(storage), partnerCare: partnerCareToday(storage, profileId) };
}
