import { readFileSync } from 'node:fs';
const { hashes } = JSON.parse(readFileSync(new URL('../fixtures/fx-1b-expectation-deltas.json', import.meta.url)));
// B3 und F2 einzeln gegen den synthetischen Ausgangsstand gemessen; historische Belege bleiben erhalten.
export const readFX1bHash = before => hashes[before] ?? before;
