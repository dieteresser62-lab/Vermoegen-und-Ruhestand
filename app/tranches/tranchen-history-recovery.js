import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { PROFILE_STORAGE_KEYS, PROFILE_TRANCHES_KEY } from '../profile/profile-state.js';
import { PROFILE_WEALTH_LOTS_KEY, assertWealthLots, mergeWealthLots, correctWealthLot } from '../profile/profile-wealth-history.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { readReconciliationHistory } from './tranche-reconciliation.js';
import { requireHistoryRecord, commitHistoryRecords } from './tranchen-history-store.js';

/** Schadhafte Records/Audits ergeben keine bedienbaren Kandidaten. */
export function projectHistoryRecovery(registry, profileId) {
    try {
        const data = registry.profiles[profileId].data;
        const copies = requireHistoryRecord(data[PROFILE_WEALTH_LOTS_KEY], assertWealthLots, { version: 1, lots: {} });
        const current = normalizeTrancheCollection(JSON.parse(data[PROFILE_TRANCHES_KEY] || '[]'), { mode: 'persisted' });
        const events = readReconciliationHistory(registry);
        return mergeWealthLots(copies, current).filter(lot => lot.status === 'unknown').map(lot => {
            const present = current.some(tranche => tranche.trancheId === lot.tranche.trancheId);
            const saleRecorded = events.some(event => event.profileId === profileId && event.trancheId === lot.tranche.trancheId && event.eventType === 'sale_reconciled');
            return { trancheId: lot.tranche.trancheId, name: lot.tranche.name,
                fromDate: lot.uncertainty?.fromDate ?? null, kind: present ? 'correct' : 'discard',
                blocked: copies.lots[lot.tranche.trancheId]?.status === 'sold' || saleRecorded,
                blockedReason: saleRecorded ? 'bestätigter Verkaufsbeleg.' : 'verkaufter Verlaufseintrag ohne passenden Verkaufsbeleg.' };
        });
    } catch { return []; }
}

/** Quellbytes werden vor der Nachfrage festgehalten und unmittelbar vor Write geprüft. */
export function prepareHistoryRecovery({ profileId, trancheId, kind }, { storage = persistenceStorage, date } = {}) {
    const keys = [PROFILE_STORAGE_KEYS.registry, PROFILE_STORAGE_KEYS.current, PROFILE_STORAGE_KEYS.active,
        PROFILE_TRANCHES_KEY, PROFILE_WEALTH_LOTS_KEY];
    const source = new Map(keys.map(key => [key, storage.getItem(key)]));
    if (source.get(PROFILE_STORAGE_KEYS.current) !== profileId || source.get(PROFILE_STORAGE_KEYS.active) !== profileId) throw new Error('HISTORY_CONTEXT_CHANGED');
    const loaded = loadProfileRegistry(storage);
    if (loaded.status !== 'valid') throw new Error('Profilregistry nicht verlässlich lesbar.');
    const registry = JSON.parse(source.get(PROFILE_STORAGE_KEYS.registry));
    const data = registry.profiles[profileId]?.data;
    if (!data || [PROFILE_TRANCHES_KEY, PROFILE_WEALTH_LOTS_KEY].some(key => (data[key] ?? null) !== source.get(key))) throw new Error('Livebestand und Profilkopie widersprechen sich.');
    const candidate = projectHistoryRecovery(registry, profileId).find(lot => lot.trancheId === trancheId);
    // Abgeschlossenes Verwerfen oder Übernehmen ist ohne Write wiederholbar.
    if (!candidate) {
        readReconciliationHistory(registry);
        requireHistoryRecord(data[PROFILE_WEALTH_LOTS_KEY], assertWealthLots);
        normalizeTrancheCollection(JSON.parse(data[PROFILE_TRANCHES_KEY] || '[]'), { mode: 'persisted' });
        return null;
    }
    if (candidate.blocked || candidate.kind !== kind) throw new Error('Korrektur bei Verkaufsbelegen oder unpassendem Bestand gesperrt.');
    const copies = requireHistoryRecord(data[PROFILE_WEALTH_LOTS_KEY], assertWealthLots);
    const current = normalizeTrancheCollection(JSON.parse(data[PROFILE_TRANCHES_KEY] || '[]'), { mode: 'persisted' });
    const next = correctWealthLot(copies, current, trancheId, kind, date);
    const raw = JSON.stringify(next);
    data[PROFILE_WEALTH_LOTS_KEY] = raw;
    return { candidate, source, records: [[PROFILE_WEALTH_LOTS_KEY, raw], [PROFILE_STORAGE_KEYS.registry, JSON.stringify(registry)]] };
}

export async function commitHistoryRecovery(prepared, { confirmed = false, storage = persistenceStorage, valid = () => true, ...options } = {}) {
    if (confirmed !== true || !prepared) return false;
    const current = () => valid() && [...prepared.source].every(([key, raw]) => storage.getItem(key) === raw);
    await commitHistoryRecords(prepared.records, { ...options, storage, valid: current });
    // Ein inzwischen verlorener Dokumentkontext darf keinen Erfolg anzeigen.
    if (!valid()) throw new Error('HISTORY_CONTEXT_CHANGED');
    return true;
}
