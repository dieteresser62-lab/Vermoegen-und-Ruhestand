import { PROFILE_TRANCHES_KEY, parseStoredBalanceStateFromData, parseProfileHealthBucketFromData, parseProfileOverridesFromData, hasProfileOverrides } from '../profile-state.js';
import { loadTranchesFromStorage } from '../../tranches/tranchen-manager-state.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { readBalancePersonStatus, balanceCareSettings } from '../../shared/person-data-status.js';
import { loadProfileRegistry } from '../profile-registry.js';
import { projectPerson } from '../profile-person-data.js';
import { normalizeBalanceInputs } from './values.js';
import { resolveTrancheSplitTotals } from './tranches.js';

function loadProfileTrancheState(data) {
    const storage = {
        getItem(key) {
            if (key !== PROFILE_TRANCHES_KEY || !data || typeof data !== 'object') return null;
            const raw = data[PROFILE_TRANCHES_KEY];
            if (raw === null || raw === undefined) return null;
            return typeof raw === 'string' ? raw : JSON.stringify(raw);
        }
    };
    const state = loadTranchesFromStorage(storage);
    if (state.status === 'corrupt' || state.status === 'unavailable') {
        /** @type {import('../../../typcheck/runtime-contracts.js').AppError} */
        const error = new Error('Profilverbund: Der profilbezogene Tranchenbestand ist fehlerhaft.');
        error.code = state.errorCode || 'TRANCHE_STORAGE_ERROR';
        throw error;
    }
    return state;
}

// Lade alle Profile, die zum Profilverbund gehören
export function loadProfilverbundProfiles({ storage = persistenceStorage, status = readBalancePersonStatus({ storage, win: storage === persistenceStorage ? globalThis.window : null }) } = {}) {
    if (status.status === 'corrupt') throw status.error;
    if (status.status === 'demo') return [];
    if (!status.ready) throw new Error(status.message);
    if (status.singleProfile) return [];
    const registry = loadProfileRegistry(storage).value;
    const selected = Object.entries(registry.profiles).filter(([, p]) => p.meta?.belongsToHousehold !== false)
        .map(([id, p]) => ({ ...p.meta, id }));
    const referenceYear = status.referenceYear;
    return selected.map(meta => {
        const data = status.entries.find(entry => entry.profileId === meta.id).data;
        let balanceState;
        let healthBucket;
        try {
            balanceState = parseStoredBalanceStateFromData(data);
            healthBucket = parseProfileHealthBucketFromData(data);
        } catch (error) {
            /** @type {import('../../../typcheck/runtime-contracts.js').AppError} */
            const profileError = new Error(
                `Profilverbund: Profil ${meta.name || meta.id} ist im Bereich ${error.storageKey || 'Profildaten'} fehlerhaft. ${error.message || ''}`.trim()
            );
            profileError.name = 'ProfilverbundProfileStateError';
            profileError.code = error.code || 'PROFILE_STATE_LOAD_FAILED';
            profileError.status = error.status || 'corrupt';
            profileError.profileId = meta.id;
            profileError.storageKey = error.storageKey || null;
            profileError.raw = error.raw ?? null;
            profileError.cause = error;
            throw profileError;
        }
        const person = projectPerson(data, referenceYear, balanceCareSettings(status));
        const overrides = { ...parseProfileOverridesFromData(data), profileAlter: person.startAlter,
            profileRenteMonatlich: person.monateImJahr === 12 ? person.renteMonatlich : person.renteImJahr / 12,
            profileSonstigeEinkuenfte: person.sonstigeEinkuenfte,
            profileRenteAktiv: person.renteImJahr + person.sonstigeEinkuenfte * 12 > 0 };
        const trancheState = loadProfileTrancheState(data);
        const tranches = trancheState.tranches || [];
        const hasExplicitTrancheOverride = trancheState.raw !== null && trancheState.raw !== '';
        const hasFallbackData = hasProfileOverrides(overrides) || hasExplicitTrancheOverride;
        const normalized = normalizeBalanceInputs(balanceState?.inputs || (hasFallbackData ? {} : null), overrides);
        if (!normalized) return null;
        normalized.aktuellesAlter = person.startAlter;
        normalized.sparerPauschbetrag = person.startSPB;
        normalized.kirchensteuerSatz = person.kirchensteuerSatz;
        const split = resolveTrancheSplitTotals(tranches);
        if (hasExplicitTrancheOverride) {
            normalized.depotwertAlt = split.altValue;
            normalized.depotwertNeu = split.neuValue;
            normalized.goldWert = split.goldValue;
            normalized.geldmarktEtf = split.moneyValue;
            normalized.costBasisAlt = split.altCost;
            normalized.costBasisNeu = split.neuCost;
            normalized.goldCost = split.goldCost;
        }
        return {
            profileId: meta.id,
            name: meta.name || meta.id,
            inputs: normalized,
            healthBucket,
            tranches,
            hasExplicitTrancheOverride,
            trancheStatus: hasExplicitTrancheOverride ? trancheState.status : 'not_loaded',
            balanceState
        };
    }).filter(Boolean);
}
