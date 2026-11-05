import { readHouseholdPersonStatus } from '../../shared/person-data-status.js';
import { featureFlags } from '../../shared/feature-flags.js';
import { activeMonteCarloRun, monteCarloNavigationRegistration, createMonteCarloGenerationId, setActiveMonteCarloRun } from './state.js';
import { setMonteCarloRunBusy } from '../monte-carlo-ui.js';
import { executeMonteCarloRun } from './execution.js';

/**
 * Koordiniert die Monte-Carlo-Simulation (UI-Orchestrator)
 *
 * Diese Funktion ist der zentrale Einstiegspunkt für Monte-Carlo-Simulationen.
 * Sie orchestriert:
 * - UI-Vorbereitung (Fortschrittsbalken, Button-States)
 * - Eingabedaten-Sammlung (Portfolio, Renten, Pflege, MC-Parameter)
 * - Aufruf der DOM-freien Simulation (monte-carlo-runner.js)
 * - Szenario-Analyse und Auswahl charakteristischer Runs
 * - Ergebnis-Darstellung (Perzentile, KPIs, Worst-Run, Pflegefall-Statistik)
 *
 * Die eigentliche Simulationslogik ist DOM-frei; UI-spezifische Aufgaben
 * (Fortschrittsanzeige, Benutzereingaben, Ergebnisdarstellung) werden hier gebündelt.
 *
 * @async
 * @param {object} [dependencies] - Injizierbare UI-Abhängigkeiten.
 * @returns {Promise<void> | false} Laufabschluss oder gesperrter Start
 * @throws {Error} Bei Validierungs- oder Berechnungsfehlern
 */
export function runMonteCarlo(dependencies = {}) {
    // Auch direkte Modulaufrufe sind gesperrt, bevor UI/Navigation/Worker anlaufen.
    if (globalThis.window?.__profileRecoveryBlocker || globalThis.window?.__personDataBlocker
        || !readHouseholdPersonStatus().ready) return false;
    if (activeMonteCarloRun) return activeMonteCarloRun.promise;

    const registration = monteCarloNavigationRegistration();
    if (registration?.guard.isBusy()) return Promise.resolve();
    const runState = {
        generationId: createMonteCarloGenerationId(),
        controller: new AbortController(),
        status: 'preparing',
        registration,
        documentRef: globalThis.document,
        ui: null,
        promise: null,
        cancelPromise: null,
        dependencies: dependencies && typeof dependencies === 'object' ? dependencies : {}
    };
    setActiveMonteCarloRun(runState);
    setMonteCarloRunBusy(runState.documentRef, true);
    if (registration) registration.revision++;
    runState.promise = Promise.resolve().then(() => executeMonteCarloRun(runState)).finally(() => {
        if (activeMonteCarloRun === runState) setActiveMonteCarloRun(null);
        setMonteCarloRunBusy(runState.documentRef, false);
        registration?.notify();
    });
    registration?.notify();
    return runState.promise;
}
