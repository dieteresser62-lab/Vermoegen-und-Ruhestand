import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/fi-1-expectation-deltas.json', import.meta.url)));
/** Belegte Zahl der Zahlenfelder je Fall (nur wo die Bankreihenfolge neue Felder erzeugt). */
export const fi1Evidence = { numericLeaves: evidence.numericLeaves || {} };
/** FI-1 (FR-82, 14.11.2026): nur gemessene Hashpaare ersetzen; alte Belege bleiben. Grund: Bankreihenfolge je Person und ISIN.
 * Monte Carlo mit Todesfall: Geerbte Tranchen gehören danach der überlebenden Person, die dieselben ETFs hält; mit abgeschalteter
 * Regel sind alle Werte unverändert (geprüft 14.11.2026). */
export function readFI1References(value) {
    if (typeof value === 'string') {
        if (evidence.hashes[value]) return evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readFI1References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readFI1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readFI1References(item)]));
    return value;
}
