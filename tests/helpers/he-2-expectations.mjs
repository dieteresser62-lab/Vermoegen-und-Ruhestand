import { readFileSync } from 'node:fs';
export const he2Evidence = JSON.parse(readFileSync(new URL('../fixtures/he-2-expectation-deltas.json', import.meta.url)));

/** FR-72/HE-2: Monte-Carlo-Referenzen von Pfaden, die Heimpflege erreichen. Backtest-, Balance- und
 * Paritätsreferenzen sind nicht enthalten und bleiben unverändert. */
export function readHE2References(value) {
    if (typeof value === 'string') {
        if (he2Evidence.hashes[value]) return he2Evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readHE2References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readHE2References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readHE2References(item)]));
    return value;
}
