// @ts-check
import { hasOwn, sameEuroCent, normalizeRequiredId, deriveCashConfirmationActionId, normalizeNumber, normalizeTimestamp, normalizeCorrectionRevision, deriveCashCorrectionActionId, normalizeReason } from './validation.js';
import { fail, RECONCILIATION_EVENT_TYPES, SALE_ID_MAX_LENGTH, TRANCHE_RECONCILIATION_SCHEMA_VERSION, CORRECTION_ID_MAX_LENGTH } from './schema.js';
import { readReconciliationHistory, projectReconciliationCashStatuses, parseRegistry } from './history.js';

function requireTargetSale(registry, profileId, targetActionId) {
    if (!hasOwn(registry.profiles, profileId)) {
        fail('RECONCILIATION_PROFILE_UNKNOWN', `Profil ${profileId} ist in der Profilregistry nicht vorhanden.`);
    }
    const history = readReconciliationHistory(registry);
    const sale = history.find(record => (
        record.eventType === RECONCILIATION_EVENT_TYPES.SALE
        && record.actionId === targetActionId
    ));
    if (!sale) {
        fail(
            'RECONCILIATION_CASH_TARGET_INVALID',
            `Der Zielverkauf ${targetActionId} ist nicht vorhanden.`,
            { field: 'targetActionId' }
        );
    }
    if (sale.profileId !== profileId) {
        fail(
            'RECONCILIATION_PROFILE_MISMATCH',
            `Der Zielverkauf ${targetActionId} gehört zu Profil ${sale.profileId}, geöffnet ist ${profileId}.`,
            { field: 'profileId' }
        );
    }
    const status = projectReconciliationCashStatuses(registry, profileId)
        .find(item => item.targetActionId === targetActionId);
    if (!status) {
        fail('RECONCILIATION_CASH_TARGET_INVALID', `Für Verkauf ${targetActionId} ist kein Cashstatus ableitbar.`);
    }
    return { history, sale, status };
}

function sameConfirmationRecord(left, right) {
    return left.eventType === right.eventType
        && left.actionId === right.actionId
        && left.confirmationActionId === right.confirmationActionId
        && left.targetActionId === right.targetActionId
        && left.profileId === right.profileId
        && sameEuroCent(left.confirmedNetProceedsEur, right.confirmedNetProceedsEur)
        && Number(left.cashBalanceAfterPostingEur) === Number(right.cashBalanceAfterPostingEur);
}

function sameCorrectionRecord(left, right) {
    return left.eventType === right.eventType
        && left.actionId === right.actionId
        && left.correctionActionId === right.correctionActionId
        && left.targetActionId === right.targetActionId
        && left.correctsActionId === right.correctsActionId
        && left.correctionRevision === right.correctionRevision
        && left.profileId === right.profileId
        && sameEuroCent(left.confirmedNetProceedsEur, right.confirmedNetProceedsEur)
        && Number(left.cashBalanceAfterPostingEur) === Number(right.cashBalanceAfterPostingEur)
        && left.correctionReason === right.correctionReason;
}

export function previewCashPostingConfirmation(request) {
    const profileId = normalizeRequiredId(request?.profileId, 'profileId');
    const targetActionId = normalizeRequiredId(request?.targetActionId, 'targetActionId', {
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CONFIRMATION,
        maxLength: SALE_ID_MAX_LENGTH
    });
    const registry = parseRegistry(request?.registry);
    const { history, sale, status } = requireTargetSale(registry, profileId, targetActionId);
    const confirmationActionId = deriveCashConfirmationActionId(targetActionId);
    const auditRecord = {
        schemaVersion: TRANCHE_RECONCILIATION_SCHEMA_VERSION,
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CONFIRMATION,
        actionId: confirmationActionId,
        confirmationActionId,
        targetActionId,
        profileId,
        ...(sale.source === 'spielwert' ? { source: 'spielwert' } : {}),
        confirmedNetProceedsEur: sale.actual.netProceeds,
        cashBalanceAfterPostingEur: normalizeNumber(
            request?.cashBalanceAfterPostingEur,
            'cashBalanceAfterPostingEur'
        ),
        confirmedAt: normalizeTimestamp(request?.confirmedAt, 'confirmedAt')
    };
    const existing = history.find(record => record.actionId === confirmationActionId);
    if (existing) {
        if (existing.eventType === RECONCILIATION_EVENT_TYPES.CASH_CONFIRMATION
            && sameConfirmationRecord(existing, auditRecord)) {
            return Object.freeze({
                status: 'duplicate',
                auditRecord: Object.freeze(existing),
                cashStatus: Object.freeze(status)
            });
        }
        fail(
            'RECONCILIATION_ACTION_CONFLICT',
            `actionId ${confirmationActionId} ist bereits mit einem abweichenden Payload belegt.`,
            { field: 'confirmationActionId' }
        );
    }
    if (status.isConfirmed || !status.canConfirm) {
        fail(
            'RECONCILIATION_CASH_ALREADY_CONFIRMED',
            `Verkauf ${targetActionId} besitzt bereits einen wirksamen Cashabschluss.`,
            { field: 'targetActionId' }
        );
    }
    return Object.freeze({
        status: 'ready',
        auditRecord: Object.freeze(auditRecord),
        cashStatus: Object.freeze(status)
    });
}

export function previewCashPostingCorrection(request) {
    const profileId = normalizeRequiredId(request?.profileId, 'profileId');
    const targetActionId = normalizeRequiredId(request?.targetActionId, 'targetActionId', {
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
        maxLength: SALE_ID_MAX_LENGTH
    });
    const registry = parseRegistry(request?.registry);
    const { history, sale, status } = requireTargetSale(registry, profileId, targetActionId);
    if (!status.isConfirmed || !status.canCorrect || !status.effectiveActionId) {
        fail(
            'RECONCILIATION_CORRECTION_WITHOUT_CONFIRMATION',
            `Verkauf ${targetActionId} besitzt keinen korrigierbaren Cashabschluss.`,
            { field: 'targetActionId' }
        );
    }

    const correctionRevision = request?.correctionRevision === undefined
        ? status.correctionRevision + 1
        : normalizeCorrectionRevision(request.correctionRevision);
    const canonicalActionId = deriveCashCorrectionActionId(targetActionId, correctionRevision);
    const correctionActionId = request?.correctionActionId === undefined
        ? canonicalActionId
        : normalizeRequiredId(request.correctionActionId, 'correctionActionId', {
            eventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
            maxLength: CORRECTION_ID_MAX_LENGTH
        });
    const actionId = request?.actionId === undefined
        ? correctionActionId
        : normalizeRequiredId(request.actionId, 'actionId', {
            eventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
            maxLength: CORRECTION_ID_MAX_LENGTH
        });
    const correctsActionId = request?.correctsActionId === undefined
        ? status.effectiveActionId
        : normalizeRequiredId(request.correctsActionId, 'correctsActionId', {
            eventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
            maxLength: CORRECTION_ID_MAX_LENGTH
        });
    if (actionId !== correctionActionId || actionId !== canonicalActionId) {
        fail(
            'RECONCILIATION_CORRECTION_ID_INVALID',
            `Cashkorrektur muss die kanonische ID ${canonicalActionId} verwenden.`,
            { field: 'correctionActionId' }
        );
    }

    const auditRecord = {
        schemaVersion: TRANCHE_RECONCILIATION_SCHEMA_VERSION,
        eventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
        actionId,
        correctionActionId,
        targetActionId,
        correctsActionId,
        correctionRevision,
        profileId,
        confirmedNetProceedsEur: sale.actual.netProceeds,
        cashBalanceAfterPostingEur: normalizeNumber(
            request?.cashBalanceAfterPostingEur,
            'cashBalanceAfterPostingEur'
        ),
        correctionReason: normalizeReason(request?.correctionReason),
        correctedAt: normalizeTimestamp(request?.correctedAt, 'correctedAt')
    };
    const existing = history.find(record => record.actionId === actionId);
    if (existing) {
        if (existing.eventType === RECONCILIATION_EVENT_TYPES.CASH_CORRECTION
            && sameCorrectionRecord(existing, auditRecord)) {
            return Object.freeze({
                status: 'duplicate',
                auditRecord: Object.freeze(existing),
                cashStatus: Object.freeze(status)
            });
        }
        fail(
            'RECONCILIATION_ACTION_CONFLICT',
            `actionId ${actionId} ist bereits mit einem abweichenden Payload belegt.`,
            { field: 'correctionActionId' }
        );
    }
    const expectedRevision = status.correctionRevision + 1;
    if (correctionRevision !== expectedRevision || correctsActionId !== status.effectiveActionId) {
        fail(
            'RECONCILIATION_CORRECTION_CHAIN_STALE',
            `Cashkorrektur muss Revision ${expectedRevision} und Vorgänger ${status.effectiveActionId} verwenden. Bitte aktuellen Stand neu laden.`,
            { field: 'correctsActionId' }
        );
    }
    return Object.freeze({
        status: 'ready',
        auditRecord: Object.freeze(auditRecord),
        cashStatus: Object.freeze(status)
    });
}
