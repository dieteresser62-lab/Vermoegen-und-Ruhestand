import { readFileSync } from 'node:fs';
export const vf2bEvidence = JSON.parse(readFileSync(new URL('../fixtures/vf-2b-expectation-deltas.json', import.meta.url)));
// Historische Referenzen erhalten; ausschließlich belegte Folgen von VF-2b nachführen.
export function readVF2BReferences(value) {
    if (typeof value === 'string') return vf2bEvidence.hashes[value] ?? value;
    if (Array.isArray(value)) return value.map(readVF2BReferences);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readVF2BReferences(item)]));
    return value;
}
