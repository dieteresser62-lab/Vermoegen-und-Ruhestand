import { readFileSync } from 'node:fs';
export const he3Evidence = JSON.parse(readFileSync(new URL('../fixtures/he-3-expectation-deltas.json', import.meta.url)));

/** FR-72/HE-3: Monte-Carlo-Referenzen mit „Amtlich“, deren Pflegeform jetzt je Person gezogen wird. Backtest-,
 * Balance- und Paritätsreferenzen sind nicht enthalten und bleiben unverändert. */
export function readHE3References(value) {
    if (typeof value === 'string') {
        if (he3Evidence.hashes[value]) return he3Evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readHE3References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readHE3References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readHE3References(item)]));
    return value;
}
