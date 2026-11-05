/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */
import { deleteProfile as deleteProfileFromRegistry } from '../profile-registry.js';
import { captureProfileData } from './balance-ownership.js';
import { assertProfileDataLoadable } from './load-guards.js';
import { getRegistryContextSnapshot, assertProfileContextReady, getCurrentProfileId, setCurrentProfileId } from './registry-context.js';
import { saveCurrentProfileFromLocalStorage, loadProfileIntoLocalStorage } from './live-storage.js';

/**
 * @param {string} id
 */
export function deleteProfile(id) {
    const { registry, currentId, activeId } = assertProfileContextReady();
    if (!registry.profiles[id]) return false;
    const remainingIds = Object.keys(registry.profiles).filter(profileId => profileId !== id);
    if (!remainingIds.length) {
        const deleted = deleteProfileFromRegistry(id, { captureProfileData });
        if (!deleted) return false;
        const fallbackId = /** @type {(storage?: D.RecordReader) => string} */ (getCurrentProfileId)();
        if (!loadProfileIntoLocalStorage(fallbackId)) return false;
        setCurrentProfileId(fallbackId);
        return true;
    }
    if (id === currentId || id === activeId) {
        const fallbackId = remainingIds.includes('default') ? 'default' : remainingIds[0];
        if (!loadProfileIntoLocalStorage(fallbackId)) return false;
        setCurrentProfileId(fallbackId);
    }
    return deleteProfileFromRegistry(id, { captureProfileData });
}

/**
 * @param {string} id
 */
export function switchProfile(id) {
    const current = /** @type {(storage?: D.RecordReader) => string} */ (getCurrentProfileId)();
    const { registry, registryRaw } = getRegistryContextSnapshot();
    const target = registry.profiles[id];
    if (!target) return false;
    assertProfileDataLoadable(id, target, { registryRaw });
    if (current === id) return true;
    if (!saveCurrentProfileFromLocalStorage()) return false;
    const loaded = loadProfileIntoLocalStorage(id);
    if (!loaded) return false;
    try {
        setCurrentProfileId(id);
        return true;
    } catch (error) {
        try {
            loadProfileIntoLocalStorage(current);
            setCurrentProfileId(current);
        } catch {
            // Der geworfene Fehler behaelt den urspruenglichen fehlgeschlagenen Wechsel.
        }
        throw error;
    }
}
