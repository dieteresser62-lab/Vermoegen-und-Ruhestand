import { readFileSync } from 'node:fs';

const evidence = JSON.parse(readFileSync(new URL('../fixtures/fz-1-expectation-deltas.json', import.meta.url)));
const comparisonValue = value => typeof value === 'object' ? JSON.stringify(value) : value;

/** Ersetzt nur gegen die Basis gemessene Sollwerte im jeweiligen Test. */
export function fz1References(testUrl) {
    const test = new URL(testUrl).pathname.split('/').at(-1);
    const replacements = new Map(evidence.tests[test].map(({ vorher, nachher }) => [comparisonValue(vorher), comparisonValue(nachher)]));
    return value => replacements.get(value) ?? value;
}
