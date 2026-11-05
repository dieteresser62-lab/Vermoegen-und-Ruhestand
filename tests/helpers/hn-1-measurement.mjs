// Vollständige synthetische Alt-/Neu-Pfade; außerhalb von npm test ausführen.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output, countArg = '2000', selection] = process.argv.slice(2);
const from = file => import(pathToFileURL(resolve(root, file)).href);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { measurementInputs, backtest, parameters } = await from('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await from('engine/index.mjs');
const { runMonteCarloChunk } = await from('app/simulator/monte-carlo-runner.js');
const { persistenceStorage } = await from('app/shared/persistence-facade.js');
const { initInputPersistence } = await from('app/simulator/simulator-main-input-persist.js');
const { getCommonInputs } = await from('app/simulator/simulator-portfolio.js');
const { createMusterHaushaltRecords } = await from('app/demo/muster-haushalt.js');
const { buildBalanceEngineInputFromStorage } = await from('app/balance/balance-input-storage.js');
const { runParityScenarios } = await from('tests/extended/parity-scenarios.mjs');
const { source, inputs: parityInputs } = await from('tests/extended/parity-replay-fixture.mjs');
parityInputs.survivorFloorPercent = 70;
delete parityInputs.survivorFlexPercent; delete parityInputs.survivorMinimumFlexPercent;
const canonicalInputs = value => Array.isArray(value) ? value.map(canonicalInputs)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalInputs(value[key])])) : value;
const comparableInputs = inputs => canonicalInputs({ ...inputs, survivorFloorPercent: 75, survivorFlexPercent: 50, survivorMinimumFlexPercent: 50 });
const count = Number(countArg), alt = process.env.ALT === '1';
const params = { ...parameters, anzahl: count };
const quantile = (values, p) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), i = (sorted.length - 1) * p;
    return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1);
};
async function baseInputs(household) {
    await measurementInputs(0, household === 'sophie' ? 'sophie' : undefined);
    if (alt) {
        for (const [id, value] of [['survivorFloorPercent', 70], ['survivorFlexPercent', 75], ['survivorMinimumFlexPercent', 75]])
            persistenceStorage.setItem('sim_' + id, String(value));
        initInputPersistence();
    }
    const inputs = getCommonInputs();
    assert.equal(inputs.survivorFloorPercent, alt ? 70 : 75);
    if (inputs.survivorFlexPercent !== undefined) {
        assert.equal(inputs.survivorFlexPercent, alt ? 75 : 50);
        assert.equal(inputs.survivorMinimumFlexPercent, alt ? 75 : 50);
    }
    if (household !== 'sophie') {
        inputs.home = [{ id: 'haus', profileId: 'muster_a', bezeichnung: 'Haus', nutzung: 'selbst', wert: 450000, stand: '2026-10', mieteNetto: 0, anpassung: 'keine' }];
        inputs.homeReferenceYear = 2026;
    }
    return inputs;
}
async function measure(inputs, label) {
    let ruin = 0, belowMinimum = 0, downYears = 0, comparableYears = 0, maxDropPct = 0, maxJumpPct = 0, maxFlowDelta = 0;
    const budgets = [], end = [], chunks = [], prefixes = [], paths = [];
    for (let start = 0; start < count; start += 100) {
        const size = Math.min(100, count - start);
        const bearYears = new Map();
        let lifeYearKey;
        const observedEngine = { ...EngineAPI, simulateSingleYear(...args) {
            const result = EngineAPI.simulateSingleYear(...args);
            bearYears.set(lifeYearKey, ['bear_deep', 'recovery_in_bear'].includes(result.ui.market.sKey));
            return result;
        } };
        const chunk = await runMonteCarloChunk({ inputs, engine: observedEngine, monteCarloParams: params,
            comparisonPairing: { mode: 'record', tapes: new Map(), continuationYears: new Map(), onYear: ({ runIndex, yearIndex }) => { lifeYearKey = `${runIndex}/${yearIndex}`; } },
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: size },
            logIndices: Array.from({ length: size }, (_, i) => start + i) });
        assert.equal(chunk.technicalInventory.technicalError, 0);
        ruin += chunk.totals.failCount;
        end.push(...chunk.pathSummaries.finalValueRealEur); chunks.push(hash(chunk));
        for (const run of chunk.runMeta) {
            const rows = run.logDataRows;
            if (rows.some(row => row.flex_unter_mindestflex === true)) belowMinimum++;
            const prefix = [];
            let beforeFirstDeath = true, previousBudget;
            for (const row of rows) {
                maxFlowDelta = Math.max(maxFlowDelta, Math.abs(row.portfolio_flow_delta || 0));
                if (row.Person1Alive !== 1 || inputs.partner?.aktiv && row.Person2Alive !== 1) beforeFirstDeath = false;
                if (beforeFirstDeath) prefix.push(row);
                if (row.recordType !== 'financial_year') continue;
                // Das verfügbare Budget ist Grundbedarf + tatsächlich gezahlter Flex.
                const budget = ((row.floor_brutto || 0) + (row.flex_haushalt_erfuellt || 0)) / row.inflation_factor_cum;
                if (inputs.partner?.aktiv && !beforeFirstDeath && !row.SurvivorDeathYear && row.Person1Alive !== row.Person2Alive) budgets.push(budget);
                if (previousBudget > 0) {
                    const change = (budget / previousBudget - 1) * 100;
                    maxJumpPct = Math.max(maxJumpPct, Math.abs(change));
                    maxDropPct = Math.max(maxDropPct, -change);
                    if (!bearYears.get(`${run.index}/${row.jahr - 1}`)) { comparableYears++; if (change < -5) downYears++; }
                }
                previousBudget = budget;
            }
            prefixes.push(hash(prefix)); paths.push(hash(run));
        }
        if ((start + size) % 500 === 0) console.log(`${label}: ${start + size}/${count}`);
    }
    return { coveredPct: (count - ruin) / count * 100, ruin, belowMinimum, survivorYears: budgets.length,
        survivorBudgetRealP10: quantile(budgets, .1), survivorBudgetRealP50: quantile(budgets, .5),
        terminalRealP10: quantile(end, .1), terminalRealP50: quantile(end, .5),
        continuity: { downYears, comparableYears, maxDropPct, maxJumpPct }, maxFlowDelta,
        completeChunksSha256: hash(chunks), completePathsSha256: hash(paths), couplePrefixesSha256: hash(prefixes),
        backtestSha256: hash(backtest(comparableInputs(inputs))), historicalCountercheckSha256: hash(backtest(comparableInputs(inputs), 1925, 1959)) };
}
const result = { alt, parameters: params, defaults: null,
    definitions: { money: 'heutige EUR', survivorBudget: 'Grundbedarf plus tatsächlich gezahlter Flex; nur volle Hinterbliebenenjahre',
        continuity: 'Alle finanziellen Paar-/Todes-/Hinterbliebenenjahre: realer Budgetrückgang >5 % außerhalb bear_deep/recovery_in_bear; größter absoluter relativer Jahressprung einschließlich Bärenmarkt',
        defaults: 'App-Vorgaben, Pflege an, 35 Jahre, Musterhaus 450000 EUR bei Max; Groß wie EP-2 mit Haus 800000 EUR;  Regime-Markov, per-run-seed, CAPE-Sampling aus' }, scenarios: {}, compatibility: {} };
if (selection === 'historical') {
    const counterInputs = await baseInputs('muster');
    const { annualData } = await from('app/simulator/simulator-data.js');
    const period = annualData.filter(year => year.jahr >= 1925 && year.jahr <= 1999);
    assert.equal(period.length, 75);
    annualData.splice(0, annualData.length, ...period);
    params.methode = 'block';
    result.historicalPool = '1925–1999, Blockbootstrap, Blockgröße 3';
    result.scenarios.historical = await measure({ ...counterInputs, pflegefallLogikAktivieren: true }, 'historical');
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
}
if (selection === 'sensitivity') {
    const base = { ...await baseInputs('muster'), pflegefallLogikAktivieren: true };
    for (const factor of [.7, 1.3]) {
        const inputs = { ...base, survivorFloorPercent: 75 * factor,
            survivorFlexPercent: 50 * factor, survivorMinimumFlexPercent: 50 * factor };
        result.scenarios[String(factor)] = await measure(inputs, `sensitivity/${factor}`);
        writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    }
    process.exit(0);
}
for (const household of ['muster', 'gross']) {
    const base = await baseInputs(household);
    result.defaults ||= { floor: base.survivorFloorPercent, wish: base.survivorFlexPercent ?? 75, minimum: base.survivorMinimumFlexPercent ?? 75 };
    base.pflegefallLogikAktivieren = true;
    if (household === 'gross') {
        base.home = [{ id: 'haus', profileId: 'muster_a', bezeichnung: 'Haus', nutzung: 'selbst', wert: 800000, stand: '2026-10', mieteNetto: 0, anpassung: 'keine' }];
        base.homeReferenceYear = 2026;
        for (const [id, target] of [['muster_a', 2700000], ['muster_b', 300000]]) {
            const person = base.simulationPeople.find(person => person.profileId === id);
            const lots = base.detailledTranches.filter(lot => lot.sourceProfileId === id);
            const factor = target / (person.tagesgeld + lots.reduce((sum, lot) => sum + lot.marketValue, 0));
            person.tagesgeld *= factor;
            for (const lot of lots) { lot.marketValue *= factor; lot.costBasis *= factor; lot.shares *= factor; }
        }
        base.startVermoegen = 3000000;
        base.tagesgeld = base.simulationPeople.reduce((sum, person) => sum + person.tagesgeld, 0);
        base.geldmarktEtf = base.detailledTranches.filter(lot => lot.category === 'money_market').reduce((sum, lot) => sum + lot.marketValue, 0);
        base.depotwertAlt = 3000000 - base.tagesgeld - base.geldmarktEtf;
        base.einstandAlt = base.detailledTranches.filter(lot => lot.category === 'equity').reduce((sum, lot) => sum + lot.costBasis, 0);
        base.partner.careToday = { grade: 2, progression: 'usual' };
    }
    for (const unmarried of [false, true]) for (const dynamicFlex of [false, true]) {
        const inputs = structuredClone(base), percent = household === 'gross' ? 50 : 0;
        inputs.partnership = { schemaVersion: 1, status: unmarried ? 'unmarried' : 'married',
            inheritance: { muster_a: percent, muster_b: percent }, marriedInheritance: { muster_a: 100, muster_b: 100 } };
        if (household === 'muster' && unmarried) inputs.partnership.homeAndTaxInheritance = { muster_a: true };
        inputs.dynamicFlex = dynamicFlex;
        const key = `${household}/${unmarried ? 'unmarried' : 'married'}/${dynamicFlex ? 'dynamic' : 'static'}`;
        if (selection && selection !== key) continue;
        result.scenarios[key] = await measure(inputs, key);
        writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    }
}
if (selection) process.exit(0);
result.compatibility.sophie = await measure({ ...await baseInputs('sophie'), survivorFloorPercent: 75, survivorFlexPercent: 50, survivorMinimumFlexPercent: 50 }, 'sophie');
const { durationMs, ...parity } = runParityScenarios({ source });
assert.equal(parity.failed, false);
result.compatibility.parity = hash(parity);
const records = createMusterHaushaltRecords('2026-10-16');
const balance = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, referenceYear: 2026 });
result.compatibility.balanceInput = hash(balance);
result.compatibility.balanceDecision = hash(EngineAPI.simulateSingleYear(balance.engineInput || balance.inputs));
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log('HN-1 Messung fertig.');
process.exit(0);
