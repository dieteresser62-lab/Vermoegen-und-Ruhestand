import { requestPageConfirmation } from '../shared/page-dialog.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { beginSimulationSummary, completeSimulationSummary, workshopProvenanceFor } from './simulator-overview-summary.js';
import { freezePersonDataContext } from './simulator-person-overrides.js';
import { renderPersonDataNotice } from './protocol-renderer.js';
"use strict";

import {
    STRESS_REPLAY_CONTRACT_VERSION,
    STRESS_REPLAY_LIMITS,
    createStressReplayFingerprint,
    createStressReplaySourceIdentityV2,
    createStressReplayStrategySnapshot,
    createStressReplayWorkspaceV1
} from './stress-replay-contract.js';
import { getDataVersion } from './simulator-engine-helpers.js';
import { readMonteCarloParameters } from './monte-carlo-ui.js';
import { captureMonteCarloEngineProvenance } from './monte-carlo-export.js';
import { normalizeWidowOptions } from './simulator-sweep-utils.js';
import { materializeStressReplayPathV1 } from './stress-replay-path-materializer.js';
import { runStressReplayBaselineV1, runStressReplayPathV1 } from './stress-replay-runner.js';
import {
    createStressReplayBaselineVariantV1,
    createStressReplayVariantV1,
    previewStressReplayVariantPatchV1
} from './stress-replay-variant.js';
import { buildStressReplayComparisonV1 } from './stress-replay-comparison.js';
import { renderStressReplayViewsV1 } from './stress-replay-renderer.js';
import {
    inspectStressReplayImportV1,
    discardStressReplayWorkspaceV1,
    loadStressReplayWorkspaceV1,
    replaceStressReplayFromImportV1,
    saveStressReplayWorkspaceV1,
    STRESS_REPLAY_ACTIVE_STORAGE_KEY
} from './stress-replay-persistence.js';
import {
    buildStressReplayComparisonExportV1,
    serializeStressReplayComparisonExportV1,
    serializeStressReplayComparisonCsvV1
} from './stress-replay-export.js';
import { EngineAPI } from '../../engine/index.mjs';
import { openWorkshopReplay } from './simulator-workshop-ui.js';

const EMPTY_STATE = Object.freeze({ status: 'empty', workspace: null, compatibility: null, error: null });
const IDLE_COMPARISON_STATE = Object.freeze({ status: 'idle', error: null });

function cloneValue(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function focusElement(element) {
    if (typeof element?.focus !== 'function') return;
    try {
        element.focus({ preventScroll: false });
    } catch {
        element.focus();
    }
}

function shortFingerprint(fingerprint) {
    const value = fingerprint?.value;
    return typeof value === 'string' ? `${value.slice(0, 12)}…${value.slice(-8)}` : 'nicht verfügbar';
}

function terminalLabel(status) {
    if (status === 'ruin') return 'Vermögen aufgebraucht';
    if (status === 'all_dead') return 'Haushalt verstorben';
    if (status === 'horizon_exhausted') return 'Horizont erreicht';
    return String(status || 'unbekannt');
}

function continuationLabel(path) {
    if (path?.continuation?.active === true) return 'deterministischer Restpfad nach Vermögensaufbrauch';
    return 'keine Fortsetzung erforderlich';
}

function getPath(value, path) {
    return path.split('.').reduce((cursor, segment) => cursor?.[segment], value);
}

function setPath(target, path, value) {
    const segments = path.split('.');
    let cursor = target;
    for (let index = 0; index < segments.length - 1; index++) {
        cursor[segments[index]] ??= {};
        cursor = cursor[segments[index]];
    }
    cursor[segments.at(-1)] = value;
}

function readVariantPatch(form) {
    const patch = {};
    for (const control of form?.querySelectorAll?.('[data-stress-replay-path]') || []) {
        if (control.value === '') continue;
        const type = control.dataset.valueType;
        const value = type === 'boolean' ? control.value === 'true'
            : type === 'number' ? Number(control.value)
                : control.value;
        setPath(patch, control.dataset.stressReplayPath, value);
    }
    return patch;
}

function formatBaselineValue(value, format) {
    if (typeof value === 'boolean') return value ? 'aktiv' : 'inaktiv';
    if (value === undefined || value === null || value === '') return 'nicht gesetzt';
    if (format === 'currency-eur' && Number.isFinite(value)) {
        return new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0
        }).format(value);
    }
    return String(value);
}

function formatNeedCurrency(value) {
    return Number.isFinite(value)
        ? new Intl.NumberFormat('de-DE', {
            style: 'currency', currency: 'EUR', maximumFractionDigits: 0
        }).format(value)
        : 'unbekannt';
}

function comparisonErrorDiagnostic(error) {
    const rawCode = typeof error?.code === 'string' ? error.code.trim() : '';
    const code = /^[A-Z0-9_:-]{1,80}$/.test(rawCode)
        ? rawCode
        : 'STRESS_REPLAY_COMPARISON_FAILED';
    const rawMessage = formatStressReplayUiError(error);
    const message = String(rawMessage || 'Der Variantenvergleich konnte nicht berechnet werden.')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500) || 'Der Variantenvergleich konnte nicht berechnet werden.';
    return Object.freeze({ code, message });
}

function comparisonResultIsUsable(computed) {
    return computed
        && typeof computed === 'object'
        && computed.comparison
        && typeof computed.comparison === 'object'
        && Array.isArray(computed.comparison.variants)
        && computed.comparison.variants.length > 0;
}

function defaultRunComparison({ workspace }) {
    const results = workspace.variants.map(variant => runStressReplayPathV1({
        path: cloneValue(workspace.path),
        baselineInputs: cloneValue(workspace.baselineSnapshot),
        sourceIdentity: variant.role === 'baseline' ? cloneValue(workspace.sourceIdentity) : null,
        variant
    }));
    return { comparison: buildStressReplayComparisonV1({ variants: workspace.variants, results }), results };
}

function defaultCompatibility() {
    return {
        contractVersion: STRESS_REPLAY_CONTRACT_VERSION,
        dataFingerprint: createStressReplayFingerprint(getDataVersion()),
        engineFingerprint: createStressReplayFingerprint(captureMonteCarloEngineProvenance(EngineAPI))
    };
}

async function defaultCaptureSelectedRun(options) {
    const { runMonteCarloReplayCaptureForIndices } = await import('./simulator-monte-carlo.js');
    return runMonteCarloReplayCaptureForIndices(options);
}

function downloadJson(serialized, filename, {
    documentRef = globalThis.document,
    urlApi = globalThis.URL,
    BlobCtor = globalThis.Blob,
    mimeType = 'application/json'
} = {}) {
    if (!documentRef?.createElement || typeof urlApi?.createObjectURL !== 'function' || typeof BlobCtor !== 'function') {
        throw new Error('Der Browserdownload ist in dieser Umgebung nicht verfügbar.');
    }
    const url = urlApi.createObjectURL(new BlobCtor([serialized], { type: mimeType }));
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    try {
        documentRef.body?.appendChild?.(anchor);
        anchor.click();
    } finally {
        anchor.remove?.();
        urlApi.revokeObjectURL?.(url);
    }
}

export function formatStressReplayUiError(error) {
    const code = error?.code;
    if (code === 'STRESS_REPLAY_MINIMUM_FLEX_EXCEEDS_FLEX') {
        return `Mindest-Flex p. a. (${formatNeedCurrency(error?.details?.minimumFlexAnnual)}) darf den effektiven Flex-Bedarf p. a. (${formatNeedCurrency(error?.details?.startFlexBedarf)}) nicht überschreiten.`;
    }
    if (code === 'STRESS_REPLAY_SOURCE_UNSUPPORTED') {
        return 'Dieser Monte-Carlo-Lauf nutzt den Legacy-Zufallsstrom und kann in V1 nicht fixiert werden.';
    }
    if (code === 'STRESS_REPLAY_REPLACE_CONFIRMATION_REQUIRED') {
        return 'Der vorhandene Stresspfad wurde nicht ersetzt.';
    }
    if (code === 'STRESS_REPLAY_VERSION_UNSUPPORTED'
        && error?.details?.schemaVersion === 'StressReplaySourceIdentityV1') {
        return 'Dieser Arbeitsstand ist nur zur Inspektion verfügbar. Bitte den Stresspfad neu fixieren.';
    }
    if (code === 'STRESS_REPLAY_BASELINE_RECONCILIATION_FAILED'
        || code === 'STRESS_REPLAY_RECONCILIATION_FAILED') {
        return 'Der Pfad stimmt nicht vollständig mit dem Ursprungslauf überein und wurde nicht gespeichert.';
    }
    return error?.message || String(error || 'Unbekannter Fehler');
}

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
            status('Der Kontext hat sich geändert. Bitte prüfe den aktiven Stresspfad und starte die Aktion erneut.', { error: true });
            return false;
        }
        return accepted === true;
    };

    const element = id => documentRef?.getElementById?.(id) || null;
    const focusReplayTarget = target => {
        if (!target) return;
        openWorkshopReplay({ documentRef, target });
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
        busy = nextBusy === true;
        for (const id of ['stressReplayFixButton', 'stressReplayExportButton', 'stressReplayExportCsvButton', 'stressReplayImportButton', 'stressReplayDiscardButton']) {
            const button = element(id);
            if (button) {
                const fixationUnavailable = id === 'stressReplayFixButton'
                    && (!runContext || !selectedScenario || runContext.monteCarloParams.rngMode !== 'per-run-seed');
                button.disabled = busy || fixationUnavailable;
            }
        }
        const importFile = element('stressReplayImportFile');
        if (importFile) importFile.disabled = busy;
        element('stressReplayWorkspace')?.setAttribute?.('aria-busy', String(busy));
    };
    const render = ({ focusBanner = false } = {}) => {
        renderStressReplayWorkspaceBanner(workspaceState, { documentRef });
        const personNotice = element('stressReplayPersonNotice');
        if (personNotice) personNotice.innerHTML = renderPersonDataNotice(workspacePersonDataContext);
        const hasWorkspace = !!workspaceState.workspace;
        const exportButton = element('stressReplayExportButton');
        const discardButton = element('stressReplayDiscardButton');
        if (exportButton) exportButton.disabled = !hasWorkspace || busy;
        const csvButton = element('stressReplayExportCsvButton');
        if (csvButton) csvButton.disabled = !hasWorkspace || busy;
        if (discardButton) discardButton.disabled = !hasWorkspace || busy;
        const readOnly = workspaceState.compatibility?.readOnly === true;
        const editor = element('stressReplayVariantFields');
        if (editor) editor.disabled = !hasWorkspace || readOnly || busy;
        const addButton = element('stressReplayAddVariantButton');
        if (addButton) {
            addButton.disabled = !hasWorkspace || readOnly || busy
                || workspaceState.workspace.variants.length >= STRESS_REPLAY_LIMITS.maximumVariants
                || !String(element('stressReplayVariantLabel')?.value || '').trim()
                || !patchPreview?.materialChangeGroups?.length;
        }
        renderViews({
            documentRef,
            workspace: workspaceState.workspace,
            comparison,
            results: comparisonResults,
            comparisonState,
            preview: patchPreview,
            previewError: patchPreviewError,
            busy,
            readOnly
        });
        updateStressReplayStepStates({ documentRef });
        if (focusBanner && hasWorkspace) focusReplayTarget(element('stressReplayBanner'));
    };
    const beginBusyAction = () => {
        if (busy) return false;
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
        const strategy = workspaceState.workspace
            ? createStressReplayStrategySnapshot(workspaceState.workspace.baselineSnapshot)
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
        const baseline = workspaceState.workspace
            ? createStressReplayStrategySnapshot(workspaceState.workspace.baselineSnapshot)
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
        if (busy) return null;
        patchPreview = null;
        patchPreviewError = null;
        if (!workspaceState.workspace) {
            render();
            return null;
        }
        try {
            patchPreview = previewVariantPatch({
                baselineInputs: workspaceState.workspace.baselineSnapshot,
                patch: readVariantPatch(element('stressReplayVariantEditor'))
            });
            const region = element('stressReplayStatus');
            if (region?.dataset?.patchError) {
                status('Die Patchvorschau ist zulässig.');
                delete region.dataset.patchError;
            }
        } catch (error) {
            patchPreviewError = error;
            status(formatStressReplayUiError(error), { error: true });
            const region = element('stressReplayStatus');
            if (region) region.dataset.patchError = error?.code || 'STRESS_REPLAY_PREVIEW_ERROR';
        }
        render();
        return patchPreview;
    };

    const computeComparison = ({ focusComparison = false, focusOnError = true, preferredVariantId, publishSummary = true } = {}) => {
        comparison = null;
        comparisonResults = [];
        if (!workspaceState.workspace || workspaceState.compatibility?.readOnly === true) {
            comparisonState = IDLE_COMPARISON_STATE;
            render();
            return null;
        }
        try {
            const summaryContext = publishSummary && workspaceProvenance
                ? beginSummary('workshop', workspaceState.workspace.baselineSnapshot,
                    { pathFingerprint: workspaceState.workspace.sourceIdentity?.pathFingerprint }, { workshopProvenance: workspaceProvenance })
                : null;
            const computed = runComparison({
                workspace: workspaceState.workspace,
                sourceIdentity: workspaceState.workspace.sourceIdentity,
                sourceScenarioLog
            });
            if (!comparisonResultIsUsable(computed)) {
                throw Object.assign(new Error('Die Vergleichsberechnung lieferte kein verwendbares Ergebnis.'), {
                    code: 'STRESS_REPLAY_COMPARISON_EMPTY'
                });
            }
            comparison = computed.comparison;
            comparisonResults = computed.results || [];
            comparisonState = { status: 'success', error: null };
            render();
            if (focusComparison) focusReplayTarget(element('stressReplayComparison'));
            if (summaryContext) void completeSummary(summaryContext, comparison, { preferredVariantId });
            return comparison;
        } catch (error) {
            const diagnostic = comparisonErrorDiagnostic(error);
            comparisonState = { status: 'error', error: diagnostic };
            status(`Variantenvergleich fehlgeschlagen [${diagnostic.code}]: ${diagnostic.message}`, { error: true });
            render();
            if (focusOnError) focusReplayTarget(element(focusComparison ? 'stressReplayComparison' : 'stressReplayStatus'));
            return null;
        }
    };

    const recomputeComparison = (options = {}) => {
        if (!beginBusyAction()) return null;
        try {
            return computeComparison(options);
        } finally {
            finishBusyAction();
        }
    };

    const persistVariants = async variants => {
        const current = workspaceState.workspace;
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
        if (!workspacePersonDataContext?.deviationApplied) await saveWorkspace(workspace, { confirmReplace: true });
        workspaceState = { ...workspaceState, workspace };
        return workspace;
    };

    const addVariant = async () => {
        if (!beginBusyAction()) return null;
        try {
            if (!workspaceState.workspace || workspaceState.compatibility?.readOnly === true) return null;
            if (workspaceState.workspace.variants.length >= STRESS_REPLAY_LIMITS.maximumVariants) {
                status('Maximal drei Alternativen neben der Baseline sind zulässig.', { error: true, focus: true });
                return null;
            }
            const form = element('stressReplayVariantEditor');
            if (form?.checkValidity?.() === false) {
                form.reportValidity?.();
                status('Bitte korrigiere die markierten Variantenfelder.', { error: true });
                return null;
            }
            const label = String(element('stressReplayVariantLabel')?.value || '').trim();
            const id = `variant-${Date.now()}-${workspaceState.workspace.variants.length}`;
            const variant = createVariant({
                id,
                label,
                baselineInputs: workspaceState.workspace.baselineSnapshot,
                patch: readVariantPatch(element('stressReplayVariantEditor'))
            });
            await persistVariants([...workspaceState.workspace.variants, variant]);
            comparison = null;
            comparisonResults = [];
            comparisonState = IDLE_COMPARISON_STATE;
            const computedComparison = computeComparison({ focusComparison: true, preferredVariantId: variant.id });
            element('stressReplayVariantEditor')?.reset?.();
            updateConditionalFields();
            patchPreview = null;
            patchPreviewError = null;
            renderBaselineValues();
            render();
            status(computedComparison
                ? `Variante „${variant.label}“ wurde auf dem fixierten Pfad berechnet.`
                : `Variante „${variant.label}“ wurde gespeichert; der Variantenvergleich ist fehlgeschlagen.`, {
                error: !computedComparison
            });
            return variant;
        } catch (error) {
            status(`Variante konnte nicht berechnet werden: ${formatStressReplayUiError(error)}`, { error: true, focus: true });
            return null;
        } finally {
            finishBusyAction();
        }
    };

    const removeVariant = async variantId => {
        if (!beginBusyAction()) return false;
        try {
            if (!workspaceState.workspace || variantId === 'baseline' || workspaceState.compatibility?.readOnly === true) return false;
            const variants = workspaceState.workspace.variants.filter(variant => variant.id !== variantId);
            if (variants.length === workspaceState.workspace.variants.length) return false;
            await persistVariants(variants);
            const computedComparison = computeComparison();
            status(computedComparison
                ? 'Variante entfernt; der Vergleich wurde neu berechnet.'
                : 'Variante entfernt; der Variantenvergleich ist fehlgeschlagen.', {
                error: !computedComparison,
                focus: !computedComparison
            });
            return true;
        } catch (error) {
            status(`Variante konnte nicht entfernt werden: ${formatStressReplayUiError(error)}`, { error: true, focus: true });
            return false;
        } finally {
            finishBusyAction();
        }
    };

    const setMonteCarloContext = ({ inputs, scenarioLogs, personDataContext = null } = {}) => {
        contextRevision++;
        if (busy) return;
        runContext = inputs && scenarioLogs
            ? {
                personDataContext: freezePersonDataContext(personDataContext),
                workshopProvenance: workshopProvenanceFor(inputs),
                inputs: cloneValue(inputs),
                scenarioLogs,
                monteCarloParams: cloneValue(readParameters(inputs)),
                useCapeSampling: element('useCapeSampling')?.checked === true
            }
            : null;
        selectedScenario = null;
        const button = element('stressReplayFixButton');
        if (button) button.disabled = true;
        status(runContext
            ? 'Wähle ein Szenario aus, um diesen Lauf als Stresspfad zu fixieren.'
            : 'Starte zuerst einen Monte-Carlo-Lauf.');
    };

    const selectScenario = scenario => {
        contextRevision++;
        if (busy) return;
        selectedScenario = scenario?.sourceIdentity ? scenario : null;
        const button = element('stressReplayFixButton');
        if (button) button.disabled = !selectedScenario;
        if (!runContext) status('Der Ursprungslauf ist nicht mehr verfügbar. Starte Monte Carlo erneut.', { error: true });
        else if (!selectedScenario) status('Wähle ein Szenario aus, um diesen Lauf als Stresspfad zu fixieren.');
        else if (runContext.monteCarloParams.rngMode !== 'per-run-seed') {
            if (button) button.disabled = true;
            status('Dieser Legacy-Zufallsstrom wird für Stresspfad-Replay nicht unterstützt.', { error: true });
        } else {
            status(`Lauf ${selectedScenario.sourceIdentity.displayRunNumber} ist zum Fixieren ausgewählt.`);
        }
    };

    const fixSelectedScenario = async () => {
        if (!beginBusyAction()) return null;
        try {
            if (!runContext || !selectedScenario) {
                status('Wähle zuerst ein Szenario aus einem abgeschlossenen Monte-Carlo-Lauf.', { error: true, focus: true });
                return null;
            }
            if (runContext.monteCarloParams.rngMode !== 'per-run-seed') {
                const error = Object.assign(new Error('Unsupported RNG mode'), { code: 'STRESS_REPLAY_SOURCE_UNSUPPORTED' });
                status(formatStressReplayUiError(error), { error: true, focus: true });
                return null;
            }
            status('Der ausgewählte Lauf wird deterministisch nachgerechnet und abgeglichen.');
            const sourceIdentity = selectedScenario.sourceIdentity;
            const beforeCapture = decisionContext();
            const rerun = await captureSelectedRun({
                inputs: cloneValue(runContext.inputs),
                widowOptions: normalizeWidowOptions(runContext.inputs.widowOptions),
                monteCarloParams: cloneValue(runContext.monteCarloParams),
                useCapeSampling: runContext.useCapeSampling,
                runIndices: [sourceIdentity.absoluteRunIndex],
                generationId: `stress-replay-${Date.now()}`
            });
            if (beforeCapture !== decisionContext()) {
                status('Der Ursprungslauf hat sich geändert. Bitte wähle das Szenario erneut.', { error: true });
                return null;
            }
            const capture = rerun.capturesByIndex?.get?.(sourceIdentity.absoluteRunIndex);
            const sourceRows = selectedScenario.logDataRows;
            if (!capture || !Array.isArray(sourceRows) || sourceRows.length === 0) {
                throw Object.assign(new Error('Capture oder Ursprungslog fehlt.'), { code: 'STRESS_REPLAY_CAPTURE_INVALID' });
            }
            const compatibility = resolveCompatibility();
            const sourceRequest = {
                inputs: runContext.inputs,
                monteCarloParams: runContext.monteCarloParams,
                useCapeSampling: runContext.useCapeSampling
            };
            const path = materializePath({
                capture,
                sourceLogRows: sourceRows,
                sourceRequest,
                dataFingerprint: compatibility.dataFingerprint,
                engineFingerprint: compatibility.engineFingerprint,
                scenarioKey: selectedScenario.key,
                selectionMetric: sourceIdentity.selectionMetric,
                selectionTieBreak: sourceIdentity.tieBreak
            });
            const baselineVariant = createBaselineVariant({ baselineInputs: runContext.inputs });
            const baselineResult = runBaseline({
                path,
                baselineInputs: runContext.inputs,
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
                baselineSnapshot: runContext.inputs,
                variants: [baselineVariant]
            });
            const replacing = workspaceState.status !== 'empty';
            const beforeDecision = decisionContext();
            const confirmed = !replacing || await askWorkspaceChange('Stresspfad ersetzen?',
                'Den aktiven Stresspfad durch den ausgewählten Lauf ersetzen? Der bisherige Arbeitsstand wird ersetzt.',
                'Stresspfad ersetzen', element('stressReplayFixButton'));
            if (!confirmed || beforeDecision !== decisionContext()) {
                status('Der vorhandene Stresspfad wurde beibehalten.');
                return null;
            }
            if (!runContext.personDataContext?.deviationApplied) await saveWorkspace(workspace, { confirmReplace: replacing });
            workspacePersonDataContext = runContext.personDataContext;
            workspaceProvenance = runContext.workshopProvenance;
            workspaceState = { status: 'executable', workspace, compatibility, error: null };
            sourceScenarioLog = cloneValue(sourceRows);
            comparison = null;
            comparisonResults = [];
            comparisonState = IDLE_COMPARISON_STATE;
            patchPreview = null;
            patchPreviewError = null;
            renderBaselineValues();
            updateConditionalFields();
            const computedComparison = computeComparison();
            render({ focusBanner: true });
            status(computedComparison
                ? 'Stresspfad fixiert. Baseline und Fingerprints wurden abgeglichen.'
                : 'Stresspfad fixiert und abgeglichen; der Variantenvergleich ist fehlgeschlagen.', {
                error: !computedComparison,
                focus: !computedComparison
            });
            return workspace;
        } catch (error) {
            status(formatStressReplayUiError(error), { error: true, focus: true });
            return null;
        } finally {
            finishBusyAction();
        }
    };

    const exportActiveWorkspace = (format = 'json') => {
        if (!beginBusyAction()) return null;
        try {
            if (!workspaceState.workspace) {
                status('Es gibt keinen aktiven Stresspfad zum Exportieren.', { error: true, focus: true });
                return null;
            }
            const exportDocument = buildExport({
                personDataContext: workspacePersonDataContext,
                workspace: workspaceState.workspace,
                comparison
            });
            const serialized = format === 'csv' ? serializeStressReplayComparisonCsvV1(exportDocument) : serializeExport(exportDocument);
            triggerDownload(serialized, `stress-pfad-replay-v1.${format === 'csv' ? 'csv' : 'json'}`, { documentRef, mimeType: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
            status('Stresspfad-Export wurde erstellt.');
            return serialized;
        } catch (error) {
            status(`Export fehlgeschlagen: ${formatStressReplayUiError(error)}`, { error: true, focus: true });
            return null;
        } finally {
            finishBusyAction();
        }
    };

    const performImportSerialized = async serialized => {
        try {
            const replacing = workspaceState.status !== 'empty';
            const beforeDecision = decisionContext();
            if (replacing && (!await askWorkspaceChange('Stresspfad importieren?',
                'Den aktiven Stresspfad durch den Import ersetzen? Der bisherige Arbeitsstand wird ersetzt.',
                'Import ersetzen', element('stressReplayImportButton')) || beforeDecision !== decisionContext())) {
                status('Der Import wurde abgebrochen; der aktive Stresspfad bleibt erhalten.');
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
            workspacePersonDataContext = freezePersonDataContext(imported.document?.personDataContext);
            workspaceProvenance = null;
            workspaceState = {
                status: imported.compatibility.status,
                workspace: imported.workspace,
                compatibility: imported.compatibility,
                error: null
            };
            sourceScenarioLog = null;
            comparison = imported.compatibility.readOnly === true
                ? imported.document?.comparison || null
                : null;
            comparisonResults = [];
            comparisonState = comparison
                ? { status: 'success', error: null }
                : IDLE_COMPARISON_STATE;
            patchPreview = null;
            patchPreviewError = null;
            renderBaselineValues();
            updateConditionalFields();
            const computedComparison = imported.compatibility.readOnly !== true
                ? computeComparison({ publishSummary: false })
                : comparison;
            render({ focusBanner: true });
            status(imported.compatibility.readOnly
                ? 'Stresspfad importiert und wegen abweichender Laufzeit nur zur Inspektion geöffnet.'
                : computedComparison
                    ? 'Stresspfad importiert und als aktiver Arbeitsstand geladen.'
                    : 'Stresspfad importiert; der Variantenvergleich ist fehlgeschlagen.', {
                error: imported.compatibility.readOnly !== true && !computedComparison,
                focus: imported.compatibility.readOnly !== true && !computedComparison
            });
            return workspaceState;
        } catch (error) {
            status(`Import fehlgeschlagen: ${formatStressReplayUiError(error)}`, { error: true, focus: true });
            return null;
        }
    };

    const importSerialized = async serialized => {
        if (!beginBusyAction()) return null;
        try {
            return await performImportSerialized(serialized);
        } finally {
            finishBusyAction();
        }
    };

    const discardActiveWorkspace = async () => {
        if (!beginBusyAction()) return false;
        try {
            if (!workspaceState.workspace && workspaceState.status !== 'corrupt') return false;
            const beforeDecision = decisionContext();
            if (!await askWorkspaceChange('Stresspfad verwerfen?',
                'Den aktiven Stresspfad dauerhaft verwerfen? Dies kann nicht rückgängig gemacht werden.',
                'Stresspfad verwerfen', element('stressReplayDiscardButton')) || beforeDecision !== decisionContext()) {
                status('Der aktive Stresspfad wurde beibehalten.');
                return false;
            }
            if (!workspacePersonDataContext?.deviationApplied) await discardWorkspace({ confirmDiscard: true });
            workspacePersonDataContext = null;
            workspaceProvenance = null;
            workspaceState = EMPTY_STATE;
            sourceScenarioLog = null;
            comparison = null;
            comparisonResults = [];
            comparisonState = IDLE_COMPARISON_STATE;
            patchPreview = null;
            patchPreviewError = null;
            renderBaselineValues();
            updateConditionalFields();
            render();
            status('Der aktive Stresspfad wurde verworfen.', { focus: true });
            focusReplayTarget(element('stressReplayFixButton'));
            return true;
        } catch (error) {
            status(`Verwerfen fehlgeschlagen: ${formatStressReplayUiError(error)}`, { error: true, focus: true });
            return false;
        } finally {
            finishBusyAction();
        }
    };

    const initialize = () => {
        if (initialized) return workspaceState;
        initialized = true;
        workspaceState = loadWorkspace({ currentCompatibility: resolveCompatibility() });
        applyBusy(false);
        setExpertFieldsExpanded(false);
        renderBaselineValues();
        updateConditionalFields();
        if (workspaceState.workspace && workspaceState.compatibility?.readOnly !== true) {
            computeComparison({ focusOnError: false, publishSummary: false });
        }
        render();
        if (workspaceState.status === 'corrupt') {
            status(`Der gespeicherte Stresspfad ist beschädigt und wurde nicht automatisch gelöscht: ${workspaceState.error?.message || 'unbekannter Fehler'}`, { error: true });
        } else if (workspaceState.workspace) {
            if (comparisonState.status !== 'error') {
                status(workspaceState.compatibility?.readOnly
                    ? 'Gespeicherter Stresspfad wurde nur zur Inspektion geladen.'
                    : 'Gespeicherter Stresspfad wurde geladen.');
            }
        } else {
            status('Starte zuerst einen Monte-Carlo-Lauf.');
        }
        element('stressReplayFixButton')?.addEventListener?.('click', () => void fixSelectedScenario());
        element('stressReplayExportButton')?.addEventListener?.('click', () => exportActiveWorkspace());
        element('stressReplayExportCsvButton')?.addEventListener?.('click', () => exportActiveWorkspace('csv'));
        element('stressReplayImportButton')?.addEventListener?.('click', () => {
            if (!busy) element('stressReplayImportFile')?.click?.();
        });
        element('stressReplayDiscardButton')?.addEventListener?.('click', () => void discardActiveWorkspace());
        element('stressReplayExpertToggle')?.addEventListener?.('click', toggleExpertFields);
        element('stressReplayVariantEditor')?.addEventListener?.('input', () => {
            if (busy) return;
            updateConditionalFields();
            previewEditorPatch();
        });
        element('stressReplayAddVariantButton')?.addEventListener?.('click', () => void addVariant());
        element('stressReplayVariantList')?.addEventListener?.('click', event => {
            if (busy) return;
            const action = event?.target?.closest?.('[data-stress-replay-action]');
            if (!action) return;
            const variantId = action.dataset.variantId;
            if (action.dataset.stressReplayAction === 'remove') void removeVariant(variantId);
            if (action.dataset.stressReplayAction === 'recompute') {
                const computedComparison = recomputeComparison({ focusComparison: true });
                if (computedComparison) status('Vergleich auf dem unveränderten fixierten Pfad neu berechnet.');
            }
        });
        element('stressReplayImportFile')?.addEventListener?.('change', async event => {
            const file = event?.target?.files?.[0];
            if (!file) return;
            if (!beginBusyAction()) return;
            try {
                await performImportSerialized(await file.text());
            } finally {
                event.target.value = '';
                finishBusyAction();
            }
        });
        return workspaceState;
    };

    return Object.freeze({
        initialize,
        setMonteCarloContext,
        selectScenario,
        fixSelectedScenario,
        exportActiveWorkspace,
        importSerialized,
        discardActiveWorkspace,
        previewEditorPatch,
        toggleExpertFields,
        addVariant,
        removeVariant,
        recomputeComparison,
        getState: () => workspaceState
    });
}

let activeController = null;

export function initStressReplayUI(options = {}) {
    activeController ||= createStressReplayController(options);
    activeController.initialize();
    return activeController;
}

export function publishStressReplayMonteCarloContext(context) {
    activeController?.setMonteCarloContext(context);
}

export function selectStressReplayScenario(scenario) {
    activeController?.selectScenario(scenario);
}
