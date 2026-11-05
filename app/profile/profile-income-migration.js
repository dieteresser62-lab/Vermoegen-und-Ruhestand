import { INCOME_KEYS, migrateIncomeRecord } from './profile-income.js';
import { persistenceStorage } from '../shared/persistence-facade.js';

/** Nur im aktiven Speicherbereich; Livewerte gehören ausschließlich zur aktuellen Person. */
/**
 * @param storage Speicherzugang des vorhandenen Besitzers.
 * @returns Ob Einkünfterecords geschrieben wurden.
 */
export function migrateStoredIncome(storage = persistenceStorage) {
    const raw = storage.getItem('rs_profiles_v1');
    const registry = raw ? JSON.parse(raw) : null;
    const current = storage.getItem('rs_current_profile');
    const sourceKeys = [...Object.values(INCOME_KEYS), 'profile_sonstige_einkuenfte', 'profile_planned_inflows_v1'];
    const live = Object.fromEntries(sourceKeys.map(key => [key, storage.getItem(key)]).filter(([, value]) => value !== null));
    const writes = [];
    let changed = false;
    if (registry) for (const [id, profile] of Object.entries(registry.profiles)) {
        const source = id === current ? { ...profile.data, ...live } : profile.data;
        const migrated = migrateIncomeRecord(source);
        for (const key of Object.values(INCOME_KEYS)) {
            if (profile.data[key] !== migrated[key]) { profile.data[key] = migrated[key]; changed = true; }
            if (id === current && storage.getItem(key) !== migrated[key]) writes.push([key, migrated[key]]);
        }
    }
    if (!registry || !registry.profiles[current]) {
        const migrated = migrateIncomeRecord(live);
        for (const key of Object.values(INCOME_KEYS)) if (storage.getItem(key) !== migrated[key]) writes.push([key, migrated[key]]);
    }
    if (changed) writes.push(['rs_profiles_v1', JSON.stringify(registry)]);
    const previous = writes.map(([key]) => [key, storage.getItem(key)]);
    try { for (const [key, value] of writes) storage.setItem(key, value); }
    catch (error) {
        for (const [key, value] of previous) value === null ? storage.removeItem(key) : storage.setItem(key, value);
        throw error;
    }
    return { changed: writes.length > 0 };
}
