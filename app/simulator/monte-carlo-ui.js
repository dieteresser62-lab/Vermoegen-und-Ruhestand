import { showPageAlert } from '../shared/page-dialog.js';
"use strict";

import { STATIONARY_BOOTSTRAP_METHOD } from './stationary-bootstrap-contract.js';
import { getCommonInputs } from './simulator-portfolio.js';
import { validateSimulatorInputs, simulatorValidationFieldId } from './simulator-input-validation.js';
import { revealAssumptionControl } from './simulator-assumptions-ui.js';
import { activateSimulatorTab } from './simulator-main-tabs.js';
import { buildMonteCarloRunHint, renderMonteCarloRunHint, getMonteCarloHintMeasurement, monteCarloHintComparableKey } from './monte-carlo-run-hint.js';
import { setFieldState } from '../shared/field-state.js';
import {
    MONTE_CARLO_PARAMETER_LIMITS,
    estimateMonteCarloResourcesV1,
    normalizeMonteCarloParametersV1,
    normalizeMonteCarloResourceConfigV1
} from './monte-carlo-parameters.js';
import {
    activateMonteCarloResultView,
    completeMonteCarloCockpitRun,
    syncMonteCarloCockpitStartState
} from './mc-result-cockpit.js';

function focusElement(element) {
    if (typeof element?.focus !== 'function') return false;
    try {
        element.focus({ preventScroll: false });
    } catch {
        element.focus();
    }
    return true;
}

function formatInteger(value) {
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value);
}

// Ein Dokument besitzt einen Laufzustand; die Ergebniskarte darf ihre DOM-Knoten ersetzen.
const runDisplays = new WeakMap();
function runDisplay(doc) {
    if (!runDisplays.has(doc)) runDisplays.set(doc, {
        busy: false, cancelling: false, successful: false, percent: 0, progressVisible: false, status: ''
    });
    return runDisplays.get(doc);
}

export function syncMonteCarloRunControls(doc = globalThis.document, successful) {
    if (!doc?.getElementById) return;
    const state = runDisplay(doc);
    if (typeof successful === 'boolean') state.successful = successful;
    const canonical = doc.getElementById('mcButton');
    const label = state.successful ? 'Monte-Carlo neu rechnen' : 'Monte-Carlo rechnen';
    if (canonical) canonical.textContent = label;
    const start = doc.getElementById('overviewRunMonteCarlo');
    if (start) {
        start.textContent = label;
        start.disabled = state.busy || canonical?.disabled === true;
        start.hidden = state.busy;
    }
    const settings = doc.getElementById('overviewMonteCarloSettings');
    if (settings) settings.hidden = state.busy;
    const cancel = doc.getElementById('overviewCancelMonteCarlo');
    if (cancel) {
        cancel.hidden = !state.busy;
        cancel.disabled = !state.busy || state.cancelling;
        cancel.textContent = state.cancelling ? 'Abbruch läuft …' : 'Monte-Carlo-Lauf abbrechen';
    }
    const status = doc.getElementById('overviewMonteCarloRunStatus');
    if (status && status.textContent !== state.status) status.textContent = state.status;
    const progress = doc.getElementById('overviewMonteCarloProgress');
    if (progress) {
        progress.hidden = !state.progressVisible;
        progress.setAttribute?.('aria-valuenow', String(Math.round(state.percent)));
    }
    const bar = doc.getElementById('overviewMonteCarloProgressBar');
    if (bar) bar.style.width = `${state.percent}%`;
}

export function setMonteCarloRunBusy(doc, busy) {
    if (!doc) return;
    const state = runDisplay(doc);
    state.busy = busy;
    if (busy) {
        state.cancelling = false; state.status = 'Monte-Carlo wird vorbereitet.';
        const start = doc.getElementById?.('mcButton');
        if (start) start.disabled = true;
    }
    syncMonteCarloRunControls(doc);
}

export function renderMonteCarloRunControls() {
    return `<div class="sim-mc-actions">
        <button type="button" id="overviewRunMonteCarlo" class="ds-button ds-button-primary" data-mc-start>Monte-Carlo rechnen</button>
        <button type="button" id="overviewCancelMonteCarlo" class="ds-button ds-button-secondary" data-mc-cancel hidden disabled>Monte-Carlo-Lauf abbrechen</button>
        <button type="button" id="overviewMonteCarloSettings" class="ds-text-link" data-simulator-tab="montecarlo">Einstellungen ändern</button>
    </div>
    <div id="overviewMonteCarloProgress" class="sim-mc-progress" role="progressbar" aria-label="Monte-Carlo-Fortschritt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div id="overviewMonteCarloProgressBar"></div></div>
    <p id="overviewMonteCarloRunStatus" role="status"></p>`;
}

const resourceBindings = new WeakMap();
function setRunHintBusy(doc, busy) {
    for (const id of ['mcRunHintStart', 'mcRunHintReset']) {
        const button = doc.getElementById(id);
        if (button) button.disabled = busy;
    }
}

export function formatMonteCarloResourceEstimate(estimate) {
    const memoryMiB = estimate.estimatedWorkerResultMiB < 10
        ? estimate.estimatedWorkerResultMiB.toFixed(1)
        : estimate.estimatedWorkerResultMiB.toFixed(0);
    const loadLabel = estimate.loadLevel === 'grosslast'
        ? 'Großlast'
        : estimate.loadLevel === 'erhoeht'
            ? 'erhöhte Last'
            : 'normale Last';
    return `${formatInteger(estimate.runYears)} Run-Jahre · Speicherklasse ${estimate.memoryClass} (ca. ${memoryMiB} MiB Ergebnisdaten) · ${loadLabel}.`;
}

export function updateMonteCarloResourceEstimate(parameters, { documentRef = globalThis.document } = {}) {
    const estimate = estimateMonteCarloResourcesV1(parameters);
    const estimateElement = documentRef?.getElementById?.('mcResourceEstimate');
    const confirmationRow = documentRef?.getElementById?.('mcLargeRunConfirmationRow');
    if (estimateElement) {
        estimateElement.textContent = formatMonteCarloResourceEstimate(estimate);
        estimateElement.dataset.loadLevel = estimate.loadLevel;
    }
    if (confirmationRow) {
        confirmationRow.hidden = !estimate.requiresLargeRunConfirmation;
        confirmationRow.style.display = estimate.requiresLargeRunConfirmation ? 'block' : 'none';
    }
    return estimate;
}

export function triggerMonteCarloDownload(download, {
    documentRef = globalThis.document,
    urlApi = globalThis.URL,
    BlobCtor = globalThis.Blob
} = {}) {
    if (!download || typeof download.content !== 'string'
        || typeof download.filename !== 'string' || !download.filename.endsWith('.json')) {
        throw new TypeError('Monte-Carlo-Download ist unvollstaendig.');
    }
    if (!documentRef?.createElement || typeof urlApi?.createObjectURL !== 'function'
        || typeof BlobCtor !== 'function') {
        throw new Error('Der Browserdownload ist in dieser Umgebung nicht verfuegbar.');
    }
    const blob = new BlobCtor([download.content], { type: download.mimeType || 'application/json' });
    const url = urlApi.createObjectURL(blob);
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = download.filename;
    try {
        documentRef.body?.appendChild?.(anchor);
        anchor.click();
    } finally {
        if (typeof anchor.remove === 'function') anchor.remove();
        else documentRef.body?.removeChild?.(anchor);
        urlApi.revokeObjectURL?.(url);
    }
    return download.filename;
}

/**
 * Stellt alle DOM-Interaktionen für die Monte-Carlo-Simulation bereit.
 * Kapselt UI-spezifische Logik (Validierung, Progress-Anzeige, Button-Zustände)
 * und liefert generische Callbacks, die der Runner injizieren kann.
 * Dieser Ansatz trennt UI und Business-Logik klar und erleichtert Tests.
 */
export function createMonteCarloUI() {
    const documentRef = document;
    const mcButton = requireElement('mcButton', 'Monte-Carlo Start-Button');
    const cancelButton = document.getElementById('mcCancelButton');
    const progressBarContainer = requireElement('mc-progress-bar-container', 'Monte-Carlo Fortschrittsanzeige');
    const progressBar = requireElement('mc-progress-bar', 'Monte-Carlo Fortschrittsbalken');
    const exportActions = document.getElementById('mcRunExportActions');
    const exportButton = document.getElementById('exportMonteCarloRunJson');
    const exportStatus = document.getElementById('mcRunExportStatus');
    const runStatus = document.getElementById('mcRunStatus');
    const resultRegion = document.getElementById('monteCarloResults');
    const errorContainer = document.getElementById('mc-error-container');
    const largeRunConfirmation = document.getElementById('mcLargeRunConfirm');
    let cancelHandler = null;
    let delegatedCancelHandler = null;
    let terminalFocusTarget = null;
    let lastAnnouncedProgress = -1;
    let lastAnnouncedPhase = null;
    let running = false;
    let publishedDuringRun = false;

    const state = runDisplay(documentRef);
    const setRunStatus = text => {
        state.status = text;
        if (runStatus) runStatus.textContent = text;
        syncMonteCarloRunControls(documentRef);
    };

    return {
        /**
         * Deaktiviert den Start-Button, um Doppelstarts zu verhindern.
         */
        disableStart() {
            this.clearRunExport();
            mcButton.disabled = true;
            syncMonteCarloCockpitStartState();
            syncMonteCarloRunControls(documentRef);
        },
        /**
         * Aktiviert den Start-Button wieder.
         */
        enableStart() {
            mcButton.disabled = false;
            syncMonteCarloCockpitStartState();
            syncMonteCarloRunControls(documentRef);
        },
        bindCancel(handler) {
            if (typeof handler !== 'function') return false;
            this.unbindCancel();
            cancelHandler = event => { event?.preventDefault?.(); void handler(); };
            delegatedCancelHandler = event => {
                if (event?.target?.closest?.('[data-mc-cancel]')) cancelHandler(event);
            };
            cancelButton?.addEventListener('click', cancelHandler);
            documentRef.addEventListener?.('click', delegatedCancelHandler);
            return true;
        },
        unbindCancel() {
            if (!cancelHandler) return false;
            cancelButton?.removeEventListener?.('click', cancelHandler);
            documentRef.removeEventListener?.('click', delegatedCancelHandler);
            delegatedCancelHandler = null;
            cancelHandler = null;
            return true;
        },
        beginRun({ preparing = false } = {}) {
            this.clearRunExport();
            running = true;
            state.busy = true;
            state.cancelling = false;
            state.percent = 0;
            setRunHintBusy(documentRef, true);
            terminalFocusTarget = null;
            mcButton.disabled = true;
            mcButton.setAttribute?.('aria-busy', 'true');
            syncMonteCarloCockpitStartState();
            syncMonteCarloRunControls(documentRef);
            setRunStatus(preparing ? 'Monte-Carlo wird vorbereitet.' : 'Monte-Carlo-Lauf gestartet.');
            if (cancelButton) {
                cancelButton.hidden = false;
                cancelButton.style.display = 'inline-block';
                cancelButton.disabled = false;
                cancelButton.textContent = 'Monte-Carlo-Lauf abbrechen';
            }
        },
        beginCancelling() {
            state.cancelling = true;
            this.clearRunExport();
            mcButton.disabled = true;
            syncMonteCarloCockpitStartState();
            syncMonteCarloRunControls(documentRef);
            setRunStatus('Monte-Carlo-Lauf wird abgebrochen.');
            if (cancelButton) {
                cancelButton.disabled = true;
                cancelButton.textContent = 'Abbruch läuft …';
            }
        },
        finishRun() {
            state.busy = false;
            running = false;
            setRunHintBusy(documentRef, false);
            mcButton.disabled = false;
            mcButton.removeAttribute?.('aria-busy');
            syncMonteCarloCockpitStartState();
            syncMonteCarloRunControls(documentRef);
            if (cancelButton) {
                cancelButton.disabled = true;
                cancelButton.hidden = true;
                cancelButton.style.display = 'none';
                cancelButton.textContent = 'Monte-Carlo-Lauf abbrechen';
            }
            focusElement(terminalFocusTarget);
            terminalFocusTarget = null;
        },
        showCancelled() {
            this.clearRunExport();
            running = false;
            this.showCompareResults('Monte-Carlo-Lauf wurde abgebrochen.');
            setRunStatus('Monte-Carlo-Lauf wurde abgebrochen.');
            terminalFocusTarget = mcButton;
            if (exportStatus) exportStatus.textContent = 'Monte-Carlo-Lauf wurde abgebrochen.';
        },
        showCompleted() {
            state.successful = true;
            setRunStatus('Monte-Carlo-Lauf abgeschlossen. Ergebnisse sind verfügbar.');
            completeMonteCarloCockpitRun();
            activateMonteCarloResultView(resultRegion || 'overview');
            terminalFocusTarget = resultRegion || mcButton;
        },
        /**
         * Blendet die Fortschrittsanzeige ein und setzt sie zurück.
         */
        showProgress() {
            state.progressVisible = true;
            progressBarContainer.style.display = 'block';
            progressBarContainer.setAttribute?.('aria-busy', 'true');
            lastAnnouncedProgress = -1;
            lastAnnouncedPhase = null;
            this.updateProgress(0);
            focusElement(progressBarContainer);
        },
        /**
         * Aktualisiert die Fortschrittsanzeige in Prozent (0-100).
         * @param {number} percent - Fortschritt in Prozent.
         */
        updateProgress(percent, detail = null) {
            const numericPercent = Number(percent);
            const boundedPercent = Number.isFinite(numericPercent)
                ? Math.max(0, Math.min(numericPercent, 100))
                : 0;
            state.percent = boundedPercent;
            const roundedPercent = Math.round(boundedPercent);
            progressBar.style.width = `${boundedPercent}%`;
            progressBarContainer.setAttribute?.('aria-valuenow', String(roundedPercent));
            const phase = detail ? (detail.phase === 'evaluating' ? 'Auswertung' : 'Rechnung') : null;
            const phaseKey = JSON.stringify([phase, detail?.comparison || '']);
            if (lastAnnouncedProgress < 0 || phaseKey !== lastAnnouncedPhase || roundedPercent === 100
                || Math.abs(roundedPercent - lastAnnouncedProgress) >= 5) {
                if (detail) {
                    const comparison = detail.comparison ? ` · ${detail.comparison}` : '';
                    const counts = Number.isFinite(detail.completedRuns) && Number.isFinite(detail.totalRuns)
                        ? ` · ${formatInteger(detail.completedRuns)} von ${formatInteger(detail.totalRuns)} Läufen fertig` : '';
                    setRunStatus(`${phase}${comparison}${counts} · ${roundedPercent} Prozent.`);
                } else {
                    setRunStatus(`Monte-Carlo-Fortschritt: ${roundedPercent} Prozent.`);
                }
                lastAnnouncedProgress = roundedPercent;
                lastAnnouncedPhase = phaseKey;
            }
            syncMonteCarloRunControls(documentRef);
        },
        /**
         * Blendet die Fortschrittsanzeige nach kurzer Verzögerung aus.
         */
        async finishProgress({ completed = true } = {}) {
            if (completed) {
                state.percent = 100;
                syncMonteCarloRunControls(documentRef);
                progressBar.style.width = '100%';
                progressBarContainer.setAttribute?.('aria-valuenow', '100');
            }
            await new Promise(resolve => setTimeout(resolve, 250));
            state.progressVisible = false;
            syncMonteCarloRunControls(documentRef);
            progressBarContainer.style.display = 'none';
            progressBarContainer.removeAttribute?.('aria-busy');
        },
        /**
         * Liest den Status der CAPE-Sampling-Option defensiv aus.
         * @returns {boolean} True, wenn CAPE-Sampling aktiviert ist.
         */
        readUseCapeSampling() { return document.getElementById('useCapeSampling')?.checked === true; },
        /**
         * Liest Worker-Config fuer Monte-Carlo aus der UI.
         * @returns {{ workerCount: number, timeBudgetMs: number }}
         */
        readWorkerConfig() {
            const workerCountRaw = document.getElementById('mcWorkerCount')?.value ?? '8';
            const budgetRaw = document.getElementById('mcWorkerBudget')?.value ?? '500';
            return normalizeMonteCarloResourceConfigV1({
                workerCount: workerCountRaw,
                timeBudgetMs: budgetRaw
            });
        },
        showResourceEstimate(parameters) {
            return updateMonteCarloResourceEstimate(parameters);
        },
        requireLargeRunConfirmation(parameters) {
            const estimate = this.showResourceEstimate(parameters);
            if (!estimate.requiresLargeRunConfirmation) return estimate;
            if (largeRunConfirmation?.checked !== true) {
                revealAssumptionControl(largeRunConfirmation);
                focusElement(largeRunConfirmation);
                const error = new Error(`Mehr als ${formatInteger(MONTE_CARLO_PARAMETER_LIMITS.runs.interactiveRecommendedMaximum)} Simulationen sind eine Großlast. Bitte bestätige die angezeigte Belastung vor dem Start.`);
                error.errors = [{ fieldId: 'mcLargeRunConfirm' }];
                throw error;
            }
            largeRunConfirmation.checked = false;
            return estimate;
        },
        /**
         * Liest den Vergleichsmodus fuer Seriell vs Worker aus.
         * @returns {boolean} True, wenn der Vergleich aktiviert ist.
         */
        readCompareMode() { return document.getElementById('mcCompareMode')?.checked === true; },
        /**
         * Zeigt Vergleichsergebnisse an.
         * @param {string} text - Vergleichstext.
         */
        showCompareResults(text) {
            const container = document.getElementById('mc-compare-results');
            if (container) {
                container.textContent = text;
                container.style.display = 'block';
            }
        },
        /**
         * Versteckt Vergleichsergebnisse.
         */
        hideCompareResults() {
            const container = document.getElementById('mc-compare-results');
            if (container) container.style.display = 'none';
        },
        /**
         * Zeigt eine Fehlermeldung im UI an.
         * @param {Error|string} error - Das Fehlerobjekt oder die Fehlermeldung.
         */
        showError(error, sourceError = error) {
            // Der Controller veröffentlicht bei technischem Laufabschluss einen
            // vollständigen neuen Diagnoseexport unmittelbar vor showError.
            // Diesen Bestandsvertrag erhalten; kein Export aus einem alten Lauf.
            if (!running || !publishedDuringRun) this.clearRunExport();
            const messageEl = document.getElementById('mc-error-message');
            if (errorContainer && messageEl) {
                const msg = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
                messageEl.textContent = msg;
                errorContainer.style.display = 'block';
                setRunStatus(`Fehler: ${error instanceof Error ? error.message : String(error)}`);
                const field = documentRef.getElementById(simulatorValidationFieldId(sourceError));
                // Der Reiter folgt dem erreichbaren Fokusziel, auch bei zentral übernommenen Personenwerten.
                const editable = field && !field.disabled && !field.closest?.('[hidden]');
                terminalFocusTarget = editable ? field : errorContainer;
                const tab = terminalFocusTarget.closest?.('.tab-panel')?.id?.replace('tab-', '')
                    || (!editable ? 'montecarlo' : null);
                if (tab) activateSimulatorTab(tab, { documentRef });
                if (editable) revealAssumptionControl(field);
                else if (field) messageEl.textContent += '\nBitte in Personen & Vermögen ändern.';
                focusElement(terminalFocusTarget);
            } else {
                console.error("Error Container missing!", error);
                void showPageAlert({ doc: documentRef, title: 'Monte-Carlo-Lauf fehlgeschlagen',
                    description: `Fehler (Fallback): ${error}\n\nPrüfe die Eingaben und starte den Lauf erneut. Personenwerte kannst Du in Personen & Vermögen ändern.` })
                    .catch(dialogError => console.error('[MonteCarlo] Fehlerhinweis konnte nicht geöffnet werden.', dialogError));
            }
        },
        /**
         * Versteckt die Fehlermeldung.
         */
        hideError() {
            if (errorContainer) errorContainer.style.display = 'none';
        },
        clearRunExport() {
            publishedDuringRun = false;
            if (exportButton) {
                exportButton.disabled = true;
                exportButton.onclick = null;
            }
            if (exportActions) {
                exportActions.hidden = true;
                exportActions.style.display = 'none';
            }
            if (exportStatus) exportStatus.textContent = '';
        },
        publishRunExport(download) {
            if (!exportButton || !exportActions) return false;
            publishedDuringRun = running;
            exportButton.disabled = false;
            exportButton.onclick = () => {
                try {
                    const filename = triggerMonteCarloDownload(download);
                    if (exportStatus) exportStatus.textContent = `Export gespeichert: ${filename}`;
                } catch (error) {
                    this.showError(error);
                }
            };
            exportActions.hidden = false;
            exportActions.style.display = 'flex';
            if (exportStatus) {
                exportStatus.textContent = 'Ergebnis mit Laufdaten und Berechnungsgrundlagen ist bereit zum Export.';
            }
            return true;
        }
    };
}

/**
 * Liefert ein Pflicht-DOM-Element und validiert dessen Existenz, damit wir bei fehlerhaften
 * UI-Verkabelungen frühzeitig aussagekräftige Fehlermeldungen liefern können.
 * @param {string} elementId - Die erwartete DOM-ID des Elements.
 * @param {string} description - Menschlich lesbare Beschreibung für Fehlermeldungen.
 * @returns {HTMLElement} Referenz auf das gefundene Element.
 */
export function requireElement(elementId, description) {
    const element = document.getElementById(elementId);
    if (!element) {
        throw new Error(`UI-Element fehlt: ${description} (id=${elementId})`);
    }
    return element;
}

/**
 * Liest einen Integer-Wert aus einem Input-Feld und erzwingt sinnvolle Parameterbereiche,
 * damit Simulationen nicht mit stillschweigenden NaN-Werten starten.
 * @param {string} elementId - DOM-ID des Inputs.
 * @param {string} description - Menschlich lesbare Beschreibung für Fehlermeldungen.
 * @param {{min?: number, max?: number, defaultValue?: number}} [options] - Validierungsgrenzen.
 * @returns {number} Der validierte Integer-Wert.
 */
export function readIntegerInput(elementId, description, { min = -Infinity, max = Infinity, defaultValue } = {}) {
    const element = requireElement(elementId, description);
    const rawValue = (element.value ?? '').trim();
    const parsed = /^-?(?:0|[1-9]\d*)$/.test(rawValue) ? Number(rawValue) : Number.NaN;

    if (Number.isNaN(parsed)) {
        if (typeof defaultValue === 'number') {
            return defaultValue;
        }
        throw new Error(`Ungültiger Wert für ${description}: Bitte eine Zahl eingeben.`);
    }
    if (!Number.isSafeInteger(parsed)) {
        throw new Error(`Ungültiger Wert für ${description}: Zahl ist keine sichere ganze Zahl.`);
    }
    if (parsed < min || parsed > max) {
        const minInfo = Number.isFinite(min) ? ` (min: ${min})` : '';
        const maxInfo = Number.isFinite(max) ? ` (max: ${max})` : '';
        throw new Error(`Ungültiger Wert für ${description}: ${parsed}${minInfo}${maxInfo}`);
    }
    return parsed;
}

function readOptionalIntegerInput(elementId, description, { min = -Infinity, max = Infinity, defaultValue } = {}) {
    const element = document.getElementById(elementId);
    if (!element) {
        return defaultValue;
    }
    return readIntegerInput(elementId, description, { min, max, defaultValue });
}

/**
 * Liest alle Monte-Carlo-Steuerparameter aus dem UI und validiert sie defensiv.
 * Design-Entscheidung: Frühes Validieren verhindert späte Ausfälle tief in der Simulation
 * und liefert dem Nutzer klare Fehlermeldungen.
 * @returns {{ anzahl: number, maxDauer: number, blockSize: number, seed: number, methode: string, rngMode: string, startYearMode: string, startYearFilter: number, startYearHalfLife: number, excludeEstimatedHistory: boolean }}
 */
export function readMonteCarloParameters(inputs = null, { runsElementId = 'mcAnzahl' } = {}) {
    const methodeSelect = requireElement('mcMethode', 'Monte-Carlo Methode');
    const runsDescription = runsElementId === 'mcAnzahl'
        ? 'Anzahl der Simulationen'
        : 'Sweep-Simulationen je Kombination';
    const anzahlElement = requireElement(runsElementId, runsDescription);
    const durationElement = requireElement('mcDauer', 'Simulationsdauer in Jahren');
    const blockSizeElement = requireElement('mcBlockSize', 'Blocklaenge');
    const seedElement = requireElement('mcSeed', 'Zufalls-Seed');
    const rngModeElement = document.getElementById('rngMode');
    const startYearModeElement = document.getElementById('mcStartYearMode');
    const excludeEstimatedHistoryElement = document.getElementById('mcExcludeEstimatedHistory');

    return normalizeMonteCarloParametersV1({
        anzahl: runsElementId === 'mcAnzahl'
            ? anzahlElement.value
            : readIntegerInput(runsElementId, runsDescription, {
                min: MONTE_CARLO_PARAMETER_LIMITS.runs.minimum,
                max: MONTE_CARLO_PARAMETER_LIMITS.runs.hardMaximum
            }),
        maxDauer: durationElement.value,
        blockSize: blockSizeElement.value,
        seed: seedElement.value,
        methode: methodeSelect.value,
        rngMode: rngModeElement?.value,
        startYearMode: startYearModeElement?.value,
        startYearFilter: document.getElementById('mcStartYearFilter')?.value,
        startYearHalfLife: document.getElementById('mcStartYearHalfLife')?.value,
        excludeEstimatedHistory: excludeEstimatedHistoryElement?.checked === true
    }, { inputs });
}

export function initMonteCarloResourceControls() {
    const runsElement = document.getElementById('mcAnzahl');
    const durationElement = document.getElementById('mcDauer');
    const estimateElement = document.getElementById('mcResourceEstimate');
    const confirmation = document.getElementById('mcLargeRunConfirm');
    if (!runsElement || !durationElement || !estimateElement) return;
    if (resourceBindings.has(runsElement)) { resourceBindings.get(runsElement)(); return; }
    const doc = document;
    const hint = doc.getElementById('mcRunHint');
    const hintContent = doc.getElementById('mcRunHintContent');
    const hintStart = doc.getElementById('mcRunHintStart');
    const hintReset = doc.getElementById('mcRunHintReset');

    let previousSignature = `${String(runsElement.value ?? '')}:${String(durationElement.value ?? '')}`;
    const update = () => {
        const nextSignature = `${String(runsElement.value ?? '')}:${String(durationElement.value ?? '')}`;
        if (confirmation && nextSignature !== previousSignature) confirmation.checked = false;
        previousSignature = nextSignature;
        const measurement = getMonteCarloHintMeasurement(doc);
        let comparableKey = null;
        if (measurement) {
            try {
                comparableKey = monteCarloHintComparableKey(validateSimulatorInputs(getCommonInputs()), readMonteCarloParameters(),
                    normalizeMonteCarloResourceConfigV1({ workerCount: doc.getElementById('mcWorkerCount')?.value ?? '8', timeBudgetMs: doc.getElementById('mcWorkerBudget')?.value ?? '500' }),
                    doc.getElementById('useCapeSampling')?.checked === true);
            } catch { /* Ohne vergleichbare Eingaben bleibt die Schätzung unbekannt. */ }
        }
        const model = buildMonteCarloRunHint({ runs: runsElement.value, years: durationElement.value,
            measurement, comparableKey, successRatio: comparableKey === measurement?.comparableKey ? measurement?.successRatio : null });
        if (hint) { hint.hidden = !model.visible; hint.dataset.severity = model.severe ? 'severe' : 'normal'; }
        if (hintContent) hintContent.innerHTML = renderMonteCarloRunHint(model);
        if (hintStart && model.visible) hintStart.textContent = model.severe ? 'Trotzdem rechnen' : `Mit ${formatInteger(model.runs)} Läufen rechnen`;
        try {
            updateMonteCarloResourceEstimate({
                anzahl: runsElement.value,
                maxDauer: durationElement.value
            });
        } catch {
            estimateElement.textContent = 'Kostenschätzung verfügbar, sobald Laufzahl und Dauer gültig sind.';
            estimateElement.dataset.loadLevel = 'invalid';
            const confirmationRow = document.getElementById('mcLargeRunConfirmationRow');
            if (confirmationRow) {
                confirmationRow.hidden = true;
                confirmationRow.style.display = 'none';
            }
        }
    };

    runsElement.addEventListener('input', update);
    runsElement.addEventListener('change', update);
    durationElement.addEventListener('input', update);
    durationElement.addEventListener('change', update);
    hintStart?.addEventListener('click', () => {
        const start = doc.getElementById('mcButton');
        if (!start || start.disabled || hintStart.disabled) return;
        const model = buildMonteCarloRunHint({ runs: runsElement.value, years: durationElement.value });
        if (!model.visible || !model.valid) return;
        if (confirmation) confirmation.checked = true;
        start.click();
    });
    hintReset?.addEventListener('click', () => {
        if (hintReset.disabled || doc.getElementById('mcButton')?.disabled) return;
        runsElement.value = '10000';
        runsElement.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Änderungen der übrigen Annahmen invalidieren die Vergleichbarkeit lesend.
    doc.addEventListener?.('change', update);
    resourceBindings.set(runsElement, update);
    update();
}

export function initMonteCarloMethodControls() {
    const methodElement = document.getElementById('mcMethode');
    const blockSizeElement = document.getElementById('mcBlockSize');
    if (!methodElement || !blockSizeElement) return;

    const blockSizeLabel = document.getElementById('mcBlockSizeLabel');
    const fixedBlockTitle = 'Länge der historischen Blöcke für Block-Bootstrap';
    const stationaryTitle = 'Erwartete mittlere Blocklänge für Stationary Bootstrap (1-30 Jahre)';
    const disabledTitle = 'Nur bei Block-Bootstrap oder Stationary Bootstrap relevant';

    const updateControls = () => {
        const method = methodElement.value;
        const usesBlockLength = method === 'block' || method === STATIONARY_BOOTSTRAP_METHOD;
        blockSizeElement.disabled = !usesBlockLength;

        if (method === STATIONARY_BOOTSTRAP_METHOD) {
            if (blockSizeLabel) blockSizeLabel.textContent = 'Erwartete Blocklänge (Jahre)';
            blockSizeElement.title = stationaryTitle;
        } else {
            if (blockSizeLabel) blockSizeLabel.textContent = 'Blockgröße (Jahre)';
            blockSizeElement.title = method === 'block' ? fixedBlockTitle : disabledTitle;
        }
        if (blockSizeElement.ownerDocument && blockSizeElement.parentNode) {
            setFieldState(blockSizeElement, usesBlockLength ? 'editable' : 'inactive', blockSizeElement.title);
        }
    };

    methodElement.addEventListener('change', updateControls);
    updateControls();
    initMonteCarloResourceControls();
}

export function initMonteCarloStartYearControls() {
    const modeElement = document.getElementById('mcStartYearMode');
    if (!modeElement) return;

    const filterRow = document.getElementById('mcStartYearFilterRow');
    const halfLifeRow = document.getElementById('mcStartYearHalfLifeRow');
    const filterValue = document.getElementById('mcStartYearFilterValue');
    const halfLifeValue = document.getElementById('mcStartYearHalfLifeValue');
    const filterInput = document.getElementById('mcStartYearFilter');
    const halfLifeInput = document.getElementById('mcStartYearHalfLife');
    const capeToggle = document.getElementById('useCapeSampling');
    const capeWarning = document.getElementById('mcStartYearCapeWarning');

    const syncRangeValue = (input, output) => {
        if (!input || !output) return;
        output.textContent = String(input.value);
    };

    const updateVisibility = () => {
        const mode = modeElement.value || 'UNIFORM';
        if (filterRow) filterRow.style.display = mode === 'FILTER' ? 'block' : 'none';
        if (halfLifeRow) halfLifeRow.style.display = mode === 'RECENCY' ? 'block' : 'none';
        if (capeWarning) {
            const capeActive = capeToggle?.checked === true;
            capeWarning.style.display = capeActive && mode !== 'UNIFORM' ? 'block' : 'none';
        }
    };

    if (filterInput && filterValue) {
        syncRangeValue(filterInput, filterValue);
        filterInput.addEventListener('input', () => syncRangeValue(filterInput, filterValue));
    }
    if (halfLifeInput && halfLifeValue) {
        syncRangeValue(halfLifeInput, halfLifeValue);
        halfLifeInput.addEventListener('input', () => syncRangeValue(halfLifeInput, halfLifeValue));
    }

    modeElement.addEventListener('change', updateVisibility);
    if (capeToggle) {
        capeToggle.addEventListener('change', updateVisibility);
    }
    updateVisibility();
}
