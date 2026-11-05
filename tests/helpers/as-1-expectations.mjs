import { readFileSync } from 'node:fs';

export const as1Evidence = JSON.parse(readFileSync(new URL('../fixtures/as-1-expectation-deltas.json', import.meta.url)));
// Nur gemessene Folgen der freigegebenen FR-57-Anlage in FR-52-Überschussjahren.
export const readAS1Hash = before => as1Evidence.hashes[before] ?? before;
export function readAS1References(value) {
    if (typeof value === 'string') return readAS1Hash(value);
    if (Array.isArray(value)) return value.map(readAS1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readAS1References(item)]));
    return value;
}
