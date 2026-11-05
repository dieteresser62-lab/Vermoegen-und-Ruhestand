"use strict";

const bindings = new WeakSet();
const recoveryTabs = new WeakMap();

/** Frühe technische Profil-Recovery braucht weder Formular- noch Runnerinitialisierung.
 *
 * @param message Anzuzeigende Meldung.
 * @param {object} [options]
 * @param [options.documentRef]
 * @returns {void}
 */
export function renderSimulatorProfileRecovery(message, { documentRef = globalThis.document } = {}) {
    if (!documentRef) return;
    if (message) {
        if (!recoveryTabs.has(documentRef)) recoveryTabs.set(documentRef, new Map());
        const previous = recoveryTabs.get(documentRef);
        /** @type {NodeListOf<HTMLButtonElement>} */ (documentRef.querySelectorAll('.tab-btn')).forEach(button => {
            if (!previous.has(button)) previous.set(button, {
                disabled: button.disabled, ariaDisabled: button.getAttribute('aria-disabled'), title: button.getAttribute('title')
            });
            button.disabled = true;
            button.setAttribute('aria-disabled', 'true');
            button.setAttribute('title', 'Profil-Recovery erforderlich');
        });
        const panel = documentRef.getElementById('tab-ergebnis');
        if (!panel) return;
        let host = documentRef.getElementById('simProfileRecoveryStatus');
        if (!host) {
            host = documentRef.createElement('div');
            host.id = 'simProfileRecoveryStatus';
            host.setAttribute('role', 'status');
            host.setAttribute('aria-live', 'polite');
            panel.appendChild(host);
        }
        host.textContent = message;
        return;
    }
    recoveryTabs.get(documentRef)?.forEach((state, button) => {
        button.disabled = state.disabled;
        for (const [name, value] of [['aria-disabled', state.ariaDisabled], ['title', state.title]]) {
            if (value === null) button.removeAttribute(name); else button.setAttribute(name, value);
        }
    });
    recoveryTabs.delete(documentRef);
    documentRef.getElementById('simProfileRecoveryStatus')?.remove();
}

/**
 * @param tab
 * @param {object} [options]
 * @param [options.documentRef]
 * @returns {boolean} Ergebnis der Operation.
 */
export function activateSimulatorTab(tab, { documentRef = globalThis.document } = {}) {
    if (recoveryTabs.has(documentRef)) return false;
    const target = documentRef?.getElementById('tab-' + tab);
    if (!target) return false;
    /** @type {NodeListOf<HTMLButtonElement>} */ (documentRef.querySelectorAll('.tab-btn')).forEach(button => {
        const active = button.dataset.tab === tab;
        button.classList.toggle('active', active);
        button.setAttribute?.('aria-selected', String(active));
    });
    /** @type {NodeListOf<HTMLElement>} */ (documentRef.querySelectorAll('.tab-panel')).forEach(panel => panel.classList.toggle('active', panel === target));
    // Eine eindeutige Leiste und ein Aktionshost folgen dem sichtbaren Seitenkopf.
    const header = /** @type {HTMLElement} */ (target.querySelector?.('.sim-page-head'));
    const tabs = /** @type {HTMLButtonElement} */ (documentRef.querySelector?.('.tab-buttons'));
    const actions = /** @type {HTMLElement} */ (documentRef.querySelector?.('.sim-page-actions'));
    const context = documentRef.getElementById('simulatorContextPills');
    if (header && tabs) header.insertAdjacentElement('afterend', tabs);
    if (header && actions) header.appendChild(actions);
    if (header && context) header.insertBefore(context, header.firstChild);
    if (typeof globalThis.CustomEvent === 'function') documentRef.dispatchEvent?.(new CustomEvent('simulator:tab', { detail: tab }));
    return true;
}

/**
 * @returns {void}
 */
export function initTabSwitching() {
    if (bindings.has(document)) return;
    bindings.add(document);
    const tabButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.tab-btn'));

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            activateSimulatorTab(button.dataset.tab);
        });
    });
}
