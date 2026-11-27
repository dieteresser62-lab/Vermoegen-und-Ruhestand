import { readFileSync } from 'node:fs';
const evidence = JSON.parse(readFileSync(new URL('../fixtures/nk-1-expectation-deltas.json', import.meta.url)));
/** NK-1 (FR-84): nur gemessene Hashpaare ersetzen; alte Belege bleiben. Grund: Pflegekosten beenden keinen Lauf mehr
 * (Hilfe zur Pflege), Ruin nur bei Mangel im Grundbedarf ohne Pflege, Notverkauf nur bei diesem Mangel. Jede Zeile der Belegdatei
 * nennt Fall und Ursache. Ohne Pflege, die das Vermögen aufzehrt, bleiben die Werte unverändert (Sollfall D). */
export function readNK1References(value) {
    // Ein Beleg kann auf einen späteren Beleg verweisen (Kette); jetzt steht je Fall der Weg von 7ad60d01 zum heutigen Stand.
    if (typeof value === 'string') { let current = value; while (evidence.hashes[current]?.new) current = evidence.hashes[current].new; return current; }
    if (Array.isArray(value)) return value.map(readNK1References);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readNK1References(item)]));
    return value;
}
