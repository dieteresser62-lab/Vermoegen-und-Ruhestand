import { CONFIG } from '../app/balance/balance-config.js';
import {
    LEGACY_MIGRATION_MARKER_KEYS,
    isAllowedPersistenceImportKey,
    isAllowedSnapshotCaptureKey,
    isAllowedSnapshotRestoreLiveKey,
    isLegacySnapshotKey,
    isProfileRegistryKey,
    isProfileScopedFixedKey,
    isSnapshotGlobalDomainKey,
    isSnapshotProfileScopedKey,
    isSnapshotTechnicalKey
} from '../app/shared/persistence-key-policy.js';
import { PROFILE_STORAGE_KEYS } from '../app/profile/profile-state.js';

console.log('--- Snapshot Key Policy Tests ---');

const registry = {
    profiles: {
        default: { meta: { name: 'Default' }, data: {} }
    }
};
const HOUSEHOLD_NEEDS_KEY = 'household_simulator_needs_v1';
const HOUSEHOLD_NEEDS_ACK_KEY = 'household_simulator_needs_warning_ack_v1';

console.log('Test 1: capture includes fachliche Live-Daten and excludes snapshot archive data');
{
    assert(isAllowedSnapshotCaptureKey(CONFIG.STORAGE.LS_KEY), 'Capture erlaubt Balance-State');
    assert(isAllowedSnapshotCaptureKey('depot_tranchen'), 'Capture erlaubt Tranchen');
    assert(isAllowedSnapshotCaptureKey('balance_expenses_2026'), 'Capture erlaubt Ausgaben-Rollover-Daten');
    assert(isAllowedSnapshotCaptureKey(PROFILE_STORAGE_KEYS.registry), 'Capture erlaubt Profil-Registry');
    assert(isAllowedSnapshotCaptureKey(PROFILE_STORAGE_KEYS.current), 'Capture erlaubt aktuelles Profil');
    assert(isAllowedSnapshotCaptureKey(HOUSEHOLD_NEEDS_KEY), 'Capture erlaubt den globalen Simulator-Haushaltsbedarf');
    assert(isAllowedSnapshotCaptureKey(HOUSEHOLD_NEEDS_ACK_KEY), 'Capture erlaubt dessen globalen Warnungsmarker');
    assert(isAllowedSnapshotCaptureKey(LEGACY_MIGRATION_MARKER_KEYS.target), 'Capture erlaubt Schema-Migrationsmarker');
    assert(!isAllowedSnapshotCaptureKey(`${CONFIG.STORAGE.SNAPSHOT_PREFIX}2026`), 'Capture schliesst Legacy-Snapshot-Keys aus');
    assert(!isAllowedSnapshotCaptureKey('featureFlags'), 'Capture schliesst technische Feature-Flags aus');
    assert(!isAllowedSnapshotCaptureKey('telemetry_lastRun'), 'Capture schliesst technische Telemetry-Keys aus');
}

console.log('Test 2: key categories are explicit and non-overlapping for important keys');
{
    assert(isLegacySnapshotKey(`${CONFIG.STORAGE.SNAPSHOT_PREFIX}abc`), 'Legacy-Snapshot-Key wird erkannt');
    assert(isProfileRegistryKey(PROFILE_STORAGE_KEYS.registry), 'Profil-Registry-Key wird erkannt');
    assert(isProfileScopedFixedKey('depot_tranchen'), 'Fester profilbezogener Key wird erkannt');
    assert(isSnapshotProfileScopedKey('profile_tagesgeld'), 'Profilbezogener Snapshot-Key wird erkannt');
    assert(isSnapshotGlobalDomainKey(CONFIG.STORAGE.LS_KEY), 'Globaler fachlicher Balance-Key wird erkannt');
    assert(isSnapshotGlobalDomainKey(HOUSEHOLD_NEEDS_KEY), 'Simulator-Haushaltsbedarf wird als globaler Fach-Key erkannt');
    assert(isSnapshotGlobalDomainKey(HOUSEHOLD_NEEDS_ACK_KEY), 'Warnungsmarker wird als globaler Fach-Key erkannt');
    assert(isSnapshotTechnicalKey('featureFlags'), 'Feature-Flags sind technisch');
    assert(isSnapshotTechnicalKey('layout_balance_sidebar'), 'Layout-Key ist technisch');
    assert(!isSnapshotGlobalDomainKey('featureFlags'), 'Technischer Key ist kein globaler Fach-Key');
}

console.log('Test 3: standard restore preserves profile registry and requires existing profile id');
{
    assert(!isAllowedSnapshotRestoreLiveKey(PROFILE_STORAGE_KEYS.registry, {
        mode: 'standard',
        snapshotActiveProfileId: 'default',
        currentRegistry: registry
    }), 'Standard-Restore schreibt Profil-Registry nicht blind zurueck');

    assert(isAllowedSnapshotRestoreLiveKey('depot_tranchen', {
        mode: 'standard',
        snapshotActiveProfileId: 'default',
        currentRegistry: registry
    }), 'Standard-Restore erlaubt Profil-Live-Key bei existierender Profil-ID');

    assert(!isAllowedSnapshotRestoreLiveKey('depot_tranchen', {
        mode: 'standard',
        snapshotActiveProfileId: 'missing',
        currentRegistry: registry
    }), 'Standard-Restore blockiert Profil-Live-Key bei fehlender Profil-ID');

    assert(isAllowedSnapshotRestoreLiveKey(CONFIG.STORAGE.LS_KEY, {
        mode: 'standard',
        snapshotActiveProfileId: 'missing',
        currentRegistry: registry
    }), 'Standard-Restore erlaubt globale fachliche Keys unabhaengig vom Profil');

    assert(isAllowedSnapshotRestoreLiveKey(HOUSEHOLD_NEEDS_KEY, {
        mode: 'standard',
        snapshotActiveProfileId: 'missing',
        currentRegistry: registry
    }), 'Standard-Restore erlaubt den globalen Haushaltsbedarf unabhaengig vom Profil');
    assert(isAllowedSnapshotRestoreLiveKey(HOUSEHOLD_NEEDS_ACK_KEY, {
        mode: 'standard',
        snapshotActiveProfileId: 'missing',
        currentRegistry: registry
    }), 'Standard-Restore erlaubt den globalen Warnungsmarker unabhaengig vom Profil');
}

console.log('Test 4: restore keeps technical keys and legacy snapshot history untouched');
{
    assert(!isAllowedSnapshotRestoreLiveKey('featureFlags', {
        mode: 'standard',
        snapshotActiveProfileId: 'default',
        currentRegistry: registry
    }), 'Restore erhaelt technische Feature-Flags');
    assert(!isAllowedSnapshotRestoreLiveKey('ui_panel_state', {
        mode: 'standard',
        snapshotActiveProfileId: 'default',
        currentRegistry: registry
    }), 'Restore erhaelt technischen UI-Zustand');
    assert(!isAllowedSnapshotRestoreLiveKey(`${CONFIG.STORAGE.SNAPSHOT_PREFIX}old`, {
        mode: 'standard',
        snapshotActiveProfileId: 'default',
        currentRegistry: registry
    }), 'Restore loescht oder ueberschreibt keine Legacy-Snapshot-Historie');
}

console.log('Test 5: full restore is explicit and still excludes technical keys');
{
    assert(isAllowedSnapshotRestoreLiveKey(PROFILE_STORAGE_KEYS.registry, {
        mode: 'full',
        snapshotActiveProfileId: 'default',
        currentRegistry: registry
    }), 'Full-Restore darf Profil-Registry explizit schreiben');
    assert(!isAllowedSnapshotRestoreLiveKey('enableWorkerTelemetry', {
        mode: 'full',
        snapshotActiveProfileId: 'default',
        currentRegistry: registry
    }), 'Full-Restore schreibt technische Telemetry-Schalter nicht automatisch');
}

console.log('P10c: Vollimport und Snapshotwege behalten unterschiedliche Live-Keyverträge');
for (const key of ['ruhestandsmodell_snapshot_2026-01-20T11:48:21.709Z--Muster A',
    'featureFlags', 'enableWorkerTelemetry', 'sim.stressReplay.active.v1']) {
    assert(isAllowedPersistenceImportKey(key), 'Vollimport erlaubt seinen Legacy-/Exactkey weiterhin: ' + key);
    assert(!isAllowedSnapshotCaptureKey(key), 'Snapshotcapture schließt historischen Livekey aus: ' + key);
    for (const mode of ['standard', 'full']) {
        assert(!isAllowedSnapshotRestoreLiveKey(key, { mode, snapshotActiveProfileId: 'default', currentRegistry: registry }),
            'Snapshotrestore schließt Livekey in beiden Modi aus: ' + mode + '/' + key);
    }
}
for (const key of ['ui_panel_state', 'layout_person_panel']) {
    assert(isSnapshotTechnicalKey(key), 'Historische technische Registrybeigabe wird zentral erkannt: ' + key);
    assert(!isAllowedPersistenceImportKey(key), 'Technische Registrybeigabe erweitert Top-Level-Importpolicy nicht: ' + key);
}

console.log('--- Snapshot Key Policy Tests Completed ---');

assert(isProfileScopedFixedKey('overview_simulation_summary_v1'), 'Simulationsergebnis ist fester profilbezogener Schlüssel');
assert(isAllowedSnapshotCaptureKey('overview_simulation_summary_v1'), 'Fachlicher Snapshot erfasst Simulationssummary');
assert(isAllowedSnapshotRestoreLiveKey('overview_simulation_summary_v1', { currentRegistry: { profiles: { a: {} } }, snapshotActiveProfileId: 'a' }), 'Snapshot stellt Summary nur im passenden Profil wieder her');
assert(!isAllowedSnapshotRestoreLiveKey('overview_simulation_summary_v1', { currentRegistry: { profiles: { b: {} } }, snapshotActiveProfileId: 'a' }), 'Fremdes fehlendes Snapshotprofil lädt kein Simulationsergebnis');

{
    const { PROBELAUF_STATE_KEY, isProbelaufRecordKey } = await import('../app/shared/persistence-key-policy.js');
    assert(!isAllowedPersistenceImportKey(PROBELAUF_STATE_KEY), 'Steuerkey ist kein allgemeiner Importkey');
    assert(!isAllowedSnapshotCaptureKey(PROBELAUF_STATE_KEY), 'Steuerkey ist kein fachlicher Snapshotrecord');
    assert(!isAllowedSnapshotRestoreLiveKey(PROBELAUF_STATE_KEY, { mode: 'full' }), 'Auch Vollrestore lässt Steuerkey unangetastet');
    for (const key of ['rs_daily_prices_v1', 'rs_wealth_history_start_v1', 'overview_last_full_backup_v1', 'rs_profiles_v1']) {
        assert(isProbelaufRecordKey(key), `Vollständiger Rückkehrumfang enthält ${key}`);
    }
    assert(!isProbelaufRecordKey('rs_snapshot_archive_v1'), 'Archivcontainer bleibt vom Rohrestore getrennt');
}

assertEqual(isAllowedPersistenceImportKey('rs_data_backup_summary_v1'), true, 'Vergleichsbasis ist enger globaler Vollimportkey');
assertEqual(isAllowedPersistenceImportKey('rs_data_backup_summary_v2'), false, 'Unbekannte Vergleichsversion erhält keine Keyfreigabe');
assertEqual(isAllowedSnapshotCaptureKey('rs_data_backup_summary_v1'), false, 'Standardpunkte erfassen keine globale Vergleichsbasis');
assertEqual(isAllowedSnapshotRestoreLiveKey('rs_data_backup_summary_v1'), false, 'Standardrestore erhält bestätigte Sicherungsbasis');

for (const key of ['household_plan_v1', 'annual_plan_record_v1']) {
    assert(isAllowedPersistenceImportKey(key) && isAllowedSnapshotCaptureKey(key), 'Plan/Beleg wird exportiert und erfasst: ' + key);
    assert(isSnapshotGlobalDomainKey(key) && !isSnapshotProfileScopedKey(key) && !isProfileScopedFixedKey(key), 'Plan/Beleg bleibt globale Domäne: ' + key);
    assert(isAllowedSnapshotRestoreLiveKey(key, { mode: 'standard' }) && isAllowedSnapshotRestoreLiveKey(key, { mode: 'full' }), 'Standard-/Vollwiederherstellung erlaubt Plan/Beleg: ' + key);
}
