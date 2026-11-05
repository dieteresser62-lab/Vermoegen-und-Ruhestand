/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
import { requestPageConfirmation } from '../../shared/page-dialog.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { beginSimulationSummary, completeSimulationSummary } from '../simulator-overview-summary.js';
import { createStressReplaySourceIdentityV2, createStressReplayWorkspaceV1 } from '../stress-replay-contract.js';
import { readMonteCarloParameters } from '../monte-carlo-ui.js';
import { materializeStressReplayPathV1 } from '../stress-replay-path-materializer.js';
import { runStressReplayBaselineV1 } from '../stress-replay-runner.js';
import { createStressReplayBaselineVariantV1, createStressReplayVariantV1, previewStressReplayVariantPatchV1 } from '../stress-replay-variant.js';
import { renderStressReplayViewsV1 } from '../stress-replay-renderer.js';
import { discardStressReplayWorkspaceV1, loadStressReplayWorkspaceV1, replaceStressReplayFromImportV1, saveStressReplayWorkspaceV1, STRESS_REPLAY_ACTIVE_STORAGE_KEY } from '../stress-replay-persistence.js';
import { buildStressReplayComparisonExportV1, serializeStressReplayComparisonExportV1 } from '../stress-replay-export.js';
import { EMPTY_STATE, IDLE_COMPARISON_STATE } from './values.js';
import { defaultRunComparison, defaultCompatibility, defaultCaptureSelectedRun, downloadJson } from './defaults.js';
import { createPresentationBindings } from './presentation.js';
import { createVariantsBindings } from './variants.js';
import { createCaptureBindings } from './capture.js';
import { createWorkspaceActionsBindings } from './workspace-actions.js';
import { createLifecycleBindings } from './lifecycle.js';

/**
 * @param [options] - Optionen des Aufrufers.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createStressReplayController({
    documentRef = globalThis.document,
    windowRef = globalThis.window,
    readParameters = readMonteCarloParameters,
    resolveCompatibility = defaultCompatibility,
    requestConfirmation = requestPageConfirmation,
    captureSelectedRun = defaultCaptureSelectedRun,
    materializePath = materializeStressReplayPathV1,
    runBaseline = runStressReplayBaselineV1,
    createBaselineVariant = createStressReplayBaselineVariantV1,
    createSourceIdentity = createStressReplaySourceIdentityV2,
    createVariant = createStressReplayVariantV1,
    previewVariantPatch = previewStressReplayVariantPatchV1,
    createWorkspace = createStressReplayWorkspaceV1,
    runComparison = defaultRunComparison,
    renderViews = renderStressReplayViewsV1,
    loadWorkspace = loadStressReplayWorkspaceV1,
    saveWorkspace = saveStressReplayWorkspaceV1,
    discardWorkspace = discardStressReplayWorkspaceV1,
    replaceFromImport = replaceStressReplayFromImportV1,
    buildExport = buildStressReplayComparisonExportV1,
    serializeExport = serializeStressReplayComparisonExportV1,
    beginSummary = beginSimulationSummary,
    completeSummary = completeSimulationSummary,
    triggerDownload = downloadJson
} = {}) {

    let initialized = false;

    let workspaceState = EMPTY_STATE;

    let runContext = null;

    let workspacePersonDataContext = null;

    let workspaceProvenance = null;

    let selectedScenario = null;

    let sourceScenarioLog = null;

    let comparison = null;

    let comparisonResults = [];

    let comparisonState = IDLE_COMPARISON_STATE;

    let patchPreview = null;

    let patchPreviewError = null;

    let busy = false;

    let contextRevision = 0;

    const decisionContext = () => JSON.stringify({ contextRevision, workspaceState,
        inputs: runContext?.inputs, parameters: runContext?.monteCarloParams, cape: runContext?.useCapeSampling,
        personData: runContext?.personDataContext, scenarioIdentity: selectedScenario?.sourceIdentity,
        scenarioKey: selectedScenario?.key, sourceRows: selectedScenario?.logDataRows,
        compatibility: resolveCompatibility(), profile: persistenceStorage.getItem('rs_current_profile'),
        registry: persistenceStorage.getItem('rs_profiles_v1'),
        activeProfile: persistenceStorage.getItem('rs_active_profile'), persistedWorkspace: persistenceStorage.getItem(STRESS_REPLAY_ACTIVE_STORAGE_KEY) });

    const askWorkspaceChange = async (title, description, confirmLabel, opener) => {
        const before = decisionContext();
        const accepted = await requestConfirmation({ doc: documentRef, opener, title, description,
            confirmLabel, cancelLabel: 'Abbrechen', danger: true });
        if (before !== decisionContext()) {
            scope.status('Der Kontext hat sich geändert. Bitte prüfe den aktiven Stresspfad und starte die Aktion erneut.', { error: true });
            return false;
        }
        return accepted === true;
    };
    const scope = {
        get initialized() { return initialized; }, set initialized(value) { initialized = value; },
        get workspaceState() { return workspaceState; }, set workspaceState(value) { workspaceState = value; },
        get runContext() { return runContext; }, set runContext(value) { runContext = value; },
        get workspacePersonDataContext() { return workspacePersonDataContext; }, set workspacePersonDataContext(value) { workspacePersonDataContext = value; },
        get workspaceProvenance() { return workspaceProvenance; }, set workspaceProvenance(value) { workspaceProvenance = value; },
        get selectedScenario() { return selectedScenario; }, set selectedScenario(value) { selectedScenario = value; },
        get sourceScenarioLog() { return sourceScenarioLog; }, set sourceScenarioLog(value) { sourceScenarioLog = value; },
        get comparison() { return comparison; }, set comparison(value) { comparison = value; },
        get comparisonResults() { return comparisonResults; }, set comparisonResults(value) { comparisonResults = value; },
        get comparisonState() { return comparisonState; }, set comparisonState(value) { comparisonState = value; },
        get patchPreview() { return patchPreview; }, set patchPreview(value) { patchPreview = value; },
        get patchPreviewError() { return patchPreviewError; }, set patchPreviewError(value) { patchPreviewError = value; },
        get busy() { return busy; }, set busy(value) { busy = value; },
        get contextRevision() { return contextRevision; }, set contextRevision(value) { contextRevision = value; },
        documentRef, windowRef, readParameters, resolveCompatibility, requestConfirmation, captureSelectedRun, materializePath, runBaseline, createBaselineVariant, createSourceIdentity, createVariant, previewVariantPatch, createWorkspace, runComparison, renderViews, loadWorkspace, saveWorkspace, discardWorkspace, replaceFromImport, buildExport, serializeExport, beginSummary, completeSummary, triggerDownload, decisionContext, askWorkspaceChange
    };
    Object.assign(scope, createPresentationBindings(scope));
    Object.assign(scope, createVariantsBindings(scope));
    Object.assign(scope, createCaptureBindings(scope));
    Object.assign(scope, createWorkspaceActionsBindings(scope));
    Object.assign(scope, createLifecycleBindings(scope));

    return Object.freeze({
        initialize: scope.initialize,
        setMonteCarloContext: scope.setMonteCarloContext,
        selectScenario: scope.selectScenario,
        fixSelectedScenario: scope.fixSelectedScenario,
        exportActiveWorkspace: scope.exportActiveWorkspace,
        importSerialized: scope.importSerialized,
        discardActiveWorkspace: scope.discardActiveWorkspace,
        previewEditorPatch: scope.previewEditorPatch,
        toggleExpertFields: scope.toggleExpertFields,
        addVariant: scope.addVariant,
        removeVariant: scope.removeVariant,
        recomputeComparison: scope.recomputeComparison,
        getState: () => workspaceState
    });
}
