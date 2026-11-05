import { readFileSync } from 'node:fs';
export const md2Evidence = JSON.parse(readFileSync(new URL('../fixtures/md-2-expectation-deltas.json', import.meta.url)));
/** Vollständige Referenzfolgen allein durch die beauftragte Renditekennzahl und Szenarioauswahl. */
export function readMD2References(value) {
    if (typeof value === 'string') {
        if (md2Evidence.hashes[value]) return md2Evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readMD2References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readMD2References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readMD2References(item)]));
    return value;
}
