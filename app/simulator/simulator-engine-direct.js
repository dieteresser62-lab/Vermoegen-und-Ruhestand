// @ts-check
export { simulateOneYear } from './simulator-engine-direct/year-entry.js';
export { SIMULATOR_YEAR_OUTCOME_KINDS, SIMULATOR_TECHNICAL_ERROR_CODES } from './simulator-engine-direct/outcomes.js';
// FR-84: Tests und Messungen beobachten das Jahresergebnis samt Geldvermögen und Grundbedarf ohne Pflege.
export { observeYearOutcomesForTests, observeYearContextForTests } from './simulator-engine-direct/year-diagnostics.js';
export { initializePortfolio as initMcRunState } from './simulator-portfolio.js';
export { normalizeHouseholdContext, euros, resolveCapeRatio } from './simulator-engine-direct-utils.js';
export { makeDefaultCareMeta, sampleNextYearData, computeRunStatsFromSeries, calcCareCost,
    computeHouseholdFlexFactor, computeCareMortalityMultiplier, updateCareMeta } from './simulator-engine-helpers.js';
