/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { DATA_BACKUP_SUMMARY_KEY, BACKUP_DELIVERY_KEY, backupDeliveryRecord, buildBackupSummary } from '../../data/data-backup-summary.js';
import { OVERVIEW_BACKUP_KEY } from '../../overview/overview-storage.js';
import { isTauriRuntime } from '../runtime-env.js';
import { createNavigationOperationLifecycle } from '../navigation-guard.js';
import { getPageNavigationGuard } from '../navigation-guard-dialog.js';
import { PersistenceFacade } from '../persistence-facade.js';
import { validatePersistenceDomainRecords } from './domain-validation.js';
import { buildFullPersistenceBackup, createFullBackupFilename, createRecoveryBackupFilename, buildRecoveryPersistenceBackup } from './format.js';
import { assertFullBackupAllowed } from './guard.js';
import { closeRestorePointNotice } from '../snapshot-reset.js';
import { saveTextFile } from '../save-file.js';

/** JSON-Datei speichern (SD-1): Desktop-App mit Dialog „Speichern unter“, Browser als Download, der noch im Aufruf startet.
 * @param {unknown} data
 * @param {string} filename
 * @param {Document} [doc]
 * @returns {Promise<import('../save-file.js').SaveResult>} `{saved: false}` nach Abbruch im Dialog.
 */
export function downloadJsonFile(data, filename, doc = globalThis.document) {
    return saveTextFile({ filename, content: JSON.stringify(data, null, 2), mime: 'application/json', filterName: 'JSON-Datei', extensions: ['json'], doc });
}

/** Dateiausgabe der Vollsicherung. Desktop-App (SD-1): Dialog „Speichern unter“, `bestaetigt` mit gewähltem Pfad erst nach dem Schreiben.
 * Browser mit `showSaveFilePicker`: ebenfalls `bestaetigt` nach dem Schreiben. Browser ohne Dialog übergibt die Datei nur: `angestossen`.
 * Bricht der Nutzer den Dialog ab: `abgebrochen`, es entsteht keine Datei.
 * @param {unknown} data
 * @param {string} filename
 * @param {Document} [doc]
 * @param {any} [win]
 * @returns {Promise<{delivery: 'angestossen'|'bestaetigt'|'abgebrochen', path: string|null}>}
 */
export async function deliverBackupFile(data, filename, doc = globalThis.document, win = doc?.defaultView ?? globalThis.window) {
    if (isTauriRuntime(win)) {
        const result = await saveTextFile({ filename, content: JSON.stringify(data, null, 2), mime: 'application/json', filterName: 'Vollsicherung', extensions: ['json'], doc, win });
        return result.saved ? { delivery: 'bestaetigt', path: result.path } : { delivery: 'abgebrochen', path: null };
    }
    if (typeof win?.showSaveFilePicker !== 'function') {
        await downloadJsonFile(data, filename, doc);
        return { delivery: 'angestossen', path: null };
    }
    let handle;
    try {
        handle = await win.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'Vollsicherung', accept: { 'application/json': ['.json'] } }] });
    } catch (error) {
        if (/** @type {I.AppError} */ (error)?.name === 'AbortError') return { delivery: 'abgebrochen', path: null };
        throw error;
    }
    const writable = await handle.createWritable();
    try {
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
    } catch (error) {
        try { await writable.abort?.(); } catch { /* Der Schreibfehler selbst wird gemeldet. */ }
        throw error;
    }
    return { delivery: 'bestaetigt', path: null };
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
        const metadataKeys = [OVERVIEW_BACKUP_KEY, DATA_BACKUP_SUMMARY_KEY, BACKUP_DELIVERY_KEY];
        const previous = Object.fromEntries(metadataKeys.filter(key => persistence.getItemSync(key) !== null)
            .map(key => [key, persistence.getItemSync(key)]));
        const summary = await buildBackupSummary(backup.records, backup.exportedAt);
        navigationOperation.check();
        await assertFullBackupAllowed({ ...options, persistence });
        /** @type {Record<string, string>} */
        const metadata = { [OVERVIEW_BACKUP_KEY]: backup.exportedAt, [DATA_BACKUP_SUMMARY_KEY]: JSON.stringify(summary) };
        Object.assign(backup.records, metadata);
        backup.recordCount = Object.keys(backup.records).length;
        // HV-6: Die Herkunft (nur bei mehreren Haushalten gesetzt) benennt auch die Datei.
        const origin = /** @type {{household?: {name?: string}}} */ (/** @type {unknown} */ (backup)).household;
        const filename = options.filename || createFullBackupFilename(new Date(), origin?.name || '');
        const deliver = options.download || ((/** @type {unknown} */ data, /** @type {string} */ name, /** @type {Document} */ doc) => deliverBackupFile(data, name, doc, options.window || doc?.defaultView || globalThis.window));
        const answer = await /** @type {NonNullable<I.BackupOptions["download"]>} */ (deliver)(backup, filename, options.document || globalThis.document);
        // Ausgabe meldet `{delivery, path}` oder, wie eingespielte Testausgaben, nur die Art.
        const outcome = /** @type {{delivery?: unknown, path?: unknown}} */ (answer && typeof answer === 'object' ? answer : { delivery: answer });
        const delivered = outcome.delivery, path = typeof outcome.path === 'string' && outcome.path ? outcome.path : null;
        if (delivered === false) throw new Error('Dateiausgabe wurde nicht bestätigt.');
        // Abbruch im Speicherdialog: kein Fehler und keine Änderung am Sicherungsstand.
        if (delivered === 'abgebrochen') return { filename, backup, delivery: /** @type {const} */ ('abgebrochen'), path: null };
        const delivery = delivered === 'bestaetigt' ? 'bestaetigt' : 'angestossen';
        // SV-1b: Eine erstellte oder angestoßene Vollsicherung erledigt den Hinweis zur Archivleerung dauerhaft.
        try { await closeRestorePointNotice({ persistence: /** @type {any} */ (persistence) }); } catch { /* Der Hinweis bleibt dann sichtbar; die Sicherung gilt. */ }
        metadata[BACKUP_DELIVERY_KEY] = backupDeliveryRecord(backup.exportedAt, delivery);
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
        return { filename, backup, delivery, path };
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
    // SD-1: Bricht der Nutzer den Dialog ab, entsteht keine Rettungsdatei (`saved: false`); der Import hält dann an.
    const result = await downloadJsonFile(backup, filename, options.document || globalThis.document);
    return { filename, backup, skipped: false, saved: result.saved, path: result.saved ? result.path : null };
}
