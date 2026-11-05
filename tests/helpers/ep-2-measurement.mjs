// Synthetischer Vergleich mit unverändertem Ausgangsordner; nicht Teil von npm test.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output, version = 'new', countArg = '2000', scenarioArg] = process.argv.slice(2);
const corrections = version.startsWith('ep2b-');
const selectedScenarios = scenarioArg?.split(',');
const from = file => import(pathToFileURL(resolve(root, file)).href);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { measurementInputs, backtest, parameters } = await from('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await from('engine/index.mjs');
const { runMonteCarloChunk } = await from('app/simulator/monte-carlo-runner.js');
const { createMusterHaushaltRecords } = await from('app/demo/muster-haushalt.js');
const { buildBalanceEngineInputFromStorage } = await from('app/balance/balance-input-storage.js');
const { runParityScenarios } = await from('tests/extended/parity-scenarios.mjs');
const { source } = await from('tests/extended/parity-replay-fixture.mjs');
const quantile = (values, p) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), i = (sorted.length - 1) * p;
    return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1);
};
const count = Number(countArg), params = { ...parameters, anzahl: count };
const result = { version, parameters: params, basis: 'Muster Max/Erika: Haus 450000 EUR bei Max. Groß: 3 Mio. EUR Geld 90/10, Haus 800000 EUR bei Max, Erika PG2 üblich; übrige Musterwerte. Endwerte real; Steuer nominale Pfadsumme einschließlich Nullpfaden; Kalender-Verkaufsjahr.', scenarios: {}, compatibility: {} };
async function measure(inputs, key) {
    const values = [], taxValues = [], years = [], chunkHashes = [], paths = [];
    let fail = 0, technical = 0, salePaths = 0, maxFlowDelta = 0;
    for (let start = 0; start < count; start += 100) {
        const size = Math.min(100, count - start);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: params,
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: size },
            logIndices: Array.from({ length: size }, (_, i) => start + i) });
        technical += chunk.technicalInventory.technicalError; fail += chunk.totals.failCount;
        values.push(...chunk.pathSummaries.finalValueRealEur); chunkHashes.push(hash(chunk));
        for (const run of chunk.runMeta) {
            const rows = run.logDataRows, sales = rows.filter(row => row.immobilienverkauf !== undefined);
            if (sales.length) { salePaths++; years.push(sales[0].immobilienverkauf_jahr); }
            taxValues.push(rows.reduce((sum, row) => sum + (row.erbschaftsteuer || 0), 0));
            for (const row of rows) maxFlowDelta = Math.max(maxFlowDelta, Math.abs(row.portfolio_flow_delta || 0));
            paths.push({ sha256: hash(run), sale: sales.length > 0,
                ...(corrections ? { deathWithExternalPartner: rows.some((row, index) => (row.SurvivorDeathYear === true
                    // Ein Ruin vor der Nachlassbuchung hat noch kein SurvivorDeathYear.
                    || (row.Person1Alive !== row.Person2Alive && (row.Person1Alive === 1 || row.Person2Alive === 1)
                        && (index === 0 || rows[index - 1].Person1Alive === 1 && rows[index - 1].Person2Alive === 1)))
                    && [1, 2].some(person => row[`Person${person}Alive`] === 1 && row[`CareP${person}_Active`] === 1
                        && (inputs.pflegeGradeConfigs?.[row[`CareP${person}_Grade`]]?.careForm
                            ?? (row[`CareP${person}_Grade`] >= 3 ? 'external' : 'family')) === 'external')) } : {}) });
        }
        if ((start + size) % 500 === 0) console.log(`${version}/${key}: ${start + size}/${count}`);
    }
    assert.equal(technical, 0, `${key}: keine technischen Fehler`);
    return { coveredPct: (count - fail) / count * 100, ruinPaths: fail, salePaths, medianSaleYear: quantile(years, .5),
        realP10: quantile(values, .1), realP50: quantile(values, .5), medianInheritanceTax: quantile(taxValues, .5),
        sha256: hash(chunkHashes), backtestSha256: hash(backtest(inputs)), maxFlowDelta, paths };
}
for (const household of ['muster', 'gross']) {
    const base = await measurementInputs();
    base.home = [{ id: 'haus', profileId: 'muster_a', bezeichnung: 'Haus', nutzung: 'selbst',
        wert: household === 'muster' ? 450000 : 800000, stand: '2026-10', mieteNetto: 0, anpassung: 'keine' }];
    base.homeReferenceYear = 2026;
    if (household === 'gross') {
        for (const [id, target] of [['muster_a', 2700000], ['muster_b', 300000]]) {
            const person = base.simulationPeople.find(person => person.profileId === id);
            const lots = base.detailledTranches.filter(lot => lot.sourceProfileId === id);
            const factor = target / (person.tagesgeld + lots.reduce((sum, lot) => sum + lot.marketValue, 0));
            person.tagesgeld *= factor;
            for (const lot of lots) { lot.marketValue *= factor; lot.costBasis *= factor; lot.shares *= factor; }
        }
        base.startVermoegen = 3000000;
        base.tagesgeld = base.simulationPeople.reduce((sum, person) => sum + person.tagesgeld, 0);
        base.geldmarktEtf = base.detailledTranches.filter(lot => lot.category === 'money_market').reduce((sum, lot) => sum + lot.marketValue, 0);
        base.depotwertAlt = 3000000 - base.tagesgeld - base.geldmarktEtf;
        base.einstandAlt = base.detailledTranches.filter(lot => lot.category === 'equity').reduce((sum, lot) => sum + lot.costBasis, 0);
        base.partner.careToday = { grade: 2, progression: 'usual' };
    }
    const variants = corrections ? ['homeAndTax', 'unmarried100', ...(household === 'gross' ? ['unmarried50', 'homeAndTax25'] : [])]
        : version === 'old' ? ['unmarried0', 'unmarried100', 'married100'] : ['unmarried0', 'homeAndTax', 'unmarried100', 'married100'];
    for (const variant of variants) {
        const inputs = structuredClone(base), married = variant === 'married100', percent = Number(variant.match(/\d+$/)?.[0] || 0);
        inputs.partnership = { schemaVersion: 1, status: married ? 'married' : 'unmarried',
            inheritance: { muster_a: percent, muster_b: percent }, marriedInheritance: { muster_a: 100, muster_b: 100 } };
        if (variant.startsWith('homeAndTax')) inputs.partnership.homeAndTaxInheritance = { muster_a: true };
        const key = `${household}/${variant}`;
        if (selectedScenarios && !selectedScenarios.includes(key)) continue;
        result.scenarios[key] = await measure(inputs, key);
        writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    }
}
if (selectedScenarios) process.exit(0);
const sophie = await measurementInputs(0, 'sophie');
result.compatibility.sophie = await measure(sophie, 'sophie');
const { durationMs, ...parity } = runParityScenarios({ source });
assert.equal(parity.failed, false);
result.compatibility.parity = hash(parity);
const records = createMusterHaushaltRecords('2026-10-16');
const balance = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, referenceYear: 2026 });
result.compatibility.balance = hash(balance);
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`${version}: fertig`);
process.exit(0);
