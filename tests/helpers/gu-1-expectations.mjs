import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/gu-1-expectation-deltas.json', import.meta.url)));
/** GU-1 (FR-74, FR-76, 11.11.2026): nur gemessene Hashpaare der geänderten Beispielvorgaben ersetzen; alte Belege bleiben. */
export function readGU1References(value) {
    if (typeof value === 'string') {
        if (evidence.hashes[value]) return evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readGU1References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readGU1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readGU1References(item)]));
    return value;
}
