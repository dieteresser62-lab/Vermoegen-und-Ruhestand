// Gemeinsamer Anzeigezustand für Simulator-Reiter. Bleibt im Dokument, nie im Profil.
import { bindInfoPopovers } from '../shared/designsystem-info-popover.js';
export const DEFAULT_EURO_MODE = 'real';
const sessions = new WeakMap();
function session(doc) {
    if (!sessions.has(doc)) sessions.set(doc, { mode: DEFAULT_EURO_MODE, listeners: new Set() });
    return sessions.get(doc);
}
/**
 * @param mode - Anzeige- oder Berechnungsmodus.
 * @returns Ergebnis der Operation.
 */
export const euroBasisLabel = mode => mode === 'real' ? 'heutige Euro' : 'nominale Euro';
/**
 * @param {Document} [doc] - Dokument der Simulatorseite.
 * @returns Ergebnis der Operation.
 */
export const getEuroMode = (doc = globalThis.document) => doc ? session(doc).mode : DEFAULT_EURO_MODE;
/**
 * @param mode - Anzeige- oder Berechnungsmodus.
 * @param {Document} [doc] - Dokument der Simulatorseite.
 * @returns {void}
 */
export function setEuroMode(mode, doc = globalThis.document) {
    if (!doc || !['nominal', 'real'].includes(mode)) return;
    const state = session(doc);
    if (state.mode === mode) return;
    state.mode = mode;
    for (const listener of state.listeners) listener(mode);
}
/**
 * @param {Document} [doc] - Dokument der Simulatorseite.
 * @returns {void}
 */
export const resetEuroMode = (doc = globalThis.document) => setEuroMode(DEFAULT_EURO_MODE, doc);
/**
 * @param doc - Dokument der Simulatorseite.
 * @param listener - Callback bei einer Anzeigeänderung.
 * @returns Ergebnis der Operation.
 */
export function subscribeEuroMode(doc, listener) {
    session(doc).listeners.add(listener);
    return () => session(doc).listeners.delete(listener);
}
/** Auch der Backtest kann denselben Baustein mit einer eigenen Host-ID binden.
 *
 * @param doc - Dokument der Simulatorseite.
 * @param host - Kontext für host.
 * @param onMode - Callback beim Wechsel der Preisbasis.
 * @returns Ergebnis der Operation.
 */
export function bindEuroMode(doc, host, onMode) {
    if (typeof doc?.addEventListener === 'function') bindInfoPopovers(doc);
    const render = mode => {
        if (host) host.hidden = false;
        // Auch noch ungebundene Ergebnisansichten zeigen bereits die gemeinsame Wahl.
        const buttons = new Set([...(host?.querySelectorAll?.('[data-wealth-mode]') || []),
            ...(doc.querySelectorAll?.('[data-wealth-mode]') || [])]);
        for (const button of buttons) {
            button.setAttribute('aria-pressed', String(button.getAttribute('data-wealth-mode') === mode));
        }
        onMode(mode);
    };
    const click = event => setEuroMode(event.target?.closest?.('[data-wealth-mode]')?.getAttribute('data-wealth-mode'), doc);
    host?.addEventListener('click', click);
    const unsubscribe = subscribeEuroMode(doc, render);
    render(getEuroMode(doc));
    return () => { host?.removeEventListener('click', click); unsubscribe(); };
}
