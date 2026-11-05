// VF-2d: derselbe Seitenweg wie VF-2a, Spielkurse, synthetische Muster, 23.10.2026.
// VF_BASE_DIR=<Quellkopie> VF_CASES=renate,helga-werner node scripts/measure-vf2d.mjs <Ausgabe.json>
// Zusatzmetrik: je Pfad niedrigster nominaler Anleihenstand nach der ersten Bärenphase,
// nur Jahre außerhalb bear/crash (recovery zählt zur Erholung); Median der belegten Pfade.
// VF_CASES=renate,helga-werner VF_RUNS=2000 steuert gezielte Wiederholungen.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = process.env.VF_BASE_DIR ? pathToFileURL(resolve(process.env.VF_BASE_DIR) + '/') : new URL('../', import.meta.url);
const load = path => import(new URL(path, root));
const { EngineAPI } = await load('engine/index.mjs');
const { createMusterHaushaltRecords } = await load('app/demo/muster-haushalt.js');
const { PersistenceFacade: P } = await load('app/shared/persistence-facade.js');
const { setAppTestDate } = await load('app/shared/app-clock.js');
const { simulatorDocument } = await load('tests/simulator-page-fixture.mjs');
const { initInputPersistence } = await load('app/simulator/simulator-main-input-persist.js');
const { initDynamicFlexControls } = await load('app/simulator/simulator-main-dynamic-flex.js');
const { initSimulatorProfileSelection } = await load('app/simulator/simulator-main-profiles.js');
const { initSimulatorPlanTrial } = await load('app/simulator/simulator-plan-trial.js');
const { getCommonInputs } = await load('app/simulator/simulator-portfolio.js');
const { prepareHistoricalDataOnce } = await load('app/simulator/simulator-engine-helpers.js');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { backtest } = await load('tests/helpers/ek-1b-measurement.mjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const count = Number(process.env.VF_RUNS || 2000);
const parameters = { anzahl: count, maxDauer: 35, blockSize: 5, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
async function inputsFor(key) {
    const household = key === 'renate-standard' ? 'renate' : key === 'martin-ehe' ? 'martin-petra' : key;
    const variant = key.startsWith('renate') ? 'klein' : key === 'helga-werner' ? 'haus-pg3' : key === 'martin-ehe' ? 'ehe' : 'grund';
    const records = createMusterHaushaltRecords('2026-10-23', household, variant);
    const reg = JSON.parse(records.rs_profiles_v1);
    const profiles = Object.values(reg.profiles);
    if (key === 'renate') profiles[0].data.profile_care_grade_today = '3';
    if (key === 'helga-werner') for (const profile of profiles) profile.data.profile_care_grade_today = '4';
    records.rs_profiles_v1 = JSON.stringify(reg);
    delete records.profile_care_grade_today;
    if (key === 'helga-werner') records.sim_pflegeStufe4Form = 'external';
    const store = new Map(Object.entries(records));
    P.resetPersistenceForTests({ name: 'VF-2a memory', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { for (const k of deletes) store.delete(k); for (const [k, v] of upserts) store.set(k, v); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    setAppTestDate('2026-10-23');
    globalThis.document = simulatorDocument();
    globalThis.window = { EngineAPI, addEventListener() {}, removeEventListener() {} };
    initInputPersistence(); initDynamicFlexControls({ enableLocalPersistence: false });
    initSimulatorProfileSelection(); initSimulatorPlanTrial();
    if (window.__profileRecoveryBlocker) throw new Error(JSON.stringify(window.__profileRecoveryBlocker));
    prepareHistoricalDataOnce();
    const inputs = getCommonInputs();
    if (key === 'renate') {
        inputs.decumulation = { mode: '3_bucket_jilge', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null };
        inputs.home = [{ id: 'wohnung', profileId: inputs.simulationPeople[0].profileId, bezeichnung: 'Wohnung',
            nutzung: 'selbst', wert: 300000, stand: '2026-10', mieteNetto: 0, anpassung: 'keine' }];
        inputs.homeReferenceYear = 2026;
    }
    return inputs;
}
const result = { date: '2026-10-23', parameters, cases: {} };
for (const key of (process.env.VF_CASES || 'renate,helga-werner,max-erika,renate-standard,martin-ehe,martin-petra').split(',')) {
    const inputs = await inputsFor(key);
    const m = { inputsHash: hash(inputs), ruin: 0, technical: 0, taxedRoundTripPaths: 0, roundTripTax: 0,
        equityRoundTripPaths: 0, equityRoundTripExamples: [], firstYearPayoutSalePaths: 0, firstYearTax: 0,
        realBudgetDropsOver5OutsideBear: 0, maxRealBudgetJumpPct: 0, maxRealBudgetDropPct: 0, chunks: [], postBearMinima: [] };
    for (let start = 0; start < count; start += 100) {
        const size = Math.min(100, count - start);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: parameters,
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: size },
            logIndices: Array.from({ length: size }, (_, i) => start + i) });
        m.chunks.push(hash(chunk));
        m.ruin += chunk.totals.outcomeRuinCount;
        m.technical += chunk.technicalInventory.technicalError;
        for (const [runOffset, run] of chunk.runMeta.entries()) {
            let taxed = false, roundTrip = false, previous = null, seenBear = false, postBearMin = Infinity;
            for (const r of run.logDataRows || []) {
                const bearPhase = /bear|crash/i.test(r.Regime || '') && !/recovery/i.test(r.Regime || '');
                if (seenBear && !bearPhase && Number.isFinite(r.bondBucketAfter)) postBearMin = Math.min(postBearMin, r.bondBucketAfter);
                seenBear ||= bearPhase;
                const simultaneous = r.kaufAkt > .01 && r.vk?.vkAkt > .01;
                roundTrip ||= simultaneous;
                if (simultaneous && m.equityRoundTripExamples.length < 3) m.equityRoundTripExamples.push({ run: start + runOffset,
                    year: r.jahr, regime: r.Regime, equityBuy: r.kaufAkt, equitySale: r.vk.vkAkt,
                    bondRefillTax: r.bondRefillTax, action: r.aktionUndGrund });
                // Vermeidbare Steuer aufs Hin und Her: Aktien werden gekauft und
                // gleichzeitig für die Anleihenauffüllung mit Steuer verkauft.
                if (simultaneous && r.bondRefillTax > .01) { taxed = true; m.roundTripTax += r.bondRefillTax; }
                if (r.jahr === 1) {
                    if (/Verkauf für die Auszahlung|für (?:seinen|ihren) Anteil/.test(r.aktionUndGrund || '')) m.firstYearPayoutSalePaths++;
                    m.firstYearTax += Number(r.steuern_gesamt) || 0;
                }
                const budget = (r.floor_brutto + r.flex_haushalt_erfuellt) / r.inflation_factor_cum;
                if (r.financiallyEvaluable && Number.isFinite(budget) && budget > 0) {
                    const bear = /bear|crash|bär/i.test(r.Regime || r.aktionUndGrund || '');
                    if (previous > 0) {
                        const change = (budget / previous - 1) * 100;
                        m.maxRealBudgetJumpPct = Math.max(m.maxRealBudgetJumpPct, Math.abs(change));
                        m.maxRealBudgetDropPct = Math.max(m.maxRealBudgetDropPct, -change);
                        if (change < -5 && !bear) m.realBudgetDropsOver5OutsideBear++;
                    }
                    previous = budget;
                }
            }
            if (postBearMin < Infinity) m.postBearMinima.push(postBearMin);
            if (taxed) m.taxedRoundTripPaths++;
            if (roundTrip) m.equityRoundTripPaths++;
        }
        console.log(`${key}: ${start + size}/${count}`);
        if (process.env.VF_INSPECT && start === 0) writeFileSync(process.env.VF_INSPECT, JSON.stringify(chunk.runMeta[0], null, 2));
    }
    m.postBearMinima.sort((a,b) => a-b);
    const middle = Math.floor(m.postBearMinima.length / 2);
    m.postBearMinMedian = m.postBearMinima.length ? (m.postBearMinima[middle] + m.postBearMinima[Math.max(0, Math.ceil(m.postBearMinima.length / 2) - 1)]) / 2 : null;
    m.postBearPathCount = m.postBearMinima.length; delete m.postBearMinima;
    m.coveredPct = (count - m.technical - m.ruin) / (count - m.technical) * 100;
    // 1925–1928 fehlen die vier Vorjahre. Die ausführbaren Fenster bleiben innerhalb der Altersgrenze.
    m.backtests = [[1925, 1999], [1929, 1963], [1965, 1999], [2000, 2025]].map(([start, end]) => {
        const bt = backtest(inputs, start, end), last = bt.rows.at(-1);
        return { period: `${start}–${end}`, hash: hash(bt), outcome: bt.outcome.kind, years: bt.rows.length,
            endWealth: last ? last.wertAktien + last.wertGold + last.liquiditaet : null,
            cutYears: bt.rows.filter(r => (r.row?.flex_haushalt_kuerzung_pct ?? r.entscheidung?.kuerzungProzent) > 0).length,
            ...(bt.outcome.kind === 'incomplete' ? { details: bt.outcome } : {}) };
    });
    result.cases[key] = m;
    console.log(JSON.stringify({ key, ...m }));
    writeFileSync(process.argv[2] || '/tmp/vf2a-messung.json', JSON.stringify(result, null, 2) + '\n');
}
