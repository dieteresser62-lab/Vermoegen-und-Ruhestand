import { readFileSync } from 'node:fs';
const { hashes } = JSON.parse(readFileSync(new URL('../fixtures/bk-2-expectation-deltas.json', import.meta.url)));
// Historische Belege bleiben unverändert; bekannte fachliche Deltas separat lesen.
export const readBK2Hash = before => hashes[before] ?? before;
