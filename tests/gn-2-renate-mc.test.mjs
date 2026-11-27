// JD-2a: Eingefrorene Belege dieser Datei gelten dem Grundbestand 1925–2025 (Stichprobe und Provider, jahresrobust).
import { fz1References } from './helpers/fz-1-expectations.mjs';
import { readDM1References } from './helpers/dm-1-expectations.mjs';
import { readJA1References } from './helpers/ja-1-expectations.mjs';
import { readHP4References } from './helpers/hp-4-expectations.mjs';
import { readKR1cReferences } from './helpers/kr-1c-expectations.mjs';
import './helpers/grundbestand-sicht-aktiv.mjs';
import { readTRG1References } from './helpers/trg-1-expectations.mjs';
// GN-2 Sollfall (FR-73 Punkt 8 geändert): Renate am 23.10.2026, Monte-Carlo mit 10.000 Läufen, Startwert 12345, Dauer automatisch
// (bis Alter 110). Deckungsquote zwischen 81 und 84 % (bisher 75,83 % mit dauerhaft + 5 %). Rechnet in Stücken zu 500 Läufen
// auf denselben Pfaden wie ein Lauf mit 10.000.
import { measurementInputs, parameters, backtest, hash } from './helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { resolveMonteCarloDefaultDurationV1 } from '../app/simulator/monte-carlo-parameters.js';
import { EngineAPI } from '../engine/index.mjs';

import { readFI1References } from './helpers/fi-1-expectations.mjs';
import { readRK1MergeReferences } from './helpers/rk-1-merge-expectations.mjs';
const readFZ1Reference = fz1References(import.meta.url);
const runs = 10000, inputs = await measurementInputs(0, 'renate', '2026-10-23');
assertEqual(`${inputs.pflegeKostenDrift} · ${inputs.pflegeKostenDriftBis} · ${inputs.pflegeKostenDriftDanach} · ${inputs.pflegeKostenStartJahr}`, '0.05 · 2035 · 0.02 · 2026',
    'GN-2: Renate rechnet mit + 5 % bis 2035, danach + 2 %, Index 0 = 2026');
const maxDauer = resolveMonteCarloDefaultDurationV1(inputs);
let failCount = 0;
for (let start = 0; start < runs; start += 500) {
    const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: runs, maxDauer },
        widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: Math.min(500, runs - start) } });
    failCount += chunk.totals.failCount;
}
const coverage = 100 * (1 - failCount / runs);
console.log(`GN-2 Renate: ${failCount} von ${runs} Läufen gescheitert, Deckungsquote ${coverage.toFixed(2)} %`);
// NK-1 (FR-84): Pflegekosten beenden keinen Lauf mehr; was Renates Geld nicht trägt, zahlt der Staat. NK-1c: 89,70 % (787 Ruine wegen
// Steuer ohne Pflegebezug, 243 wegen Grundbedarf). NK-2 (FR-84 Punkt 17): Die Steuer bleibt als Schuld; 595 dieser Läufe enden später am
// Grundbedarf, 192 nicht mehr. Gemessen 91,62 % (838 Ruine, alle wegen Grundbedarf; vor FR-84 81–84 %).
assert(coverage >= 90 && coverage <= 93, `GN-2: Renate Deckungsquote zwischen 90 und 93 % (${coverage.toFixed(2)} %, vor FR-84 81–84 %)`);

// Ohne Pflegelogik und ohne Pflegegrad heute sind Monte-Carlo und Backtest bytegleich mit dem Stand vor GN-2 (c18cb903).
// Der Backtest legt seine Eingaben im Ergebnis ab; ohne die drei neuen Felder ist er bytegleich.
const before = {
    renate: { mc: 'ae8d762b74fb1fb3e722e84219be73c1cdc4872c28f705b342de34e9f0144cb8', bt: '838f1d120660b54719b1f41206718d553bdcf4ee6a63c4112e852ecc5894defa' },
    'max-erika': { mc: '6cb2188a3913c3bd29e64f92d26f09d7c98c0275dc46f265ac1b88ea190f4793', bt: 'd05889f1665eb93bdc018e757ad247d2fc1f6329a922146449b598ae42ce6cb2' }
};
// NG-W (W3, ca76095b): Ein Ruinlauf zählt im Max. Rückgang mit 100 %. Von Renates 200 Läufen ist genau einer aufgebraucht (Lauf 104); nur bei ihm
// gehen buffers.maxDrawdowns/realMaxDrawdowns und pathSummaries.maxDrawdownPct/maxDrawdownRealPct von 95,4/98,1 auf 100. Gemessen gegen 1571ef08:
// Ruinzahl, Entnahmen, Steuern und Endvermögen bleiben gleich; Max-Erika hat keinen Ruinlauf, ihr Wert bleibt.
const readNGWReference = value => ({ '7e76cf74a4eedca31329b347c4a81cc995d34c5040d41dabb0a1eaa255203874':
    '23cf0ebcfa16bda505d671ae5caae2aca77050d72b898d67d67dc94679d01ef8' })[value] ?? value;
for (const id of ['renate', 'max-erika']) {
    const current = await measurementInputs(0, id, '2026-10-23');
    const off = { ...current, pflegefallLogikAktivieren: false };
    delete off.careToday; if (off.partner) delete off.partner.careToday;
    const mc = await runMonteCarloChunk({ inputs: off, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: 200 }, widowOptions: off.widowOptions,
        useCapeSampling: false, runRange: { start: 0, count: 200 } });
    assertEqual(hash(mc), readNGWReference(readFZ1Reference(readDM1References(readJA1References(readHP4References(readKR1cReferences(readRK1MergeReferences(readFI1References(readTRG1References(before[id].mc))))))))),`GN-2 ${id}: ohne Pflegelogik Monte-Carlo mit belegter Erbschaftsteuer`);
    const withoutNewFields = { ...off };
    for (const key of ['pflegeKostenDriftBis', 'pflegeKostenDriftDanach', 'pflegeKostenStartJahr']) delete withoutNewFields[key];
    assertEqual(hash(backtest(withoutNewFields)), readFZ1Reference(readDM1References(readKR1cReferences(readRK1MergeReferences(before[id].bt)))), `GN-2 ${id}: ohne Pflegelogik Backtest mit belegtem Ehestatus`);
    const plain = backtest(off), reference = backtest(withoutNewFields);
    assertEqual(JSON.stringify(plain.rows), JSON.stringify(reference.rows), `GN-2 ${id}: neue Felder ändern keine Backtestzeile`);
}
