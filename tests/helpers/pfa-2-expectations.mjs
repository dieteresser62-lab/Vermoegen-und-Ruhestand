import { readFileSync } from 'node:fs';
export const pfa2Evidence = JSON.parse(readFileSync(new URL('../fixtures/pfa-2-expectation-deltas.json', import.meta.url)));

/** Vollreferenzen nach FR-73 Paket 2: nur explizit gemessene Hashpaare ersetzen; alte Belege bleiben erhalten. */
export function readPFA2References(value) {
    if (typeof value === 'string') {
        if (pfa2Evidence.hashes[value]) return pfa2Evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readPFA2References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readPFA2References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readPFA2References(item)]));
    return value;
}
