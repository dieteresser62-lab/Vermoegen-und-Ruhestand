"use strict";

import { focusSelectedScenario } from './scenario-log-view.js';
import { openWorkshopReplay } from './simulator-workshop-ui.js';
import { activateSimulatorTab } from './simulator-main-tabs.js';

const cockpitInstances = new WeakMap();
const RESULT_VIEW_IDS = Object.freeze(['overview', 'risk', 'care', 'logs']);
const COMPARISON_VIEW_IDS = Object.freeze(['kpi', 'delta', 'year']);
const COMPARISON_TAB_SELECTOR = '[role="tab"][data-stress-replay-comparison-view]';
const COMPARISON_PANEL_SELECTOR = '[role="tabpanel"][data-stress-replay-comparison-panel]';

function getResultViewElements(documentRef) {
    return RESULT_VIEW_IDS.map(viewId => ({
        viewId,
        tab: documentRef?.querySelector?.(`[role="tab"][data-mc-view="${viewId}"]`) || null,
        panel: documentRef?.querySelector?.(`[role="tabpanel"][data-mc-view-panel="${viewId}"]`) || null
    }));
}

function resolveResultView(viewOrTarget, views) {
    if (typeof viewOrTarget === 'string') {
        return views.find(view => view.viewId === viewOrTarget) || null;
    }
    if (!viewOrTarget) return null;
    return views.find(view => view.tab === viewOrTarget
        || view.panel === viewOrTarget
        || view.panel?.contains?.(viewOrTarget)) || null;
}

/**
 * Aktiviert genau eine Monte-Carlo-Ergebnisansicht. Der Aufrufer kann entweder
 * die lokale View-ID oder einen Zielknoten innerhalb eines Panels übergeben.
 */
export function activateMonteCarloResultView(viewOrTarget, {
    documentRef = globalThis.document,
    focusTab = false
} = {}) {
    const views = getResultViewElements(documentRef);
    if (views.length !== RESULT_VIEW_IDS.length || views.some(view => !view.tab || !view.panel)) return null;
    const selected = resolveResultView(viewOrTarget, views);
    if (!selected) return null;

    for (const view of views) {
        const active = view === selected;
        view.tab.setAttribute?.('aria-selected', String(active));
        view.tab.setAttribute?.('tabindex', active ? '0' : '-1');
        view.panel.hidden = !active;
    }
    if (focusTab && typeof selected.tab.focus === 'function') selected.tab.focus();
    return selected.viewId;
}

/**
 * Schaltet die dynamisch gerenderten Replay-Vergleichsansichten um. Tabs und
 * Panels werden bei jedem Aufruf neu aus dem stabilen Vergleichscontainer
 * gelesen, damit ein Renderer-Rerender keine verwaisten Referenzen erzeugt.
 */
export function activateStressReplayComparisonView(viewId, {
    documentRef = globalThis.document,
    focusTab = false
} = {}) {
    if (!COMPARISON_VIEW_IDS.includes(viewId)) return null;
    const root = documentRef?.getElementById?.('stressReplayComparison');
    const tabs = Array.from(root?.querySelectorAll?.(COMPARISON_TAB_SELECTOR) || []);
    const panels = Array.from(root?.querySelectorAll?.(COMPARISON_PANEL_SELECTOR) || []);
    if (tabs.length !== COMPARISON_VIEW_IDS.length || panels.length !== COMPARISON_VIEW_IDS.length) return null;

    const selectedTab = tabs.find(tab => tab.dataset?.stressReplayComparisonView === viewId);
    const selectedPanel = panels.find(panel => panel.dataset?.stressReplayComparisonPanel === viewId);
    if (!selectedTab || !selectedPanel) return null;

    for (const tab of tabs) {
        const active = tab === selectedTab;
        tab.setAttribute?.('aria-selected', String(active));
        tab.setAttribute?.('tabindex', active ? '0' : '-1');
    }
    for (const panel of panels) panel.hidden = panel !== selectedPanel;
    if (focusTab && typeof selectedTab.focus === 'function') selectedTab.focus();
    return viewId;
}

export function updateMonteCarloReplayVariantBadge({ documentRef = globalThis.document } = {}) {
    const badge = documentRef?.getElementById?.('mcReplayVariantBadge');
    const list = documentRef?.getElementById?.('stressReplayVariantList');
    if (!badge || !list) return 0;
    const variantCount = Math.max(0, (list.querySelectorAll?.('li[data-variant-id]')?.length || 0) - 1);
    badge.textContent = String(variantCount);
    badge.hidden = variantCount === 0;
    badge.setAttribute?.('aria-label', `${variantCount} ${variantCount === 1 ? 'Variante' : 'Varianten'}`);
    return variantCount;
}

function getMethodLabel(methodSelect) {
    const selectedOption = methodSelect?.selectedOptions?.[0]
        || Array.from(methodSelect?.options || []).find(option => option.selected || option.value === methodSelect.value);
    return selectedOption?.textContent?.trim() || methodSelect?.value || '—';
}

function readDisplayValue(documentRef, id) {
    const value = documentRef?.getElementById?.(id)?.value;
    return value === undefined || value === null || value === '' ? '—' : String(value);
}

export function updateMonteCarloSetupSummary({ documentRef = globalThis.document } = {}) {
    const values = {
        mcSetupSummaryRuns: readDisplayValue(documentRef, 'mcAnzahl'),
        mcSetupSummaryDuration: readDisplayValue(documentRef, 'mcDauer'),
        mcSetupSummaryMethod: getMethodLabel(documentRef?.getElementById?.('mcMethode')),
        mcSetupSummarySeed: readDisplayValue(documentRef, 'mcSeed'),
        mcSetupSummaryStress: documentRef?.getElementById?.('stressPreset')?.value
            && documentRef.getElementById('stressPreset').value !== 'NONE'
            ? getMethodLabel(documentRef.getElementById('stressPreset')) : 'Kein Stressmodus',
        mcSetupSummaryTailRisk: documentRef?.getElementById?.('tailRiskEnabled')?.checked ? 'Tail-Risk aktiv' : 'Tail-Risk aus'
    };
    for (const [id, value] of Object.entries(values)) {
        const output = documentRef?.getElementById?.(id);
        if (output) output.textContent = value;
    }
    const deviations = [];
    for (const [id, standard, label] of [['rngMode', 'per-run-seed', 'Zufallsgenerator'],
        ['mcWorkerCount', '8', 'Prozesse'], ['mcWorkerBudget', '500', 'Zeitbudget']]) {
        const field = documentRef?.getElementById?.(id);
        if (field && String(field.value) !== standard) deviations.push(`${label}: ${field.value || 'ungültig'}`);
    }
    if (documentRef?.getElementById?.('mcCompareMode')?.checked) deviations.push('Vergleich aktiv');
    if (documentRef?.getElementById?.('telemetryToggle')?.checked) deviations.push('Telemetrie aktiv');
    const advancedSummary = documentRef?.getElementById?.('mcAdvancedSummary');
    if (advancedSummary) advancedSummary.textContent = deviations.join(' · ') || 'Standard';
    return values;
}

export function syncMonteCarloCockpitStartState({ documentRef = globalThis.document } = {}) {
    const primaryButton = documentRef?.getElementById?.('mcButton');
    return Boolean(primaryButton);
}

export function completeMonteCarloCockpitRun({ documentRef = globalThis.document } = {}) {
    updateMonteCarloSetupSummary({ documentRef });
    const setupDisclosure = documentRef?.getElementById?.('mcSetupDisclosure');
    if (!setupDisclosure) return false;
    setupDisclosure.open = false;
    const settingsToggle = documentRef?.getElementById?.('mcSettingsToggle');
    settingsToggle?.setAttribute?.('aria-expanded', 'false');
    if (settingsToggle) settingsToggle.textContent = 'Einstellungen anzeigen';
    return true;
}

export function initMonteCarloResultCockpit({
    documentRef = globalThis.document,
    MutationObserverCtor = globalThis.MutationObserver
} = {}) {
    if (!documentRef) return null;
    const existing = cockpitInstances.get(documentRef);
    if (existing) return existing;

    const setupDisclosure = documentRef.getElementById?.('mcSetupDisclosure');
    const settingsToggle = documentRef.getElementById?.('mcSettingsToggle');
    if (setupDisclosure) setupDisclosure.open = false;
    const advanced = documentRef.getElementById?.('mcAdvancedDisclosure');
    if (advanced) advanced.open = false;
    const syncDisclosure = () => {
        settingsToggle?.setAttribute?.('aria-expanded', String(setupDisclosure?.open === true));
        if (settingsToggle) settingsToggle.textContent = setupDisclosure?.open
            ? 'Einstellungen ausblenden' : 'Einstellungen anzeigen';
    };
    settingsToggle?.addEventListener?.('click', () => {
        setupDisclosure.open = !setupDisclosure.open;
        syncDisclosure();
        if (setupDisclosure.open && setupDisclosure.classList?.contains('sim-all-parameters')) {
            activateSimulatorTab('annahmen', { documentRef });
            setupDisclosure.scrollIntoView?.({ block: 'start' });
        }
    });
    setupDisclosure?.addEventListener?.('toggle', syncDisclosure);
    syncDisclosure();
    const primaryButton = documentRef.getElementById?.('mcButton');
    const showReplayButton = documentRef.getElementById?.('mcShowReplayButton');
    const showScenarioLogsButton = documentRef.getElementById?.('mcShowScenarioLogsButton');
    const comparisonRoot = documentRef.getElementById?.('stressReplayComparison');
    const viewTabs = getResultViewElements(documentRef).map(view => view.tab).filter(Boolean);
    if (!setupDisclosure || !primaryButton || viewTabs.length !== RESULT_VIEW_IDS.length) return null;

    const updateSummary = () => updateMonteCarloSetupSummary({ documentRef });
    const syncStartState = () => syncMonteCarloCockpitStartState({ documentRef });
    const parameterIds = ['mcAnzahl', 'mcDauer', 'mcMethode', 'mcSeed', 'stressPreset', 'tailRiskEnabled', 'rngMode', 'mcWorkerCount', 'mcWorkerBudget', 'mcCompareMode', 'telemetryToggle'];
    for (const id of parameterIds) {
        const input = documentRef.getElementById?.(id);
        input?.addEventListener?.('input', updateSummary);
        input?.addEventListener?.('change', updateSummary);
    }

    showReplayButton?.addEventListener?.('click', () => {
        const fixButton = documentRef.getElementById?.('stressReplayFixButton');
        const target = (fixButton && !fixButton.disabled ? fixButton : null)
            || documentRef.getElementById?.('stressReplaySelectedScenario')
            || documentRef.getElementById?.('stressReplayStatus')
            || documentRef.getElementById?.('mcShowScenarioLogsButton');
        if (!target) return;
        openWorkshopReplay({ documentRef, target });
    });

    showScenarioLogsButton?.addEventListener?.('click', () => {
        if (!activateSimulatorTab('montecarlo', { documentRef })) return;
        if (activateMonteCarloResultView('logs', { documentRef }) !== 'logs') return;
        if (focusSelectedScenario(documentRef)) return;
        const target = showReplayButton;
        target?.focus?.();
    });

    for (const [index, tab] of viewTabs.entries()) {
        tab.addEventListener?.('click', () => {
            activateMonteCarloResultView(tab, { documentRef });
        });
        tab.addEventListener?.('keydown', event => {
            let nextIndex = null;
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % viewTabs.length;
            else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + viewTabs.length) % viewTabs.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = viewTabs.length - 1;
            if (nextIndex === null) return;
            event.preventDefault?.();
            activateMonteCarloResultView(viewTabs[nextIndex], { documentRef, focusTab: true });
        });
    }

    comparisonRoot?.addEventListener?.('click', event => {
        const tab = event?.target?.closest?.(COMPARISON_TAB_SELECTOR);
        const viewId = tab?.dataset?.stressReplayComparisonView;
        if (viewId) activateStressReplayComparisonView(viewId, { documentRef });
    });
    comparisonRoot?.addEventListener?.('keydown', event => {
        const tab = event?.target?.closest?.(COMPARISON_TAB_SELECTOR);
        if (!tab) return;
        const tabs = Array.from(comparisonRoot.querySelectorAll?.(COMPARISON_TAB_SELECTOR) || []);
        const index = tabs.indexOf(tab);
        if (index < 0) return;
        let nextIndex = null;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault?.();
        activateStressReplayComparisonView(tabs[nextIndex]?.dataset?.stressReplayComparisonView, {
            documentRef,
            focusTab: true
        });
    });

    let observer = null;
    let variantObserver = null;
    if (typeof MutationObserverCtor === 'function') {
        const variantList = documentRef.getElementById?.('stressReplayVariantList');
        if (variantList) {
            variantObserver = new MutationObserverCtor(() => updateMonteCarloReplayVariantBadge({ documentRef }));
            variantObserver.observe(variantList, { childList: true, subtree: true });
        }
    }

    updateSummary();
    syncStartState();
    activateMonteCarloResultView('overview', { documentRef });
    updateMonteCarloReplayVariantBadge({ documentRef });
    const instance = { setupDisclosure, updateSummary, syncStartState, observer, variantObserver, comparisonRoot };
    cockpitInstances.set(documentRef, instance);
    return instance;
}
