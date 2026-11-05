import nodeAssert from 'node:assert/strict';
const assert = globalThis.__wrapExternalAssert?.(nodeAssert) ?? nodeAssert;
import { readFileSync } from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { CONFIG } from '../engine/config.mjs';
import { applyGuardrails } from '../engine/planners/spending-guardrails.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { projectBalanceBudget } from '../app/balance/balance-budget.js';
import { inputs as simulatorSample } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { resolveDynamicFlexRunnerHorizon } from '../app/simulator/dynamic-flex-runner-horizon.js';
const records = createMusterHaushaltRecords('2026-10-15', 'max-erika');
const plan = JSON.parse(records.household_plan_v1);
for (const entry of Object.values(plan.entries)) Object.assign(entry.values, dynamicFlexPresetPatch('ausgewogen'));
records.household_plan_v1 = JSON.stringify(plan);
const { engineInput } = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, referenceYear: 2026 });
const base = { ...engineInput, endeVJ: 100, endeVJ_1: 95, endeVJ_2: 90, endeVJ_3: 85,
    ath: 100, jahreSeitAth: 0, inflation: 0, marketCapeRatio: 25, capeRatio: 25,
    depotwertAlt: 0, costBasisAlt: 0, geldmarktEtf: 0, detailledTranches: [], minimumFlexAnnual: 0,
    sparerPauschbetrag: 2000, deferTaxSettlement: false, renteAktiv: true };
delete base.goldStrategyDiagnostics; delete base.goldBasisVermoegen;
function calculate([depot, liquidity, floor, flex], income) {
    const input = { ...base, depotwertNeu: depot, costBasisNeu: depot * .8, tagesgeld: liquidity,
        floorBedarf: floor, flexBedarf: flex, renteMonatlich: income };
    const result = EngineAPI.simulateSingleYear(input, null, { includeFlexTrace: true });
    assert.ok(!result.error);
    return { ...projectBalanceBudget({ ...result.ui, input }), result };
}
function noJump(before, after, lostIncome) {
    assert.ok(after.withdrawal >= before.withdrawal - 1e-7, 'Weniger Einkünfte senken die Entnahme nicht');
    const rounding = after.result.ui.spending.flexTrace.at(-1).kennzahlen.stufeEurMonat;
    assert.ok(after.budget >= before.budget - lostIncome - rounding - 1e-7,
        'Budgetrückgang höchstens Einkommensverlust plus eine Rundungsstufe');
}
const floorTraceCases = new Set();
function checkFloorTrace(result) {
    const trace = result.ui.spending.flexTrace.find(step => step.schritt === 'guardrails');
    const limited = result.diagnosis.guardrails.some(rule => rule.name === 'Vorsicht beim Budget-Floor' && rule.details?.budgetFloorBlocked);
    assert.equal(trace.kennzahlen.budgetFloorBegrenzt, limited, 'Trace nennt eine bindende FR-60-Begrenzung');
    assert.equal(trace.kennzahlen.budgetFloorGesperrt, limited && trace.rateNachher <= trace.rateVorher,
        'Nur vollständig verhinderte Anhebung heißt gesperrt');
    floorTraceCases.add(limited ? trace.rateNachher > trace.rateVorher ? 'teilweise' : 'gesperrt' : 'unbegrenzt');
}
// Sechs MO-1-Konstellationen, jeweils dieselben 81 Einkommen und kein Vorjahresanker.
const grid = [[1500000, 300000, 24000, 40000], [1500000, 450000, 36000, 80000],
    [2500000, 300000, 36000, 40000], [2500000, 450000, 24000, 60000],
    [3500000, 300000, 24000, 80000], [3500000, 450000, 36000, 80000]];
for (const config of grid) {
    let previous = calculate(config, 4000);
    for (let income = 3950; income >= 0; income -= 50) {
        const next = calculate(config, income);
        noJump(previous, next, 50); checkFloorTrace(next.result); previous = next;
    }
}
assert.deepEqual([...floorTraceCases].sort(), ['gesperrt', 'teilweise', 'unbegrenzt'], 'Raster enthält volle Sperre, Teilanhebung und Anhebung ohne Begrenzung');
const { cases } = JSON.parse(readFileSync(new URL('./fixtures/gl-1-budget-cases.json', import.meta.url)));
assert.equal(cases.length, 12);
for (const [depot, liquidity, floor, flex, beforeIncome, afterIncome] of cases) {
    const config = [depot, liquidity, floor, flex];
    const before = calculate(config, beforeIncome), after = calculate(config, afterIncome);
    noJump(before, after, beforeIncome - afterIncome);
    const qBefore = before.result.diagnosis.keyParams.entnahmequoteDepot;
    const qAfter = after.result.diagnosis.keyParams.entnahmequoteDepot;
    const boundary = afterIncome + (qAfter - CONFIG.THRESHOLDS.CAUTION.withdrawalRate) / (qAfter - qBefore) * 50;
    const raw = income => calculate(config, income).result.ui.spending.flexTrace.at(-1).kennzahlen.rohbetragEurMonat;
    assert.ok(Math.abs(raw(boundary - .000001) - raw(boundary + .000001)) < .001,
        'Auch vor Rundung an allen zwölf ursprünglichen Sprungstellen stetig');
}
// Alle zwölf Fundstellen zusätzlich durch den Simulator bis zur gebuchten Auszahlung.
prepareHistoricalDataOnce();
for (const [depot, liquidity, floor, flex, beforeIncome, afterIncome] of cases) {
    for (const income of [beforeIncome, afterIncome]) {
        const inputs = { ...structuredClone(simulatorSample), ...dynamicFlexPresetPatch('ausgewogen'),
            startVermoegen: depot + liquidity, depotwertAlt: 0, einstandAlt: 0,
            tagesgeld: liquidity, geldmarktEtf: 0, detailledTranches: undefined,
            startFloorBedarf: floor, startFlexBedarf: flex, floorBedarf: floor, flexBedarf: flex,
            minimumFlexAnnual: 0, renteMonatlich: income,
            partner: { ...simulatorSample.partner, monatsrente: 0, brutto: 0 },
            renteStartOffsetJahre: 0, renteStartMonate: 12, rentAdjMode: 'none', rentAdjPct: 0,
            renteIndexierungsart: 'none', pflegefallLogikAktivieren: false, simulationPeople: undefined,
            simulationSourceProfileId: undefined, goldStrategyDiagnostics: undefined, goldBasisVermoegen: undefined, rebalancingBand: 0 };
        inputs.horizonYears = resolveDynamicFlexRunnerHorizon(inputs, { yearIndex: 0 }).horizonYears;
        const runState = initMcRunState(inputs, 50);
        runState.currentAnnualPension2 = 0;
        runState.marketDataHist = { endeVJ: 95, endeVJ_1: 90, endeVJ_2: 85, endeVJ_3: 80,
            ath: 95, jahreSeitAth: 0, capeRatio: 25, inflation: 0 };
        const yearData = { jahr: 2026, rendite: 100 / 95 - 1, inflation: 0, zinssatz: 0,
            gold_eur_perf: 0, capeRatio: 25, lohnsteigerung: 0 };
        for (const lot of runState.portfolio.depotTranchesAktien) {
            lot.costBasis = lot.marketValue * .8;
            lot.marketValue /= 1 + yearData.rendite;
        }
        const actual = simulateOneYear(runState, inputs, yearData, 0, null, 0, null, 1, EngineAPI);
        assert.equal(actual.kind, 'success');
        const balance = calculate([depot, liquidity, floor, flex], income);
        assert.equal(actual.logData.entnahme_plan, balance.withdrawal * 12);
        assert.ok(Math.abs(actual.logData.entnahme_effektiv - balance.withdrawal * 12) < 1e-6);
    }
}
const threshold = CONFIG.THRESHOLDS.CAUTION.withdrawalRate;
const state = { keyParams: { entnahmequoteDepot: threshold - .001 } };
const params = { market: { sKey: 'hot_neutral' }, inflatedBedarf: { floor: 24000, flex: 40000 },
    renteJahr: 12000, depotwertGesamt: 1000000, runwayMonate: 60,
    input: { inflation: 0, endeVJ: 100, endeVJ_1: 95, endeVJ_2: 90 } };
const decisions = [];
const capped = applyGuardrails(40, state, params, (...args) => decisions.push(args));
assert.ok(capped.rate > 40, 'Teilweise Anhebung auch unterhalb der vorläufigen Quotenschwelle');
assert.ok(Math.abs(params.inflatedBedarf.floor + params.inflatedBedarf.flex * capped.rate / 100 - 1000000 * threshold) < 1e-7);
assert.ok(capped.diagnostics.cautionBudgetFloor.details.budgetFloorBlocked);
assert.ok(decisions.some(row => row[1] === 'Anhebung zum Erhalt der Kaufkraft bis 4,5 % Depotquote begrenzt'));
assert.equal(applyGuardrails(100, state, params, () => {}).rate, 100, 'Höhere Policy-Auszahlung bleibt bestehen');
assert.equal(applyGuardrails(40, state, { ...params, depotwertGesamt: 0 }, () => {}).rate, 100, 'Ohne Depot keine neue Sperre');
console.log('GL-1: sechs Raster, zwölf feste MO-1-Fälle, Stetigkeit, Teilanhebung und höhere Auszahlung geprüft.');
