import { appNow } from '../shared/app-clock.js';

export const PLANNED_INFLOWS_KEY = 'profile_planned_inflows_v1';

/**
 * @param raw Gespeicherter Rohwert.
 * @returns Gelesene einmalige Einkünfte.
 */
export function readPlannedInflows(raw) {
    if (raw == null || raw === '') return [];
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries)
        || value.entries.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
        throw new Error('Einmalige Einkünfte: Die gespeicherte Liste ist beschädigt oder hat eine unbekannte Version.');
    }
    return value.entries.map(({ year, amount, label = '' }) => ({ year, amount, label }));
}

/**
 * @param entries Einträge der betroffenen Liste.
 * @returns Serialisierte Liste der einmaligen Einkünfte.
 */
export function writePlannedInflows(entries) {
    return JSON.stringify({ schemaVersion: 1, entries: entries.map(({ year, amount, label = '' }) => ({ year, amount, label })) });
}

/**
 * @param entries Einträge der betroffenen Liste.
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Feldbezogene Fehler unter Berücksichtigung unveränderter Altangaben.
 */
export function personPlannedInflowsErrors(entries, { minYear = appNow().getFullYear(), maxYear = minYear + 60, existingEntries = [] } = {}) {
    const errors = [];
    entries.forEach((entry, index) => {
        const add = (field, message) => errors.push({ field: `plannedInflow-${index}-${field}`,
            message: `Einmalige Einkunft ${index + 1}: ${message}` });
        const retained = existingEntries.some(saved => saved.year === entry.year && saved.amount === entry.amount && saved.label === entry.label);
        const lower = retained ? 1 : minYear, upper = retained ? 9999 : maxYear;
        if (!Number.isInteger(entry.year) || entry.year < lower || entry.year > upper) {
            add('year', `Jahr muss eine ganze Zahl zwischen ${minYear} und ${maxYear} sein.`);
        }
        if (typeof entry.amount !== 'number' || !Number.isFinite(entry.amount) || entry.amount <= 0) {
            add('amount', 'Betrag (netto) muss größer als 0 Euro sein.');
        }
        if (typeof entry.label !== 'string' || entry.label.length > 60) add('label', 'Bezeichnung darf höchstens 60 Zeichen haben.');
    });
    return errors;
}

/**
 * @param entries Einträge der betroffenen Liste.
 * @returns Anzahl, Summe und Zeitraum oder null bei leerer Liste.
 */
export function plannedInflowsSummary(entries = []) {
    if (!entries.length) return null;
    return { count: entries.length, amount: entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
        from: Math.min(...entries.map(entry => entry.year)), to: Math.max(...entries.map(entry => entry.year)) };
}
