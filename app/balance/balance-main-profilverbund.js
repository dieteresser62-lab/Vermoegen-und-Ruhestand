import { registeredPlanTrial } from '../shared/plan-trial.js';
import { readBalanceHouseholdPlan, stripBalancePlanInputs } from '../profile/household-plan.js';
import { readBalancePersonStatus, showPersonDataStatus } from '../shared/person-data-status.js';
/**
 * Module: Balance Main Profilverbund
 * Purpose: Manages the "Profilverbund" (Profile Compound) logic for multi-person households.
 *          It runs one household simulation and attributes the finalized action to profile-owned sources.
 * Usage: Used by balance-main.js to handle multi-profile scenarios.
 * Dependencies: profile-storage.js, profilverbund-balance.js, profilverbund-action-attribution.js,
 *               profilverbund-balance-ui.js
 */
"use strict";

import { CONFIG } from './balance-config.js';
import { UIReader } from './balance-reader.js';
import {
    createProfileOwnedBalanceState,
    listProfiles,
    saveCurrentProfileFromLocalStorage,
    updateProfileData,
    getCurrentProfileId
} from '../profile/profile-storage.js';
import {
    loadProfilverbundProfiles,
    aggregateProfilverbundInputs,
    calculateHouseholdWithdrawalNeed,
    calculateWithdrawalDistribution,
    reconcileWithdrawalLiquidity,
    buildProfilverbundAssetSummary,
    buildProfilverbundProfileSummaries
} from '../profile/profilverbund-balance.js';
import { toggleProfilverbundMode } from '../profile/profilverbund-balance-ui.js';
import {
    attributeHouseholdAction,
    reconcileAttributedThreeBucketState,
    reconcileHouseholdLiquidityKpis
} from '../profile/profilverbund-action-attribution.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { StorageManager } from './balance-storage.js';
import { renderSuiteHousehold } from '../shared/suite-frame.js';
import { prepareBalanceEngineAssets } from './balance-health-bucket.js';

/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {{dom?: object, PROFILVERBUND_STORAGE_KEYS?: {mode: string}}} options @returns Profilverbund-Handler. */
export function createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS }) {
    let profilverbundBound = false;
    const readWithdrawalMode = () => {
        const plan = readBalanceHouseholdPlan();
        return plan.status === 'valid'
            ? UIReader.readHouseholdPlanPatch(plan).householdWithdrawalMode ?? plan.entry.values.householdWithdrawalMode
            : persistenceStorage.getItem(PROFILVERBUND_STORAGE_KEYS.mode) || 'tax_optimized';
    };

    const renderProfileRecoveryBlocker = (error) => {
        renderSuiteHousehold(null);
        if (typeof window !== 'undefined') {
            window.__profilverbundDistribution = null;
            window.__profilverbundProfileSummaries = null;
        }
        const container = dom?.containers?.error;
        if (container) {
            container.className = 'error-warn';
            container.textContent = `Profil-Recovery erforderlich: ${error?.message || 'Profildaten konnten nicht sicher geladen werden.'}`;
        }
        return false;
    };

    const refreshProfilverbundBalance = () => {
        const readiness = readBalancePersonStatus();
        if (!readiness.ready && readiness.status !== 'corrupt') { showPersonDataStatus(readiness); return false; }
        const mode = readWithdrawalMode();

        let profileInputs;
        try {
            if (!registeredPlanTrial(globalThis.document)?.read().active) saveCurrentProfileFromLocalStorage();
            profileInputs = loadProfilverbundProfiles();
        } catch (error) {
            return renderProfileRecoveryBlocker(error);
        }
        renderSuiteHousehold(profileInputs);
        if (profileInputs.length < 1) {
            return false;
        }

        const currentInputs = UIReader.readAllInputs();
        const aggregated = aggregateProfilverbundInputs(profileInputs, {
            floorBedarf: currentInputs.floorBedarf,
            flexBedarf: currentInputs.flexBedarf,
            flexBudgetAnnual: currentInputs.flexBudgetAnnual,
            flexBudgetYears: currentInputs.flexBudgetYears,
            flexBudgetRecharge: currentInputs.flexBudgetRecharge
        });
        calculateWithdrawalDistribution(profileInputs, aggregated, mode);
        calculateWithdrawalDistribution(profileInputs, aggregated, 'proportional');
        return true;
    };

    const buildProfileEngineInput = (sharedInput, entry) => {
        const inputs = entry?.inputs || {};
        const output = { ...sharedInput };
        const perProfileKeys = [
            'aktuellesAlter',
            'tagesgeld',
            'geldmarktEtf',
            'depotwertAlt',
            'depotwertNeu',
            'goldWert',
            'costBasisAlt',
            'costBasisNeu',
            'goldCost',
            'tqfAlt',
            'tqfNeu',
            'renteAktiv',
            'renteMonatlich',
            'kirchensteuerSatz',
            'sparerPauschbetrag',
            'goldAktiv',
            'goldZielProzent',
            'goldFloorProzent',
            'goldSteuerfrei',
            'rebalancingBand'
        ];
        perProfileKeys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(inputs, key)) {
                output[key] = inputs[key];
            }
        });
        output.detailledTranches = Array.isArray(entry?.tranches) ? entry.tranches : [];
        return output;
    };

    const runProfilverbundProfileSimulations = (sharedInput, profiles, householdLastState = null, { engineApi = globalThis.window?.EngineAPI, withdrawalMode = readWithdrawalMode(), publish = true } = {}) => {
        const grossSharedInput = sharedInput;
        const grossProfiles = profiles;
        // Ein ausgewähltes fremdes Mitglied rechnet regulär allein. Die
        // Mehrpersonenattribution darf weder verlangt noch künstlich dupliziert werden.
        if (profiles.length === 1) {
            const entry = profiles[0];
            const persistedInput = { ...buildProfileEngineInput(sharedInput, entry), finalizeThreeBucketAction: true };
            const input = prepareBalanceEngineAssets(persistedInput).input;
            const result = engineApi.simulateSingleYear(input, householdLastState);
            if (result?.error) throw result.error;
            if (!result?.newState || !result?.ui) throw new Error('Profilverbund: Einzelrechnung liefert keinen gültigen Stand.');
            /** @type {import('../../typcheck/balance-ui.js').ProfileRuns} */
            const runs = [{ profileId: entry.profileId, name: entry.name, input: persistedInput, persistedInput,
                ui: result.ui, newState: result.newState, balanceState: entry.balanceState }];
            runs.householdResult = /** @type {import("../../typcheck/rechenkern.js").EngineSuccess} */ (result);
            runs.householdInput = persistedInput;
            runs.finalAction = result.ui.action;
            runs.threeBucketDiagnosis = result.ui.threeBucket || null;
            if (publish && typeof window !== 'undefined') window.__profilverbundActionResults = [{
                profileId: entry.profileId, name: entry.name, action: result.ui.action, input,
                spending: result.ui.spending, targetLiquidity: result.ui.zielLiquiditaet
            }];
            return runs;
        }
        const mode = withdrawalMode;
        const householdNeed = calculateHouseholdWithdrawalNeed(profiles, {
            floorBedarf: sharedInput.floorBedarf,
            flexBedarf: sharedInput.flexBedarf,
            flexBudgetAnnual: sharedInput.flexBudgetAnnual,
            flexBudgetYears: sharedInput.flexBudgetYears,
            flexBudgetRecharge: sharedInput.flexBudgetRecharge
        });
        const oldestAge = Math.max(...profiles.map(profile => Number(profile.inputs?.aktuellesAlter) || 0));
        const persistedHouseholdInput = {
            ...sharedInput,
            ...(sharedInput.goGoActive && oldestAge > 80 ? { partnerAlter: oldestAge } : {}),
            detailledTranches: buildProfilverbundAssetSummary(profiles).mergedTranches,
            finalizeThreeBucketAction: true,
            deferTaxSettlement: true
        };
        const operative = prepareBalanceEngineAssets(persistedHouseholdInput, profiles);
        const householdInput = operative.input;
        profiles = operative.profiles;
        const householdResult = engineApi.simulateSingleYear(householdInput, householdLastState);
        if (householdResult?.error) {
            throw householdResult.error;
        }
        const decidedAnnualWithdrawal = Number(householdResult?.ui?.spending?.monatlicheEntnahme) * 12;
        if (!Number.isFinite(decidedAnnualWithdrawal) || decidedAnnualWithdrawal < 0) {
            throw new Error('Profilverbund: Haushalts-Engine lieferte keinen gueltigen Entnahmebedarf.');
        }

        let distribution = calculateWithdrawalDistribution(
            profiles,
            { ...householdNeed, netWithdrawal: decidedAnnualWithdrawal },
            mode
        );
        const allocatedTotal = distribution.items.reduce((sum, item) => sum + (item.withdrawalAmount || 0), 0);
        if (distribution.remaining > 0.01 || Math.abs(allocatedTotal - distribution.totalNeed) > 0.01) {
            throw new Error(`Profilverbund: ${distribution.remaining.toFixed(2)} EUR Haushaltsbedarf konnten keinem Profil zugeordnet werden.`);
        }

        const finalizedHouseholdAction = householdResult.ui?.action || {};
        let threeBucketDiagnosis = householdResult.ui?.threeBucket || null;

        const attribution = attributeHouseholdAction({
            householdAction: finalizedHouseholdAction,
            profiles,
            mode, jointAssessment: sharedInput.jointAssessment === true
        });
        threeBucketDiagnosis = reconcileAttributedThreeBucketState(threeBucketDiagnosis, finalizedHouseholdAction, attribution.finalAction);
        householdResult.ui.action = attribution.finalAction;
        if (threeBucketDiagnosis) householdResult.ui.threeBucket = threeBucketDiagnosis;
        householdResult.diagnosis = householdResult.diagnosis || /** @type {import('../../typcheck/rechenkern.js').Diagnosis} */ ({});
        householdResult.diagnosis.keyParams = householdResult.diagnosis.keyParams || /** @type {import('../../typcheck/rechenkern.js').KeyParams} */ ({});
        householdResult.diagnosis.keyParams.taxSettlement = attribution.finalAction.taxSettlement;
        if (threeBucketDiagnosis) householdResult.diagnosis.keyParams.threeBucket = threeBucketDiagnosis;
        if (attribution.finalAction.transactionDiagnostics)
            householdResult.diagnosis.transactionDiagnostics = attribution.finalAction.transactionDiagnostics;
        reconcileHouseholdLiquidityKpis({
            modelResult: householdResult,
            inputData: householdInput,
            action: attribution.finalAction
        });
        const profilesAfterAction = profiles.map(profile => {
            const action = attribution.profileActions.find(row => row.profileId === profile.profileId).action;
            const cashSpent = (action.quellen || []).filter(source => source.kind === 'liquiditaet')
                .reduce((total, source) => total + source.brutto, 0);
            const values = { ...profile.inputs };
            for (const source of action.quellen || []) {
                if (source.kind === 'liquiditaet') continue;
                const key = source.kind === 'gold' || source.category === 'gold' ? 'goldWert'
                    : source.kind === 'aktien_alt' ? 'depotwertAlt' : 'depotwertNeu';
                values[key] = Math.max(0, (values[key] || 0) - source.brutto);
            }
            values.depotwertNeu = (values.depotwertNeu || 0) + (action.verwendungen?.aktien || 0) + (action.verwendungen?.bonds || 0);
            values.goldWert = (values.goldWert || 0) + (action.verwendungen?.gold || 0);
            values.tagesgeld = Math.max(0,
                (profile.inputs.tagesgeld || 0) + (profile.inputs.geldmarktEtf || 0)
                - cashSpent + (action.verwendungen?.liquiditaet || 0));
            values.geldmarktEtf = 0;
            return { ...profile, inputs: values };
        });
        distribution = reconcileWithdrawalLiquidity(calculateWithdrawalDistribution(profilesAfterAction,
            { ...householdNeed, netWithdrawal: decidedAnnualWithdrawal }, mode), profilesAfterAction.map(profile => ({
                profileId: profile.profileId, tagesgeld: profile.inputs.tagesgeld
            })));
        const allocationByProfile = new Map(distribution.items.map(item => [item.profileId, item.withdrawalAmount]));
        const attributedByProfile = new Map(attribution.profileActions.map(entry => /** @type {[string, {profileId: string, action: import("../../typcheck/rechenkern.js").Action, taxStateNext: import("../../typcheck/rechenkern.js").TaxState}]} */ ([entry.profileId, entry])));
        /** @type {import('../../typcheck/balance-ui.js').ProfileRuns} */
        const runs = profiles.map(entry => {
            const attributed = attributedByProfile.get(entry.profileId);
            if (!attributed) {
                throw new Error(`Profilverbund: Keine Action-Attribution fuer Profil ${entry.profileId}.`);
            }
            const persistedInput = buildProfileEngineInput(grossSharedInput, grossProfiles.find(p => p.profileId === entry.profileId));
            const previousLastState = entry?.balanceState?.lastState || {};
            const withdrawalAmount = allocationByProfile.get(entry.profileId) || 0;
            return {
                profileId: entry.profileId,
                name: entry.name || entry.profileId,
                input: persistedInput,
                persistedInput,
                ui: {
                    action: attributed.action,
                    spending: { monatlicheEntnahme: withdrawalAmount / 12 },
                    zielLiquiditaet: null
                },
                newState: {
                    ...previousLastState,
                    taxState: attributed.taxStateNext
                },
                balanceState: entry.balanceState
            };
        });

        if (publish && typeof window !== 'undefined') {
            window.__profilverbundDistribution = distribution;
            window.__profilverbundActionResults = runs.map(run => ({
                profileId: run.profileId,
                name: run.name,
                action: run.ui?.action || /** @type {import("../../typcheck/balance-ui.js").Action} */ ({}),
                input: run.input,
                spending: run.ui?.spending || {},
                targetLiquidity: run.ui?.zielLiquiditaet
            }));
        }
        runs.householdResult = /** @type {import("../../typcheck/rechenkern.js").EngineSuccess} */ (householdResult);
        runs.householdInput = persistedHouseholdInput;
        runs.distribution = distribution;
        runs.finalAction = attribution.finalAction;
        runs.taxSettlements = attribution.settlements;
        runs.threeBucketDiagnosis = threeBucketDiagnosis;
        return runs;
    };

    const mergeProfilverbundActions = (runs) => {
        if (!runs?.finalAction) {
            throw new Error('Profilverbund: Finalisierte Haushaltsaktion fehlt.');
        }
        return runs.finalAction;
    };

    const writeProfileBalanceState = (profileId, nextState, { mainStatePatch = {} } = {}) => {
        const isActiveProfile = profileId === getCurrentProfileId();
        const profileState = createProfileOwnedBalanceState(nextState);
        updateProfileData(profileId, {
            [CONFIG.STORAGE.LS_KEY]: JSON.stringify(profileState)
        });
        if (isActiveProfile) {
            const currentMainState = StorageManager.loadState();
            StorageManager.saveState({
                ...currentMainState,
                ...mainStatePatch
            });
        }
    };

    const persistProfilverbundInputs = (runs) => {
        runs.forEach(run => {
            const existing = (run.balanceState && typeof run.balanceState === 'object') ? run.balanceState : {};
            const hasPlan = readBalanceHouseholdPlan({ profileId: run.profileId }).status === 'valid';
            const own = input => hasPlan ? stripBalancePlanInputs(input) : input;
            const nextState = {
                ...existing,
                inputs: own(run.persistedInput || run.input),
                profilverbundHouseholdInputs: own(runs.householdInput || existing.profilverbundHouseholdInputs)
            };
            writeProfileBalanceState(run.profileId, nextState, {
                mainStatePatch: {
                    inputs: nextState.inputs,
                    profilverbundHouseholdInputs: nextState.profilverbundHouseholdInputs
                }
            });
        });
    };

    const persistProfilverbundProfileStates = (runs, { lifecycle = null } = {}) => {
        // Steuerliche Verlustvortraege sind pro Profil autoritativ. Der
        // Haushalts-State dient nur als gemeinsamer Guardrail-Kontext und darf
        // keinen zweiten, konkurrierenden Verlusttopf fortschreiben.
        const householdNewState = runs.householdResult?.newState
            ? { ...runs.householdResult.newState, taxState: { lossCarry: 0 } }
            : null;
        runs.forEach(run => {
            const existing = (run.balanceState && typeof run.balanceState === 'object') ? run.balanceState : {};
            const hasPlan = readBalanceHouseholdPlan({ profileId: run.profileId }).status === 'valid';
            const own = input => hasPlan ? stripBalancePlanInputs(input) : input;
            const nextState = {
                ...existing,
                inputs: own(run.persistedInput || run.input),
                lastState: run.newState,
                profilverbundHouseholdInputs: own(runs.householdInput || existing.profilverbundHouseholdInputs),
                profilverbundHouseholdLastState: householdNewState || existing.profilverbundHouseholdLastState
            };
            writeProfileBalanceState(run.profileId, nextState, {
                mainStatePatch: {
                    inputs: nextState.inputs,
                    lastState: nextState.lastState,
                    profilverbundHouseholdInputs: nextState.profilverbundHouseholdInputs,
                    profilverbundHouseholdLastState: nextState.profilverbundHouseholdLastState,
                    ...(lifecycle ? { balanceStateLifecycle: lifecycle } : {})
                }
            });
        });
    };

    const initProfilverbundBalance = () => {
        if (profilverbundBound) return;
        const modeSelect = document.getElementById('profilverbund-withdrawal-mode');

        if (!modeSelect) return;

        let profiles;
        try {
            profiles = listProfiles();
        } catch (error) {
            renderProfileRecoveryBlocker(error);
            return;
        }
        if (profiles.length < 1) {
            renderSuiteHousehold([]);
            toggleProfilverbundMode(false);
            return;
        }


        const storedMode = readWithdrawalMode();

        modeSelect.value = storedMode;
        toggleProfilverbundMode(true);

        modeSelect.addEventListener('change', () => {
            try {
                const plan = readBalanceHouseholdPlan();
                if (plan.status === 'valid') {
                    const ownPlan = readBalanceHouseholdPlan({ profileId: getCurrentProfileId() });
                    if (ownPlan.scope.key !== plan.scope.key
                        && modeSelect.value !== plan.entry.values.householdWithdrawalMode) throw new Error('Die Außenperson darf den Haushaltsplan nicht ändern.');
                    // Der bestehende Formularbinder entprellt den Planwrite gemeinsam mit der Rechnung.
                    return;
                }
                persistenceStorage.setItem(PROFILVERBUND_STORAGE_KEYS.mode, modeSelect.value);
                refreshProfilverbundBalance();
            } catch (error) { renderProfileRecoveryBlocker(error); }
        });

        profilverbundBound = true;
        refreshProfilverbundBalance();
    };

    const updateProfilverbundGlobals = (profilverbundProfiles, inputData) => {
        if (profilverbundProfiles.length > 0) {
            const assetSummary = buildProfilverbundAssetSummary(profilverbundProfiles);
            const totalRenteMonatlich = assetSummary.totalRenteMonatlich;
            inputData.tagesgeld = assetSummary.totalTagesgeld;
            inputData.geldmarktEtf = assetSummary.totalGeldmarkt;
            inputData.depotwertAlt = assetSummary.totalDepotAlt;
            inputData.depotwertNeu = assetSummary.totalDepotNeu;
            inputData.costBasisAlt = assetSummary.totalCostAlt;
            inputData.costBasisNeu = assetSummary.totalCostNeu;
            inputData.goldWert = assetSummary.totalGold;
            inputData.goldCost = assetSummary.totalGoldCost;
            inputData.detailledTranches = assetSummary.mergedTranches;
            inputData.goldAktiv = assetSummary.goldStrategy.goldAktiv;
            inputData.goldBasisVermoegen = assetSummary.goldStrategy.goldBasisVermoegen;
            inputData.goldZielBetrag = assetSummary.goldStrategy.goldZielBetrag;
            inputData.goldFloorBetrag = assetSummary.goldStrategy.goldFloorBetrag;
            inputData.goldZielProzent = assetSummary.goldStrategy.goldZielProzent;
            inputData.goldFloorProzent = assetSummary.goldStrategy.goldFloorProzent;
            inputData.goldSteuerfrei = assetSummary.goldStrategy.goldSteuerfrei;
            inputData.rebalancingBand = assetSummary.goldStrategy.rebalancingBand;
            inputData.goldStrategyDiagnostics = assetSummary.goldStrategy.diagnostics;
            inputData.renteAktiv = totalRenteMonatlich > 0;
            inputData.renteMonatlich = totalRenteMonatlich;
            if (assetSummary.primaryHealthBucket) {
                inputData.healthBucket = assetSummary.primaryHealthBucket;
                inputData.healthBucketEnabled = assetSummary.primaryHealthBucket.enabled;
                inputData.healthBucketInitialAmount = assetSummary.primaryHealthBucket.initialAmount;
            }

            const aggregated = aggregateProfilverbundInputs(profilverbundProfiles, {
                floorBedarf: inputData.floorBedarf,
                flexBedarf: inputData.flexBedarf,
                flexBudgetAnnual: inputData.flexBudgetAnnual,
                flexBudgetYears: inputData.flexBudgetYears,
                flexBudgetRecharge: inputData.flexBudgetRecharge
            });
            window.__profilverbundDistribution = calculateWithdrawalDistribution(profilverbundProfiles, aggregated, readWithdrawalMode());
            window.__profilverbundProfileSummaries = buildProfilverbundProfileSummaries(profilverbundProfiles);
        } else {
            window.__profilverbundDistribution = null;
            window.__profilverbundProfileSummaries = null;
        }
    };

    return {
        refreshProfilverbundBalance,
        runProfilverbundProfileSimulations,
        mergeProfilverbundActions,
        persistProfilverbundInputs,
        persistProfilverbundProfileStates,
        initProfilverbundBalance,
        updateProfilverbundGlobals
    };
}

/** Jahresentwurf: dieselbe Haushaltsrechnung ohne Veröffentlichungen im Fenster. */
/**
 * @param input Eingabe für die bestehende Projektion.
 * @param profiles Eingabe für die bestehende Projektion.
 * @param lastState Eingabe für die bestehende Projektion.
 * @param options4 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function evaluateStoredAnnualHousehold(input, profiles, lastState, { engineApi, withdrawalMode }) {
    return createProfilverbundHandlers({}).runProfilverbundProfileSimulations(input, profiles, lastState,
        { engineApi, withdrawalMode, publish: false });
}
