/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */
import { exportProfilesBundle as exportProfilesBundleFromIo, exportProfilesBundleToWindowName as exportProfilesBundleToWindowNameFromIo, importProfilesBundle as importProfilesBundleFromIo, importProfilesBundleFromWindowName as importProfilesBundleFromWindowNameFromIo } from '../profile-bundle-io.js';
import { saveCurrentProfileFromLocalStorage, loadProfileIntoLocalStorage } from './live-storage.js';

export function exportProfilesBundle() {
    return exportProfilesBundleFromIo({
        saveCurrentProfile: saveCurrentProfileFromLocalStorage
    });
}

export function exportProfilesBundleToWindowName() {
    return exportProfilesBundleToWindowNameFromIo({
        saveCurrentProfile: saveCurrentProfileFromLocalStorage
    });
}

/**
 * @param {unknown} bundle
 */
export function importProfilesBundle(bundle) {
    return importProfilesBundleFromIo(bundle, {
        loadProfileIntoLocalStorage
    });
}

export function importProfilesBundleFromWindowName() {
    return importProfilesBundleFromWindowNameFromIo({
        loadProfileIntoLocalStorage
    });
}
