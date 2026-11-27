// @ts-check
/** @import {SimulatorInputs,SimulationState,HistoricalYear,CareMeta,HouseholdContext,ReplayCollector,YearOutcome} from '../../../typcheck/rechenkern' */
import { prepareGuardrailPlanInputs } from '../../shared/guardrail-history.js';
import { resolveProfileKey } from '../simulator-heatmap.js';
import { CONFIG } from '../../../engine/config.mjs';
import { prepareYear } from './year-preparation.js';
import { applyYearMarket } from './year-market.js';
import { decideYear } from './engine-decision.js';
import { prepareYearAction } from './action-plan.js';
import { executeYearAction } from './action-execution.js';
import { coverYearWithdrawal } from './withdrawal-coverage.js';
import { payYearWithdrawal } from './year-payout.js';
import { settleYear } from './year-tax-inheritance.js';
import { completeYear } from './year-protocol.js';
import { withBasicCoverage, notifyYearContext } from './year-diagnostics.js';
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
 * @returns {YearOutcome}
 * @param {number|boolean} beforeRuin
 * @param {string[]|null} [homeSaleOwners] NK-2: Notverkauf nur aus Immobilien dieser Personen (offene Altschuld einer Person).
 * @param {{owners: string[], count: number}|null} [careSale] NK-2 (FR-84 Punkt 20): Verkauf vor der Hilfe zur Pflege. */
export function simulateYear(currentState, inputs, yearData, yearIndex, pflegeMeta, careFloorAddition, householdContext, temporaryFlexFactor, engineAPI, replayCollector, beforeRuin = false, preparedGuardrailPlan = null, preserveLogOrder = true, homeSaleOwners = null, careSale = null) {
    // Ein Kontext je Jahresversuch; Object.assign erhält seine Identität und die der Bestände.
    const context1 = { currentState, inputs, yearData, yearIndex, pflegeMeta, careFloorAddition, householdContext, temporaryFlexFactor, engineAPI, replayCollector, beforeRuin, preparedGuardrailPlan, preserveLogOrder, homeSaleOwners, careSale };
    notifyYearContext('begin', context1);
    const phase1 = prepareYear(context1);
    if (phase1.outcome) return phase1.outcome;
    const context2 = Object.assign(context1, phase1.state);
    const phase2 = applyYearMarket(context2);
    if (phase2.outcome) return phase2.outcome;
    const context3 = Object.assign(context2, phase2.state);
    notifyYearContext('market', context3);
    const phase3 = decideYear(context3);
    if (phase3.outcome) return phase3.outcome;
    const context4 = Object.assign(context3, phase3.state);
    const phase4 = prepareYearAction(context4);
    if (phase4.outcome) return withBasicCoverage(phase4.outcome, context4);
    const context5 = Object.assign(context4, phase4.state);
    const phase5 = executeYearAction(context5);
    const context6 = Object.assign(context5, phase5.state);
    const phase6 = coverYearWithdrawal(context6);
    const context7 = Object.assign(context6, phase6.state);
    const phase7 = payYearWithdrawal(context7);
    if (phase7.outcome) return withBasicCoverage(phase7.outcome, context7);
    const context8 = Object.assign(context7, phase7.state);
    notifyYearContext('payout', context8);
    const phase8 = settleYear(context8);
    if (phase8.outcome) return withBasicCoverage(phase8.outcome, context8);
    const context9 = Object.assign(context8, phase8.state);
    const outcome = completeYear(context9);
    notifyYearContext('end', context9);
    return outcome;
}
