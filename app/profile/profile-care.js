import { readProfileCareSettings } from '../shared/care-profile-settings.js';
import { CARE_FORMS, normalizeCareForm, careSettingsFromRecord } from '../shared/care-benefits.js';
/** FR-45/47: heutiger Pflegezustand einer Person, getrennt von der Rücklage. */
export const CARE_VALUE_KEYS = Object.freeze({
    grade: 'profile_care_grade_today',
    form: 'profile_care_form_today',
    additionalMonthly: 'profile_care_additional_monthly',
    progression: 'profile_care_progression',
    allowanceAsIncome: 'profile_care_allowance_as_income'
});
export const CARE_FORM_IDS = Object.freeze({ grade: 'profileCareGradeToday', form: 'profileCareFormToday',
    progression: 'profileCareProgression' });
export const CARE_PROGRESSION_FACTORS = Object.freeze({ usual: 1, slower: .5, much_slower: .25 });

/**
 * @param value Zu prüfender oder darzustellender Wert.
 * @returns Heutiger Pflegegrad, Pflegeform und Verlauf.
 */
export function normalizeCareToday(value = {}) {
    return { grade: Number(value.grade ?? 0), ...(Number(value.grade) > 0 && value.form ? { form: value.form } : {}), progression: value.progression || 'usual' };
}

/**
 * @param value Zu prüfender oder darzustellender Wert.
 * @returns Feldbezogene Validierungsfehler.
 */
export function careTodayErrors(value = {}) {
    const care = normalizeCareToday(value), errors = [];
    const fail = (field, message) => errors.push({ field: `careToday.${field}`, message });
    if (!Number.isInteger(care.grade) || care.grade < 0 || care.grade > 5) fail('grade', 'Pflegegrad heute: keiner oder Grad 1–5 wählen.');
    if (care.form && !Object.hasOwn(CARE_FORMS, care.form)) fail('form', 'Pflegeform heute: eine der drei Formen wählen.');
    if (!Object.hasOwn(CARE_PROGRESSION_FACTORS, care.progression)) fail('progression', 'Angenommener Verlauf der Pflege: eine der drei Vorgaben wählen.');
    return errors;
}

/**
 * @param data Personenrecords der gelesenen Quelle.
 * @param settings Gemeinsam gelesene Pflegeeinstellungen.
 * @returns Heutiger Pflegezustand aus den Personenrecords.
 */
export function careTodayFromRecord(data = {}, settings = careSettingsFromRecord(data)) {
    settings ||= careSettingsFromRecord(data);
    const care = normalizeCareToday(Object.fromEntries(Object.entries(CARE_VALUE_KEYS).map(([field, key]) => [field, data[key]])));
    if (care.grade) care.form = normalizeCareForm(care.form || settings.forms[care.grade], care.grade);
    return care;
}

/**
 * @param storage Speicherzugang des vorhandenen Besitzers.
 * @returns Heutiger Pflegezustand aus dem Speicher.
 */
export function careTodayFromStorage(storage) {
    return careTodayFromRecord(Object.fromEntries(Object.values(CARE_VALUE_KEYS).map(key => [key, storage.getItem(key)])), readProfileCareSettings(storage));
}
