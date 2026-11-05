/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
import { workshopProvenanceFor } from '../simulator-overview-summary.js';
import { freezePersonDataContext } from '../simulator-person-overrides.js';
import { normalizeWidowOptions } from '../simulator-sweep-utils.js';
import { cloneValue, formatStressReplayUiError, IDLE_COMPARISON_STATE } from './values.js';

/** Bindungen teilen den lebenden Zustand genau eines Controllers. */
export function createCaptureBindings(scope) {
    const { readParameters, resolveCompatibility, captureSelectedRun, materializePath, runBaseline, createBaselineVariant, createSourceIdentity, createWorkspace, saveWorkspace } = scope;

    /** @param {{inputs?: RuntimeTypes.JsonRecord; scenarioLogs?: RuntimeTypes.JsonRecord; personDataContext?: CoreTypes.PersonDataContext | null}} [context] */
    const setMonteCarloContext = ({ inputs, scenarioLogs, personDataContext = null } = {}) => {
        scope.contextRevision++;
        if (scope.busy) return;
        scope.runContext = inputs && scenarioLogs
            ? {
                personDataContext: freezePersonDataContext(personDataContext),
                workshopProvenance: workshopProvenanceFor(inputs),
                inputs: cloneValue(inputs),
                scenarioLogs,
                monteCarloParams: cloneValue(readParameters(inputs)),
                useCapeSampling: scope.element('useCapeSampling')?.checked === true
            }
            : null;
        scope.selectedScenario = null;
        const button = scope.element('stressReplayFixButton');
        if (button) button.disabled = true;
        scope.status(scope.runContext
            ? 'Wähle ein Szenario aus, um diesen Lauf als Stresspfad zu fixieren.'
            : 'Starte zuerst einen Monte-Carlo-Lauf.');
    };

    const selectScenario = scenario => {
        scope.contextRevision++;
        if (scope.busy) return;
        scope.selectedScenario = scenario?.sourceIdentity ? scenario : null;
        const button = scope.element('stressReplayFixButton');
        if (button) button.disabled = !scope.selectedScenario;
        if (!scope.runContext) scope.status('Der Ursprungslauf ist nicht mehr verfügbar. Starte Monte Carlo erneut.', { error: true });
        else if (!scope.selectedScenario) scope.status('Wähle ein Szenario aus, um diesen Lauf als Stresspfad zu fixieren.');
        else if (scope.runContext.monteCarloParams.rngMode !== 'per-run-seed') {
            if (button) button.disabled = true;
            scope.status('Dieser Legacy-Zufallsstrom wird für Stresspfad-Replay nicht unterstützt.', { error: true });
        } else {
            scope.status(`Lauf ${scope.selectedScenario.sourceIdentity.displayRunNumber} ist zum Fixieren ausgewählt.`);
        }
    };

    const fixSelectedScenario = async () => {
        if (!scope.beginBusyAction()) return null;
        try {
            if (!scope.runContext || !scope.selectedScenario) {
                scope.status('Wähle zuerst ein Szenario aus einem abgeschlossenen Monte-Carlo-Lauf.', { error: true, focus: true });
                return null;
            }
            if (scope.runContext.monteCarloParams.rngMode !== 'per-run-seed') {
                const error = Object.assign(new Error('Unsupported RNG mode'), { code: 'STRESS_REPLAY_SOURCE_UNSUPPORTED' });
                scope.status(formatStressReplayUiError(error), { error: true, focus: true });
                return null;
            }
            scope.status('Der ausgewählte Lauf wird deterministisch nachgerechnet und abgeglichen.');
            const sourceIdentity = scope.selectedScenario.sourceIdentity;
            const beforeCapture = scope.decisionContext();
            const rerun = await captureSelectedRun({
                inputs: cloneValue(scope.runContext.inputs),
                widowOptions: normalizeWidowOptions(scope.runContext.inputs.widowOptions),
                monteCarloParams: cloneValue(scope.runContext.monteCarloParams),
                useCapeSampling: scope.runContext.useCapeSampling,
                runIndices: [sourceIdentity.absoluteRunIndex],
                generationId: `stress-replay-${Date.now()}`
            });
            if (beforeCapture !== scope.decisionContext()) {
                scope.status('Der Ursprungslauf hat sich geändert. Bitte wähle das Szenario erneut.', { error: true });
                return null;
            }
            const capture = rerun.capturesByIndex?.get?.(sourceIdentity.absoluteRunIndex);
            const sourceRows = scope.selectedScenario.logDataRows;
            if (!capture || !Array.isArray(sourceRows) || sourceRows.length === 0) {
                throw Object.assign(new Error('Capture oder Ursprungslog fehlt.'), { code: 'STRESS_REPLAY_CAPTURE_INVALID' });
            }
            const compatibility = resolveCompatibility();
            const sourceRequest = {
                inputs: scope.runContext.inputs,
                monteCarloParams: scope.runContext.monteCarloParams,
                useCapeSampling: scope.runContext.useCapeSampling
            };
            const path = materializePath({
                capture,
                sourceLogRows: sourceRows,
                sourceRequest,
                dataFingerprint: compatibility.dataFingerprint,
                engineFingerprint: compatibility.engineFingerprint,
                scenarioKey: scope.selectedScenario.key,
                selectionMetric: sourceIdentity.selectionMetric,
                selectionTieBreak: sourceIdentity.tieBreak
            });
            const baselineVariant = createBaselineVariant({ baselineInputs: scope.runContext.inputs });
            const baselineResult = runBaseline({
                path,
                baselineInputs: scope.runContext.inputs,
                sourceScenarioLog: sourceRows,
                variant: baselineVariant
            });
            if (baselineResult.technicalError || baselineResult.reconciliation?.matched !== true) {
                throw Object.assign(new Error('Baseline-Abgleich fehlgeschlagen.'), {
                    code: 'STRESS_REPLAY_BASELINE_RECONCILIATION_FAILED'
                });
            }
            const sourceIdentityContract = createSourceIdentity({
                path,
                sourceRows
            });
            const workspace = createWorkspace({
                path,
                sourceIdentity: sourceIdentityContract,
                baselineSnapshot: scope.runContext.inputs,
                variants: [baselineVariant]
            });
            const replacing = scope.workspaceState.status !== 'empty';
            const beforeDecision = scope.decisionContext();
            const confirmed = !replacing || await scope.askWorkspaceChange('Stresspfad ersetzen?',
                'Den aktiven Stresspfad durch den ausgewählten Lauf ersetzen? Der bisherige Arbeitsstand wird ersetzt.',
                'Stresspfad ersetzen', scope.element('stressReplayFixButton'));
            if (!confirmed || beforeDecision !== scope.decisionContext()) {
                scope.status('Der vorhandene Stresspfad wurde beibehalten.');
                return null;
            }
            if (!scope.runContext.personDataContext?.deviationApplied) await saveWorkspace(workspace, { confirmReplace: replacing });
            scope.workspacePersonDataContext = scope.runContext.personDataContext;
            scope.workspaceProvenance = scope.runContext.workshopProvenance;
            scope.workspaceState = { status: 'executable', workspace, compatibility, error: null };
            scope.sourceScenarioLog = cloneValue(sourceRows);
            scope.comparison = null;
            scope.comparisonResults = [];
            scope.comparisonState = IDLE_COMPARISON_STATE;
            scope.patchPreview = null;
            scope.patchPreviewError = null;
            scope.renderBaselineValues();
            scope.updateConditionalFields();
            const computedComparison = scope.computeComparison();
            scope.render({ focusBanner: true });
            scope.status(computedComparison
                ? 'Stresspfad fixiert. Baseline und Fingerprints wurden abgeglichen.'
                : 'Stresspfad fixiert und abgeglichen; der Variantenvergleich ist fehlgeschlagen.', {
                error: !computedComparison,
                focus: !computedComparison
            });
            return workspace;
        } catch (error) {
            scope.status(formatStressReplayUiError(error), { error: true, focus: true });
            return null;
        } finally {
            scope.finishBusyAction();
        }
    };
    return { setMonteCarloContext, selectScenario, fixSelectedScenario };
}
