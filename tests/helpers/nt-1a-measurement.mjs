// Außerhalb der Standardsuite: vollständige Vorher-/Nachher-Hashes und Prüffrage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { ntInputs } from './nt-1a-fixture.mjs';
import { backtest, parameters } from './ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../../engine/index.mjs';

const [output, countArg = '2000'] = process.argv.slice(2);
const count = Number(countArg);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const median = values => {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length ? (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null;
};
const result = { date: '2026-10-23', parameters: { ...parameters, anzahl: count }, scenarios: {} };
for (const id of ['helga-werner', 'max-erika', 'jan-lena', 'sophie', 'renate']) {
    const inputs = await ntInputs(id);
    if (id === 'renate') {
        inputs.home = [{ id: 'wohnung', profileId: inputs.simulationPeople[0].profileId,
            bezeichnung: 'Wohnung', nutzung: 'selbst', wert: 300000, stand: '2026-10',
            mieteNetto: 0, anpassung: 'keine' }];
        inputs.homeReferenceYear = 2026;
        inputs.careToday = { grade: 3, progression: 'usual' };
    }
    const chunks = [], affectedTax = [], all2027Tax = [], examples = [];
    let technical = 0, affected = 0, taxable = 0;
    for (let start = 0; start < count; start += 100) {
        const size = Math.min(100, count - start);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI,
            monteCarloParams: result.parameters, widowOptions: inputs.widowOptions, useCapeSampling: false,
            runRange: { start, count: size }, logIndices: Array.from({ length: size }, (_, i) => start + i) });
        technical += chunk.technicalInventory.technicalError;
        chunks.push(hash(chunk));
        if (id === 'renate') for (const run of chunk.runMeta) {
            const row = run.logDataRows.find(row => row.jahr === 2);
            if (!row) continue;
            all2027Tax.push(row.vk?.stAkt || 0);
            if (!(row.immobilienverkauf > 0 && row.kaufAkt > 0 && row.vk?.vkAkt > 0
                && (row.bondRefillGross ?? row.threeBucket?.bondRefillGross) > 0)) continue;
            affected++;
            affectedTax.push(row.vk.stAkt || 0);
            if (row.vk.stAkt > 0) taxable++;
            if (examples.length < 3) examples.push({ path: run.runIndex, simulationYear: row.jahr,
                homeSale: row.immobilienverkauf, equitySale: row.vk.vkAkt, equityBuy: row.kaufAkt,
                refillGross: row.bondRefillGross ?? row.threeBucket?.bondRefillGross,
                refillNet: row.bondRefillNet ?? row.threeBucket?.bondRefillNet,
                equityTax: row.vk.stAkt, inflationFactor: row.inflation_factor_cum });
        }
        if ((start + size) % 500 === 0 || start + size === count) console.log(`${id}: ${start + size}/${count}`);
    }
    assert.equal(technical, 0, `${id}: keine technischen Abbrüche`);
    result.scenarios[id] = { inputsHash: hash(inputs), chunksHash: hash(chunks),
        backtestHash: hash(backtest(inputs)), technical,
        ...(id === 'renate' ? { affected2027Paths: affected, taxable2027Paths: taxable,
            medianAffectedEquityTaxNominal: median(affectedTax), medianAll2027EquityTaxNominal: median(all2027Tax), examples } : {}) };
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
}
