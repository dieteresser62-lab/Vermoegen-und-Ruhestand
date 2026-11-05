// Ausschließlich synthetische Musterhaushalte, unveränderte historische Jahresdaten.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [beforeRoot, afterRoot, output, pathsArg = '2000'] = process.argv.slice(2);
if (!beforeRoot || !afterRoot || !output) throw new Error('Aufruf: node tests/helpers/an-1-measurement.mjs <alt> <neu> <Ausgabe.json> [Pfade]');
const paths = Number(pathsArg);
const from = (root, file) => import(pathToFileURL(resolve(root, file)).href);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quantile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * p;
    if (!sorted.length) return null;
    return sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1);
};
const parameters = { anzahl: paths, maxDauer: 42, blockSize: 3, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
function summarizeBacktest(bt, period) {
    assert.ok(['completed', 'ruin'].includes(bt.outcome.kind));
    const rows = bt.rows.map(item => item.row), last = rows.at(-1);
    return { period, outcome: bt.outcome.kind, hash: hash(bt), years: rows.length,
        finalNominal: last.portfolio_total_end, finalReal: bt.metrics.values.wealth_end_real_eur,
        taxes: rows.reduce((sum, row) => sum + (row.steuern_gesamt || 0), 0),
        equityBuys: rows.reduce((sum, row) => sum + (row.kaufAkt || 0), 0) };
}
async function setup(root) {
    const { measurementInputs, backtest } = await from(root, 'tests/helpers/ek-1b-measurement.mjs');
    const { EngineAPI } = await from(root, 'engine/index.mjs');
    const { runMonteCarloChunk } = await from(root, 'app/simulator/monte-carlo-runner.js');
    const { initMcRunState } = await from(root, 'app/simulator/simulator-engine-helpers.js');
    const { simulateOneYear } = await from(root, 'app/simulator/simulator-engine-direct.js');
    const scenarios = [];
    for (const id of ['sophie', 'max-erika', 'jan-lena']) {
        const inputs = await measurementInputs(0, id);
        if (id === 'jan-lena') Object.assign(inputs, { maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5 });
        scenarios.push({ id, inputs });
    }
    return { scenarios, EngineAPI, runMonteCarloChunk, backtest, initMcRunState, simulateOneYear };
}
const old = await setup(beforeRoot), current = await setup(afterRoot);
const result = { parameters, date: '2026-10-16', source: 'App-Muster über Simulator-Seitenleser; Jan/Lena mit 10 %/5 %',
    retirementCashShareBasis: 'Ende des letzten Gehaltsjahrs (Jahr 12), unmittelbar vor Rentenbeginn; Tagesgeld / Gesamtvermögen, Median aus finanziell auswertbaren Pfaden.',
    totalPurchasesBasis: 'Nominale Summe je Pfad, daraus Mittelwert und Summe über alle 2.000 Pfade; Steuern als nominale Summe je Pfad, gemittelt.',
    scenarios: {}, byteControls: [] };
for (let scenarioIndex = 0; scenarioIndex < old.scenarios.length; scenarioIndex++) {
    const id = old.scenarios[scenarioIndex].id;
    result.scenarios[id] = {};
    for (const [version, source] of [['alt', old], ['neu', current]]) {
        const { inputs } = source.scenarios[scenarioIndex];
        const real = [], taxes = [], buys = [], retirementCashShares = [], chunks = [];
        let failed = 0, technical = 0, financialYears = 0, maxAbsFlowDelta = 0;
        for (let start = 0; start < paths; start += 50) {
            const count = Math.min(50, paths - start);
            const chunk = await source.runMonteCarloChunk({ inputs, engine: source.EngineAPI,
                monteCarloParams: parameters, widowOptions: inputs.widowOptions, useCapeSampling: false,
                runRange: { start, count }, logIndices: Array.from({ length: count }, (_, i) => start + i) });
            assert.equal(chunk.financialMetricsValid, true);
            real.push(...chunk.pathSummaries.finalValueRealEur);
            failed += chunk.totals.failCount; technical += chunk.technicalInventory.technicalError;
            chunks.push(hash(chunk));
            for (const run of chunk.runMeta) {
                let bought = 0, tax = 0;
                for (const row of run.logDataRows) {
                    if (row.financiallyEvaluable !== true) continue;
                    financialYears++; bought += row.kaufAkt || 0; tax += row.steuern_gesamt || 0;
                    maxAbsFlowDelta = Math.max(maxAbsFlowDelta, Math.abs(row.portfolio_flow_delta || 0));
                    // Ende des letzten Gehaltsjahrs, unmittelbar vor Rentenbeginn: Tagesgeld / Gesamtvermögen.
                    if (id === 'sophie' && row.jahr === 12) {
                        const cash = row.personAccounts.reduce((sum, person) => sum + person.tagesgeld, 0);
                        retirementCashShares.push(cash / row.portfolio_total_end * 100);
                    }
                }
                buys.push(bought); taxes.push(tax);
            }
            if ((start + count) % 250 === 0 || start + count === paths) console.log(`${id}/${version}: ${start + count}/${paths}`);
        }
        const bt = source.backtest(inputs, 2000, 2025);
        result.scenarios[id][version] = { inputsHash: hash(inputs), chunksHash: hash(chunks), technicalErrors: technical,
            evaluatedPaths: paths - technical, successPct: (paths - technical - failed) / (paths - technical) * 100,
            finalRealP10: quantile(real, .1), finalRealP50: quantile(real, .5),
            taxesNominalMean: taxes.reduce((sum, value) => sum + value, 0) / paths,
            equityBuysNominalMean: buys.reduce((sum, value) => sum + value, 0) / paths,
            equityBuysNominalSum: buys.reduce((sum, value) => sum + value, 0),
            retirementCashShareP50: quantile(retirementCashShares, .5), retirementCashSharePaths: retirementCashShares.length,
            financialYears, maxAbsFlowDelta,
            backtest: summarizeBacktest(bt, '2000–2025'),
            counterchecks: [summarizeBacktest(source.backtest(inputs, 1929, 1970), '1929–1970')] };
        writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    }
}
// Vollständige Jahresergebnisse ohne Feldfilter: kein Lohneinkommen,
// Überschuss unter Mindesthandel bzw. positiver Kauf unter der bisherigen Kaufgrenze.
for (const cash of [5000, 20000, 35000, 40000]) for (const adjustment of ['none', 'keine']) {
    const values = [];
    for (const source of [old, current]) {
        const inputs = structuredClone(source.scenarios[1].inputs);
        Object.assign(inputs, { dynamicFlex: false, startFloorBedarf: 0, startFlexBedarf: 0,
            minimumFlexAnnual: 0, renteMonatlich: 0, partner: { ...inputs.partner, aktiv: false },
            startVermoegen: 1000000 + cash, depotwertAlt: 0, depotwertNeu: 1000000, einstandNeu: 1000000,
            tagesgeld: cash, geldmarktEtf: 0, minCashBufferMonths: 0,
            maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5, pflegefallLogikAktivieren: false,
            healthBucket: { enabled: false }, goldAktiv: false, plannedExpenses: [], plannedInflows: [] });
        delete inputs.simulationPeople; delete inputs.personAccounts;
        delete inputs.detailledTranches; delete inputs.goldStrategyDiagnostics;
        delete inputs.fixedIncome; delete inputs.fixedIncomeReferenceYear;
        if (adjustment === 'keine') { inputs.fixedIncomeReferenceYear = 2026;
            inputs.fixedIncome = [{ id: 'fest', art: 'sonstige', betragMonat: 100, bezeichnung: 'Fest',
                ab: null, bis: null, anpassung: 'keine', profileId: inputs.simulationSourceProfileId }]; }
        const state = source.initMcRunState(inputs, 0);
        values.push(source.simulateOneYear(state, inputs,
            { jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: -9.7 },
            0, null, 0, null, 1, source.EngineAPI));
    }
    assert.equal(values[0].kind, 'success');
    assert.equal(hash(values[0]), hash(values[1]), `Vollständiges Ergebnis bei Cash ${cash}, Anpassung ${adjustment}`);
    result.byteControls.push({ cash, adjustment, purchase: values[0].logData.kaufAkt,
        beforeHash: hash(values[0]), afterHash: hash(values[1]) });
}
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
