import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { createExpensesWealthCaptureController } from '../balance/balance-expenses-wealth-capture.js';
import { createBalanceWealthHistoryService } from '../balance/balance-wealth-history.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { CONFIG } from '../balance/balance-config.js';
import { loadStoredBalanceStateFromData, PROFILE_SCOPED_FIXED_KEYS } from '../profile/profile-state.js';
import { getProfileRegistry } from '../profile/profile-registry.js';
import { assertProfileDataLoadable } from '../profile/profile-storage.js';
import { loadProfileAssetValues, validateProfileAssetValues } from '../profile/profile-asset-values.js';
import { loadTranchesFromStorage } from '../tranches/tranchen-manager-state.js';
import { calculateAggregatedValues } from '../tranches/depot-tranchen-status.js';
import { loadProfilverbundProfiles, buildProfilverbundAssetSummary } from '../profile/profilverbund-balance.js';
import { readBalancePersonStatus } from '../shared/person-data-status.js';
import { appNow } from '../shared/app-clock.js';

/** Lesender PREVIEW-Adapter; Frische und Tagespunktwrites gehören den Balance-Diensten. */
export function createBalanceWealthHistoryPreview({ doc, win, refresh = () => {}, report = () => {},
    storage = persistenceStorage, persistence = PersistenceFacade,
    profiles = loadProfilverbundProfiles } = {}) {
    const loadState = () => {
        const loaded = loadStoredBalanceStateFromData({ [CONFIG.STORAGE.LS_KEY]: storage.getItem(CONFIG.STORAGE.LS_KEY) });
        if (loaded.status === 'corrupt' || loaded.status === 'unavailable') throw loaded.error || new Error('Balance-Quelle nicht lesbar.');
        return loaded.value || {};
    };
    const service = createBalanceWealthHistoryService({ storage, persistence, loadState,
        loadRegistry: () => getProfileRegistry(storage), guard: getPageNavigationGuard(doc, win) });
    const read = () => {
        const readiness = readBalancePersonStatus({ storage, win });
        if (!readiness.ready || readiness.status === 'demo') throw readiness.error || new Error(readiness.message || 'Bestätigte Personenquellen fehlen.');
        const registryRaw = storage.getItem('rs_profiles_v1');
        for (const entry of readiness.entries) {
            const data = { ...entry.data };
            if (entry.profileId === storage.getItem('rs_current_profile')) for (const key of PROFILE_SCOPED_FIXED_KEYS) {
                const raw = storage.getItem(key); if (raw !== null) data[key] = raw;
            }
            assertProfileDataLoadable(entry.profileId, { meta: { name: entry.name }, data }, { registryRaw });
            const reader = { getItem: key => data[key] ?? null };
            const assets = loadProfileAssetValues(reader);
            validateProfileAssetValues({ ...assets, tagesgeld: data.profile_tagesgeld ?? assets.tagesgeld });
        }
        const compound = profiles();
        if (compound.length) {
            const summary = buildProfilverbundAssetSummary(compound);
            return { tagesgeld: summary.totalTagesgeld, geldmarktEtf: summary.totalGeldmarkt,
                depotwertAlt: summary.totalDepotAlt, depotwertNeu: summary.totalDepotNeu,
                detailledTranches: summary.mergedTranches };
        }
        const state = loadState(), assets = validateProfileAssetValues(loadProfileAssetValues(storage));
        const lots = loadTranchesFromStorage(storage);
        if (['corrupt', 'unavailable'].includes(lots.status)) throw new Error('Tranchenquelle nicht lesbar.');
        // Im Einzelprofil nutzt der Balance-Leser nur einen nichtleeren gültigen Bestand als Aggregat.
        const totals = lots.status === 'valid' ? calculateAggregatedValues(lots.tranches) : state.inputs;
        if (!totals) throw new Error('Bestätigte Vermögenskomponenten fehlen.');
        const input = { tagesgeld: assets.tagesgeld, geldmarktEtf: totals.geldmarktEtf,
            depotwertAlt: totals.depotwertAlt, depotwertNeu: totals.depotwertNeu, detailledTranches: lots.tranches };
        for (const key of ['tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'depotwertNeu']) {
            if (!Number.isFinite(input[key]) || input[key] < 0) throw new Error(`Ungültige Vermögensquelle: ${key}`);
        }
        return input;
    };
    const update = ({ mode }) => {
        if (mode !== 'preview') throw new Error('Nur lesende Vorschau zulässig.');
        const inputData = read(), fingerprint = JSON.stringify(inputData), date = appNow().toDateString();
        return { ok: true, inputData, validateWealthHistorySource() {
            if (appNow().toDateString() !== date || JSON.stringify(read()) !== fingerprint) throw new Error('Die bestätigten Vermögensquellen oder das Fachdatum wurden verändert.');
        } };
    };
    const capture = createExpensesWealthCaptureController({ service, update, refresh,
        clearError: () => report(''), reportError: error => report(error.message), toast: text => report(text) });
    return { ...capture, update, service };
}

