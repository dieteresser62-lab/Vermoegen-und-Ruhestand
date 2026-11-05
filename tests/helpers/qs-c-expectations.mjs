import { readFileSync } from 'node:fs';
export const qscEvidence = JSON.parse(readFileSync(new URL('../fixtures/qs-c-expectation-deltas.json', import.meta.url)));
/** Nur mit Altmodul-Gegenlauf belegte QS-C-Folgen, ohne Ergebnisfelder auszublenden. */
export function readQSCReferences(value) {
    if (typeof value === 'string') return qscEvidence.hashes[value] ?? value;
    if (Array.isArray(value)) return value.map(readQSCReferences);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readQSCReferences(item)]));
    return value;
}
