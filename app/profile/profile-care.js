import { readProfileCareSettings } from '../shared/care-profile-settings.js';
import { CARE_FORMS, normalizeCareForm, careSettingsFromRecord } from '../shared/care-benefits.js';
import { localCalendarDate } from '../shared/app-clock.js';
import { initialResidentialYear } from '../shared/care-needs.js';
/** FR-45/47: heutiger Pflegezustand einer Person, getrennt von der Rücklage. FR-73 Punkt 13: eigener Wert für Pflege
 * zu Hause heute (€/Monat); Gutachten PFA-2, Befund 1: der Jahresabschluss verankert ohne „seit“ das Planjahr, in dem
 * Heimjahr 1 angesetzt wurde (`residentialFirstYear`, JJJJ). */
export const CARE_VALUE_KEYS = Object.freeze({
    grade: 'profile_care_grade_today',
    form: 'profile_care_form_today',
    residentialSince: 'profile_care_residential_since',
    residentialFirstYear: 'profile_care_residential_first_year',
    homeCostsMonthly: 'profile_care_home_costs_monthly',
    additionalMonthly: 'profile_care_additional_monthly',
    progression: 'profile_care_progression',
    allowanceAsIncome: 'profile_care_allowance_as_income'
});
export const CARE_FORM_IDS = Object.freeze({ grade: 'profileCareGradeToday', form: 'profileCareFormToday',
    residentialSince: 'profileCareResidentialSince', homeCostsMonthly: 'profileCareHomeCostsMonthly', progression: 'profileCareProgression' });
export const CARE_PROGRESSION_FACTORS = Object.freeze({ usual: 1, slower: .5, much_slower: .25 });
const filled = value => value != null && String(value).trim() !== '';
/** Leer bleibt leer (Staffel); ein lesbarer Betrag wird zur Zahl, Unlesbares bleibt zur Prüfung als Text stehen. */
const monthlyAmount = value => { const amount = Number(String(value).trim().replace(',', '.')); return Number.isFinite(amount) ? amount : String(value); };

/**
 * @param value Zu prüfender oder darzustellender Wert.
 * @returns Heutiger Pflegegrad, Pflegeform, Heimdauer, eigener Wert und Verlauf.
 */
export function normalizeCareToday(value = {}) {
    return { grade: Number(value.grade ?? 0), ...(Number(value.grade) > 0 && value.form ? { form: value.form } : {}),
        ...(filled(value.residentialSince) ? { residentialSince: value.residentialSince } : {}),
        ...(filled(value.residentialFirstYear) ? { residentialFirstYear: String(value.residentialFirstYear).trim() } : {}),
        ...(filled(value.homeCostsMonthly) ? { homeCostsMonthly: monthlyAmount(value.homeCostsMonthly) } : {}),
        progression: value.progression || 'usual' };
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
    if ('homeCostsMonthly' in care && (typeof care.homeCostsMonthly !== 'number' || care.homeCostsMonthly < 0)) {
        fail('homeCostsMonthly', 'Pflegekosten heute: Betrag ab 0 €/Monat eingeben oder leer lassen.');
    }
    try { initialResidentialYear(care.residentialSince, localCalendarDate(), care.residentialFirstYear); }
    catch (error) { fail(error.message.startsWith('Heimjahr-Anker') ? 'residentialFirstYear' : 'residentialSince', error.message); }
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
