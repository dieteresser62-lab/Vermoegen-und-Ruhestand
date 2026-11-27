import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/vb-1-expectation-deltas.json', import.meta.url)));
/** Belegte Zahl der Zahlenfelder je Fall, wo der Nachlass neue Felder trägt, und belegte Protokollpfade nach geänderten Endvermögen. */
export const vb1Evidence = { numericLeaves: evidence.numericLeaves || {}, characteristicIndices: evidence.characteristicIndices || {} };
/** VB-1 (FR-51, Ergänzung 19.11.2026): Versorgungsfreibetrag nach § 17 ErbStG. Nur gemessene Hashpaare ersetzen; alte Belege bleiben.
 * Gründe stehen im Beleg: verheiratete Todesjahre mit steuerpflichtigem Erwerb und Geburtsdaten in den Simulatoreingaben jeder Ehe. */
export function readVB1References(value) {
    if (typeof value === 'string') {
        if (evidence.hashes[value]) return evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readVB1References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readVB1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readVB1References(item)]));
    return value;
}
