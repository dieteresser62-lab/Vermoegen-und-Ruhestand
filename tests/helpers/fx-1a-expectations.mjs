import { readFileSync } from 'node:fs';
const { hashes } = JSON.parse(readFileSync(new URL('../fixtures/fx-1a-expectation-deltas.json', import.meta.url)));
// Einzelkorrekturen gegen die unveränderten synthetischen Ausgangsbelege gemessen.
export const readFX1aHash = before => hashes[before] ?? before;
