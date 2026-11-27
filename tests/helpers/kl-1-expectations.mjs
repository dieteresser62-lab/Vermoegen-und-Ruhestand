import { readFileSync } from 'node:fs';

const { changes } = JSON.parse(readFileSync(new URL('../fixtures/kl-1-expectation-deltas.json', import.meta.url)));

export const readKL1Hash = before => changes.find(change => change.old === before)?.new ?? before;
