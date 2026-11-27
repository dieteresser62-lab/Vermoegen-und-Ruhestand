import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/ms-1-expectation-deltas.json', import.meta.url)));
/** MS-1 (19.11.2026): gemessene Fälle mit block oder stationary nach zirkulärer Ziehung (NG-9) und CAPE nur im ersten Block (NG-8). */
export const ms1Evidence = { md2Cases: evidence.md2Cases || {} };
/** Nur gemessene Hashpaare ersetzen; alte Belege bleiben. regime_markov und regime_iid sind unverändert. */
export function readMS1References(value) {
    if (typeof value === 'string') {
        if (evidence.hashes[value]) return evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readMS1References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readMS1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readMS1References(item)]));
    return value;
}
