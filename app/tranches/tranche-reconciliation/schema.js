// @ts-check

export const TRANCHE_RECONCILIATION_SCHEMA_VERSION = 1;

export const TRANCHE_RECONCILIATION_REGISTRY_FIELD = 'trancheReconciliation';

export const RECONCILIATION_EVENT_TYPES = Object.freeze({
    SALE: 'sale_reconciled',
    // VK-2 (FR-79 Punkt 7, Regelprüfung VKR Abschnitt 2 Punkt 1): Kauf als eigenes Ereignis im Abgleich.
    BUY: 'buy_reconciled',
    // VK-3 (Nachtrag 2): Storno eines Kaufbelegs, wenn die Tranche ohne Verkauf gelöscht wird („Kauf rückgängig“).
    BUY_CANCELLATION: 'buy_cancelled',
    CASH_CONFIRMATION: 'cash_posting_confirmed',
    CASH_CORRECTION: 'cash_posting_corrected'
});

export const RECONCILIATION_CASH_STATUSES = Object.freeze({
    PENDING: 'pending_manual_posting',
    ALREADY_REFLECTED: 'confirmed_already_reflected',
    LEGACY_UNKNOWN: 'legacy_unknown',
    MANUALLY_CONFIRMED: 'confirmed_manual_posting',
    CORRECTED: 'confirmed_corrected'
});

export const SHARE_EPSILON = 1e-10;

export const SALE_ID_MAX_LENGTH = 128;

export const CONFIRMATION_ID_MAX_LENGTH = 149;

export const CORRECTION_ID_MAX_LENGTH = 154;

export const CASH_CONFIRMATION_PREFIX = 'cash-confirmation:v1:';

export const CASH_CORRECTION_PREFIX = 'cash-correction:v1:';

export const MAX_CORRECTION_REVISION = 999999;

export class TrancheReconciliationError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'TrancheReconciliationError';
        this.code = code;
        this.field = options.field || null;
        this.retryable = options.retryable === true;
        this.details = options.details || null;
        if (options.cause) this.cause = options.cause;
    }
}

export function fail(code, message, options = {}) {
    throw new TrancheReconciliationError(code, message, options);
}
