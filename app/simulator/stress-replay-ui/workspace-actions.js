/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
import { freezePersonDataContext } from '../simulator-person-overrides.js';
import { inspectStressReplayImportV1 } from '../stress-replay-persistence.js';
import { serializeStressReplayComparisonCsvV1 } from '../stress-replay-export.js';
import { formatStressReplayUiError, EMPTY_STATE, IDLE_COMPARISON_STATE } from './values.js';

/** Bindungen teilen den lebenden Zustand genau eines Controllers. */
export function createWorkspaceActionsBindings(scope) {
    const { documentRef, resolveCompatibility, discardWorkspace, replaceFromImport, buildExport, serializeExport, triggerDownload } = scope;

    const exportActiveWorkspace = (format = 'json') => {
        if (!scope.beginBusyAction()) return null;
        try {
            if (!scope.workspaceState.workspace) {
                scope.status('Es gibt keinen aktiven Stresspfad zum Exportieren.', { error: true, focus: true });
                return null;
            }
            const exportDocument = buildExport({
                personDataContext: scope.workspacePersonDataContext,
                workspace: scope.workspaceState.workspace,
                comparison: scope.comparison
            });
            const serialized = format === 'csv' ? serializeStressReplayComparisonCsvV1(exportDocument) : serializeExport(exportDocument);
            triggerDownload(serialized, `stress-pfad-replay-v1.${format === 'csv' ? 'csv' : 'json'}`, { documentRef: documentRef, mimeType: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
            scope.status('Stresspfad-Export wurde erstellt.');
            return serialized;
        } catch (error) {
            scope.status(`Export fehlgeschlagen: ${formatStressReplayUiError(error)}`, { error: true, focus: true });
            return null;
        } finally {
            scope.finishBusyAction();
        }
    };

    const performImportSerialized = async serialized => {
        try {
            const replacing = scope.workspaceState.status !== 'empty';
            const beforeDecision = scope.decisionContext();
            if (replacing && (!await scope.askWorkspaceChange('Stresspfad importieren?',
                'Den aktiven Stresspfad durch den Import ersetzen? Der bisherige Arbeitsstand wird ersetzt.',
                'Import ersetzen', scope.element('stressReplayImportButton')) || beforeDecision !== scope.decisionContext())) {
                scope.status('Der Import wurde abgebrochen; der aktive Stresspfad bleibt erhalten.');
                return null;
            }
            const declaredContext = JSON.parse(serialized)?.personDataContext;
            // Abweichende Importe über denselben Vertragsprüfer nur inspizieren; reguläre Importe behalten ihren transaktionalen Besitzer.
            const imported = declaredContext?.deviationApplied
                ? inspectStressReplayImportV1(serialized, { currentCompatibility: resolveCompatibility() })
                : await replaceFromImport(serialized, {
                confirmReplace: replacing,
                currentCompatibility: resolveCompatibility()
            });
            scope.workspacePersonDataContext = freezePersonDataContext(imported.document?.personDataContext);
            scope.workspaceProvenance = null;
            scope.workspaceState = {
                status: imported.compatibility.status,
                workspace: imported.workspace,
                compatibility: imported.compatibility,
                error: null
            };
            scope.sourceScenarioLog = null;
            scope.comparison = imported.compatibility.readOnly === true
                ? imported.document?.comparison || null
                : null;
            scope.comparisonResults = [];
            scope.comparisonState = scope.comparison
                ? { status: 'success', error: null }
                : IDLE_COMPARISON_STATE;
            scope.patchPreview = null;
            scope.patchPreviewError = null;
            scope.renderBaselineValues();
            scope.updateConditionalFields();
            const computedComparison = imported.compatibility.readOnly !== true
                ? scope.computeComparison({ publishSummary: false })
                : scope.comparison;
            scope.render({ focusBanner: true });
            scope.status(imported.compatibility.readOnly
                ? 'Stresspfad importiert und wegen abweichender Laufzeit nur zur Inspektion geöffnet.'
                : computedComparison
                    ? 'Stresspfad importiert und als aktiver Arbeitsstand geladen.'
                    : 'Stresspfad importiert; der Variantenvergleich ist fehlgeschlagen.', {
                error: imported.compatibility.readOnly !== true && !computedComparison,
                focus: imported.compatibility.readOnly !== true && !computedComparison
            });
            return scope.workspaceState;
        } catch (error) {
            scope.status(`Import fehlgeschlagen: ${formatStressReplayUiError(error)}`, { error: true, focus: true });
            return null;
        }
    };

    const importSerialized = async serialized => {
        if (!scope.beginBusyAction()) return null;
        try {
            return await performImportSerialized(serialized);
        } finally {
            scope.finishBusyAction();
        }
    };

    const discardActiveWorkspace = async () => {
        if (!scope.beginBusyAction()) return false;
        try {
            if (!scope.workspaceState.workspace && scope.workspaceState.status !== 'corrupt') return false;
            const beforeDecision = scope.decisionContext();
            if (!await scope.askWorkspaceChange('Stresspfad verwerfen?',
                'Den aktiven Stresspfad dauerhaft verwerfen? Dies kann nicht rückgängig gemacht werden.',
                'Stresspfad verwerfen', scope.element('stressReplayDiscardButton')) || beforeDecision !== scope.decisionContext()) {
                scope.status('Der aktive Stresspfad wurde beibehalten.');
                return false;
            }
            if (!scope.workspacePersonDataContext?.deviationApplied) await discardWorkspace({ confirmDiscard: true });
            scope.workspacePersonDataContext = null;
            scope.workspaceProvenance = null;
            scope.workspaceState = EMPTY_STATE;
            scope.sourceScenarioLog = null;
            scope.comparison = null;
            scope.comparisonResults = [];
            scope.comparisonState = IDLE_COMPARISON_STATE;
            scope.patchPreview = null;
            scope.patchPreviewError = null;
            scope.renderBaselineValues();
            scope.updateConditionalFields();
            scope.render();
            scope.status('Der aktive Stresspfad wurde verworfen.', { focus: true });
            scope.focusReplayTarget(scope.element('stressReplayFixButton'));
            return true;
        } catch (error) {
            scope.status(`Verwerfen fehlgeschlagen: ${formatStressReplayUiError(error)}`, { error: true, focus: true });
            return false;
        } finally {
            scope.finishBusyAction();
        }
    };
    return { exportActiveWorkspace, performImportSerialized, importSerialized, discardActiveWorkspace };
}
