// @ts-check

import {
    listProfiles,
    getCurrentProfileId,
    getProfileMeta,
    switchProfile,
    saveCurrentProfileFromLocalStorage,
    getLastProfileBootstrapResult,
    getProfileRecoveryFromError
} from './profile-storage.js';
import { applyProfileManagementAction, confirmProfileDeletion } from './profile-manager-bindings.js';
import { syncSelectionText } from '../shared/designsystem-selection-text.js';
import { renderSuiteProfile } from '../shared/suite-frame.js';
import { initProfileIndexLifecycle } from './profile-navigation.js';
import { renderProfileRecovery } from './profile-recovery-ui.js';
import { PersistenceFacade, init as initPersistence } from '../shared/persistence-facade.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';

async function flushProfileWrites() {
    if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
}

function byId(id) {
    return document.getElementById(id);
}

function renderProfiles(selectEl, activeId) {
    const profiles = listProfiles();
    selectEl.innerHTML = '';
    profiles.forEach(meta => {
        const option = document.createElement('option');
        option.value = meta.id;
        option.textContent = meta.name || meta.id;
        if (meta.id === activeId) option.selected = true;
        selectEl.appendChild(option);
    });
    syncSelectionText(selectEl);
}

function updateActiveBadge(badgeEl, activeId) {
    const meta = getProfileMeta(activeId);
    const name = meta?.name || activeId;
    const updatedAt = meta?.updatedAt ? new Date(meta.updatedAt).toLocaleString('de-DE') : 'unbekannt';
    badgeEl.textContent = `Aktiv: ${name} (zuletzt: ${updatedAt})`;
}

function setStatus(statusEl, message, kind = '') {
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
}

document.addEventListener('DOMContentLoaded', async () => {
    await initPersistence();

    const profileSelect = byId('profileSelect');
    const profileNameInput = byId('profileNameInput');
    const createBtn = byId('profileCreateBtn');
    const renameBtn = byId('profileRenameBtn');
    const deleteBtn = byId('profileDeleteBtn');
    const saveBtn = byId('profileSaveBtn');
    const activeBadge = byId('activeProfileBadge');
    const statusEl = byId('profileStatus');
    let isSwitching = false, deletionPending = false;
    const writes = createNavigationOperationLifecycle({ guard: getPageNavigationGuard(), message: 'Profildaten werden geschrieben – bitte warten.' });
    const writeProfile = (execute, complete, failed) => writes.run({}, async operation => {
        operation.commit();
        try {
            const result = execute();
            if (result !== false) await flushProfileWrites();
            complete(result);
        } catch (error) { failed(error); }
    });

    if (!profileSelect || !profileNameInput || !createBtn || !renameBtn || !deleteBtn || !activeBadge || !statusEl) {
        return;
    }

    const profileControls = [
        profileSelect,
        profileNameInput,
        createBtn,
        renameBtn,
        deleteBtn,
        saveBtn
    ];
    await initProfileIndexLifecycle();
    const bootstrapResult = getLastProfileBootstrapResult();
    if (bootstrapResult?.action === 'recovery' && bootstrapResult.recovery) {
        renderProfileRecovery({
            statusEl,
            recovery: bootstrapResult.recovery,
            controls: profileControls
        });
        return;
    }

    const refresh = () => {
        const activeId = getCurrentProfileId();
        renderProfiles(profileSelect, activeId);
        updateActiveBadge(activeBadge, activeId);
        renderSuiteProfile(document);
    };

    refresh();

    const failProfileWrite = (error, message) => {
        const recovery = getProfileRecoveryFromError(error);
        if (recovery) {
            renderProfileRecovery({ statusEl, recovery, controls: profileControls });
            return;
        }
        setStatus(statusEl, `${message} ${error?.message || ''}`.trim(), 'error');
    };

    profileSelect.addEventListener('change', async () => {
        if (deletionPending || isSwitching || writes.isBlocked()) {
            refresh();
            return;
        }
        const selectedId = profileSelect.value;
        if (!selectedId) return;
        isSwitching = true;
        setStatus(statusEl, '');
        try {
            await writeProfile(() => {
                const ok = switchProfile(selectedId);
                if (ok) refresh();
                return ok;
            }, ok => {
                setStatus(statusEl, ok ? 'Profil gewechselt und geladen.' : 'Profil konnte nicht geladen werden.', ok ? 'ok' : 'error');
            }, error => failProfileWrite(error, 'Profil konnte nicht geladen werden.'));
        } finally {
            isSwitching = false;
        }
    });

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            if (deletionPending || writes.isBlocked()) return;
            await writeProfile(saveCurrentProfileFromLocalStorage, ok => {
                if (ok) {
                    refresh();
                    setStatus(statusEl, 'Aktuelles Profil gespeichert.', 'ok');
                } else {
                    setStatus(statusEl, 'Speichern fehlgeschlagen.', 'error');
                }
            }, error => failProfileWrite(error, 'Speichern fehlgeschlagen.'));
        });
    }

    createBtn.addEventListener('click', async () => {
        if (deletionPending || writes.isBlocked()) return;
        const name = profileNameInput.value.trim();
        if (!name) {
            setStatus(statusEl, 'Bitte einen Profilnamen eingeben.', 'error');
            return;
        }
        await writeProfile(() => {
            applyProfileManagementAction({ kind: 'create', name });
            profileNameInput.value = '';
            refresh();
        }, () => {
            setStatus(statusEl, 'Neues Profil erstellt und aktiviert.', 'ok');
        }, error => failProfileWrite(error, 'Profil konnte nicht erstellt werden.'));
    });

    renameBtn.addEventListener('click', async () => {
        if (deletionPending || writes.isBlocked()) return;
        const name = profileNameInput.value.trim();
        if (!name) {
            setStatus(statusEl, 'Bitte neuen Namen eingeben.', 'error');
            return;
        }
        await writeProfile(() => {
            const meta = applyProfileManagementAction({ kind: 'rename', profileId: getCurrentProfileId(), name });
            profileNameInput.value = '';
            refresh();
            return meta;
        }, meta => {
            if (meta) {
                setStatus(statusEl, 'Profil umbenannt.', 'ok');
            } else {
                setStatus(statusEl, 'Umbenennen fehlgeschlagen.', 'error');
            }
        }, error => failProfileWrite(error, 'Umbenennen fehlgeschlagen.'));
    });

    deleteBtn.addEventListener('click', async () => {
        if (deletionPending || writes.isBlocked()) return;
        const selectedId = profileSelect.value;
        if (!selectedId) return;
        deletionPending = true;
        try {
            if (!await writes.run({}, operation => confirmProfileDeletion(selectedId, undefined, { doc: document, opener: deleteBtn, signal: operation.controller.signal }))) return;
            if (profileSelect.value !== selectedId || isSwitching || writes.isBlocked()) return;
        } catch (error) { setStatus(statusEl, error.message, 'error'); return; }
        finally { deletionPending = false; }
        await writeProfile(() => {
            const ok = applyProfileManagementAction({ kind: 'delete', profileId: selectedId });
            if (ok) refresh();
            return ok;
        }, ok => {
            if (ok) {
                setStatus(statusEl, 'Profil geloescht.', 'ok');
            } else {
                setStatus(statusEl, 'Loeschen fehlgeschlagen.', 'error');
            }
        }, error => failProfileWrite(error, 'Loeschen fehlgeschlagen.'));
    });
});
