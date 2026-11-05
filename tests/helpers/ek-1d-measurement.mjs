// Zwei getrennte Quellstände; vollständige Ergebnisse, keine Feldfilter oder Nutzerdaten.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceRoot, output] = process.argv.slice(2);
if (!sourceRoot || !output) throw new Error('Aufruf: node tests/helpers/ek-1d-measurement.mjs <Quellordner> <Ausgabe.json>');
const from = path => import(pathToFileURL(resolve(sourceRoot, path)).href);
const { measurementInputs, backtest, parameters } = await from('tests/helpers/ek-1b-measurement.mjs');
const { MUSTER_HAUSHALTE } = await from('app/demo/muster-haushalte.js');
const { runMonteCarloChunk } = await from('app/simulator/monte-carlo-runner.js');
const { EngineAPI } = await from('engine/index.mjs');
const { quantile } = await from('app/simulator/simulator-utils.js');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const results = { parameters, useCapeSampling: false, households: [] };
async function monteCarlo(inputs, widowOptions = inputs.widowOptions) {
    const chunkHashes = [], real = [];
    let technicalErrors = 0, failed = 0;
    for (let start = 0; start < parameters.anzahl; start += 100) {
        const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: parameters,
            widowOptions, useCapeSampling: false,
            runRange: { start, count: 100 }, engine: EngineAPI });
        chunkHashes.push(hash(chunk));
        real.push(...chunk.pathSummaries.finalValueRealEur);
        technicalErrors += chunk.technicalInventory.technicalError;
        failed += chunk.totals.failCount;
    }
    if (technicalErrors) throw new Error(`${technicalErrors} technische Fehler`);
    return { monteCarloHash: hash(chunkHashes), chunkHashes, technicalErrors,
        successPct: (parameters.anzahl - failed) / parameters.anzahl * 100,
        terminalRealP50: quantile(real, .5) };
}
for (const household of MUSTER_HAUSHALTE) {
    const inputs = await measurementInputs(0, household.id);
    const historical = backtest(inputs);
    results.households.push({ id: household.id, inputsHash: hash(inputs), backtestHash: hash(historical),
        ...await monteCarlo(inputs) });
    writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify({ ...results.households.at(-1), chunkHashes: undefined }));
}
// Eigene positive Renten unter dem Grundbedarf, Pflege ausgeschaltet.
const control = await measurementInputs();
const inputs = { ...control, renteMonatlich: 500, rentAdjMode: 'fix', rentAdjPct: 0,
    partner: { ...control.partner, monatsrente: 500, brutto: 6000 },
    pflegefallLogikAktivieren: false };
const historical = backtest(inputs);
results.withoutSurplus = { description: 'Max/Erika, je 500 EUR Monatsrente, feste Anpassung 0, Pflege aus',
    inputsHash: hash(inputs), backtestHash: hash(historical),
    ...await monteCarlo(inputs, { ...inputs.widowOptions, enabled: false }) };
console.log(JSON.stringify({ ...results.withoutSurplus, chunkHashes: undefined }));
writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
