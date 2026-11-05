/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { migrateStoredCareForms } from '../../profile/profile-care-migration.js';
import { createNavigationOperationLifecycle } from '../navigation-guard.js';
import { getPageNavigationGuard } from '../navigation-guard-dialog.js';
import { PersistenceFacade } from '../persistence-facade.js';
import { SnapshotArchive } from '../snapshot-archive.js';
import { isAllowedPersistenceImportKey } from '../persistence-key-policy.js';
import { PROFILE_STORAGE_KEYS } from '../../profile/profile-state.js';
import { FULL_BACKUP_RECOVERY_KIND, PROBELAUF_BACKUP_MESSAGE, PROBELAUF_BACKUP_STATE_UNAVAILABLE_MESSAGE, FullBackupLiveChangedError } from './schema.js';
import { recordsMatch, collectAllowedFacadeRecords } from './records.js';
import { validatePersistenceDomainRecords } from './domain-validation.js';
import { normalizeFullPersistenceBackup } from './format.js';
import { assertFullBackupAllowed } from './guard.js';

/**
 * @param {I.Facade} persistence
 * @param {unknown} snapshotStorage
 * @param {I.Operation} navigationOperation
 * @param {I.BackupOptions} [options]
 */
export async function prepareFullBackupRecovery(persistence, snapshotStorage, navigationOperation, options = {}) {
    await assertFullBackupAllowed({ ...options, persistence });
    navigationOperation.check();
    if (await persistence.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    await assertFullBackupAllowed({ ...options, persistence });
    navigationOperation.check();
    const previousRecords = collectAllowedFacadeRecords(persistence);
    const activeProfileId = previousRecords[PROFILE_STORAGE_KEYS.active]
        || previousRecords[PROFILE_STORAGE_KEYS.current]
        || '';
    const recovery = await SnapshotArchive.createSnapshot({
        label: `Vollbackup-Import Recovery ${new Date().toISOString()}`,
        kind: FULL_BACKUP_RECOVERY_KIND,
        records: previousRecords,
        activeProfileId,
        restoreScope: {
            profileRegistryMode: 'replace-all-rollback',
            profileLiveDataMode: 'replace-all-rollback'
        }
    }, /** @type {Parameters<typeof SnapshotArchive.createSnapshot>[1]} */ ({ storage: snapshotStorage, navigationOperation }));
    const confirmedRecovery = await SnapshotArchive.readSnapshot(recovery.id, {
        storage: snapshotStorage
    });
    const recoverySnapshotId = confirmedRecovery.id;
    navigationOperation.check();
    if (!recordsMatch(previousRecords, confirmedRecovery.records)) {
        /** @type {import('../../../typcheck/runtime-contracts.js').AppError} */
        const error = new Error('Import abgebrochen: Der Wiederherstellungspunkt stimmt nicht mit dem aktuellen Stand überein. Bitte in Daten & Sicherung › Wiederherstellungspunkte prüfen.');
        /** @type {I.AppError} */ (error).code = 'recovery_snapshot_mismatch';
        /** @type {I.AppError} */ (error).recoverySnapshotId = recoverySnapshotId;
        throw error;
    }

    return { recoverySnapshotId, previousRecords };
}

/**
 * @param {unknown} error
 * @param {string} code
 * @returns {string}
 */
function fullBackupImportErrorMessage(error, code) {
    if (error instanceof FullBackupLiveChangedError) return /** @type {I.AppError} */ (error).message;
    switch (code) {
        case 'probelauf_backup_blocked':
            return PROBELAUF_BACKUP_MESSAGE;
        case 'probelauf_backup_state_unavailable':
            return PROBELAUF_BACKUP_STATE_UNAVAILABLE_MESSAGE;
        case 'restore_rolled_back':
            return 'Die Sicherung konnte nicht eingespielt werden. Dein bisheriger Stand ist unverändert.';
        case 'rollback_failed':
            return 'Die Sicherung konnte nicht vollständig eingespielt werden. Die Wiederherstellung deines bisherigen Stands konnte nicht bestätigt werden.';
        case 'recovery_snapshot_mismatch':
            return 'Der Import wurde vor dem Ersetzen abgebrochen. Der Wiederherstellungspunkt stimmt nicht mit dem aktuellen Stand überein. Bitte den Punkt vor einer Wiederherstellung prüfen.';
        default:
            return 'Die Sicherung konnte nicht eingespielt werden. Bitte den aktuellen Stand prüfen und den Import erneut versuchen.';
    }
}

/**
 * @param {unknown} payload
 * @param {I.BackupOptions} [options]
 */
export async function importFullPersistenceBackup(payload, options = {}) {
    const normalized = normalizeFullPersistenceBackup(payload);
    if (!normalized.ok) return normalized;
    const backup = normalized.backup;
    const migratedRecords = new Map(Object.entries(backup.records));
    migrateStoredCareForms({ getItem: key => migratedRecords.get(key) ?? null,
        setItem: (key, value) => migratedRecords.set(key, String(value)), removeItem: key => migratedRecords.delete(key) });
    if (backup.recordCount === 0) {
        return { ok: false, message: 'Backup enthaelt keine gespeicherten Daten.' };
    }
    const persistence = options.persistence || PersistenceFacade;
    const snapshotStorage = options.snapshotStorage || persistence;
    let recoverySnapshotId = '';
    const lifecycle = /** @type {I.CreateLifecycle} */ (createNavigationOperationLifecycle)({ guard: options.guard ?? (globalThis.document ? getPageNavigationGuard() : null) });
    try {
        return await lifecycle.run(options, async navigationOperation => {
            await assertFullBackupAllowed({ ...options, persistence });
            navigationOperation.check();
            const preparedRecovery = options.preparedRecovery
                || await prepareFullBackupRecovery(persistence, snapshotStorage, navigationOperation, options);
            recoverySnapshotId = preparedRecovery.recoverySnapshotId;
            await assertFullBackupAllowed({ ...options, persistence });
            navigationOperation.check();
            if (!recordsMatch(preparedRecovery.previousRecords, collectAllowedFacadeRecords(persistence))) {
                throw new FullBackupLiveChangedError();
            }

            navigationOperation.commit();
            const result = await persistence.replaceRecordsTransactional(Object.fromEntries(migratedRecords), {
                allowKey: isAllowedPersistenceImportKey, navigationOperation,
                postValidate(records) {
                    const domainValidation = validatePersistenceDomainRecords(records);
                    if (!domainValidation.ok) return /** @type {Extract<D.DomainValidation, {ok: false}>} */ (domainValidation);
                    if (typeof options.validateAfterLoad === 'function') {
                        return options.validateAfterLoad(records, backup);
                    }
                    return domainValidation;
                }
        });
        return {
            ok: true,
            message: `Komplettes Backup importiert (${backup.recordCount} Eintraege${backup.migrated ? ', Schema 1 migriert' : ''}).`,
            backup,
            recoverySnapshotId,
            restore: result
        };
        });
    } catch (error) {
        if (/** @type {I.AppError} */ (error)?.name === 'AbortError') throw error;
        recoverySnapshotId ||= /** @type {I.AppError} */ (error)?.recoverySnapshotId || '';
        const code = /** @type {I.AppError} */ (error)?.code || 'full_backup_import_failed';
        const message = fullBackupImportErrorMessage(error, code);
        const recoveryHint = recoverySnapshotId
            ? ' Ein Wiederherstellungspunkt wurde angelegt. Du findest ihn in Daten & Sicherung › Wiederherstellungspunkte.'
                + (code === 'rollback_failed' ? ' Bitte deinen bisherigen Stand von dort wiederherstellen.' : '')
            : code === 'rollback_failed' ? ' Bitte deinen bisherigen Stand aus einer vorhandenen Sicherung wiederherstellen.' : '';
        return {
            ok: false,
            code,
            message: `${message}${recoveryHint}`,
            recoverySnapshotId: recoverySnapshotId || null,
            rollbackError: /** @type {I.AppError} */ (error)?.rollbackError || null
        };
    }
}
