// @ts-check
/** @import {SimulatorInputs,SimulationState,HistoricalYear,CareMeta,HouseholdContext,ReplayCollector,YearOutcome} from '../../../typcheck/rechenkern' */
import { homeWasSold, homeValuesByUseAtYearEnd } from '../simulator-home-sale.js';
import { validateAccumulationExpenses } from '../simulator-input-validation.js';
import { prepareGuardrailPlanInputs } from '../../shared/guardrail-history.js';
import { normalizeHouseholdContext } from '../simulator-engine-direct-utils.js';
import { resolveSimulatorCumulativeInflationFactor } from '../simulator-engine-helpers.js';
import { simulateYear } from './annual-sequence.js';
import { buildTechnicalErrorOutcome } from './outcomes.js';
import { notifyYearOutcome } from './year-diagnostics.js';
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
        notifyYearOutcome(result, yearIndex);
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
    // NK-2 (FR-84 Punkt 20): Fiele Hilfe zur Pflege an, obwohl die Person noch eine verwertbare Immobilie hat, wird das Jahr mit deren Verkauf
    // wiederholt, je Versuch eine Immobilie mehr, bis keine Hilfe mehr fällt oder keine solche Immobilie bleibt.
    /** @type {{owners: string[], count: number}|null} */
    let careSale = null;
    for (let count = 1; !result.isRuin && Array.isArray(/** @type {any} */ (result).saleBeforeCareAid) && count <= inputs.home.length; count++) {
        replayCalls = [];
        // NK-2b (Gutachten NK2C Befund 2, Fable P2-2): Eigentümer über alle Versuche sammeln; jeder Versuch verkauft eine Immobilie mehr.
        careSale = { owners: [...new Set([.../** @type {any} */ (careSale)?.owners || [], .../** @type {any} */ (result).saleBeforeCareAid])], count };
        result = simulateYear(structuredClone(currentState), inputs, yearData, yearIndex, pflegeMeta, careFloorAddition, householdContext, temporaryFlexFactor, engineAPI, deferredCollector, false, preparedGuardrailPlan, preserveLogOrder, null, careSale);
    }
    const availableHomes = inputs.home.filter((home, index) => !homeWasSold(currentState.portfolio, home, index)).length;
    const alreadySold = (result.logData?.immobilienverkauf_personen?.length || 0) - (/** @type {any} */ (result.logData)?.immobilien_verkauf_pflege || 0);
    // NK-2 (FR-84 Punkt 17, Nachtrag 4): Bleibt eine fällige Steuerschuld offen, wird das Jahr mit dem Verkauf einer Immobilie der Schuldnerin
    // oder des Schuldners wiederholt; ohne solche Immobilie läuft die Schuld weiter.
    const owners = !result.isRuin && Array.isArray(/** @type {any} */ (result).saleBeforeOpenTax) ? /** @type {string[]} */ (/** @type {any} */ (result).saleBeforeOpenTax) : null;
    const survivor = /** @type {any} */ (currentState.survivor);
    const heirOf = (/** @type {any} */ home) => survivor?.deceasedProfileId != null && survivor.deceasedProfileId === home.profileId
        ? survivor.survivorProfileId : home.profileId;
    const saleLimit = owners ? alreadySold + inputs.home.filter((home, index) => !homeWasSold(currentState.portfolio, home, index)
        && owners.includes(String(heirOf(home)))).length : availableHomes;
    for (let count = alreadySold + 1; (result.isRuin || /** @type {any} */ (result).saleBeforeOpenTax) && count <= saleLimit; count++) {
        replayCalls = [];
        result = simulateYear(structuredClone(currentState), inputs, yearData, yearIndex, pflegeMeta, careFloorAddition, householdContext, temporaryFlexFactor, engineAPI, deferredCollector, count, preparedGuardrailPlan, preserveLogOrder, owners, careSale);
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
