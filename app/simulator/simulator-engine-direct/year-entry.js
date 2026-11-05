// @ts-check
/** @import {SimulatorInputs,SimulationState,HistoricalYear,CareMeta,HouseholdContext,ReplayCollector,YearOutcome} from '../../../typcheck/rechenkern' */
import { homeWasSold, homeValuesByUseAtYearEnd } from '../simulator-home-sale.js';
import { validateAccumulationExpenses } from '../simulator-input-validation.js';
import { prepareGuardrailPlanInputs } from '../../shared/guardrail-history.js';
import { normalizeHouseholdContext } from '../simulator-engine-direct-utils.js';
import { resolveSimulatorCumulativeInflationFactor } from '../simulator-engine-helpers.js';
import { simulateYear } from './annual-sequence.js';
import { buildTechnicalErrorOutcome } from './outcomes.js';
/**
 * FAIL-SAFE Liquidity Guard - Hilfsfunktionen
 */

/** * Simuliert ein Jahr des Ruhestandsszenarios - DIREKTE EngineAPI Version
 *
 * HAUPTUNTERSCHIED zur Adapter-Version:
 * - Verwendet EINEN EngineAPI.simulateSingleYear() Aufruf
 * - Statt mehrerer Adapter-Methoden (determineSpending, determineAction, calculateSaleAndTax)
 * - Direkter Zugriff auf diagnosis, ui.spending, ui.action
 * */
/** @param {SimulationState} currentState
 * @param {SimulatorInputs} inputs
 * @param {HistoricalYear} yearData
 * @param {number} yearIndex
 * @param {CareMeta|null} pflegeMeta
 * @param {number} careFloorAddition
 * @param {Partial<HouseholdContext>|null} householdContext
 * @param {number} temporaryFlexFactor
 * @param {Partial<typeof import("../../../engine/index.mjs").EngineAPI>|null} engineAPI
 * @param {ReplayCollector|null} replayCollector
 * @param {ReturnType<typeof prepareGuardrailPlanInputs>|null} preparedGuardrailPlan
 * @param {boolean} preserveLogOrder
 * @returns {YearOutcome} */
export function simulateOneYear(currentState, inputs, yearData, yearIndex, pflegeMeta = null, careFloorAddition = 0, householdContext = null, temporaryFlexFactor = 1.0, engineAPI = null, replayCollector = null, preparedGuardrailPlan = null, preserveLogOrder = true) {
    try { validateAccumulationExpenses(inputs); }
    catch (error) { return buildTechnicalErrorOutcome('SIM_ACCUMULATION_EXPENSES_UNSUPPORTED', /** @type {Error} */ (error).message); }
    /** @param {YearOutcome} result
 * @returns {YearOutcome} */
    const displayResult = result => {
        if (inputs.home?.length && result.logData) {
            const displayHomes = homeValuesByUseAtYearEnd({ inputs,
                portfolio: result.newState?.portfolio || result.portfolio || currentState.portfolio,
                survivor: result.newState?.survivor || result.logData.inheritance || currentState.survivor,
                household: normalizeHouseholdContext(householdContext),
                inflationFactor: resolveSimulatorCumulativeInflationFactor(currentState) * (1 + yearData.inflation / 100) });
            result.logData.immobilien_wert_end = displayHomes.total;
            result.logData.immobilien_selbst_end = displayHomes.self;
            result.logData.immobilien_vermietet_end = displayHomes.rented;
        }
        return result;
    };
    if (!inputs.home?.some((home, index) => !homeWasSold(currentState.portfolio, home, index))) {
        return displayResult(simulateYear(currentState, inputs, yearData, yearIndex, pflegeMeta, careFloorAddition, householdContext, temporaryFlexFactor, engineAPI, replayCollector, false, preparedGuardrailPlan, preserveLogOrder));
    }
    // FR-61: Vor jedem Ruin noch einmal verkaufen. Die vollständige Jahresrechnung
    // wird vom unverbrauchten Anfangszustand wiederholt, damit Miete, Einkünfte,
    // Steuern und Nachlass genau einmal mit dem Verkauf gerechnet werden.
    // Bestände werden im Jahrespfad verändert; der zweite Versuch braucht eigene Lots.
    let replayCalls = /** @type {import('../../../typcheck/rechenkern').ReplayCall[]} */ ([]);
    const deferredCollector = replayCollector ? {
        /** @param {[SimulationState,number,HistoricalYear]} values */
        beginYear(...values) { replayCalls.push(['beginYear', structuredClone(values)]); },
        /** @param {unknown} _
 * @param {unknown} value */
        beforeEngine(_, value) { replayCalls.push(['beforeEngine', structuredClone(value)]); },
        /** @param {unknown} _
 * @param {unknown} value */
        afterEngine(_, value) { replayCalls.push(['afterEngine', structuredClone(value)]); }
    } : null;
    let result = simulateYear(structuredClone(currentState), inputs, yearData, yearIndex, pflegeMeta, careFloorAddition, householdContext, temporaryFlexFactor, engineAPI, deferredCollector, false, preparedGuardrailPlan, preserveLogOrder);
    const availableHomes = inputs.home.filter((home, index) => !homeWasSold(currentState.portfolio, home, index)).length;
    const alreadySold = result.logData?.immobilienverkauf_personen?.length || 0;
    for (let count = alreadySold + 1; result.isRuin && count <= availableHomes; count++) {
        replayCalls = [];
        result = simulateYear(structuredClone(currentState), inputs, yearData, yearIndex, pflegeMeta, careFloorAddition, householdContext, temporaryFlexFactor, engineAPI, deferredCollector, count, preparedGuardrailPlan, preserveLogOrder);
    }
    if (replayCollector) {
        let replayYear;
        for (const [method, value] of replayCalls) {
            if (method === 'beginYear') replayYear = replayCollector.beginYear(...value);
            else replayCollector[method](replayYear, value);
        }
    }
    return displayResult(result);
}
