// @ts-check
/** @import {HistoricalYear,YearRuin,YearTechnicalError,RuinOptions} from '../../../typcheck/rechenkern' */
import { euros } from '../simulator-engine-direct-utils.js';
export const SIMULATOR_YEAR_OUTCOME_KINDS = Object.freeze({
    SUCCESS: 'success',
    RUIN: 'ruin',
    TECHNICAL_ERROR: 'technical_error'
});

export const SIMULATOR_TECHNICAL_ERROR_CODES = Object.freeze({
    ENGINE_API_UNAVAILABLE: 'SIM_ENGINE_API_UNAVAILABLE',
    ENGINE_METHOD_UNAVAILABLE: 'SIM_ENGINE_METHOD_UNAVAILABLE',
    ENGINE_EXECUTION_EXCEPTION: 'SIM_ENGINE_EXECUTION_EXCEPTION',
    ENGINE_RESULT_ERROR: 'SIM_ENGINE_RESULT_ERROR',
    ENGINE_RESULT_SHAPE_INVALID: 'SIM_ENGINE_RESULT_SHAPE_INVALID',
    YEAR_DATA_RETURN_INVALID: 'SIM_YEAR_DATA_RETURN_INVALID'
});

/** @param {string} code
 * @param {string} message
 * @param {unknown} cause
 * @param {unknown} details
 * @returns {YearTechnicalError} */
export function buildTechnicalErrorOutcome(code, message, cause = null, details = null) {
    const error = /** @type {import('../../../typcheck/rechenkern').TechnicalPathError} */ ({ code, message });
    if (details && typeof details === 'object') error.details = details;
    if (cause !== null && cause !== undefined) error.cause = cause;
    return {
        kind: SIMULATOR_YEAR_OUTCOME_KINDS.TECHNICAL_ERROR,
        isRuin: false,
        error
    };
}

/** @param {HistoricalYear} yearData */
export function validateRequiredYearReturns(yearData) {
    const requiredFields = ['rendite', 'gold_eur_perf', 'zinssatz'];
    const invalidFields = requiredFields.filter(field => !Number.isFinite(yearData?.[field]));
    return invalidFields.length === 0
        ? null
        : buildTechnicalErrorOutcome(
            SIMULATOR_TECHNICAL_ERROR_CODES.YEAR_DATA_RETURN_INVALID,
            `Ungültige Jahresrenditen (${SIMULATOR_TECHNICAL_ERROR_CODES.YEAR_DATA_RETURN_INVALID}). Der Lauf wurde ohne Ruinwertung beendet.`,
            null,
            { invalidFields }
        );
}

/** @param {RuinOptions} options
 * @returns {YearRuin} */
export function buildRuinOutcome({
    currentState,
    inflowLog,
    expenseLog,
    portfolio,
    liquiditaet,
    marketDataCurrentYear,
    reason,
    requiredFloorNominal,
    coveredFloorNominal,
    effectiveWithdrawalNominal,
    depotValueNominal,
    taxReconciliation = null,
    personalTaxFunding = null,
    healthBucketLog = null
}) {
    const terminalPortfolio = { ...portfolio, liquiditaet: euros(liquiditaet) };
    const normalizedRequiredFloor = euros(Math.max(0, Number(requiredFloorNominal) || 0));
    const normalizedCoveredFloor = euros(Math.max(
        0,
        Math.min(normalizedRequiredFloor, Number(coveredFloorNominal) || 0)
    ));
    const normalizedEffectiveWithdrawal = euros(Math.max(
        0,
        Math.min(normalizedCoveredFloor, Number(effectiveWithdrawalNominal) || 0)
    ));
    const normalizedDepotValue = Math.max(0, Number(depotValueNominal) || 0);
    const realizedWithdrawalRate = normalizedDepotValue > 0
        ? normalizedEffectiveWithdrawal / normalizedDepotValue
        : 0;
    return {
        kind: SIMULATOR_YEAR_OUTCOME_KINDS.RUIN,
        isRuin: true,
        reason: personalTaxFunding ? `${reason} / ${personalTaxFunding.reason}` : reason,
        ruinDetails: {
            requiredFloorNominal: normalizedRequiredFloor,
            coveredFloorNominal: normalizedCoveredFloor,
            shortfallNominal: euros(Math.max(0, normalizedRequiredFloor - normalizedCoveredFloor)),
            effectiveWithdrawalNominal: normalizedEffectiveWithdrawal,
            depotValueNominal: normalizedDepotValue,
            realizedWithdrawalRate,
            ...(taxReconciliation ? {
                taxDueNominal: taxReconciliation.totalTaxesThisYear,
                taxShortfallNominal: taxReconciliation.taxShortfall
            } : {})
        },
        logData: {
            ...(inflowLog || {}),
            ...(expenseLog || {}),
            ...(healthBucketLog || {}),
            entnahmequote: realizedWithdrawalRate,
            entnahme_effektiv: normalizedEffectiveWithdrawal,
            depotwert_gesamt: normalizedDepotValue,
            terminal_ruin_year: true,
            ruin_reason: personalTaxFunding ? `${reason} / ${personalTaxFunding.reason}` : reason,
            ...(personalTaxFunding ? { personal_tax_funding_reason: personalTaxFunding.reason,
                personal_tax_funding_shortfall: personalTaxFunding.shortfall } : {}),
            ...(taxReconciliation ? { terminal_reason: 'personal_tax_shortfall',
                tax_shortfall: taxReconciliation.taxShortfall } : {})
        },
        newState: {
            ...currentState,
            portfolio: terminalPortfolio,
            marketDataHist: marketDataCurrentYear || currentState.marketDataHist
        }
    };
}

/** @param {unknown} value */
export const formatInteger = (value) => Number.isFinite(value) ? Math.round(value) : 0;
