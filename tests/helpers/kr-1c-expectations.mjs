import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/kr-1c-expectation-deltas.json', import.meta.url)));
const hashes = Object.fromEntries(evidence.entries.filter(entry => entry.kind === 'hash').map(entry => [entry.old, entry.new]));
/** KR-1c (NG-5, 20.11.2026): Der Zins des Jahres auf Tagesgeld, Geldmarkt und Pflegerücklage steht vor der Entscheidung. Nur gemessene
 * Werte; je Eintrag Test, Feld, alter und neuer Wert und Grund. Die Gegenprobe mit der alten Zeitlage steht in der Notiz des Belegs. */
export const kr1cEvidence = {
    entries: evidence.entries,
    value: (test, field) => evidence.entries.find(entry => entry.test === test && entry.field === field)?.new
};
/** Ersetzt nur Prüfsummen, die KR-1c gemessen geändert hat; alle anderen Werte bleiben. Zeichenketten mit JSON werden innen ersetzt. */
export function readKR1cReferences(value) {
    if (typeof value === 'string') {
        if (hashes[value]) return hashes[value];
        if (value.startsWith('[') || value.startsWith('{')) return JSON.stringify(readKR1cReferences(JSON.parse(value)));
        return value;
    }
    if (Array.isArray(value)) return value.map(readKR1cReferences);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readKR1cReferences(item)]));
    return value;
}
