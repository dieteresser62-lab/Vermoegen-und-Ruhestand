import { loadProfileRegistry } from './profile-registry.js';
import { PROFILE_LOAD_STATUS, PROFILE_STORAGE_KEYS } from './profile-state.js';
import { persistenceStorage } from '../shared/persistence-facade.js';

const neutral = status => ({ status, id: null, name: null });

/** Nur validierte Identität lesen; keine Initialisierung, Reparatur oder Sicherung. */
export function readProfileContext(storage = persistenceStorage) {
    const registry = loadProfileRegistry(storage);
    if ([PROFILE_LOAD_STATUS.CORRUPT, PROFILE_LOAD_STATUS.UNAVAILABLE].includes(registry.status)) {
        return neutral('unavailable');
    }
    try {
        const current = storage.getItem(PROFILE_STORAGE_KEYS.current);
        const active = storage.getItem(PROFILE_STORAGE_KEYS.active);
        const profiles = registry.value?.profiles || {};
        const hasProfile = id => Object.prototype.hasOwnProperty.call(profiles, id);
        if ((current && !hasProfile(current)) || (active && !hasProfile(active))
            || (current && active && current !== active)) return neutral('unavailable');
        if (!current || !active) return neutral('missing');
        const name = profiles[active].meta.name;
        return { status: 'ready', id: active, name: typeof name === 'string' && name ? name : active };
    } catch {
        return neutral('unavailable');
    }
}
