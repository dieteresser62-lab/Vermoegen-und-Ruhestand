// Anzeigevergleich zweier Quellstände; ausschließlich synthetischer Musterhaushalt.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const [beforeRoot, afterRoot, output, pathsArg = '2000'] = process.argv.slice(2);
if (!beforeRoot || !afterRoot || !output) throw new Error('Aufruf: node tests/helpers/nr-1-measurement.mjs <alt> <neu> <Ausgabe.json> [Pfade]');
const paths = Number(pathsArg);
const from = (root, name) => import(pathToFileURL(resolve(root, name)).href);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textFields = new Set(['kuerzungQuelle', 'CutReason', 'anmerkung']);
const unchanged = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'vk' || textFields.has(key) ? undefined : child));
async function setup(root) {
    const { inputs, runFixture } = await from(root, 'tests/extended/parity-replay-fixture.mjs');
    const { dynamicFlexPresetPatch } = await from(root, 'app/shared/dynamic-flex-presets.js');
    const { EngineAPI } = await from(root, 'engine/index.mjs');
    const { runMonteCarloChunk } = await from(root, 'app/simulator/monte-carlo-runner.js');
    const { normalizeWidowOptions } = await from(root, 'app/simulator/simulator-sweep-utils.js');
    const { annualData } = await from(root, 'app/simulator/simulator-data.js');
    const input = { ...structuredClone(inputs), ...dynamicFlexPresetPatch('offensiv'), rentAdjMode: 'wage', rentAdjPct: 2,
        pflegefallLogikAktivieren: false, kirchensteuerSatz: 0, stressPreset: 'NONE' };
    return { input, runFixture, EngineAPI, runMonteCarloChunk, normalizeWidowOptions, annualData };
}
const old = await setup(beforeRoot), current = await setup(afterRoot);
assert.equal(hash(old.input), hash(current.input));
const result = { parameters: { household: 'Max und Erika Mustermann', preset: 'offensiv', paths, years: 30,
    seed: 12345, method: 'regime_markov', rngMode: 'per-run-seed', capeSampling: false,
    mcPool: 'Inflation und Lohnänderung mindestens null, wie KG-1' }, inputSha256: hash(old.input), groups: {} };
function compare(name, before, after, beforeRows, afterRows) {
    assert.equal(JSON.stringify(unchanged(before)), JSON.stringify(unchanged(after)), `${name}: alle Felder außerhalb vk und Grundtexten bytegleich`);
    assert.equal(beforeRows.length, afterRows.length);
    const fields = {}, reasons = {};
    let changedYears = 0, saleYears = 0, reasonYears = 0;
    for (let i = 0; i < beforeRows.length; i++) {
        const a = beforeRows[i], b = afterRows[i];
        let changedSales = false;
        for (const key of new Set([...Object.keys(a.vk || {}), ...Object.keys(b.vk || {})])) {
            if (a.vk?.[key] !== b.vk?.[key]) { fields[`vk.${key}`] = (fields[`vk.${key}`] || 0) + 1; changedSales = true; }
        }
        const reasonChanged = a.CutReason !== b.CutReason;
        if (reasonChanged) {
            const pair = `${a.CutReason} → ${b.CutReason}`;
            reasons[pair] = (reasons[pair] || 0) + 1;
            reasonYears++;
        }
        if (changedSales) saleYears++;
        if (changedSales || reasonChanged) changedYears++;
        // executedSaleEq schließt beim Drei-Topf-Depot die Anleihen ein.
        if (b.vk && b.executedSaleEq !== undefined) assert.ok(Math.abs(b.vk.vkGes
            - (b.executedSaleEq + (b.tax_funding_sale_gross || 0) + b.vk.vkGld)) < 1e-6, `${name}/${i}: sämtliche Verkäufe enthalten`);
    }
    return { years: beforeRows.length, changedYears, saleYears, reasonYears, fields, reasons,
        beforeSha256: hash(before), afterSha256: hash(after),
        beforeUnchangedSha256: hash(unchanged(before)), afterUnchangedSha256: hash(unchanged(after)) };
}
const bt = state => { const run = state.runFixture({ input: state.input, engine: state.EngineAPI,
    selectedPeriod: { startYear: 2000, endYear: 2025 } }); return { rows: run.rows, outcome: run.outcome }; };
const beforeBt = bt(old), afterBt = bt(current);
result.groups.backtest = compare('Backtest', beforeBt, afterBt, beforeBt.rows.map(r => r.row), afterBt.rows.map(r => r.row));
for (const state of [old, current]) state.annualData.splice(0, state.annualData.length,
    ...state.annualData.map(year => ({ ...year, lohn: Math.max(0, year.lohn), inflation: Math.max(0, year.inflation) })));
const fingerprintsBefore = [], fingerprintsAfter = [], chunks = [];
for (let start = 0; start < paths; start += 100) {
    const run = state => state.runMonteCarloChunk({ inputs: state.input, engine: state.EngineAPI,
        widowOptions: state.normalizeWidowOptions(state.input.widowOptions), useCapeSampling: false,
        monteCarloParams: { anzahl: paths, maxDauer: 30, methode: 'regime_markov', seed: 12345, rngMode: 'per-run-seed' },
        runRange: { start, count: Math.min(100, paths - start) },
        logIndices: Array.from({ length: Math.min(100, paths - start) }, (_, i) => start + i) });
    const a = await run(old), b = await run(current);
    assert.equal(a.financialMetricsValid, true); assert.equal(b.financialMetricsValid, true);
    const measured = compare(`MC ${start}`, a, b, a.runMeta.flatMap(r => r.logDataRows), b.runMeta.flatMap(r => r.logDataRows));
    chunks.push(measured); fingerprintsBefore.push(measured.beforeUnchangedSha256); fingerprintsAfter.push(measured.afterUnchangedSha256);
    console.log(JSON.stringify({ start, years: measured.years, changedYears: measured.changedYears }));
}
result.groups.mc = { years: 0, changedYears: 0, saleYears: 0, reasonYears: 0, fields: {}, reasons: {},
    beforeUnchangedSha256: hash(fingerprintsBefore), afterUnchangedSha256: hash(fingerprintsAfter), chunks };
for (const chunk of chunks) {
    for (const field of ['years', 'changedYears', 'saleYears', 'reasonYears']) result.groups.mc[field] += chunk[field];
    for (const field of ['fields', 'reasons']) for (const [key, count] of Object.entries(chunk[field]))
        result.groups.mc[field][key] = (result.groups.mc[field][key] || 0) + count;
}
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.groups, (key, value) => key === 'chunks' ? undefined : value, 2));
