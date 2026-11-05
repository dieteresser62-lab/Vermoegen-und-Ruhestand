import { shortFingerprint, terminalLabel, continuationLabel } from './values.js';

/**
 * @param workspaceState - Kontext für workspaceState.
 * @param [options] - Optionen des Aufrufers.
 * @returns {void}
 */
export function renderStressReplayWorkspaceBanner(workspaceState, {
    documentRef = globalThis.document
} = {}) {
    const banner = documentRef?.getElementById?.('stressReplayBanner');
    if (!banner) return;
    const workspace = workspaceState?.workspace;
    banner.hidden = !workspace;
    if (!workspace) return;

    const path = workspace.path;
    const readOnly = workspaceState.compatibility?.readOnly === true;
    const values = {
        stressReplayBannerMode: readOnly ? 'Nur-Lesen-Inspektion' : 'Ausführbarer Arbeitsstand',
        stressReplayBannerSource: `${path.source.scenarioKey} · Lauf ${path.source.displayRunNumber} (Index ${path.source.absoluteRunIndex}) · ${path.source.selectionMetric}`,
        stressReplayBannerHorizon: `${path.effectiveLength} von ${path.horizonYears} Jahren`,
        stressReplayBannerTerminal: terminalLabel(path.terminalStatus),
        stressReplayBannerContinuation: continuationLabel(path),
        stressReplayBannerPathFingerprint: shortFingerprint(path.pathFingerprint),
        stressReplayBannerBaselineFingerprint: shortFingerprint(workspace.baselineScenarioFingerprint)
    };
    for (const [id, value] of Object.entries(values)) {
        const element = documentRef.getElementById?.(id);
        if (element) element.textContent = value;
    }
    const mismatch = documentRef.getElementById?.('stressReplayCompatibilityReasons');
    if (mismatch) {
        mismatch.hidden = !readOnly;
        const reasons = workspaceState.compatibility?.mismatchReasons || [];
        mismatch.textContent = !readOnly ? ''
            : reasons.includes('source_identity_refix_required')
                ? 'Ausführung blockiert: Die gespeicherte Source Identity ist nur zur Inspektion verfügbar. Bitte den Stresspfad neu fixieren.'
                : `Ausführung blockiert: ${reasons.join(', ')}.`;
    }
}

/**
 * @param [options] - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function updateStressReplayStepStates({ documentRef = globalThis.document } = {}) {
    const banner = documentRef?.getElementById?.('stressReplayBanner');
    const variantFields = documentRef?.getElementById?.('stressReplayVariantFields');
    const hasWorkspace = banner?.hidden === false;
    const variantsAvailable = hasWorkspace && variantFields?.disabled === false;
    const states = {
        stressReplayStepSelect: hasWorkspace ? 'completed' : 'active',
        stressReplayStepPath: hasWorkspace ? 'active' : 'upcoming',
        stressReplayVariantWorkspace: variantsAvailable ? 'active' : 'upcoming'
    };
    const currentStepId = variantsAvailable
        ? 'stressReplayVariantWorkspace'
        : hasWorkspace ? 'stressReplayStepPath' : 'stressReplayStepSelect';
    for (const [id, state] of Object.entries(states)) {
        const step = documentRef?.getElementById?.(id);
        if (!step) continue;
        step.dataset.stepState = state;
        if (id === currentStepId) step.setAttribute?.('aria-current', 'step');
        else step.removeAttribute?.('aria-current');
    }
    return states;
}
