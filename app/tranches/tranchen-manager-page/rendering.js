// @ts-check
import { bindManagerCashMetric } from '../tranchen-manager-cash-metric.js';
import { clearProfileValidationStatus, byId, readStoredValue, syncGlobalState } from './helpers.js';
import { state } from './state.js';
import { loadProfileAssetValues } from '../../profile/profile-asset-values.js';
import { readCashPerson } from '../../profile/profile-cash-update.js';
import { PROFILE_VALUE_KEYS, PROFILE_CASH_CONFIRMED_DATE_KEY } from '../../profile/profile-state.js';
import { PROFILE_CASH_HISTORY_KEY } from '../../profile/profile-wealth-history.js';
import { renderTranchenStats, renderManagerQuoteContext, renderTranchenTable } from '../tranchen-manager-renderer.js';
import { refreshReconciliationCashStatuses, renderReconciliationState } from './reconciliation-view.js';
import { refreshManagerProfiles } from '../tranchen-manager-profiles.js';
import { bindManagerPersonCards } from '../tranchen-manager-person-cards.js';
import { loadProfileRegistry } from '../../profile/profile-registry.js';
import { readManagerHistoryContext } from '../tranchen-history-ui.js';
import { readAssetStrategyWarnings } from '../../profile/asset-strategy.js';
import { readBalanceHouseholdPlan } from '../../profile/household-plan.js';
import { renderAssetStrategyWarnings } from '../../shared/asset-strategy-warnings.js';
import { getProfileMeta } from '../../profile/profile-storage.js';

export function cashMetric(doc = document) {
    return bindManagerCashMetric(doc, { cancel: () => {
        clearProfileValidationStatus();
        state.navigationRegistration?.notify();
    } });
}

// Kacheln, Anzahl und Tabelle lesen dieselbe Immobilienliste: das Formularfeld des gebundenen Editors.
const personHomes = values => state.immobilien ? state.immobilien.homes() : values.immobilien;

export function renderPersonWealth() {
    const values = loadProfileAssetValues(), cash = values.tagesgeld, immobilien = personHomes(values);
    const count = byId('managerDepotCount'), homes = immobilien.length;
    if (count) count.textContent = `Tagesgeld${homes ? ', ' : ' und '}${state.tranchen.length} ${state.tranchen.length === 1 ? 'Tranche' : 'Tranchen'}${homes ? ` und ${homes} ${homes === 1 ? 'Immobilie' : 'Immobilien'}` : ''}`;
    const person = readCashPerson(state.profileId, '', Object.fromEntries([
        PROFILE_VALUE_KEYS.tagesgeld, PROFILE_CASH_HISTORY_KEY, PROFILE_CASH_CONFIRMED_DATE_KEY
    ].map(key => [key, readStoredValue(key)])));
    const date = [person.lastDate, person.confirmedDate].filter(Boolean).sort().at(-1);
    cashMetric().sync({ profileId: state.profileId, amount: cash, date });
    renderTranchenStats(byId('stats'), state.tranchen, { cash, immobilien });
}

/** Nach Immobilienaktionen zeigen Kacheln und Tabelle denselben Stand. */
export function renderPersonAssets() {
    renderPersonWealth();
    renderDepotHistory();
}

export function render() {
    const startFocused = document.activeElement?.id === 'managerHistoryStart';
    renderManagerQuoteContext(document, state.tranchen);
    refreshReconciliationCashStatuses();
    renderPersonWealth();
    renderDepotHistory();
    renderReconciliationState();
    syncGlobalState();
    refreshManagerProfiles(document, state.profileId);
    bindManagerPersonCards(document, () => state.profileId).sync();
    if (byId('managerHistoryRecoveryStatus')) byId('managerHistoryRecoveryStatus').textContent = state.historyRecoveryMessage;
    if ((state.historyStartDraft !== null || startFocused) && byId('managerHistoryStartForm')) byId('managerHistoryStartForm').hidden = false;
    if (state.historyStartDraft !== null && byId('managerHistoryStart')) byId('managerHistoryStart').value = state.historyStartDraft;
    if (startFocused) byId('managerHistoryStart')?.focus();
}

export function renderDepotHistory() {
    const registry = loadProfileRegistry();
    const context = registry.value ? readManagerHistoryContext(registry.value) : { status: 'missing' };
    const focusId = state.historyUI?.beforeRender(state.profileId, state.tranchen);
    let strategyWarnings = [];
    try { strategyWarnings = readAssetStrategyWarnings({ plan: readBalanceHouseholdPlan({ profileId: state.profileId }) }); }
    catch { /* Beschädigte Quellen behandelt die bestehende Profil-/Depot-Recovery. */ }
    renderAssetStrategyWarnings(byId('managerBondStrategyWarning'), strategyWarnings.filter(warning => warning.kind === 'bonds'));
    renderAssetStrategyWarnings(byId('managerPlanGoldWarning'), strategyWarnings.filter(warning => warning.kind === 'gold'), { showName: true });
    renderAssetStrategyWarnings(byId('managerGoldStrategyWarning'), strategyWarnings.filter(warning => warning.kind === 'gold' && warning.profileId === state.profileId));
    if (strategyWarnings.length && byId('managerPlanMore')) byId('managerPlanMore').open = true;
    const values = loadProfileAssetValues(), homes = state.immobilien, homeFocus = homes?.beforeRender();
    renderTranchenTable(byId('tranchenTable'), state.tranchen, { context, profileId: state.profileId, expandedId: state.historyUI?.expandedId, cash: values.tagesgeld,
        immobilien: personHomes(values), homeView: homes?.view(), strategyWarnings });
    state.historyUI?.afterRender(focusId);
    homes?.afterRender(homeFocus);
}

export function updateActiveProfileLabel(profileId = state.profileId) {
    const label = byId('suiteProfileContext');
    if (!label) return;
    let meta = null;
    try {
        meta = profileId ? getProfileMeta(profileId) : null;
    } catch {
        meta = null;
    }
    const id = profileId || '-';
    label.textContent = '';
    label.hidden = true;
    label.dataset.profileName = meta?.name || 'Profil';
    label.dataset.profileId = id;
    const depotProfile = byId('managerDepotProfileName');
    if (depotProfile) depotProfile.textContent = meta?.name || id;
    const personProfile = byId('managerPersonProfileName');
    if (personProfile) personProfile.textContent = meta?.name || 'Profil';
    const backLink = byId('managerBackLink');
    if (backLink) {
        backLink.dataset.profileId = id;
        backLink.setAttribute?.('aria-label', `Zurück zur Profilübersicht für ${meta?.name || id} (${id})`);
    }
}
