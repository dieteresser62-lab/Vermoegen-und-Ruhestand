import * as facade from '../app/profile/profile-storage.js';
import * as ownership from '../app/profile/profile-storage/balance-ownership.js';
import * as liveBase from '../app/profile/profile-storage/live-base.js';
import * as access from '../app/profile/profile-storage/storage-access.js';
import * as guards from '../app/profile/profile-storage/load-guards.js';
import * as registry from '../app/profile/profile-storage/registry-context.js';
import * as liveStorage from '../app/profile/profile-storage/live-storage.js';
import * as selection from '../app/profile/profile-storage/profile-selection.js';
import * as bundles from '../app/profile/profile-storage/bundle-transfer.js';
import * as documents from '../app/profile/profile-storage/recovery-document.js';
import * as bootstrap from '../app/profile/profile-storage/bootstrap-recovery.js';
import { hasProfileScopedDataInLocalStorage } from '../app/profile/profile-live-storage.js';

// Jede öffentliche Bindung muss dasselbe Objekt wie am Definitionsort liefern.
const expected = {
    HOUSEHOLD_OWNED_BALANCE_STATE_KEYS: ownership.HOUSEHOLD_OWNED_BALANCE_STATE_KEYS,
    createProfileOwnedBalanceState: ownership.createProfileOwnedBalanceState,
    mergeProfileLiveData: ownership.mergeProfileLiveData,
    PROFILE_LIVE_BASE_KEY: liveBase.PROFILE_LIVE_BASE_KEY,
    profileLiveBaseRecord: liveBase.profileLiveBaseRecord,
    trackCurrentProfileLiveBase: liveBase.trackCurrentProfileLiveBase,
    ProfileRecoveryError: access.ProfileRecoveryError,
    assertProfileIdentityRecords: guards.assertProfileIdentityRecords,
    assertProfileDataLoadable: guards.assertProfileDataLoadable,
    getProfileRecoveryFromError: guards.getProfileRecoveryFromError,
    assertProfileContextReady: registry.assertProfileContextReady,
    getCurrentProfileId: registry.getCurrentProfileId,
    setCurrentProfileId: registry.setCurrentProfileId,
    listProfiles: registry.listProfiles,
    getProfileMeta: registry.getProfileMeta,
    getProfileData: registry.getProfileData,
    createProfile: registry.createProfile,
    renameProfile: registry.renameProfile,
    setProfileVerbundMembership: registry.setProfileVerbundMembership,
    updateProfileData: registry.updateProfileData,
    getActiveProfileId: registry.getActiveProfileId,
    ensureProfileRegistry: registry.ensureProfileRegistry,
    saveCurrentProfileFromLocalStorage: liveStorage.saveCurrentProfileFromLocalStorage,
    loadProfileIntoLocalStorage: liveStorage.loadProfileIntoLocalStorage,
    patchInactiveProfileQuotes: liveStorage.patchInactiveProfileQuotes,
    deleteProfile: selection.deleteProfile,
    switchProfile: selection.switchProfile,
    exportProfilesBundle: bundles.exportProfilesBundle,
    exportProfilesBundleToWindowName: bundles.exportProfilesBundleToWindowName,
    importProfilesBundle: bundles.importProfilesBundle,
    importProfilesBundleFromWindowName: bundles.importProfilesBundleFromWindowName,
    PROFILE_RECOVERY_SCHEMA: documents.PROFILE_RECOVERY_SCHEMA,
    PROFILE_RECOVERY_SCHEMA_VERSION: documents.PROFILE_RECOVERY_SCHEMA_VERSION,
    createProfileRecoveryDocument: documents.createProfileRecoveryDocument,
    getLastProfileBootstrapResult: bootstrap.getLastProfileBootstrapResult,
    bootstrapProfileContext: bootstrap.bootstrapProfileContext,
    resetProfileRecovery: bootstrap.resetProfileRecovery,
    hasProfileScopedDataInLocalStorage
};
assertEqual(JSON.stringify(Object.keys(facade).sort()), JSON.stringify(Object.keys(expected).sort()),
    'Fassade erhält alle 38 öffentlichen Namen und lässt interne Helfer privat');
for (const [name, value] of Object.entries(expected)) {
    assert(facade[name] === value, `${name}: Re-Export erhält dieselbe Bindung`);
}
assert(Object.isFrozen(facade.HOUSEHOLD_OWNED_BALANCE_STATE_KEYS), 'Schlüsselbesitz bleibt eingefroren');
try {
    guards.assertProfileIdentityRecords({ version: 1, profiles: {} }, 'ghost', null);
    assert(false, 'Identitätsfehler muss eine Recovery auslösen');
} catch (error) {
    assert(error instanceof facade.ProfileRecoveryError, 'Direkte Prüfung wirft dieselbe öffentliche Fehlerklasse');
    assert(guards.getProfileRecoveryFromError(error) === error.recovery,
        'Fehlerprüfung erhält dieselbe Recoveryreferenz');
}
