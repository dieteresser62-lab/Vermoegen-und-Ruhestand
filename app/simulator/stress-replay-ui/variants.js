/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
import { STRESS_REPLAY_LIMITS } from '../stress-replay-contract.js';
import { readVariantPatch, comparisonErrorDiagnostic, comparisonResultIsUsable, formatStressReplayUiError, IDLE_COMPARISON_STATE } from './values.js';

/** Bindungen teilen den lebenden Zustand genau eines Controllers. */
export function createVariantsBindings(scope) {
    const { createVariant, createWorkspace, runComparison, saveWorkspace, beginSummary, completeSummary } = scope;

    /** @param {{focusComparison?: boolean; focusOnError?: boolean; preferredVariantId?: string; publishSummary?: boolean}} [options] */
    const computeComparison = ({ focusComparison = false, focusOnError = true, preferredVariantId, publishSummary = true } = {}) => {
        scope.comparison = null;
        scope.comparisonResults = [];
        if (!scope.workspaceState.workspace || scope.workspaceState.compatibility?.readOnly === true) {
            scope.comparisonState = IDLE_COMPARISON_STATE;
            scope.render();
            return null;
        }
        try {
            const summaryContext = publishSummary && scope.workspaceProvenance
                ? beginSummary('workshop', scope.workspaceState.workspace.baselineSnapshot,
                    { pathFingerprint: scope.workspaceState.workspace.sourceIdentity?.pathFingerprint }, { workshopProvenance: scope.workspaceProvenance })
                : null;
            const computed = runComparison({
                workspace: scope.workspaceState.workspace,
                sourceIdentity: scope.workspaceState.workspace.sourceIdentity,
                sourceScenarioLog: scope.sourceScenarioLog
            });
            if (!comparisonResultIsUsable(computed)) {
                throw Object.assign(new Error('Die Vergleichsberechnung lieferte kein verwendbares Ergebnis.'), {
                    code: 'STRESS_REPLAY_COMPARISON_EMPTY'
                });
            }
            scope.comparison = computed.comparison;
            scope.comparisonResults = computed.results || [];
            scope.comparisonState = { status: 'success', error: null };
            scope.render();
            if (focusComparison) scope.focusReplayTarget(scope.element('stressReplayComparison'));
            if (summaryContext) void completeSummary(summaryContext, scope.comparison, { preferredVariantId });
            return scope.comparison;
        } catch (error) {
            const diagnostic = comparisonErrorDiagnostic(error);
            scope.comparisonState = { status: 'error', error: diagnostic };
            scope.status(`Variantenvergleich fehlgeschlagen [${diagnostic.code}]: ${diagnostic.message}`, { error: true });
            scope.render();
            if (focusOnError) scope.focusReplayTarget(scope.element(focusComparison ? 'stressReplayComparison' : 'stressReplayStatus'));
            return null;
        }
    };

    const recomputeComparison = (options = {}) => {
        if (!scope.beginBusyAction()) return null;
        try {
            return computeComparison(options);
        } finally {
            scope.finishBusyAction();
        }
    };

    const persistVariants = async variants => {
        const current = scope.workspaceState.workspace;
        const orderedVariants = [
            variants.find(variant => variant.role === 'baseline'),
            ...variants.filter(variant => variant.role !== 'baseline')
                .sort((left, right) => left.id.localeCompare(right.id))
        ].filter(Boolean);
        const workspace = createWorkspace({
            path: current.path,
            sourceIdentity: current.sourceIdentity,
            baselineSnapshot: current.baselineSnapshot,
            variants: orderedVariants,
            createdAtUtc: current.createdAtUtc,
            updatedAtUtc: new Date(Math.max(
                Date.now(),
                new Date(current.createdAtUtc).getTime(),
                new Date(current.updatedAtUtc).getTime()
            )).toISOString()
        });
        if (!scope.workspacePersonDataContext?.deviationApplied) await saveWorkspace(workspace, { confirmReplace: true });
        scope.workspaceState = { ...scope.workspaceState, workspace };
        return workspace;
    };

    const addVariant = async () => {
        if (!scope.beginBusyAction()) return null;
        try {
            if (!scope.workspaceState.workspace || scope.workspaceState.compatibility?.readOnly === true) return null;
            if (scope.workspaceState.workspace.variants.length >= STRESS_REPLAY_LIMITS.maximumVariants) {
                scope.status('Maximal drei Alternativen neben der Baseline sind zulässig.', { error: true, focus: true });
                return null;
            }
            const form = scope.element('stressReplayVariantEditor');
            if (form?.checkValidity?.() === false) {
                form.reportValidity?.();
                scope.status('Bitte korrigiere die markierten Variantenfelder.', { error: true });
                return null;
            }
            const label = String(scope.element('stressReplayVariantLabel')?.value || '').trim();
            const id = `variant-${Date.now()}-${scope.workspaceState.workspace.variants.length}`;
            const variant = createVariant({
                id,
                label,
                baselineInputs: scope.workspaceState.workspace.baselineSnapshot,
                patch: readVariantPatch(scope.element('stressReplayVariantEditor'))
            });
            await persistVariants([...scope.workspaceState.workspace.variants, variant]);
            scope.comparison = null;
            scope.comparisonResults = [];
            scope.comparisonState = IDLE_COMPARISON_STATE;
            const computedComparison = computeComparison({ focusComparison: true, preferredVariantId: variant.id });
            scope.element('stressReplayVariantEditor')?.reset?.();
            scope.updateConditionalFields();
            scope.patchPreview = null;
            scope.patchPreviewError = null;
            scope.renderBaselineValues();
            scope.render();
            scope.status(computedComparison
                ? `Variante „${variant.label}“ wurde auf dem fixierten Pfad berechnet.`
                : `Variante „${variant.label}“ wurde gespeichert; der Variantenvergleich ist fehlgeschlagen.`, {
                error: !computedComparison
            });
            return variant;
        } catch (error) {
            scope.status(`Variante konnte nicht berechnet werden: ${formatStressReplayUiError(error)}`, { error: true, focus: true });
            return null;
        } finally {
            scope.finishBusyAction();
        }
    };

    const removeVariant = async variantId => {
        if (!scope.beginBusyAction()) return false;
        try {
            if (!scope.workspaceState.workspace || variantId === 'baseline' || scope.workspaceState.compatibility?.readOnly === true) return false;
            const variants = scope.workspaceState.workspace.variants.filter(variant => variant.id !== variantId);
            if (variants.length === scope.workspaceState.workspace.variants.length) return false;
            await persistVariants(variants);
            const computedComparison = computeComparison();
            scope.status(computedComparison
                ? 'Variante entfernt; der Vergleich wurde neu berechnet.'
                : 'Variante entfernt; der Variantenvergleich ist fehlgeschlagen.', {
                error: !computedComparison,
                focus: !computedComparison
            });
            return true;
        } catch (error) {
            scope.status(`Variante konnte nicht entfernt werden: ${formatStressReplayUiError(error)}`, { error: true, focus: true });
            return false;
        } finally {
            scope.finishBusyAction();
        }
    };
    return { computeComparison, recomputeComparison, persistVariants, addVariant, removeVariant };
}
