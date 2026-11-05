/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */

/** Bindungen teilen den lebenden Zustand genau eines Controllers. */
export function createLifecycleBindings(scope) {
    const { resolveCompatibility, loadWorkspace } = scope;

    const initialize = () => {
        if (scope.initialized) return scope.workspaceState;
        scope.initialized = true;
        scope.workspaceState = loadWorkspace({ currentCompatibility: resolveCompatibility() });
        scope.applyBusy(false);
        scope.setExpertFieldsExpanded(false);
        scope.renderBaselineValues();
        scope.updateConditionalFields();
        if (scope.workspaceState.workspace && scope.workspaceState.compatibility?.readOnly !== true) {
            scope.computeComparison({ focusOnError: false, publishSummary: false });
        }
        scope.render();
        if (scope.workspaceState.status === 'corrupt') {
            scope.status(`Der gespeicherte Stresspfad ist beschädigt und wurde nicht automatisch gelöscht: ${scope.workspaceState.error?.message || 'unbekannter Fehler'}`, { error: true });
        } else if (scope.workspaceState.workspace) {
            if (scope.comparisonState.status !== 'error') {
                scope.status(scope.workspaceState.compatibility?.readOnly
                    ? 'Gespeicherter Stresspfad wurde nur zur Inspektion geladen.'
                    : 'Gespeicherter Stresspfad wurde geladen.');
            }
        } else {
            scope.status('Starte zuerst einen Monte-Carlo-Lauf.');
        }
        scope.element('stressReplayFixButton')?.addEventListener?.('click', () => void scope.fixSelectedScenario());
        scope.element('stressReplayExportButton')?.addEventListener?.('click', () => scope.exportActiveWorkspace());
        scope.element('stressReplayExportCsvButton')?.addEventListener?.('click', () => scope.exportActiveWorkspace('csv'));
        scope.element('stressReplayImportButton')?.addEventListener?.('click', () => {
            if (!scope.busy) scope.element('stressReplayImportFile')?.click?.();
        });
        scope.element('stressReplayDiscardButton')?.addEventListener?.('click', () => void scope.discardActiveWorkspace());
        scope.element('stressReplayExpertToggle')?.addEventListener?.('click', scope.toggleExpertFields);
        scope.element('stressReplayVariantEditor')?.addEventListener?.('input', () => {
            if (scope.busy) return;
            scope.updateConditionalFields();
            scope.previewEditorPatch();
        });
        scope.element('stressReplayAddVariantButton')?.addEventListener?.('click', () => void scope.addVariant());
        scope.element('stressReplayVariantList')?.addEventListener?.('click', event => {
            if (scope.busy) return;
            const action = event?.target?.closest?.('[data-stress-replay-action]');
            if (!action) return;
            const variantId = action.dataset.variantId;
            if (action.dataset.stressReplayAction === 'remove') void scope.removeVariant(variantId);
            if (action.dataset.stressReplayAction === 'recompute') {
                const computedComparison = scope.recomputeComparison({ focusComparison: true });
                if (computedComparison) scope.status('Vergleich auf dem unveränderten fixierten Pfad neu berechnet.');
            }
        });
        scope.element('stressReplayImportFile')?.addEventListener?.('change', async event => {
            const file = event?.target?.files?.[0];
            if (!file) return;
            if (!scope.beginBusyAction()) return;
            try {
                await scope.performImportSerialized(await file.text());
            } finally {
                event.target.value = '';
                scope.finishBusyAction();
            }
        });
        return scope.workspaceState;
    };
    return { initialize };
}
