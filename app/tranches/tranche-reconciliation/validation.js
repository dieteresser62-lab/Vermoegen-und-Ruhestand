// @ts-check
import { SALE_ID_MAX_LENGTH, RECONCILIATION_EVENT_TYPES, fail, RECONCILIATION_CASH_STATUSES, MAX_CORRECTION_REVISION, CASH_CONFIRMATION_PREFIX, CASH_CORRECTION_PREFIX } from './schema.js';

export function hasOwn(value, field) {
    return Boolean(value) && Object.prototype.hasOwnProperty.call(value, field);
}

export function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

export function normalizeRequiredId(value, field, options = {}) {
    const {
        maxLength = SALE_ID_MAX_LENGTH,
        eventType = RECONCILIATION_EVENT_TYPES.SALE,
        allowReservedSalePrefix = true
    } = options;
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) {
        fail(
            'RECONCILIATION_ID_INVALID',
            `${eventType}.${field} muss eine nicht leere, stabile ID ohne Steuerzeichen sein.`,
            { field }
        );
    }
    if (normalized.length > maxLength) {
        fail(
            'RECONCILIATION_ID_INVALID',
            `${eventType}.${field} hat ${normalized.length} Zeichen; für diesen Eventtyp sind maximal ${maxLength} erlaubt.`,
            { field, details: { eventType, actualLength: normalized.length, maxLength } }
        );
    }
    if (!allowReservedSalePrefix
        && (normalized.startsWith('cash-confirmation:') || normalized.startsWith('cash-correction:'))) {
        fail(
            'RECONCILIATION_ACTION_ID_RESERVED',
            `${field} verwendet einen für Cash-Folgeereignisse reservierten Namensraum.`,
            { field }
        );
    }
    return normalized;
}

export function normalizeTimestamp(value, field) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || !/^\d{4}-\d{2}-\d{2}T/.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
        fail('RECONCILIATION_TIMESTAMP_INVALID', `${field} muss ein gültiger ISO-Zeitpunkt sein.`, { field });
    }
    return normalized;
}

export function normalizeCashStatus(value) {
    const normalized = value === undefined || value === null || value === ''
        ? RECONCILIATION_CASH_STATUSES.PENDING
        : String(value).trim();
    if (normalized !== RECONCILIATION_CASH_STATUSES.PENDING
        && normalized !== RECONCILIATION_CASH_STATUSES.ALREADY_REFLECTED) {
        fail(
            'RECONCILIATION_CASH_STATUS_INVALID',
            'cashStatus muss pending_manual_posting oder confirmed_already_reflected sein.',
            { field: 'cashStatus' }
        );
    }
    return normalized;
}

export function normalizeCorrectionRevision(value) {
    if (typeof value !== 'number' || !Number.isInteger(value)
        || value < 1 || value > MAX_CORRECTION_REVISION) {
        fail(
            'RECONCILIATION_CORRECTION_REVISION_INVALID',
            `correctionRevision muss eine kanonische Ganzzahl von 1 bis ${MAX_CORRECTION_REVISION} sein.`,
            { field: 'correctionRevision' }
        );
    }
    return value;
}

export function normalizeReason(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
        fail(
            'RECONCILIATION_CORRECTION_REASON_REQUIRED',
            'correctionReason darf nach dem Kürzen nicht leer sein.',
            { field: 'correctionReason' }
        );
    }
    return normalized;
}

export function sameEuroCent(left, right) {
    return Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
}

export function normalizeNumber(value, field, options = {}) {
    const { min = null, greaterThan = null, optional = false } = options;
    if (optional && (value === '' || value === null || value === undefined)) return null;
    if (value === '' || value === null || value === undefined) {
        fail('RECONCILIATION_NUMBER_INVALID', `${field} muss eine endliche Zahl sein.`, { field });
    }
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) {
        fail('RECONCILIATION_NUMBER_INVALID', `${field} muss eine endliche Zahl sein.`, { field });
    }
    if (greaterThan !== null && number <= greaterThan) {
        fail('RECONCILIATION_NUMBER_OUT_OF_RANGE', `${field} muss größer als ${greaterThan} sein.`, { field });
    }
    if (min !== null && number < min) {
        fail('RECONCILIATION_NUMBER_OUT_OF_RANGE', `${field} muss mindestens ${min} sein.`, { field });
    }
    return number;
}

export function normalizeExecutionDate(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    const date = match ? new Date(`${normalized}T00:00:00.000Z`) : null;
    if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
        fail(
            'RECONCILIATION_DATE_INVALID',
            'executedAt muss ein gültiger Kalendertag im Format JJJJ-MM-TT sein.',
            { field: 'executedAt' }
        );
    }
    return normalized;
}

/** @param {{sharesSold?: unknown, grossProceeds?: unknown}} [raw] */
function normalizeRecommendation(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const sharesSold = normalizeNumber(raw.sharesSold, 'recommendation.sharesSold', {
        optional: true,
        greaterThan: 0
    });
    const grossProceeds = normalizeNumber(raw.grossProceeds, 'recommendation.grossProceeds', {
        optional: true,
        min: 0
    });
    if (sharesSold === null && grossProceeds === null) return null;
    return {
        ...(sharesSold !== null ? { sharesSold } : {}),
        ...(grossProceeds !== null ? { grossProceeds } : {})
    };
}

export function normalizeReconciliationAction(raw, expectedProfileId = null) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail('RECONCILIATION_ACTION_INVALID', 'Die tatsächliche Ausführung muss als Objekt angegeben werden.');
    }
    const actionId = normalizeRequiredId(raw.actionId, 'actionId', {
        eventType: RECONCILIATION_EVENT_TYPES.SALE,
        allowReservedSalePrefix: false
    });
    const profileId = normalizeRequiredId(raw.profileId, 'profileId');
    const trancheId = normalizeRequiredId(raw.trancheId, 'trancheId');
    if (expectedProfileId !== null && profileId !== expectedProfileId) {
        fail(
            'RECONCILIATION_PROFILE_MISMATCH',
            `Die Ausführung gehört zu Profil ${profileId}, geöffnet ist jedoch ${expectedProfileId}.`,
            { field: 'profileId', details: { expectedProfileId, actualProfileId: profileId } }
        );
    }

    const sharesSold = normalizeNumber(raw.sharesSold, 'sharesSold', { greaterThan: 0 });
    const grossProceeds = normalizeNumber(raw.grossProceeds, 'grossProceeds', { greaterThan: 0 });
    const fees = normalizeNumber(raw.fees ?? 0, 'fees', { min: 0 });
    const taxes = hasOwn(raw, 'taxes') ? normalizeNumber(raw.taxes, 'taxes', { min: 0 }) : 0;
    if (fees + taxes > grossProceeds) {
        fail(
            'RECONCILIATION_FEES_EXCEED_PROCEEDS',
            'Gebühren dürfen den tatsächlichen Bruttoerlös nicht übersteigen.',
            { field: 'fees' }
        );
    }

    const cashStatus = normalizeCashStatus(raw.cashStatus);
    const cashFields = cashStatus === RECONCILIATION_CASH_STATUSES.ALREADY_REFLECTED
        ? {
            cashBalanceAfterPostingEur: normalizeNumber(
                raw.cashBalanceAfterPostingEur,
                'cashBalanceAfterPostingEur'
            ),
            cashConfirmedAt: normalizeTimestamp(raw.cashConfirmedAt, 'cashConfirmedAt')
        }
        : {};
    if (cashStatus === RECONCILIATION_CASH_STATUSES.PENDING
        && (hasOwn(raw, 'cashBalanceAfterPostingEur') || hasOwn(raw, 'cashConfirmedAt'))) {
        fail(
            'RECONCILIATION_CASH_FIELDS_UNEXPECTED',
            'Ein offener Cashstatus darf noch keinen bestätigten Cashstand oder Bestätigungszeitpunkt tragen.',
            { field: 'cashStatus' }
        );
    }

    return {
        actionId,
        profileId,
        trancheId,
        executedAt: normalizeExecutionDate(raw.executedAt),
        sharesSold,
        grossProceeds,
        fees,
        ...(hasOwn(raw, 'taxes') ? { taxes } : {}),
        ...(raw.source === 'spielwert' ? { source: 'spielwert' } : {}),
        netProceeds: grossProceeds - fees - taxes,
        recommendation: normalizeRecommendation(raw.recommendation),
        cashStatus,
        ...cashFields
    };
}

export function deriveCashConfirmationActionId(targetActionId) {
    const normalizedTargetActionId = normalizeRequiredId(targetActionId, 'targetActionId', {
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CONFIRMATION,
        maxLength: SALE_ID_MAX_LENGTH
    });
    return `${CASH_CONFIRMATION_PREFIX}${normalizedTargetActionId}`;
}

export function deriveCashCorrectionActionId(targetActionId, revision) {
    const normalizedTargetActionId = normalizeRequiredId(targetActionId, 'targetActionId', {
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
        maxLength: SALE_ID_MAX_LENGTH
    });
    const normalizedRevision = normalizeCorrectionRevision(revision);
    return `${CASH_CORRECTION_PREFIX}${normalizedTargetActionId}:${normalizedRevision}`;
}
