/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { DATA_BACKUP_SUMMARY_KEY, buildBackupSummary } from '../../data/data-backup-summary.js';
import { OVERVIEW_BACKUP_KEY } from '../../overview/overview-storage.js';
import { createNavigationOperationLifecycle } from '../navigation-guard.js';
import { getPageNavigationGuard } from '../navigation-guard-dialog.js';
import { PersistenceFacade } from '../persistence-facade.js';
import { validatePersistenceDomainRecords } from './domain-validation.js';
import { buildFullPersistenceBackup, createFullBackupFilename, createRecoveryBackupFilename, buildRecoveryPersistenceBackup } from './format.js';
import { assertFullBackupAllowed } from './guard.js';

/**
 * @param {unknown} data
 * @param {string} filename
 * @param {Document} [doc]
 * @returns {void}
 */
export function downloadJsonFile(data, filename, doc = globalThis.document) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    doc.body.appendChild(anchor);
    try { anchor.click(); }
    finally { anchor.remove(); URL.revokeObjectURL(url); }
}

/**
 * @param {I.BackupOptions} [options]
 */
export async function downloadFullPersistenceBackup(options = {}) {
    const persistence = options.persistence || PersistenceFacade;
    const lifecycle = /** @type {I.CreateLifecycle} */ (createNavigationOperationLifecycle)({ guard: options.guard ?? (globalThis.document ? getPageNavigationGuard(options.document) : null) });
    return lifecycle.run(options, async navigationOperation => {
        await assertFullBackupAllowed({ ...options, persistence });
        const preflight = validatePersistenceDomainRecords(buildFullPersistenceBackup({ ...options, storage: options.storage || persistence }).records, { householdLimit: false });
        if (!preflight.ok) throw new Error(preflight.message);
        if (await persistence.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        navigationOperation.check();
        await assertFullBackupAllowed({ ...options, persistence });
        const backup = buildFullPersistenceBackup({ ...options, storage: options.storage || persistence });
        if (backup.recordCount === 0) throw new Error('Keine gespeicherten Daten fuer ein Backup gefunden.');
        const validation = validatePersistenceDomainRecords(backup.records, { householdLimit: false });
        if (!validation.ok) throw new Error(validation.message);
        const metadataKeys = [OVERVIEW_BACKUP_KEY, DATA_BACKUP_SUMMARY_KEY];
        const previous = Object.fromEntries(metadataKeys.filter(key => persistence.getItemSync(key) !== null)
            .map(key => [key, persistence.getItemSync(key)]));
        const summary = await buildBackupSummary(backup.records, backup.exportedAt);
        navigationOperation.check();
        await assertFullBackupAllowed({ ...options, persistence });
        const metadata = { [OVERVIEW_BACKUP_KEY]: backup.exportedAt, [DATA_BACKUP_SUMMARY_KEY]: JSON.stringify(summary) };
        Object.assign(backup.records, metadata);
        backup.recordCount = Object.keys(backup.records).length;
        // HV-6: Die Herkunft (nur bei mehreren Haushalten gesetzt) benennt auch die Datei.
        const origin = /** @type {{household?: {name?: string}}} */ (/** @type {unknown} */ (backup)).household;
        const filename = options.filename || createFullBackupFilename(new Date(), origin?.name || '');
        const delivered = await (options.download || /** @type {NonNullable<I.BackupOptions["download"]>} */ (downloadJsonFile))(backup, filename, options.document || globalThis.document);
        if (delivered === false) throw new Error('Dateiausgabe wurde nicht bestätigt.');
        navigationOperation.check();
        await assertFullBackupAllowed({ ...options, persistence });
        try {
            if (await persistence.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            await assertFullBackupAllowed({ ...options, persistence });
            // Enge bestätigte Transaktion: Zeit und Basis gemeinsam, ohne übrige Fachdaten zu ersetzen.
            await persistence.replaceRecordsTransactional(metadata, {
                allowKey: key => metadataKeys.includes(key), expectedRecords: /** @type {D.StringRecords} */ (previous), navigationOperation
            });
        } catch (error) {
            throw new Error(`Backup-Dateiausgabe angestoßen; Sicherungszeit und Vergleichsbasis konnten nicht dauerhaft bestätigt werden. ${/** @type {I.AppError} */ (error)?.message || ''}`);
        }
        options.document?.dispatchEvent?.(new (options.document.defaultView?.Event || Event)('overview-backup-changed'));
        return { filename, backup };
    });
}

/**
 * @param {I.BackupOptions} [options]
 */
export async function downloadRecoveryPersistenceBackup(options = {}) {
    await assertFullBackupAllowed(options);
    if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    await assertFullBackupAllowed(options);
    const backup = buildRecoveryPersistenceBackup(options);
    if (backup.recordCount === 0) {
        return { filename: null, backup, skipped: true };
    }
    const filename = options.filename || createRecoveryBackupFilename();
    downloadJsonFile(backup, filename, options.document || globalThis.document);
    return { filename, backup, skipped: false };
}
