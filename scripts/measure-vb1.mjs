/** VB-1: Versorgungsfreibetrag (§ 17 ErbStG), Messung alt gegen neu auf denselben Pfaden; nur synthetische Musterhaushalte.
 * Messen:    node scripts/measure-vb1.mjs <Quellordner> <Ausgabe.json> [Pfade]
 * Vergleich: node scripts/measure-vb1.mjs --compare <vorher.json> <nachher.json>
 * Je Fall 2.000 Pfade, Seed 12345, Testdatum 23.10.2026. Der Pfadabdruck (Marktjahre, Inflation, Leben, Pflege) belegt,
 * dass alt und neu dieselben Pfade rechnen. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const CASES = [['max-erika', 'grund'], ['jan-lena', 'grund'], ['helga-werner', 'grund'], ['martin-petra', 'ehe'], ['martin-petra', 'grund']];
const quantile = (values, q) => {
    const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * q, low = Math.floor(position);
    return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (position - low);
};
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

if (process.argv[2] === '--compare') {
    const [before, after] = process.argv.slice(3, 5).map(file => JSON.parse(readFileSync(file, 'utf8')));
    const rows = [];
    for (const key of Object.keys(before.cases)) {
        const old = before.cases[key], next = after.cases[key];
        const samePaths = old.runs.every((run, index) => run.path === next.runs[index].path);
        const deaths = old.runs.map((run, index) => [run, next.runs[index]]).filter(([run]) => run.deathTax !== null);
        rows.push({ key, samePaths, deathPaths: deaths.length,
            taxChanged: deaths.filter(([run, other]) => Math.abs(run.deathTax - other.deathTax) > .005).length,
            taxMean: [mean(deaths.map(([run]) => run.deathTax)), mean(deaths.map(([, run]) => run.deathTax))],
            p10: [old.p10, next.p10], p50: [old.p50, next.p50], coveredPct: [old.coveredPct, next.coveredPct],
            identical: JSON.stringify(old) === JSON.stringify(next) });
    }
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
}

const [root, output, countArg = '2000'] = process.argv.slice(2);
const load = file => import(pathToFileURL(resolve(root, file)));
const { measurementInputs, parameters } = await load('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await load('engine/index.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const count = Number(countArg), date = '2026-10-23';
const result = { date, parameters: { ...parameters, anzahl: count }, cases: {} };
for (const [id, variant] of CASES) {
    const inputs = await measurementInputs(0, id, date, variant);
    const runs = [], real = [];
    let failed = 0, technical = 0;
    for (let start = 0; start < count; start += 50) {
        const size = Math.min(50, count - start);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: result.parameters,
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: size },
            logIndices: Array.from({ length: size }, (_, index) => start + index) });
        if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw Error('Ungültiger Messlauf');
        failed += chunk.totals.failCount; technical += chunk.technicalInventory.technicalError;
        chunk.runMeta.forEach((run, index) => {
            const rows = run.logDataRows || [], death = rows.find(row => row.inheritance);
            const finalReal = chunk.pathSummaries.finalValueRealEur[index];
            real.push(finalReal);
            runs.push({ path: createHash('sha256').update(JSON.stringify(rows.map(row => [row.jahr, row.histJahr, row.inflation,
                row.Person1Alive, row.Person2Alive, row.CareP1_Active, row.CareP2_Active]))).digest('hex').slice(0, 16),
            deathTax: death ? death.erbschaftsteuer || 0 : null, finalReal });
        });
    }
    const deaths = runs.filter(run => run.deathTax !== null);
    result.cases[`${id}/${variant}`] = { status: inputs.partnership?.status ?? 'married (ohne Eintrag)', deathPaths: deaths.length,
        taxMean: mean(deaths.map(run => run.deathTax)), p10: quantile(real, .1), p50: quantile(real, .5),
        coveredPct: 100 * (count - technical - failed) / (count - technical), technical, runs };
    const { runs: _runs, ...summary } = result.cases[`${id}/${variant}`];
    console.log(`${id}/${variant}`, JSON.stringify(summary));
}
writeFileSync(output, JSON.stringify(result) + '\n');
