import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/le-1-expectation-deltas.json', import.meta.url)));
export const le1Evidence = evidence;
/** LE-1 (FR-75, FR-41, 12.11.2026): nur gemessene Hashpaare ersetzen; alte Belege bleiben.
 * Gründe: Kohortentafel und abgestimmte Grundsterblichkeit im Monte Carlo, neue Pflegeabstimmung,
 * Horizont mit Dynamic Flex, Geburtsjahr und automatische Dauer in den Eingaben. */
export function readLE1References(value) {
    if (typeof value === 'string') {
        if (evidence.hashes[value]) return evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readLE1References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readLE1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readLE1References(item)]));
    return value;
}
