import { initSimulatorPlanTrial, getSimulatorPlanTrial } from './simulator-plan-trial.js';
"use strict";

import { migrateHouseholdPlans } from '../profile/household-plan-migration.js';
import { initializeHouseholdPlanPage } from '../profile/household-plan-dialog.js';
import { prepareHistoricalData, updateStartPortfolioDisplay } from './simulator-portfolio.js';
import { initTranchenStatus, syncTranchenToInputs } from '../tranches/depot-tranchen-status.js';
import { initializePflegeUIControls } from './simulator-ui-pflege.js';
import { initRente2ConfigWithLocalStorage } from './simulator-ui-rente.js';
import { initAutoOptimizeUI, setAutoOptimizeDefaults } from './auto_optimize_ui.js';
import { initSweepDefaultsWithLocalStorageFallback } from './simulator-sweep.js';
import { initializeBacktestUI } from './simulator-backtest.js';
import { initInputPersistence } from './simulator-main-input-persist.js';
import { initRentAdjModeUI } from './simulator-main-rent-adjust.js';
import { initDynamicFlexControls, refreshDynamicFlexControls, syncDynamicFlexPresetSelection } from './simulator-main-dynamic-flex.js';
import { initSweepUIControls } from './simulator-main-sweep-ui.js';
import { initTabSwitching } from './simulator-main-tabs.js';
import { initResetButton } from './simulator-main-reset.js';
import { initPartnerToggle } from './simulator-main-partner.js';
import { initStressPresetOptions } from './simulator-main-stress.js';
import { initSimulatorProfileSelection } from './simulator-main-profiles.js';
import { initMonteCarloMethodControls, initMonteCarloStartYearControls } from './monte-carlo-ui.js';
import { initThreeBucketControls } from './simulator-main-3bucket.js';
import { initStressReplayUI } from './stress-replay-ui.js';
import { initMonteCarloResultCockpit } from './mc-result-cockpit.js';
import { initWorkshopUI } from './simulator-workshop-ui.js';
import { initializeAssumptionsUI } from './simulator-assumptions-ui.js';
import { initializeSimulatorTrancheAdapter } from './simulator-portfolio-display.js';

/**
 * Prüft Engine-Version
 */
export function selfCheckEngine() {
    if (typeof window.EngineAPI === 'undefined' || typeof window.EngineAPI.getVersion !== 'function') {
        const footer = document.getElementById('engine-mismatch-footer');
        if (footer) {
            footer.textContent = `FEHLER: Die Engine-Datei 'engine.js' konnte nicht geladen werden!`;
            footer.style.display = 'block';
        }
        return;
    }

    const version = window.EngineAPI.getVersion();
    void version;
}

export async function initializeSimulatorApp() {
    // Beim Aufschub werden auch die schreibenden Defaults-/Persistenz-Hooks
    // ausgelassen. Nur Haushaltshinweis und Rechensperren werden installiert.
    if (window.__personMigrationDeferred) { initSimulatorProfileSelection(); return; }
    let refreshProfileSelection;
    const initializePlanPage = options => initializeHouseholdPlanPage({ doc: document, win: window, ...options, migrate: async options => {
        const result = await migrateHouseholdPlans(options);
        if (result.status === 'migrated') refreshProfileSelection?.();
        return result;
    } });
    await initializePlanPage();
    selfCheckEngine();
    prepareHistoricalData();

    getSimulatorPlanTrial(document);
    initInputPersistence();
    initDynamicFlexControls();
    initThreeBucketControls();
    initializePflegeUIControls();

    initRentAdjModeUI();

    initPartnerToggle();

    // Backtest-spezifische UI-Hooks sind ausgelagert, um die Main-Initialisierung zu entschlacken.
    initializeBacktestUI();

    initStressPresetOptions();
    initMonteCarloMethodControls();
    initMonteCarloStartYearControls();
    initMonteCarloResultCockpit();
    initStressReplayUI();

    initTabSwitching();
    initWorkshopUI();

    // Sweep defaults with localStorage persistence
    initSweepDefaultsWithLocalStorageFallback();
    initSweepUIControls();

    // Auto-Optimize UI initialization
    setAutoOptimizeDefaults();
    initAutoOptimizeUI();

    // Partner/Rente-2 configuration with localStorage persistence
    initRente2ConfigWithLocalStorage();

    // Der Profil-/Personenkontext muss vor dem ersten rechenabhängigen
    // Portfolioleser bereitstehen (auch bei ausschließlich Registrywerten).
    refreshProfileSelection = initSimulatorProfileSelection({ initializePlanPage });
    initSimulatorPlanTrial({ refresh: () => { syncDynamicFlexPresetSelection(); refreshDynamicFlexControls(); } });
    initResetButton();

    // Tranchen automatisch in die Eingabefelder übernehmen (ohne Alert)
    syncTranchenToInputs({ silent: true });
    updateStartPortfolioDisplay();

    // Depot-Tranchen Status Badge
    // Zeigt Status der geladenen detaillierten Tranchen an
    initTranchenStatus('tranchenStatusBadge');
    initializeSimulatorTrancheAdapter();
    initializeAssumptionsUI();
}
