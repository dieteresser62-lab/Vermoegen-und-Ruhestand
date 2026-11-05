import { readVF2FReferences } from './vf-2f-expectations.mjs';
import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/vf-2e-expectation-deltas.json', import.meta.url)));
export function readVF2EReferences(value) {
    if (typeof value === 'string') return readVF2FReferences(evidence.hashes[value] ?? value);
    if (Array.isArray(value)) return value.map(readVF2EReferences);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readVF2EReferences(item)]));
    return value;
}
