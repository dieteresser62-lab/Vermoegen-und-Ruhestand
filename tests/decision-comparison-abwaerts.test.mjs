// ZW-1b Suche nach unten: Der heutige Plan verfehlt das Ziel, die Suche geht abwärts und bestätigt mit 2.000 Läufen.
// Eigene Datei, weil diese eine Suche den größten Teil der Rechenzeit braucht; Vorbereitung in helpers/decision-comparison-setup.mjs.
import { assert, inputs, monteCarloParams, searchOptions, goals } from './helpers/decision-comparison-setup.mjs';
import { runTargetBudgetSearch, targetBudgetMeetsGoals } from '../app/simulator/target-budget-search.js';
import { persistenceStorage, readPersistedRecords, flush } from '../app/shared/persistence-facade.js';
import { HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio.js';

const original = JSON.stringify(inputs);
// Wie in der Zielsuche: Die Suche nach unten schreibt weder Seiteneingaben noch Plan noch Speicher.
await flush();
const storedBefore = JSON.stringify(await readPersistedRecords());
const planBefore = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
const pageInputsBefore = JSON.stringify(getCommonInputs());
// FR-72/HE-2: Heimpflege ersetzt den Grundbedarf; mit 5.000 € erreichte der Plan das Ziel bereits.
// 5.600 € verfehlt es weiterhin und erzwingt die Suche nach unten. FR-84: Pflegekosten beenden keinen Lauf mehr, die Deckung bleibt
// bei 100 %; das Ziel verfehlt der Plan über den Anteil der Läufe unter dem Mindest-Flex (22,6 % bei 5.600 €, 16,0 % bei 5.000 €).
const highInputs = { ...structuredClone(inputs), startFlexBedarf: 5600 * 12 };
const highBefore = JSON.stringify(highInputs);
const downGoals = { coveragePct: 99, affectedPct: 20 };
const downward = await runTargetBudgetSearch({ ...searchOptions, inputs: highInputs, goals: downGoals,
    monteCarloParams: { ...monteCarloParams, anzahl: 2000 } });
assert.equal(downward.status, 'found');
assert.equal(downward.comparison.params.anzahl, 2000);
assert.ok(!targetBudgetMeetsGoals(downward.currentMetrics, downGoals));
assert.ok(downward.monthly < 5600);
assert.ok(targetBudgetMeetsGoals(downward.comparison.variant.metrics, downGoals));
assert.equal(downward.nextMonthly, downward.monthly + 50);
assert.ok(!targetBudgetMeetsGoals(downward.nextMetrics, downGoals));
assert.deepEqual(downward.observations.slice(0, 2).map(point => point.monthly), [5600, 5300]);
assert.equal(JSON.stringify(highInputs), highBefore);
assert.equal(JSON.stringify(inputs), original);
assert.equal(JSON.stringify(getCommonInputs()), pageInputsBefore);
assert.equal(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), planBefore);
assert.equal(JSON.stringify(await readPersistedRecords()), storedBefore);
assert.equal(targetBudgetMeetsGoals({ coveragePct: 100, affectedPct: 21 }, downGoals), false);
assert.equal(targetBudgetMeetsGoals({ coveragePct: 98, affectedPct: 0 }, goals), false);
assert.equal(targetBudgetMeetsGoals({ coveragePct: 100, affectedPct: null }, goals), false);
