import { readFileSync } from 'node:fs';
import { readNR1Hash } from './nr-1-expectations.mjs';
const { hashes } = JSON.parse(readFileSync(new URL('../fixtures/kg-1-expectation-deltas.json', import.meta.url)));
// Nur nachgewiesene Textänderungen; alle übrigen Felder wurden bytegleich verglichen.
export const readKG1Hash = before => readNR1Hash(hashes[before] ?? before);
