/** @import {AppError} from '../../typcheck/runtime-contracts.js' */
/** @import {SimulatorControl} from '../../typcheck/simulator-ui.js' */
import { initializePlanOverview } from './simulator-plan-overview.js';
import { initializePlannedInflows } from './planned-inflows-ui.js';
import { writeBoundHouseholdPlanField } from '../shared/household-plan-fields.js';
import { renderSimulatorPlanTrial } from './simulator-plan-trial.js';
import { readSimulatorHouseholdPlan, projectPlanToSimulator, SIMULATOR_PLAN_FIELD_MAP } from '../profile/household-plan.js';
import { readHouseholdPersonStatus, setDocumentPersonStatus, showPersonDataStatus } from '../shared/person-data-status.js';
import { initializePersonOverrides } from './simulator-person-overrides.js';
import { renderSimulatorProfileRecovery } from './simulator-main-tabs.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { CONFIG } from '../balance/balance-config.js';
import { personReferenceYear } from '../profile/profile-person-data.js';
import { getHouseholdPrimaryProfileId } from '../profile/profile-registry.js';
"use strict";
import { refreshAssumptionFillStatus } from './simulator-assumptions-ui.js';

import { syncTranchenToInputs } from '../tranches/depot-tranchen-status.js';
import {
    assertProfileContextReady,
    listProfiles,
    getProfileData,
    getCurrentProfileId
} from '../profile/profile-storage.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from './simulator-profile-inputs.js';
import { updateStartPortfolioDisplay } from './simulator-portfolio.js';
import { refreshDynamicFlexControls, syncDynamicFlexPresetSelection } from './simulator-main-dynamic-flex.js';
import { refreshThreeBucketControls } from './simulator-main-3bucket.js';
import { syncSelectionText } from '../shared/designsystem-selection-text.js';
import { setFieldState } from '../shared/field-state.js';
import { refreshRentAdjustmentPresentation } from './simulator-main-rent-adjust.js';
import { refreshPartnerPresentation } from './simulator-main-partner.js';
import {
    HOUSEHOLD_SIMULATOR_NEED_FIELD_IDS,
    initializeHouseholdSimulatorNeeds,
    resolveHouseholdSimulatorNeed,
    selectLegacyHouseholdSimulatorNeeds
} from './simulator-household-needs-persistence.js';

import { renderSuiteHousehold } from '../shared/suite-frame.js';

const PROFILE_RECOVERY_CONTROL_IDS = Object.freeze([
    'mcButton',
    'btButton',
    'sweepButton',
    'sweepSelfTestButton',
    'findBestButton',
    'sensitivityButton',
    'paretoButton',
    'ao_run_btn',
    'ao_apply_btn'
]);

const PROFILE_RECOVERY_GUARDED_ACTIONS = Object.freeze([
    'runMonteCarlo',
    'runBacktest',
    'runParameterSweep',
    'runSweepSelfTest',
    'findAndDisplayBest',
    'showSensitivityAnalysis',
    'showParetoDialog'
]);

function setProfileRecoveryControlsBlocked(blocked) {
    PROFILE_RECOVERY_CONTROL_IDS.forEach(id => {
        const control = /** @type {HTMLButtonElement} */ (document.getElementById(id));
        if (!control) return;
        if (blocked) {
            if (!Object.prototype.hasOwnProperty.call(control.dataset, 'profileRecoveryWasDisabled')) {
                control.dataset.profileRecoveryWasDisabled = control.disabled ? 'true' : 'false';
            }
            control.disabled = true;
            control.title = window.__personDataBlocker?.message || '';
            control.setAttribute('aria-disabled', 'true');
            return;
        }
        if (Object.prototype.hasOwnProperty.call(control.dataset, 'profileRecoveryWasDisabled')) {
            control.disabled = control.dataset.profileRecoveryWasDisabled === 'true';
            delete control.dataset.profileRecoveryWasDisabled;
        }
        control.removeAttribute('aria-disabled');
        control.title = '';
    });
}

function installProfileRecoveryActionGuards(updateStatus) {
    if (typeof window === 'undefined' || window.__profileRecoveryActionGuardsInstalled) return;
    PROFILE_RECOVERY_GUARDED_ACTIONS.forEach(actionName => {
        const action = window[actionName];
        if (typeof action !== 'function') return;
        window[actionName] = function guardedProfileAction(...args) {
            const personStatus = readHouseholdPersonStatus();
            const blocker = window.__profileRecoveryBlocker || (!personStatus.ready ? personStatus : null);
            if (blocker) {
                updateStatus(
                    blocker.status && blocker.status !== 'corrupt' ? blocker.message : `Profil-Recovery erforderlich: ${blocker.message || 'Profildaten konnten nicht sicher geladen werden.'}`,
                    'error'
                );
                return false;
            }
            return action.apply(this, args);
        };
    });
    window.__profileRecoveryActionGuardsInstalled = true;
}

function installProfileRecoveryLocalActionGuards(updateStatus) {
    if (typeof window === 'undefined' || window.__profileRecoveryLocalActionGuardsInstalled) return;
    document.addEventListener('click', event => {
        const action = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target)?.closest?.('#ao_run_btn, #ao_apply_btn'));
        const blocker = window.__profileRecoveryBlocker || window.__personDataBlocker;
        if (!action || !blocker) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setProfileRecoveryControlsBlocked(true);
        window.__profileRecoveryBlockedActionCount =
            (window.__profileRecoveryBlockedActionCount || 0) + 1;
        updateStatus(
            blocker.status && blocker.status !== 'corrupt' ? blocker.message : `Profil-Recovery erforderlich: ${blocker.message || 'Profildaten konnten nicht sicher geladen werden.'}`,
            'error'
        );
    }, true);

    const runButton = /** @type {HTMLButtonElement} */ (document.getElementById('ao_run_btn'));
    if (runButton && typeof MutationObserver === 'function') {
        const observer = new MutationObserver(() => {
            if ((window.__profileRecoveryBlocker || window.__personDataBlocker) && !runButton.disabled) {
                setProfileRecoveryControlsBlocked(true);
            }
        });
        observer.observe(runButton, {
            attributes: true,
            attributeFilter: ['disabled']
        });
        window.__profileRecoveryAutoOptimizeObserver = observer;
    }
    window.__profileRecoveryLocalActionGuardsInstalled = true;
}

/**
 * @returns Ergebnis der Operation.
 */
export function initSimulatorProfileSelection() {
    const listContainer = document.getElementById('simProfileList');
    const statusEl = document.getElementById('simProfileStatus');
    if (!listContainer) {
        renderSuiteHousehold(null);
        if (typeof window !== 'undefined') {
            window.__profileRecoveryBlocker = {
                message: 'Profilverbund konnte nicht initialisiert werden; die Bedarfsmigration bleibt ausstehend.'
            };
        }
        setProfileRecoveryControlsBlocked(true);
        renderSimulatorProfileRecovery('Profil-Recovery erforderlich: Profilverbund-Steuerelement fehlt.');
        if (statusEl) {
            statusEl.dataset.kind = 'error';
            statusEl.textContent = 'Profil-Recovery erforderlich: Profilverbund-Steuerelement fehlt.';
        }
        return;
    }
    const renderList = profiles => {
        listContainer.textContent = 'Haushalt: ' + profiles.filter(profile => profile.belongsToHousehold !== false)
            .map(profile => profile.name || profile.id).join(', ');
    };

    const updateStatus = (message, kind = '') => {
        renderSimulatorProfileRecovery(window.__profileRecoveryBlocker ? message : null);
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.dataset.kind = kind;
    };

    const blockProfileSimulation = (blocker) => {
        renderSuiteHousehold(null);
        if (typeof window !== 'undefined') {
            window.__profilverbundTranchenOverride = null;
            window.__profilverbundPreferAggregates = false;
            window.__profilverbundMinimumFlexProfiles = null;
            window.__profileRecoveryBlocker = blocker || {
                message: 'Profildaten konnten nicht sicher geladen werden.'
            };
        }
        setProfileRecoveryControlsBlocked(true);
        renderSimulatorProfileRecovery(`Profil-Recovery erforderlich: ${window.__profileRecoveryBlocker.message || 'Profildaten konnten nicht sicher geladen werden.'}`);
    };

    const unblockProfileSimulation = () => {
        if (typeof window !== 'undefined') {
            window.__profileRecoveryBlocker = null;
        }
        setProfileRecoveryControlsBlocked(false);
        renderSimulatorProfileRecovery(null);
    };

    installProfileRecoveryActionGuards(updateStatus);
    installProfileRecoveryLocalActionGuards(updateStatus);

    const applySelectionUnchecked = () => {
        let readiness = readHouseholdPersonStatus();
        setDocumentPersonStatus(document, readiness);
        window.__personDataBlocker = readiness.ready || readiness.status === 'corrupt' ? null : readiness;
        if (readiness.status === 'corrupt') throw readiness.error;
        if (readiness.status === 'household-limit') { blockProfileSimulation(readiness); showPersonDataStatus(readiness); updateStatus(readiness.message, 'error'); return false; }
        if (readiness.status === 'deferred') {
            showPersonDataStatus(readiness); setProfileRecoveryControlsBlocked(true); updateStatus(readiness.message); return false;
        }
        assertProfileContextReady();
        const profiles = listProfiles();
        if (!profiles.length) {
            blockProfileSimulation({ message: 'Keine Profile vorhanden.' });
            updateStatus('Keine Profile vorhanden.', 'error');
            return false;
        }

        const plan = readSimulatorHouseholdPlan();
        const planValues = plan.status === 'valid' ? plan.entry.values : null;
        const selected = profiles.filter(p => p.belongsToHousehold !== false);
        const currentId = getCurrentProfileId();
        readiness = readHouseholdPersonStatus();
        setDocumentPersonStatus(document, readiness);
        window.__personDataBlocker = readiness.ready ? null : readiness;
        renderSuiteHousehold(selected);
        showPersonDataStatus(readiness);

        if (readiness.status === 'demo') {
            const age = /** @type {HTMLInputElement} */ (document.getElementById('p1StartAlter'));
            if (age && age.value === '') age.value = '65';
            unblockProfileSimulation(); return true;
        }
        if (!readiness.ready) {
            window.__profileRecoveryBlocker = null;
            window.__profilverbundTranchenOverride = null;
            window.__profilverbundMinimumFlexProfiles = null;
            for (const id of ['p1StartAlter', 'r2StartAlter']) {
                const field = /** @type {SimulatorControl} */ (document.getElementById(id)); if (field) field.value = '';
            }
            showPersonDataStatus(readiness); setProfileRecoveryControlsBlocked(true); updateStatus(readiness.message);
            updateStartPortfolioDisplay({ homes: [] }); return false;
        }

        // Convert each profile into simulator inputs before aggregation.
        const balanceRaw = persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY);
        const referenceYear = personReferenceYear(balanceRaw ? JSON.parse(balanceRaw).annualPeriodMetadata : null);
        const profileInputs = selected.map(meta => {
            const data = getProfileData(meta.id);
            try {
                const inputs = buildSimulatorInputsFromProfileData(data, { referenceYear, planValues });
                const legacyHouseholdNeeds = planValues ? null : Object.fromEntries(
                    HOUSEHOLD_SIMULATOR_NEED_FIELD_IDS.map(fieldId => [
                        fieldId,
                        data?.[`sim_${fieldId}`]
                    ])
                );
                return {
                    data,
                    profileId: meta.id,
                    name: meta.name || meta.id,
                    inputs,
                    legacyHouseholdNeeds
                };
            } catch (error) {
                /** @type {AppError} */
                const profileError = new Error(
                    `Profil ${meta.name || meta.id}: ${error?.message || 'Profildaten konnten nicht sicher geladen werden.'}`
                );
                profileError.name = 'SimulatorProfileStateError';
                profileError.code = error?.code || 'PROFILE_STATE_LOAD_FAILED';
                profileError.profileId = meta.id;
                profileError.storageKey = error?.storageKey || null;
                profileError.raw = error?.raw ?? null;
                profileError.cause = error;
                throw profileError;
            }
        });

        const primaryId = getHouseholdPrimaryProfileId(selected);

        const { combined, warnings } = combineSimulatorProfiles(profileInputs, primaryId, { planValues });

        if (!combined) {
            const blockingMessage = Array.isArray(warnings) && warnings.length
                ? warnings.join(' ')
                : 'Profil-Daten fuer Simulator fehlen.';
            blockProfileSimulation({ message: blockingMessage });
            updateStatus(blockingMessage, 'error');
            return false;
        }

        const legacySelection = planValues ? null : selectLegacyHouseholdSimulatorNeeds(profileInputs.map(entry => ({
            legacyValues: entry.legacyHouseholdNeeds,
            profileDefaults: {
                startFloorBedarf: entry.inputs.startFloorBedarf,
                startFlexBedarf: entry.inputs.startFlexBedarf,
                minimumFlexAnnual: entry.inputs.minimumFlexAnnual
            }
        })));
        const householdNeedsState = planValues ? { values: null, warning: '' } : initializeHouseholdSimulatorNeeds(legacySelection);
        const householdNeedOverrides = householdNeedsState.values;
        const minimumFlexOverridden = Object.prototype.hasOwnProperty.call(
            householdNeedOverrides || {},
            'minimumFlexAnnual'
        );

        if (typeof window !== 'undefined') {
            // Overrides allow the simulator to use aggregated tranche data.
            const override = Array.isArray(combined.detailledTranches) ? combined.detailledTranches : null;
            window.__profilverbundTranchenOverride = override;
            window.__profilverbundPreferAggregates = !override;
            // A manual household minimum has no attributable per-profile split.
            window.__profilverbundMinimumFlexProfiles = !planValues && !minimumFlexOverridden
                && Array.isArray(combined.minimumFlexProfiles)
                ? combined.minimumFlexProfiles
                : null;
        }

        applyCombinedInputsToUI(combined, selected.length, householdNeedOverrides, planValues);
        renderSimulatorPlanTrial(document, { project: true });
        unblockProfileSimulation();
        initializePersonOverrides(profileInputs, primaryId, referenceYear);
        initializePlannedInflows(profileInputs, referenceYear);
        initializePlanOverview();
        syncTranchenToInputs({ silent: true });
        updateStartPortfolioDisplay({ homes: combined.home || [] });
        refreshAssumptionFillStatus();

        const statusWarnings = [
            ...(Array.isArray(warnings) ? warnings : []),
            householdNeedsState.warning
        ].filter(Boolean);
        if (statusWarnings.length > 0) {
            updateStatus(statusWarnings.join(' '), 'error');
        } else {
            updateStatus(`Haushalt: ${selected.length} ${selected.length === 1 ? 'Person' : 'Personen'}`, 'ok');
        }
        return true;
    };

    const applySelection = () => {
        try {
            return applySelectionUnchecked();
        } catch (error) {
            listContainer.innerHTML = '';
            blockProfileSimulation(error);
            updateStatus(
                `Profil-Recovery erforderlich: ${error?.message || 'Profildaten konnten nicht sicher geladen werden.'}`,
                'error'
            );
            return false;
        }
    };

    if (window.__personMigrationDeferred) { applySelection(); return; }
    let profiles;
    try {
        profiles = listProfiles();
    } catch (error) {
        blockProfileSimulation(error);
        updateStatus(
            `Profil-Recovery erforderlich: ${error?.message || 'Die Profilregistry konnte nicht sicher geladen werden.'}`,
            'error'
        );
        return;
    }
    renderList(profiles);

    applySelection();
    return () => {
        renderList(listProfiles());
        if (applySelection() === true) document.dispatchEvent?.(new CustomEvent('simulator:household-applied'));
    };
}

function applyCombinedInputsToUI(combined, selectedCount, householdNeedOverrides, planValues) {
    const setValue = (id, value) => {
        const el = /** @type {SimulatorControl} */ (document.getElementById(id));
        if (!el) return;
        if (!writeBoundHouseholdPlanField(el, value)) el.value = value;
        if (el.tagName?.toLowerCase() === 'select') syncSelectionText(el);
    };
    const setChecked = (id, value) => {
        const el = /** @type {SimulatorControl} */ (document.getElementById(id));
        if (!el) return;
        el.checked = Boolean(value);
    };
    const setHouseholdNeedValue = (id, value) => {
        setValue(id, value);
        const el = /** @type {SimulatorControl} */ (document.getElementById(id));
        if (el) el.dataset.householdNeedLastValidValue = String(value);
    };
    const setSelect = (id, value) => {
        const el = /** @type {SimulatorControl} */ (document.getElementById(id));
        if (!el) return;
        el.value = value;
    };

    setValue('simStartVermoegen', Math.round(combined.startVermoegen || 0));
    setValue('depotwertAlt', Math.round(combined.depotwertAlt || 0));
    setValue('tagesgeld', (combined.tagesgeld || 0).toLocaleString('de-DE'));
    setValue('geldmarktEtf', (combined.geldmarktEtf || 0).toLocaleString('de-DE'));
    setValue('einstandAlt', Math.round(combined.einstandAlt || 0));

    setValue('goldAllokationAktiv', combined.goldAktiv ? 'true' : 'false');
    setValue('goldAllokationProzent', combined.goldZielProzent || 0);
    setValue('goldFloorProzent', combined.goldFloorProzent || 0);
    setValue('rebalancingBand', combined.rebalancingBand || 0);
    setValue('goldSteuerfrei', combined.goldSteuerfrei ? 'true' : 'false');

    setValue('liquidityRunwayYears', combined.liquidityRunwayYears || 5);
    setValue('entnahmeStrategie', combined.decumulation?.mode || 'standard');
    setValue('bondTargetFactor', combined.decumulation?.bondTargetFactor ?? '');
    setValue('drawdownTrigger', combined.decumulation?.drawdownTrigger ?? '');
    setValue('bondRefillThreshold', combined.decumulation?.bondRefillThreshold ?? '');
    setValue('maxSkimPctOfEq', combined.maxSkimPctOfEq || 0);
    setValue('maxBearRefillPctOfEq', combined.maxBearRefillPctOfEq || 0);
    if (planValues) {
        const projected = projectPlanToSimulator(planValues);
        for (const id of Object.keys(SIMULATOR_PLAN_FIELD_MAP)) {
            const value = projected[id];
            if (typeof value === 'boolean') setChecked(id, value);
            else setValue(id, value ?? '');
        }
    }
    // Ohne bestätigten Plan bleiben die aktuellen Dynamic-Flex-Rahmendaten erhalten.
    // Nach Bestätigung gilt die gemeinsame Projektion.
    syncDynamicFlexPresetSelection();
    refreshDynamicFlexControls();
    refreshThreeBucketControls();
    setHouseholdNeedValue('startFloorBedarf', resolveHouseholdSimulatorNeed(
        'startFloorBedarf', combined.startFloorBedarf || 0, householdNeedOverrides
    ));
    setHouseholdNeedValue('startFlexBedarf', resolveHouseholdSimulatorNeed(
        'startFlexBedarf', combined.startFlexBedarf || 0, householdNeedOverrides
    ));
    setHouseholdNeedValue('minimumFlexAnnual', resolveHouseholdSimulatorNeed(
        'minimumFlexAnnual', combined.minimumFlexAnnual || 0, householdNeedOverrides
    ));
    setValue('marketCapeRatio', combined.marketCapeRatio || 0);

    setValue('p1StartAlter', combined.startAlter || 0);
    setSelect('p1Geschlecht', combined.geschlecht || 'm');
    setValue('p1SparerPauschbetrag', combined.startSPB || 0);
    setSelect('p1KirchensteuerPct', Math.round((combined.kirchensteuerSatz || 0) * 100));
    setValue('p1Monatsrente', combined.renteMonatlich || 0);
    setValue('p1StartInJahren', combined.renteStartOffsetJahre || 0);
    setSelect('rentAdjMode', combined.rentAdjMode || 'fix');
    setValue('rentAdjPct', combined.rentAdjPct || 0);

    setValue('r2Steuerquote', combined.partner?.steuerquotePct ?? 0);
    const hasPartner = selectedCount > 1;
    setChecked('chkPartnerAktiv', hasPartner);
    setSelect('r2Geschlecht', combined.partner?.geschlecht || 'w');
    setValue('r2StartAlter', combined.partner?.startAlter || 0);
    setValue('r2StartInJahren', combined.partner?.startInJahren || 0);
    setValue('r2Monatsrente', combined.partner?.monatsrente || 0);
    setValue('r2SparerPauschbetrag', combined.partner?.sparerPauschbetrag || 0);
    setValue('r2KirchensteuerPct', combined.partner?.kirchensteuerPct || 0);

    const lockIds = [
        'p1StartAlter',
        'p1Geschlecht', 'p1SparerPauschbetrag', 'p1KirchensteuerPct', 'p1Monatsrente', 'p1StartInJahren',
        'r2Geschlecht', 'r2StartAlter', 'r2StartInJahren', 'r2Monatsrente', 'r2SparerPauschbetrag', 'r2KirchensteuerPct', 'r2Steuerquote',
        'rentAdjMode',
        'rentAdjPct',
        'chkPartnerAktiv'
    ];
    lockIds.forEach(id => {
        const el = /** @type {SimulatorControl} */ (document.getElementById(id));
        if (!el) return;
        el.disabled = true;
        el.dataset.profileFieldOrigin = selectedCount > 1
            ? 'Aus den ausgewählten Haushaltsprofilen übernommen; im Profilverbund gesperrt.'
            : 'Aus dem ausgewählten Profil übernommen; im Profilverbund gesperrt.';
        if (el.ownerDocument && el.parentNode) setFieldState(el, 'adopted', el.dataset.profileFieldOrigin);
    });
    // Darstellung nach dem vorhandenen Lock, ohne erneute Modus-/Sperrentscheidung.
    refreshRentAdjustmentPresentation();
    refreshPartnerPresentation();

    for (const id of ['tagesgeld', 'geldmarktEtf']) {
        const field = /** @type {SimulatorControl} */ (document.getElementById(id));
        if (field?.ownerDocument && field.parentNode) {
            setFieldState(field, 'adopted', selectedCount > 1
                ? 'Aus den ausgewählten Haushaltsprofilen aggregiert.' : 'Aus dem ausgewählten Profil übernommen.');
        }
    }

    const sectionRente2 = document.getElementById('sectionRente2');
    if (sectionRente2) {
        sectionRente2.style.display = hasPartner ? 'block' : 'none';
    }


}
