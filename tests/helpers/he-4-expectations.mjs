import { readFileSync } from 'node:fs';
export const he4Evidence = JSON.parse(readFileSync(new URL('../fixtures/he-4-expectation-deltas.json', import.meta.url)));

/** FR-72/HE-4: Monte-Carlo- und Sweep-Referenzen mit Heim oder gezogener Form. Die Pflegekennzahl ist netto
 * (Pflegeausgaben minus eingesparter Grundbedarf), bei „Amtlich“ steht die gezogene Form auch zu Hause im
 * Protokoll. Backtest-, Balance- und Paritätsreferenzen sind nicht enthalten und bleiben unverändert. */
export function readHE4References(value) {
    if (typeof value === 'string') {
        if (he4Evidence.hashes[value]) return he4Evidence.hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readHE4References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readHE4References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readHE4References(item)]));
    return value;
}
