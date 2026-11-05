/** Vollständige Ausgaben, synthetische Haushalte, feste Markt- und Lebenspfade. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { simulatorDocument } from '../tests/simulator-page-fixture.mjs';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initDynamicFlexControls } from '../app/simulator/simulator-main-dynamic-flex.js';
import { initSimulatorProfileSelection } from '../app/simulator/simulator-main-profiles.js';
import { initSimulatorPlanTrial } from '../app/simulator/simulator-plan-trial.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { backtest } from '../tests/helpers/ek-1b-measurement.mjs';

const [output = '/tmp/vf2c-before.json', legacyDir = '/tmp/vf2c-legacy'] = process.argv.slice(2);
const date = '2026-10-23';
const parameters = { anzahl: 2000, maxDauer: 35, blockSize: 5, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cases = [['max-erika', 'grund'], ['max-erika', 'grund', 'haus'], ['jan-lena', 'grund'], ['renate', 'grund'],
    ['helga-werner', 'haus-pg3'], ['helga-werner', 'haus-pg3', 'pg4'],
    ...(process.env.VF2C_FRESH === '1' ? [['helga-werner', 'haus-pg3', 'pg4-current']] : [])];
mkdirSync(legacyDir, { recursive: true });
const result = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : { date, parameters, cases: {} };
for (const [household, variant, special] of cases) {
    const key = [household, variant, special].filter(Boolean).join('/');
    if (result.cases[key] && !process.env.VF2C_BACKTEST_ONLY) continue;
    const path = `${legacyDir}/${key.replaceAll('/', '-')}.json`;
    let records = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : createMusterHaushaltRecords(date, household, variant);
    // Für die geänderte Mustervariante wird zusätzlich der neue Vorgabestand gemessen.
    if (process.env.VF2C_FRESH === '1' && household === 'helga-werner' && !special) records = createMusterHaushaltRecords(date, household, variant);
    if (special === 'haus') {
        const registry = JSON.parse(records.rs_profiles_v1);
        const first = Object.values(registry.profiles)[0];
        first.data.profile_immobilien_v1 = JSON.stringify({ schemaVersion: 1, entries: [{ id: 'vf2c-haus', bezeichnung: 'Haus',
            nutzung: 'selbst', wert: 450000, stand: date.slice(0, 7), mieteNetto: 0, anpassung: 'keine' }] });
        records.rs_profiles_v1 = JSON.stringify(registry);
        records.profile_immobilien_v1 = first.data.profile_immobilien_v1;
    }
    if (special?.startsWith('pg4')) {
        const registry = JSON.parse(records.rs_profiles_v1);
        for (const profile of Object.values(registry.profiles)) {
            profile.data.profile_care_grade_today = '4';
            if (special !== 'pg4-current') delete profile.data.profile_care_form_today;
        }
        records.rs_profiles_v1 = JSON.stringify(registry);
        delete records.profile_care_grade_today;
        delete records.profile_care_form_today;
        records.sim_pflegeStufe4Form = 'external';
    }
    if (!existsSync(path)) writeFileSync(path, JSON.stringify(records));
    const store = new Map(Object.entries(records));
    P.resetPersistenceForTests({ name: 'VF-2c', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { for (const k of deletes) store.delete(k); for (const [k, v] of upserts) store.set(k, v); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    setAppTestDate(date);
    globalThis.document = simulatorDocument();
    globalThis.window = { EngineAPI, addEventListener() {}, removeEventListener() {} };
    initInputPersistence(); initDynamicFlexControls({ enableLocalPersistence: false });
    initSimulatorProfileSelection(); initSimulatorPlanTrial(); prepareHistoricalDataOnce();
    if (window.__profileRecoveryBlocker) throw Error(JSON.stringify(window.__profileRecoveryBlocker));
    const inputs = getCommonInputs(), digest = createHash('sha256'), chunks = [];
    let ruin = 0, covered = 0, careSales = 0, emergencySales = 0, allowance = 0, technical = 0;
    for (let start = 0; !process.env.VF2C_BACKTEST_ONLY && start < parameters.anzahl; start += 100) {
        const count = Math.min(100, parameters.anzahl - start);
        const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: parameters,
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count },
            logIndices: Array.from({ length: count }, (_, i) => start + i), engine: EngineAPI });
        digest.update(JSON.stringify(chunk)); chunks.push(hash(chunk));
        ruin += chunk.totals.outcomeRuinCount;
        covered += count - chunk.totals.outcomeRuinCount;
        technical += chunk.technicalInventory?.technicalError || 0;
        for (const run of chunk.runMeta) for (const row of run.logDataRows || []) {
            allowance += row.pflegegeld || 0;
            if (row.immobilienverkauf > 0) {
                if (row.immobilien_notverkauf) emergencySales++;
                else careSales++;
            }
        }
        console.log(`${key}: ${start + count}/2000`);
    }
    const historical = [[2000, 2025], [1965, 1999]].map(([start, end]) => {
        const value = backtest(inputs, start, end);
        if (value.outcome.kind !== 'completed') throw new Error(`Backtest ${start}–${end}: ${value.outcome.kind}`);
        if (process.env.VF2C_DETAILS === '1') writeFileSync(`${output}.${key.replaceAll('/', '-')}-${start}-${end}.json`, JSON.stringify(value));
        return { period: `${start}–${end}`, sha256: hash(value), outcome: value.outcome,
            allowance: value.rows.reduce((sum, entry) => sum + (entry.row.pflegegeld || 0), 0) };
    });
    result.cases[key] = process.env.VF2C_BACKTEST_ONLY ? { ...result.cases[key], backtests: historical }
        : { inputsSha256: hash(inputs), completeOutputSha256: digest.digest('hex'), chunks,
            coveredPct: covered / 20, ruin, careSales, emergencySales, allowance, technical, backtests: historical };
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
}
console.log(`VF-2c: ${Object.keys(result.cases).length} Haushaltsfälle vollständig erfasst (${output}).`);
