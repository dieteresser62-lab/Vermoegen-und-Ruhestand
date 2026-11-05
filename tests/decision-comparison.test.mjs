import nodeAssert from 'node:assert/strict';
const assert = globalThis.__wrapExternalAssert?.(nodeAssert) ?? nodeAssert;
import { measurementInputs, parameters } from './helpers/ek-1b-measurement.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { runDecisionComparison, createDecisionComparisonSession, createDecisionVariant, comparisonIdentity, assertComparisonUnchanged, comparisonIncomeChoices, comparisonReferenceYear } from '../app/simulator/decision-comparison.js';
import { runMonteCarloSimulation } from '../app/simulator/monte-carlo-runner.js';
import { runTargetBudgetSearch, runTargetBudgetVerification, targetBudgetMeetsGoals } from '../app/simulator/target-budget-search.js';
import { persistenceStorage, readPersistedRecords, flush } from '../app/shared/persistence-facade.js';
import { HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio.js';
import { initDecisionComparison, renderDecisionResult, renderTargetBudgetUnreachable } from '../app/simulator/decision-comparison-ui.js';
import { readDocumentPersonInputs, initializePersonOverrides } from '../app/simulator/simulator-person-overrides.js';
import { addField } from './designsystem-selection-dom.mjs';

const inputs = await measurementInputs(0, 'max-erika');
// Anzeigeunterschiede folgen den sichtbaren Eurobeträgen, auch im Highlight.
{
    const keys = ['budgetP10', 'budgetP50', 'wealthP10', 'wealthP50'];
    const metric = value => ({ ...Object.fromEntries(keys.map(key => [key, value])), coveragePct: 100, affectedPct: 0, affectedYears: 0 });
    const synthetic = { change: { kind: 'budget', monthly: -300 }, baseline: { metrics: metric(1000.6) },
        variant: { metrics: metric(500.4) }, differences: { ...Object.fromEntries(keys.map(key => [key, -500.2])), coveragePct: 0, affectedPct: 0, affectedYears: 0 },
        params: { anzahl: 1000, standardRuns: 1000, seed: 12345 }, worsePct: 0 };
    const before = JSON.stringify(synthetic), html = renderDecisionResult(synthetic).replaceAll('\u00a0', ' ');
    assert.equal((html.match(/1\.001 €/g) || []).length, 4);
    assert.equal((html.match(/500 €/g) || []).length, 4);
    assert.equal((html.match(/−501 €/g) || []).length, 6, 'Tabelle, P50-Highlight und P10-Hinweis verwenden −501 €');
    assert.equal(JSON.stringify(synthetic), before, 'Rohdifferenzen bleiben unverändert');
}
const monteCarloParams = { ...parameters, anzahl: 50 };
const options = { inputs, monteCarloParams, useCapeSampling: false, engine: EngineAPI, diagnosticRuns: 50, captureLogs: true };
// KL-1: Ohne Pflegelogik muss auch Person 2 nach Ausgangsruin weiter altern/sterben.
const rescuedWithoutCare = await runDecisionComparison({ ...options,
    inputs: { ...inputs, pflegefallLogikAktivieren: false, startFlexBedarf: 300000, minimumFlexAnnual: 60000 },
    change: { kind: 'budget', monthly: -20000 } });
assert.ok(rescuedWithoutCare.baseline.chunk.totals.failCount > rescuedWithoutCare.variant.chunk.totals.failCount);
const noCareLife = rows => rows.map(({ historicalYear, ...row }) => row);
assert.deepEqual(noCareLife(rescuedWithoutCare.baseline.diagnostics), noCareLife(rescuedWithoutCare.variant.diagnostics));
const rescuedBase = rescuedWithoutCare.baseline.chunk.pathSummaries;
const rescuedVariant = rescuedWithoutCare.variant.chunk.pathSummaries;
assert.equal(rescuedBase.outcomeCode[0], 1);
assert.notEqual(rescuedVariant.outcomeCode[0], 1);
assert.ok(rescuedVariant.minimumFlexAffectedYearCount[0] > rescuedBase.minimumFlexAffectedYearCount[0]);
const actuallyWorse = [...rescuedBase.outcomeCode].filter((code, index) => code !== 1
    && (rescuedVariant.outcomeCode[index] === 1
        || rescuedVariant.minimumFlexAffectedYearCount[index] > rescuedBase.minimumFlexAffectedYearCount[index])).length;
assert.equal(rescuedWithoutCare.worsePct, actuallyWorse / monteCarloParams.anzahl * 100,
    'Ein vermiedener Ausgangsruin zählt trotz zusätzlicher Mindest-Flex-Jahre nicht als Schaden');
const original = JSON.stringify(inputs);
const zero = await runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 0 } });
assert.deepEqual(zero.baseline.metrics, zero.variant.metrics);
assert.deepEqual(zero.baseline.chunk, zero.variant.chunk);
assert.equal(zero.worsePct, 0);
assert.ok(Object.values(zero.differences).every(value => value === 0));
const normal = await runMonteCarloSimulation({ ...options, widowOptions: inputs.widowOptions });
assert.deepEqual(zero.baseline.aggregated, normal.aggregatedResults);
const budget = await runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 300 } });
assert.deepEqual(budget.baseline.diagnostics, budget.variant.diagnostics);
assert.equal(new Set(budget.baseline.diagnostics.map(row => row.runIndex)).size, 50);
const expense = await runDecisionComparison({ ...options, change: { kind: 'expense', amount: 25000, month: '2030-06' } });
for (let index = 0; index < 50; index++) {
    assert.deepEqual(expense.baseline.chunk.runMeta[index].logDataRows.filter(row => row.jahr < 5),
        expense.variant.chunk.runMeta[index].logDataRows.filter(row => row.jahr < 5));
}
const choice = comparisonIncomeChoices(inputs).find(entry => entry.id === 'pension:1');
const shifted = await runDecisionComparison({ ...options, change: { kind: 'income', incomeId: choice.id, months: 12 } });
const oldYearIndex = Number(choice.start.slice(0, 4)) - comparisonReferenceYear(inputs);
for (let index = 0; index < 50; index++) {
    assert.deepEqual(shifted.baseline.chunk.runMeta[index].logDataRows.filter(row => row.jahr <= oldYearIndex),
        shifted.variant.chunk.runMeta[index].logDataRows.filter(row => row.jahr <= oldYearIndex));
}
assert.equal(JSON.stringify(inputs), original);
assert.throws(() => createDecisionVariant(inputs, { kind: 'budget', monthly: -100000 }), /Flex|flex|Bedarf/);
const identity = comparisonIdentity(options);
assert.throws(() => assertComparisonUnchanged(identity, comparisonIdentity({ ...options,
    inputs: { ...inputs, simulationPeople: [{ profileId: 'different' }] } })), /Vergleich nicht möglich.*Personen/);
let current = identity;
await assert.rejects(runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 0 },
    readCurrentIdentity: () => current, onProgress: () => { current = 'changed'; } }), /Vergleich nicht möglich/);

// Ein Ruin darf die späteren Lebensziehungen nicht von der Marktfolge abhängig machen.
const ruin = await runDecisionComparison({ ...options, change: { kind: 'expense', amount: 10000000, month: '2027-01' } });
const lifeOnly = rows => rows.map(({ historicalYear, ...row }) => ({ ...row, careP1: row.p1Alive ? row.careP1 : 0, careP2: row.p2Alive ? row.careP2 : 0 }));
assert.deepEqual(lifeOnly(ruin.baseline.diagnostics), lifeOnly(ruin.variant.diagnostics));
// Die Variante kann den Ausgangsruin überleben: Marktfortsetzung und Leben bleiben getrennt.
const strained = { ...inputs, startFlexBedarf: 300000 };
const saved = await runDecisionComparison({ ...options, inputs: strained,
    change: { kind: 'budget', monthly: -20000 } });
assert.ok(saved.baseline.chunk.totals.failCount > saved.variant.chunk.totals.failCount);
assert.deepEqual(lifeOnly(saved.baseline.diagnostics), lifeOnly(saved.variant.diagnostics));
// Auch die weiteren Ziehverfahren und der ältere Gesamtstrom halten eine Nulländerung.
for (const [methode, rngMode] of [['block', 'per-run-seed'], ['stationary', 'per-run-seed'],
    ['regime_iid', 'per-run-seed'], ['regime_markov', 'legacy-stream']]) {
    const same = await runDecisionComparison({ ...options, monteCarloParams: { ...monteCarloParams, anzahl: 3, methode, rngMode },
        change: { kind: 'budget', monthly: 0 } });
    assert.deepEqual(same.baseline.chunk, same.variant.chunk);
}
const withIncome = { ...inputs, fixedIncomeReferenceYear: 2026, fixedIncome: [{ id: 'fixed', profileId: inputs.simulationPeople[0].profileId,
    art: 'sonstige', bezeichnung: 'Feste Einkunft', betragMonat: 800, ab: '2030-03', bis: '2035-12', anpassung: 'keine' }] };
const incomeVariant = createDecisionVariant(withIncome, { kind: 'income', incomeId: 'fixed:fixed', months: -6 });
assert.equal(incomeVariant.fixedIncome[0].ab, '2029-09');
assert.equal(incomeVariant.fixedIncome[0].betragMonat, 800);
assert.equal(withIncome.fixedIncome[0].ab, '2030-03');
const dated = { pensionStarts: ['2024-04', '2027-07'], referenceYear: 2026 };
assert.equal(comparisonIncomeChoices(inputs, dated)[0].start, '2024-04');
assert.deepEqual(createDecisionVariant(inputs, { kind: 'income', incomeId: 'pension:0', months: 12 }, dated), inputs);
const later = createDecisionVariant(inputs, { kind: 'income', incomeId: 'pension:0', months: 30 }, dated);
assert.equal(later.renteStartOffsetJahre, 0);
assert.equal(later.renteStartMonate, 3);
const beforePlan = createDecisionVariant(inputs, { kind: 'income', incomeId: 'pension:1', months: -30 }, dated);
assert.equal(beforePlan.partner.startInJahren, 0);
assert.equal(beforePlan.partner.renteStartMonate, 12);
assert.equal(beforePlan.partner.renteKalenderbeginn, false);
const nextPlanYear = createDecisionVariant(inputs, { kind: 'expense', amount: 1000, month: '2028-06' },
    { referenceYear: 2027 });
assert.equal(nextPlanYear.plannedExpensesReferenceYear, 2027);
assert.throws(() => assertComparisonUnchanged(comparisonIdentity({ ...options, ...dated }),
    comparisonIdentity({ ...options, ...dated, pensionStarts: ['2024-05', '2027-07'] })), /Vergleich nicht möglich/);
// ZW-1b: ab heute nach oben oder unten, beide Grenzen und unveränderter Plan.
await flush();
const storedBefore = JSON.stringify(await readPersistedRecords());
const planBefore = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
const pageInputsBefore = JSON.stringify(getCommonInputs());
const searchProgress = [];
const searchStages = [];
const searchOptions = { ...options, diagnosticRuns: 0, captureLogs: false,
    monteCarloParams: { ...monteCarloParams, anzahl: 128 } };
const goals = { coveragePct: 99, affectedPct: 10 };
const found = await runTargetBudgetSearch({ ...searchOptions, goals,
    onProgress: (pct, detail) => { searchProgress.push(pct); searchStages.push(detail); } });
assert.equal(found.status, 'found');
assert.equal(found.monthly % 50, 0);
assert.equal(found.lowerMonthly, 650);
assert.equal(found.currentMonthly, 2500);
assert.ok(targetBudgetMeetsGoals(found.currentMetrics, goals));
assert.ok(found.monthly >= 2500);
assert.deepEqual(found.observations.slice(0, 3).map(point => point.monthly), [2500, 2750, 3000]);
assert.ok(found.observations.every(point => point.monthly >= found.currentMonthly), 'Erfüllter heutiger Plan wird nur nach oben gesucht');
assert.ok(targetBudgetMeetsGoals(found.comparison.variant.metrics, goals));
assert.equal(found.nextMonthly, found.monthly + 50);
assert.ok(!targetBudgetMeetsGoals(found.nextMetrics, goals));
assert.ok(searchProgress.every((pct, i) => pct >= 0 && pct <= 100 && (!i || pct >= searchProgress[i - 1])));
assert.equal(searchProgress.at(-1), 100);
assert.ok(searchStages.filter(point => point.searchStep).every(point =>
    point.comparison.includes(`Stufe ${point.searchStep}`) && Number.isFinite(point.monthly)));
const matchingVG = await runDecisionComparison({ ...searchOptions,
    change: { kind: 'budget', monthly: found.monthly - inputs.startFlexBedarf / 12 } });
assert.deepEqual(found.comparison, matchingVG, 'Ergebnistabelle und Rohwerte entsprechen genau VG-1 mit demselben Wunsch-Flex');
const targetHtml = renderDecisionResult(found.comparison, { targetSearch: found });
assert.match(targetHtml, /Welche Grenze bestimmt den Betrag/);
assert.match(targetHtml, /Betrag übernehmen\? Im Planversuch ausprobieren/);
assert.match(targetHtml, /wäre das Ziel verfehlt/);
assert.match(targetHtml, /Wunschbudget .* pro Monat/);
assert.match(targetHtml, /davon Wunsch-Flex/);
assert.match(targetHtml, /Gesucht ab deinem heutigen Wunschbudget/);
assert.match(targetHtml, /Suche mit 128 Läufen je Schritt · Endprobe mit 128 Läufen/);
assert.doesNotMatch(targetHtml, /Läufe je Plan/);
assert.equal(found.finalVerification.status, 'confirmed');
assert.ok(targetHtml.includes(new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(found.monthly + 2500)));
// Die volle Endprobe erweitert tatsächlich die Stichprobe, auch die gepaarte Ausgangsrechnung.
const fullParameters = { ...monteCarloParams, anzahl: 501 };
const fullProbe = await runTargetBudgetSearch({ ...searchOptions, monteCarloParams: fullParameters,
    goals: { coveragePct: 0, affectedPct: 100 }, maximumMonthly: 2750 });
const fullNormal = await runMonteCarloSimulation({ ...searchOptions, monteCarloParams: fullParameters,
    widowOptions: inputs.widowOptions });
assert.equal(fullProbe.params.anzahl, 500);
assert.equal(fullProbe.comparison.params.anzahl, 501);
assert.equal(fullProbe.comparison.variant.chunk.pathSummaries.outcomeCode.length, 501);
assert.deepEqual(fullProbe.comparison.baseline.aggregated, fullNormal.aggregatedResults);
assert.match(renderDecisionResult(fullProbe.comparison, { targetSearch: fullProbe }), /Endprobe mit 501 Läufen/);
// Nicht auswertbare Nachbarn dürfen keine leere Begründung bekommen.
for (const value of [null, NaN, Infinity]) {
    const missingFlex = renderDecisionResult(found.comparison, { targetSearch: { ...found,
        nextMetrics: { ...found.nextMetrics, coveragePct: 100, affectedPct: value } } });
    assert.match(missingFlex, /Läufe unter Mindest-Flex nicht auswertbar/);
    assert.match(missingFlex, /Kennzahl nicht auswertbar/);
    assert.doesNotMatch(missingFlex, /Ziel verfehlt: \./);
}
assert.match(renderDecisionResult(found.comparison, { targetSearch: { ...found,
    nextMetrics: { ...found.nextMetrics, coveragePct: null, affectedPct: 0 } } }), /Grundbedarfsdeckung nicht auswertbar/);
const highInputs = { ...structuredClone(inputs), startFlexBedarf: 5000 * 12 };
const highBefore = JSON.stringify(highInputs);
const downGoals = { coveragePct: 99, affectedPct: 70 };
const downward = await runTargetBudgetSearch({ ...searchOptions, inputs: highInputs, goals: downGoals,
    monteCarloParams: { ...monteCarloParams, anzahl: 2000 } });
assert.equal(downward.status, 'found');
assert.equal(downward.comparison.params.anzahl, 2000);
assert.ok(!targetBudgetMeetsGoals(downward.currentMetrics, downGoals));
assert.ok(downward.monthly < 5000);
assert.ok(targetBudgetMeetsGoals(downward.comparison.variant.metrics, downGoals));
assert.equal(downward.nextMonthly, downward.monthly + 50);
assert.ok(!targetBudgetMeetsGoals(downward.nextMetrics, downGoals));
assert.deepEqual(downward.observations.slice(0, 2).map(point => point.monthly), [5000, 4750]);
assert.equal(JSON.stringify(highInputs), highBefore);
assert.equal(JSON.stringify(inputs), original);
assert.equal(JSON.stringify(getCommonInputs()), pageInputsBefore);
assert.equal(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), planBefore);
assert.equal(JSON.stringify(await readPersistedRecords()), storedBefore);
assert.equal(targetBudgetMeetsGoals({ coveragePct: 100, affectedPct: 71 }, downGoals), false);
assert.equal(targetBudgetMeetsGoals({ coveragePct: 98, affectedPct: 0 }, goals), false);
assert.equal(targetBudgetMeetsGoals({ coveragePct: 100, affectedPct: null }, goals), false);
// Ein begrenzter Suchraum wird ausdrücklich als solcher ausgewiesen.
const capped = await runTargetBudgetSearch({ ...searchOptions,
    monteCarloParams: { ...monteCarloParams, anzahl: 3 },
    goals: { coveragePct: 0, affectedPct: 100 }, maximumMonthly: 2750 });
assert.equal(capped.status, 'found');
assert.equal(capped.monthly, 2750);
assert.equal(capped.atUpperBound, true);
assert.equal(capped.nextMonthly, null);
assert.match(renderDecisionResult(capped.comparison, { targetSearch: capped }), /Suchobergrenze erreicht/);
const poor = { ...inputs, startFloorBedarf: 10000000 };
const unreachable = await runTargetBudgetSearch({ ...searchOptions, inputs: poor, goals,
    monteCarloParams: { ...monteCarloParams, anzahl: 3 } });
assert.equal(unreachable.status, 'unreachable');
assert.equal(unreachable.evaluations, 9);
assert.deepEqual(unreachable.observations.map(point => point.monthly), [2500, 2250, 2000, 1750, 1500, 1250, 1000, 750, 650]);
assert.equal(unreachable.lowerMonthly, 650);
assert.ok(!targetBudgetMeetsGoals(unreachable.lowerMetrics, goals));
assert.match(renderTargetBudgetUnreachable(unreachable), /Mit keinem Wunschbudget zwischen Mindest-Flex und heute wird das Ziel erreicht/);
assert.match(renderTargetBudgetUnreachable(unreachable), /Erreichte Werte heute/);
assert.match(renderTargetBudgetUnreachable(unreachable), /Erreichte Werte an der Untergrenze/);
assert.equal(unreachable.lowerMetrics.coveragePct, 0);
// Oberhalb von 5.000 € gilt der größere Abwärtsschritt von 5 %.
const fivePercent = await runTargetBudgetSearch({ ...searchOptions, inputs: { ...poor, startFlexBedarf: 10000 * 12 },
    monteCarloParams: { ...monteCarloParams, anzahl: 1 }, goals });
assert.deepEqual(fivePercent.observations.slice(0, 3).map(point => point.monthly), [10000, 9500, 9000]);
assert.equal(fivePercent.observations.at(-1).monthly, 650);
// Mehrere Suchstufen müssen auch nach Ausgangsruin dieselbe Marktfortsetzung erhalten.
const replayOptions = { ...searchOptions, inputs: { ...inputs, startFlexBedarf: 300000 },
    monteCarloParams: { ...monteCarloParams, anzahl: 3 } };
const replaySession = createDecisionComparisonSession({ ...replayOptions, isolateReplays: true });
await replaySession.run(replaySession.baselineInputs, { record: true });
const rescuedPlan = createDecisionVariant(replaySession.baselineInputs, { kind: 'budget', monthly: -20000 });
const firstReplay = await replaySession.run(rescuedPlan);
await replaySession.run(createDecisionVariant(replaySession.baselineInputs, { kind: 'budget', monthly: -22000 }));
assert.deepEqual(await replaySession.run(rescuedPlan), firstReplay);
replaySession.dispose();
const directReplay = await runDecisionComparison({ ...replayOptions, change: { kind: 'budget', monthly: -20000 } });
assert.deepEqual(firstReplay, directReplay.variant);
const expanded = await runTargetBudgetSearch({ ...searchOptions, monteCarloParams: { ...monteCarloParams, anzahl: 3 },
    goals: { coveragePct: 0, affectedPct: 100 }, maximumMonthly: 6000 });
assert.ok(expanded.observations.some(point => point.monthly > inputs.startFlexBedarf / 12 * 2));
assert.equal(expanded.monthly, 6000);
const abort = new AbortController();
await assert.rejects(runTargetBudgetSearch({ ...searchOptions, goals, signal: abort.signal,
    onProgress: () => abort.abort() }), /aborted|abgebrochen/i);
let searchIdentity = comparisonIdentity(searchOptions);
await assert.rejects(runTargetBudgetSearch({ ...searchOptions, goals,
    readCurrentIdentity: () => searchIdentity, onProgress: () => { searchIdentity = 'changed'; } }), /Vergleich nicht möglich/);
await assert.rejects(runTargetBudgetSearch({ ...searchOptions, goals: { coveragePct: 99 } }), /beide Zielgrenzen/);
const sophie = await measurementInputs(0, 'sophie');
const sophieOriginal = JSON.stringify(sophie);
const sophieProbe = await runTargetBudgetSearch({ ...searchOptions, inputs: sophie, goals, maximumMonthly: 200 });
assert.equal(sophieProbe.lowerMonthly, 200);
assert.equal(JSON.stringify(sophie), sophieOriginal);

// Endprobe mit synthetisch erzwungenen Zielen: Bestätigung, wachsende Abwärtsschritte, Halbierung, Untergrenze und Abbruch.
const verify = async (holdsAt, { lowerMonthly = 650, onProgress, signal } = {}) => {
    const calls = [];
    const session = { baselineInputs: inputs, params: { anzahl: 500, standardRuns: 2000 },
        check() { if (signal?.aborted) throw signal.reason; },
        async run(plan, config) {
            calls.push({ monthly: plan.startFlexBedarf / 12, ...config });
            config.onProgress(90, { completedRuns: 2000, totalRuns: 2000 });
            return { metrics: { coveragePct: plan.startFlexBedarf / 12 <= holdsAt ? 99.2 : 98.9, affectedPct: 5 } };
        } };
    const result = await runTargetBudgetVerification({ session, baseline: {}, monthly: 1000, lowerMonthly,
        goals, onProgress });
    assert.ok(calls.every(call => call.fullRuns));
    assert.equal(calls[0].record, true);
    return { result, calls };
};
const confirmed = await verify(1000);
assert.equal(confirmed.result.monthly, 1000);
assert.equal(confirmed.result.finalVerification.status, 'confirmed');
assert.equal(confirmed.calls.length, 2, 'Volle Ausgangsrechnung plus genau eine Endprobe');
const lowered = await verify(900);
assert.equal(lowered.result.monthly, 900);
assert.deepEqual(lowered.result.finalVerification.attempts.map(point => point.monthly), [1000, 950, 850, 900]);
assert.ok(targetBudgetMeetsGoals(lowered.result.variant.metrics, goals));
const deeperProgress = [];
const deeper = await verify(700, { lowerMonthly: 250,
    onProgress: (pct, detail) => deeperProgress.push({ pct, ...detail }) });
assert.equal(deeper.result.monthly, 700);
assert.deepEqual(deeper.result.finalVerification.attempts.map(point => point.monthly), [1000, 950, 850, 650, 750, 700]);
assert.equal(deeper.result.previous.monthly, 750, 'Höchster bestätigter Betrag hat voll geprüften verfehlten 50-Euro-Nachbarn');
assert.ok(!targetBudgetMeetsGoals(deeper.result.previous.metrics, goals));
assert.ok(deeperProgress.every((row, i) => i === 0 || row.pct >= deeperProgress[i - 1].pct));
assert.ok(deeperProgress.some(row => row.comparison === 'Endprobe · Stufe 6 · 700 €'));
const lowerHolds = await verify(650);
assert.equal(lowerHolds.result.monthly, 650);
assert.equal(lowerHolds.result.finalVerification.status, 'confirmed');
assert.equal(lowerHolds.result.previous.monthly, 700);
const unconfirmed = await verify(0);
assert.equal(unconfirmed.result.monthly, 650, 'Nur bei verfehlter Untergrenze unbestätigt, mit deren Endprobenwerten');
assert.equal(unconfirmed.result.finalVerification.status, 'unconfirmed');
assert.deepEqual(unconfirmed.result.finalVerification.attempts.map(point => point.monthly), [1000, 950, 850, 650]);
const fallbackHtml = renderDecisionResult(found.comparison, { targetSearch: { ...found,
    finalVerification: unconfirmed.result.finalVerification } });
assert.match(fallbackHtml, /Endprobe nicht bestätigt/);
assert.match(fallbackHtml, /Selbst die Untergrenze hält nicht/);
assert.doesNotMatch(fallbackHtml, /class="decision-found"/);
assert.equal((await verify(0, { lowerMonthly: 1000 })).result.finalVerification.attempts.length, 1);
const abortVerification = new AbortController();
await assert.rejects(verify(1000, { signal: abortVerification.signal,
    onProgress: () => abortVerification.abort() }), /abort|abgebrochen/i);
await measurementInputs(0, 'max-erika');
console.log('ZW-1b: beide Suchrichtungen, 50-Euro-Nachbar, nicht auswertbare Kennzahlen, VG-1-Parität, Planbytes und Abbruch grün.');

// Der Hinweis einer vorhandenen Einkunft muss beim leeren Plan verschwinden.
const doc = globalThis.document;
for (const id of ['decisionComparison', 'decisionBaseline', 'decisionIncomeHint', 'decisionRun', 'decisionCancel',
    'decisionProgress', 'decisionResult', 'decisionStatus', 'decisionRunHint', 'mcViewTabDecision']) addField(doc, id);
// Das kleine Node-DOM parst kein Options-HTML; die aktuelle Wahl wird explizit gesetzt.
Object.defineProperty(doc.getElementById('decisionIncome'), 'value', { configurable: true, writable: true, value: 'pension:0' });
initDecisionComparison(doc);
assert.match(doc.getElementById('decisionIncomeHint').textContent, /^neuer Beginn/);
const adopted = readDocumentPersonInputs(doc);
initializePersonOverrides(adopted.entries.map(entry => ({ ...entry,
    data: { ...entry.data, profile_rente_monatlich: '0' } })), adopted.entries[0].profileId, adopted.context.referenceYear, doc);
doc.getElementById('mcViewTabDecision').dispatchEvent({ type: 'click' });
assert.equal(doc.getElementById('decisionIncomeHint').textContent, 'Keine Einkunft zum Verschieben im Plan');
console.log('VG-1: Nulländerung, 50 gepaarte Markt-/Lebenspfade, Präfixe, normale Aggregate und Schutzprüfung grün.');
