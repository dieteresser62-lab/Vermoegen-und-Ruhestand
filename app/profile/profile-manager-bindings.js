// @ts-check
import { requestPageConfirmation } from '../shared/page-dialog.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { PROFILE_STORAGE_KEYS } from './profile-state.js';
import { createProfile, renameProfile, deleteProfile, switchProfile, listProfiles,
    getProfileMeta, setProfileVerbundMembership } from './profile-storage.js';

/** Gemeinsame Namensprüfung für Startseite und Manager; keine Speicherung. */
export function validateProfileName(name) {
    const value = String(name || '').trim();
    if (!value) throw new Error('Bitte einen Profilnamen eingeben.');
    return value;
}

/** Gemeinsamer Defaultschutz und ausdrückliche Löschbestätigung. */
export async function confirmProfileDeletion(profileId, ask, options = {}) {
    if (profileId === 'default' && listProfiles().length <= 1) {
        throw new Error('Das Default-Profil kannst Du erst löschen, wenn ein weiteres Profil existiert.');
    }
    const name = getProfileMeta(profileId)?.name || profileId;
    const registry = persistenceStorage.getItem(PROFILE_STORAGE_KEYS.registry);
    const current = persistenceStorage.getItem(PROFILE_STORAGE_KEYS.current);
    const active = persistenceStorage.getItem(PROFILE_STORAGE_KEYS.active);
    const description = `Profil „${name}“ wirklich löschen? Dies kann nicht rückgängig gemacht werden.`;
    const confirmed = await (ask ? ask(description) : requestPageConfirmation({
        title: 'Profil löschen', description, confirmLabel: 'Profil löschen', danger: true, ...options
    }));
    return confirmed === true && !options.signal?.aborted && registry === persistenceStorage.getItem(PROFILE_STORAGE_KEYS.registry)
        && current === persistenceStorage.getItem(PROFILE_STORAGE_KEYS.current)
        && active === persistenceStorage.getItem(PROFILE_STORAGE_KEYS.active);
}

/** Aufrufer besitzt Autosaveabschluss, Navigationsschutz, Flush und Recovery. */
export function applyProfileManagementAction({ kind, profileId, name, belongs }) {
    if (kind === 'create') {
        const meta = createProfile(validateProfileName(name));
        if (!switchProfile(meta.id)) throw new Error('PROFILE_SWITCH_FAILED');
        return meta;
    }
    if (kind === 'rename') return renameProfile(profileId, validateProfileName(name));
    if (kind === 'delete') return deleteProfile(profileId);
    if (kind === 'membership') return setProfileVerbundMembership(profileId, belongs);
    throw new Error('PROFILE_ACTION_INVALID');
}
