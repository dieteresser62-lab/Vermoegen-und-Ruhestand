// @ts-check
import { state, PROFILE_INPUT_IDS } from './state.js';
import { managerSelectionIsBlocked, processingIsBlocked } from './controls.js';
import { loadProfileRegistry } from '../../profile/profile-registry.js';
import { switchManagerProfile } from './people.js';
import { flushManagerHouseholdPlan, showProfileValidationStatus, managerInputSignature, byId } from './helpers.js';
import { readProfileAssetValuesFromDom } from '../../profile/profile-asset-values.js';
import { saveProfileValues } from './profile-values.js';
import { getPageNavigationGuard } from '../../shared/navigation-guard-dialog.js';
import { closeTrancheModal, closeCashPostingModal, closeManagerAuxiliaryDialog } from '../tranchen-manager-modal.js';
import { clearReconciliationPreview } from './reconciliation.js';
import { renderManagerView } from '../tranchen-manager-renderer.js';
import { refreshManagerProfiles } from '../tranchen-manager-profiles.js';
import { renderPersistenceState } from './persistence-status.js';
import { parseOverviewTarget } from '../../overview/overview-model.js';
import { cashMetric } from './rendering.js';
import { renderManagerCareValues } from '../tranchen-manager-care-values.js';
import { revealCareRowFor } from '../tranchen-manager-care-rows.js';

/** Auswahl wird erst nach bestätigter Sicherung und Verlustentscheidung veröffentlicht. */
export function selectManagerView(view, { opener = document.activeElement, doc = document } = {}) {
    if (state.managerViewRequests.has(doc)) return Promise.resolve(false);
    if (doc !== document || managerSelectionIsBlocked()) return Promise.resolve(false);
    const registry = loadProfileRegistry().value;
    if (!registry?.profiles[view.profileId] || !['person', 'plan', 'history', 'care'].includes(view.kind)) return Promise.resolve(false);
    const pending = Promise.resolve().then(async () => {
        if (view.profileId !== state.profileId) {
            if (!await switchManagerProfile(view.profileId, opener)) return false;
        } else {
            if (!await flushManagerHouseholdPlan()) return false;
            let values;
            try { values = readProfileAssetValuesFromDom(); }
            catch (error) { showProfileValidationStatus(error); return false; }
            if (state.profileSaveTimer !== null) clearTimeout(state.profileSaveTimer);
            state.profileSaveTimer = null;
            if (state.pendingProfileValues || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline) {
                if (!await saveProfileValues(state.pendingProfileValues || values)) return false;
            }
            const guard = getPageNavigationGuard(doc);
            let attempt;
            try {
                attempt = await guard.prepare({ opener });
                if (!attempt || !guard.validate(attempt)) return false;
                guard.end(attempt); attempt = null;
                closeTrancheModal(doc, { confirmed: true });
                closeCashPostingModal(doc, { confirmed: true });
                closeManagerAuxiliaryDialog('sale', doc, { confirmed: true });
                closeManagerAuxiliaryDialog('people', doc, { confirmed: true });
                clearReconciliationPreview({ resetForm: true });
                state.historyStartDraft = null;
                state.immobilien?.discard();
            } finally { if (attempt) guard.end(attempt); }
        }
        if (doc !== document || state.boundDocument !== doc) return false;
        renderManagerView(doc, view);
        refreshManagerProfiles(doc, state.profileId);
        if (view.kind === 'care') renderManagerCareValues(doc);
        // Rerender kann den ursprünglichen Button ersetzt haben.
        const tab = /** @type {HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null} */ (byId('managerSectionNav')?.querySelector?.('[aria-selected="true"]'));
        tab?.focus?.();
        return true;
    }).catch(() => false).finally(() => {
        state.managerViewRequests.delete(doc);
        renderPersistenceState();
    });
    state.managerViewRequests.set(doc, pending);
    return pending;
}

// Ausschließlich bekannte DOM-Ziele; URL-Daten werden nie als Selektoren verwendet.
export const managerTargets = {
    verlauf: { kind: 'history', historyScope: 'person', focus: 'managerWealthHistory' },
    managerWealthHistory: { kind: 'history', historyScope: 'person', focus: 'managerWealthHistory' },
    managerWealthTitle: { kind: 'history', historyScope: 'person', focus: 'managerWealthTitle' },
    'haushalt-plan': { kind: 'plan', focus: 'haushalt-plan' },
    managerHouseholdPlan: { kind: 'plan', focus: 'haushalt-plan' },
    managerPlannedExpenses: { kind: 'plan', card: 'Expenses', focus: 'managerFixedExpenseAdd' },
    managerPlanComparison: { kind: 'plan', focus: 'managerPlanComparison' },
    personen: { kind: 'person', focus: 'managePeopleBtn', people: true },
    personendaten: { kind: 'person', card: 'Person', focus: 'profileGeburtsdatum' },
    managerPartnership: { kind: 'plan', card: 'Partnership', focus: 'managerPartnershipToggle' },
    managerImmobilien: { kind: 'person', focus: 'depotAddHomeBtn' },
    managerIncome: { kind: 'person', card: 'Income', focus: 'profileFixedIncomeAdd' },
    managerProfileValues: { kind: 'person', card: 'Person', focus: 'managerPersonToggle' },
    profileTagesgeld: { kind: 'person', focus: 'profileTagesgeld' },
    profileGoldZiel: { kind: 'person', card: 'Assets', focus: 'profileGoldZiel' },
    managerAssetsBody: { kind: 'person', card: 'Assets', focus: 'managerAssetsToggle' },
    managerCareBody: { kind: 'person', card: 'Care', focus: 'managerCareToggle' },
    // PFA-10: Bereich Pflege und Sprung aus ihm zum heutigen Pflegegrad auf der Personenkarte.
    pflege: { kind: 'care', focus: 'pflege' },
    managerCarePanel: { kind: 'care', focus: 'pflege' },
    profileCareGradeToday: { kind: 'person', card: 'Person', focus: 'profileCareGradeToday' },
    managerDepotTitle: { kind: 'person', focus: 'managerDepotTitle' },
    stats: { kind: 'person', focus: 'managerDepotTitle' },
    reconciliationTitle: { kind: 'person', focus: 'reconciliationTitle' },
    reconciliationCashStatuses: { kind: 'person', focus: 'reconciliationTitle' },
    // FR-77: „Verkauf eintragen“ aus der Balance öffnet den Verkaufsdialog, wenn möglich gleich mit der Tranche der Planzeile.
    verkauf: { kind: 'person', sale: true, focus: 'depotOpenSaleEntryBtn' }
};

export function resolveManagerTarget(location) {
    const target = (location?.hash || '').slice(1);
    if (!Object.hasOwn(managerTargets, target)) return null;
    const params = new URLSearchParams(location?.search || '');
    const allowed = target === 'verkauf' ? ['person', 'tranche'] : ['person'];
    if ([...params.keys()].some(key => !allowed.includes(key)) || params.getAll('person').length > 1 || params.get('person') === ''
        || params.getAll('tranche').length > 1) return null;
    // Die bestehende Übersichtszielvalidierung bleibt für ihre Ziele verbindlich.
    if (['haushalt-plan', 'profileTagesgeld'].includes(target) && !parseOverviewTarget('manager', location)) return null;
    const person = params.get('person');
    if (person && !Object.hasOwn(loadProfileRegistry().value?.profiles || {}, person)) return null;
    return { ...managerTargets[target], target, profileId: person || state.profileId, trancheId: params.get('tranche') || null };
}

export async function openManagerOverviewTarget(location, { ready = false, blocked = processingIsBlocked(), doc = document } = {}) {
    const target = resolveManagerTarget(location);
    if (!ready || blocked || !target || !await selectManagerView({ kind: target.kind, profileId: target.profileId, ...(target.historyScope ? { historyScope: target.historyScope } : {}) }, { doc })) return false;
    if (target.card) {
        const toggle = doc.getElementById(`manager${target.card}Toggle`);
        if (doc.getElementById(`manager${target.card}Body`)?.hidden) toggle?.click();
    }
    if (target.people) {
        const button = /** @type {HTMLButtonElement} */ (doc.getElementById('managePeopleBtn'));
        if (!button || button.disabled) return false;
        button.click(); return true;
    }
    if (target.sale) {
        const button = /** @type {HTMLButtonElement} */ (doc.getElementById('depotOpenSaleEntryBtn'));
        if (!button || button.disabled) return false;
        button.click();
        // Nur vorauswählen, wenn die Tranche noch im Bestand ist; sonst bleibt die Auswahl leer.
        const select = /** @type {HTMLSelectElement|null} */ (doc.getElementById('reconcileTrancheId'));
        if (select && target.trancheId && [...select.options].some(option => option.value === target.trancheId)) {
            select.value = target.trancheId;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
    }
    const focusId = target.target === 'personendaten' && doc.getElementById('managerBirthSupplement')?.hidden === false
        ? 'managerBirthDate' : target.focus;
    // UR-1: Liegt das Ziel im Reiter Pflege in einer zugeklappten Zeile, klappt genau diese Zeile auf.
    if (target.kind === 'care') revealCareRowFor(doc, focusId);
    const element = /** @type {HTMLInputElement | HTMLButtonElement} */ (doc.getElementById(focusId));
    if (!element || element.disabled) return false;
    if (focusId === 'profileTagesgeld') cashMetric(doc).start();
    if (!['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(element.tagName)) element.setAttribute?.('tabindex', '-1');
    element.scrollIntoView?.({ block: 'start' }); element.focus?.();
    return true;
}
