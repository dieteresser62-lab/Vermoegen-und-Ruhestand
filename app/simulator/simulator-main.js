import { initSimulatorProfileSelection } from './simulator-main-profiles.js';
import { readHouseholdPersonStatus } from '../shared/person-data-status.js';
"use strict";

import { simulateOneYear } from './simulator-engine-wrapper.js';
import { formatCurrency } from './simulator-utils.js';
import { annualData } from './simulator-data.js';
import { runMonteCarlo, restoreMonteCarloResult } from './simulator-monte-carlo.js';
import {
    whenBacktestIdle,
    exportBacktestLogData,
    renderBacktestLog,
    runBacktestWithRuntimeProvenance
} from './simulator-backtest.js';
import { initializeSimulatorApp } from './simulator-main-init.js';
import { init as initPersistence } from '../shared/persistence-facade.js';
import { whenProfilePageReady } from '../profile/profile-navigation.js';
import { startAutomaticBacktest, startSimulatorDocument, createSimulatorInitialization, nextPaintFrame } from './simulator-auto-backtest.js';
import { initializeResultOverview, setOverviewBacktestStatus, setOverviewAutomaticPeriod, enableOverviewRevisions } from './simulator-result-overview.js';
import { activateSimulatorTab } from './simulator-main-tabs.js';
import { parseOverviewTarget } from '../overview/overview-model.js';
import { getCommonInputs } from './simulator-portfolio.js';
import { validateSimulatorInputs } from './simulator-input-validation.js';
import { createHistoricalBacktestContractProvider } from './historical-backtest-contract.js';
import { applyHistoricalDataYearFields } from './historical-backtest-ui.js';

/**
 * DOM-Initialisierung und Event-Handler
 */
export const simulatorDocumentReady = startSimulatorDocument(document, async () => {
    // Jahresgrenzen aus den Daten zuerst, damit gespeicherte Startjahre nicht am fehlenden Maximum hängen bleiben.
    applyHistoricalDataYearFields(document);
    const persistenceReady = initPersistence();
    const profileReady = whenProfilePageReady();
    let targetReady = false;
    const initialization = createSimulatorInitialization({ persistenceReady, profileReady,
        onReadinessError: () => { if (window.__profileRecoveryBlocker) initSimulatorProfileSelection(); },
        initialize: async () => { await initializeSimulatorApp(); targetReady = true; }, isBlocked: () => Boolean(window.__profileRecoveryBlocker) });
    const { initialized } = initialization;
    let opened = false;
    initializeResultOverview({ runMonteCarlo, activateTab: activateSimulatorTab, rerunBacktest: async () => {
        await whenBacktestIdle();
        if (!opened || !readHouseholdPersonStatus().ready || window.__profileRecoveryBlocker || !window.EngineAPI) return;
        return runBacktestWithRuntimeProvenance({ automatic: true, focus: false, beforeRun: nextPaintFrame,
            isBlocked: () => Boolean(window.__profileRecoveryBlocker) });
    } });
    await startAutomaticBacktest(document, {
        persistenceReady: () => persistenceReady, profileReady: () => profileReady,
        initializationReady: () => initialized,
        isBlocked: () => Boolean(window.__profileRecoveryBlocker),
        personStatus: () => readHouseholdPersonStatus(),
        engineReady: () => typeof window.EngineAPI?.simulateSingleYear === 'function',
        provider: () => createHistoricalBacktestContractProvider(),
        validate: () => validateSimulatorInputs(getCommonInputs()),
        status: (phase, error) => {
            setOverviewBacktestStatus(phase, error);
            if (phase === 'technical_error') window.__simulatorOpeningBacktestError = error?.message || 'Simulator konnte nicht gestartet werden.';
        },
        frame: nextPaintFrame,
        setPeriod: period => {
            /** @type {HTMLInputElement} */ (document.getElementById('simStartJahr')).value = String(period.startYear);
            /** @type {HTMLInputElement} */ (document.getElementById('simEndJahr')).value = String(period.endYear);
            setOverviewAutomaticPeriod(period);
        },
        run: runBacktestWithRuntimeProvenance
    });
    opened = true;
    enableOverviewRevisions();
    // Ein gescheiterter UI-Start ist keine erfolgreiche Dokumentbereitschaft.
    await initialization.settle();
    if (targetReady && !window.__profileRecoveryBlocker && readHouseholdPersonStatus().ready && window.EngineAPI) {
        // Nach Handbuch oder anderer Seite: gleiches Monte-Carlo-Ergebnis wieder anzeigen (TD-2).
        await restoreMonteCarloResult().catch(error => console.warn('[MC] Ergebnis nicht wiederhergestellt.', error));
    }
    openSimulatorOverviewTarget(window.location, { ready: targetReady && typeof window.EngineAPI?.simulateSingleYear === 'function' });
    window.__simulatorOpeningBacktestDone = true;
}).catch(error => {
    window.__simulatorOpeningBacktestError = error?.message || String(error);
    setOverviewBacktestStatus('technical_error', error);
});

/**
 * @param location
 * @param {object} [options]
 * @param {boolean} [options.ready]
 * @param {boolean} [options.blocked]
 * @param [options.activate]
 * @returns {boolean} Ergebnis der Operation.
 */
export function openSimulatorOverviewTarget(location, { ready = false, blocked = Boolean(window.__profileRecoveryBlocker),
    activate = activateSimulatorTab } = {}) {
    const request = parseOverviewTarget('simulator', location);
    if (!ready || blocked || !request) return false;
    const tabs = { backtest: 'backtesting', 'monte-carlo': 'montecarlo', annahmen: 'annahmen' };
    return activate(tabs[request.target]);
}

// Globale Funktionen für HTML onclick-Handler.
window.runMonteCarlo = runMonteCarlo;
window.runBacktest = runBacktestWithRuntimeProvenance;
window.formatCurrency = formatCurrency;
window.renderBacktestLog = renderBacktestLog;
window.exportBacktestLogData = exportBacktestLogData;

// Alte direkte Einstiege (Konsole, Typvertrag).
window.simulateOneYear = simulateOneYear;
window.annualData = annualData;
