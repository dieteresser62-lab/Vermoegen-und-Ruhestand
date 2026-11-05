import { readFileSync } from 'node:fs';
export const ev1bEvidence = JSON.parse(readFileSync(new URL('../fixtures/ev-1b-expectation-deltas.json', import.meta.url)));

/** Vollreferenzen mit belegter Folgejahrprojektion; unveränderte Belege bleiben erhalten. */
export function readEV1bReferences(value) {
    if (typeof value === 'string') {
        if (ev1bEvidence.hashes[value]) return ev1bEvidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readEV1bReferences(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readEV1bReferences);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readEV1bReferences(item)]));
    return value;
}
