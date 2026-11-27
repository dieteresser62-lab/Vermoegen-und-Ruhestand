// ZW-1b Zielwertsuche: Suche nach oben, volle Endprobe, nicht auswertbare Nachbarn, Suchobergrenze, unerreichbares Ziel,
// Ausgangsruin, Abbruch und Endprobe mit synthetischen Zielen. Die Suche nach unten mit 2.000 Läufen steht in
// decision-comparison-abwaerts.test.mjs; Vorbereitung in helpers/decision-comparison-setup.mjs.
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { assert, inputs, monteCarloParams, searchOptions, searchGoals, goals, strainedFloor } from './helpers/decision-comparison-setup.mjs';
import { runDecisionComparison, createDecisionComparisonSession, createDecisionVariant, comparisonIdentity } from '../app/simulator/decision-comparison.js';
import { runMonteCarloSimulation } from '../app/simulator/monte-carlo-runner.js';
import { runTargetBudgetSearch, runTargetBudgetVerification, targetBudgetMeetsGoals } from '../app/simulator/target-budget-search.js';
import { persistenceStorage, readPersistedRecords, flush } from '../app/shared/persistence-facade.js';
import { HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio.js';
import { renderDecisionResult, renderTargetBudgetUnreachable } from '../app/simulator/decision-comparison-ui.js';

// ZW-1b: ab heute nach oben oder unten, beide Grenzen und unveränderter Plan.
const original = JSON.stringify(inputs);
await flush();
const storedBefore = JSON.stringify(await readPersistedRecords());
const planBefore = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
const pageInputsBefore = JSON.stringify(getCommonInputs());
const searchProgress = [];
const searchStages = [];
const found = await runTargetBudgetSearch({ ...searchOptions, goals: searchGoals,
    onProgress: (pct, detail) => { searchProgress.push(pct); searchStages.push(detail); } });
assert.equal(found.status, 'found');
assert.equal(found.monthly % 50, 0);
assert.equal(found.lowerMonthly, 650);
assert.equal(found.currentMonthly, 2500);
assert.ok(targetBudgetMeetsGoals(found.currentMetrics, searchGoals));
assert.ok(found.monthly >= 2500);
assert.deepEqual(found.observations.slice(0, 3).map(point => point.monthly), [2500, 2750, 3000]);
assert.ok(found.observations.every(point => point.monthly >= found.currentMonthly), 'Erfüllter heutiger Plan wird nur nach oben gesucht');
assert.ok(targetBudgetMeetsGoals(found.comparison.variant.metrics, searchGoals));
assert.equal(found.nextMonthly, found.monthly + 50);
assert.ok(!targetBudgetMeetsGoals(found.nextMetrics, searchGoals));
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
const replayOptions = { ...searchOptions, inputs: { ...inputs, startFloorBedarf: strainedFloor, startFlexBedarf: 300000 },
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
assert.equal(JSON.stringify(inputs), original);
assert.equal(JSON.stringify(getCommonInputs()), pageInputsBefore);
assert.equal(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), planBefore);
assert.equal(JSON.stringify(await readPersistedRecords()), storedBefore);
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
console.log('ZW-1b: beide Suchrichtungen, 50-Euro-Nachbar, nicht auswertbare Kennzahlen, VG-1-Parität, Planbytes und Abbruch grün.');
