import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/ko-2-expectation-deltas.json', import.meta.url)));
/** KO-2 (Ergänzung FR-76, 12.11.2026): nur gemessene Hashpaare der Fondskosten im Dynamic Flex ersetzen; alte Belege bleiben. */
export function readKO2References(value) {
    if (typeof value === 'string') {
        if (evidence.hashes[value]) return evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readKO2References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readKO2References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readKO2References(item)]));
    return value;
}
