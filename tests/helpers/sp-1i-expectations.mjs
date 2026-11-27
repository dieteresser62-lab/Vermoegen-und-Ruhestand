import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/sp-1i-expectation-deltas.json', import.meta.url)));
/** Nur gemessene Hashpaare ersetzen; alte Belege bleiben. Grund: Jahresbelege mit Kauf tragen die persönlichen Verwendungen
 * (`action.personalUses`). Gegenprobe: Ohne dieses Feld sind die Records bytegleich zum Stand davor. */
export function readSP1iReferences(value) {
    if (typeof value === 'string') return evidence.hashes[value] || value;
    if (Array.isArray(value)) return value.map(readSP1iReferences);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readSP1iReferences(item)]));
    return value;
}
