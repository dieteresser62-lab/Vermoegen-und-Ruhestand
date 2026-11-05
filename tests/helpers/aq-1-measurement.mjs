// Synthetischer GA-1a-Haushalt; feste Seeds, sequenzielle Läufe, vollständige Ergebnisbytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output, previousFile] = process.argv.slice(2);
const from = path => import(pathToFileURL(resolve(root, path)).href);
const { measurementInputs, backtest, parameters, hash } = await from('tests/helpers/ek-1b-measurement.mjs');
const { runMonteCarloChunk } = await from('app/simulator/monte-carlo-runner.js');
const { EngineAPI } = await from('engine/index.mjs');
const { quantile } = await from('app/simulator/simulator-utils.js');
const before = previousFile ? JSON.parse(readFileSync(previousFile, 'utf8')) : null;
const result = { household: 'Max und Erika Mustermann, synthetisch, wie GA-1a', parameters, cases: {} };
for (const name of ['without', 'auto']) {
    const inputs = await measurementInputs();
    if (name === 'auto') Object.assign(inputs, { plannedExpensesReferenceYear: 2026,
        plannedExpenses: [{ id: 'auto', monat: '2028-04', betrag: 35000, bezeichnung: 'Auto' }] });
    const real = [], chunks = [];
    let failed = 0, technicalErrors = 0, totalTaxesNominal = 0;
    for (let start = 0; start < parameters.anzahl; start += 100) {
        const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: parameters, widowOptions: inputs.widowOptions,
            useCapeSampling: false, runRange: { start, count: 100 },
            logIndices: Array.from({ length: 100 }, (_, i) => start + i), engine: EngineAPI });
        chunks.push(hash(chunk));
        real.push(...chunk.pathSummaries.finalValueRealEur);
        failed += chunk.totals.failCount;
        technicalErrors += chunk.technicalInventory.technicalError;
        for (const run of chunk.runMeta) for (const row of run.logDataRows) totalTaxesNominal += row.steuern_gesamt || 0;
        console.log(`${name}: ${start + 100}/${parameters.anzahl}`);
    }
    const historical = backtest(inputs);
    const measured = { inputsHash: hash(inputs), monteCarloHash: hash(chunks), chunkHashes: chunks,
        backtestHash: hash(historical), technicalErrors,
        successPct: (parameters.anzahl - technicalErrors - failed) / (parameters.anzahl - technicalErrors) * 100,
        terminalRealP50: quantile(real, .5), totalTaxesNominal,
        meanTaxesNominal: totalTaxesNominal / (parameters.anzahl - technicalErrors) };
    if (name === 'without' && before) for (const key of ['inputsHash', 'monteCarloHash', 'backtestHash']) {
        if (before.cases.without[key] !== measured[key]) throw new Error(`Ohne Ausgaben verändert: ${key}`);
    }
    result.cases[name] = measured;
    writeFileSync(output, JSON.stringify({ ...result, ...(before ? { before } : {}) }, null, 2) + '\n');
    console.log(JSON.stringify({ name, ...measured, chunkHashes: undefined }));
}
