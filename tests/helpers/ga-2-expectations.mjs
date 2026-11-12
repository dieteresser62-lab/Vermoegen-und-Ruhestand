import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/ga-2-expectation-deltas.json', import.meta.url)));
/** GA-2 (FR-43, 11.11.2026): nur Folgen des geänderten Beispielhaushalts Sophie mit fester geplanter Ausgabe. */
export function readGA2References(value) {
    if (typeof value === 'string') return evidence.hashes[value] ?? value;
    if (Array.isArray(value)) return value.map(readGA2References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readGA2References(item)]));
    return value;
}
