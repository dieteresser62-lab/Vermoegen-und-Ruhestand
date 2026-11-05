import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/pa-1-expectation-deltas.json', import.meta.url)));
/** Ausschließlich am Ausgangsstand belegte PA-1-Folgen, ohne Ergebnisfelder auszublenden. */
export function readPA1References(value) {
    if (typeof value === 'string') return evidence.hashes[value] ?? value;
    if (Array.isArray(value)) return value.map(readPA1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readPA1References(item)]));
    return value;
}
