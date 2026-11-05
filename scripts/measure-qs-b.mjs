// QS-B: ausschließlich synthetische Muster, identischer Seed vor und nach der Korrektur.
// node scripts/measure-qs-b.mjs <Quellordner> <Ausgabe.json> [Läufe=2000]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const [source, output, countArg = '2000'] = process.argv.slice(2);
const load = file => import(pathToFileURL(resolve(source, file)));
const { measurementInputs, parameters, hash } = await load('tests/helpers/ek-1b-measurement.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { EngineAPI } = await load('engine/index.mjs');
const count = Number(countArg), results = {};
for (const [name, id, variant] of [['pflege', 'helga-werner', 'haus-pg3'],
    ['todesfall', 'max-erika', 'grund'], ['unverheiratet', 'martin-petra', 'grund']]) {
    const inputs = await measurementInputs(0, id, '2026-10-23', variant);
    let ruin = 0, technical = 0, end = 0, care = 0, deaths = 0;
    const chunks = [];
    for (let start = 0; start < count; start += 100) {
        const size = Math.min(100, count - start);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI,
            monteCarloParams: { ...parameters, anzahl: count }, widowOptions: inputs.widowOptions,
            useCapeSampling: false, runRange: { start, count: size },
            logIndices: Array.from({ length: size }, (_, index) => start + index) });
        chunks.push(hash(chunk));
        ruin += chunk.totals.failCount; technical += chunk.technicalInventory.technicalError;
        end += Array.from(chunk.pathSummaries.finalValueRealEur).reduce((sum, value) => sum + value, 0);
        for (const run of chunk.runMeta) {
            care += run.totalCareAdditionalNeedRealEur;
            deaths += run.logDataRows.filter(row => row.SurvivorDeathYear).length;
        }
        if ((start + size) % 500 === 0) console.log(`${name}: ${start + size}/${count}`);
    }
    results[name] = { id, variant, inputHash: hash(inputs), chunks, technical,
        coveredPct: 100 * (count - technical - ruin) / (count - technical), ruin,
        meanEndRealEur: end / (count - technical), meanCareCostRealEur: care / (count - technical), deaths };
}
const report = { testDate: '2026-10-23', parameters: { ...parameters, anzahl: count },
    basis: 'Geldvermögen am Laufende und zusätzliche Pflegekosten in Startkaufkraft; Mittel über alle auswertbaren Pfade, Ruin-Endvermögen 0.', results };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(results, (key, value) => key === 'chunks' ? undefined : value));
