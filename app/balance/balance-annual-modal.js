import { createAnnualCloseDialog } from '../shared/annual-close-dialog.js';
import { projectAnnualPreview } from './balance-annual-preview.js';
import { UIRenderer } from './balance-renderer.js';
const adapters = new WeakMap();
const current = () => globalThis.document && adapters.get(globalThis.document);
/**
 * @param error Eingabe für die bestehende Projektion.
 * @param action Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function reportAnnualActionError(error, action) {
    if (current()) current().reportError(error, action);
    else UIRenderer.handleActionError(error, 'annual', action);
}
/**
 * @returns Ergebnis der bestehenden Operation.
 */
export function clearAnnualActionError() { current()?.clearError(); UIRenderer.clearActionError('annual'); }
/**
 * @returns Ergebnis der bestehenden Operation.
 */
export function finishAnnualPreflight() { return current()?.finishPreflight() || false; }
/** Balance liefert nur seine Seitenkanäle; der Renderer gehört beiden Einstiegen. */
/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {import('../../typcheck/balance-ui.js').AnnualModalOptions} [options] @returns Abschlussdialog mit Balance-Seitenkanälen. */
export function createAnnualModalHandlers({ dom = { inputs: {} }, ...options } = {}) {
    const adapter = /** @type {import('../../typcheck/balance-ui.js').CreateAnnualDialog} */ (createAnnualCloseDialog)({ ...options,
        projectPreview: preview => projectAnnualPreview({ ...preview, inputs: dom.inputs }),
        evaluatePlan: options.evaluatePlan,
        onError: (error, action) => UIRenderer.handleActionError(error, 'annual', action),
        onClearError: () => UIRenderer.clearActionError('annual'), onNotice: text => UIRenderer.toast(text) });
    if (globalThis.document) adapters.set(globalThis.document, adapter);
    return adapter;
}
