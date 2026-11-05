// @ts-check
import { fail } from './schema.js';

export async function restoreReconciliationRecords(storage, records, flush) {
    let failed = false;
    for (const [key, raw] of records) {
        try {
            if (raw === null || raw === undefined) storage.removeItem(key);
            else storage.setItem(key, raw);
        } catch { failed = true; }
    }
    try { await requireReconciliationFlush(flush); } catch { failed = true; }
    return !failed;
}

export async function requireReconciliationFlush(flush) {
    if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
}

export function assertProfileContext(profileId, dependencies) {
    const currentProfileId = dependencies.getCurrentProfileId();
    const activeProfileId = dependencies.getActiveProfileId();
    if (currentProfileId !== profileId || activeProfileId !== profileId) {
        fail(
            'RECONCILIATION_PROFILE_CONTEXT_CHANGED',
            `Der aktive Profilkontext hat sich geändert (erwartet ${profileId}, aktuell ${currentProfileId || '-'} / ${activeProfileId || '-'}).`,
            { field: 'profileId', details: { profileId, currentProfileId, activeProfileId } }
        );
    }
}
