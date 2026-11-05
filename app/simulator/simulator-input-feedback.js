// Feldhinweise an der UI-Grenze; dieselbe Validierung wie beim Rechenstart.
import { setFieldState } from '../shared/field-state.js';
import { getCommonInputs } from './simulator-portfolio-inputs.js';
import { validateSimulatorInputs, simulatorValidationFieldId, formatSimulatorValidationError } from './simulator-input-validation.js';
import { activateSimulatorTab } from './simulator-main-tabs.js';
import { revealAssumptionControl } from './simulator-assumptions-ui.js';

const documents = new WeakMap();
const survivorFields = new Set(['survivorFloorPercent', 'survivorFlexPercent', 'survivorMinimumFlexPercent']);
function stateFor(doc) {
    if (!documents.has(doc)) documents.set(doc, { fields: new Map() });
    return documents.get(doc);
}
function markField(doc, field, message) {
    const state = stateFor(doc);
    if (!state.fields.has(field)) {
        const reason = (field.getAttribute('aria-describedby') || '').split(/\s+/)
            .map(id => doc.getElementById(id)).find(node => node?.classList?.contains('ds-field-reason'));
        state.fields.set(field, { state: field.getAttribute('data-field-state') || 'editable', reason: reason?.textContent || '' });
    }
    setFieldState(field, 'error', message);
}
function openDetails(field) {
    for (let parent = field?.parentElement; parent; parent = parent.parentElement) {
        if (parent.matches('details')) parent.open = true;
    }
}

/** Gibt true zurück, wenn der Hinweis mit dem Feld unter Annahmen sichtbar ist.
 *
 * @param doc Zugehöriges Simulatordokument.
 * @param error Fehler aus Validierung oder Laufzeit.
 * @param operation
 * @param {object} [options]
 * @param {boolean} [options.focus]
 * @returns {boolean} Ergebnis der Operation.
 */
export function showSimulatorInputError(doc, error, operation, { focus = true } = {}) {
    const field = doc?.getElementById(simulatorValidationFieldId(error));
    if (/** @type {HTMLElement} */ (field?.closest?.('.tab-panel'))?.id !== 'tab-annahmen' || !field.ownerDocument) return false;
    const message = formatSimulatorValidationError(error);
    for (const entry of error.errors || [{ fieldId: field.id, message }]) {
        const control = doc.getElementById(entry.fieldId);
        if (/** @type {HTMLElement} */ (control?.closest?.('.tab-panel'))?.id === 'tab-annahmen') markField(doc, control, entry.message);
    }
    const state = stateFor(doc);
    if (operation) state.operation = operation;
    const notice = doc.getElementById('simAssumptionError');
    if (notice) {
        notice.textContent = state.operation ? `${state.operation} nicht gestartet: ${message}` : `Bitte Eingaben prüfen: ${message}`;
        notice.hidden = false;
    }
    openDetails(field);
    if (focus) {
        activateSimulatorTab('annahmen', { documentRef: doc });
        revealAssumptionControl(field);
        if (field.disabled) notice?.focus();
    }
    return true;
}

/**
 * @param doc Zugehöriges Simulatordokument.
 * @param [readInputs]
 * @returns {void}
 */
export function bindSimulatorInputFeedback(doc, readInputs = getCommonInputs) {
    const host = doc.getElementById('tab-annahmen');
    const state = stateFor(doc);
    if (!host || state.bound) return;
    state.bound = true;
    const refresh = event => {
        const onLeave = event.type === 'focusout' && survivorFields.has(/** @type {HTMLElement} */ (event.target)?.id);
        if (!state.fields.size && !onLeave) return;
        let error = null;
        try { validateSimulatorInputs(readInputs()); } catch (caught) { error = caught; }
        if (error && !Array.isArray(error.errors)) return;
        const entries = error?.errors || [];
        for (const [field, previous] of state.fields) {
            const entry = entries.find(entry => entry.fieldId === field.id);
            if (entry) setFieldState(field, 'error', entry.message);
            else {
                setFieldState(field, previous.state, previous.reason);
                state.fields.delete(field);
            }
        }
        if (!state.fields.size) {
            const notice = doc.getElementById('simAssumptionError');
            if (notice) { notice.hidden = true; notice.textContent = ''; }
            state.operation = null;
        }
        if (onLeave) {
            const errors = entries.filter(entry => survivorFields.has(entry.fieldId));
            if (errors.length) showSimulatorInputError(doc, { ...error, message: errors[0].message, errors }, null, { focus: false });
        }
    };
    for (const event of ['input', 'change', 'focusout']) host.addEventListener(event, refresh);
}
