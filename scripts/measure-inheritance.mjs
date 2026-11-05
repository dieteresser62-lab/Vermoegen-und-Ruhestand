/** EP-1: synthetische Max-/Erika-Pfade, zwei getrennte Quellstände. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output, countArg = '2000'] = process.argv.slice(2);
const load = file => import(pathToFileURL(resolve(root, file)));
const { measurementInputs, parameters, backtest } = await load('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await load('engine/index.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const quantile = (data, p) => { const sorted = data.slice().sort((a,b) => a-b), x = (sorted.length-1)*p;
    return sorted[Math.floor(x)] + (sorted[Math.ceil(x)]-sorted[Math.floor(x)])*(x%1); };
const result = { parameters: { ...parameters, anzahl: Number(countArg) }, variants: {} };
for (const [variant, status, percent] of [['married100','married',100],['married50','married',50],['unmarried0','unmarried',0],['unmarried100','unmarried',100]]) {
    const inputs = await measurementInputs(0, 'max-erika');
    inputs.partnership = { schemaVersion: 1, status, inheritance: Object.fromEntries(inputs.simulationPeople.map(p => [p.profileId, status === 'unmarried' ? percent : 0])),
        ...(status === 'married' ? { marriedInheritance: Object.fromEntries(inputs.simulationPeople.map(p => [p.profileId, percent])) } : {}) };
    const end = [], taxes = [], leaves = [], paths = [], digest = createHash('sha256');
    let failed = 0, aboveSixMillion = 0;
    for (let start = 0; start < result.parameters.anzahl; start += 50) {
        const count = Math.min(50, result.parameters.anzahl-start);
        const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: result.parameters,
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count },
            logIndices: Array.from({length: count}, (_,i) => start+i), engine: EngineAPI });
        if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw Error(JSON.stringify(chunk.technicalInventory));
        digest.update(JSON.stringify(chunk));
        failed += chunk.totals.failCount; end.push(...chunk.pathSummaries.finalValueRealEur);
        for (const run of chunk.runMeta) {
            const rows = run.logDataRows || [];
            taxes.push(rows.reduce((sum,row) => sum+(row.erbschaftsteuer||0),0));
            leaves.push(rows.reduce((sum,row) => sum+(row.abgang_erben||0),0));
            if (rows.some(row => row.inheritance && row.inheritance.inherited+row.inheritance.inheritedHome-20000 > 6000000)) aboveSixMillion++;
            // Die Protokollkorrektur darf nur liqEnd ändern. Alle übrigen Bytes bleiben im Hash.
            paths.push(hash({...run, logDataRows: rows.map(({liqEnd,...row}) => row)}));
        }
        if ((start+count)%250===0) console.log(`${variant}: ${start+count}/${result.parameters.anzahl}`);
    }
    result.variants[variant] = { successPct:100*(result.parameters.anzahl-failed)/result.parameters.anzahl,
        realP50:quantile(end,.5), realP10:quantile(end,.1), medianInheritanceTax:quantile(taxes,.5), medianLeaves:quantile(leaves,.5),
        aboveSixMillion, completeOutputSha256:digest.digest('hex'), pathsWithoutLiqEnd:paths, backtestSha256:hash(backtest(inputs)) };
}
writeFileSync(output, JSON.stringify(result,null,2)+'\n');
console.log(`EP-1: ${result.parameters.anzahl} Pfade je Variante abgeschlossen.`);
