/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { requestPageConfirmation } from '../page-dialog.js';
import { createNavigationGuard, createNavigationOperationLifecycle } from '../navigation-guard.js';
import { getPageNavigationGuard } from '../navigation-guard-dialog.js';
import { PersistenceFacade } from '../persistence-facade.js';
import { flushPendingProfileInputSave } from '../../profile/profile-navigation.js';
import { FullBackupLiveChangedError } from './schema.js';
import { collectImportDecisionRecords, recordsMatch } from './records.js';
import { normalizeFullPersistenceBackup } from './format.js';
import { assertFullBackupAllowed } from './guard.js';
import { downloadFullPersistenceBackup, downloadRecoveryPersistenceBackup } from './download.js';
import { prepareFullBackupRecovery, importFullPersistenceBackup } from './restore.js';

// HV-1: Bei mehreren Haushalten nennt die Bestätigung das Ziel des Imports.
function importTargetText() {
    const registry = PersistenceFacade.getHouseholds?.();
    if (!registry || registry.households.length < 2) return '';
    const active = registry.households.find(entry => entry.id === registry.active);
    return ` im Haushalt ${active?.id === 'h1' ? active.name || 'Haushalt 1' : active?.name}`;
}
// HV-3: Stammt die Datei aus einem anderen Haushalt, sagt die Bestätigung das ausdrücklich.
/** @param {{household?: {id?: unknown, name?: unknown}, backupPurpose?: unknown}} backup */
function importOriginText(backup) {
    const registry = PersistenceFacade.getHouseholds?.();
    const origin = backup?.household;
    if (!origin || typeof origin.name !== 'string' || !registry) return '';
    // Gleiche Kennung heißt nicht gleiche Herkunft („h1“ gibt es in jeder App): eine genannte Herkunft wird immer gezeigt.
    return registry.households.length === 1
        ? `\n\nDie Datei stammt aus dem Haushalt „${origin.name}“ und wird hier zu Haushalt 1.`
        : `\n\nDie Datei stammt aus dem Haushalt „${origin.name}“. Als eigenen neuen Haushalt spielst du sie über „Neuer Haushalt …“ ein.`;
}

/**
 * @param {HTMLElement | null} status
 * @param {unknown} error
 * @param {Document} doc
 * @returns {void}
 */
function showBackupError(status, error, doc) {
    if (!status) return;
    status.dataset.kind = /** @type {I.AppError} */ (error)?.name === 'AbortError' ? '' : 'error';
    status.textContent = /** @type {I.AppError} */ (error)?.name === 'AbortError' ? 'Import abgebrochen.' : /** @type {I.AppError} */ (error)?.message || 'Backupaktion fehlgeschlagen.';
    if (status.textContent.includes('Spielbereich')) {
        const card = /** @type {HTMLDetailsElement | null} */ (doc.getElementById?.('daten-sicherung'));
        if (card) card.open = true;
    }
}

/**
 * @param {I.BackupOptions} [options]
 * @returns {boolean}
 */
export function bindFullBackupButton(options = {}) {
    const doc = options.document || globalThis.document;
    const button = options.button || /** @type {HTMLButtonElement | null} */ (doc.getElementById('fullBackupBtn'));
    const status = options.status || doc.getElementById('fullBackupStatus');
    if (!button) return false;

    button.addEventListener('click', async () => {
        button.disabled = true;
        if (status) {
            status.dataset.kind = '';
            status.textContent = 'Backup wird erstellt...';
        }
        try {
            const { backup } = await downloadFullPersistenceBackup({ ...options, document: doc });
            if (status) {
                status.dataset.kind = 'ok';
                const excludedText = backup.excludedRecordCount
                    ? ` ${backup.excludedRecordCount} UI-/Layout-Einstellungen sind nicht enthalten.`
                    : '';
                status.textContent = `Komplettes fachliches Backup erstellt (${backup.recordCount} Eintraege). Dateiausgabe der Vollsicherung angestoßen.${excludedText}`;
            }
        } catch (err) {
            showBackupError(status, err, doc);
        } finally {
            button.disabled = false;
        }
    });

    return true;
}

/**
 * @param {I.BackupOptions} [options]
 * @returns {boolean}
 */
export function bindFullBackupImport(options = {}) {
    const doc = options.document || globalThis.document;
    const button = options.button || /** @type {HTMLButtonElement | null} */ (doc.getElementById('fullBackupImportBtn'));
    const fileInput = options.fileInput || /** @type {HTMLInputElement | null} */ (doc.getElementById('fullBackupImportFile'));
    const status = options.status || doc.getElementById('fullBackupStatus');
    if (!button || !fileInput) return false;

    button.addEventListener('click', async () => {
        fileInput.value = '';
        try {
            await assertFullBackupAllowed(options);
            fileInput.click();
        } catch (error) {
            showBackupError(status, error, doc);
        }
    });

    const guard = options.guard ?? (globalThis.document ? getPageNavigationGuard(doc) : createNavigationGuard());
    const lifecycle = /** @type {I.CreateLifecycle} */ (createNavigationOperationLifecycle)({ guard });
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        if (lifecycle.isBlocked()) {
            if (status) {
                status.dataset.kind = 'error';
                status.textContent = 'Eine andere Aktion läuft. Bitte warten und die Importdatei danach erneut auswählen.';
            }
            fileInput.value = '';
            return;
        }
        let recoveryArchiveTouched = false;
        try {
            const prepared = await lifecycle.run({}, async navigationOperation => {
                try {
                    await assertFullBackupAllowed(options);
                    navigationOperation.check();
                    const text = await /** @type {Promise<string>} */ (new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result || ''));
                        reader.onerror = () => reject(reader.error || new Error('Datei konnte nicht gelesen werden.'));
                        reader.onabort = () => reject(new Error('Dateilesen wurde abgebrochen.'));
                        reader.readAsText(file);
                    }));
                    await assertFullBackupAllowed(options);
                    navigationOperation.check();
                    const normalized = normalizeFullPersistenceBackup(JSON.parse(text));
                    if (!normalized.ok) throw new Error(normalized.message);
                    const backup = normalized.backup;
                    if (await flushPendingProfileInputSave(doc) === false) throw new Error('Die ausstehende Eingabe konnte nicht gesichert werden. Bitte den Stand prüfen und den Import erneut versuchen.');
                    navigationOperation.check();
                    const decisionRecords = collectImportDecisionRecords();
                    const confirmImport = options.confirmImport || (description => requestPageConfirmation({ doc, title: 'Backup importieren', description, confirmLabel: 'Backup importieren', danger: true, signal: navigationOperation.controller.signal, opener: button }));
                    const migrationText = backup.migrated
                        ? `\n\nSchema 1 wird migriert; ${backup.excludedRecordCount} nicht mehr unterstützte Einträge werden ausgelassen.` : '';
                    const confirmed = await confirmImport(
                        `Komplettes Backup mit ${backup.recordCount} Einträgen importieren?\n\nAlle aktuell gespeicherten fachlichen Daten${importTargetText()} werden ersetzt.${importOriginText(/** @type {{household?: {id?: unknown, name?: unknown}, backupPurpose?: unknown}} */ (/** @type {unknown} */ (backup)))}${migrationText}`);
                    await assertFullBackupAllowed(options);
                    navigationOperation.check();
                    if (confirmed !== true) {
                        if (status) { status.dataset.kind = ''; status.textContent = 'Import abgebrochen; die gespeicherten Daten wurden nicht ersetzt.'; }
                        return null;
                    }
                    if (!recordsMatch(decisionRecords, collectImportDecisionRecords())) throw new FullBackupLiveChangedError();
                    if (status) { status.dataset.kind = ''; status.textContent = 'Wiederherstellungssicherung wird erstellt …'; }
                    let recoveryResult;
                    try {
                        recoveryResult = await (options.createRecoveryBackup || downloadRecoveryPersistenceBackup)({ ...options, document: doc });
                    } catch (error) {
                        throw new Error(`Import abgebrochen: Recovery-Backup konnte nicht erstellt werden (${/** @type {I.AppError} */ (error)?.message || 'unbekannter Fehler'}).`);
                    }
                    navigationOperation.check();
                    await assertFullBackupAllowed(options);
                    if (!recordsMatch(decisionRecords, collectImportDecisionRecords())) throw new FullBackupLiveChangedError();
                    recoveryArchiveTouched = true;
                    const preparedRecovery = await prepareFullBackupRecovery(PersistenceFacade, PersistenceFacade, navigationOperation, options);
                    navigationOperation.check();
                    await assertFullBackupAllowed(options);
                    if (!recordsMatch(decisionRecords, collectImportDecisionRecords())) throw new FullBackupLiveChangedError();
                    return { backup, recoveryResult, preparedRecovery };
                } finally { fileInput.value = ''; }
            });
            if (!prepared) return;
            /** @type {Awaited<ReturnType<typeof importFullPersistenceBackup>> | undefined} */
            let importResult;
            const navigated = await /** @type {I.Guard} */ (guard).reload({
                opener: button,
                subscribeChanges: notify => PersistenceFacade.observeInputChanges(notify, doc),
                mutate: async navigationOperation => {
                    const result = await importFullPersistenceBackup(prepared.backup, { probelaufController: options.probelaufController, navigationOperation, preparedRecovery: prepared.preparedRecovery });
                    importResult = result;
                    if (status && !result.ok) {
                        status.dataset.kind = 'error';
                        status.textContent = result.message || 'Import fehlgeschlagen.';
                    }
                    return result.ok;
                },
                flush: () => PersistenceFacade.flush(),
                reload: options.reload || (() => globalThis.location?.reload?.())
            });
            if (status && !importResult) {
                status.dataset.kind = '';
                status.textContent = 'Import abgebrochen; die gespeicherten Daten wurden nicht ersetzt. Die Wiederherstellungssicherung bleibt erhalten.';
            }
            if (status && importResult?.ok) {
                status.dataset.kind = navigated ? 'ok' : 'error';
                const recoveryText = prepared.recoveryResult?.skipped
                    ? ' Keine Wiederherstellungssicherung nötig, da vorher keine Daten gespeichert waren.'
                    : ' Wiederherstellungssicherung wurde vorher erstellt.';
                status.textContent = navigated ? `${importResult.message}${recoveryText}`
                    : 'Import gespeichert; Reload wegen einer Zustandsänderung abgebrochen. Bitte erneut prüfen.';
            }
        } catch (error) {
            showBackupError(status, error, doc);
        } finally {
            if (recoveryArchiveTouched) {
                try { doc.dispatchEvent?.(new CustomEvent('overview-backup-changed')); }
                catch { /* Die Importmeldung darf nicht durch den Refresh ersetzt werden. */ }
            }
        }
    });

    return true;
}
