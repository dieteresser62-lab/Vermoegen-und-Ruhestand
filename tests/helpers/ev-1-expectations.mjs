import { readFileSync } from 'node:fs';
export const ev1Evidence = JSON.parse(readFileSync(new URL('../fixtures/ev-1-inheritance-references.json', import.meta.url)));
/** Nur belegte FR-67-Erbfälle; Vorjahre und Backtests behalten ihre Vollreferenzen. */
export function readEV1References(value) {
    if (typeof value === 'string') return ev1Evidence.hashes[value] ?? value;
    if (Array.isArray(value)) return value.map(readEV1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readEV1References(item)]));
    return value;
}
