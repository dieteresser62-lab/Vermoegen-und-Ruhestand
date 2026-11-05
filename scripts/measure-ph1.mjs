import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [root, output] = process.argv.slice(2);
const load = f => import(pathToFileURL(resolve(root, f)));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { measurementInputs, parameters, backtest } = await load('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await load('engine/index.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { createMusterHaushaltRecords } = await load('app/demo/muster-haushalt.js');
const { buildBalanceEngineInputFromStorage } = await load('app/balance/balance-input-storage.js');
const { planScope } = await load('app/profile/household-plan.js');
const { projectOverviewFromRecords } = await load('app/overview/overview-model.js');
const { setAppTestDate } = await load('app/shared/app-clock.js');
const result = {};
for (const id of ['max-erika', 'renate']) {
    const inputs = await measurementInputs(0, id, '2026-10-28');
    const mc = await runMonteCarloChunk({ inputs, engine: EngineAPI,
        monteCarloParams: { ...parameters, anzahl: 40 }, widowOptions: inputs.widowOptions,
        useCapeSampling: false, runRange: { start: 0, count: 40 }, logIndices: Array.from({length:40},(_,i)=>i) });
    if (!mc.financialMetricsValid || mc.batchStatus !== 'completed') throw new Error('Monte Carlo nicht vollständig auswertbar');
    const records = createMusterHaushaltRecords('2026-10-28', id);
    const registry = JSON.parse(records.rs_profiles_v1);
    const scope = planScope(Object.keys(registry.profiles).length === 1 ? 'single' : 'household', Object.keys(registry.profiles));
    const storage = { getItem: key => records[key] ?? null };
    const calc = buildBalanceEngineInputFromStorage({ storage, scope, referenceYear: 2026 });
    const balance = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState);
    if (balance.error) throw balance.error;
    const overview = projectOverviewFromRecords({ registry, activeId: records.rs_current_profile, liveData: records,
        now: new Date('2026-10-28T12:00:00Z') });
    const historical = backtest(inputs);
    if (historical.outcome.kind !== 'completed' || !overview.available) throw new Error('Backtest oder Übersicht nicht auswertbar');
    result[id] = { balance: hash(balance), backtest: hash(historical), monteCarlo: hash(mc), overview: hash(overview) };
}
writeFileSync(output, JSON.stringify(result, null, 2)+'\n');
console.log(JSON.stringify(result));
