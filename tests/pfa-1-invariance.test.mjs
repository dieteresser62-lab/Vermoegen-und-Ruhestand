import { readLE1References } from './helpers/le-1-expectations.mjs';
import { readGU1References } from './helpers/gu-1-expectations.mjs';
import { readFileSync } from 'node:fs';
import { pfa1Invariance } from './helpers/pfa-1-invariance.mjs';
const before = JSON.parse(readFileSync(new URL('./fixtures/pfa-1-invariance.json', import.meta.url)));
const after = await pfa1Invariance();
assertEqual(after.noCareMonteCarlo, readLE1References(readGU1References(before.noCareMonteCarlo)), 'Ohne heutigen Grad und Pflegeeintritt vollständige MC-Bytes gleich');
assertEqual(after.noCareBacktest, readLE1References(readGU1References(before.noCareBacktest)), 'Backtest ohne heutigen Grad bei gleichen wirksamen Eingaben bytegleich');
for (const [scenario, hash] of Object.entries(before.traces)) {
    assertEqual(after.traces[scenario], readLE1References(hash), `${scenario}: 64 Seeds, bis 40 Jahre gleiche Grad-, Todes- und Formfolgen wie Basis`);
}
