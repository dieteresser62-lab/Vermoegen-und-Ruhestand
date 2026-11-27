/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { migrateStoredCareForms } from '../../profile/profile-care-migration.js';
import { createNavigationOperationLifecycle } from '../navigation-guard.js';
import { getPageNavigationGuard } from '../navigation-guard-dialog.js';
import { PersistenceFacade } from '../persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_SCOPES } from '../snapshot-archive.js';
import { pruneRestorePoints } from '../snapshot-retention.js';
import { isAllowedPersistenceImportKey } from '../persistence-key-policy.js';
import { PROFILE_STORAGE_KEYS } from '../../profile/profile-state.js';
import { FULL_BACKUP_RECOVERY_KIND, FULL_BACKUP_RELOAD_MESSAGE, PROBELAUF_BACKUP_MESSAGE, PROBELAUF_BACKUP_STATE_UNAVAILABLE_MESSAGE, FullBackupLiveChangedError } from './schema.js';
import { recordsMatch, collectAllowedFacadeRecords } from './records.js';
import { validatePersistenceDomainRecords } from './domain-validation.js';
import { normalizeFullPersistenceBackup } from './format.js';
import { assertFullBackupAllowed } from './guard.js';
import { BACKUP_DELIVERY_KEY, backupImportRecord } from '../../data/data-backup-summary.js';

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
        // SV-1b: Der Punkt umfasst alles, was der Vollimport ersetzt, auch Tageskurse, Verlaufsbeginn und Sicherungszeit.
        scope: SNAPSHOT_SCOPES.import,
        records: previousRecords,
        activeProfileId
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
    let recoverySnapshotId = '', written = false, /** @type {(() => unknown) | undefined} */ release;
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

            // ST7-FIX (Gutachten ST7 P2-1): Die Datei behält ihre eigene Sicherungszeit. Eine Übergabe- oder Wiederherstellungsdatei
            // zählt nicht als Vollsicherung; der Kopf von Daten & Sicherung nennt, was eingespielt wurde.
            migratedRecords.set(BACKUP_DELIVERY_KEY, backupImportRecord(backup.exportedAt, new Date().toISOString()));
            navigationOperation.commit();
            // HL-1 (H-04): Wie beim Zurückholen eines Punkts darf die einspielende Seite den neuen Stand nicht überschreiben.
            // Die Sperre gilt ab dem Ersetzen bis zum Neuladen; nur eine bestätigte Rücknahme gibt sie wieder frei.
            if (options.lockUntilReload) release = /** @type {(() => unknown) | undefined} */ (persistence.blockSyncWrites?.([], FULL_BACKUP_RELOAD_MESSAGE, { predicate: isAllowedPersistenceImportKey }));
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
        written = true;
        // SV-1: Erst nach dem bestätigten Einspielen kürzen; es bleiben die letzten drei Punkte vor dem Einspielen.
        await pruneRestorePoints(FULL_BACKUP_RECOVERY_KIND, { storage: snapshotStorage, protectedIds: [recoverySnapshotId],
            records: Object.fromEntries(migratedRecords), navigationOperation });
        return {
            ok: true,
            message: `Komplettes Backup importiert (${backup.recordCount} Einträge${backup.migrated ? ', Schema 1 migriert' : ''}).`,
            backup,
            recoverySnapshotId,
            restore: result
        };
        });
    } catch (error) {
        if (!written) release?.();
        if (/** @type {I.AppError} */ (error)?.name === 'AbortError') throw error;
        recoverySnapshotId ||= /** @type {I.AppError} */ (error)?.recoverySnapshotId || '';
        const code = /** @type {I.AppError} */ (error)?.code || 'full_backup_import_failed';
        const message = fullBackupImportErrorMessage(error, code);
        const recoveryHint = recoverySnapshotId
            ? ' Ein Wiederherstellungspunkt wurde angelegt. Du findest ihn in Daten & Sicherung › Wiederherstellungspunkte.'
                + (code === 'rollback_failed' ? ' Bitte deinen bisherigen Stand von dort wiederherstellen: Seite neu laden und den Punkt „Vor dem Einspielen einer Sicherung“ zurückholen.' : '')
            : code === 'rollback_failed' ? ' Bitte deinen bisherigen Stand aus einer vorhandenen Sicherung wiederherstellen.' : '';
        // SV-1b: Ist auch die Rücknahme unbestätigt, sperrt die Seite bis zum Neuladen; der Punkt davor bleibt zum Zurückholen.
        if (code === 'rollback_failed') persistence.blockSyncWrites?.([], `${message}${recoveryHint}`, { predicate: isAllowedPersistenceImportKey });
        return {
            ok: false,
            code,
            message: `${message}${recoveryHint}`,
            recoverySnapshotId: recoverySnapshotId || null,
            rollbackError: /** @type {I.AppError} */ (error)?.rollbackError || null
        };
    }
}
