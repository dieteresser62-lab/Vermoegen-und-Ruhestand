import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/hp-4-expectation-deltas.json', import.meta.url)));
const hashes = Object.fromEntries(evidence.entries.filter(entry => entry.kind === 'hash').map(entry => [entry.old, entry.new]));
/** HP-4 (H-ERBST-ABRUNDUNG-100): Der steuerpflichtige Erwerb wird auf volle 100 € abgerundet; Todesjahre mit steuerpflichtigem Erwerb
 * tragen zusätzlich inheritance.taxable. Nur gemessene Werte; je Eintrag Test, Feld, alt, neu und Grund. Die Gegenprobe ohne Abrundung
 * und ohne das neue Feld steht in der Notiz des Belegs. */
export const hp4Evidence = {
    entries: evidence.entries,
    value: (test, field) => evidence.entries.find(entry => entry.test === test && entry.field === field)?.new
};
/** Ersetzt nur Prüfsummen, die HP-4 gemessen geändert hat; alle anderen Werte bleiben. Zeichenketten mit JSON werden innen ersetzt. */
export function readHP4References(value) {
    if (typeof value === 'string') {
        if (hashes[value]) return hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readHP4References(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readHP4References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readHP4References(item)]));
    return value;
}
