import { readFileSync } from 'node:fs';
import { readFX1bHash } from './fx-1b-expectations.mjs';
import { readFX1aHash } from './fx-1a-expectations.mjs';
import { readKG1Hash } from './kg-1-expectations.mjs';
const { hashes } = JSON.parse(readFileSync(new URL('../fixtures/jb-2-expectation-deltas.json', import.meta.url)));
const { hashes: st1Hashes } = JSON.parse(readFileSync(new URL('../fixtures/st-1-expectation-deltas.json', import.meta.url)));
const { hashes: nl1Hashes } = JSON.parse(readFileSync(new URL('../fixtures/nl-1-expectation-deltas.json', import.meta.url)));
const { hashes: st1bHashes } = JSON.parse(readFileSync(new URL('../fixtures/st-1b-expectation-deltas.json', import.meta.url)));
// Historische Belege behalten; ST-1 trennt reine Ausgabetexte und belegte Pflegetode.
export const readNL1Hash = before => readKG1Hash(readFX1bHash(readFX1aHash(st1bHashes[nl1Hashes[before] ?? before] ?? nl1Hashes[before] ?? before)));
export const readST1Hash = before => readNL1Hash(st1Hashes[before] ?? before);
export const readJB2Hash = before => readST1Hash(hashes[before] ?? before);
