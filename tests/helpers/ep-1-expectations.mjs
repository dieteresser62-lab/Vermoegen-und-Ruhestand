import { readFileSync } from 'node:fs';
export const ep1Evidence = JSON.parse(readFileSync(new URL('../fixtures/ep-1-expectation-deltas.json', import.meta.url)));
export const readEP1Hash = before => ep1Evidence.hashes[before] ?? before;
export function readEP1References(value) {
    if (typeof value === 'string') return readEP1Hash(value);
    if (Array.isArray(value)) return value.map(readEP1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, readEP1References(entry)]));
    return value;
}
