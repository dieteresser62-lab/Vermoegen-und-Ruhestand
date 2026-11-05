// Ergebnisbytes aller bisherigen Muster und Varianten; ausschließlich Immobilien-Anzeigefelder aus VF-2l/GV-1 bleiben außen vor.
import { writeFileSync } from 'node:fs';
import { measurementInputs, backtest, hash } from '../tests/helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../engine/index.mjs';
import { MUSTER_HAUSHALTE, musterVarianten } from '../app/demo/muster-haushalte.js';
const count = Number(process.argv.find(arg => arg.startsWith('--runs='))?.slice(7) || 8);
if (!Number.isSafeInteger(count) || count < 1) throw new Error('Ungültige Laufzahl');
const parameters = { anzahl: count, maxDauer: 35, blockSize: 5, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const cases = {};
function financialHash(value) {
    return hash(JSON.parse(JSON.stringify(value, (key, entry) => ['immobilien_wert_end', 'immobilien_selbst_end', 'immobilien_vermietet_end', 'displayWealth'].includes(key) || key.includes('displayHomeValue') ? undefined : entry)));
}
for (const { id } of MUSTER_HAUSHALTE) {
  for (const variant of musterVarianten(id)) {
    const inputs = await measurementInputs(0, id, '2026-10-23', variant.id);
    // PA-1-Gegenprobe: derselbe Haushalt mit durchgehend externer Pflege.
    if (process.argv.includes('--without-family')) {
        for (const grade of [1, 2, 3, 4, 5]) inputs.pflegeGradeConfigs[grade].careForm = grade <= 3 ? 'home-support' : 'residential';
        for (const today of [inputs.careToday, inputs.partner?.careToday]) if (today?.form === 'family') today.form = 'home-support';
    }
    const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: parameters,
        widowOptions: inputs.widowOptions, useCapeSampling: false,
        runRange: { start: 0, count }, logIndices: count <= 8 ? Array.from({ length: count }, (_, i) => i) : [] });
    const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const metrics = { coveredPct: (count - chunk.totals.failCount - chunk.technicalInventory.technicalError) / count * 100,
        ruin: chunk.totals.outcomeRuinCount, meanEndWealth: mean([...chunk.pathSummaries.finalValueRealEur]),
        meanTaxes: mean([...chunk.buffers.taxOutcomes]), technicalErrors: chunk.technicalInventory.technicalError };
    cases[`${id}/${variant.id}`] = { inputs: hash(inputs), mc: financialHash(chunk), backtest: financialHash(backtest(inputs, 2000, 2025)), metrics };
    console.log(`${id}/${variant.id}: ${JSON.stringify(metrics)}`);
  }
}
writeFileSync(process.argv[2], JSON.stringify({ date: '2026-10-23', parameters, cases }, null, 2) + '\n');
console.log(`MC-Chunks und Backtests ohne Immobilien-Anzeigefelder: ${Object.keys(cases).length} bestehende Muster und Varianten erfasst.`);
