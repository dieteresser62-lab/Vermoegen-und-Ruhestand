import { readFileSync } from 'node:fs';
export const gl1Evidence = JSON.parse(readFileSync(new URL('../fixtures/gl-1-expectation-deltas.json', import.meta.url)));
const traceEvidence = JSON.parse(readFileSync(new URL('../fixtures/uk-1b-trace-expectation-deltas.json', import.meta.url)));
const traceHashes = new Map(traceEvidence.groups.map(group => [group.beforeSha256, group.afterSha256]));
// Historische Belege erhalten; gemessene FR-60-Folgen und reine Trace-Erweiterung nachführen.
export const readGL1Hash = before => {
    const afterGuardrails = gl1Evidence.hashes[before] ?? before;
    return traceHashes.get(afterGuardrails) ?? afterGuardrails;
};
export function readGL1References(value) {
    if (typeof value === 'string') {
        return readGL1Hash(value);
    }
    if (Array.isArray(value)) return value.map(readGL1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readGL1References(item)]));
    return value;
}
