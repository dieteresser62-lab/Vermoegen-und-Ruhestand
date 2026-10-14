import { SnapshotArchive, SNAPSHOT_KINDS, validateSnapshot } from './snapshot-archive.js';
import { PersistenceFacade, persistenceStorage } from './persistence-facade.js';
import { isAllowedPersistenceImportKey, isAllowedSnapshotRestoreLiveKey, isNewBeginningRecordKey, PROBELAUF_STATE_KEY } from './persistence-key-policy.js';
import { PROFILE_STORAGE_KEYS as P } from '../profile/profile-state.js';
import { isProfileScopedKey } from '../profile/profile-key-policy.js';
import { CONFIG, StorageError } from '../balance/balance-config.js';
import { assertBalanceWealthHistory } from '../../types/wealth-history-contract.js';
import { createNavigationGuard, createNavigationOperationLifecycle } from './navigation-guard.js';

export const recordIdentity = value => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
const select = (records, allowKey) => Object.fromEntries(Object.entries(records).filter(([key]) => allowKey(key)));
const parse = raw => raw ? JSON.parse(raw) : null;
export function isFullImportRecoverySnapshot(snapshot) {
    return snapshot?.kind === SNAPSHOT_KINDS.newBeginningBefore || snapshot?.kind === SNAPSHOT_KINDS.fullBackupImportRecovery
        || (snapshot?.restoreScope?.profileRegistryMode === 'replace-all-rollback'
            && snapshot?.restoreScope?.profileLiveDataMode === 'replace-all-rollback');
}
export function validateSnapshotWealthHistory(snapshot) {
    assertBalanceWealthHistory(parse(snapshot.records[CONFIG.STORAGE.LS_KEY]));
    Object.values(parse(snapshot.records[P.registry])?.profiles || {}).forEach(profile => {
        assertBalanceWealthHistory(parse(profile.data?.[CONFIG.STORAGE.LS_KEY]));
    });
}

/** Reiner Plan: dieselbe Recordmenge dient Vorschau, Recovery und Zielwrite. */
export function buildSnapshotRestorePlan(input, currentRecords, { importRollback = false } = {}) {
    const snapshot = validateSnapshot(input);
    if (snapshot.kind === SNAPSHOT_KINDS.probelaufBefore) throw new Error('Diesen Rückkehrpunkt ausschließlich über Probelauf beenden zurückholen.');
    validateSnapshotWealthHistory(snapshot);
    const scope = snapshot.restoreScope;
    const registry = parse(currentRecords[P.registry]);
    const full = isFullImportRecoverySnapshot(snapshot);
    const mode = full ? (scope.liveKeyMode || (snapshot.kind === SNAPSHOT_KINDS.newBeginningBefore ? 'new-beginning' : snapshot.kind === SNAPSHOT_KINDS.fullBackupImportRecovery ? 'full-import' : 'snapshot-full')) : 'standard';
    if (!['standard', 'full-import', 'snapshot-full', 'new-beginning'].includes(mode)
        || (!full && !['preserve-by-default', 'restore-target-profile'].includes(scope.profileRegistryMode))) {
        throw new Error('Unbekannter Wiederherstellungsumfang. Dieser Punkt bleibt erhalten.');
    }
    const targetProfileId = scope.targetProfileId || snapshot.activeProfileId;
    const allowKey = mode === 'new-beginning' ? isNewBeginningRecordKey : mode === 'full-import' ? isAllowedPersistenceImportKey
        : mode === 'snapshot-full' ? key => isAllowedSnapshotRestoreLiveKey(key, { mode: 'full' })
            : key => key === P.registry || isAllowedSnapshotRestoreLiveKey(key, { mode: 'standard', snapshotActiveProfileId: targetProfileId, currentRegistry: registry });
    // Der interne Importrollback behält seinen historischen profilfreien Vollfallback.
    if (!full && !registry?.profiles?.[targetProfileId]) {
        if (importRollback) return buildSnapshotRestorePlan({ ...snapshot, restoreScope: { ...scope,
            profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback', liveKeyMode: 'snapshot-full' } }, currentRecords);
        throw new StorageError(`Das Snapshot-Profil "${targetProfileId || 'unbekannt'}" existiert in der aktuellen Profil-Registry nicht mehr.`);
    }
    const before = select(currentRecords, allowKey);
    const records = select(snapshot.records, allowKey);
    if (!full) {
        const nextRegistry = structuredClone(registry);
        if (scope.profileRegistryMode === 'restore-target-profile') {
            const oldProfile = parse(snapshot.records[P.registry])?.profiles?.[targetProfileId];
            if (!oldProfile) throw new Error('Profilzuordnung des Rückkehrpunkts fehlt.');
            nextRegistry.profiles[targetProfileId] = oldProfile;
        } else {
            nextRegistry.profiles[targetProfileId] = { ...nextRegistry.profiles[targetProfileId],
                data: Object.fromEntries(Object.entries(snapshot.records).filter(([key]) => isProfileScopedKey(key) && allowKey(key))) };
            records[P.current] = targetProfileId;
            records[P.active] = targetProfileId;
        }
        records[P.registry] = scope.profileRegistryMode === 'restore-target-profile'
            && JSON.stringify(nextRegistry) === JSON.stringify(parse(snapshot.records[P.registry]))
            ? snapshot.records[P.registry] : JSON.stringify(nextRegistry);
    }
    const keys = [...new Set([...Object.keys(before), ...Object.keys(records)])].sort();
    const changes = keys.filter(key => before[key] !== records[key]).map(key => ({ key, before: before[key] ?? null,
        after: records[key] ?? null, action: !(key in records) ? 'removed' : !(key in before) ? 'added' : 'changed' }));
    return { snapshot, mode, targetProfileId, allowKey, before, records, changes,
        identity: recordIdentity({ snapshot: JSON.stringify(snapshot), current: recordIdentity(select(currentRecords, key => key !== 'rs_snapshot_archive_v1')) }) };
}

export async function previewSnapshotRestore(id, { persistence = PersistenceFacade, archive = SnapshotArchive, navigationOperation } = {}) {
    if (await persistence.flush({ navigationOperation }) === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    const snapshot = await archive.readSnapshot(id, { storage: persistence });
    const records = await persistence.readPersistedRecords();
    if (records[PROBELAUF_STATE_KEY]) throw new Error('Zurückholen während des Probelaufs gesperrt. Beende ihn zuerst über das Probelaufband.');
    return buildSnapshotRestorePlan(snapshot, records);
}

const activeRestores = new WeakSet();
/** Recovery zuerst dauerhaft zurücklesen; anschließend optimistischer, transaktionaler Replace. */
export async function executeSnapshotRestore(preview, options = {}) {
    const persistence = options.persistence || PersistenceFacade, archive = options.archive || SnapshotArchive;
    if (activeRestores.has(persistence)) return { status: 'in_flight' };
    activeRestores.add(persistence);
    const guard = options.guard || createNavigationGuard();
    let written = false, release, recoverySnapshotId, reloadResult;
    const message = 'Snapshot gespeichert; die Seite wurde nicht neu geladen. Bitte die Seite jetzt neu laden. Eingaben werden bis dahin nicht gespeichert.';
    try {
        const navigated = await guard.reload({ opener: options.opener,
            subscribeChanges: notify => persistence.observeInputChanges?.(notify, options.document || globalThis.document),
            mutate: async operation => {
                if (await persistence.flush({ navigationOperation: operation }) === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
                operation.check();
                const fresh = await previewSnapshotRestore(preview.snapshot.id, { persistence, archive, navigationOperation: operation });
                operation.check();
                if (fresh.identity !== preview.identity) throw new Error('Der Bestand oder Punkt hat sich seit der Vorschau geändert. Bitte die Vorschau erneut öffnen.');
                release = persistence.blockSyncWrites([], message, { predicate: fresh.mode === 'new-beginning' ? fresh.allowKey : isAllowedPersistenceImportKey });
                const full = fresh.mode !== 'standard';
                const recovery = await archive.createSnapshot({ id: `before_restore_${globalThis.crypto.randomUUID()}`,
                    label: 'vor Zurückholen', kind: SNAPSHOT_KINDS.beforeRestoreRecovery, records: fresh.before,
                    activeProfileId: fresh.before[P.current] || fresh.before[P.active] || '',
                    activeProfileName: parse(fresh.before[P.registry])?.profiles?.[fresh.before[P.current] || fresh.before[P.active]]?.meta?.name || '',
                    restoreScope: full ? { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback', liveKeyMode: fresh.mode }
                        : { profileRegistryMode: 'restore-target-profile', profileLiveDataMode: 'restore-previous-live', targetProfileId: fresh.targetProfileId }
                }, { storage: persistence, navigationOperation: operation });
                const verified = await archive.readSnapshot(recovery.id, { storage: persistence });
                operation.check();
                if (JSON.stringify(verified) !== JSON.stringify(recovery)) throw new Error('Der Punkt vor Zurückholen konnte nicht bytegleich bestätigt werden.');
                const rechecked = await previewSnapshotRestore(preview.snapshot.id, { persistence, archive, navigationOperation: operation });
                operation.check();
                if (rechecked.identity !== preview.identity) throw new Error('Der Bestand oder Punkt hat sich während der Sicherung geändert. Bitte erneut prüfen.');
                recoverySnapshotId = recovery.id;
                await persistence.replaceRecordsTransactional(fresh.records, { allowKey: fresh.allowKey,
                    expectedRecords: fresh.before, navigationOperation: operation });
                written = true;
                if (fresh.mode === 'new-beginning') await persistence.resetNewBeginningBrowserStorage?.({
                    window: options.window, records: fresh.records, navigationOperation: operation });
            }, flush: () => persistence.flush(),
            reload: () => {
                const reload = options.reload || (() => globalThis.location?.reload?.());
                reloadResult = reload();
                if (reloadResult === false) throw new Error('RELOAD_REFUSED');
            } });
        if (reloadResult && typeof reloadResult.then === 'function' && await reloadResult === false) throw new Error('RELOAD_REFUSED');
        if (written && !navigated) return { status: 'reload_required', message, recoverySnapshotId };
        // Auch beim Reload-Doppel darf diese Dokumentgeneration nicht mehr schreiben.
        return { status: navigated ? 'restored' : 'cancelled', recoverySnapshotId };
    } catch (error) {
        if (written) return { status: 'reload_required', message, error, recoverySnapshotId };
        if (error.code !== 'rollback_failed') release?.();
        if (recoverySnapshotId) error.recoverySnapshotId = recoverySnapshotId;
        throw error;
    } finally { activeRestores.delete(persistence); }
}

/** Interner Importrollback, ohne zusätzlichen Benutzer-Rückkehrpunkt. */
export async function restoreImportRecoverySnapshot(snapshot, navigationOperation) {
    const records = Object.fromEntries(Array.from({ length: persistenceStorage.length }, (_, i) => persistenceStorage.key(i))
        .filter(Boolean).map(key => [key, persistenceStorage.getItem(key)]));
    const plan = buildSnapshotRestorePlan(snapshot, records, { importRollback: true });
    return PersistenceFacade.replaceRecordsTransactional(plan.records, { allowKey: plan.allowKey, navigationOperation });
}

export async function restoreSnapshotById(id, options = {}) {
    const lifecycle = createNavigationOperationLifecycle({ guard: options.guard });
    const preview = options.preview || await lifecycle.run({}, async operation => {
        const plan = await previewSnapshotRestore(id, options); operation.check(); return plan;
    });
    return executeSnapshotRestore(preview, options);
}
