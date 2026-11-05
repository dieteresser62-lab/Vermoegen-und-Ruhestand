// @ts-check
import { persistenceStorage, PersistenceFacade } from '../../shared/persistence-facade.js';
import { getCurrentProfileId, getActiveProfileId, saveCurrentProfileFromLocalStorage, PROFILE_LIVE_BASE_KEY } from '../../profile/profile-storage.js';
import { appNow } from '../../shared/app-clock.js';
import { normalizeRequiredId } from './validation.js';
import { fail, TrancheReconciliationError } from './schema.js';
import { assertProfileContext, requireReconciliationFlush, restoreReconciliationRecords } from './persistence.js';
import { PROFILE_TRANCHES_KEY, PROFILE_STORAGE_KEYS } from '../../profile/profile-state.js';
import { PROFILE_WEALTH_LOTS_KEY, captureSaleWealthLots } from '../../profile/profile-wealth-history.js';
import { parseRegistry, registryWithAuditRecord } from './history.js';
import { loadTranchesFromStorage, saveTranchesToStorage } from '../tranchen-manager-state.js';
import { previewTrancheReconciliation } from './sale-preview.js';

export async function commitTrancheReconciliation(request, options = {}) {
    const storage = options.storage || persistenceStorage;
    const dependencies = {
        getCurrentProfileId: options.getCurrentProfileId || getCurrentProfileId,
        getActiveProfileId: options.getActiveProfileId || getActiveProfileId,
        saveCurrentProfile: options.saveCurrentProfile || saveCurrentProfileFromLocalStorage,
        flush: options.flush || (() => PersistenceFacade.flush()),
        clock: options.clock || (() => appNow().toISOString())
    };
    const profileId = normalizeRequiredId(request?.profileId, 'profileId');
    if (request?.action?.source === 'spielwert' && PersistenceFacade.getPersistenceStatus().activeArea !== 'spiel') {
        fail('RECONCILIATION_PLAY_AREA_REQUIRED', 'Spielwerte dürfen nur im Spielbereich gespeichert werden.');
    }
    assertProfileContext(profileId, dependencies);

    const previousTranchesRaw = storage.getItem(PROFILE_TRANCHES_KEY);
    const previousLotsRaw = storage.getItem(PROFILE_WEALTH_LOTS_KEY);
    const previousRegistryRaw = storage.getItem(PROFILE_STORAGE_KEYS.registry);
    const previousLiveBase = storage.getItem(PROFILE_LIVE_BASE_KEY);
    if (request.expectedTranchesRaw !== undefined && request.expectedTranchesRaw !== previousTranchesRaw) {
        fail(
            'RECONCILIATION_PREVIEW_STALE',
            'Der Tranchenbestand hat sich seit der Vorschau geändert. Bitte Vorschau neu erstellen.',
            { retryable: false }
        );
    }
    const registry = parseRegistry(previousRegistryRaw);
    const profile = registry.profiles[profileId];
    if (!profile) {
        fail('RECONCILIATION_PROFILE_UNKNOWN', `Profil ${profileId} ist nicht vorhanden.`);
    }
    const profileTranchesRaw = profile.data?.[PROFILE_TRANCHES_KEY] ?? null;
    if ((profileTranchesRaw ?? null) !== (previousTranchesRaw ?? null)) {
        fail(
            'RECONCILIATION_PROFILE_STATE_STALE',
            'Live-Bestand und profilgebundener Bestand stimmen nicht überein. Profil bitte neu laden.',
            { retryable: false }
        );
    }

    const loaded = loadTranchesFromStorage(storage);
    if (loaded.status === 'corrupt' || loaded.status === 'unavailable') {
        fail(
            'RECONCILIATION_TRANCHE_STORAGE_INVALID',
            'Der Tranchenbestand ist beschädigt oder momentan nicht lesbar.',
            { retryable: loaded.status === 'unavailable' }
        );
    }
    const preview = previewTrancheReconciliation({
        profileId,
        tranches: loaded.tranches || [],
        action: request.action,
        registry
    });
    if (preview.status === 'duplicate') {
        return Object.freeze({ status: 'duplicate', preview, tranches: preview.nextTranches });
    }

    let writesStarted = false;
    try {
        assertProfileContext(profileId, dependencies);
        options.navigationOperation?.commit();
        writesStarted = true;
        const lots = captureSaleWealthLots(previousLotsRaw, loaded.tranches, preview.nextTranches, preview.action.trancheId, dependencies.clock().slice(0, 10));
        storage.setItem(PROFILE_WEALTH_LOTS_KEY, JSON.stringify(lots));
        const persistedTranches = saveTranchesToStorage(preview.nextTranches, storage);
        if (!dependencies.saveCurrentProfile()) {
            throw new Error('PROFILE_SAVE_FAILED');
        }
        assertProfileContext(profileId, dependencies);
        const registryAfterProfileSave = storage.getItem(PROFILE_STORAGE_KEYS.registry);
        const nextRegistry = registryWithAuditRecord(
            registryAfterProfileSave,
            { ...preview.auditRecord, reconciledAt: dependencies.clock() }
        );
        // Auch injizierte Profilwriter müssen die neue Kopie zum selben Registrycommit nehmen.
        nextRegistry.profiles[profileId].data[PROFILE_WEALTH_LOTS_KEY] = JSON.stringify(lots);
        storage.setItem(PROFILE_STORAGE_KEYS.registry, JSON.stringify(nextRegistry));
        await requireReconciliationFlush(dependencies.flush);
        return Object.freeze({
            status: 'applied',
            preview,
            tranches: Object.freeze(persistedTranches),
            registry: Object.freeze(nextRegistry)
        });
    } catch (cause) {
        const restored = !writesStarted || await restoreReconciliationRecords(storage, [
            [PROFILE_TRANCHES_KEY, previousTranchesRaw],
            [PROFILE_WEALTH_LOTS_KEY, previousLotsRaw],
            [PROFILE_STORAGE_KEYS.registry, previousRegistryRaw],
            [PROFILE_LIVE_BASE_KEY, previousLiveBase]
        ], dependencies.flush);
        if (!restored) throw new TrancheReconciliationError(
            'RECONCILIATION_PERSISTENCE_FAILED',
            'Speichern und dauerhaftes Rückschreiben konnten nicht bestätigt werden. Der sichtbare Bestand bleibt unverändert; Retry ist möglich.',
            { retryable: true, cause, details: { rollbackConfirmed: false } }
        );
        if (cause instanceof TrancheReconciliationError) throw cause;
        throw new TrancheReconciliationError(
            'RECONCILIATION_PERSISTENCE_FAILED',
            'Die tatsächliche Ausführung konnte nicht dauerhaft bestätigt werden. Der letzte bestätigte Stand wurde wiederhergestellt.',
            { retryable: true, cause }
        );
    }
}
