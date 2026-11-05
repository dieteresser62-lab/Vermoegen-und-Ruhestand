// Synthetische Haushalte, sequenzielle 2.000-Pfad-Läufe und vollständige Ergebnisbytes.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output, previousFile] = process.argv.slice(2);
const from = path => import(pathToFileURL(resolve(root, path)).href);
const { measurementInputs, backtest, parameters } = await from('tests/helpers/ek-1b-measurement.mjs');
const { runMonteCarloChunk } = await from('app/simulator/monte-carlo-runner.js');
const { EngineAPI } = await from('engine/index.mjs');
const { quantile } = await from('app/simulator/simulator-utils.js');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const result = { parameters, household: 'Helga und Werner, synthetisch, 3 Töpfe', cases: {} };
const previous = previousFile ? JSON.parse(readFileSync(previousFile)) : null;
for (const name of ['without', 'auto', 'surplus']) {
    const inputs = await measurementInputs(0, 'helga-werner');
    if (name === 'auto') Object.assign(inputs, { plannedExpensesReferenceYear: 2026,
        plannedExpenses: [{ id: 'auto', monat: '2028-04', betrag: 35000, bezeichnung: 'Auto' }] });
    if (name === 'surplus') Object.assign(inputs, { dynamicFlex: true, fixedIncomeReferenceYear: 2026,
        fixedIncome: [{ id: 'gehalt', profileId: inputs.simulationPeople[0].profileId, art: 'sonstige', bezeichnung: 'Gehalt',
            betragMonat: 4000, ab: null, bis: '2030-12', anpassung: 'keine' }] });
    const real = [], hashes = [], saleHashes = [];
    let failed = 0, technicalErrors = 0;
    for (let start = 0; start < 2000; start += 100) {
        const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: parameters, widowOptions: inputs.widowOptions,
            useCapeSampling: false, runRange: { start, count: 100 }, logIndices: Array.from({length:100}, (_, i) => start+i), engine: EngineAPI });
        hashes.push(hash(chunk)); real.push(...chunk.pathSummaries.finalValueRealEur);
        failed += chunk.totals.failCount; technicalErrors += chunk.technicalInventory.technicalError;
        saleHashes.push(...chunk.runMeta.map(run => hash(run.logDataRows.map(row => [row.jahr, row.eq_after_sales, row.gold_after_sales, row.steuern_gesamt, row.threeBucket?.bondSaleAmount]))));
        console.log(`${name}: ${start + 100}/2000`);
    }
    const historical = backtest(inputs);
    const bear = historical.rows[2];
    result.cases[name] = { inputsHash: hash(inputs), monteCarloHash: hash(hashes), chunkHashes: hashes,
        backtestHash: hash(historical), technicalErrors, successPct: (2000-failed-technicalErrors)/(2000-technicalErrors)*100,
        terminalRealP10: quantile(real,.1), terminalRealP50: quantile(real,.5), saleHashes,
        bearYear: { historicalYear: bear?.jahr, row: bear?.row },
        changedSalePaths: previous ? saleHashes.filter((value,i) => value !== previous.cases[name].saleHashes[i]).length : null,
        byteEqual: previous ? hashes.every((value,i) => value === previous.cases[name].chunkHashes[i]) : null };
    writeFileSync(output, JSON.stringify(result, null, 2)+'\n');
    console.log(JSON.stringify({ name, ...result.cases[name], chunkHashes:undefined, saleHashes:undefined, bearYear:undefined }));
}
