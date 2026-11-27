// JD-2a: Eingefrorene Belege dieser Datei gelten dem Grundbestand 1925–2025 (Stichprobe und Provider, jahresrobust).
import { fz1References } from './helpers/fz-1-expectations.mjs';
import { readJA1References } from './helpers/ja-1-expectations.mjs';
import { readHP4References } from './helpers/hp-4-expectations.mjs';
import { readKR1cReferences } from './helpers/kr-1c-expectations.mjs';
import { readVB1References } from './helpers/vb-1-expectations.mjs';
import { readRK1MergeReferences } from './helpers/rk-1-merge-expectations.mjs';
import './helpers/grundbestand-sicht-aktiv.mjs';
import { readLE1References } from './helpers/le-1-expectations.mjs';
import { readGU1References } from './helpers/gu-1-expectations.mjs';
import { readFileSync } from 'node:fs';
import { pfa1Invariance } from './helpers/pfa-1-invariance.mjs';
import { readFI1References } from './helpers/fi-1-expectations.mjs';
import { readMS1References } from './helpers/ms-1-expectations.mjs';
const readFZ1Reference = fz1References(import.meta.url);
const before = JSON.parse(readFileSync(new URL('./fixtures/pfa-1-invariance.json', import.meta.url)));
const after = await pfa1Invariance();
// MS-1: Block 3 zieht zirkulär aus allen Fensterjahren (NG-9). VB-1: Versorgungsfreibetrag in Todesjahren der Ehe; RK-1-Merge: beide zusammen.
assertEqual(after.noCareMonteCarlo, readFZ1Reference(readJA1References(readHP4References(readKR1cReferences(readRK1MergeReferences(readVB1References(readMS1References(readFI1References(readLE1References(readGU1References(before.noCareMonteCarlo)))))))))), 'Ohne heutigen Grad und Pflegeeintritt vollständige MC-Bytes gleich');
assertEqual(after.noCareBacktest, readKR1cReferences(readLE1References(readGU1References(before.noCareBacktest))), 'Backtest ohne heutigen Grad bei gleichen wirksamen Eingaben bytegleich');
for (const [scenario, hash] of Object.entries(before.traces)) {
    assertEqual(after.traces[scenario], readLE1References(hash), `${scenario}: 64 Seeds, bis 40 Jahre gleiche Grad-, Todes- und Formfolgen wie Basis`);
}
