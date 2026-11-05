// PA-1: ausschließlich synthetische Muster, vollständige Lebenspfade einschließlich Schattenjahren.
import { writeFileSync } from 'node:fs';
import { measurementInputs, backtest, hash } from '../tests/helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { createStressReplayCaptureRequest } from '../app/simulator/stress-replay-path-materializer.js';
import { careAllowanceAnnual, careFormForPerson } from '../app/shared/care-benefits.js';
import { EngineAPI } from '../engine/index.mjs';

const parameters = { anzahl: 2000, maxDauer: 35, blockSize: 5, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const result = { date: '2026-10-23', parameters, cases: {} };
for (const name of ['grund', 'haus-pg3', 'paar-pg2', 'haus-pg3-4-4']) {
    const inputs = await measurementInputs(0, 'helga-werner', result.date, name === 'grund' || name === 'paar-pg2' ? 'grund' : 'haus-pg3');
    if (name === 'paar-pg2') inputs.partner.careToday = { grade: 2, form: 'family', progression: 'usual' };
    if (name === 'haus-pg3-4-4') {
        inputs.careToday = { ...inputs.careToday, grade: 4 };
        inputs.partner.careToday = { ...inputs.partner.careToday, grade: 4 };
        inputs.pflegeGradeConfigs[4].careForm = 'residential';
    }
    let fail = 0, ruin = 0, technical = 0, cost = 0, allowance = 0, switchedPersonYears = 0, emergencySales = 0;
    const chunks = [];
    for (let start = 0; start < parameters.anzahl; start += 100) {
        const indices = Array.from({ length: 100 }, (_, i) => start + i);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: parameters,
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: 100 },
            logIndices: indices, stressReplayCapture: createStressReplayCaptureRequest(indices) });
        chunks.push(hash(chunk));
        fail += chunk.totals.failCount; ruin += chunk.totals.outcomeRuinCount;
        technical += chunk.technicalInventory?.technicalError || 0;
        for (const run of chunk.runMeta) {
            emergencySales += run.logDataRows.filter(row => row.immobilien_notverkauf).length;
            let inflation = 1;
            for (const year of run.stressReplayCapture.years) {
                const event = year.householdEvents[0];
                for (const index of [0, 1]) {
                    const n = index + 1, care = event?.[`careMetaP${n}`];
                    if (!care?.active) continue;
                    const weight = event[`p${n}Alive`] ? 1 : .5;
                    cost += care.zusatzFloorZiel * weight / inflation;
                    allowance += careAllowanceAnnual({ grade: care.grade, preset: inputs.pflegeKostenStaffelPreset,
                        careForm: careFormForPerson(inputs, care.grade, index, { care: { p1: event.careMetaP1, p2: event.careMetaP2 },
                            p1Alive: event.p1Alive, p2Alive: event.p2Alive }), lifeFactor: weight, careValues: inputs.careValues });
                    if (care.familyCareFallback && care.grade <= 3) switchedPersonYears += weight;
                }
                inflation *= 1 + year.inflationPct / 100;
            }
        }
        if ((start + 100) % 500 === 0) console.log(`${name}: ${start + 100}/2000`);
    }
    result.cases[name] = { inputsHash: hash(inputs), chunks, coveredPct: 100 * (parameters.anzahl - technical - fail) / (parameters.anzahl - technical),
        ruin, technical, meanCareCostReal: cost / parameters.anzahl, meanCareAllowanceReal: allowance / parameters.anzahl,
        switchedPersonYears, emergencySales,
        counterchecks: [[2000, 2025], [1965, 1999]].map(([start, end]) => { const run = backtest(inputs, start, end);
            return { period: `${start}-${end}`, hash: hash(run), outcome: run.outcome.kind }; }) };
    writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ name, ...result.cases[name], chunks: undefined }));
}
