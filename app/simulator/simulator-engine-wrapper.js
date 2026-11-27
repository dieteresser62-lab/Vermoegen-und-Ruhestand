/**
 * Module: Simulator Engine Wrapper
 * Purpose: Standardized facade for the simulation engine.
 *          Routes calls to the direct engine implementation (simulator-engine-direct.js).
 * Usage: Main entry point for running a simulation year.
 * Dependencies: simulator-engine-direct.js, simulator-engine-helpers.js
 */

"use strict";

import { simulateOneYear as simulateOneYearDirect } from './simulator-engine-direct.js';

// Re-export full initMcRunState from helpers to ensure tests get valid state
export * from './simulator-engine-helpers.js';

/**
 * Standard simulateOneYear function that uses the Direct Engine.
 *
 * @param {Object} currentState - Current state
 * @param {Object} inputs - Input parameters
 * @param {Object} yearData - Year data
 * @param {number} yearIndex - Year index
 * @param {Object} pflegeMeta - Care metadata
 * @param {number} careFloorAddition - Care floor addition
 * @param {Object} householdContext - Household context
 * @param {number} temporaryFlexFactor - Temporary flex factor
 * @param {Object} engineAPI - Optional engine override
 * @param {Object|null} replayCollector - Optional read-only parity collector
 * @param {Object|null} preparedGuardrailPlan - Immutable plan projection for an MC chunk
 * @param {boolean} preserveLogOrder - Keep public protocol field order (false only for unlogged MC years)
 * @returns {Object} Simulation result
 */
export function simulateOneYear(
    currentState,
    inputs,
    yearData,
    yearIndex,
    pflegeMeta = null,
    careFloorAddition = 0,
    householdContext = null,
    temporaryFlexFactor = 1.0,
    engineAPI = null,
    replayCollector = null,
    preparedGuardrailPlan = null,
    preserveLogOrder = true
) {
    const engine = engineAPI || (typeof window !== 'undefined' ? window.EngineAPI : null);
    return simulateOneYearDirect(
        currentState,
        inputs,
        yearData,
        yearIndex,
        pflegeMeta,
        careFloorAddition,
        householdContext,
        temporaryFlexFactor,
        engine,
        replayCollector,
        preparedGuardrailPlan,
        preserveLogOrder
    );
}

/**
 * Get the appropriate engine
 * @returns {Object} EngineAPI instance
 */
export function getEngine() {
    return typeof window !== 'undefined' ? window.EngineAPI : null;
}

/**
 * Get the appropriate simulator function
 * @returns {Function} simulateOneYear function
 */
export function getSimulatorFunction() {
    return simulateOneYearDirect;
}

// Make available globally
if (typeof window !== 'undefined') {
    window.simulateOneYear = simulateOneYear;
    window.simulateOneYearDirect = simulateOneYearDirect;
}
