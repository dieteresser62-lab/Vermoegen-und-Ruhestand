/** Fachliches Jetzt; technische Fristen benutzen weiterhin System-/monotone Zeit. */
let testDate = null;

export function parseCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Bitte ein gültiges Datum (JJJJ-MM-TT) wählen.');
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(12, 0, 0, 0);
    if (year < 1 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('Ungültiges Kalenderdatum.');
    return date;
}
export function localCalendarDate(date = appNow()) {
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function appNow() { return testDate === null ? new Date() : parseCalendarDate(testDate); }
export function appNowMs() { return appNow().getTime(); }
export function setAppTestDate(value) { if (value !== null) parseCalendarDate(value); testDate = value; }
export function getAppTestDate() { return testDate; }
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
