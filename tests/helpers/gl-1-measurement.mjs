// Nur synthetische Muster, außerhalb von npm test. Ausgabe.json [--before] [--cap-factor=0.7].
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
const outputFile = process.argv[2];
if (!outputFile || outputFile.startsWith('--')) throw new Error('Ausgabedatei fehlt.');
const before = process.argv.includes('--before');
const factor = Number(process.argv.find(arg => arg.startsWith('--cap-factor='))?.split('=')[1] ?? 1);
if (!Number.isFinite(factor) || factor <= 0) throw new Error('Ungültiger Empfindlichkeitsfaktor.');
const evidence = JSON.parse(readFileSync(new URL('../fixtures/gl-1-expectation-deltas.json', import.meta.url)));
const oldGuardrails = before ? execFileSync('git', ['show', `${evidence.baselineCommit}:engine/planners/spending-guardrails.mjs`], { encoding: 'utf8' }) : null;
if (before) assert.equal(createHash('sha256').update(oldGuardrails).digest('hex'), evidence.beforeGuardrailsSha256);
registerHooks({ load(url, context, next) {
    if (!url.endsWith('/engine/planners/spending-guardrails.mjs')) return next(url, context);
    if (before) return { format: 'module', source: oldGuardrails, shortCircuit: true };
    const result = next(url, context);
    return { ...result, source: String(result.source).replace('params.depotwertGesamt * CONFIG.THRESHOLDS.CAUTION.withdrawalRate',
        `params.depotwertGesamt * CONFIG.THRESHOLDS.CAUTION.withdrawalRate * ${factor}`) };
} });
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const projectRoot = resolve(import.meta.dirname, '../..');
export const fixedDate = '2026-10-15';
export async function loadRuntime(root = projectRoot) {
    const load = file => import(pathToFileURL(resolve(root, file)).href);
    const { EngineAPI } = await load('engine/index.mjs');
    const { createMusterHaushaltRecords } = await load('app/demo/muster-haushalt.js');
    const { dynamicFlexPresetPatch } = await load('app/shared/dynamic-flex-presets.js');
    return { root, load, EngineAPI, createMusterHaushaltRecords, dynamicFlexPresetPatch };
}

// Gleicher Formularweg wie tests/muster-haushalt-simulator.test.mjs.
// Der Speicher enthält ausschließlich neu erzeugte Musterrecords.
export async function musterSimulator(runtime, id, dynamic = true) {
    const { load, EngineAPI, createMusterHaushaltRecords } = runtime;
    const records = createMusterHaushaltRecords(fixedDate, id);
    const { PersistenceFacade } = await load('app/shared/persistence-facade.js');
    PersistenceFacade.resetPersistenceForTests({ name: 'GL-1 synthetic only', async init() {},
        async loadAll() { return { ...records }; }, async saveBatch() {} });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const { simulatorDocument } = await load('tests/simulator-page-fixture.mjs');
    const doc = simulatorDocument();
    globalThis.document = doc;
    globalThis.window = { EngineAPI, addEventListener() {}, removeEventListener() {} };
    const { initInputPersistence } = await load('app/simulator/simulator-main-input-persist.js');
    const { initDynamicFlexControls } = await load('app/simulator/simulator-main-dynamic-flex.js');
    const { initSimulatorProfileSelection } = await load('app/simulator/simulator-main-profiles.js');
    const { initSimulatorPlanTrial, getSimulatorPlanTrial } = await load('app/simulator/simulator-plan-trial.js');
    initInputPersistence();
    initDynamicFlexControls({ enableLocalPersistence: false });
    initSimulatorProfileSelection();
    initSimulatorPlanTrial();
    if (window.__profileRecoveryBlocker) throw new Error(JSON.stringify(window.__profileRecoveryBlocker));
    if (dynamic) {
        getSimulatorPlanTrial(doc).start();
        doc.getElementById('dynamicFlexPreset').value = 'ausgewogen';
        doc.getElementById('dynamicFlexPreset').dispatchEvent({ type: 'change' });
    }
    const { getCommonInputs } = await load('app/simulator/simulator-portfolio.js');
    const { validateSimulatorInputs } = await load('app/simulator/simulator-input-validation.js');
    const inputs = structuredClone(validateSimulatorInputs(getCommonInputs()));
    const useCapeSampling = doc.getElementById('useCapeSampling').checked;
    PersistenceFacade.resetPersistenceRuntimeForTests();
    return { records, inputs, useCapeSampling };
}

export async function musterBalance(runtime, id = 'max-erika') {
    const { load, createMusterHaushaltRecords, dynamicFlexPresetPatch } = runtime;
    const records = createMusterHaushaltRecords(fixedDate, id);
    const plan = JSON.parse(records.household_plan_v1);
    for (const entry of Object.values(plan.entries)) Object.assign(entry.values, dynamicFlexPresetPatch('ausgewogen'));
    records.household_plan_v1 = JSON.stringify(plan);
    const { annualRecordStorage } = await load('app/balance/balance-annual-storage.js');
    const { buildBalanceEngineInputFromStorage } = await load('app/balance/balance-input-storage.js');
    return buildBalanceEngineInputFromStorage({ storage: annualRecordStorage(records), referenceYear: 2026 });
}

export function quantile(values, p) {
    const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * p;
    const low = Math.floor(position), high = Math.ceil(position);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

const runtime = await loadRuntime();
const { runMonteCarloChunk } = await runtime.load('app/simulator/monte-carlo-runner.js');
const { backtest } = await runtime.load('tests/helpers/ek-1b-measurement.mjs');
const params = { anzahl: 2000, maxDauer: 35, blockSize: 5, seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM', excludeEstimatedHistory: false };
const version = factor !== 1 ? `sensitivity-${factor}` : before ? 'before' : 'after';
const output = { fixedDate, params, dynamicFlex: 'ausgewogen', care: true, scenarios: {} };
for (const household of ['max-erika', 'sophie', 'renate', 'gross']) {
 const { inputs, useCapeSampling } = await musterSimulator(runtime, household === 'gross' ? 'max-erika' : household);
 if (household === 'gross') {
  inputs.home = [{ id: 'haus', profileId: 'muster_a', bezeichnung: 'Haus', nutzung: 'selbst', wert: 800000, stand: '2026-10', mieteNetto: 0, anpassung: 'keine' }];
  inputs.homeReferenceYear = 2026;
  for (const [id, target] of [['muster_a', 2700000], ['muster_b', 300000]]) {
   const person = inputs.simulationPeople.find(p => p.profileId === id), lots = inputs.detailledTranches.filter(l => l.sourceProfileId === id);
   const factor = target / (person.tagesgeld + lots.reduce((s,l) => s + l.marketValue,0));
   person.tagesgeld *= factor;
   for (const lot of lots) { lot.marketValue *= factor; lot.costBasis *= factor; lot.shares *= factor; }
  }
  inputs.startVermoegen = 3000000;
  inputs.tagesgeld = inputs.simulationPeople.reduce((s,p) => s + p.tagesgeld,0);
  inputs.geldmarktEtf = inputs.detailledTranches.filter(l => l.category === 'money_market').reduce((s,l) => s+l.marketValue,0);
  inputs.depotwertAlt = 3000000 - inputs.tagesgeld - inputs.geldmarktEtf;
  inputs.einstandAlt = inputs.detailledTranches.filter(l => l.category === 'equity').reduce((s,l) => s+l.costBasis,0);
  inputs.partner.careToday = { grade: 2, progression: 'usual' };
  inputs.partnership = { schemaVersion: 1, status: 'unmarried', inheritance: { muster_a: 0, muster_b: 0 }, homeAndTaxInheritance: { muster_a: true } };
 }
 const real = [], started = Date.now(); let ruins = 0;
 for(let start=0; start<2000; start+=100) {
  const chunk = await runMonteCarloChunk({ inputs, useCapeSampling, monteCarloParams: params, widowOptions: inputs.widowOptions, engine: runtime.EngineAPI, runRange: {start,count:100}, logIndices: [] });
  assert.equal(chunk.technicalInventory.technicalError,0);
  assert.equal(chunk.technicalInventory.financiallyEvaluable,100);
  ruins += chunk.totals.failCount; real.push(...chunk.pathSummaries.finalValueRealEur);
  if((start+100)%500===0) console.log(`${version}/${household}: ${start+100}/2000`);
 }
 const historical = backtest(inputs,1965,1999);
 assert.ok(['completed', 'ruin'].includes(historical.outcome.kind), JSON.stringify(historical.outcome));
 output.scenarios[household] = { inputs, useCapeSampling, coveredPct: (2000-ruins)/20, ruins, medianRealEnd: quantile(real,.5), seconds: (Date.now()-started)/1000,
  historical: {period:'1965–1999',outcome:historical.outcome, rows:historical.rows.length, last:historical.rows.at(-1)} };
 writeFileSync(outputFile,JSON.stringify(output,null,2));
 console.log(JSON.stringify({household,...output.scenarios[household],inputs:undefined,historical:undefined}));
}
process.exit(0);
