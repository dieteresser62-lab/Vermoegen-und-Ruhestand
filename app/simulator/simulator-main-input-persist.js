import { updateSimulatorPlanTrial, renderSimulatorPlanTrial, getSimulatorPlanTrial } from './simulator-plan-trial.js';
"use strict";

import { readSimulatorHouseholdPlan, projectPlanToSimulator, SIMULATOR_PLAN_FIELD_MAP } from '../profile/household-plan.js';
import { SUPPORTED_PFLEGE_GRADES } from './simulator-data.js';
import { updateStartPortfolioDisplay } from './simulator-portfolio.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { MONTE_CARLO_PARAMETER_LIMITS } from './monte-carlo-parameters.js';
import {
    HOUSEHOLD_SIMULATOR_NEED_FIELD_IDS,
    ensureHouseholdSimulatorNeedsMigrationPending,
    isHouseholdSimulatorNeedField,
    writeHouseholdSimulatorNeedOverride
} from './simulator-household-needs-persistence.js';

// Diese Felder hatten vor H1 keinen Simulator-Autosave; der Altweg bleibt erhalten.
const PLAN_ONLY_PERSIST_IDS = new Set(['liquidityRunwayYears', 'maxSkimPctOfEq', 'maxBearRefillPctOfEq']);

const CARE_GRADE_FIELD_IDS = SUPPORTED_PFLEGE_GRADES.flatMap(grade => [
    `pflegeStufe${grade}Zusatz`,
    `pflegeStufe${grade}FlexCut`,
    `pflegeStufe${grade}Mortality`
]);

export function initInputPersistence() {
    // Vor Fachrefreshs explizit an dieses Simulatordokument binden.
    getSimulatorPlanTrial(document);
    const allInputs = [
        'startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual', 'flexBudgetAnnual', 'flexBudgetYears', 'flexBudgetRecharge', 'marketCapeRatio',
        'dynamicFlexPreset', 'dynamicFlexShowAdvanced',
        'dynamicFlex', 'horizonMethod', 'horizonYears', 'survivalQuantile', 'goGoActive', 'goGoMultiplier',
        'longevityMode', 'longevityQuantileShift', 'longevityRelativePct', 'longevityBufferYears',
        'pflegefallLogikAktivieren', 'pflegeModellTyp', ...CARE_GRADE_FIELD_IDS,
        'pflegeMaxFloor', 'pflegeRampUp', 'pflegeMinDauer', 'pflegeMaxDauer', 'pflegeKostenDrift',
        'pflegeRegionalZuschlag', 'pflegeKostenStaffelPreset',
        'liquidityRunwayYears', 'maxSkimPctOfEq', 'maxBearRefillPctOfEq',
        'entnahmeStrategie', 'bondTargetFactor', 'drawdownTrigger', 'bondRefillThreshold',
        'mcAnzahl', 'mcDauer', 'mcBlockSize', 'mcSeed', 'mcMethode', 'rngMode',
        'mcWorkerCount', 'mcWorkerBudget', 'useCapeSampling',
        'mcStartYearMode', 'mcStartYearFilter', 'mcStartYearHalfLife', 'mcExcludeEstimatedHistory'
    ];
    const initialPlan = readSimulatorHouseholdPlan();
    const projected = initialPlan.status === 'valid' ? projectPlanToSimulator(initialPlan.entry.values) : null;
    const householdNeedsState = projected ? { values: null } : ensureHouseholdSimulatorNeedsMigrationPending();
    const persistedHouseholdNeeds = householdNeedsState.values;

    const renderHouseholdNeedWriteResult = (element, result, eventType) => {
        const message = result.ok ? '' : result.message;
        element.dataset.householdNeedPersistenceError = result.ok ? 'false' : 'true';
        element.setCustomValidity?.(message);
        if (!result.ok && eventType === 'change') element.reportValidity?.();
    };
    allInputs.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            // Persistence Logic
            const storageKey = 'sim_' + id;
            const isHouseholdNeed = isHouseholdSimulatorNeedField(id);
            const isPlanField = Object.hasOwn(SIMULATOR_PLAN_FIELD_MAP, id);
            const storedVal = ['dynamicFlexPreset', 'dynamicFlexShowAdvanced'].includes(id) && projected ? null : !projected && PLAN_ONLY_PERSIST_IDS.has(id) ? null : projected && isPlanField ? projected[id] ?? '' : isHouseholdNeed
                ? (persistedHouseholdNeeds?.[id] ?? null)
                : persistenceStorage.getItem(storageKey);
            if (id === 'mcAnzahl' && (storedVal === null || storedVal === '')) {
                element.value = String(MONTE_CARLO_PARAMETER_LIMITS.runs.default);
            }
            // noPersist allows specific fields to opt out of persisted storage.
            if (!element.dataset.noPersist && storedVal !== null && storedVal !== "") {
                if (element.type === 'checkbox') {
                    element.checked = (storedVal === 'true' || storedVal === true);
                } else if (element.type === 'radio') {
                    // Radio buttons usually have same name but different IDs.
                } else {
                    element.value = storedVal;
                    if (isHouseholdNeed) {
                        element.dataset.householdNeedLastValidValue = String(storedVal);
                    }
                }
            }

            const persistAndRefresh = (event) => {
                try {
                    // Save to Storage
                    if (!element.dataset.noPersist) {
                        const plan = isPlanField ? readSimulatorHouseholdPlan() : null;
                        if (plan?.status === 'valid') {
                            // Gekoppelte Bedarfsänderungen gemeinsam bestätigen. Ein leerer
                            // Nachbar bleibt beim gespeicherten Wert; das Ereignisfeld wird
                            // auch bei leerer Eingabe validiert und niemals still ausgelassen.
                            const patchIds = isHouseholdNeed ? HOUSEHOLD_SIMULATOR_NEED_FIELD_IDS.filter(fieldId => {
                                const field = document.getElementById(fieldId);
                                return field && !field.dataset.noPersist && (fieldId === id || String(field.value ?? '').trim() !== '');
                            }) : [id];
                            const renderPlanWriteResult = result => patchIds.forEach(fieldId => {
                                const field = document.getElementById(fieldId);
                                renderHouseholdNeedWriteResult(field, result, fieldId === id ? event?.type : undefined);
                            });
                            try {
                                updateSimulatorPlanTrial(document, patchIds);
                                renderSimulatorPlanTrial(document);
                                renderPlanWriteResult({ ok: true });
                            } catch (error) {
                                renderPlanWriteResult({ ok: false, message: error.message });
                                renderSimulatorPlanTrial(document);
                                return;
                            }
                        } else if (isPlanField && (initialPlan.status === 'valid' || getSimulatorPlanTrial(document).read().confirmed)) {
                            return;
                        } else if (isHouseholdNeed) {
                            const currentHouseholdNeeds = {};
                            HOUSEHOLD_SIMULATOR_NEED_FIELD_IDS.forEach(fieldId => {
                                const field = document.getElementById(fieldId);
                                if (field) currentHouseholdNeeds[fieldId] = field.value;
                            });
                            const fallbackHouseholdNeeds = {};
                            HOUSEHOLD_SIMULATOR_NEED_FIELD_IDS.forEach(fieldId => {
                                const field = document.getElementById(fieldId);
                                const fallback = field?.dataset?.householdNeedLastValidValue;
                                if (fallback !== undefined) fallbackHouseholdNeeds[fieldId] = fallback;
                            });
                            const result = writeHouseholdSimulatorNeedOverride(
                                id,
                                currentHouseholdNeeds,
                                persistenceStorage,
                                fallbackHouseholdNeeds
                            );
                            if (result.ok) {
                                element.dataset.householdNeedLastValidValue = result.state.values[id];
                            }
                            renderHouseholdNeedWriteResult(element, result, event?.type);
                        } else if (PLAN_ONLY_PERSIST_IDS.has(id)) {
                            // Erst bestätigte Bereiche erhalten den neuen Planbinder.
                        } else if (['dynamicFlexPreset', 'dynamicFlexShowAdvanced'].includes(id) &&
                            (initialPlan.status === 'valid' || getSimulatorPlanTrial(document).read().confirmed)) {
                            // Auch nach Bestätigung im selben Dokument und späterem
                            // Planverlust bleiben Preset und Darstellung seitenlokal.
                        } else if (element.type === 'checkbox') {
                            persistenceStorage.setItem(storageKey, element.checked);
                        } else if (element.type !== 'radio') {
                            persistenceStorage.setItem(storageKey, element.value);
                        }
                    }
                } catch (error) {
                    if (error?.code !== 'PERSISTENCE_RELOAD_REQUIRED') throw error;
                    const host = document.getElementById('simProfileStatus');
                    if (host) {
                        host.hidden = false;
                        host.dataset.kind = 'error';
                        host.textContent = error.message;
                    }
                    // Keine Erfolgsbaseline oder weitere Autosave-Fortsetzung veröffentlichen.
                    return;
                }
                // Trigger UI Update
                updateStartPortfolioDisplay();
            };

            if (element.type === 'radio' || element.type === 'checkbox' || element.tagName === 'SELECT') {
                element.addEventListener('change', persistAndRefresh);
            } else {
                element.addEventListener('input', persistAndRefresh);
                element.addEventListener('change', persistAndRefresh);
            }
        }
    });
}
