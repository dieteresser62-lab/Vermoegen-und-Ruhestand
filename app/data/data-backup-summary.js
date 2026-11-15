// Vergleichsbasis der Dateiausgabe: Kennungen und SHA-256-Signaturen, keine Finanzkopie.
import { readOverviewSummaries, readMonthProvision, overviewScope } from '../overview/overview-storage.js';
import { assertCashHistory } from '../profile/profile-wealth-history.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { HOUSEHOLD_PLAN_KEY } from '../profile/household-plan.js';
import { PLANNED_EXPENSES_KEY } from '../profile/household-planned-expenses.js';
import { PARTNERSHIP_KEY } from '../profile/household-partnership.js';
import { HOUSEHOLD_CARE_VALUES_KEY } from '../shared/household-care-values.js';
import { CARE_HINT_KEY } from '../shared/household-care-hint.js';
import { PROFILE_VALUE_KEYS, PROFILE_HEALTH_BUCKET_KEY } from '../profile/profile-state.js';
import { CARE_VALUE_KEYS } from '../profile/profile-care.js';

export const DATA_BACKUP_SUMMARY_KEY = 'rs_data_backup_summary_v1';
const categories = ['months', 'cash', 'tranches'];
/** GH-1 Punkt 5 (F-06): Version 2 prüft zusätzlich Haushalts- und Planwerte je Bereich als eine Signatur. Version 1 bleibt lesbar; ihr fehlen
 * diese Bereiche, sie gelten dann als „seit der letzten Sicherung nicht feststellbar“. */
export const BACKUP_SUMMARY_AREAS = Object.freeze(['plan', 'income', 'partnership', 'care']);
const V = PROFILE_VALUE_KEYS;
const incomeKeys = [V.einkuenfte, V.einkuenfteMigration, V.renteBezeichnung, V.renteAktiv, V.renteMonatlich, V.sonstigeEinkuenfte,
    V.rentenbeginn, V.rentenanpassungArt, V.rentenanpassungPct, V.renteSteuerquotePct, V.plannedInflows];
const careKeys = [...Object.values(CARE_VALUE_KEYS), PROFILE_HEALTH_BUCKET_KEY];
/** Gespeicherte Schlüssel je Bereich: im Haushalt und je Person (Livewerte der aktiven Person gelten). */
const AREA_KEYS = Object.freeze({
    plan: { household: [HOUSEHOLD_PLAN_KEY, PLANNED_EXPENSES_KEY], profile: [V.immobilien, V.alter, V.geburtsdatum, V.geschlecht, V.kirchensteuerPct,
        V.sparerPauschbetrag, V.goldAktiv, V.goldZiel, V.goldFloor, V.goldSteuerfrei, V.goldRebalBand] },
    income: { household: [], profile: incomeKeys },
    partnership: { household: [PARTNERSHIP_KEY], profile: [] },
    care: { household: [HOUSEHOLD_CARE_VALUES_KEY, CARE_HINT_KEY], profile: careKeys }
});
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültige Sicherungsvergleichsbasis.');
    if (Object.keys(value).some(key => forbidden.has(key))) throw new Error('Unsichere Vergleichskennung.');
    return value;
}
function exact(value, keys) {
    object(value);
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Unbekannte Felder der Sicherungsvergleichsbasis.');
}
/**
 * @param value Zu verarbeitender Wert.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function assertBackupSummary(value) {
    object(value);
    exact(value, value.version === 2 ? ['version', 'exportedAt', 'profiles', 'areas'] : ['version', 'exportedAt', 'profiles']);
    if (value.version === 2) {
        exact(value.areas, BACKUP_SUMMARY_AREAS);
        if (BACKUP_SUMMARY_AREAS.some(area => typeof value.areas[area] !== 'string' || !/^[a-f0-9]{64}$/.test(value.areas[area]))) throw new Error('Ungültige Vergleichssignatur.');
    }
    if (![1, 2].includes(value.version) || typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))
        || new Date(value.exportedAt).toISOString() !== value.exportedAt) throw new Error('Ungültige Vergleichsversion oder Sicherungszeit.');
    object(value.profiles);
    for (const [id, profile] of Object.entries(value.profiles)) {
        if (!id.trim() || id.length > 200 || /[\u0000-\u001f]/.test(id)) throw new Error('Ungültige Profilkennung der Vergleichsbasis.');
        exact(profile, categories);
        for (const category of categories) {
            object(profile[category]);
            for (const [key, signature] of Object.entries(profile[category])) {
                if (!key || key.length > 1000 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw new Error('Ungültige Vergleichssignatur.');
            }
        }
    }
    return value;
}
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
async function signature(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
/**
 * @param records Serialisierte Speicherrecords.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function backupProfileData(records) {
    const registry = records.rs_profiles_v1 ? JSON.parse(records.rs_profiles_v1) : { profiles: {} };
    const profiles = Object.fromEntries(Object.entries(registry.profiles).map(([id, profile]) => [id, { ...profile.data }]));
    const active = records.rs_active_profile || records.rs_current_profile;
    const ledger = ['overview_month_provision_v1', 'profile_cash_history_v1', 'depot_tranchen'];
    const fields = [...ledger, ...new Set(Object.values(AREA_KEYS).flatMap(area => area.profile))];
    // Livefelder sind für das aktive Profil maßgeblich, auch ihre Entfernung.
    if (profiles[active]) for (const key of fields) {
        delete profiles[active][key];
        if (Object.hasOwn(records, key)) profiles[active][key] = records[key];
    }
    if (!Object.keys(profiles).length && ledger.some(key => records[key] !== undefined)) profiles.live = records;
    return profiles;
}
/**
 * @param records Serialisierte Speicherrecords.
 * @param exportedAt Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export async function buildBackupSummary(records, exportedAt) {
    const profiles = Object.create(null);
    for (const [id, data] of Object.entries(backupProfileData(records))) {
        const profile = { months: {}, cash: {}, tranches: {} };
        for (const [key, entry] of Object.entries(readOverviewSummaries(data.overview_month_provision_v1))) {
            const scope = overviewScope(entry?.scope?.kind, entry?.scope?.ids);
            if (scope && key === JSON.stringify([entry.month, scope.key]) && readMonthProvision(data.overview_month_provision_v1, entry.month, scope)) {
                profile.months[key] = await signature(entry);
            }
        }
        if (data.profile_cash_history_v1 !== undefined) {
            const history = assertCashHistory(JSON.parse(data.profile_cash_history_v1));
            const occurrences = new Map();
            for (const entry of history.entries) {
                const ordinal = occurrences.get(entry.date) || 0;
                occurrences.set(entry.date, ordinal + 1);
                profile.cash[`${entry.date}#${ordinal}`] = await signature(entry);
            }
        }
        if (data.depot_tranchen !== undefined) {
            for (const entry of normalizeTrancheCollection(JSON.parse(data.depot_tranchen), { mode: 'persisted' })) {
                profile.tranches[entry.trancheId] = await signature(entry);
            }
        }
        profiles[id] = profile;
    }
    const people = backupProfileData(records);
    const pick = (/** @type {Record<string, unknown>} */ source, /** @type {string[]} */ keys) => Object.fromEntries(keys.filter(key => source?.[key] !== undefined).map(key => [key, source[key]]));
    const areas = Object.create(null);
    for (const area of BACKUP_SUMMARY_AREAS) {
        const { household, profile } = AREA_KEYS[/** @type {keyof typeof AREA_KEYS} */ (area)];
        areas[area] = await signature({ household: pick(records, household),
            profiles: Object.fromEntries(Object.entries(people).map(([id, data]) => [id, pick(data, profile)])) });
    }
    return assertBackupSummary({ version: 2, exportedAt, profiles, areas });
}
/**
 * @param basis Wert für den bestehenden Aufrufvertrag.
 * @param current Wert für den bestehenden Aufrufvertrag.
 * @param lastBackup Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function compareBackupSummaries(basis, current, lastBackup) {
    try {
        assertBackupSummary(basis); assertBackupSummary(current);
        if (basis.exportedAt !== lastBackup) return null;
    } catch { return null; }
    const changes = Object.fromEntries(categories.map(key => [key, { added: 0, changed: 0, removed: 0 }]));
    for (const id of new Set([...Object.keys(basis.profiles), ...Object.keys(current.profiles)])) {
        for (const category of categories) {
            const before = basis.profiles[id]?.[category] || {}, after = current.profiles[id]?.[category] || {};
            for (const key of Object.keys(before)) {
                if (!Object.hasOwn(after, key)) changes[category].removed++;
                else if (before[key] !== after[key]) changes[category].changed++;
            }
            for (const key of Object.keys(after)) if (!Object.hasOwn(before, key)) changes[category].added++;
        }
    }
    // GH-1 Punkt 5: Bereiche je Signatur; eine Basis der Version 1 kennt sie nicht („unknown“ statt Entwarnung).
    if (current.version === 2) /** @type {any} */ (changes).areas = Object.fromEntries(BACKUP_SUMMARY_AREAS.map(area => [area,
        basis.version !== 2 ? 'unknown' : basis.areas[area] === current.areas[area] ? 'unchanged' : 'changed']));
    return changes;
}
