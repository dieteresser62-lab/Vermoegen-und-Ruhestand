/**
 * Module: Balance Config
 * Purpose: Defines global application constants, configuration settings (Versions, Storage Keys), and custom Error classes.
 * Usage: Imported by almost all other modules for shared constants and error handling.
 * Dependencies: None
 */
"use strict";

/**
 * ===================================================================================
 * BALANCE-APP KONFIGURATION & FEHLERKLASSEN
 * ===================================================================================
 */

// Erforderliche Engine-Version
export const REQUIRED_ENGINE_API_VERSION_PREFIX = "31.";

// Gemeinsame Entprellzeit für Eingabeupdates und deren Testbeobachtung.
export const BALANCE_UPDATE_DEBOUNCE_MS = 250;

// Reine Ausgabehosts; keine zusätzlichen Formular- oder Engineparameter.
export const BALANCE_PRESENTATION_OUTPUT_IDS = Object.freeze({
    balanceAnnualAction: 'balanceAnnualAction',
    balanceActionDisclaimer: 'balanceActionDisclaimer',
    balanceBudgetWhy: 'balanceBudgetWhy',
    balanceBudgetTrace: 'balanceBudgetTrace',
    balanceBudgetPreview: 'balanceBudgetPreview',
    balanceBudgetPlan: 'balanceBudgetPlan',
    balanceWithdrawalPlan: 'balanceWithdrawalPlan',
    balanceIncomeDetails: 'balanceIncomeDetails',
    balanceBudgetBar: 'balanceBudgetBar',
    balanceFlowBudget: 'balanceFlowBudget',
    balanceFlowNeed: 'balanceFlowNeed',
    balanceFlowWithdrawal: 'balanceFlowWithdrawal',
    balanceFlowWithdrawalSign: 'balanceFlowWithdrawalSign',
    balanceFlowSaving: 'balanceFlowSaving',
    balanceFlowSavingSign: 'balanceFlowSavingSign',
    balanceMonthlySaving: 'balanceMonthlySaving',
    balanceIncomeSurplusNote: 'balanceIncomeSurplusNote',
    balancePlannedExpensesNote: 'balancePlannedExpensesNote',
    balanceCareHint: 'balanceCareHint',
    balanceReserveCoverage: 'balanceReserveCoverage',
    balanceReserveRunway: 'balanceReserveRunway',
    balanceReserveValues: 'balanceReserveValues',
    balanceReserveParts: 'balanceReserveParts',
    balanceReserveTarget: 'balanceReserveTarget',
    balancePersonalCashTargets: 'balancePersonalCashTargets',
    balanceReserveBar: 'balanceReserveBar',
    balanceReserveAfterBar: 'balanceReserveAfterBar',
    balanceReserveGoalMark: 'balanceReserveGoalMark',
    liquiditaetBalken: 'liquiditaetBalken',
    balanceNeedTotal: 'balanceNeedTotal',
    balanceFloorCoverage: 'balanceFloorCoverage'
});

// App-spezifische Konfiguration
export const CONFIG = {
    APP: {
        VERSION: 'v22.0 ES6 Modules (Engine v31)',
        NAME: 'Ruhestand-Balancing'
    },
    STORAGE: {
        LS_KEY: `ruhestandsmodellValues_v29_guardrails`,
        MIGRATION_FLAG: 'migration_v29_inflation_sanitized',
        SNAPSHOT_PREFIX: 'ruhestandsmodell_snapshot_'
    }
};

// FEHLERKLASSEN
export class AppError extends Error {
    /** @param {string} message @param {object} [context] @param {ErrorOptions} [options] */
    constructor(message, context = {}, options) {
        super(message, options);
        this.context = context;
        this.timestamp = new Date();
    }
}

export class ValidationError extends AppError {
    /** @param {import('../../typcheck/balance-ui.js').ValidationEntry[]} errors */
    constructor(errors) {
        super("Einige Eingaben sind ungültig. Bitte korrigieren Sie die markierten Felder.");
        this.name = 'ValidationError';
        this.errors = errors; // Array von {field, message}
    }
}

export class FinancialCalculationError extends AppError {
    /** @param {string} message @param {object} [context] */
    constructor(message, context) {
        super(message, context);
        this.name = 'FinancialCalculationError';
    }
}

export class StorageError extends AppError {
    /** @param {string} message @param {object} [context] */
    constructor(message, context) {
        super(message, context);
        this.name = 'StorageError';
    }
}
