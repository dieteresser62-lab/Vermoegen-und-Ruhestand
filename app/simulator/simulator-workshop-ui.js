import { activateSimulatorTab } from './simulator-main-tabs.js';

const bindings = new WeakSet();
const toolLabels = { replay: 'Stresspfad-Replay', sweep: 'Parameter-Sweep', optimize: 'Auto-Optimize' };
/**
 * @param tool
 * @param {object} [options]
 * @param {boolean} [options.focus]
 * @param [options.documentRef]
 * @returns {boolean} Ergebnis der Operation.
 */
export function selectWorkshopTool(tool, { focus = false, documentRef = globalThis.document } = {}) {
    if (!documentRef || typeof documentRef.getElementById !== 'function' || typeof documentRef.querySelectorAll !== 'function') return false;
    let target;
    try { target = documentRef.getElementById(tool === 'replay' ? 'workshopReplayPanel' : tool === 'sweep' ? 'tab-sweep' : tool === 'optimize' ? 'tab-auto-optimize' : ''); }
    catch { return false; }
    if (tool !== null && !target) return false;
    // Vor der ersten DOM-Änderung alle benötigten Mengen prüfen; Adapter brauchen keinen Einzelselektor.
    let panels, buttons, selected, cards;
    try {
        cards = documentRef.getElementById('workshopToolCards');
        panels = [.../** @type {NodeListOf<HTMLElement>} */ (documentRef.querySelectorAll('[data-workshop-panel]'))];
        buttons = [.../** @type {NodeListOf<HTMLElement>} */ (documentRef.querySelectorAll('[data-workshop-tool]'))];
        selected = buttons.find(button => button.getAttribute?.('aria-pressed') === 'true');
        const tabs = [.../** @type {NodeListOf<HTMLButtonElement>} */ (documentRef.querySelectorAll('.tab-btn'))];
        const mainPanels = [.../** @type {NodeListOf<HTMLElement>} */ (documentRef.querySelectorAll('.tab-panel'))];
        if (target && !mainPanels.includes(documentRef.getElementById('tab-werkstatt'))) return false;
        if ((target && (!documentRef.getElementById('tab-werkstatt') || !panels.includes(target)))
            || tabs.some(button => !button.dataset)
            || buttons.some(button => typeof button.setAttribute !== 'function' || !button.dataset)
            || [...tabs, ...mainPanels].some(node => typeof node.classList?.toggle !== 'function')) return false;
    } catch { return false; }
    // Werkzeugwahl muss auch den vorhandenen Hauptreiter sichtbar machen.
    if (target && !activateSimulatorTab('werkstatt', { documentRef })) return false;
    panels.forEach(panel => { panel.hidden = panel !== target; });
    if (cards) cards.hidden = false;
    buttons.forEach(button => {
        const active = button.dataset.workshopTool === tool;
        button.setAttribute('aria-pressed', String(active));
        button.setAttribute('aria-expanded', String(active));
        button.setAttribute('aria-label', `${toolLabels[button.dataset.workshopTool]} ${active ? 'schließen' : 'öffnen'}`);
        button.textContent = active ? 'Schließen' : 'Öffnen';
        /** @type {HTMLElement} */ (button.closest?.('.sim-tool-card'))?.classList?.toggle?.('is-active', active);
    });
    if (focus) (target || selected)?.focus?.();
    return true;
}
/** Öffnet den vorhandenen Replayhost, ohne Controller oder Arbeitsstand neu anzulegen.
 *
 * @param {object} [options]
 * @param [options.documentRef]
 * @param [options.target]
 * @returns {boolean} Ergebnis der Operation.
 */
export function openWorkshopReplay({ documentRef = globalThis.document, target = null } = {}) {
    if (!selectWorkshopTool('replay', { documentRef })) return false;
    (target || documentRef.getElementById('workshopReplayPanel'))?.focus?.();
    return true;
}
/**
 * @param [documentRef] Zugehöriges Simulatordokument.
 * @returns {void}
 */
export function initWorkshopUI(documentRef = globalThis.document) {
    if (!documentRef || bindings.has(documentRef)) return;
    bindings.add(documentRef);
    const closePopups = [];
    /** @type {NodeListOf<HTMLElement>} */ (documentRef.querySelectorAll('#tab-werkstatt .ds-info')).forEach(host => {
        const button = /** @type {HTMLButtonElement} */ (host.querySelector('.ds-info-button'));
        const popup = /** @type {HTMLElement} */ (host.querySelector('.ds-info-pop'));
        if (!button || !popup) return;
        let pinned = false;
        const show = open => {
            host.dataset.visible = String(open);
            popup.hidden = !open;
            button.setAttribute('aria-expanded', String(open));
        };
        const close = () => { pinned = false; show(false); };
        close();
        button.addEventListener('click', () => { pinned = !pinned; show(pinned); });
        host.addEventListener('mouseenter', () => show(true));
        host.addEventListener('mouseleave', () => { if (!pinned && !host.contains(documentRef.activeElement)) show(false); });
        host.addEventListener('focusin', () => show(true));
        host.addEventListener('focusout', event => { if (!host.contains(/** @type {HTMLElement} */ (event.relatedTarget))) close(); });
        host.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); button.focus(); close(); }
        });
        closePopups.push({ host, close });
    });
    documentRef.addEventListener?.('click', event => {
        closePopups.forEach(({ host, close }) => { if (!host.contains(/** @type {HTMLElement} */ (event.target))) close(); });
    });
    /** @type {NodeListOf<HTMLElement>} */ (documentRef.querySelectorAll('[data-workshop-tool]')).forEach(button => button.addEventListener('click', () => {
        const tool = button.getAttribute('aria-pressed') === 'true' ? null : button.dataset.workshopTool;
        selectWorkshopTool(tool, { focus: true, documentRef });
    }));
    const navigation = documentRef.getElementById('workshopToolCards');
    navigation?.addEventListener('keydown', event => {
        const buttons = [.../** @type {NodeListOf<HTMLElement>} */ (navigation.querySelectorAll('[data-workshop-tool]'))];
        const index = buttons.indexOf(/** @type {HTMLElement} */ (event.target));
        if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        selectWorkshopTool(buttons[next].dataset.workshopTool, { documentRef });
        buttons[next].focus();
    });
}
