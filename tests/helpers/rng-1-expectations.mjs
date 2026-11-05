import { readFileSync } from 'node:fs';

export const rng1Evidence = JSON.parse(readFileSync(new URL('../fixtures/rng-1-expectation-deltas.json', import.meta.url)));
// Nur einzeln belegte RNG-1-Folgen; historische Belege bleiben erhalten.
export const readRNG1Hash = before => rng1Evidence.hashes[before] ?? before;
export function readRNG1References(value) {
    if (typeof value === 'string') return readRNG1Hash(value);
    if (Array.isArray(value)) return value.map(readRNG1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, readRNG1References(entry)]));
    return value;
}
