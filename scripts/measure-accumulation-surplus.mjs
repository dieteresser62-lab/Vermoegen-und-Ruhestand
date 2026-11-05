// AS-1: synthetische App-Muster, feste Seeds und vollständige Ergebnisprüfsummen.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output, selection = 'sophie,max-erika,renate,helga-werner,gross', countArg = '2000', engineRoot = root] = process.argv.slice(2);
if (!root || !output) throw new Error('Aufruf: node scripts/measure-accumulation-surplus.mjs <Quellordner> <Ausgabe.json> [Haushalte] [Pfade] [Engineordner]');
const from = file => import(pathToFileURL(resolve(root, file)).href);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { measurementInputs, backtest, parameters } = await from('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await import(pathToFileURL(resolve(engineRoot, 'engine/index.mjs')).href);
const { runMonteCarloChunk } = await from('app/simulator/monte-carlo-runner.js');
const { runParityScenarios } = await from('tests/extended/parity-scenarios.mjs');
const { source, runFixture } = await from('tests/extended/parity-replay-fixture.mjs');
const historicalBacktest = engineRoot === root ? backtest : (inputs, startYear = 2000, endYear = 2025) =>
    runFixture({ input: inputs, selectedPeriod: { startYear, endYear }, engine: EngineAPI });
const { createMusterHaushaltRecords } = await from('app/demo/muster-haushalt.js');
const { buildBalanceEngineInputFromStorage } = await from('app/balance/balance-input-storage.js');
const { quantile } = await from('app/simulator/simulator-utils.js');
const params = { ...parameters, anzahl: Number(countArg) };
const result = { synthetic: true, parameters: params, useCapeSampling: false,
    basis: 'App-Muster 16.10.2026; Groß wie EP-2: 3 Mio. EUR Geld 90/10, Haus 800000 EUR bei Max, Erika PG2 üblich. Endvermögen real, Käufe und Liquidität nominal. Medianpfad: unterer mittlerer Endvermögensrang, Laufnummer als Gleichstandsregel.',
    households: {} };
for (const id of selection.split(',')) {
    const inputs = await measurementInputs(0, id === 'gross' ? 'max-erika' : id);
    if (id === 'gross') {
        inputs.home = [{ id: 'haus', profileId: 'muster_a', bezeichnung: 'Haus', nutzung: 'selbst',
            wert: 800000, stand: '2026-10', mieteNetto: 0, anpassung: 'keine' }];
        inputs.homeReferenceYear = 2026;
        for (const [personId, target] of [['muster_a', 2700000], ['muster_b', 300000]]) {
            const person = inputs.simulationPeople.find(row => row.profileId === personId);
            const lots = inputs.detailledTranches.filter(lot => lot.sourceProfileId === personId);
            const factor = target / (person.tagesgeld + lots.reduce((sum, lot) => sum + lot.marketValue, 0));
            person.tagesgeld *= factor;
            for (const lot of lots) { lot.marketValue *= factor; lot.costBasis *= factor; lot.shares *= factor; }
        }
        inputs.startVermoegen = 3000000;
        inputs.tagesgeld = inputs.simulationPeople.reduce((sum, person) => sum + person.tagesgeld, 0);
        inputs.geldmarktEtf = inputs.detailledTranches.filter(lot => lot.category === 'money_market').reduce((sum, lot) => sum + lot.marketValue, 0);
        inputs.depotwertAlt = 3000000 - inputs.tagesgeld - inputs.geldmarktEtf;
        inputs.einstandAlt = inputs.detailledTranches.filter(lot => lot.category === 'equity').reduce((sum, lot) => sum + lot.costBasis, 0);
        inputs.partner.careToday = { grade: 2, progression: 'usual' };
    }
    const values = [], paths = [], chunks = [], prefixes = [];
    let fail = 0, technical = 0, savingsYears = 0, maxAbsFlowDelta = 0;
    for (let start = 0; start < params.anzahl; start += 100) {
        const count = Math.min(100, params.anzahl - start);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: params,
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count },
            logIndices: Array.from({ length: count }, (_, index) => start + index) });
        if (!chunk.financialMetricsValid) throw new Error(JSON.stringify(chunk.technicalInventory));
        fail += chunk.totals.failCount; technical += chunk.technicalInventory.technicalError;
        chunks.push(hash(chunk));
        values.push(...chunk.pathSummaries.finalValueRealEur);
        chunk.runMeta.forEach((run, index) => {
            const saving = run.logDataRows.filter(row => row.einkuenfte_gespart > 0);
            const firstSaving = run.logDataRows.findIndex(row => row.einkuenfte_gespart > 0);
            const prefix = firstSaving < 0 ? run.logDataRows : run.logDataRows.slice(0, firstSaving);
            prefixes.push({ run: start + index, years: prefix.length, sha256: hash(prefix) });
            const salaryYears = id === 'sophie' ? run.logDataRows.filter(row => row.jahr <= 12) : [];
            savingsYears += saving.length;
            for (const row of run.logDataRows) maxAbsFlowDelta = Math.max(maxAbsFlowDelta, Math.abs(row.portfolio_flow_delta || 0));
            paths.push({ run: start + index, real: chunk.pathSummaries.finalValueRealEur[index],
                equityPurchases: saving.reduce((sum, row) => sum + (row.kaufAkt || 0), 0),
                lastSavingYear: saving.at(-1)?.jahr ?? null, lastSavingLiquidity: saving.at(-1)?.liquiditaet ?? null,
                ...(id === 'sophie' ? { salaryEquityPurchases: salaryYears.reduce((sum, row) => sum + (row.kaufAkt || 0), 0),
                    salaryEndLiquidity: salaryYears.find(row => row.jahr === 12)?.liquiditaet ?? null } : {}) });
        });
        if ((start + count) % 500 === 0) console.log(`${id}: ${start + count}/${params.anzahl}`);
    }
    if (technical || maxAbsFlowDelta > 1e-6) throw new Error(`${id}: technische Fehler ${technical}, FlowDelta ${maxAbsFlowDelta}`);
    const sorted = [...paths].sort((a, b) => a.real - b.real || a.run - b.run);
    const historical = historicalBacktest(inputs), countercheck = historicalBacktest(inputs, 1929, 1970);
    if (historical.outcome.kind !== 'completed' || countercheck.outcome.kind !== 'completed') throw new Error(`${id}: Backtest nicht abgeschlossen`);
    const records = createMusterHaushaltRecords('2026-10-16', id === 'gross' ? 'max-erika' : id);
    const balance = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, referenceYear: 2026 });
    const probe = EngineAPI.simulateSingleYear(balance.engineInput, balance.engineLastState);
    result.households[id] = { inputsSha256: hash(inputs), mcSha256: hash(chunks),
        prefixSha256: hash(prefixes), prefixYears: prefixes.reduce((sum, row) => sum + row.years, 0),
        backtestSha256: hash(historical), countercheckSha256: hash(countercheck),
        countercheck: { rows: countercheck.rows.length, last: countercheck.rows.at(-1) },
        balanceSha256: hash(probe), coveredPct: (params.anzahl - fail) / params.anzahl * 100,
        ruinPaths: fail, technicalErrors: technical, maxAbsFlowDelta, savingsYears,
        realP10: quantile(values, .1), realP50: quantile(values, .5),
        medianSavingEquityPurchases: quantile(paths.map(row => row.equityPurchases), .5),
        ...(id === 'sophie' ? { medianSalaryEquityPurchases: quantile(paths.map(row => row.salaryEquityPurchases), .5) } : {}),
        medianPath: sorted[Math.floor((sorted.length - 1) / 2)] };
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
}
const { durationMs, ...parity } = runParityScenarios({ source });
if (parity.failed) throw new Error('Parität fehlgeschlagen');
result.paritySha256 = hash(parity);
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log('AS-1: Messung abgeschlossen');
