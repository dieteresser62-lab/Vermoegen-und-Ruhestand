// @ts-check
import { byId, flushManagerHouseholdPlan, managerInputSignature, showProfileValidationStatus, flushManagerRecords, restoreManagerRecords } from './helpers.js';
import { renderProfileRecovery } from '../../profile/profile-recovery-ui.js';
import { PROFILE_INPUT_IDS, state } from './state.js';
import { setManagerControlsBlocked, processingIsBlocked } from './controls.js';
import { renderPersistenceState } from './persistence-status.js';
import { validateProfileName, confirmProfileDeletion, confirmUnchangedProfileContext, validateProfileManagementAction, applyProfileManagementAction } from '../../profile/profile-manager-bindings.js';
import { runManagerOperation } from './history.js';
import { requestPageConfirmation } from '../../shared/page-dialog.js';
import { getProbelaufController } from '../../shared/probelauf-state.js';
import { PROBELAUF_RESTORE_HINT } from '../../shared/probelauf-runtime.js';
import { scheduleProfileValuesSave, saveProfileValues } from './profile-values.js';
import { readProfileAssetValuesFromDom, ProfileAssetValuesValidationError } from '../../profile/profile-asset-values.js';
import { getPageNavigationGuard } from '../../shared/navigation-guard-dialog.js';
import { captureProfileData } from '../../profile/profile-live-storage.js';
import { PROFILE_STORAGE_KEYS } from '../../profile/profile-state.js';
import { PROFILE_LIVE_BASE_KEY, getProfileMeta, getCurrentProfileId, getProfileRecoveryFromError, switchProfile } from '../../profile/profile-storage.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { createProfileManagementRecovery } from '../../profile/profile-management-recovery.js';
import { closeTrancheModal, closeCashPostingModal, closeManagerAuxiliaryDialog, confirmManagerModalBaseline } from '../tranchen-manager-modal.js';
import { clearReconciliationPreview } from './reconciliation.js';
import { renderManagerView, getManagerView } from '../tranchen-manager-renderer.js';
import { refreshManagerProfiles, renderManagerPeople } from '../tranchen-manager-profiles.js';
import { renderSuiteProfile } from '../../shared/suite-frame.js';
import { listProfileScopedKeys } from '../../profile/profile-key-policy.js';
import { updateActiveProfileLabel } from './rendering.js';

export function showManagerProfileRecovery(recovery) {
    const statusEl = byId('managerProfileRecovery');
    if (!statusEl) return;
    statusEl.hidden = false;
    renderProfileRecovery({ statusEl, recovery, controls: PROFILE_INPUT_IDS.map(byId) });
    setManagerControlsBlocked(true);
}

/** Verwaltung schreibt erst nach abgeschlossenem Autosave und Verwerfentscheidung. */
export async function manageManagerPerson(request) {
    if (processingIsBlocked()) return false;
    if (!await flushManagerHouseholdPlan()) return false;
    state.personManagementPending = true;
    try { return await executeManagerPerson({ ...request }); }
    finally { state.personManagementPending = false; renderPersistenceState(); }
}

export async function executeManagerPerson(request) {
    const originDocument = document, originProfile = state.profileId;
    const status = byId('managerPeopleStatus');
    const message = (text, kind = '') => { if (status) { status.textContent = text; status.dataset.kind = kind; } };
    try {
        if (['create', 'rename'].includes(request.kind)) request = { ...request, name: validateProfileName(request.name) };
        if (['delete', 'membership'].includes(request.kind)) {
            const autosavePaused = state.profileSaveTimer !== null;
            if (autosavePaused) clearTimeout(state.profileSaveTimer);
            state.profileSaveTimer = null;
            const origin = state.profileId, doc = document;
            let confirmed = false;
            try {
                confirmed = await runManagerOperation(operation => request.kind === 'delete'
                    ? confirmProfileDeletion(request.profileId, undefined, { doc, signal: operation.controller.signal, opener: doc.activeElement })
                    : confirmUnchangedProfileContext(() => requestPageConfirmation({ doc, signal: operation.controller.signal, opener: doc.activeElement,
                        title: 'Haushalt ändern', confirmLabel: 'Haushalt ändern',
                        description: 'Zugehörigkeit zum Haushalt ändern? ' + (getProbelaufController(doc)?.state ? PROBELAUF_RESTORE_HINT : 'Vorher wird der Wiederherstellungspunkt „Vor dem Ändern des Haushalts“ angelegt; der bisherige Haushalt ist über Daten & Sicherung zurückholbar.') + ' Partnerschaft, Testament, gemeinsamer Plan und gemeinsame Ausgaben bleiben eingetragen und müssen danach angepasst werden.' }), { signal: operation.controller.signal }));
                if (!confirmed || state.profileId !== origin || document !== doc || state.boundDocument !== doc) return false;
            } finally {
                // Abgelehnte Löschung verwirft keine bereits eingegebenen Profilwerte.
                // Nach einem Kontextwechsel darf der alte Entwurf kein fremdes Profil speichern.
                if (!confirmed && autosavePaused && state.profileId === origin && document === doc && state.boundDocument === doc) {
                    scheduleProfileValuesSave({ resumePaused: true });
                }
            }
        }
        const values = readProfileAssetValuesFromDom();
        if (state.profileSaveTimer !== null) clearTimeout(state.profileSaveTimer);
        state.profileSaveTimer = null;
        if (state.pendingProfileValues || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline) {
            if (!await saveProfileValues(state.pendingProfileValues || values)) {
                message('Aktive Profilwerte konnten nicht gespeichert werden.', 'error'); return false;
            }
        }
    } catch (error) {
        message(error.message, 'error');
        if (error instanceof ProfileAssetValuesValidationError) showProfileValidationStatus(error);
        return false;
    }
    const guard = getPageNavigationGuard(document);
    if (guard.isBusy()) return false;
    setManagerControlsBlocked(true);
    let attempt;
    try {
        // Der Name gehört zum Verwaltungsauftrag, nicht zu den zu verwerfenden Finanzentwürfen.
        const owners = guard.reasons().map(reason => reason.owner).filter(owner => owner !== 'manager-dialog-people');
        attempt = await guard.prepare({ owners, opener: document.activeElement, intent: 'discard' });
        if (!attempt || !guard.validate(attempt)) return false;
        guard.end(attempt); attempt = null;
        return await runManagerOperation(async operation => {
            operation.check();
            if (document !== originDocument || state.profileId !== originProfile) return false;
            operation.commit();
            const origin = state.profileId;
            const previous = new Map(Object.entries(captureProfileData()));
            for (const key of [...Object.values(PROFILE_STORAGE_KEYS), PROFILE_LIVE_BASE_KEY]) previous.set(key, persistenceStorage.getItem(key));
            let confirmed = false;
            try {
                if (['delete', 'membership'].includes(request.kind)) {
                    const expectedRecords = validateProfileManagementAction(request);
                    const label = request.kind === 'delete' ? `Vor dem Löschen von ${getProfileMeta(request.profileId)?.name || request.profileId}` : 'Vor dem Ändern des Haushalts';
                    await createProfileManagementRecovery(label, { navigationOperation: operation, expectedRecords });
                }
                const result = applyProfileManagementAction(request);
                if (!result) throw new Error('Profilverwaltung konnte nicht angewendet werden.');
                await flushManagerRecords(); confirmed = true;
                closeTrancheModal(document, { confirmed: true, navigationOperation: operation });
                closeCashPostingModal(document, { confirmed: true, navigationOperation: operation });
                closeManagerAuxiliaryDialog('sale', document, { confirmed: true, navigationOperation: operation });
                clearReconciliationPreview({ resetForm: true, navigationOperation: operation });
                state.initializePage({ profileId: getCurrentProfileId() });
                renderManagerView(document, { ...getManagerView(document), kind: request.kind === 'create' ? 'person' : getManagerView(document)?.kind || 'person', profileId: state.profileId });
                refreshManagerProfiles(document, state.profileId);
                renderSuiteProfile(document);
                renderManagerPeople(document, state.profileId);
                confirmManagerModalBaseline('people', document);
                message('Personenverwaltung dauerhaft gespeichert.', 'ok');
                return true;
            } catch (error) {
                if (!confirmed) {
                    for (const key of listProfileScopedKeys()) if (!previous.has(key)) previous.set(key, null);
                    const restored = await restoreManagerRecords(previous);
                    updateActiveProfileLabel(origin);
                    renderSuiteProfile(document);
                    if (!restored) showManagerProfileRecovery({ status: 'unavailable', canReset: false,
                        message: 'Personenverwaltung und Rückschreiben konnten nicht dauerhaft bestätigt werden.' });
                } else showManagerProfileRecovery({ status: 'unavailable', canReset: false,
                    message: 'Personenverwaltung gespeichert; die Ansicht konnte nicht erneuert werden. Bitte neu laden.' });
                const recovery = getProfileRecoveryFromError(error);
                if (recovery) showManagerProfileRecovery(recovery);
                message(`Personenverwaltung fehlgeschlagen. ${error.message}`, 'error');
                return false;
            }
        });
    } finally {
        if (attempt) guard.end(attempt);
        renderPersistenceState();
    }
}

/** Vor der Verlustentscheidung steht der bestätigte Abschluss des Profilautosaves. */
export async function switchManagerProfile(profileId, opener) {
    if (!profileId || profileId === state.profileId) return false;
    if (byId('managerProfileRecovery')?.hidden === false) return false;
    const guard = getPageNavigationGuard(document);
    if (guard.isBusy() || guard.reasons().some(reason => reason.phase === 'commit')) return false;
    if (!await flushManagerHouseholdPlan()) return false;
    let values;
    try { values = readProfileAssetValuesFromDom(); }
    catch (error) { showProfileValidationStatus(error); return false; }
    if (state.profileSaveTimer !== null) clearTimeout(state.profileSaveTimer);
    state.profileSaveTimer = null;
    // Während Kursvorbereitung sind Profilfelder gesperrt. Ein unveränderter
    // Profilstand braucht keinen konkurrierenden Saver; guard beendet den Kursjob.
    if (state.pendingProfileValues || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline) {
        if (!await saveProfileValues(state.pendingProfileValues || values)) return false;
    }
    const origin = state.profileId;
    /** @type {Map<string, string> | null} */
    let previous = null;
    let confirmed = false;
    let loaded = false;
    try {
        setManagerControlsBlocked(true);
        const outcome = await guard.reload({ opener, returnResult: true,
            mutate: () => {
                previous = new Map(Object.entries(captureProfileData()));
                for (const key of [...Object.values(PROFILE_STORAGE_KEYS), PROFILE_LIVE_BASE_KEY]) previous.set(key, persistenceStorage.getItem(key));
                if (!switchProfile(profileId)) throw new Error('PROFILE_SWITCH_FAILED');
            },
            flush: async () => { await flushManagerRecords(); confirmed = true; },
            reload: () => {
                // In-place-Wechsel: die Navigationsreservierung endet synchron
                // nach Flush, bevor neue Baselines und Dialogprovider entstehen.
                guard.revokeNative();
                closeTrancheModal(document, { confirmed: true });
                closeCashPostingModal(document, { confirmed: true });
                closeManagerAuxiliaryDialog('sale', document, { confirmed: true });
                closeManagerAuxiliaryDialog('people', document, { confirmed: true });
                clearReconciliationPreview({ resetForm: true });
                state.initializePage({ profileId });
                renderSuiteProfile(document);
                loaded = true;

            }
        });
        if (outcome.error) throw outcome.error;
        if (outcome.status === 'reload_required' && confirmed) {
            showManagerProfileRecovery({ status: 'unavailable', canReset: false,
                message: 'Profilwechsel gespeichert; die Ansicht konnte nicht erneuert werden. Bitte neu laden.' });
        }
        if (outcome.status === 'reloaded') {
            renderManagerView(document, { kind: 'person', profileId });
            refreshManagerProfiles(document, profileId);
            /** @type {HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null} */ (byId('managerSectionNav')?.querySelector?.('[aria-selected="true"]'))?.focus?.();
        }
        return outcome.status === 'reloaded';
    } catch (error) {
        // switchProfile schreibt zunächst den Cache. Ohne bestätigten Flush
        // stellen wir auch Kennungen und alle profilbezogenen Keys zurück.
        if (previous && !confirmed) {
            for (const key of listProfileScopedKeys()) if (!previous.has(key)) previous.set(key, null);
            const restored = await restoreManagerRecords(previous);
            state.persistenceError = restored
                ? 'Person konnte nicht dauerhaft gewechselt werden. Das Ursprungsprofil bleibt geöffnet.'
                : 'Profilwechsel und dauerhaftes Rückschreiben konnten nicht bestätigt werden. Bitte erneut versuchen.';
            if (!restored) showManagerProfileRecovery({ status: 'unavailable', canReset: false, message: state.persistenceError });
            updateActiveProfileLabel(origin);
            renderSuiteProfile(document);
        } else state.persistenceError = 'Person konnte nicht geladen werden. Bitte erneut versuchen.';
        const recovery = getProfileRecoveryFromError(error);
        if (recovery) showManagerProfileRecovery(recovery);
        return false;
    } finally {
        renderPersistenceState();
        if (byId('managerProfileRecovery')?.hidden === false) setManagerControlsBlocked(true);
        else if (!loaded) {
            const targets = /** @type {NodeListOf<HTMLButtonElement>} */ (byId('managerSectionNav')?.querySelectorAll?.('[data-manager-profile]')) || [];
            Array.from(targets).find(button => button.dataset.managerProfile === profileId)?.focus();
        }
    }
}
