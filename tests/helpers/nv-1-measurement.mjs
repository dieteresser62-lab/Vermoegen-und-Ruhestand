// Nur synthetische Musterwerte; vollständige Vorher-/Nachher-Ergebnisse ohne Feldfilter.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output, countArg = '2000', selection = 'all'] = process.argv.slice(2);
const from = file => import(pathToFileURL(resolve(root, file)).href);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { measurementInputs, backtest, parameters } = await from('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await from('engine/index.mjs');
const { runMonteCarloChunk } = await from('app/simulator/monte-carlo-runner.js');
const { createMusterHaushaltRecords } = await from('app/demo/muster-haushalt.js');
const { buildBalanceEngineInputFromStorage } = await from('app/balance/balance-input-storage.js');
const { runParityScenarios } = await from('tests/extended/parity-scenarios.mjs');
const { source } = await from('tests/extended/parity-replay-fixture.mjs');
const count = Number(countArg), params = { ...parameters, anzahl: count };
const q = (values, p = .5) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a,b) => a-b), i = (sorted.length - 1) * p;
    return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1);
};
const result = selection === 'backtests' ? JSON.parse(readFileSync(output,'utf8'))
    : { synthetic: true, testDate: '2026-10-23', parameters: params, scenarios: {}, compatibility: {} };
function counterchecksFor(inputs) {
    return [[1925,1999],[2000,2025],[1929,1963],[1965,1999]].map(([start,end]) => {
        const run = backtest(structuredClone(inputs),start,end),rows=run.rows;
        return { period: `${start}–${end}`, outcome:run.outcome.kind,
            ruin:['completed','ruin'].includes(run.outcome.kind) ? run.outcome.kind === 'ruin' : null,
            ...(run.incompleteReason ? { incompleteReason:run.incompleteReason } : {}),
            sales:rows.filter(row => row.row.immobilienverkauf > 0).map(row => ({ year:row.jahr,
                simulationYear:row.row.immobilienverkauf_jahr,emergency:!!row.row.immobilien_notverkauf })),
            finalNominal:run.portfolioEnd ?? null,sha256:hash(run) };
    });
}
async function measure(inputs, key) {
    let ruin = 0, technical = 0, ruinWithHome = 0, emergency = 0, care = 0, maxFlowDelta = 0;
    const final = [], years = [], rents = [], chunks = [];
    for (let start = 0; start < count; start += 100) {
        const size = Math.min(100, count-start);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: params,
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: size },
            logIndices: Array.from({ length: size }, (_,i) => start+i) });
        chunks.push(hash(chunk)); ruin += chunk.totals.failCount;
        technical += chunk.technicalInventory.technicalError;
        final.push(...chunk.pathSummaries.finalValueRealEur);
        for (const run of chunk.runMeta) {
            const rows = run.logDataRows, sales = rows.filter(row => row.immobilienverkauf !== undefined);
            const not = sales.filter(row => row.immobilien_notverkauf);
            if (not.length) {
                emergency++; years.push(not[0].immobilienverkauf_jahr);
                // Je Notverkaufspfad erste aktive Jahresmiete, auf heutige Euro zurückgeführt.
                const rent = rows.find(row => row.wohnmiete > 0);
                if (rent) rents.push(rent.wohnmiete / rent.inflation_factor_cum);
            }
            if (sales.some(row => !row.immobilien_notverkauf)) care++;
            const sold = new Set(sales.flatMap(row => row.immobilienverkauf_personen.map(sale => sale.homeId)));
            if (rows.some(row => row.recordType === 'terminal_ruin') && inputs.home?.some(home => !sold.has(home.id))) ruinWithHome++;
            for (const row of rows) maxFlowDelta = Math.max(maxFlowDelta, Math.abs(row.portfolio_flow_delta || 0));
        }
        console.log(`${key}: ${start+size}/${count}`);
    }
    assert.equal(technical, 0, `${key}: keine technischen Fehler`);
    const counterchecks = counterchecksFor(inputs);
    return { strategy: inputs.decumulation.mode, bonds: inputs.detailledTranches.filter(lot => lot.category === 'bonds')
        .reduce((sum,lot) => sum + lot.marketValue,0), inputsSha256: hash(inputs), coveredPct: 100*(count-ruin)/count,
        ruin, ruinWithHome, emergency, medianEmergencyYear: q(years), care, medianRentReal: q(rents),
        realP10: q(final,.1), realP50: q(final), sha256: hash(chunks), maxFlowDelta, counterchecks };
}
for (const household of ['renate','muster','gross','sophie','noHome','helga-werner']) {
    if (selection === 'backtests' && !result.scenarios[household]) continue;
    if (selection === 'homes' && !['renate','muster'].includes(household)) continue;
    if (selection === 'estates' && !['renate','muster','gross'].includes(household)) continue;
    const inputs = await measurementInputs(0, ['renate','sophie','helga-werner'].includes(household) ? household : undefined, '2026-10-23');
    inputs.home = [];
    if (['renate','muster','gross'].includes(household)) {
        inputs.home = [{ id: 'haus', profileId: inputs.simulationPeople[0].profileId, bezeichnung: 'Haus', nutzung: 'selbst',
            wert: household === 'renate' ? 300000 : 800000, stand: '2026-10', mieteNetto: 0, anpassung: 'keine' }];
        inputs.homeReferenceYear = 2026;
        if (household === 'renate') inputs.careToday = { grade: 3, progression: 'usual' };
        else inputs.partnership = { schemaVersion: 1, status: 'unmarried', inheritance: { muster_a: 0, muster_b: 0 },
            marriedInheritance: { muster_a: 100, muster_b: 100 }, homeAndTaxInheritance: { muster_a: true } };
    }
    if (household === 'gross') {
        for (const [id,target] of [['muster_a',2700000],['muster_b',300000]]) {
            const person = inputs.simulationPeople.find(p => p.profileId === id);
            const lots = inputs.detailledTranches.filter(lot => lot.sourceProfileId === id);
            const factor = target/(person.tagesgeld+lots.reduce((sum,lot) => sum+lot.marketValue,0));
            person.tagesgeld *= factor;
            for (const lot of lots) { lot.marketValue *= factor; lot.costBasis *= factor; lot.shares *= factor; }
        }
        inputs.startVermoegen = 3000000;
        inputs.tagesgeld = inputs.simulationPeople.reduce((sum,p) => sum+p.tagesgeld,0);
        inputs.geldmarktEtf = inputs.detailledTranches.filter(lot => lot.category === 'money_market').reduce((sum,lot) => sum+lot.marketValue,0);
        inputs.depotwertAlt = 3000000-inputs.tagesgeld-inputs.geldmarktEtf;
        inputs.einstandAlt = inputs.detailledTranches.filter(lot => lot.category === 'equity').reduce((sum,lot) => sum+lot.costBasis,0);
        inputs.partner.careToday = { grade: 2, progression: 'usual' };
    }
    assert.equal(inputs.pflegefallLogikAktivieren, true);
    if (selection === 'backtests') result.scenarios[household].counterchecks=counterchecksFor(inputs);
    else result.scenarios[household] = await measure(inputs,household);
    writeFileSync(output,JSON.stringify(result,null,2)+'\n');
}
if (selection === 'all') {
    const { durationMs,...parity } = runParityScenarios({ source }); assert.equal(parity.failed,false);
    result.compatibility.parity = hash(parity);
    const records = createMusterHaushaltRecords('2026-10-23');
    const input = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, referenceYear: 2026 });
    result.compatibility.balanceInput = hash(input);
    const calc = EngineAPI.simulateSingleYear(input.engineInput,input.engineLastState); assert(!calc.error);
    result.compatibility.balanceCalculation = hash(calc);
}
writeFileSync(output,JSON.stringify(result,null,2)+'\n');
process.exit(0);
