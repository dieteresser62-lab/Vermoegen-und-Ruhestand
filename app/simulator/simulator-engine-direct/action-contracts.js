// @ts-check
/** @import {EngineState,Action,TaxState,TaxResolution} from '../../../typcheck/rechenkern' */
import { PLANNED_ACTION_FLOW_EPSILON, resolvePlannedAction } from '../../../types/planned-action-contract.js';
import { settleTaxYear } from '../../../engine/tax-settlement.mjs';
/** @param {import('../../../typcheck/rechenkern').PlannedActionOptions} options
 * @returns {import('../../../typcheck/rechenkern').PlannedActionResolution} */
export function resolvePlannedActionSafely(options) {
    try {
        const resolution = resolvePlannedAction(options);
        if (resolution.status !== 'resolved') return resolution;
        const action = resolution.action;
        const materializedAction = {
            ...action,
            quellen: resolution.sources.map(source => ({ ...source })),
            verwendungen: { ...resolution.uses },
            ...(action.taxRawAggregate && typeof action.taxRawAggregate === 'object'
                && !Array.isArray(action.taxRawAggregate)
                ? { taxRawAggregate: { ...action.taxRawAggregate } }
                : {}),
            ...(action.taxSettlement && typeof action.taxSettlement === 'object'
                && !Array.isArray(action.taxSettlement)
                ? { taxSettlement: { ...action.taxSettlement } }
                : {})
        };
        return { ...resolution, action: materializedAction };
    } catch (cause) {
        return {
            status: 'invalid',
            reason: 'contract_evaluation_failed',
            context: {
                cause: cause instanceof Error ? cause.message : String(cause)
            }
        };
    }
}

/** @param {import('../../../typcheck/rechenkern').PlannedActionSuccess} resolution */
export function createPlannedActionFlowSnapshot(resolution) {
    const action = resolution.action;
    const snapshot = {
        schemaVersion: 'PlannedActionFlowV1',
        contractStatus: 'resolved_pre_execution',
        type: action.type,
        quellen: resolution.sources.map(source => Object.freeze({ ...source })),
        verwendungen: Object.freeze({ ...resolution.uses }),
        nettoErlös: action.nettoErlös,
        steuer: action.steuer,
        taxRawAggregate: Object.freeze({ ...action.taxRawAggregate })
    };
    Object.freeze(snapshot.quellen);
    return Object.freeze(snapshot);
}

/** @param {unknown} value
 * @returns {value is Record<string,unknown>} */
export function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** @param {unknown} actual
 * @param {number} expected */
export function matchesSettlementNumber(actual, expected) {
    return typeof actual === 'number'
        && Number.isFinite(actual)
        && Math.abs(actual - expected) <= PLANNED_ACTION_FLOW_EPSILON;
}

/** @param {{action:Action;newState:EngineState;taxStatePrev:TaxState;sparerPauschbetrag:number;kirchensteuerSatz:number}} options
 * @returns {TaxResolution} */
export function resolveAnnualTaxSettlementSafely({
    action,
    newState,
    taxStatePrev,
    sparerPauschbetrag,
    kirchensteuerSatz
}) {
    try {
        const expected = settleTaxYear({
            taxStatePrev,
            rawAggregate: action?.taxRawAggregate,
            sparerPauschbetrag,
            kirchensteuerSatz
        });
        if (action?.taxSettlementDeferred === true) {
            return { status: 'invalid', reason: 'tax_settlement_deferred' };
        }
        if (!matchesSettlementNumber(action?.steuer, expected.taxDue)) {
            return {
                status: 'invalid',
                reason: 'action_tax_mismatch',
                context: { expectedTax: expected.taxDue, actualTax: action?.steuer }
            };
        }
        if (!isPlainRecord(action?.taxSettlement)) {
            return { status: 'invalid', reason: 'tax_settlement_shape_invalid' };
        }
        for (const [field, expectedValue] of Object.entries(expected.details)) {
            if (!matchesSettlementNumber(action.taxSettlement[field], expectedValue)) {
                return {
                    status: 'invalid',
                    reason: 'tax_settlement_detail_mismatch',
                    context: {
                        field,
                        expectedValue,
                        actualValue: action.taxSettlement[field]
                    }
                };
            }
        }
        if (!isPlainRecord(newState?.taxState)
            || !matchesSettlementNumber(newState.taxState.lossCarry, expected.taxStateNext.lossCarry)) {
            return {
                status: 'invalid',
                reason: 'tax_state_mismatch',
                context: {
                    expectedLossCarry: expected.taxStateNext.lossCarry,
                    actualLossCarry: newState?.taxState?.lossCarry
                }
            };
        }
        return { status: 'resolved', expected };
    } catch (cause) {
        return {
            status: 'invalid',
            reason: 'tax_settlement_evaluation_failed',
            context: {
                cause: cause instanceof Error ? cause.message : String(cause)
            }
        };
    }
}
