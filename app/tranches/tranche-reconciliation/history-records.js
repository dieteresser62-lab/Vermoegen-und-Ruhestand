// @ts-check
import { hasOwn, normalizeRequiredId, normalizeNumber, sameEuroCent, cloneJson, normalizeExecutionDate, normalizeCashStatus, normalizeTimestamp, deriveCashConfirmationActionId, normalizeCorrectionRevision, deriveCashCorrectionActionId, normalizeReason } from './validation.js';
import { RECONCILIATION_EVENT_TYPES, fail, TRANCHE_RECONCILIATION_SCHEMA_VERSION, SALE_ID_MAX_LENGTH, RECONCILIATION_CASH_STATUSES, CONFIRMATION_ID_MAX_LENGTH, CORRECTION_ID_MAX_LENGTH } from './schema.js';

export function readEventType(record, index) {
    if (!hasOwn(record, 'eventType')) return { eventType: RECONCILIATION_EVENT_TYPES.SALE, legacy: true };
    const eventType = typeof record.eventType === 'string' ? record.eventType.trim() : '';
    if (!Object.values(RECONCILIATION_EVENT_TYPES).includes(eventType)) {
        fail(
            'RECONCILIATION_EVENT_TYPE_UNSUPPORTED',
            `Reconcile-Eintrag ${index + 1} besitzt den unbekannten Eventtyp ${eventType || '<leer>'}.`,
            { field: 'eventType', details: { index, eventType } }
        );
    }
    return { eventType, legacy: false };
}

export function normalizeSaleHistoryRecord(record, { legacy }) {
    if (record.schemaVersion !== TRANCHE_RECONCILIATION_SCHEMA_VERSION) {
        fail('RECONCILIATION_HISTORY_INVALID', 'Verkaufsrecord besitzt eine nicht unterstützte Schemaversion.');
    }
    const actionId = normalizeRequiredId(record.actionId, 'actionId', {
        eventType: RECONCILIATION_EVENT_TYPES.SALE,
        maxLength: SALE_ID_MAX_LENGTH,
        allowReservedSalePrefix: legacy
    });
    const actual = record.actual;
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
        fail('RECONCILIATION_HISTORY_INVALID', `Verkauf ${actionId} besitzt keine gültigen Ausführungsdaten.`);
    }
    const sharesSold = normalizeNumber(actual.sharesSold, 'actual.sharesSold', { greaterThan: 0 });
    const grossProceeds = normalizeNumber(actual.grossProceeds, 'actual.grossProceeds', { greaterThan: 0 });
    const fees = normalizeNumber(actual.fees, 'actual.fees', { min: 0 });
    const netProceeds = normalizeNumber(actual.netProceeds, 'actual.netProceeds');
    const taxes = hasOwn(actual, 'taxes') ? normalizeNumber(actual.taxes, 'actual.taxes', { min: 0 }) : 0;
    if (fees + taxes > grossProceeds || !sameEuroCent(netProceeds, grossProceeds - fees - taxes)) {
        fail(
            'RECONCILIATION_HISTORY_INVALID',
            `Verkauf ${actionId} besitzt einen inkonsistenten Nettoerlös.`,
            { field: 'actual.netProceeds' }
        );
    }

    const projected = {
        ...cloneJson(record),
        eventType: RECONCILIATION_EVENT_TYPES.SALE,
        actionId,
        profileId: normalizeRequiredId(record.profileId, 'profileId'),
        trancheId: normalizeRequiredId(record.trancheId, 'trancheId'),
        executedAt: normalizeExecutionDate(record.executedAt),
        actual: { ...cloneJson(actual), sharesSold, grossProceeds, fees, netProceeds }
    };

    if (legacy) {
        projected.cashStatus = RECONCILIATION_CASH_STATUSES.LEGACY_UNKNOWN;
        delete projected.cashBalanceAfterPostingEur;
        delete projected.cashConfirmedAt;
        return projected;
    }

    if (!hasOwn(record, 'cashStatus')) {
        fail(
            'RECONCILIATION_CASH_STATUS_INVALID',
            `Neuer Verkauf ${actionId} besitzt keinen expliziten initialen Cashstatus.`,
            { field: 'cashStatus' }
        );
    }
    const cashStatus = normalizeCashStatus(record.cashStatus);
    projected.cashStatus = cashStatus;
    if (cashStatus === RECONCILIATION_CASH_STATUSES.ALREADY_REFLECTED) {
        projected.cashBalanceAfterPostingEur = normalizeNumber(
            record.cashBalanceAfterPostingEur,
            'cashBalanceAfterPostingEur'
        );
        projected.cashConfirmedAt = normalizeTimestamp(record.cashConfirmedAt, 'cashConfirmedAt');
    } else if (hasOwn(record, 'cashBalanceAfterPostingEur') || hasOwn(record, 'cashConfirmedAt')) {
        fail(
            'RECONCILIATION_CASH_FIELDS_UNEXPECTED',
            `Offener Verkauf ${actionId} darf keine Bestätigungsfelder tragen.`,
            { field: 'cashStatus' }
        );
    }
    return projected;
}

export function normalizeConfirmationHistoryRecord(record) {
    if (record.schemaVersion !== TRANCHE_RECONCILIATION_SCHEMA_VERSION) {
        fail('RECONCILIATION_HISTORY_INVALID', 'Cashabschluss besitzt eine nicht unterstützte Schemaversion.');
    }
    const actionId = normalizeRequiredId(record.actionId, 'actionId', {
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CONFIRMATION,
        maxLength: CONFIRMATION_ID_MAX_LENGTH
    });
    const confirmationActionId = normalizeRequiredId(record.confirmationActionId, 'confirmationActionId', {
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CONFIRMATION,
        maxLength: CONFIRMATION_ID_MAX_LENGTH
    });
    const targetActionId = normalizeRequiredId(record.targetActionId, 'targetActionId', {
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CONFIRMATION,
        maxLength: SALE_ID_MAX_LENGTH
    });
    const canonicalId = deriveCashConfirmationActionId(targetActionId);
    if (actionId !== confirmationActionId || actionId !== canonicalId) {
        fail(
            'RECONCILIATION_CONFIRMATION_ID_INVALID',
            `Cashabschluss für ${targetActionId} muss die kanonische ID ${canonicalId} in actionId und confirmationActionId tragen.`,
            { field: 'confirmationActionId' }
        );
    }
    return {
        ...cloneJson(record),
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CONFIRMATION,
        actionId,
        confirmationActionId,
        targetActionId,
        profileId: normalizeRequiredId(record.profileId, 'profileId'),
        confirmedNetProceedsEur: normalizeNumber(record.confirmedNetProceedsEur, 'confirmedNetProceedsEur'),
        cashBalanceAfterPostingEur: normalizeNumber(record.cashBalanceAfterPostingEur, 'cashBalanceAfterPostingEur'),
        confirmedAt: normalizeTimestamp(record.confirmedAt, 'confirmedAt')
    };
}

export function normalizeCorrectionHistoryRecord(record) {
    if (record.schemaVersion !== TRANCHE_RECONCILIATION_SCHEMA_VERSION) {
        fail('RECONCILIATION_HISTORY_INVALID', 'Cashkorrektur besitzt eine nicht unterstützte Schemaversion.');
    }
    const actionId = normalizeRequiredId(record.actionId, 'actionId', {
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
        maxLength: CORRECTION_ID_MAX_LENGTH
    });
    const correctionActionId = normalizeRequiredId(record.correctionActionId, 'correctionActionId', {
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
        maxLength: CORRECTION_ID_MAX_LENGTH
    });
    const targetActionId = normalizeRequiredId(record.targetActionId, 'targetActionId', {
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
        maxLength: SALE_ID_MAX_LENGTH
    });
    const correctionRevision = normalizeCorrectionRevision(record.correctionRevision);
    const canonicalId = deriveCashCorrectionActionId(targetActionId, correctionRevision);
    if (actionId !== correctionActionId || actionId !== canonicalId) {
        fail(
            'RECONCILIATION_CORRECTION_ID_INVALID',
            `Cashkorrektur für ${targetActionId} muss die kanonische ID ${canonicalId} in actionId und correctionActionId tragen.`,
            { field: 'correctionActionId' }
        );
    }
    return {
        ...cloneJson(record),
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
        actionId,
        correctionActionId,
        targetActionId,
        correctsActionId: normalizeRequiredId(record.correctsActionId, 'correctsActionId', {
            eventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
            maxLength: CORRECTION_ID_MAX_LENGTH
        }),
        correctionRevision,
        profileId: normalizeRequiredId(record.profileId, 'profileId'),
        confirmedNetProceedsEur: normalizeNumber(record.confirmedNetProceedsEur, 'confirmedNetProceedsEur'),
        cashBalanceAfterPostingEur: normalizeNumber(record.cashBalanceAfterPostingEur, 'cashBalanceAfterPostingEur'),
        correctionReason: normalizeReason(record.correctionReason),
        correctedAt: normalizeTimestamp(record.correctedAt, 'correctedAt')
    };
}
