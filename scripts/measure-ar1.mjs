/** AR-1: reproduzierbare Wohnrechtsmessung, ausschließlich synthetische Muster. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output, countArg = '2000'] = process.argv.slice(2);
const load = file => import(pathToFileURL(resolve(root, file)));
const { measurementInputs, parameters, backtest, hash } = await load('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await load('engine/index.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { MUSTER_HAUSHALTE, musterVarianten } = await load('app/demo/muster-haushalte.js');
const count = Number(countArg), date = '2026-10-23';
const result = { date, parameters: { ...parameters, anzahl: count }, cases: {} };
for (const { id } of MUSTER_HAUSHALTE) for (const variant of musterVarianten(id)) {
    const base = await measurementInputs(0, id, date, variant.id);
    const residences = Object.entries(base.partnership?.testament || {}).filter(([, rule]) => rule.home === 'residence');
    if (!residences.length) continue;
    for (const care of [false, true]) for (const annual of [false, true]) {
        const inputs = structuredClone(base);
        for (const [deceased, rule] of residences) {
            inputs.partnership.testament[deceased] = { ...rule, residenceTax: annual ? 'annual' : 'immediate' };
            if (care) {
                const survivorIndex = inputs.simulationPeople.findIndex(person => person.profileId !== deceased);
                const person = survivorIndex === 0 ? inputs : inputs.partner;
                person.careToday = { grade: 3, form: 'residential', progression: 'usual' };
            }
        }
        let ruin = 0, inheritanceTax = 0, residenceTax = 0, emergencySales = 0, technicalError = 0;
        for (let start = 0; start < count; start += 50) {
            const size = Math.min(50, count - start);
            const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: result.parameters,
                widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: size },
                logIndices: Array.from({ length: size }, (_, index) => start + index) });
            if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw Error('Ungültiger Messlauf');
            ruin += chunk.totals.failCount; technicalError += chunk.technicalInventory.technicalError;
            for (const run of chunk.runMeta) for (const row of run.logDataRows || []) {
                inheritanceTax += row.erbschaftsteuer || 0;
                residenceTax += row.wohnrechtsteuer || 0;
                // Ein Notverkaufsereignis je Jahreszeile, auch beim Verkauf mehrerer Objekte.
                emergencySales += row.immobilien_notverkauf ? 1 : 0;
            }
        }
        const key = `${id}/${variant.id}/${care ? 'heimpflege' : 'vorgabe'}/${annual ? 'jaehrlich' : 'sofort'}`;
        result.cases[key] = { coveredPct: 100 * (count - ruin) / count, ruin, inheritanceTaxMean: inheritanceTax / count,
            residenceTaxMean: residenceTax / count, emergencySales, technicalError, backtestHash: hash(backtest(inputs, 2000, 2025)) };
        console.log(key, JSON.stringify(result.cases[key]));
    }
}
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
