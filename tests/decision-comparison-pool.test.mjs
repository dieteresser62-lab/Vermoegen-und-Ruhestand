import { readEV1bReferences } from './helpers/ev-1b-expectations.mjs';
const readZG1References = value => readEV1bReferences(readBeforeEV1bReferences(value));
import { readZG1References as readBeforeEV1bReferences } from './helpers/zg-1-expectations.mjs';
import { readEV1References as readBeforeZG1References } from './helpers/ev-1-expectations.mjs';
const readEV1References = value => readZG1References(readBeforeZG1References(value));
import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readVF2BReferences as readBeforePA1References } from './helpers/vf-2b-expectations.mjs';
import { readPA1References } from './helpers/pa-1-expectations.mjs';
const readVF2BReferences = value => readQSCReferences(readPA1References(readBeforePA1References(value)));
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import nodeAssert from 'node:assert/strict';
const assert = globalThis.__wrapExternalAssert?.(nodeAssert) ?? nodeAssert;
import { createHash } from 'node:crypto';
import { measurementInputs, parameters } from './helpers/ek-1b-measurement.mjs';
import { DecisionNodeWorker } from './helpers/decision-worker-adapter.mjs';
import { runDecisionComparison, createDecisionComparisonSession, createDecisionVariant,
    decisionComparisonRunCount, comparisonIdentity } from '../app/simulator/decision-comparison.js';
import { runTargetBudgetSearch } from '../app/simulator/target-budget-search.js';
import { renderDecisionResult } from '../app/simulator/decision-comparison-ui.js';
import { readPersistedRecords, flush } from '../app/shared/persistence-facade.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio.js';

for (const [standard, reduced] of [[10000, 1000], [2000, 500], [300, 300], [1234, 500]])
    assert.equal(decisionComparisonRunCount(standard), reduced);
const inputs = await measurementInputs(0, 'max-erika');
await flush();
const saved = JSON.stringify(await readPersistedRecords()), fixed = JSON.stringify(getCommonInputs());
const inputBytes = JSON.stringify(inputs);
const options = { inputs, monteCarloParams: { ...parameters, anzahl: 24 },
    workerConfig: { workerCount: 4 }, diagnosticRuns: 24, captureLogs: true };
const checksum = result => createHash('sha256').update(JSON.stringify({
    paths: result.chunk.pathSummaries, budgets: result.budgets })).digest('hex');
const previousWorker = globalThis.Worker;
try {
    delete globalThis.Worker;
    const serial = await runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 500 } });
    globalThis.Worker = DecisionNodeWorker;
    const progress = [];
    const comparisonWorkers = DecisionNodeWorker.instances.length;
    const pooled = await runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 500 },
        onProgress: (pct, detail) => progress.push({ pct, ...detail }) });
    for (const plan of ['baseline', 'variant']) {
        assert.deepEqual(pooled[plan].metrics, serial[plan].metrics);
        assert.equal(checksum(pooled[plan]), checksum(serial[plan]));
        assert.deepEqual(pooled[plan].diagnostics, serial[plan].diagnostics);
        assert.deepEqual(pooled[plan].chunk.runMeta, serial[plan].chunk.runMeta);
    }
    assert.equal(pooled.worsePct, serial.worsePct);
    assert.equal(DecisionNodeWorker.instances.length - comparisonWorkers, 4, 'Ein Pool für beide Vergleichspläne');
    assert.ok(DecisionNodeWorker.instances.every(worker => worker.terminated));
    // Referenz vor VS-1b, bereits mit dem Datenstand nach KETTE TB.
    assert.equal(checksum(pooled.baseline), readEV1References(readQSCReferences(readVF2BReferences(readGL1References('a96ddabcf9286552785a6406175a5a3b133d150ce19357a847a2c710bf67a6ce')))));
    assert.equal(checksum(pooled.variant), readEV1References(readQSCReferences(readVF2BReferences(readGL1References('244b5d9c72c108b27e8764e46ad426b7b2a7cb6becbed0b5f7181e1e34f2ade4')))));
    assert.ok(progress.some(row => row.completedRuns > 0 && row.completedRuns < 24));
    assert.ok(progress.every((row, i) => !i || row.pct >= progress[i - 1].pct));
    console.log('VS-1 Vergleich SHA256', checksum(pooled.baseline), checksum(pooled.variant));

    // Suchschritte: Ausgangsruin, geretteter Plan, anderer Replay, erneut geretteter Plan.
    const strained = { ...options, inputs: { ...inputs, startFlexBedarf: 300000 }, isolateReplays: true };
    const evaluate = async () => {
        const session = createDecisionComparisonSession(strained);
        try {
            const baseline = await session.run(session.baselineInputs, { record: true });
            const rescued = createDecisionVariant(session.baselineInputs, { kind: 'budget', monthly: -20000 });
            const first = await session.run(rescued);
            await session.run(createDecisionVariant(session.baselineInputs, { kind: 'budget', monthly: -22000 }));
            assert.deepEqual(await session.run(rescued), first);
            assert.ok(baseline.chunk.totals.failCount > first.chunk.totals.failCount);
            return first;
        } finally { session.dispose(); }
    };
    const poolStep = await evaluate();
    delete globalThis.Worker;
    const serialStep = await evaluate();
    assert.deepEqual(poolStep.metrics, serialStep.metrics);
    assert.equal(checksum(poolStep), checksum(serialStep));
    assert.equal(checksum(poolStep), readEV1References(readQSCReferences(readVF2BReferences(readGL1References('f4ce36cbd93c3d38b9dbf88db996a31f16ec76c840e77fdebb3421ac86f32c9c')))));
    assert.deepEqual(poolStep.diagnostics, serialStep.diagnostics);
    assert.deepEqual(poolStep.chunk.runMeta, serialStep.chunk.runMeta);
    console.log('VS-1 Suchschritt nach Ruin SHA256', checksum(poolStep));
    const searchOptions = { ...options, diagnosticRuns: 0, captureLogs: false,
        goals: { coveragePct: 99, affectedPct: 10 }, maximumMonthly: 2750 };
    const serialSearch = await runTargetBudgetSearch(searchOptions);
    globalThis.Worker = DecisionNodeWorker;
    const searchWorkers = DecisionNodeWorker.instances.length;
    const poolSearch = await runTargetBudgetSearch(searchOptions);
    assert.equal(DecisionNodeWorker.instances.length - searchWorkers, 4, 'Ein Pool für Suche und Endprobe');
    assert.ok(DecisionNodeWorker.instances.every(worker => worker.terminated));
    assert.deepEqual(poolSearch.observations, serialSearch.observations);
    assert.equal(poolSearch.monthly, serialSearch.monthly);
    assert.equal(poolSearch.comparison.worsePct, serialSearch.comparison.worsePct);

    for (const phase of ['search', 'verification']) {
        const abortSearch = new AbortController();
        const workersBefore = DecisionNodeWorker.instances.length;
        await assert.rejects(runTargetBudgetSearch({ ...searchOptions,
            monteCarloParams: { ...parameters, anzahl: phase === 'verification' ? 501 : 24 }, signal: abortSearch.signal,
            onProgress: (pct, detail) => {
                if ((detail.phase === 'verification') === (phase === 'verification') && detail.completedRuns > 0)
                    abortSearch.abort();
            } }), /abort|abgebrochen/i);
        assert.equal(DecisionNodeWorker.instances.length - workersBefore, 4);
        assert.ok(DecisionNodeWorker.instances.every(worker => worker.terminated), `Pool nach Abbruch in ${phase} beendet`);
        assert.equal((await runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 500 } })).worsePct, serial.worsePct);
    }

    const abort = new AbortController();
    await assert.rejects(runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 500 },
        signal: abort.signal, onProgress: () => abort.abort() }), /abort|abgebrochen/i);
    assert.ok(DecisionNodeWorker.instances.every(worker => worker.terminated));
    assert.equal((await runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 500 } })).worsePct, serial.worsePct);
    let identity = comparisonIdentity(options);
    await assert.rejects(runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 500 },
        readCurrentIdentity: () => identity, onProgress: () => { identity = 'changed'; } }), /Vergleich nicht möglich/);
    // Auch ein vorhandenes, aber nicht startbares Worker-System fällt zurück.
    globalThis.Worker = class { constructor() { throw new Error('Worker nicht verfügbar'); } };
    assert.equal((await runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 500 } })).worsePct, serial.worsePct);
    for (const count of [2000, 1000]) {
        const view = structuredClone(serial);
        view.baseline.metrics.affectedPct = 33 / count * 100;
        view.variant.metrics.affectedPct = 35 / count * 100;
        view.differences.affectedPct = .123456;
        view.params = { ...view.params, anzahl: 1000, standardRuns: 10000 };
        const html = renderDecisionResult(view);
        assert.ok(html.includes(count === 2000 ? '1,65 %' : '3,30 %'));
        assert.ok(html.includes(count === 2000 ? '1,75 %' : '3,50 %'));
        assert.ok(html.includes(count === 2000 ? '+0,10 Pp' : '+0,20 Pp'));
        assert.match(html, /1\.000 Läufe je Plan \(Einstellung 10\.000 ÷ 10\)/);
        assert.match(html, /Werte des Ausgangsplans können leicht/);
        view.baseline.metrics.coveragePct = 99.999;
        assert.match(renderDecisionResult(view), /> 99,99 %/);
        view.params.standardRuns = 1000;
        assert.doesNotMatch(renderDecisionResult(view), /Werte des Ausgangsplans können leicht/);
    }
    for (const [standardRuns, anzahl, text] of [
        [10000, 1000, '1.000 Läufe je Plan (Einstellung 10.000 ÷ 10)'],
        [2000, 500, '500 Läufe je Plan (Einstellung 2.000, mindestens 500)'],
        [300, 300, '300 Läufe je Plan · Seed'],
        [10500, 1100, '1.100 Läufe je Plan (Einstellung 10.500 ÷ 10, auf volle Hundert aufgerundet)']
    ]) {
        const view = { ...serial, params: { ...serial.params, anzahl, standardRuns } };
        assert.ok(renderDecisionResult(view).includes(text));
        const html = renderDecisionResult(view, { targetSearch: { ...poolSearch, params: view.params } });
        assert.ok(html.includes(`Suche mit ${anzahl.toLocaleString('de-DE')} Läufen je Schritt`));
        assert.ok(html.includes(`Endprobe mit ${standardRuns.toLocaleString('de-DE')} Läufen`));
        assert.doesNotMatch(html, /Läufe je Plan/);
    }
    assert.equal(JSON.stringify(inputs), inputBytes);
    assert.equal(JSON.stringify(getCommonInputs()), fixed);
    assert.equal(JSON.stringify(await readPersistedRecords()), saved);
} finally {
    if (previousWorker === undefined) delete globalThis.Worker; else globalThis.Worker = previousWorker;
}
console.log('VS-1: Laufzahl, Pool-Parität, Suchschritte, Marktfortsetzung, Abbruch, Rückfall und Planbytes grün.');
