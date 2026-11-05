import * as facade from '../app/simulator/simulator-engine-direct.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct/year-entry.js';
import { SIMULATOR_YEAR_OUTCOME_KINDS, SIMULATOR_TECHNICAL_ERROR_CODES } from '../app/simulator/simulator-engine-direct/outcomes.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { normalizeHouseholdContext, euros, resolveCapeRatio } from '../app/simulator/simulator-engine-direct-utils.js';
import { makeDefaultCareMeta, sampleNextYearData, computeRunStatsFromSeries, calcCareCost,
    computeHouseholdFlexFactor, computeCareMortalityMultiplier, updateCareMeta } from '../app/simulator/simulator-engine-helpers.js';

const expected = { simulateOneYear, SIMULATOR_YEAR_OUTCOME_KINDS, SIMULATOR_TECHNICAL_ERROR_CODES,
    initMcRunState: initializePortfolio, normalizeHouseholdContext, euros, resolveCapeRatio,
    makeDefaultCareMeta, sampleNextYearData, computeRunStatsFromSeries, calcCareCost,
    computeHouseholdFlexFactor, computeCareMortalityMultiplier, updateCareMeta };
assertEqual(JSON.stringify(Object.keys(facade).sort()), JSON.stringify(Object.keys(expected).sort()),
    'Die Simulatorfassade erhält genau die bisherigen öffentlichen Namen');
for (const [name, value] of Object.entries(expected)) {
    assert(facade[name] === value, `${name}: Fassade und Definitionsmodul teilen dieselbe Bindung`);
}
assert(Object.isFrozen(facade.SIMULATOR_YEAR_OUTCOME_KINDS), 'Ergebnisarten bleiben gemeinsam eingefroren');
assert(Object.isFrozen(facade.SIMULATOR_TECHNICAL_ERROR_CODES), 'Fehlercodes bleiben gemeinsam eingefroren');
