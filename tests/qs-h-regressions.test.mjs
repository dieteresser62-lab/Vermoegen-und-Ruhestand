import nodeAssert from 'node:assert/strict';
const assert = globalThis.__wrapExternalAssert?.(nodeAssert) ?? nodeAssert;
import { measurementInputs, parameters } from './helpers/ek-1b-measurement.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { buildSweepInputs, runSweepChunk } from '../app/simulator/sweep-runner.js';
import { writeBoundHouseholdPlanField } from '../app/shared/household-plan-fields.js';
import { getSimulatorPlanTrial } from '../app/simulator/simulator-plan-trial.js';
import { AUTO_OPTIMIZE_METRIC_RESULT_VERSION } from '../app/simulator/auto-optimize-metrics.js';
import { runAutoOptimize } from '../app/simulator/auto_optimize.js';
import { evaluateCandidate } from '../app/simulator/auto-optimize-evaluate.js';
import { applyChampionToForm } from '../app/simulator/auto-optimize-apply.js';
import { runTargetBudgetSearch } from '../app/simulator/target-budget-search.js';
import { quantile } from '../app/simulator/simulator-utils.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio.js';
import { createStressReplayCaptureRequest, materializeStressReplayPathV1 } from '../app/simulator/stress-replay-path-materializer.js';
import { createStressReplayFingerprint, createStressReplaySourceIdentityV2 } from '../app/simulator/stress-replay-contract.js';
import { runStressReplayPathV1 } from '../app/simulator/stress-replay-runner.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { buildProbelaufTransferRecords } from '../app/shared/probelauf-records.js';

const mcParams = { ...parameters, anzahl: 10, maxDauer: 10 };
const mc = (inputs, params = mcParams, extra = {}) => runMonteCarloChunk({ inputs, engine: EngineAPI,
    widowOptions: inputs.widowOptions, monteCarloParams: params, useCapeSampling: false,
    runRange: { start: 0, count: params.anzahl }, ...extra });
const p50 = chunk => quantile([...chunk.pathSummaries.finalValueNominalEur], .5);
const optimize = overrides => runAutoOptimize({ objective: { metric: 'EndWealth_P50', direction: 'max' },
    params: { liquidityRunwayYears: { min: 7, max: 7, step: 1 } }, runsPerCandidate: 10,
    seedsTrain: 1, seedsTest: 1, constraints: {}, maxDauer: 10, ...overrides });
const fixedMetrics = { metricContract: { schemaVersion: AUTO_OPTIMIZE_METRIC_RESULT_VERSION }, successProbFloor: 1,
    medianEndWealth: 1000000, worst5Drawdown: .2, timeShareWRgt45: 0, medianWithdrawalRate: .03, depletionRate: 0 };

const cases = [
    async function sweepHorizon() {
        const inputs = { ...await measurementInputs(0, 'max-erika'), dynamicFlex: true, goGoActive: true };
        const params = { liquidityRunwayYears: inputs.liquidityRunwayYears, goldRebalancingBand: inputs.rebalancingBand,
            maxSkimPct: inputs.maxSkimPctOfEq, maxBearRefillPct: inputs.maxBearRefillPctOfEq,
            goldTargetPct: inputs.goldZielProzent, survivalQuantile: inputs.survivalQuantile, goGoMultiplier: inputs.goGoMultiplier };
        const run = candidate => runSweepChunk({ baseInputs: inputs, paramCombinations: [candidate],
            comboRange: { start: 0, count: 1 }, sweepRequest: { monteCarloParameters: mcParams, useCapeSampling: false } }).results[0];
        const normal = await mc(inputs), sweep = run(params), explicit = run({ ...params, horizonYears: inputs.horizonYears });
        console.log('QS-H 1 Messung', JSON.stringify({ mc: p50(normal), sweep: sweep.metrics.medianEndWealth,
            explicit: explicit.metrics.medianEndWealth, fingerprint: sweep.provenance.samplingFingerprint }));
        assert.equal(buildSweepInputs(inputs, {}).horizonYears, inputs.horizonYears, 'QS-H 1: fehlende Overrides erhalten Planwerte');
        assert.equal(sweep.metrics.medianEndWealth, explicit.metrics.medianEndWealth);
        assert.ok(Math.abs(p50(normal) - sweep.metrics.medianEndWealth) < .001, 'QS-H 1: identischer Sweep entspricht MC');
    },
    async function championMode() {
        await measurementInputs(0, 'max-erika');
        getSimulatorPlanTrial().start();
        document.getElementById('dynamicFlex').checked = true;
        const result = await optimize({ dynamicFlexMode: 'force_off', evaluateCandidateFn: async () => ({ ...fixedMetrics }) });
        const before = document.getElementById('liquidityRunwayYears').value;
        assert.throws(() => applyChampionToForm({ championCfg: result.championCfg }),
            error => error.code === 'AUTO_OPTIMIZE_APPLY_CONTEXT_MISMATCH', 'QS-H 2: Gegenmodus vor Mutation ablehnen');
        assert.equal(document.getElementById('liquidityRunwayYears').value, before);
        document.getElementById('dynamicFlex').checked = false;
        const receipt = applyChampionToForm({ championCfg: result.championCfg });
        assert.equal(receipt.requestFingerprint, result.parameterFidelity.requestFingerprint);
        assert.equal(document.getElementById('dynamicFlex').checked, false);
        assert.equal(Number(document.getElementById('liquidityRunwayYears').value), 7);
        assert.equal(getCommonInputs().dynamicFlex, false, 'QS-H 2: wirksame Laufeingaben behalten den Bewertungsmodus');
        assert.equal(getCommonInputs().liquidityRunwayYears, 7);
        const forcedOn = await optimize({ dynamicFlexMode: 'force_on', evaluateCandidateFn: async () => ({ ...fixedMetrics }) });
        assert.throws(() => applyChampionToForm({ championCfg: forcedOn.championCfg }),
            error => error.code === 'AUTO_OPTIMIZE_APPLY_CONTEXT_MISMATCH', 'QS-H 2: auch force_on bei ausgeschaltetem Formular ablehnen');
    },
    async function capeTransfer() {
        for (const kind of ['localstorage', 'indexeddb', 'tauri']) {
            const records = createMusterHaushaltRecords('2026-10-16');
            const plan = JSON.parse(records.household_plan_v1);
            Object.values(plan.entries)[0].values.cape = { value: 30, asOf: '2026-10-16', source: 'manual' };
            records.household_plan_v1 = JSON.stringify(plan);
            const fixture = await playFixture(kind, records);
            let controller = await fixture.boot();
            await controller.start(() => ({ source: 'copy', testDate: null }));
            controller = await fixture.boot();
            P.setItemSync('profile_tagesgeld', '19000'); await P.flush();
            const real = fixture.areas.makeAdapter('echt'); await real.open();
            Object.values(plan.entries)[0].values.cape = { value: 40, asOf: '2026-10-17', source: 'annual' };
            await real.saveBatch({ deletes: [], upserts: [['household_plan_v1', JSON.stringify(plan)]] }); real.close?.();
            const review = await controller.readEndReview();
            assert.equal(review.transfer.eligible, true);
            assert.equal(review.changes.count, 1);
            await controller.end(() => ({ action: 'transfer', review })); await fixture.boot();
            assert.equal(P.getItemSync('profile_tagesgeld'), '19000');
            assert.deepEqual(Object.values(JSON.parse(P.getItemSync('household_plan_v1')).entries)[0].values.cape,
                Object.values(plan.entries)[0].values.cape, `QS-H 3: ${kind} erhält echtes CAPE samt Herkunft nach Neustart`);
        }
        // Altstand ohne CAPE darf weder einen alten Spielwert einschleusen noch einen neuen echten löschen.
        const record = cape => JSON.stringify({ version: 1, entries: { x: { values: { flexBedarf: 1000, ...(cape ? { cape } : {}) } } } });
        for (const [realCape, playCape] of [[undefined, { value: 30 }], [{ value: 40 }, undefined]]) {
            const target = buildProbelaufTransferRecords({ household_plan_v1: record(realCape) }, { household_plan_v1: record(playCape) });
            assert.deepEqual(JSON.parse(target.household_plan_v1).entries.x.values.cape, realCape);
        }
    },
    async function healthReplay() {
        const inputs = await measurementInputs(0, 'max-erika');
        inputs.healthBucket = { ...inputs.healthBucket, enabled: true, initialAmount: 50000 };
        const params = { ...mcParams, anzahl: 1, maxDauer: 1 };
        const chunk = await mc(inputs, params, { logIndices: [0], stressReplayCapture: createStressReplayCaptureRequest([0]) });
        const meta = chunk.runMeta[0], rows = meta.logDataRows;
        const path = materializeStressReplayPathV1({ capture: meta.stressReplayCapture, sourceLogRows: rows,
            sourceRequest: { inputs, widowOptions: inputs.widowOptions, monteCarloParams: params, useCapeSampling: false },
            dataFingerprint: createStressReplayFingerprint({ data: 'qs-h' }), engineFingerprint: createStressReplayFingerprint({ engine: EngineAPI.version }),
            scenarioKey: 'qs-h', selectionMetric: 'nominal_terminal_wealth_eur' });
        const replay = source => runStressReplayPathV1({ path, baselineInputs: inputs, engine: EngineAPI, ...source });
        const result = replay({ sourceScenarioLog: rows });
        console.log('QS-H 4 Messung', JSON.stringify({ mc: p50(chunk), replay: result.summary.finalValueNominalEur,
            bucket: rows[0].health_bucket_end, matched: result.reconciliation.matched }));
        assert.equal(result.reconciliation.matched, true);
        assert.ok(Math.abs(p50(chunk) - result.summary.finalValueNominalEur) < .001, 'QS-H 4: Endvermögen enthält denselben Gesundheitstopf');
        for (const field of ['health_bucket_end', 'portfolio_total_end']) {
            const changed = structuredClone(rows); changed[0][field] += 100;
            for (const source of [{ sourceScenarioLog: changed }, { sourceIdentity: createStressReplaySourceIdentityV2({ path, sourceRows: changed }) }]) {
                assert.throws(() => replay(source), error => error.code === 'STRESS_REPLAY_BASELINE_RECONCILIATION_FAILED',
                    `QS-H 4: ${field} im direkten und gespeicherten Abgleich prüfen`);
            }
        }
    },
    async function unchangedCurrent() {
        const base = await measurementInputs(0, 'max-erika');
        getSimulatorPlanTrial().start();
        document.getElementById('dynamicFlex').checked = true;
        document.getElementById('goGoActive').checked = false;
        writeBoundHouseholdPlanField(document.getElementById('goGoMultiplier'), 1.3);
        const calls = [];
        const result = await optimize({ params: { goGoMultiplier: { min: 1.3, max: 1.3, step: .05 } },
            evaluateCandidateFn: async (candidate, inputs, runs, years, seeds, constraints, contract, options) => {
                let effective;
                await evaluateCandidate(candidate, inputs, runs, years, seeds, constraints, contract, { ...options,
                    runMonteCarlo: async request => { effective = request.inputs; throw new Error('qs-h-capture'); } }).catch(error => {
                    if (error.message !== 'qs-h-capture') throw error;
                });
                calls.push(effective);
                return { ...fixedMetrics, medianEndWealth: effective.goGoActive ? 900000 : 1000000 };
            } });
        assert.equal(calls.at(-1).goGoActive, false, 'QS-H 5: aktuelle Referenz bleibt ausgeschaltet');
        assert.ok(calls.slice(0, -1).every(inputs => inputs.goGoActive === true));
        assert.equal(result.deltaVsCurrent.endWealthP50, -100000);
        assert.equal(base.goGoActive, false);
    },
    async function targetGrid() {
        const inputs = { ...await measurementInputs(0, 'sophie'), dynamicFlex: false, startFlexBedarf: 18900 };
        const options = { inputs, engine: EngineAPI, monteCarloParams: { ...mcParams, anzahl: 3, maxDauer: 35 },
            useCapeSampling: false, diagnosticRuns: 0, captureLogs: false, goals: { coveragePct: 100, affectedPct: 0 } };
        const found = await runTargetBudgetSearch({ ...options, inputs: { ...inputs, minimumFlexAnnual: 2000 } });
        console.log('QS-H 6 Messung', JSON.stringify({ status: found.status, monthly: found.monthly,
            steps: found.observations.map(point => point.monthly) }));
        assert.equal(found.status, 'found');
        assert.equal(found.monthly % 50, 0, 'QS-H 6: Ergebnis liegt auch bei 1575 Euro Ausgangsbedarf auf dem Raster');
        assert.equal(found.finalVerification.attempts.at(-1).monthly, found.monthly);
        const lower = await runTargetBudgetSearch({ ...options, inputs: { ...inputs, minimumFlexAnnual: 18840 } });
        assert.equal(lower.lowerMonthly, 1600);
        assert.equal(lower.status, 'unreachable');
        console.log('QS-H 6 Untergrenze', JSON.stringify({ status: lower.status, observations: lower.observations }));
        const evaluated = lower.observations.find(point => point.monthly === lower.lowerMonthly);
        assert.ok(evaluated, 'QS-H 6: aufgerundete Untergrenze wird tatsächlich gerechnet');
        if (lower.status === 'unreachable') assert.deepEqual(lower.lowerMetrics, evaluated.metrics);
        else assert.equal(lower.monthly % 50, 0);
        assert.equal(inputs.startFlexBedarf, 18900);
    }
];
const failures = [];
for (const [index, run] of cases.entries()) {
    if (process.env.QS_H_CASE && Number(process.env.QS_H_CASE) !== index + 1) continue;
    try { await run(); console.log(`QS-H ${index + 1}: grün`); }
    catch (error) { failures.push(error); console.error(`QS-H ${index + 1}: ${error.message}`); }
    finally { P.resetPersistenceRuntimeForTests(); }
}
if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('\n'));
