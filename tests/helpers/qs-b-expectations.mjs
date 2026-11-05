import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/qs-b-expectation-deltas.json', import.meta.url)));
/** Nur bestätigte QS-B-Folgen; historische Referenzen und volle Ergebnisfelder bleiben erhalten. */
export function readQSBReferences(value) {
    if (typeof value === 'string') return evidence.hashes[value] ?? value;
    if (Array.isArray(value)) return value.map(readQSBReferences);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, readQSBReferences(entry)]));
    return value;
}
