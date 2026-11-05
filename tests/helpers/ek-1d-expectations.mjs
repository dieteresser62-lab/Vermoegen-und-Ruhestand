import { readFileSync } from 'node:fs';
import { readNR1Hash } from './nr-1-expectations.mjs';

export const incomeSurplusEvidence = JSON.parse(readFileSync(new URL('../fixtures/ek-1d-expectation-deltas.json', import.meta.url)));
// Nur einzeln belegte Rentenüberschüsse und deren Folgezustände.
// Historische Referenzen und sämtliche bisherigen Feldvergleiche bleiben erhalten.
export const readEK1dHash = before => readNR1Hash(incomeSurplusEvidence.hashes[before] ?? before);
