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

/** Haushaltsmitglieder teilen die Pflegepreise des Records; Außenpersonen behalten ihre eigene Staffel.
 *
 * @param storage Speicherzugriff des Aufrufers.
 * @param profileId Kennung der Person.
 * @returns {boolean} Ergebnis der Prüfung.
 */
export function sharesHouseholdCareValues(storage, profileId = storage.getItem('rs_current_profile') || storage.getItem('rs_active_profile')) {
    let registry;
    try { registry = JSON.parse(storage.getItem('rs_profiles_v1') || 'null'); } catch { return true; }
    return registry?.profiles?.[profileId]?.meta?.belongsToHousehold !== false;
}

/** Person, deren Pflegeeinstellungen ein Jahresabschluss liest und fortschreibt (Argon FR73A B2): die aktive Person, wenn
 * sie zum Haushalt gehört oder es keinen Haushalt gibt (Einzelprofil), sonst das Hauptprofil des Haushalts. Wie der
 * Rechenumfang der Balance; eine zuletzt geöffnete Außenperson bestimmt so nie die Preise des Haushalts.
 *
 * @param storage Speicherzugriff des Aufrufers.
 * @returns {string|null} Kennung der Person für {@link careSettingsStorage} und {@link sharesHouseholdCareValues}.
 */
export function annualCareProfileId(storage) {
    const current = storage.getItem('rs_current_profile') || storage.getItem('rs_active_profile');
    let registry;
    try { registry = JSON.parse(storage.getItem('rs_profiles_v1') || 'null'); } catch { return current; }
    const profiles = registry?.profiles || {};
    const members = Object.keys(profiles).filter(id => profiles[id].meta?.belongsToHousehold !== false);
    return !members.length || members.includes(current) ? current : members[0];
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
    const members = Object.keys(profiles).filter(id => profiles[id].meta?.belongsToHousehold !== false);
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
    const source = careSettingsStorage(storage, profileId);
    const keys = ['sim_pflegeKostenStaffelPreset', ...[1, 2, 3, 4, 5].map(g => `sim_pflegeStufe${g}Form`)];
    return { ...careSettingsFromRecord(Object.fromEntries(keys.map(key => [key, source.getItem(key)]))),
        careValues: readCareValues(storage), partnerCare: partnerCareToday(storage, profileId) };
}
