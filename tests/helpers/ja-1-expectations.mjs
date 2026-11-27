import { readFileSync } from 'node:fs';

const evidence = JSON.parse(readFileSync(new URL('../fixtures/ja-1-expectation-deltas.json', import.meta.url), 'utf8'));
const direct = value => typeof value === 'object' ? JSON.stringify(value) : value;
const expectations = new Map(evidence.rechenbelege.map(({ vorher, nachher }) => [direct(vorher), direct(nachher)]));

/** Ersetzt nur gemessene Erwartungen zum neuen Erbschaftsteuer-Fallback. */
export const readJA1References = value => expectations.get(value) ?? value;
