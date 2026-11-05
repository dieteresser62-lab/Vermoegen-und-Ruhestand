// Synthetische VG-1-Zeitmessung; keine Profilwrites außerhalb des Memory-Adapters.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output] = process.argv.slice(2);
if (!root || !output) throw new Error('Aufruf: node scripts/measure-decision-comparison.mjs <Quellordner> <Ausgabe.json>');
const load = file => import(pathToFileURL(resolve(root, file)));
const { measurementInputs, parameters } = await load('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await load('engine/index.mjs');
const { runDecisionComparison } = await load('app/simulator/decision-comparison.js');
const inputs = await measurementInputs(0, 'max-erika');
const change = { kind: 'budget', monthly: 300 };
const start = performance.now();
const result = await runDecisionComparison({ inputs, monteCarloParams: parameters, change,
    useCapeSampling: false, engine: EngineAPI });
const measurement = { household: 'Max und Erika Mustermann', synthetic: true,
    parameters, useCapeSampling: false, change, elapsedMs: performance.now() - start,
    baseline: result.baseline.metrics, variant: result.variant.metrics,
    differences: result.differences, worsePct: result.worsePct };
writeFileSync(output, JSON.stringify(measurement, null, 2) + '\n');
console.log(`VG-1: ${parameters.anzahl} Läufe je Plan · ${(measurement.elapsedMs / 1000).toFixed(2)} Sekunden · ${parameters.maxDauer} Jahre · Seed ${parameters.seed}`);
