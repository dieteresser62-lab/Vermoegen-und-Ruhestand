// node tests/extended/ff-f-measurement.mjs <Repositoryexport> <Ausgabe.json> [Laufzahl]
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fffHousehold, fffYearSevenHousehold, fffHistory, fffMonteCarloParameters, fffDynamicEngineSamples } from '../helpers/ff-f-scenarios.mjs';
import { unchangedFFD } from '../helpers/ff-d-scenarios.mjs';

const root = resolve(process.argv[2] || '.');
const get = path => import(pathToFileURL(`${root}/${path}`));
const { EngineAPI: engine } = await get('engine/index.mjs');
const { initMcRunState, simulateOneYear } = await get('app/simulator/simulator-engine-wrapper.js');
const { annualData } = await get('app/simulator/simulator-data.js');
const { computeRentAdjRate } = await get('app/simulator/simulator-portfolio-pension.js');
const { runMonteCarloChunk } = await get('app/simulator/monte-carlo-runner.js');
const api = { engine, initMcRunState, simulateOneYear, annualData, computeRentAdjRate };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parameters = { ...fffMonteCarloParameters, anzahl: Number(process.argv[4] || 2000) };
const start = performance.now();
const mc = await runMonteCarloChunk({ inputs: fffHousehold(), monteCarloParams: parameters,
    widowOptions: { mode: 'none', percent: 0 }, useCapeSampling: false, engine });
if (mc.technicalInventory.technicalError) throw new Error(JSON.stringify(mc.technicalInventory));
const unchanged = unchangedFFD(api), dynamic = fffDynamicEngineSamples(engine);
const result = { schemaVersion: 1, input: fffHousehold(), parameters, useCapeSampling: false,
    monteCarlo: { ruins: mc.totals.outcomeRuinCount, technicalErrors: mc.technicalInventory.technicalError,
        evaluable: mc.technicalInventory.financiallyEvaluable, elapsedMs: performance.now() - start },
    history: fffHistory(api).map((year, i) => ({ year: i + 1, kind: year.kind, reason: year.reason,
        liquidity: year.logData?.liquiditaet, target: year.ui?.zielLiquiditaet,
        payout: year.logData?.entnahme_effektiv, action: year.logData?.aktionUndGrund })),
    yearSevenHistory: fffHistory(api, fffYearSevenHousehold()).map((year, i) => ({ year: i + 1, kind: year.kind,
        reason: year.reason, ruinDetails: year.ruinDetails, liquidity: year.logData?.liquiditaet,
        target: year.ui?.zielLiquiditaet, payout: year.logData?.entnahme_effektiv, action: year.logData?.aktionUndGrund })),
    unchanged: Object.fromEntries(Object.entries(unchanged).map(([key, rows]) => [key, hash(rows)])),
    dynamic: Object.fromEntries(['input', 'newState', 'action'].map(key => [key,
        hash(dynamic.map(row => key === 'action' ? row.ui.action : row[key]))])) };
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.monteCarlo));
