import { IMMOBILIEN_KEY } from '../profile/profile-immobilien.js';
import { PENSION_LABEL_KEY, INCOME_KEYS } from '../profile/profile-income.js';
import { PERSON_VALUE_KEYS } from '../profile/profile-person-data.js';
import { CARE_VALUE_KEYS } from '../profile/profile-care.js';

import { CONFIG } from '../balance/balance-config.js';
import { WEALTH_CAPTURES_KEY } from '../../types/wealth-capture-contract.js';
import { HOUSEHOLD_PURCHASES_KEY } from '../simulator/simulator-household-purchases-persistence.js';

const PROFILE_STORAGE_KEYS = Object.freeze({
    registry: 'rs_profiles_v1',
    current: 'rs_current_profile',
    active: 'rs_active_profile'
});

const PROFILE_VALUE_KEYS = Object.freeze({
    ...INCOME_KEYS,
    immobilien: IMMOBILIEN_KEY,
    renteBezeichnung: PENSION_LABEL_KEY,
    plannedInflows: 'profile_planned_inflows_v1',
    tagesgeld: 'profile_tagesgeld',
    renteAktiv: 'profile_rente_aktiv',
    renteMonatlich: 'profile_rente_monatlich',
    sonstigeEinkuenfte: 'profile_sonstige_einkuenfte',
    alter: 'profile_aktuelles_alter',
    ...PERSON_VALUE_KEYS,
    ...Object.fromEntries(Object.entries(CARE_VALUE_KEYS).map(([field, key]) => [`care_${field}`, key])),
    goldAktiv: 'profile_gold_aktiv',
    goldZiel: 'profile_gold_ziel_pct',
    goldFloor: 'profile_gold_floor_pct',
    goldSteuerfrei: 'profile_gold_steuerfrei',
    goldRebalBand: 'profile_gold_rebal_band'
});

const PROFILE_SCOPED_FIXED_KEYS = [
    'depot_tranchen',
    'profile_cash_history_v1',
    'profile_tagesgeld_confirmed_date',
    'profile_wealth_history_lots_v1',
    'overview_balance_summary_v1',
    'overview_month_provision_v1',
    'overview_simulation_summary_v1',
    'profile_health_bucket',
    ...Object.values(PROFILE_VALUE_KEYS),
    'showCareDetails',
    'logDetailLevel',
    'worstLogDetailLevel',
    'backtestLogDetailLevel'
];

export const LEGACY_MIGRATION_MARKER_KEYS = Object.freeze({
    target: 'ruhestandsapp_migrated_to_target',
    completedAt: 'ruhestandsapp_migration_completed_at',
    checksum: 'ruhestandsapp_migration_checksum'
});

// WS-1: Schlüssel der entfernten Werkstatt. Die App schreibt und liest sie nicht mehr; alte Werte bleiben
// unberührt. Ein Vollimport übernimmt sie unverändert, damit ältere Sicherungen vollständig einspielbar bleiben.
export const LEGACY_WORKSHOP_STORAGE_KEYS = Object.freeze([
    'sim.stressReplay.active.v1',
    'sim.sweep.runs',
    'sim.sweep.liquidityRunwayYears',
    'sim.sweep.goldRebalancingBand',
    'sim.sweep.maxSkimPct',
    'sim.sweep.maxBearRefillPct',
    'sim.sweep.goldTarget',
    'sim.sweep.survivalQuantile',
    'sim.sweep.goGoMultiplier',
    'sim.sweep.horizonYears',
    'sim.sweep.runwayMin',
    'sim.sweep.runwayTarget',
    'sim.sweep.targetEq'
]);
// Der frühere Replay-Arbeitsstand gehört wie bisher nicht in Rückkehrpunkte.
const LEGACY_SNAPSHOT_EXCLUDED_KEYS = new Set(['sim.stressReplay.active.v1']);

const EXACT_KEYS = new Set([
    'rs_profile_live_base_v1',
    WEALTH_CAPTURES_KEY,
    'overview_last_full_backup_v1',
    'overview_last_full_backup_delivery_v1',
    'rs_data_backup_summary_v1',
    'rs_wealth_history_start_v1',
    'rs_daily_prices_v1',
    CONFIG.STORAGE.LS_KEY,
    CONFIG.STORAGE.MIGRATION_FLAG,
    PROFILE_STORAGE_KEYS.registry,
    PROFILE_STORAGE_KEYS.current,
    PROFILE_STORAGE_KEYS.active,
    'etfProxyUrl',
    'etfProxyUrls',
    'enableWorkerTelemetry',
    'household_withdrawal_mode',
    'household_simulator_needs_v1',
    'household_simulator_widow_v1',
    HOUSEHOLD_PURCHASES_KEY,
    'household_plan_v1',
    'household_planned_expenses_v1',
    'household_care_values_v1',
    'household_care_forms_notice_v1',
    'household_care_hint_v1',
    'household_partnership_v1',
    'annual_plan_record_v1',
    // FR-79 Punkt 11: Entscheidungen zum Jahresplan („Rest bleibt im Depot“), je Planjahr und Haushalt.
    'annual_plan_resolutions_v1',
    'household_simulator_needs_warning_ack_v1',
    'featureFlags',
    ...Object.values(LEGACY_MIGRATION_MARKER_KEYS),
    ...LEGACY_WORKSHOP_STORAGE_KEYS,
    ...PROFILE_SCOPED_FIXED_KEYS
]);

const SNAPSHOT_CAPTURE_EXACT_KEYS = new Set([
    'rs_profile_live_base_v1',
    WEALTH_CAPTURES_KEY,
    'household_plan_v1',
    'household_planned_expenses_v1',
    'household_care_values_v1',
    'household_care_forms_notice_v1',
    'household_care_hint_v1',
    'household_partnership_v1',
    'annual_plan_record_v1',
    // FR-79 Punkt 11: Entscheidungen zum Jahresplan („Rest bleibt im Depot“), je Planjahr und Haushalt.
    'annual_plan_resolutions_v1',
    CONFIG.STORAGE.LS_KEY,
    CONFIG.STORAGE.MIGRATION_FLAG,
    PROFILE_STORAGE_KEYS.registry,
    PROFILE_STORAGE_KEYS.current,
    PROFILE_STORAGE_KEYS.active,
    'etfProxyUrl',
    'etfProxyUrls',
    'household_withdrawal_mode',
    'household_simulator_needs_v1',
    'household_simulator_widow_v1',
    HOUSEHOLD_PURCHASES_KEY,
    'household_simulator_needs_warning_ack_v1',
    ...Object.values(LEGACY_MIGRATION_MARKER_KEYS),
    ...PROFILE_SCOPED_FIXED_KEYS
]);

const TECHNICAL_EXACT_KEYS = new Set([
    'household_care_forms_notice_v1',
    'enableWorkerTelemetry',
    'featureFlags'
]);

const PREFIXES = [
    CONFIG.STORAGE.SNAPSHOT_PREFIX,
    'sim_',
    'sim.',
    'balance_expenses_'
];

const SNAPSHOT_DOMAIN_PREFIXES = [
    'sim_',
    'sim.',
    'balance_expenses_'
];

const TECHNICAL_PREFIXES = [
    'debug_',
    'layout_',
    'telemetry_',
    'ui_',
    'window_'
];

export function isAllowedPersistenceImportKey(key) {
    if (!key) return false;
    const normalized = String(key);
    if (EXACT_KEYS.has(normalized)) return true;
    return PREFIXES.some(prefix => normalized.startsWith(prefix));
}

export function listAllowedPersistenceImportKeys(storage = globalThis.localStorage) {
    const keys = [];
    if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
        return keys;
    }
    for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (isAllowedPersistenceImportKey(key)) keys.push(String(key));
    }
    return keys;
}

export function isLegacySnapshotKey(key) {
    if (!key) return false;
    return String(key).startsWith(CONFIG.STORAGE.SNAPSHOT_PREFIX);
}

export function isProfileRegistryKey(key) {
    return String(key || '') === PROFILE_STORAGE_KEYS.registry;
}

export function isProfileScopedFixedKey(key) {
    return PROFILE_SCOPED_FIXED_KEYS.includes(String(key || ''));
}

export function isSnapshotTechnicalKey(key) {
    if (!key) return false;
    const normalized = String(key);
    if (TECHNICAL_EXACT_KEYS.has(normalized)) return true;
    return TECHNICAL_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

export function isAllowedSnapshotCaptureKey(key) {
    if (!key) return false;
    const normalized = String(key);
    if (LEGACY_SNAPSHOT_EXCLUDED_KEYS.has(normalized)) return false;
    if (isLegacySnapshotKey(normalized) || isSnapshotTechnicalKey(normalized)) return false;
    if (SNAPSHOT_CAPTURE_EXACT_KEYS.has(normalized)) return true;
    return SNAPSHOT_DOMAIN_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

// SV-1: Zurückholen ersetzt immer den ganzen Haushalt: alle Schlüssel eines vollständigen Punkts samt Registry.
// Technische, Alt- und Steuerschlüssel bleiben auf dem heutigen Stand.
export function isAllowedSnapshotRestoreLiveKey(key) {
    if (!key) return false;
    const normalized = String(key);
    if (isLegacySnapshotKey(normalized) || isSnapshotTechnicalKey(normalized)) return false;
    return isAllowedSnapshotCaptureKey(normalized) || isProfileRegistryKey(normalized);
}

// Eigener Rohumfang des Spielbereichs.
export const PROBELAUF_STATE_KEY = 'rs_probelauf_state_v1';
// Vollständiger Hauptspeicher ausschließlich für den ausdrücklich bestätigten Neustart.
// Im localStorage-Fallback liegt das Archiv als eigener Record daneben.
export function isNewBeginningRecordKey(key) {
    return key !== PROBELAUF_STATE_KEY && key !== 'rs_snapshot_archive_v1';
}
export function isProbelaufRecordKey(key) {
    return key !== PROBELAUF_STATE_KEY && key !== 'rs_snapshot_archive_v1'
        && (isAllowedPersistenceImportKey(key) || isSnapshotTechnicalKey(key));
}
