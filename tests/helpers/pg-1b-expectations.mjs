import { readFileSync } from 'node:fs';

export const pg1bEvidence = JSON.parse(readFileSync(new URL('../fixtures/pg-1b-expectation-deltas.json', import.meta.url)));
// Nur einzeln belegte Folgen des Pflegegelds nach FR-47 zuordnen.
export const readPG1bHash = before => pg1bEvidence.hashes[before] ?? before;
