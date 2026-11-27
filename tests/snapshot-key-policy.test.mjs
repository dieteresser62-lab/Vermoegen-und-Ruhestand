import { CONFIG } from '../app/balance/balance-config.js';
import {
    LEGACY_MIGRATION_MARKER_KEYS,
    isAllowedPersistenceImportKey,
    isAllowedSnapshotCaptureKey,
    isAllowedSnapshotRestoreLiveKey,
    isLegacySnapshotKey,
    isProfileRegistryKey,
    isProfileScopedFixedKey,
    isSnapshotTechnicalKey
} from '../app/shared/persistence-key-policy.js';
import { PROFILE_STORAGE_KEYS } from '../app/profile/profile-state.js';

console.log('--- Snapshot Key Policy Tests ---');

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
    assert(isSnapshotTechnicalKey('featureFlags'), 'Feature-Flags sind technisch');
    assert(isSnapshotTechnicalKey('layout_balance_sidebar'), 'Layout-Key ist technisch');
}

// SV-1: Zurückholen ersetzt immer den ganzen Haushalt; die Wiederherstellung einer Person ist entfallen.
console.log('Test 3: restore covers the whole household and keeps technical keys and legacy snapshot history untouched');
{
    for (const key of [PROFILE_STORAGE_KEYS.registry, 'depot_tranchen', CONFIG.STORAGE.LS_KEY, HOUSEHOLD_NEEDS_KEY, HOUSEHOLD_NEEDS_ACK_KEY,
        'household_plan_v1', 'annual_plan_record_v1', 'annual_plan_resolutions_v1', 'overview_simulation_summary_v1']) {
        assert(isAllowedSnapshotRestoreLiveKey(key), 'Ganzer Haushalt umfasst ' + key);
    }
    for (const key of ['featureFlags', 'ui_panel_state', 'enableWorkerTelemetry', `${CONFIG.STORAGE.SNAPSHOT_PREFIX}old`]) {
        assert(!isAllowedSnapshotRestoreLiveKey(key), 'Restore erhält technischen oder alten Schlüssel ' + key);
    }
}

console.log('P10c: Vollimport und Snapshotwege behalten unterschiedliche Live-Keyverträge');
for (const key of ['ruhestandsmodell_snapshot_2026-01-20T11:48:21.709Z--Muster A',
    'featureFlags', 'enableWorkerTelemetry', 'sim.stressReplay.active.v1']) {
    assert(isAllowedPersistenceImportKey(key), 'Vollimport erlaubt seinen Legacy-/Exactkey weiterhin: ' + key);
    assert(!isAllowedSnapshotCaptureKey(key), 'Snapshotcapture schließt historischen Livekey aus: ' + key);
    assert(!isAllowedSnapshotRestoreLiveKey(key), 'Snapshotrestore schließt Livekey aus: ' + key);
}
for (const key of ['ui_panel_state', 'layout_person_panel']) {
    assert(isSnapshotTechnicalKey(key), 'Historische technische Registrybeigabe wird zentral erkannt: ' + key);
    assert(!isAllowedPersistenceImportKey(key), 'Technische Registrybeigabe erweitert Top-Level-Importpolicy nicht: ' + key);
}

console.log('--- Snapshot Key Policy Tests Completed ---');

assert(isProfileScopedFixedKey('overview_simulation_summary_v1'), 'Simulationsergebnis ist fester profilbezogener Schlüssel');
assert(isAllowedSnapshotCaptureKey('overview_simulation_summary_v1'), 'Fachlicher Snapshot erfasst Simulationssummary');

{
    const { PROBELAUF_STATE_KEY, isProbelaufRecordKey } = await import('../app/shared/persistence-key-policy.js');
    assert(!isAllowedPersistenceImportKey(PROBELAUF_STATE_KEY), 'Steuerkey ist kein allgemeiner Importkey');
    assert(!isAllowedSnapshotCaptureKey(PROBELAUF_STATE_KEY), 'Steuerkey ist kein fachlicher Snapshotrecord');
    assert(!isAllowedSnapshotRestoreLiveKey(PROBELAUF_STATE_KEY), 'Restore lässt Steuerkey unangetastet');
    for (const key of ['rs_daily_prices_v1', 'rs_wealth_history_start_v1', 'overview_last_full_backup_v1', 'rs_profiles_v1']) {
        assert(isProbelaufRecordKey(key), `Vollständiger Rückkehrumfang enthält ${key}`);
    }
    assert(!isProbelaufRecordKey('rs_snapshot_archive_v1'), 'Archivcontainer bleibt vom Rohrestore getrennt');
}

assertEqual(isAllowedPersistenceImportKey('rs_data_backup_summary_v1'), true, 'Vergleichsbasis ist enger globaler Vollimportkey');
assertEqual(isAllowedPersistenceImportKey('rs_data_backup_summary_v2'), false, 'Unbekannte Vergleichsversion erhält keine Keyfreigabe');
assertEqual(isAllowedSnapshotCaptureKey('rs_data_backup_summary_v1'), false, 'Standardpunkte erfassen keine globale Vergleichsbasis');
assertEqual(isAllowedSnapshotRestoreLiveKey('rs_data_backup_summary_v1'), false, 'Restore erhält bestätigte Sicherungsbasis');

for (const key of ['household_plan_v1', 'annual_plan_record_v1']) {
    assert(isAllowedPersistenceImportKey(key) && isAllowedSnapshotCaptureKey(key), 'Plan/Beleg wird exportiert und erfasst: ' + key);
    assert(!isProfileScopedFixedKey(key), 'Plan/Beleg bleibt globale Domäne: ' + key);
}
