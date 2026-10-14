import { PersistenceFacade } from '../shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from '../shared/snapshot-archive.js';
import { assertFullBackupAllowed, validatePersistenceDomainRecords } from '../shared/persistence-backup.js';
import { isAllowedPersistenceImportKey, isNewBeginningRecordKey } from '../shared/persistence-key-policy.js';
import { recordIdentity } from '../shared/snapshot-restore.js';
import { withAnnualWriteAccess } from '../shared/annual-operation-lock.js';
import { CONFIG } from '../balance/balance-config.js';

export function canConfirmNewBeginning({ backupSaved = false, withoutBackup = false, confirmed = false, busy = false } = {}) {
    return !busy && confirmed && (backupSaved || withoutBackup);
}

export async function assertNewBeginningAllowed({ persistence = PersistenceFacade, archive = SnapshotArchive,
    probelaufController, recovery = false, window: win = globalThis.window } = {}) {
    await assertFullBackupAllowed({ persistence, probelaufController });
    const status = persistence.getPersistenceStatus();
    if (!status.initialized || status.lastFlushError) throw new Error('Der Speicher ist nicht sicher lesbar. Bitte zuerst den Speicherfehler klären.');
    if (recovery || status.migrationWarning || persistence.hasSyncWriteBlocks() || win?.__profileRecoveryBlocker || win?.__personMigrationDeferred) {
        throw new Error('Eine Wiederherstellung oder Recovery ist offen. Bitte zuerst abschließen.');
    }
    const records = await persistence.readPersistedRecords(isNewBeginningRecordKey);
    const validation = validatePersistenceDomainRecords(Object.fromEntries(Object.entries(records).filter(([key]) => isAllowedPersistenceImportKey(key))));
    if (!validation.ok) throw new Error('Der Speicher ist beschädigt oder nicht lesbar. ' + validation.message);
    const registry = JSON.parse(records.rs_profiles_v1 || '{"profiles":{}}');
    const states = [records[CONFIG.STORAGE.LS_KEY], ...Object.values(registry.profiles).map(profile => profile.data?.[CONFIG.STORAGE.LS_KEY])];
    if (states.some(raw => raw && JSON.parse(raw)?.annualPeriodMetadata?.pendingCommit)) throw new Error('Eine Jahresabschluss-Recovery ist offen. Bitte zuerst abschließen.');
    const points = await archive.listSnapshots({ storage: persistence });
    for (const point of points) await archive.readSnapshot(point.id, { storage: persistence });
    return { records, points, names: Object.values(registry.profiles).map(profile => profile.meta?.name?.trim() || 'Name unbekannt') };
}

/** Eine Löschbestätigung umfasst Punkt, Readback, transaktionalen Leerbestand und Navigation. */
export function createNewBeginningController({ persistence = PersistenceFacade, archive = SnapshotArchive,
    guard, window: win = globalThis.window, probelaufController, recovery = () => false,
    navigate = () => win.location.replace('index.html') } = {}) {
    let busy = false, blocked = false;
    const options = () => ({ persistence, archive, window: win, probelaufController, recovery: recovery() });
    return {
        get busy() { return busy; }, get blocked() { return blocked; },
        async inspect() {
            if (blocked) throw new Error('Bitte neu laden oder den Wiederherstellungspunkt zurückholen.');
            return assertNewBeginningAllowed(options());
        },
        async execute(selection = {}, opener) {
            if (busy || blocked || !canConfirmNewBeginning(selection)) return { status: 'not_confirmed' };
            busy = true;
            let snapshotId, deletionStarted = false, cleared = false, release;
            try {
                const result = await withAnnualWriteAccess(() => guard.reload({ opener, returnResult: true,
                    mutate: async operation => {
                        await assertNewBeginningAllowed(options());
                        if (await persistence.flush({ navigationOperation: operation }) === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
                        const { records } = await assertNewBeginningAllowed(options());
                        release = persistence.blockSyncWrites([], 'Neu beginnen läuft. Bitte bis zum Neuladen keine Daten ändern.', { predicate: isNewBeginningRecordKey });
                        operation.commit();
                        if (!selection.deleteSnapshots) {
                            const preferences = await persistence.captureNewBeginningPreferences?.(win) || {};
                            const snapshot = await archive.createSnapshot({ id: `new_beginning_${globalThis.crypto.randomUUID()}`,
                                label: 'Vor Neu beginnen', kind: SNAPSHOT_KINDS.newBeginningBefore,
                                records: { ...preferences, ...records },
                                activeProfileId: records.rs_current_profile || records.rs_active_profile || '',
                                restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback', liveKeyMode: 'new-beginning' }
                            }, { storage: persistence, navigationOperation: operation });
                            const readback = await archive.readSnapshot(snapshot.id, { storage: persistence });
                            if (JSON.stringify(snapshot) !== JSON.stringify(readback)) throw new Error('Der Punkt „Vor Neu beginnen“ konnte nicht bytegleich bestätigt werden. Es wurde nichts gelöscht.');
                            snapshotId = snapshot.id;
                        }
                        // Optimistischer Vergleich vor dem einzigen Hauptspeicher-Batch.
                        deletionStarted = true;
                        await persistence.replaceRecordsTransactional({}, { allowKey: isNewBeginningRecordKey,
                            expectedRecords: records, navigationOperation: operation });
                        if (selection.deleteSnapshots) {
                            for (const point of await archive.listSnapshots({ storage: persistence })) {
                                await archive.deleteSnapshot(point.id, { storage: persistence, navigationOperation: operation });
                            }
                            if ((await archive.listSnapshots({ storage: persistence })).length) throw new Error('Wiederherstellungspunkte konnten nicht vollständig gelöscht werden.');
                            // Der localStorage-Fallback soll auch den leeren Archivcontainer entfernen.
                            await persistence.replaceRecordsTransactional({}, { allowKey: key => key === 'rs_snapshot_archive_v1', navigationOperation: operation });
                        }
                        await persistence.resetNewBeginningBrowserStorage?.({ window: win, deleteSnapshots: selection.deleteSnapshots, navigationOperation: operation });
                        if (await persistence.flush({ navigationOperation: operation }) === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
                        if (recordIdentity(await persistence.readPersistedRecords(isNewBeginningRecordKey)) !== recordIdentity({})) throw new Error('Der Hauptspeicher ist nicht vollständig leer.');
                        cleared = true;
                    }, reload: navigate, flush: () => persistence.flush()
                }), { locks: win?.navigator?.locks });
                blocked = deletionStarted;
                if (!deletionStarted) release?.();
                return { status: cleared && result.status === 'reloaded' ? 'restarted' : cleared ? 'reload_required' : result.error ? 'failed' : 'cancelled',
                    snapshotId, error: result.error, deletionStarted };
            } catch (error) {
                blocked = deletionStarted;
                if (!deletionStarted) release?.();
                return { status: 'failed', snapshotId, error, deletionStarted };
            } finally { busy = false; }
        }
    };
}
