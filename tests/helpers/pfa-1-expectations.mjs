import { readFileSync } from 'node:fs';
export const pfa1Evidence = JSON.parse(readFileSync(new URL('../fixtures/pfa-1-expectation-deltas.json', import.meta.url)));

/** Vollreferenzen nach FR-73: nur explizit gemessene Hashpaare ersetzen; alte Belege bleiben erhalten. */
export function readPFA1References(value) {
    if (typeof value === 'string') {
        if (pfa1Evidence.hashes[value]) return pfa1Evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readPFA1References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readPFA1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readPFA1References(item)]));
    return value;
}
