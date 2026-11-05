import { readFileSync } from 'node:fs';

export const nr1Evidence = JSON.parse(readFileSync(new URL('../fixtures/nr-1-display-evidence.json', import.meta.url)));
// Historische Vollreferenzen bleiben erhalten; nur belegte Anzeigeänderungen zuordnen.
export const readNR1Hash = before => nr1Evidence.hashes[before] ?? before;
