import { readFileSync } from 'node:fs';
export const pfa3Evidence = JSON.parse(readFileSync(new URL('../fixtures/pfa-3-expectation-deltas.json', import.meta.url)));

/** Vollreferenzen nach FR-73 Paket 3: nur explizit gemessene Hashpaare ersetzen; alte Belege bleiben erhalten. */
export function readPFA3References(value) {
    if (typeof value === 'string') {
        if (pfa3Evidence.hashes[value]) return pfa3Evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readPFA3References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readPFA3References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readPFA3References(item)]));
    return value;
}
