/** @import {RecordReader, RecordStorage} from '../../typcheck/datenvertraege.js' */

export const HOUSEHOLD_PURCHASES_KEY = 'household_simulator_equity_purchases_v1';

/** @param {string|null} raw @returns {'same'|'separate'} */
export function parseHouseholdEquityPurchases(raw) {
    // FZ-1c: Ein leerer Wert gilt wie ein fehlender Schlüssel als Vorgabe.
    if (raw == null || raw === '') return 'same';
    if (raw === 'same' || raw === 'separate') return raw;
    throw new Error('Die gespeicherte Auswahl für simulierte Zukäufe ist ungültig.');
}

/** @param {RecordReader} storage */
export function readHouseholdEquityPurchases(storage) {
    return parseHouseholdEquityPurchases(storage.getItem(HOUSEHOLD_PURCHASES_KEY));
}

/** @param {RecordStorage} storage @param {string} value */
export function writeHouseholdEquityPurchases(storage, value) {
    storage.setItem(HOUSEHOLD_PURCHASES_KEY, parseHouseholdEquityPurchases(value));
}
