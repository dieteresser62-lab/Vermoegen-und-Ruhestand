import { requestPageConfirmation } from '../shared/page-dialog.js';
import { createProfileRecoveryDocument, resetProfileRecovery } from './profile-storage.js';
import { renderSuiteProfile } from '../shared/suite-frame.js';
import { downloadJsonFile } from '../shared/persistence-backup.js';
import { SAVE_CANCELLED_TEXT } from '../shared/save-file.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';
import { reloadGuardedPage } from '../shared/navigation-guard-dialog.js';

async function flushProfileWrites() {
    if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
}

function createRecoveryFilename(date = new Date()) {
    return `profil-recovery-${date.toISOString().replace(/[:.]/g, '-')}.json`;
}

function setProfileControlsDisabled(controls, disabled) {
    controls.forEach(control => {
        if (control && 'disabled' in control) control.disabled = disabled;
    });
}

export function renderProfileRecovery({
    statusEl,
    recovery,
    controls,
    win = window,
    doc = document
}) {
    renderSuiteProfile(doc, { status: 'unavailable' });
    statusEl.textContent = '';
    statusEl.dataset.kind = 'error';
    statusEl.dataset.profileRecovery = recovery.status;
    setProfileControlsDisabled(controls, true);

    const message = doc.createElement('p');
    const introText = `${recovery.message} Ohne ausdrückliche Entscheidung werden keine Profildaten überschrieben.`;
    message.textContent = introText;
    statusEl.appendChild(message);

    const actions = doc.createElement('div');
    actions.className = 'profile-row recovery-actions';
    statusEl.appendChild(actions);

    if (recovery.status === 'unavailable' || recovery.canReset !== true) {
        const retryButton = doc.createElement('button');
        retryButton.type = 'button';
        retryButton.className = 'profile-button secondary ds-button ds-button-secondary';
        retryButton.textContent = 'Erneut versuchen';
        retryButton.dataset.profileRecoveryAction = 'retry';
        retryButton.addEventListener('click', async () => {
            if (retryButton.disabled) return;
            retryButton.disabled = true;
            let navigated = false;
            try {
                navigated = await reloadGuardedPage({ doc, win, opener: retryButton, flush: flushProfileWrites });
            } catch (error) {
                message.textContent = `Erneuter Profilstart fehlgeschlagen. Bitte erneut versuchen. ${error?.message || ''}`.trim();
            } finally { if (!navigated) retryButton.disabled = false; }
        });
        actions.appendChild(retryButton);
        return;
    }

    let exportedDocument = null;
    let resetApplied = false;
    const exportButton = doc.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'profile-button secondary ds-button ds-button-secondary';
    exportButton.textContent = 'Export / Recovery';
    exportButton.dataset.profileRecoveryAction = 'export';

    const resetButton = doc.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'profile-button danger ds-button ds-button-danger';
    resetButton.textContent = 'Bestätigt zurücksetzen';
    resetButton.dataset.profileRecoveryAction = 'reset';
    resetButton.disabled = true;

    exportButton.addEventListener('click', async () => {
        if (exportButton.disabled) return;
        // SD-1: In der Desktop-App wartet der Export auf den Dialog „Speichern unter“; erst eine gespeicherte Datei gibt den Reset frei.
        exportButton.disabled = true;
        resetButton.disabled = true;
        try {
            const recoveryDocument = createProfileRecoveryDocument(recovery, {
                backend: PersistenceFacade.getPersistenceStatus()?.backend || 'unknown'
            });
            const saved = await downloadJsonFile(recoveryDocument, createRecoveryFilename(), doc);
            if (!saved.saved) {
                message.textContent = `${introText} ${SAVE_CANCELLED_TEXT}`;
                resetButton.disabled = !exportedDocument;
                return;
            }
            exportedDocument = recoveryDocument;
            exportButton.textContent = 'Recovery exportiert';
            if (saved.path) message.textContent = `${introText} Recovery-Datei gespeichert unter ${saved.path}.`;
            resetButton.disabled = false;
        } catch (error) {
            exportedDocument = null;
            resetButton.disabled = true;
            message.textContent = `Der Recovery-Export ist fehlgeschlagen. ${error?.message || ''}`.trim();
        } finally {
            exportButton.disabled = false;
        }
    });

    resetButton.addEventListener('click', async () => {
        if (!exportedDocument || resetButton.disabled) return;
        resetButton.disabled = true;
        exportButton.disabled = true;
        let navigated = false;
        try {
            if (!await requestPageConfirmation({ doc, opener: resetButton,
                title: 'Profilbereich zurücksetzen', confirmLabel: 'Profilbereich zurücksetzen', danger: true,
                description: 'Betroffenen Profilbereich wirklich zurücksetzen?\n\nDer beschädigte Rohinhalt wurde zuvor als Recovery-Datei exportiert. Prüfe die Datei, bevor Du fortfährst.'
            })) return;
            if (statusEl.isConnected === false) return;
            navigated = await reloadGuardedPage({ doc, win, opener: resetButton,
                mutate: () => {
                    // Nach einem Flushfehler nur den bereits ausgeführten Reset
                    // bestätigen; den alten Rohinhalt nicht erneut voraussetzen.
                    if (resetApplied) return;
                    resetProfileRecovery(recovery, { recoveryDocument: exportedDocument, confirmed: true });
                    resetApplied = true;
                },
                flush: flushProfileWrites
            });
        } catch (error) {
            message.textContent = `Profil-Recovery konnte nicht dauerhaft abgeschlossen werden. Bitte erneut versuchen. ${error?.message || ''}`.trim();
        } finally {
            if (!navigated) { resetButton.disabled = false; exportButton.disabled = false; resetButton.focus?.(); }
        }
    });

    actions.appendChild(exportButton);
    actions.appendChild(resetButton);
}
