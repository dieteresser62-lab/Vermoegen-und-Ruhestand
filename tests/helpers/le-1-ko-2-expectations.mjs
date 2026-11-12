import { readFileSync } from 'node:fs';
import { readLE1References } from './le-1-expectations.mjs';
import { readKO2References } from './ko-2-expectations.mjs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/le-1-ko-2-expectation-deltas.json', import.meta.url)));
/** Vereinter Stand LE-1 (FR-75, FR-41) und KO-2 (Ergänzung FR-76), 12.11.2026: ein Leser statt zwei gestapelter.
 * Hashpaare, die beide Pakete ändern, stehen gemessen in le-1-ko-2-expectation-deltas.json (mit LE-1- und KO-2-Zwischenwert);
 * alle übrigen Paare ändert nur eines der Pakete und kommen unverändert aus dessen Beleg. */
export function readLE1KO2References(value) {
    if (typeof value === 'string') {
        if (evidence.hashes[value]) return evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readLE1KO2References(JSON.parse(value)));
        return readLE1References(readKO2References(value));
    }
    if (Array.isArray(value)) return value.map(readLE1KO2References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readLE1KO2References(item)]));
    return value;
}
