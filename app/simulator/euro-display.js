// Gemeinsamer Anzeigezustand für Simulator-Reiter. Bleibt im Dokument, nie im Profil.
import { bindInfoPopovers } from '../shared/designsystem-info-popover.js';
export const DEFAULT_EURO_MODE = 'nominal';
const sessions = new WeakMap();
function session(doc) {
    if (!sessions.has(doc)) sessions.set(doc, { mode: DEFAULT_EURO_MODE, listeners: new Set() });
    return sessions.get(doc);
}
export const euroBasisLabel = mode => mode === 'real' ? 'heutige Euro' : 'nominale Euro';
export const getEuroMode = (doc = globalThis.document) => doc ? session(doc).mode : DEFAULT_EURO_MODE;
export function setEuroMode(mode, doc = globalThis.document) {
    if (!doc || !['nominal', 'real'].includes(mode)) return;
    const state = session(doc);
    if (state.mode === mode) return;
    state.mode = mode;
    for (const listener of state.listeners) listener(mode);
}
export const resetEuroMode = (doc = globalThis.document) => setEuroMode(DEFAULT_EURO_MODE, doc);
export function subscribeEuroMode(doc, listener) {
    session(doc).listeners.add(listener);
    return () => session(doc).listeners.delete(listener);
}
/** Auch der Backtest kann denselben Baustein mit einer eigenen Host-ID binden. */
export function bindEuroMode(doc, host, onMode) {
    if (typeof doc?.addEventListener === 'function') bindInfoPopovers(doc);
    const render = mode => {
        if (host) host.hidden = false;
        for (const button of host?.querySelectorAll?.('[data-wealth-mode]') || []) {
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
