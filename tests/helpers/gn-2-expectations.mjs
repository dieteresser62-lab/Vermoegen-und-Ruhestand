import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/gn-2-expectation-deltas.json', import.meta.url)));
/** GN-2 (FR-73 Punkt 8 geändert, 12.11.2026): nur gemessene Hashpaare ersetzen; alte Belege bleiben.
 * Grund: Pflegekostenanstieg je Kalenderjahr, bis 2035 + 5 %, ab 2036 + 2 % (vorher dauerhaft + 5 %). Jedes Paar wurde
 * gegengeprüft: Mit dauerhaft + 5 % als Vorgabe ergeben dieselben Tests wieder die alten Werte. */
export function readGN2References(value) {
    if (typeof value === 'string') {
        if (evidence.hashes[value]) return evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readGN2References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readGN2References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readGN2References(item)]));
    return value;
}
