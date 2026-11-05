/** Synthetische MU-2-Plausibilitätsmessung über denselben Seitenweg wie der Simulator. */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { measurementInputs, parameters } from '../tests/helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../engine/index.mjs';
import { quantile } from '../app/simulator/simulator-utils.js';
const testDate = '2026-10-23';
const cases = [['martin-petra', 'grund'], ['martin-petra', 'hundert'], ['martin-petra', 'ehe'],
    ['renate', 'klein'], ['jan-lena', 'halten'], ['helga-werner', 'haus-pg3'], ['sophie', 'teilzeit']];
const measurements = [];
for (const [householdId, variantId] of cases) {
    const inputs = await measurementInputs(0, householdId, testDate, variantId);
    const end = [], taxes = [], taxCash = [], digest = createHash('sha256');
    let ruin = 0, emergencySales = 0, careSales = 0, covered = 0;
    for (let start = 0; start < parameters.anzahl; start += 100) {
        const count = Math.min(100, parameters.anzahl - start);
        const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: parameters,
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count },
            logIndices: Array.from({ length: count }, (_, i) => start + i), engine: EngineAPI });
        if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw Error(JSON.stringify(chunk.technicalInventory));
        digest.update(JSON.stringify(chunk));
        ruin += chunk.totals.outcomeRuinCount;
        covered += count - chunk.totals.outcomeRuinCount;
        end.push(...chunk.pathSummaries.finalValueRealEur);
        for (const run of chunk.runMeta) {
            const rows = run.logDataRows || [];
            emergencySales += rows.some(row => row.immobilien_notverkauf === true) ? 1 : 0;
            careSales += rows.some(row => row.immobilienverkauf > 0 && !row.immobilien_notverkauf) ? 1 : 0;
            taxes.push(rows.reduce((sum, row) => sum + (row.erbschaftsteuer || 0), 0));
            taxCash.push(rows.reduce((sum, row) => sum + (row.inheritance?.taxCash || 0), 0));
        }
        console.log(`${householdId}/${variantId}: ${start + count}/${parameters.anzahl}`);
    }
    measurements.push({ householdId, variantId, coveredPct: covered / parameters.anzahl * 100, ruin, emergencySales, careSales,
        medianInheritanceTax: quantile(taxes, .5), medianTaxCashGross: quantile(taxCash, .5),
        medianEndWealthReal: quantile(end, .5), completeOutputSha256: digest.digest('hex') });
}
writeFileSync(process.argv[2] || '/tmp/mu-2-measurement.json', JSON.stringify({ testDate, parameters,
    note: 'Steuer und Steuergeld: Median der nominalen Pfadsummen über alle Läufe, einschließlich Null. Endvermögen ist Geldvermögen nach Simulatorvertrag.', measurements }, null, 2) + '\n');
console.log(JSON.stringify(measurements));
