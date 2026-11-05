/** BMG: Leistungsansprüche 2026, Übersicht vom 11.12.2025. Beträge in Euro. */
import { CARE_ALLOWANCE_SOURCE, DEFAULT_CARE_VALUES } from './household-care-values.js';
export const CARE_BENEFITS_SOURCE = CARE_ALLOWANCE_SOURCE;
export const CARE_BENEFITS_2026 = Object.freeze({
    1: Object.freeze({ allowance: 0, services: 0, relief: 131, respiteAnnual: 0, residential: 0 /* PG1: nur Entlastungsbetrag, kein Leistungsbetrag nach § 43 SGB XI */ }),
    2: Object.freeze({ allowance: 347, services: 796, relief: 131, respiteAnnual: 3539, residential: 805 }),
    3: Object.freeze({ allowance: 599, services: 1497, relief: 131, respiteAnnual: 3539, residential: 1319 }),
    4: Object.freeze({ allowance: 800, services: 1859, relief: 131, respiteAnnual: 3539, residential: 1855 }),
    5: Object.freeze({ allowance: 990, services: 2299, relief: 131, respiteAnnual: 3539, residential: 2096 })
});

export const CARE_FORMS = Object.freeze({ family: 'zu Hause durch Angehörige',
    'home-support': 'zu Hause mit externer Unterstützung', residential: 'im Heim' });
/** FR-47: vorsichtige Vorgabe; alte „external“-Werte behalten ihre Rechenwirkung.
 *
 * @param grade Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export const defaultCareForm = grade => Number(grade) <= 2 ? 'family' : Number(grade) === 3 ? 'home-support' : 'residential';
/**
 * @param form Wert für den bestehenden Aufrufvertrag.
 * @param grade Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export const normalizeCareForm = (form, grade) => form === 'external'
    ? Number(grade) <= 3 ? 'home-support' : 'residential' : Object.hasOwn(CARE_FORMS, form || '') ? form : defaultCareForm(grade);

/** Die bekannte heutige Form gilt bis zum ersten Gradwechsel, danach die Staffel.
 *
 * @param inputs Eingaben des Aufrufers.
 * @param grade Wert für den bestehenden Aufrufvertrag.
 * @param {number} personIndex Wert für den bestehenden Aufrufvertrag.
 * @param household Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function careFormForPerson(inputs, grade, personIndex = 0, household = null) {
    const today = personIndex === 0 ? inputs.careToday : inputs.partner?.careToday;
    const form = normalizeCareForm(today?.form && today.grade === grade ? today.form
        : inputs.pflegeKostenStaffelPreset === 'amtlich' ? null : inputs.pflegeGradeConfigs?.[grade]?.careForm, grade);
    return form === 'family' && familyCareFallback(inputs, grade, personIndex, household) ? 'home-support' : form;
}

/** Heimpflege beendet ein Wohnrecht unabhängig vom Pflegegrad.
 *
 * @param inputs Eingaben des Aufrufers.
 * @param personIndex Wert für den bestehenden Aufrufvertrag.
 * @param household Wert für den bestehenden Aufrufvertrag.
 * @returns {boolean} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function isInResidentialCare(inputs, personIndex, household) {
    if (personIndex !== 0 && personIndex !== 1) return false;
    const care = household?.care?.[personIndex === 0 ? 'p1' : 'p2'];
    return care?.active === true && careFormForPerson(inputs, care.grade, personIndex, household) === 'residential';
}

/** FR-47: Bei Paaren pflegt der Partner; der Ausfall gilt ab demselben Jahr dauerhaft.
 *
 * @param inputs Eingaben des Aufrufers.
 * @param grade Wert für den bestehenden Aufrufvertrag.
 * @param personIndex Wert für den bestehenden Aufrufvertrag.
 * @param household Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function familyCareFallback(inputs, grade, personIndex, household) {
    if (inputs.pflegeKostenStaffelPreset === 'amtlich' || !inputs.partner?.aktiv || !household || !(grade >= 1 && grade <= 3)) return null;
    const own = household.care?.[personIndex === 0 ? 'p1' : 'p2'];
    if (own?.familyCareFallback) return own.familyCareFallback;
    const partnerAlive = household[personIndex === 0 ? 'p2Alive' : 'p1Alive'];
    const partner = household.care?.[personIndex === 0 ? 'p2' : 'p1'];
    if (partnerAlive === false) return { reason: 'death' };
    return partner?.active && partner.grade >= 3 ? { reason: 'care', grade: partner.grade } : null;
}

/** Nur betroffene Metadaten ergänzen; unveränderte Pfade behalten ihre Ergebnisbytes.
 *
 * @param inputs Eingaben des Aufrufers.
 * @param household Wert für den bestehenden Aufrufvertrag.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function applyPartnerCareFallback(inputs, household) {
    for (const index of [0, 1]) {
        const care = household.care?.[index === 0 ? 'p1' : 'p2'];
        if (!care?.active || careFormForPerson(inputs, care.grade, index) !== 'family') continue;
        const fallback = familyCareFallback(inputs, care.grade, index, household);
        if (fallback) care.familyCareFallback = fallback;
    }
}

/**
 * @param {{grade?: number; preset?: string; careForm?: string}} [options]
 * @returns {string} Grund für fehlendes Pflegegeld.
 */
export function noCareAllowanceReason({ grade, preset, careForm } = {}) {
    if (!grade) return '';
    if (preset === 'amtlich') return 'kein Pflegegeld: im amtlichen Durchschnitt bereits verrechnet';
    const form = normalizeCareForm(careForm, grade);
    if (form === 'home-support') return 'kein Pflegegeld: zu Hause mit externer Unterstützung, die Kasse zahlt an den Dienst';
    if (form === 'residential') return 'kein Pflegegeld: im Heim, die Kasse zahlt an das Heim';
    return Number(grade) === 1 ? 'kein Pflegegeld: Grad 1 hat keinen Pflegegeldanspruch' : '';
}

/** Einzige Betragsableitung für Balance und sämtliche Simulatorpfade.
 *
 * @param {{grade?: number; preset?: string; careForm?: string; inflationFactor?: number; lifeFactor?: number; careValues?: import("../../typcheck/datenvertraege.js").HouseholdCareValues}} [options]
 * @returns {number} Pflegegeld pro Jahr in Euro.
 */
export function careAllowanceAnnual({ grade, preset, careForm = defaultCareForm(grade), inflationFactor = 1, lifeFactor = 1, careValues = DEFAULT_CARE_VALUES } = {}) {
    if (preset === 'amtlich' || normalizeCareForm(careForm, grade) !== 'family') return 0;
    return (careValues.allowance.values[grade] || 0) * 12 * inflationFactor * lifeFactor;
}

/**
 * @param data Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function careSettingsFromRecord(data = {}) {
    return { preset: data.sim_pflegeKostenStaffelPreset,
        forms: Object.fromEntries([1, 2, 3, 4, 5].map(grade => [grade,
            normalizeCareForm(data.sim_pflegeKostenStaffelPreset === 'amtlich' ? null : data[`sim_pflegeStufe${grade}Form`], grade)])) };
}
