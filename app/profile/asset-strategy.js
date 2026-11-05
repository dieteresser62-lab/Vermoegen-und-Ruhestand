/** @import * as P from "../../typcheck/profile-ui.js" */
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { readBalanceHouseholdPlan, patchHouseholdPlan, PLAN_DEFAULTS } from './household-plan.js';
import { loadProfileRegistry } from './profile-registry.js';
import { loadProfileAssetValues, DEFAULT_PROFILE_ASSET_VALUES } from './profile-asset-values.js';
import { PROFILE_VALUE_KEYS } from './profile-state.js';
import { persistenceStorage, PersistenceFacade } from '../shared/persistence-facade.js';

export const THREE_BUCKET_ACTIVATION = Object.freeze({ ...PLAN_DEFAULTS.decumulation, mode: '3_bucket_jilge' });

/** FR-58 liest den bestätigten Plan und jeden Bestand mit seiner eigenen Goldwahl. */
/** @param {{storage?: import("../../typcheck/datenvertraege.js").RecordReader, plan?: ReturnType<typeof readBalanceHouseholdPlan>}} [options]
 * @returns Hinweise zu vorhandenen Anlagen ohne aktivierte Strategie.
 */
export function readAssetStrategyWarnings({ storage = persistenceStorage, plan = readBalanceHouseholdPlan({ storage }) } = {}) {
    if (plan.status !== 'valid') return [];
    const registry = loadProfileRegistry(storage).value;
    const active = storage.getItem('rs_current_profile');
    return plan.scope.ids.flatMap(profileId => {
        const profile = registry?.profiles[profileId];
        if (!profile) return [];
        const source = profileId === active ? storage : { getItem: key => profile.data[key] ?? null };
        const tranches = normalizeTrancheCollection(JSON.parse(source.getItem('depot_tranchen') || '[]'), { mode: 'persisted' });
        const values = loadProfileAssetValues(source);
        return ['bonds', 'gold'].flatMap(kind => {
            const trancheIds = tranches.filter(lot => lot.category === kind && lot.shares > 0).map(lot => lot.trancheId);
            const missing = kind === 'bonds' ? plan.entry.values.decumulation.mode === 'standard' : !values.goldAktiv;
            return missing && trancheIds.length ? [{ kind, profileId, name: profile.meta.name, scopeKey: plan.scope.key, trancheIds }] : [];
        });
    });
}

/** Nur der ausdrückliche Klick aktiviert; Beträge, Steuerwahl und andere Personen bleiben erhalten. */
/** @param {P.StrategyOptions} [options] @returns {Promise<P.PlanEntry|void>} */
export async function enableAssetStrategy({ kind, profileId, scopeKey, storage = persistenceStorage,
    persistence = PersistenceFacade, navigationOperation } = {}) {
    navigationOperation.check();
    if (persistence.hasSyncWriteBlocks?.() || globalThis.window?.__profileRecoveryBlocker) throw new Error('Speichern wegen Wiederherstellung gesperrt.');
    const plan = readBalanceHouseholdPlan({ storage, profileId });
    if (plan.status !== 'valid' || plan.scope.key !== scopeKey) throw new Error('Der Planbereich hat sich geändert.');
    if (!readAssetStrategyWarnings({ storage, plan }).some(warning => warning.kind === kind && warning.profileId === profileId)) return;
    if (kind === 'bonds') {
        return patchHouseholdPlan({ scope: plan.scope, patch: { decumulation: THREE_BUCKET_ACTIVATION }, storage, persistence,
            navigationOperation, isCurrent: () => readBalanceHouseholdPlan({ storage, profileId }).scope?.key === scopeKey });
    }
    const registryRaw = storage.getItem('rs_profiles_v1'), registry = JSON.parse(registryRaw);
    const active = storage.getItem('rs_current_profile');
    const source = profileId === active ? storage : { getItem: key => registry.profiles[profileId].data[key] ?? null };
    const values = loadProfileAssetValues(source);
    // Muster ohne Gold haben bisher Ziel 0. Ein ausdrückliches Einschalten
    // braucht dann die normalen Vorgaben, damit auch der Simulator Gold aktiviert.
    const goldValues = values.goldZiel > 0 ? values : DEFAULT_PROFILE_ASSET_VALUES;
    const changes = { [PROFILE_VALUE_KEYS.goldAktiv]: 'true' };
    for (const [field, key] of [['goldZiel', PROFILE_VALUE_KEYS.goldZiel], ['goldFloor', PROFILE_VALUE_KEYS.goldFloor], ['goldBand', PROFILE_VALUE_KEYS.goldRebalBand]]) {
        if (source.getItem(key) === null || values.goldZiel === 0) changes[key] = String(goldValues[field]);
    }
    Object.assign(registry.profiles[profileId].data, changes);
    const records = { rs_profiles_v1: JSON.stringify(registry), ...(profileId === active ? changes : {}) };
    const keys = Object.keys(records);
    const expectedRecords = Object.fromEntries(keys.map(key => [key, storage.getItem(key)]).filter(([, raw]) => raw !== null));
    try {
        await persistence.replaceRecordsTransactional(records, { probelaufDomainWrite: true, navigationOperation,
            allowKey: key => keys.includes(key), expectedRecords,
            postValidate: () => {
                navigationOperation.check();
                if (storage.getItem('rs_current_profile') !== active
                    || readBalanceHouseholdPlan({ storage, profileId }).scope?.key !== scopeKey) throw new Error('Der Planbereich hat sich geändert.');
            } });
    } catch (error) {
        if (error.code === 'rollback_failed') persistence.blockSyncWrites?.(keys, 'Goldänderung und Rücknahme unbestätigt. Bitte neu laden.');
        throw error;
    }
}
