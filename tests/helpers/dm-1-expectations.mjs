import { readFileSync } from 'node:fs';

const evidence = JSON.parse(readFileSync(new URL('../fixtures/dm-1-expectation-deltas.json', import.meta.url), 'utf8'));
const reference = value => typeof value === 'object' ? JSON.stringify(value) : value;
const expectations = new Map(evidence.rechenbelege.map(({ vorher, nachher }) => [reference(vorher), reference(nachher)]));

export const readDM1References = value => expectations.get(value) ?? value;
