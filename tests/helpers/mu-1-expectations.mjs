import { readFileSync } from 'node:fs';
const references = JSON.parse(readFileSync(new URL('../fixtures/mu-1-jan-lena-references.json', import.meta.url), 'utf8'));
export const readMU1Hash = before => references.hashes[before] ?? before;
