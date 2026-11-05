// Synthetische App-Muster; Messung außerhalb der Standardsuite.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output, revision, pathsArg = '2000'] = process.argv.slice(2);
if (!root || !output || !revision) throw new Error('Aufruf: node tests/helpers/an-1b-measurement.mjs <Quellordner> <Ausgabe.json> <Stand> [Pfade]');
const from = file => import(pathToFileURL(resolve(root, file)).href);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quantile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * p;
    return sorted.length ? sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1) : null;
};
const parameters = { anzahl: Number(pathsArg), maxDauer: 42, blockSize: 3, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const { measurementInputs } = await from('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await from('engine/index.mjs');
const { runMonteCarloChunk } = await from('app/simulator/monte-carlo-runner.js');
const result = { revision, parameters,
    basis: 'App-Muster am 2026-10-16; reale Endvermögensquantile; mittlere nominale Pfadsumme der Steuern.',
    counting: 'Jahreszeile mit ausgeführtem Runway-Überschusskauf und positiver Liquiditätsdeckung in after_forced_sales, abzüglich personalPayoutCoverage; zusätzlich sämtliche Verkäufe im Kaufjahr.',
    scenarios: {} };
for (const id of ['max-erika', 'sophie']) {
    const defaults = await measurementInputs(0, id);
    for (const setting of ['default', 'one-year']) {
        const inputs = structuredClone(defaults);
        if (setting === 'one-year') inputs.liquidityRunwayYears = 1;
        const real = [], taxes = [], chunkHashes = [], examples = [];
        let failed = 0, technical = 0, financialYears = 0, surplusBuyYears = 0;
        let forcedSaleAfterBuyYears = 0, forcedSaleAfterBuyPaths = 0, anySaleAfterBuyYears = 0, maxAbsFlowDelta = 0;
        for (let start = 0; start < parameters.anzahl; start += 50) {
            const count = Math.min(50, parameters.anzahl - start);
            const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: parameters,
                widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count },
                logIndices: Array.from({ length: count }, (_, i) => start + i) });
            assert.equal(chunk.financialMetricsValid, true);
            real.push(...chunk.pathSummaries.finalValueRealEur);
            failed += chunk.totals.failCount;
            technical += chunk.technicalInventory.technicalError;
            chunkHashes.push(hash(chunk));
            for (const run of chunk.runMeta) {
                let tax = 0, affected = false;
                for (const row of run.logDataRows) {
                    if (row.financiallyEvaluable !== true) continue;
                    financialYears++;
                    tax += row.steuern_gesamt || 0;
                    maxAbsFlowDelta = Math.max(maxAbsFlowDelta, Math.abs(row.portfolio_flow_delta || 0));
                    if (!String(row.aktionUndGrund).includes('Runway-Überschuss investieren') || !(row.kaufAkt > 0 || row.kaufGld > 0)) continue;
                    surplusBuyYears++;
                    const trace = row.balance_trace?.find(entry => entry.phase === 'after_forced_sales');
                    const raised = (trace?.liquiditaetDelta || 0) - (trace?.personalPayoutCoverage || 0);
                    if (raised > 1e-6) {
                        forcedSaleAfterBuyYears++; affected = true;
                        if (examples.length < 3) examples.push({ year: row.jahr, forcedFunding: raised,
                            forcedShortfall: trace.forcedShortfall, equityBuy: row.kaufAkt, goldBuy: row.kaufGld });
                    }
                    if ((row.vk?.vkAkt || 0) + (row.vk?.vkGld || 0) + (row.vk?.vkBnd || 0) > 1e-6) anySaleAfterBuyYears++;
                }
                if (affected) forcedSaleAfterBuyPaths++;
                taxes.push(tax);
            }
            if ((start + count) % 500 === 0 || start + count === parameters.anzahl) console.log(`${revision}/${id}/${setting}: ${start + count}/${parameters.anzahl}`);
        }
        assert.equal(technical, 0);
        result.scenarios[`${id}/${setting}`] = { liquidityRunwayYears: inputs.liquidityRunwayYears,
            inputsHash: hash(inputs), chunksHash: hash(chunkHashes), technicalErrors: technical,
            successPct: (parameters.anzahl - technical - failed) / (parameters.anzahl - technical) * 100,
            finalRealP10: quantile(real, .1), finalRealP50: quantile(real, .5),
            taxesNominalMean: taxes.reduce((sum, value) => sum + value, 0) / parameters.anzahl,
            financialYears, surplusBuyYears, forcedSaleAfterBuyYears, forcedSaleAfterBuyPaths,
            anySaleAfterBuyYears, maxAbsFlowDelta, examples };
        writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify({ scenario: `${id}/${setting}`, ...result.scenarios[`${id}/${setting}`] }));
    }
}
