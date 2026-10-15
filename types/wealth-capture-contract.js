import { assertWealthHistoryEntry } from './wealth-history-contract.js';

export const WEALTH_CAPTURES_KEY = 'rs_household_wealth_captures_v1';
export const CAPTURE_AMOUNT_FIELDS = Object.freeze([
    'tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'depotwertNeu', 'aktienEtf', 'goldWert', 'anleihen', 'total'
]);

/** Ein gemeinsamer Record hält Haushalt und Personen auch beim Restore zusammen. */
export function assertWealthCaptures(record) {
    if (!record || record.schemaVersion !== 1 || !Array.isArray(record.captures)) throw new Error('Ungültige gemeinsame Vermögensstände.');
    const ids = new Set();
    for (const capture of record.captures) {
        const household = assertWealthHistoryEntry(capture.household);
        if (ids.has(household.id) || !Number.isFinite(Date.parse(capture.capturedAt))
            || !capture.people || Array.isArray(capture.people) || typeof capture.people !== 'object'
            || !Object.keys(capture.people).length) throw new Error('Ungültige Erfassung oder Personenaufteilung.');
        ids.add(household.id);
        for (const person of Object.values(capture.people)) {
            assertWealthHistoryEntry(person);
            if (person.id !== household.id || person.asOf !== household.asOf) throw new Error('Person und Haushalt haben verschiedene Stichtage.');
        }
        for (const field of CAPTURE_AMOUNT_FIELDS) {
            const total = Object.values(capture.people).reduce((sum, person) => sum + person[field], 0);
            if (!Number.isFinite(household[field]) || !Number.isFinite(total)
                || Math.abs(total - household[field]) > 16 * Number.EPSILON * Math.max(1, total)) {
                throw new Error(`Personenstände ergeben nicht den Haushaltsstand: ${field}.`);
            }
        }
    }
    return record;
}

export function readWealthCaptures(raw) {
    return raw == null ? { schemaVersion: 1, captures: [] } : assertWealthCaptures(JSON.parse(raw));
}
