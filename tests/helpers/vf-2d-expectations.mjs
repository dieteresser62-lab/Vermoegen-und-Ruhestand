import { readVF2EReferences } from './vf-2e-expectations.mjs';
import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/vf-2d-expectation-deltas.json', import.meta.url)));
export function readVF2DReferences(value) {
    if (typeof value === 'string') return readVF2EReferences(evidence.hashes[value] ?? value);
    if (Array.isArray(value)) return value.map(readVF2DReferences);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readVF2DReferences(item)]));
    return value;
}
