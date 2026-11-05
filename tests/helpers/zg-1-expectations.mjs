import { readFileSync } from 'node:fs';
export const zg1Evidence = JSON.parse(readFileSync(new URL('../fixtures/zg-1-expectation-deltas.json', import.meta.url)));
/** Vollständige Referenzfolgen durch den beauftragten Zugewinnausgleich. */
export function readZG1References(value) {
    if (typeof value === 'string') {
        if (zg1Evidence.hashes[value]) return zg1Evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readZG1References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readZG1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readZG1References(item)]));
    return value;
}
