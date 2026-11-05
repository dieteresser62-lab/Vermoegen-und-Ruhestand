/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
import { renderPersonDataNotice } from '../protocol-renderer.js';
import { STRESS_REPLAY_LIMITS, createStressReplayStrategySnapshot } from '../stress-replay-contract.js';
import { openWorkshopReplay } from '../simulator-workshop-ui.js';
import { getPath, readVariantPatch, formatBaselineValue, formatStressReplayUiError } from './values.js';
import { renderStressReplayWorkspaceBanner, updateStressReplayStepStates } from './workspace-view.js';

/** Bindungen teilen den lebenden Zustand genau eines Controllers. */
export function createPresentationBindings(scope) {
    const { documentRef, previewVariantPatch, renderViews } = scope;

    const element = id => documentRef?.getElementById?.(id) || null;

    const focusReplayTarget = target => {
        if (!target) return;
        openWorkshopReplay({ documentRef: documentRef, target });
    };

    const status = (message, { error = false, focus = false } = {}) => {
        const region = element('stressReplayStatus');
        if (!region) return;
        region.textContent = message;
        region.dataset.status = error ? 'error' : 'ok';
        if (focus) focusReplayTarget(region);
    };

    const setExpertFieldsExpanded = expanded => {
        const toggle = element('stressReplayExpertToggle');
        const fields = element('stressReplayExpertFields');
        if (!toggle || !fields) return false;
        const nextExpanded = expanded === true;
        fields.hidden = !nextExpanded;
        toggle.setAttribute?.('aria-expanded', String(nextExpanded));
        toggle.textContent = nextExpanded ? 'Expertenfelder ausblenden' : 'Expertenfelder anzeigen';
        return nextExpanded;
    };

    const toggleExpertFields = () => setExpertFieldsExpanded(element('stressReplayExpertFields')?.hidden === true);

    const applyBusy = nextBusy => {
        scope.busy = nextBusy === true;
        for (const id of ['stressReplayFixButton', 'stressReplayExportButton', 'stressReplayExportCsvButton', 'stressReplayImportButton', 'stressReplayDiscardButton']) {
            const button = element(id);
            if (button) {
                const fixationUnavailable = id === 'stressReplayFixButton'
                    && (!scope.runContext || !scope.selectedScenario || scope.runContext.monteCarloParams.rngMode !== 'per-run-seed');
                button.disabled = scope.busy || fixationUnavailable;
            }
        }
        const importFile = element('stressReplayImportFile');
        if (importFile) importFile.disabled = scope.busy;
        element('stressReplayWorkspace')?.setAttribute?.('aria-busy', String(scope.busy));
    };

    const render = ({ focusBanner = false } = {}) => {
        renderStressReplayWorkspaceBanner(scope.workspaceState, { documentRef: documentRef });
        const personNotice = element('stressReplayPersonNotice');
        if (personNotice) personNotice.innerHTML = renderPersonDataNotice(scope.workspacePersonDataContext);
        const hasWorkspace = !!scope.workspaceState.workspace;
        const exportButton = element('stressReplayExportButton');
        const discardButton = element('stressReplayDiscardButton');
        if (exportButton) exportButton.disabled = !hasWorkspace || scope.busy;
        const csvButton = element('stressReplayExportCsvButton');
        if (csvButton) csvButton.disabled = !hasWorkspace || scope.busy;
        if (discardButton) discardButton.disabled = !hasWorkspace || scope.busy;
        const readOnly = scope.workspaceState.compatibility?.readOnly === true;
        const editor = element('stressReplayVariantFields');
        if (editor) editor.disabled = !hasWorkspace || readOnly || scope.busy;
        const addButton = element('stressReplayAddVariantButton');
        if (addButton) {
            addButton.disabled = !hasWorkspace || readOnly || scope.busy
                || scope.workspaceState.workspace.variants.length >= STRESS_REPLAY_LIMITS.maximumVariants
                || !String(element('stressReplayVariantLabel')?.value || '').trim()
                || !scope.patchPreview?.materialChangeGroups?.length;
        }
        renderViews({
            documentRef: documentRef,
            workspace: scope.workspaceState.workspace,
            comparison: scope.comparison,
            results: scope.comparisonResults,
            comparisonState: scope.comparisonState,
            preview: scope.patchPreview,
            previewError: scope.patchPreviewError,
            busy: scope.busy,
            readOnly
        });
        updateStressReplayStepStates({ documentRef: documentRef });
        if (focusBanner && hasWorkspace) focusReplayTarget(element('stressReplayBanner'));
    };

    const beginBusyAction = () => {
        if (scope.busy) return false;
        applyBusy(true);
        try {
            render();
        } catch (error) {
            applyBusy(false);
            throw error;
        }
        return true;
    };

    const finishBusyAction = () => {
        applyBusy(false);
        render();
    };

    const renderBaselineValues = () => {
        const outputs = documentRef?.querySelectorAll?.('[data-stress-replay-baseline]') || [];
        if (outputs.length === 0) return;
        const strategy = scope.workspaceState.workspace
            ? createStressReplayStrategySnapshot(scope.workspaceState.workspace.baselineSnapshot)
            : null;
        for (const output of outputs) {
            output.textContent = strategy
                ? formatBaselineValue(
                    getPath(strategy, output.dataset.stressReplayBaseline),
                    output.dataset.stressReplayFormat
                )
                : '—';
        }
    };

    const updateConditionalFields = () => {
        const form = element('stressReplayVariantEditor');
        if (!form) return;
        const patch = readVariantPatch(form);
        const baseline = scope.workspaceState.workspace
            ? createStressReplayStrategySnapshot(scope.workspaceState.workspace.baselineSnapshot)
            : {};
        const mode = getPath(patch, 'strategy.decumulation.mode') ?? baseline.decumulation?.mode;
        const longevityMode = getPath(patch, 'strategy.longevityMode') ?? baseline.longevityMode;
        for (const group of form?.querySelectorAll?.('[data-active-when]') || []) {
            const active = group.dataset.activeWhen === `decumulation:${mode}`
                || group.dataset.activeWhen === `longevity:${longevityMode}`;
            group.hidden = !active;
            for (const control of group.querySelectorAll?.('[data-stress-replay-path]') || []) {
                control.disabled = !active;
                if (!active) control.value = '';
            }
        }
    };

    const previewEditorPatch = () => {
        if (scope.busy) return null;
        scope.patchPreview = null;
        scope.patchPreviewError = null;
        if (!scope.workspaceState.workspace) {
            render();
            return null;
        }
        try {
            scope.patchPreview = previewVariantPatch({
                baselineInputs: scope.workspaceState.workspace.baselineSnapshot,
                patch: readVariantPatch(element('stressReplayVariantEditor'))
            });
            const region = element('stressReplayStatus');
            if (region?.dataset?.patchError) {
                status('Die Patchvorschau ist zulässig.');
                delete region.dataset.patchError;
            }
        } catch (error) {
            scope.patchPreviewError = error;
            status(formatStressReplayUiError(error), { error: true });
            const region = element('stressReplayStatus');
            if (region) region.dataset.patchError = error?.code || 'STRESS_REPLAY_PREVIEW_ERROR';
        }
        render();
        return scope.patchPreview;
    };
    return { element, focusReplayTarget, status, setExpertFieldsExpanded, toggleExpertFields, applyBusy, render, beginBusyAction, finishBusyAction, renderBaselineValues, updateConditionalFields, previewEditorPatch };
}
