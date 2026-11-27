import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/vs-2-expectation-deltas.json', import.meta.url)));
/** VS-2 (16.11.2026): nur gemessene Hashpaare ersetzen; alte Belege bleiben. Grund: Beispielhaushalte legen keine erfassten
 * Vermögensstände (rs_household_wealth_captures_v1) mehr an. Gegenprobe: Ohne diesen Schlüssel sind alle Records aller
 * Beispielhaushalte und Varianten an sechs Testdaten bytegleich zum Stand davor. */
export function readVS2References(value) {
    if (typeof value === 'string') {
        if (evidence.hashes[value]) return evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readVS2References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readVS2References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readVS2References(item)]));
    return value;
}
