import { readFileSync } from 'node:fs';

export const an1Evidence = JSON.parse(readFileSync(new URL('../fixtures/an-1-expectation-deltas.json', import.meta.url)));
// Nur einzeln gemessene Folgen der freigegebenen FR-46-Käufe zuordnen.
export const readAN1Hash = before => an1Evidence.hashes[before] ?? before;
