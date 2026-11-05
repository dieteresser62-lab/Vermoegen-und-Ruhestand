// @ts-check
import { hasOwn, cloneJson, normalizeRequiredId, normalizeReconciliationAction } from './validation.js';
import { TRANCHE_RECONCILIATION_SCHEMA_VERSION, RECONCILIATION_EVENT_TYPES, RECONCILIATION_CASH_STATUSES, fail, SHARE_EPSILON } from './schema.js';
import { parseRegistry, readReconciliationHistory } from './history.js';
import { normalizeTrancheCollection } from '../../../types/tranche-contract.js';

function comparableAction(action) {
    return {
        actionId: action.actionId,
        profileId: action.profileId,
        trancheId: action.trancheId,
        executedAt: action.executedAt,
        actual: {
            sharesSold: action.sharesSold ?? action.actual?.sharesSold,
            grossProceeds: action.grossProceeds ?? action.actual?.grossProceeds,
            fees: action.fees ?? action.actual?.fees
        },
        ...(hasOwn(action, 'taxes') || hasOwn(action.actual, 'taxes')
            ? { taxes: action.taxes ?? action.actual?.taxes } : {}),
        ...(action.source === 'spielwert' ? { source: 'spielwert' } : {}),
        recommendation: action.recommendation || null
    };
}

function sameExecution(record, action) {
    return JSON.stringify(comparableAction(record)) === JSON.stringify(comparableAction(action));
}

function summarizeLot(lot) {
    if (!lot) return null;
    return {
        shares: lot.shares,
        marketValue: lot.marketValue,
        costBasis: lot.costBasis
    };
}

function createAuditRecord(action, before, after) {
    return {
        schemaVersion: TRANCHE_RECONCILIATION_SCHEMA_VERSION,
        eventType: RECONCILIATION_EVENT_TYPES.SALE,
        actionId: action.actionId,
        profileId: action.profileId,
        trancheId: action.trancheId,
        executedAt: action.executedAt,
        ...(action.source === 'spielwert' ? { source: 'spielwert' } : {}),
        actual: {
            sharesSold: action.sharesSold,
            grossProceeds: action.grossProceeds,
            fees: action.fees,
            ...(hasOwn(action, 'taxes') ? { taxes: action.taxes } : {}),
            netProceeds: action.netProceeds
        },
        cashStatus: action.cashStatus,
        ...(action.cashStatus === RECONCILIATION_CASH_STATUSES.ALREADY_REFLECTED
            ? {
                cashBalanceAfterPostingEur: action.cashBalanceAfterPostingEur,
                cashConfirmedAt: action.cashConfirmedAt
            }
            : {}),
        ...(action.recommendation ? { recommendation: cloneJson(action.recommendation) } : {}),
        result: {
            beforeShares: before.shares,
            remainingShares: after?.shares ?? 0,
            trancheRemoved: !after
        }
    };
}

function createDeviation(action) {
    if (!action.recommendation) return null;
    return {
        ...(hasOwn(action.recommendation, 'sharesSold')
            ? { sharesSold: action.sharesSold - action.recommendation.sharesSold }
            : {}),
        ...(hasOwn(action.recommendation, 'grossProceeds')
            ? { grossProceeds: action.grossProceeds - action.recommendation.grossProceeds }
            : {})
    };
}

export function previewTrancheReconciliation({ profileId, tranches, action, registry }) {
    const expectedProfileId = normalizeRequiredId(profileId, 'profileId');
    const normalizedAction = normalizeReconciliationAction(action, expectedProfileId);
    const parsedRegistry = parseRegistry(registry);
    if (!hasOwn(parsedRegistry.profiles, expectedProfileId)) {
        fail(
            'RECONCILIATION_PROFILE_UNKNOWN',
            `Profil ${expectedProfileId} ist in der Profilregistry nicht vorhanden.`,
            { field: 'profileId' }
        );
    }
    const normalizedTranches = normalizeTrancheCollection(tranches, { mode: 'persisted' });
    const history = readReconciliationHistory(parsedRegistry);
    const existing = history.find(record => (
        record.eventType === RECONCILIATION_EVENT_TYPES.SALE
        && record.actionId === normalizedAction.actionId
    ));
    if (existing) {
        if (!sameExecution(existing, normalizedAction)) {
            fail(
                'RECONCILIATION_ACTION_CONFLICT',
                `actionId ${normalizedAction.actionId} wurde bereits für eine andere Ausführung verwendet.`,
                { field: 'actionId' }
            );
        }
        return Object.freeze({
            status: 'duplicate',
            action: Object.freeze(normalizedAction),
            execution: Object.freeze({ ...existing.actual }),
            before: null,
            after: Object.freeze({
                shares: existing.result?.remainingShares ?? 0,
                marketValue: null,
                costBasis: null
            }),
            deviation: createDeviation(normalizedAction),
            nextTranches: Object.freeze(normalizedTranches),
            auditRecord: Object.freeze(existing)
        });
    }

    const trancheIndex = normalizedTranches.findIndex(item => item.trancheId === normalizedAction.trancheId);
    if (trancheIndex < 0) {
        fail(
            'RECONCILIATION_TRANCHE_UNKNOWN',
            `Tranche ${normalizedAction.trancheId} ist in Profil ${expectedProfileId} nicht vorhanden.`,
            { field: 'trancheId' }
        );
    }
    const beforeLot = normalizedTranches[trancheIndex];
    if (normalizedAction.sharesSold - beforeLot.shares > SHARE_EPSILON) {
        fail(
            'RECONCILIATION_SHARES_EXCEED_HOLDING',
            `Die tatsächliche Verkaufsmenge ${normalizedAction.sharesSold} übersteigt den Bestand ${beforeLot.shares}.`,
            { field: 'sharesSold' }
        );
    }

    const remainingShares = beforeLot.shares - normalizedAction.sharesSold;
    let afterLot = null;
    let nextTranches;
    if (remainingShares <= SHARE_EPSILON) {
        nextTranches = normalizedTranches.filter((_, index) => index !== trancheIndex);
    } else {
        afterLot = normalizeTrancheCollection([{
            ...beforeLot,
            shares: remainingShares
        }], { mode: 'persisted' })[0];
        nextTranches = normalizedTranches.map((item, index) => index === trancheIndex ? afterLot : item);
    }
    nextTranches = normalizeTrancheCollection(nextTranches, { mode: 'persisted' });
    const before = summarizeLot(beforeLot);
    const after = summarizeLot(afterLot);
    const auditRecord = createAuditRecord(normalizedAction, before, after);

    return Object.freeze({
        status: 'ready',
        action: Object.freeze(normalizedAction),
        execution: Object.freeze({
            sharesSold: normalizedAction.sharesSold,
            grossProceeds: normalizedAction.grossProceeds,
            fees: normalizedAction.fees,
            netProceeds: normalizedAction.netProceeds
        }),
        before: Object.freeze(before),
        after: after ? Object.freeze(after) : null,
        deviation: createDeviation(normalizedAction),
        nextTranches: Object.freeze(nextTranches),
        auditRecord: Object.freeze(auditRecord)
    });
}
