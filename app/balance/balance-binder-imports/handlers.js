// @ts-check
import { BalanceImportError, failImport } from './validation-core.js';
import { StorageError, AppError } from '../balance-config.js';
import { createNavigationOperationLifecycle } from '../../shared/navigation-guard.js';
import { getPageNavigationGuard } from '../../shared/navigation-guard-dialog.js';
import { UIRenderer } from '../balance-renderer.js';
import { BALANCE_UPDATE_MODE } from '../balance-update-pipeline.js';
import { exportBalanceFile, importBalanceFile } from '../balance-file-service.js';
import { UIReader } from '../balance-reader.js';
import { PersistenceFacade } from '../../shared/persistence-facade.js';

function captureInputUiState(inputs = {}) {
    return Object.fromEntries(Object.entries(inputs).map(([key, element]) => {
        const state = {
            checked: element?.checked,
            disabled: element?.disabled
        };
        if (element?.type !== 'file') state.value = element?.value;
        return [key, state];
    }));
}

function restoreInputUiState(inputs = {}, snapshot = {}) {
    Object.entries(snapshot).forEach(([key, state]) => {
        const element = inputs[key];
        if (!element) return;
        if (element.type !== 'file' && state.value !== undefined) element.value = state.value;
        if (state.checked !== undefined) element.checked = state.checked;
        if (state.disabled !== undefined) element.disabled = state.disabled;
    });
}

function asSafeImportError(error) {
    if (error?.context?.originalError?.code === 'rollback_failed') {
        return new BalanceImportError(
            'rollback_failed',
            `Der Import konnte nicht abgeschlossen und nicht automatisch zurückgerollt werden. Bitte den angelegten Import-Recovery-Snapshot${error?.context?.recoverySnapshotId ? ` „${error.context.recoverySnapshotId}“` : ''} unter „Daten & Sicherung“ zurückholen.`
        );
    }
    if (error instanceof BalanceImportError) return error;
    if (error instanceof StorageError) {
        return new BalanceImportError(
            'storage_failed',
            error.context?.originalError?.code === 'restore_rolled_back'
                ? `Die Speicherung konnte nicht bestätigt werden. Der vorherige Zustand wurde automatisch wiederhergestellt. Recovery-Snapshot „${error.context.recoverySnapshotId}“ unter „Daten & Sicherung“.`
                : 'Recovery-Snapshot oder Speicherung konnte nicht bestätigt werden. Die Live-Daten wurden nicht ersetzt; bitte freien Speicher und App-Berechtigungen prüfen.'
        );
    }
    return new BalanceImportError(
        'unexpected_import_error',
        'Der Import konnte nicht sicher abgeschlossen werden. Die Live-Daten wurden nicht bestätigt ersetzt; bitte die Datei prüfen oder den Recovery-Snapshot verwenden.'
    );
}

/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function createImportExportHandlers({ dom, debouncedUpdate, update,
    navigationLifecycle = createNavigationOperationLifecycle({ guard: globalThis.document ? getPageNavigationGuard() : null })
}) {
    async function previewRestoredInputs() {
        // Verworfenes Importdaten-Feedback auch dann entfernen, wenn die
        // Vorschau vor der üblichen Bereinigung im Main-Update scheitert.
        // Aktionsfehler anderer Bereiche bleiben dabei erhalten.
        UIRenderer.clearError();
        try {
            await update({ mode: BALANCE_UPDATE_MODE.PREVIEW });
        } catch {
            // Der ursprüngliche Import-/Recoveryfehler muss sichtbar bleiben.
        }
    }

    return {
        handleExport() {
            UIRenderer.clearActionError('balance-export');
            try {
                const dataToExport = exportBalanceFile();
                const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `balancing-export-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
                const warning = dataToExport.validationWarnings?.[0];
                UIRenderer.toast(warning
                    ? `Export erstellt mit Validierungshinweis [${warning.code}]: ${warning.message}`
                    : 'Export erstellt.', warning ? 'info' : true);
            } catch (error) {
                const code = error?.code || 'export_failed';
                const message = error?.message || 'Der Balance-Zustand kann nicht als JSON exportiert werden.';
                UIRenderer.handleActionError(new AppError(
                    `Export nicht möglich [${code}]: ${message}`,
                    { originalError: error, code }
                ), 'balance-export');
            }
        },

        async handleImport(e) {
            const file = e.target.files?.[0];
            if (!file) return;
            if (navigationLifecycle.isBlocked()) {
                UIRenderer.handleActionError(new BalanceImportError('NAVIGATION_WRITE_BUSY',
                    'Eine andere Aktion läuft. Bitte warten und die Importdatei danach erneut auswählen.'), 'balance-import');
                e.target.value = '';
                return { status: 'in_flight' };
            }
            return navigationLifecycle.run({}, async navigationOperation => {
                UIRenderer.clearActionError('balance-import');
                const uiSnapshot = captureInputUiState(dom.inputs);
                try {
                    let json;
                    try {
                        const text = await file.text();
                        navigationOperation.check();
                        json = JSON.parse(text);
                    } catch {
                        navigationOperation.check();
                        failImport('invalid_json', 'Die Datei enthält kein gültiges JSON. Bitte eine unveränderte Balance-Exportdatei auswählen.');
                    }

                    navigationOperation.check();
                    const result = await importBalanceFile(json, { navigationOperation,
                        applyInputs: inputs => UIReader.applyStoredInputs(inputs),
                        update: mode => update({ mode })
                    });
                    const normalized = result.normalized;
                    UIRenderer.toast(normalized.migrated
                        ? 'Legacy-Import migriert und erfolgreich gespeichert. Recovery-Snapshot wurde erstellt.'
                        : 'Import erfolgreich. Recovery-Snapshot wurde erstellt.');
                } catch (err) {
                    restoreInputUiState(dom.inputs, uiSnapshot);
                    await previewRestoredInputs();
                    if (err?.name === 'AbortError') return { status: 'cancelled' };
                    UIRenderer.handleActionError(asSafeImportError(err), 'balance-import');
                    return { ok: false, status: 'invalid' };
                } finally {
                    e.target.value = '';
                    // Auch Reader-Migrationen und andere Hilfswrites gehören
                    // zum bestätigten Vorbereitungs-/Abbruchende.
                    if (navigationOperation.phase !== 'commit' && await PersistenceFacade.flush() === false) {
                        throw new Error('PERSISTENCE_FLUSH_FAILED');
                    }
                }
            });
        }
    };
}
