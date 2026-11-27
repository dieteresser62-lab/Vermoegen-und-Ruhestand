import nodeAssert from 'node:assert/strict';
const assert = globalThis.__wrapExternalAssert?.(nodeAssert) ?? nodeAssert;
import { measurementInputs, parameters } from './helpers/ek-1b-measurement.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { runTargetBudgetSearch } from '../app/simulator/target-budget-search.js';
import { quantile } from '../app/simulator/simulator-utils.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { buildProbelaufTransferRecords } from '../app/shared/probelauf-records.js';

const mcParams = { ...parameters, anzahl: 10, maxDauer: 10 };
const mc = (inputs, params = mcParams, extra = {}) => runMonteCarloChunk({ inputs, engine: EngineAPI,
    widowOptions: inputs.widowOptions, monteCarloParams: params, useCapeSampling: false,
    runRange: { start: 0, count: params.anzahl }, ...extra });
const p50 = chunk => quantile([...chunk.pathSummaries.finalValueNominalEur], .5);
const cases = [
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
    async function healthMonteCarlo() {
        const inputs = await measurementInputs(0, 'max-erika');
        inputs.healthBucket = { ...inputs.healthBucket, enabled: true, initialAmount: 50000 };
        const params = { ...mcParams, anzahl: 1, maxDauer: 1 };
        const chunk = await mc(inputs, params, { logIndices: [0] });
        const rows = chunk.runMeta[0].logDataRows, last = rows.at(-1);
        console.log('QS-H 4 Messung', JSON.stringify({ mc: p50(chunk), logged: last.portfolio_total_end,
            bucket: last.health_bucket_end }));
        assert.ok(last.health_bucket_end > 0, 'QS-H 4: Gesundheitstopf ist im MC-Protokoll belegt');
        assert.ok(last.portfolio_total_end >= last.health_bucket_end, 'QS-H 4: Protokoll-Endvermögen schließt den Gesundheitstopf ein');
        assert.ok(Math.abs(p50(chunk) - last.portfolio_total_end) < .001, 'QS-H 4: MC-Endvermögen enthält denselben Gesundheitstopf wie das Protokoll');
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
