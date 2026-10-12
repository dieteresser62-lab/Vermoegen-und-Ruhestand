import { initSimulatorProfileSelection } from './simulator-main-profiles.js';
import { readHouseholdPersonStatus } from '../shared/person-data-status.js';
"use strict";

/**
 * ============================================================================
 * SWEEP FIX: ZWEI-PERSONEN-HAUSHALT - PARAMETER WHITELIST & RENTE-2-INVARIANZ
 * ============================================================================
 *
 * Datum: 2025-11-07
 *
 * ÄNDERUNGEN:
 * -----------
 * 1. **Whitelist statt Blacklist für Sweep-Parameter**
 *    - Nur explizit erlaubte Parameter (SWEEP_ALLOWED_KEYS) dürfen im Sweep variiert werden
 *    - Verhindert unbeabsichtigte Änderungen an Person-2-Parametern (Rente, Alter, etc.)
 *    - Blocklist (SWEEP_BLOCK_PATTERNS) für zusätzlichen Schutz von Person-2-Feldern
 *
 * 2. **Deep-Copy der Settings pro Sweep-Zelle**
 *    - deepClone() verwendet structuredClone() (Browser-Native) oder JSON-Fallback
 *    - Verhindert Side-Effects zwischen Sweep-Cases
 *    - baseInputs werden nur EINMAL gelesen und dann geklont
 *
 * 3. **Renten-Invarianz-Wächter für Person 2**
 *    - Extrahiert Rente-2-Serie aus Year-Logs (extractR2Series)
 *    - Vergleicht Rente-2 über alle Sweep-Cases (areR2SeriesEqual)
 *    - Setzt warningR2Varies-Flag bei Abweichungen
 *    - Referenz-Serie wird beim ersten Case gesetzt
 *
 * 4. **Heatmap-Badge & Tooltip für Verstöße**
 *    - Gelber Rand (stroke-width: 3px) bei warningR2Varies
 *    - Warn-Symbol ⚠ in betroffenen Heatmap-Zellen
 *    - Tooltip: "⚠ Rente 2 variierte im Sweep"
 *    - Keine KPI-Verfälschung, nur visuelle Markierung
 * - Fixed Seed für Tests: Wird in runSweepSelfTest() hartcodiert (baseSeed = 12345)
 *
 * BETROFFENE DATEIEN:
 * -------------------
 * - simulator-main.js:     UI-Init, Monte-Carlo und Sweep-Integration (Sweep-Logik ausgelagert)
 * - simulator-sweep.js:    Sweep-Logik, Range-Parsing, Whitelist/Blocklist-Enforcement
 * - simulator-heatmap.js:  Heatmap-Rendering mit R2-Warning-Badge
 * - simulator-results.js:  Metriken-Aggregation (warningR2Varies)
 *
 * ============================================================================
 */

import { simulateOneYear } from './simulator-engine-wrapper.js';
import { formatCurrency } from './simulator-utils.js';
import { annualData } from './simulator-data.js';
import { runMonteCarlo } from './simulator-monte-carlo.js';
import { displaySweepResults, runParameterSweep } from './simulator-sweep.js';
import {
    whenBacktestIdle,
    exportBacktestLogData,
    renderBacktestLog,
    runBacktestWithRuntimeProvenance
} from './simulator-backtest.js';
import { initializeSimulatorApp } from './simulator-main-init.js';
import { runSweepSelfTest } from './simulator-main-sweep-selftest.js';
import { init as initPersistence } from '../shared/persistence-facade.js';
import { whenProfilePageReady } from '../profile/profile-navigation.js';
import { startAutomaticBacktest, startSimulatorDocument, createSimulatorInitialization, nextPaintFrame } from './simulator-auto-backtest.js';
import { initializeResultOverview, setOverviewBacktestStatus, setOverviewAutomaticPeriod, enableOverviewRevisions } from './simulator-result-overview.js';
import { activateSimulatorTab } from './simulator-main-tabs.js';
import { parseOverviewTarget } from '../overview/overview-model.js';
import { getCommonInputs } from './simulator-portfolio.js';
import { validateSimulatorInputs } from './simulator-input-validation.js';
import { createHistoricalBacktestContractProvider } from './historical-backtest-contract.js';

/**
 * DOM-Initialisierung und Event-Handler
 */
export const simulatorDocumentReady = startSimulatorDocument(document, async () => {
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
        return runBacktestWithRuntimeProvenance({ automatic: true, cohortsEnabled: false, focus: false, beforeRun: nextPaintFrame,
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
            document.getElementById('simStartJahr').value = String(period.startYear);
            document.getElementById('simEndJahr').value = String(period.endYear);
            setOverviewAutomaticPeriod(period);
        },
        run: runBacktestWithRuntimeProvenance
    });
    opened = true;
    enableOverviewRevisions();
    // Ein gescheiterter UI-Start ist keine erfolgreiche Dokumentbereitschaft.
    await initialization.settle();
    openSimulatorOverviewTarget(window.location, { ready: targetReady && typeof window.EngineAPI?.simulateSingleYear === 'function' });
    window.__simulatorOpeningBacktestDone = true;
}).catch(error => {
    window.__simulatorOpeningBacktestError = error?.message || String(error);
    setOverviewBacktestStatus('technical_error', error);
});

export function openSimulatorOverviewTarget(location, { ready = false, blocked = Boolean(window.__profileRecoveryBlocker),
    activate = activateSimulatorTab } = {}) {
    const request = parseOverviewTarget('simulator', location);
    if (!ready || blocked || !request) return false;
    const tabs = { backtest: 'backtesting', 'monte-carlo': 'montecarlo', annahmen: 'annahmen', werkstatt: 'werkstatt' };
    return activate(tabs[request.target]);
}

// Globale Funktionen für HTML onclick-Handler.
window.runMonteCarlo = runMonteCarlo;
window.runBacktest = runBacktestWithRuntimeProvenance;
window.runParameterSweep = runParameterSweep;
window.displaySweepResults = displaySweepResults;
window.formatCurrency = formatCurrency;
window.runSweepSelfTest = runSweepSelfTest;
window.renderBacktestLog = renderBacktestLog;
window.exportBacktestLogData = exportBacktestLogData;

// Für Parity Smoke Test / Legacy Entry Points.
window.simulateOneYear = simulateOneYear;
window.annualData = annualData;
