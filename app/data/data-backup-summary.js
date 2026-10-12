// Vergleichsbasis der Dateiausgabe: Kennungen und SHA-256-Signaturen, keine Finanzkopie.
import { readOverviewSummaries, readMonthProvision, overviewScope } from '../overview/overview-storage.js';
import { assertCashHistory } from '../profile/profile-wealth-history.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';

export const DATA_BACKUP_SUMMARY_KEY = 'rs_data_backup_summary_v1';
const categories = ['months', 'cash', 'tranches'];
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
export function assertBackupSummary(value) {
    exact(value, ['version', 'exportedAt', 'profiles']);
    if (value.version !== 1 || typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))
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
export function backupProfileData(records) {
    const registry = records.rs_profiles_v1 ? JSON.parse(records.rs_profiles_v1) : { profiles: {} };
    const profiles = Object.fromEntries(Object.entries(registry.profiles).map(([id, profile]) => [id, { ...profile.data }]));
    const active = records.rs_active_profile || records.rs_current_profile;
    const fields = ['overview_month_provision_v1', 'profile_cash_history_v1', 'depot_tranchen'];
    // Livefelder sind für das aktive Profil maßgeblich, auch ihre Entfernung.
    if (profiles[active]) for (const key of fields) {
        delete profiles[active][key];
        if (Object.hasOwn(records, key)) profiles[active][key] = records[key];
    }
    if (!Object.keys(profiles).length && fields.some(key => records[key] !== undefined)) profiles.live = records;
    return profiles;
}
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
    return assertBackupSummary({ version: 1, exportedAt, profiles });
}
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
    return changes;
}
