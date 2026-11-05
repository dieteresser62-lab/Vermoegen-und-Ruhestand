// @ts-check
import { fail, RECONCILIATION_CASH_STATUSES, RECONCILIATION_EVENT_TYPES, TRANCHE_RECONCILIATION_REGISTRY_FIELD, TRANCHE_RECONCILIATION_SCHEMA_VERSION } from './schema.js';
import { readEventType, normalizeSaleHistoryRecord, normalizeConfirmationHistoryRecord, normalizeCorrectionHistoryRecord } from './history-records.js';
import { sameEuroCent, normalizeRequiredId, cloneJson } from './validation.js';

export function parseRegistry(raw) {
    let registry = raw;
    if (typeof raw === 'string') {
        try {
            registry = JSON.parse(raw);
        } catch (cause) {
            fail('RECONCILIATION_REGISTRY_INVALID', 'Die Profilregistry ist syntaktisch beschädigt.', { cause });
        }
    }
    if (!registry || typeof registry !== 'object' || Array.isArray(registry)
        || !registry.profiles || typeof registry.profiles !== 'object' || Array.isArray(registry.profiles)) {
        fail('RECONCILIATION_REGISTRY_INVALID', 'Die Profilregistry besitzt keinen gültigen Profilbestand.');
    }
    return registry;
}

function createSaleCashProjection(sale) {
    const base = {
        targetActionId: sale.actionId,
        profileId: sale.profileId,
        trancheId: sale.trancheId,
        executedAt: sale.executedAt,
        saleRecord: sale,
        confirmedNetProceedsEur: sale.actual.netProceeds,
        cashBalanceAfterPostingEur: null,
        confirmedAt: null,
        correctionReason: null,
        correctionRevision: 0,
        effectiveActionId: null,
        evidenceEventType: null,
        isPending: false,
        isConfirmed: false,
        isLegacy: false,
        canConfirm: false,
        canCorrect: false,
        operationallyComplete: false,
        statusLabel: ''
    };
    if (sale.cashStatus === RECONCILIATION_CASH_STATUSES.PENDING) {
        return {
            ...base,
            cashStatus: RECONCILIATION_CASH_STATUSES.PENDING,
            isPending: true,
            canConfirm: true,
            statusLabel: 'Offen – Nettoerlös noch manuell in der freien Liquidität nachführen'
        };
    }
    if (sale.cashStatus === RECONCILIATION_CASH_STATUSES.LEGACY_UNKNOWN) {
        return {
            ...base,
            cashStatus: RECONCILIATION_CASH_STATUSES.LEGACY_UNKNOWN,
            isLegacy: true,
            canConfirm: true,
            operationallyComplete: true,
            statusLabel: 'Abgeschlossen (Altfall – Cashstatus nicht dokumentiert)'
        };
    }
    return {
        ...base,
        cashStatus: RECONCILIATION_CASH_STATUSES.ALREADY_REFLECTED,
        cashBalanceAfterPostingEur: sale.cashBalanceAfterPostingEur,
        confirmedAt: sale.cashConfirmedAt,
        effectiveActionId: sale.actionId,
        evidenceEventType: RECONCILIATION_EVENT_TYPES.SALE,
        isConfirmed: true,
        canCorrect: true,
        operationallyComplete: true,
        statusLabel: 'Cash bestätigt – bereits in der freien Liquidität berücksichtigt'
    };
}

function validateAndProjectHistory(registryOrRaw) {
    const registry = parseRegistry(registryOrRaw);
    const history = registry[TRANCHE_RECONCILIATION_REGISTRY_FIELD];
    if (history === undefined) return { actions: [], cashStates: new Map() };
    if (!history || typeof history !== 'object' || Array.isArray(history)
        || history.schemaVersion !== TRANCHE_RECONCILIATION_SCHEMA_VERSION
        || !Array.isArray(history.actions)) {
        fail('RECONCILIATION_HISTORY_INVALID', 'Der Reconcile-Verlauf ist beschädigt oder nicht unterstützt.');
    }
    const seen = new Set();
    const cashStates = new Map();
    const actions = history.actions.map((record, index) => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            fail('RECONCILIATION_HISTORY_INVALID', `Reconcile-Eintrag ${index + 1} ist ungültig.`);
        }
        const type = readEventType(record, index);
        const projected = type.eventType === RECONCILIATION_EVENT_TYPES.SALE
            ? normalizeSaleHistoryRecord(record, type)
            : type.eventType === RECONCILIATION_EVENT_TYPES.CASH_CONFIRMATION
                ? normalizeConfirmationHistoryRecord(record)
                : normalizeCorrectionHistoryRecord(record);
        const actionId = projected.actionId;
        if (seen.has(actionId)) {
            fail('RECONCILIATION_HISTORY_INVALID', `actionId ${actionId} ist im Reconcile-Verlauf doppelt vorhanden.`);
        }
        seen.add(actionId);

        if (projected.eventType === RECONCILIATION_EVENT_TYPES.SALE) {
            cashStates.set(actionId, createSaleCashProjection(projected));
            return projected;
        }

        const sale = cashStates.get(projected.targetActionId);
        if (!sale) {
            fail(
                'RECONCILIATION_CASH_TARGET_INVALID',
                `${projected.eventType} verweist nicht auf einen vorherigen Verkauf ${projected.targetActionId}.`,
                { field: 'targetActionId' }
            );
        }
        if (projected.profileId !== sale.profileId) {
            fail(
                'RECONCILIATION_PROFILE_MISMATCH',
                `${projected.eventType} und Zielverkauf gehören zu unterschiedlichen Profilen.`,
                { field: 'profileId' }
            );
        }
        if (!sameEuroCent(projected.confirmedNetProceedsEur, sale.confirmedNetProceedsEur)) {
            fail(
                'RECONCILIATION_NET_PROCEEDS_MISMATCH',
                `${projected.eventType} verändert den Nettoerlös des Zielverkaufs.`,
                { field: 'confirmedNetProceedsEur' }
            );
        }

        if (projected.eventType === RECONCILIATION_EVENT_TYPES.CASH_CONFIRMATION) {
            if (sale.isConfirmed) {
                fail(
                    'RECONCILIATION_CASH_ALREADY_CONFIRMED',
                    `Für Verkauf ${projected.targetActionId} existiert bereits ein wirksamer Cashabschluss.`,
                    { field: 'targetActionId' }
                );
            }
            cashStates.set(projected.targetActionId, {
                ...sale,
                cashStatus: RECONCILIATION_CASH_STATUSES.MANUALLY_CONFIRMED,
                cashBalanceAfterPostingEur: projected.cashBalanceAfterPostingEur,
                confirmedAt: projected.confirmedAt,
                effectiveActionId: projected.actionId,
                evidenceEventType: RECONCILIATION_EVENT_TYPES.CASH_CONFIRMATION,
                isPending: false,
                isConfirmed: true,
                canConfirm: false,
                canCorrect: true,
                operationallyComplete: true,
                statusLabel: 'Cash bestätigt – manuell in der freien Liquidität nachgeführt'
            });
            return projected;
        }

        if (!sale.isConfirmed || !sale.effectiveActionId) {
            fail(
                'RECONCILIATION_CORRECTION_WITHOUT_CONFIRMATION',
                `Cashkorrektur ${projected.actionId} besitzt keinen wirksamen Vorgänger.`,
                { field: 'targetActionId' }
            );
        }
        const expectedRevision = sale.correctionRevision + 1;
        if (projected.correctionRevision !== expectedRevision
            || projected.correctsActionId !== sale.effectiveActionId) {
            fail(
                'RECONCILIATION_CORRECTION_CHAIN_INVALID',
                `Cashkorrektur ${projected.actionId} muss Revision ${expectedRevision} und Vorgänger ${sale.effectiveActionId} verwenden.`,
                { field: 'correctsActionId' }
            );
        }
        cashStates.set(projected.targetActionId, {
            ...sale,
            cashStatus: RECONCILIATION_CASH_STATUSES.CORRECTED,
            cashBalanceAfterPostingEur: projected.cashBalanceAfterPostingEur,
            confirmedAt: projected.correctedAt,
            correctionReason: projected.correctionReason,
            correctionRevision: projected.correctionRevision,
            effectiveActionId: projected.actionId,
            evidenceEventType: RECONCILIATION_EVENT_TYPES.CASH_CORRECTION,
            statusLabel: `Cash bestätigt – Cashstand mit Revision ${projected.correctionRevision} korrigiert`
        });
        return projected;
    });
    return { actions, cashStates };
}

export function readReconciliationHistory(registryOrRaw) {
    const { actions } = validateAndProjectHistory(registryOrRaw);
    return Object.freeze(actions);
}

export function projectReconciliationCashStatuses(registryOrRaw, profileId = null) {
    const normalizedProfileId = profileId === null
        ? null
        : normalizeRequiredId(profileId, 'profileId');
    const { cashStates } = validateAndProjectHistory(registryOrRaw);
    return Object.freeze([...cashStates.values()]
        .filter(status => normalizedProfileId === null || status.profileId === normalizedProfileId)
        .map(status => Object.freeze({ ...status, saleRecord: Object.freeze(cloneJson(status.saleRecord)) })));
}

export function registryWithAuditRecord(registryOrRaw, auditRecord) {
    const registry = cloneJson(parseRegistry(registryOrRaw));
    const projectedActions = [...readReconciliationHistory(registry)];
    if (projectedActions.some(record => record.actionId === auditRecord.actionId)) {
        fail('RECONCILIATION_ACTION_CONFLICT', `actionId ${auditRecord.actionId} ist bereits gespeichert.`);
    }
    const persistedActions = registry[TRANCHE_RECONCILIATION_REGISTRY_FIELD]?.actions || [];
    registry[TRANCHE_RECONCILIATION_REGISTRY_FIELD] = {
        schemaVersion: TRANCHE_RECONCILIATION_SCHEMA_VERSION,
        actions: [
            ...cloneJson(persistedActions),
            cloneJson(auditRecord)
        ]
    };
    return registry;
}
