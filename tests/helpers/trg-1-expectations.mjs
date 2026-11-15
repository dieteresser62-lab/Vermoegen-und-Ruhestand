import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/trg-1-expectation-deltas.json', import.meta.url)));
/** TRG-1 (FR-80 Punkt 8, 13.11.2026): nur Folgen der Steuer je Euro mit Teilfreistellung in der Personenaufteilung. */
export function readTRG1References(value) {
    if (typeof value === 'string') return evidence.hashes[value] ?? value;
    if (Array.isArray(value)) return value.map(readTRG1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readTRG1References(item)]));
    return value;
}
