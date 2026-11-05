// @ts-check
import { persistenceStorage, PersistenceFacade } from '../../shared/persistence-facade.js';
import { getCurrentProfileId, getActiveProfileId } from '../../profile/profile-storage.js';
import { normalizeRequiredId, hasOwn } from './validation.js';
import { assertProfileContext, requireReconciliationFlush } from './persistence.js';
import { PROFILE_STORAGE_KEYS } from '../../profile/profile-state.js';
import { parseRegistry, registryWithAuditRecord, projectReconciliationCashStatuses } from './history.js';
import { fail, TrancheReconciliationError } from './schema.js';
import { CASH_KEYS, captureCashPeople, prepareHouseholdCash } from '../../profile/profile-cash-update.js';
import { localHistoryDate } from '../tranchen-history-store.js';
import { previewCashPostingConfirmation, previewCashPostingCorrection } from './cash-preview.js';

async function commitCashPostingEvent(request, options, previewer) {
    const storage = options.storage || persistenceStorage;
    const dependencies = {
        getCurrentProfileId: options.getCurrentProfileId || getCurrentProfileId,
        getActiveProfileId: options.getActiveProfileId || getActiveProfileId,
        flush: options.flush || (() => PersistenceFacade.flush())
    };
    const profileId = normalizeRequiredId(request?.profileId, 'profileId');
    assertProfileContext(profileId, dependencies);
    const previousRegistryRaw = storage.getItem(PROFILE_STORAGE_KEYS.registry);
    const preview = previewer({ ...request, profileId, registry: previousRegistryRaw });
    if (preview.status === 'duplicate') {
        return Object.freeze({
            status: 'duplicate',
            cashRecordsChanged: false,
            preview,
            registry: Object.freeze(parseRegistry(previousRegistryRaw))
        });
    }
    if (request.expectedRegistryRaw !== undefined && request.expectedRegistryRaw !== previousRegistryRaw) {
        fail(
            'RECONCILIATION_PREVIEW_STALE',
            'Der Reconcile-Verlauf hat sich seit dem Dialog geändert. Bitte aktuellen Stand neu laden.',
            { retryable: false }
        );
    }
    // Auch unveränderte Beträge binden beide Quellen; ein Auditbetrag ist keine Livebasis.
    const cashSource = request.expectedCashRecords
        || Object.fromEntries(CASH_KEYS.map(key => [key, storage.getItem(key)]));
    const assertCashSource = () => {
        if (CASH_KEYS.some(key => !hasOwn(cashSource, key) || storage.getItem(key) !== cashSource[key])) {
            fail('RECONCILIATION_PREVIEW_STALE',
                'Der Tagesgeld-Stand oder seine Historie hat sich seit dem Dialog geändert. Bitte den Dialog mit dem aktuellen Stand neu öffnen.',
                { retryable: false });
        }
    };
    assertCashSource();
    const requireCashPeople = () => {
        const people = captureCashPeople({ storage, ids: [profileId], activeId: profileId });
        const invalid = people.find(person => person.error);
        if (invalid) fail('RECONCILIATION_CASH_SOURCE_INVALID',
            `Die Tagesgeldquelle ist beschädigt oder widersprüchlich: ${invalid.error} Keine Bestätigung möglich. Bitte die Quelle prüfen und den Dialog danach neu öffnen.`,
            { retryable: false });
        return people;
    };
    requireCashPeople();

    try {
        await requireReconciliationFlush(dependencies.flush);
        assertProfileContext(profileId, dependencies);
        assertCashSource();
        if (storage.getItem(PROFILE_STORAGE_KEYS.registry) !== previousRegistryRaw) fail('RECONCILIATION_PREVIEW_STALE',
            'Der Reconcile-Verlauf hat sich geändert. Bitte den aktuellen Stand neu laden.');
        const people = requireCashPeople();
        const nextRegistry = registryWithAuditRecord(previousRegistryRaw, preview.auditRecord);
        const cash = { people,
            values: { [profileId]: preview.auditRecord.cashBalanceAfterPostingEur } };
        const prepared = prepareHouseholdCash({ storage, registry: nextRegistry, activeId: profileId, ids: [profileId], cash,
            checkMembership: false, date: localHistoryDate() });
        const cashRecordsChanged = CASH_KEYS.some(key => hasOwn(prepared.records, key)
            && prepared.records[key] !== cashSource[key]);
        const records = {
            ...Object.fromEntries(CASH_KEYS.filter(key => cashSource[key] !== null).map(key => [key, cashSource[key]])),
            ...prepared.records, [PROFILE_STORAGE_KEYS.registry]: JSON.stringify(prepared.registry)
        };
        const keys = new Set([...CASH_KEYS, PROFILE_STORAGE_KEYS.registry]);
        const previous = Object.fromEntries([...keys].map(key => [key, storage.getItem(key)]));
        await (options.persistence || PersistenceFacade).replaceRecordsTransactional(records, {
            probelaufDomainWrite: true, navigationOperation: options.navigationOperation,
            expectedRecords: Object.fromEntries(Object.entries(previous).filter(([, raw]) => raw !== null)),
            allowKey: key => {
                if (!keys.has(key)) return false;
                const raw = storage.getItem(key);
                if (raw !== previous[key] && raw !== (records[key] ?? null)) fail('RECONCILIATION_PREVIEW_STALE',
                    'Die Cashquelle hat sich geändert. Bitte den Dialog mit dem aktuellen Stand neu öffnen.');
                return true;
            },
            postValidate: () => { assertProfileContext(profileId, dependencies); return true; }
        });
        return Object.freeze({
            status: 'applied',
            cashRecordsChanged,
            preview,
            registry: Object.freeze(prepared.registry),
            cashStatuses: projectReconciliationCashStatuses(prepared.registry, profileId)
        });
    } catch (cause) {
        if (cause?.code === 'persistence_precondition_mismatch') fail('RECONCILIATION_PREVIEW_STALE',
            'Die Cashquelle hat sich geändert. Bitte den Dialog mit dem aktuellen Stand neu öffnen.', { cause });
        if (cause?.code === 'rollback_failed') throw new TrancheReconciliationError(
            'RECONCILIATION_PERSISTENCE_FAILED',
            'Wiederherstellung erforderlich: Tagesgeld und Audit konnten nicht dauerhaft zurückgeschrieben werden.',
            { retryable: true, cause, details: { rollbackConfirmed: false } }
        );
        if (cause instanceof TrancheReconciliationError) throw cause;
        throw new TrancheReconciliationError(
            'RECONCILIATION_PERSISTENCE_FAILED',
            'Der Cashstatus konnte nicht dauerhaft gespeichert werden. Der letzte bestätigte Auditstand wurde wiederhergestellt.',
            { retryable: true, cause }
        );
    }
}

export function commitCashPostingConfirmation(request, options = {}) {
    return commitCashPostingEvent(request, options, previewCashPostingConfirmation);
}

export function commitCashPostingCorrection(request, options = {}) {
    return commitCashPostingEvent(request, options, previewCashPostingCorrection);
}
