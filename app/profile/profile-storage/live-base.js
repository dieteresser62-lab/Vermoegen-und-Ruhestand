/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */
import { persistenceStorage, observeBeforeFlush, getPersistenceStatus, hasSyncWriteBlocks } from '../../shared/persistence-facade.js';
import { loadProfileRegistry } from '../profile-registry.js';
import { isProfileScopedKey } from '../profile-key-policy.js';
import { captureProfileData } from './balance-ownership.js';
import { ACTIVE_PROFILE_KEY, CURRENT_PROFILE_KEY } from './storage-access.js';

export const PROFILE_LIVE_BASE_KEY = 'rs_profile_live_base_v1';

/** @param {D.StringRecords} data */
export const dataIdentity = data => JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));

/** @type {(() => unknown) | undefined} */
let stopLiveBaseObserver;

/**
 * @param {string} id
 * @param {D.StringRecords} data
 * @param {D.StringRecords} liveData
 * @returns {string}
 */
export function profileLiveBaseRecord(id, data, liveData) {
    const saved = dataIdentity(data), live = dataIdentity(liveData);
    return JSON.stringify({ profileId: id, data: saved, ...(live === saved ? {} : { live }) });
}

/**
 * @param {string} id
 * @param {D.StringRecords} data
 * @returns {void}
 */
export function rememberLiveBase(id, data) {
    persistenceStorage.setItem(PROFILE_LIVE_BASE_KEY, profileLiveBaseRecord(id, data, captureProfileData()));
}

/**
 * @param {string} id
 * @param {D.StringRecords} data
 * @returns {void}
 */
export function trackLiveBase(id, data) {
    stopLiveBaseObserver?.();
    const saved = dataIdentity(data), live = dataIdentity(captureProfileData());
    const area = JSON.stringify(getPersistenceStatus().areaControl);
    const base = JSON.stringify({ profileId: id, data: saved, ...(live === saved ? {} : { live }) });
    // Laden bleibt ohne Ladebasis-Write. Erst ein fachlicher Flush derselben
    // Person führt die Herkunft zusammen mit den neuen Livewerten dauerhaft mit.
    stopLiveBaseObserver = observeBeforeFlush(({ dirtyKeys, deletedKeys }) => {
        if (![...dirtyKeys, ...deletedKeys].some(isProfileScopedKey) || hasSyncWriteBlocks()
            || JSON.stringify(getPersistenceStatus().areaControl) !== area
            || persistenceStorage.getItem(CURRENT_PROFILE_KEY) !== id
            || persistenceStorage.getItem(ACTIVE_PROFILE_KEY) !== id) return;
        const current = /** @type {I.LoadRegistry} */ (/** @type {unknown} */ (loadProfileRegistry))(persistenceStorage).value?.profiles[id]?.data;
        if (!current || dataIdentity(current) !== saved || dataIdentity(captureProfileData()) === live) return;
        persistenceStorage.setItem(PROFILE_LIVE_BASE_KEY, base);
    });
}

/** Nach Startmigrationen die lesende Herkunft auf den bestätigten Stand setzen. */
export function trackCurrentProfileLiveBase() {
    const id = /** @type {string} */ (persistenceStorage.getItem(CURRENT_PROFILE_KEY));
    const data = /** @type {I.LoadRegistry} */ (/** @type {unknown} */ (loadProfileRegistry))(persistenceStorage).value?.profiles[id]?.data;
    if (data && persistenceStorage.getItem(ACTIVE_PROFILE_KEY) === id) trackLiveBase(id, data);
}

/**
 * @param {string} id
 * @param {D.StringRecords} savedData
 * @returns {boolean}
 */
export function hasNewerLiveData(id, savedData) {
    // Die Ladebasis belegt die Herkunft auch ohne input/change oder Zeitstempel.
    // Import und Restore ersetzen sie zusammen mit dem zugehörigen Bestand.
    try {
        const base = JSON.parse(/** @type {string} */ (persistenceStorage.getItem(PROFILE_LIVE_BASE_KEY)));
        return base?.profileId === id && base.data === dataIdentity(savedData)
            && dataIdentity(captureProfileData()) !== (base.live ?? base.data);
    } catch {
        console.warn('[ProfileStorage] Livevergleich nicht lesbar; der gespeicherte Personenstand wird geladen.');
        return false;
    }
}
