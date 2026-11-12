/** FR-73 Punkt 10: Haushaltsrecord „Pflegehinweis erledigt“ mit Regelversion. Lesen schreibt nie; ein unlesbarer
 * oder fremder Altbestand gilt als nicht erledigt und bleibt unverändert stehen. */
import { appNow, localCalendarDate } from './app-clock.js';

export const CARE_HINT_KEY = 'household_care_hint_v1';
/** Regelversion des Hinweises: eine neue Pflegeregel zeigt ihn erneut. */
export const CARE_HINT_RULE = 'FR-73';

/**
 * @param {unknown} raw Gespeicherter Record als String oder Objekt.
 * @returns {import("../../typcheck/datenvertraege.js").HouseholdCareHint|null} Record oder null ohne Eintrag.
 */
export function parseCareHint(raw) {
    if (raw == null) return null;
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (value?.version !== 1 || typeof value.rule !== 'string' || !value.rule.trim()
        || typeof value.doneAt !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value.doneAt)) {
        throw new Error('Der gespeicherte Pflegehinweis ist ungültig.');
    }
    return { version: 1, rule: value.rule, doneAt: value.doneAt };
}

/** @param {import("../../typcheck/datenvertraege.js").RecordReader} storage @returns {boolean} */
export function careHintDone(storage) {
    try { return parseCareHint(storage.getItem(CARE_HINT_KEY))?.rule === CARE_HINT_RULE; }
    catch { return false; }
}

/** @param {import("../../typcheck/datenvertraege.js").RecordWriter} storage @param {Date} [now] @returns {void} */
export function markCareHintDone(storage, now = appNow()) {
    storage.setItem(CARE_HINT_KEY, JSON.stringify({ version: 1, rule: CARE_HINT_RULE, doneAt: localCalendarDate(now) }));
}
