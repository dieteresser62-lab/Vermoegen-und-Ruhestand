import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/rk-1-merge-expectation-deltas.json', import.meta.url)));
const hashes = Object.fromEntries(evidence.entries.filter(entry => entry.kind === 'hash').map(entry => [entry.old ?? entry.head, entry.new]));
/** RK-1-Merge (19.11.2026): Werte, die VB-1 und die Kette JA-4/MS-1/KR-1 beide geändert haben. Nur gemessene Werte; je Eintrag
 * Wert der VB-1-Seite, Wert der HEAD-Seite, neuer Wert und Grund. Sonst gilt der Wert der Seite, die ihn geändert hat. */
export const rk1MergeEvidence = {
    entries: evidence.entries,
    value: (test, field) => evidence.entries.find(entry => entry.test === test && entry.field === field)?.new
};
/** Ersetzt nur Hashes der HEAD-Seite (bzw. den bisher erwarteten Wert old aus dem Nachtrag schwere Suite), die im Merge gemessen neu
 * entstanden sind; alle anderen Werte bleiben. */
export function readRK1MergeReferences(value) {
    if (typeof value === 'string') {
        if (hashes[value]) return hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readRK1MergeReferences(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readRK1MergeReferences);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readRK1MergeReferences(item)]));
    return value;
}
