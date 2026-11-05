import { getPageNavigationGuard } from '../../shared/navigation-guard-dialog.js';
import { WorkerRunCancelledError } from '../worker-job-runner.js';

export let activeMonteCarloRun = null;

let nextMonteCarloGeneration = 1;

const monteCarloRegistrations = new WeakMap();

export function monteCarloNavigationRegistration() {
    const doc = globalThis.document;
    if (!doc || typeof doc !== 'object') return null;
    if (!monteCarloRegistrations.has(doc)) {
        const guard = getPageNavigationGuard(doc);
        // Ergebnis und Revision gehören zum Dokument, auch bei BFCache-Rückkehr.
        // Der globale Singleflight-Controller ist dagegen nur dessen aktiver Lauf.
        // Ein gemerktes Ergebnis (TD-2) geht beim Seitenwechsel nicht verloren.
        const state = { guard, resultAvailable: false, resultRemembered: false, revision: 0 };
        const registration = guard.register('simulator-monte-carlo', {
            read: () => {
                const run = activeMonteCarloRun?.registration === state ? activeMonteCarloRun : null;
                const lost = state.resultAvailable && !state.resultRemembered;
                return {
                    phase: run?.status || 'idle',
                    operationId: run?.generationId || null,
                    revision: state.revision,
                    result: lost,
                    message: run
                        ? 'Laufende Rechnung wird abgebrochen – trotzdem wechseln?'
                            + (lost ? '\nErgebnis geht verloren – trotzdem wechseln?' : '')
                        : undefined
                };
            },
            cancel: () => cancelMonteCarlo().then(() => true)
        });
        Object.assign(state, registration);
        monteCarloRegistrations.set(doc, state);
    }
    return monteCarloRegistrations.get(doc);
}

export function createMonteCarloGenerationId() {
    return `monte-carlo-${nextMonteCarloGeneration++}`;
}

/**
 * @returns Ergebnis der Operation.
 */
export function cancelMonteCarlo() {
    const runState = activeMonteCarloRun;
    if (!runState) return Promise.resolve(false);
    if (runState.cancelPromise) return runState.cancelPromise;

    runState.status = 'cancelling';
    runState.registration?.notify();
    runState.ui?.beginCancelling?.();
    runState.controller.abort(new WorkerRunCancelledError(runState.generationId));
    runState.cancelPromise = runState.promise.then(() => true);
    return runState.cancelPromise;
}

// Einziger Schreibzugang zur live importierten Laufbindung.
export function setActiveMonteCarloRun(runState) {
    activeMonteCarloRun = runState;
}
