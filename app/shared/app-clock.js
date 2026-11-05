/** Fachliches Jetzt; technische Fristen benutzen weiterhin System-/monotone Zeit. */
let testDate = null;

/**
 * @param value Zu verarbeitender Wert.
 * @returns {Date} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function parseCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Bitte ein gültiges Datum (JJJJ-MM-TT) wählen.');
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(12, 0, 0, 0);
    if (year < 1 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('Ungültiges Kalenderdatum.');
    return date;
}
/**
 * @param {Date} date Wert für den bestehenden Aufrufvertrag.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function localCalendarDate(date = appNow()) {
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/**
 * @returns {Date} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function appNow() { return testDate === null ? new Date() : parseCalendarDate(testDate); }
/**
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function appNowMs() { return appNow().getTime(); }
/**
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function appTestDateBounds() {
    const today = new Date();
    const nextYear = new Date(today);
    nextYear.setFullYear(today.getFullYear() + 1);
    if (nextYear.getMonth() !== today.getMonth()) nextYear.setDate(0);
    return { min: '0001-01-01', max: localCalendarDate(nextYear) };
}
/** Eine Prüfung für Dialoge, Datumssprünge und die gespeicherte Fachuhr.
 *
 * @param value Zu verarbeitender Wert.
 * @returns {Date} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function validateAppTestDate(value) {
    const date = parseCalendarDate(value);
    const { min, max } = appTestDateBounds();
    if (value < min || value > max) throw new Error(`Bitte ein Datum bis spätestens ${max.split('-').reverse().join('.')} wählen.`);
    return date;
}
/**
 * @param value Zu verarbeitender Wert.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function setAppTestDate(value) { if (value !== null) validateAppTestDate(value); testDate = value; }
/**
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function getAppTestDate() { return testDate; }
/**
 * @param value Zu verarbeitender Wert.
 * @param unit Wert für den bestehenden Aufrufvertrag.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function advanceCalendarDate(value, unit) {
    const date = parseCalendarDate(value);
    if (unit === 'day') date.setDate(date.getDate() + 1);
    else if (unit === 'month') {
        const day = date.getDate();
        date.setDate(1);
        date.setMonth(date.getMonth() + 1);
        const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        date.setDate(Math.min(day, last));
    } else throw new Error('Unbekannter Datumsschritt.');
    return localCalendarDate(date);
}
