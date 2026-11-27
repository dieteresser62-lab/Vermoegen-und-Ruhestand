"use strict";

import { effectiveMonteCarloDurationValue } from './monte-carlo-duration.js';
import { bindResultInfoPopups } from './results-renderers.js';

const cockpitInstances = new WeakMap();
const RESULT_VIEW_IDS = Object.freeze(['overview', 'risk', 'care', 'logs', 'decision']);

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

 *
 * @param viewOrTarget - Kontext für viewOrTarget.
 * @param [options] - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
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
    const euroControl = documentRef?.getElementById?.('mcEuroControl');
    const comparisonBasis = documentRef?.getElementById?.('mcDecisionEuroBasis');
    if (euroControl) euroControl.hidden = selected.viewId === 'decision';
    if (comparisonBasis) comparisonBasis.hidden = selected.viewId !== 'decision';
    if (focusTab && typeof selected.tab.focus === 'function') selected.tab.focus();
    return selected.viewId;
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

/**
 * @param [options] - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function updateMonteCarloSetupSummary({ documentRef = globalThis.document } = {}) {
    const values = {
        mcSetupSummaryRuns: readDisplayValue(documentRef, 'mcAnzahl').replace(/^\d+$/, value => Number(value).toLocaleString('de-DE')),
        mcSetupSummaryDuration: effectiveMonteCarloDurationValue(documentRef?.getElementById?.('mcDauer')) || '—',
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
        /** @type {HTMLInputElement} */
        const field = /** @type {HTMLInputElement} */ (documentRef?.getElementById?.(id));
        if (field && String(field.value) !== standard) deviations.push(`${label}: ${field.value || 'ungültig'}`);
    }
    if (documentRef?.getElementById?.('mcCompareMode')?.checked) deviations.push('Vergleich aktiv');
    if (documentRef?.getElementById?.('telemetryToggle')?.checked) deviations.push('Telemetrie aktiv');
    const advancedSummary = documentRef?.getElementById?.('mcAdvancedSummary');
    if (advancedSummary) advancedSummary.textContent = deviations.join(' · ') || 'Standard';
    return values;
}

/**
 * @param [options] - Optionen des Aufrufers.
 * @returns {boolean}
 */
export function syncMonteCarloCockpitStartState({ documentRef = globalThis.document } = {}) {
    const primaryButton = documentRef?.getElementById?.('mcButton');
    return Boolean(primaryButton);
}

/**
 * @param [options] - Optionen des Aufrufers.
 * @returns {boolean}
 */
export function completeMonteCarloCockpitRun({ documentRef = globalThis.document } = {}) {
    updateMonteCarloSetupSummary({ documentRef });
    const setupDisclosure = documentRef?.getElementById?.('mcSetupDisclosure');
    if (!setupDisclosure) return false;
    setupDisclosure.open = false;
    const settingsToggle = documentRef?.getElementById?.('mcSettingsToggle');
    settingsToggle?.setAttribute?.('aria-expanded', 'false');
    const settingsAction = documentRef?.getElementById?.('mcSettingsAction');
    if (settingsAction) settingsAction.textContent = '▸ zeigen';
    return true;
}

/**
 * OP-1 (Punkt 3): Nach einem fertigen Lauf stehen die Reiterzeile des Simulators und die Ergebnisreiter über dem Ergebnis im Blick.
 * Passt die Überschrift des Ergebnisses darunter nicht ins Fenster, beginnt die Ansicht bei den Ergebnisreitern.
 * Ist der Monte-Carlo-Reiter nicht offen oder das Ergebnis nicht sichtbar, scrollt nichts.
 * @param {HTMLElement | null} resultRegion - Ergebnisbereich mit der ersten Antwortkarte.
 * @param [options] - Optionen des Aufrufers.
 * @returns {boolean} true, wenn gescrollt wurde; der Fokus darf dann ohne Scrollen folgen.
 */
export function revealMonteCarloResult(resultRegion, { documentRef = globalThis.document } = {}) {
    const win = documentRef?.defaultView, gap = 16;
    if (typeof win?.scrollTo !== 'function' || typeof resultRegion?.getBoundingClientRect !== 'function') return false;
    // Nur bei offenem Monte-Carlo-Reiter und sichtbarem Ergebnis; aus einem anderen Reiter gestartet, bleibt die Seite stehen.
    const panel = resultRegion.closest?.('.tab-panel');
    if (panel && !panel.classList?.contains('active') || !(resultRegion.getBoundingClientRect().height > 0)) return false;
    const top = (/** @type {Element | null | undefined} */ element) => {
        const box = element?.getBoundingClientRect?.();
        return box && box.height > 0 ? box.top + win.scrollY : null;
    };
    const heading = resultRegion.querySelector?.('h2')?.getBoundingClientRect?.();
    const headingBottom = heading && heading.height > 0 ? heading.bottom + win.scrollY : (top(resultRegion) ?? 0) + 80;
    const target = [documentRef.querySelector?.('.tab-buttons'), documentRef.querySelector?.('.mc-view-nav'), resultRegion].map(top)
        .find(value => value !== null && headingBottom - value + 2 * gap <= win.innerHeight);
    if (target === undefined || target === null) return false;
    win.scrollTo({ top: Math.max(0, target - gap), behavior: 'instant' });
    return true;
}

/**
 * @param [options] - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function initMonteCarloResultCockpit({
    documentRef = globalThis.document
} = {}) {
    if (!documentRef) return null;
    const existing = cockpitInstances.get(documentRef);
    if (existing) return existing;
    bindResultInfoPopups(documentRef);

    const setupDisclosure = documentRef.getElementById?.('mcSetupDisclosure');
    const settingsToggle = documentRef.getElementById?.('mcSettingsToggle');
    if (setupDisclosure) setupDisclosure.open = false;
    const advanced = documentRef.getElementById?.('mcAdvancedDisclosure');
    if (advanced) advanced.open = false;
    const syncDisclosure = () => {
        settingsToggle?.setAttribute?.('aria-expanded', String(setupDisclosure?.open === true));
        const action = documentRef.getElementById?.('mcSettingsAction');
        if (action) action.textContent = setupDisclosure?.open ? '▾ ausblenden' : '▸ zeigen';
    };
    setupDisclosure?.addEventListener?.('toggle', syncDisclosure);
    syncDisclosure();
    const primaryButton = documentRef.getElementById?.('mcButton');
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

    updateSummary();
    syncStartState();
    activateMonteCarloResultView('overview', { documentRef });
    const instance = { setupDisclosure, updateSummary, syncStartState };
    cockpitInstances.set(documentRef, instance);
    return instance;
}
