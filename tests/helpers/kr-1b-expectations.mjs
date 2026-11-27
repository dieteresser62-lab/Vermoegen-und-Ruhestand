import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/kr-1b-expectation-deltas.json', import.meta.url)));
/** KR-1b (19.11.2026, FR-88): nur gemessene Hashpaare ersetzen; alte Belege bleiben. Grund: Dynamic Flex rechnet die VPW-Rate
 * vorschüssig. Ohne wirksamen Dynamic Flex bleiben alle Ergebnisse bytegleich. */
export function readKR1bReferences(value) {
    if (typeof value === 'string') {
        if (evidence.hashes[value]) return evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readKR1bReferences(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readKR1bReferences);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readKR1bReferences(item)]));
    return value;
}
