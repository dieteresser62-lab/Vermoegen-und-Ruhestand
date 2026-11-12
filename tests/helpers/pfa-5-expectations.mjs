import { readFileSync } from 'node:fs';
export const pfa5Evidence = JSON.parse(readFileSync(new URL('../fixtures/pfa-5-expectation-deltas.json', import.meta.url)));

/** Vollreferenzen nach FR-73 Paket 5: nur explizit gemessene Hashpaare ersetzen; alte Belege bleiben erhalten. */
export function readPFA5References(value) {
    if (typeof value === 'string') {
        if (pfa5Evidence.hashes[value]) return pfa5Evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readPFA5References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readPFA5References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readPFA5References(item)]));
    return value;
}
