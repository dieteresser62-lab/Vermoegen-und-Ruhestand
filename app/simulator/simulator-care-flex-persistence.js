import { persistenceStorage } from '../shared/persistence-facade.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { PROFILE_STORAGE_KEYS } from '../profile/profile-state.js';
import { CARE_FLEX_FIELD_KEYS, CARE_FLEX_MIGRATION_KEY, CARE_MORTALITY_FIELD_KEYS,
    CARE_MORTALITY_MIGRATION_KEY, migrateCareDefaultsRecord } from './simulator-care-flex.js';

/** Beim Simulatorstart auch inaktive Profile im aktuellen Speicherbereich umstellen.
 * Import/Restore und Spielkopien durchlaufen denselben Start; Sicherungsdateien
 * und der jeweils andere Speicherbereich bleiben unverändert.
 *
 * @param [storage] Bestehender Speicheradapter.
 * @returns Ergebnis der Operation.
 */
export function migrateStoredCareFlex(storage = persistenceStorage) {
    const registryResult = loadProfileRegistry(storage);
    if (!['valid', 'empty', 'missing'].includes(registryResult.status)) return { changed: false, warning: '' };
    const writes = [];
    if (registryResult.raw) {
        const registry = JSON.parse(registryResult.raw);
        let changed = false;
        for (const profile of Object.values(registry.profiles)) {
            const migrated = migrateCareDefaultsRecord(profile.data);
            if (migrated !== profile.data) { profile.data = migrated; changed = true; }
        }
        if (changed) writes.push([PROFILE_STORAGE_KEYS.registry, JSON.stringify(registry)]);
    }
    const keys = [...CARE_FLEX_FIELD_KEYS, CARE_FLEX_MIGRATION_KEY,
        ...CARE_MORTALITY_FIELD_KEYS, CARE_MORTALITY_MIGRATION_KEY];
    const live = Object.fromEntries(keys.map(key => [key, storage.getItem(key)]));
    const migrated = migrateCareDefaultsRecord(live);
    if (migrated !== live) writes.push(...keys.filter(key => migrated[key] !== live[key]).map(key => [key, migrated[key]]));
    const previous = writes.map(([key]) => [key, storage.getItem(key)]);
    try {
        for (const [key, value] of writes) storage.setItem(key, value);
    } catch (error) {
        for (const [key, value] of previous) {
            if (value === null) storage.removeItem(key);
            else storage.setItem(key, value);
        }
        throw error;
    }
    return { changed: writes.length > 0, warning: writes.length > 0
        ? 'Frühere Simulator-Vorgaben für Pflege wurden einmalig umgestellt: Flex 100 / 100 / 50 / 0 / 0 %, Sterblichkeitsfaktoren 1,5 / 2 / 3 / 4 / 5. Eigene Werte bleiben erhalten.'
        : '' };
}
