import { escapeHtml } from './security-utils.js';

/** Nur für bereits textsicher erzeugtes Markup aus den Renderern.
 *
 * @param label Wert für den bestehenden Aufrufvertrag.
 * @param content Wert für den bestehenden Aufrufvertrag.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function infoPopoverContentHtml(label, content) {
    return `<span class="ds-info"><button type="button" class="ds-info-button" aria-label="${escapeHtml(label)}" aria-expanded="false">i</button><span class="ds-info-pop" role="tooltip">${content}</span></span>`;
}

/** Textsicheres Markup; ausführliche Erklärungen haben ein Handbuchziel.
 *
 * @param {string} label
 * @param {string} text
 * @param {{handbookAnchor?: string}} [options]
 * @returns {string} Textsicheres Markup.
 */
export function infoPopoverHtml(label, text, { handbookAnchor } = {}) {
    const link = handbookAnchor ? ` <a href="Handbuch.html#${escapeHtml(handbookAnchor)}">Mehr im Handbuch</a>` : '';
    return infoPopoverContentHtml(label, escapeHtml(text) + link);
}

// Bindungen gehören den Hosts; entfernte Renderknoten werden nicht festgehalten.
const infoHosts = new WeakMap();
const infoScopes = new WeakSet();

/** Position im sichtbaren Fenster, bevorzugt unter dem Knopf.
 *
 * @param anchor Wert für den bestehenden Aufrufvertrag.
 * @param box Wert für den bestehenden Aufrufvertrag.
 * @param width Wert für den bestehenden Aufrufvertrag.
 * @param height Wert für den bestehenden Aufrufvertrag.
 * @param container Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function infoPopoverPosition(anchor, box, width, height, container = { left: 0, right: width }) {
    const clamp = (value, size, limit) => Math.max(8, Math.min(value, limit - size - 8));
    return {
        left: clamp((anchor.left ?? anchor.right) + anchor.right < container.left + container.right ? (anchor.left ?? anchor.right) : anchor.right - box.width, box.width, width),
        top: clamp(anchor.bottom + box.height + 8 > height ? anchor.top - box.height - 8 : anchor.bottom + 8, box.height, height)
    };
}

function placeInfo(host, doc) {
    const pop = host.querySelector('.ds-info-pop'), button = /** @type {HTMLButtonElement|null} */ (host.querySelector('.ds-info-button'));
    if (!pop || !button || !doc.documentElement || !button.getBoundingClientRect || !pop.getBoundingClientRect) return;
    const width = doc.documentElement.clientWidth, height = doc.documentElement.clientHeight;
    // Inline-Angaben lösen auch ältere seitenbezogene Ankerregeln ab.
    Object.assign(pop.style, { position: 'fixed', right: 'auto', bottom: 'auto', transform: 'none',
        maxWidth: `${width - 16}px`, maxHeight: `${height - 16}px` });
    const container = button.closest?.('.ds-card, .ds-table-scroll, .ds-table-box, .table-scroll, .table-scroll-container, .protocol-table-wrapper, dialog, [role="dialog"]');
    const position = infoPopoverPosition(button.getBoundingClientRect(), pop.getBoundingClientRect(), width, height, container?.getBoundingClientRect());
    pop.style.left = `${position.left}px`;
    pop.style.top = `${position.top}px`;
}

/**
 * @param {Document} doc Dokument der Seite.
 * @param options Optionen des Aufrufers.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function bindInfoPopovers(doc = globalThis.document, { root = doc, listen = (node, type, callback) => node.addEventListener(type, callback) } = {}) {
    if (!doc?.querySelectorAll || !root?.querySelectorAll) return;
    /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.ds-info')).forEach(host => {
        if (infoHosts.has(host)) return;
        const button = /** @type {HTMLButtonElement|null} */ (host.querySelector('.ds-info-button'));
        if (!button) return;
        let pinned = false;
        const show = visible => {
            const value = String(visible);
            if (host.dataset.visible !== value) host.dataset.visible = value;
            if (button.getAttribute('aria-expanded') !== value) button.setAttribute('aria-expanded', value);
            if (visible) placeInfo(host, doc);
        };
        const close = () => { pinned = false; show(false); };
        show(false);
        infoHosts.set(host, close);
        listen(host, 'mouseenter', () => show(true));
        listen(host, 'mouseleave', () => { if (!pinned && !host.contains(doc.activeElement)) show(false); });
        listen(host, 'focusin', () => show(true));
        listen(host, 'focusout', e => { if (!host.contains(e.relatedTarget)) close(); });
        listen(button, 'click', () => { pinned = !pinned; show(pinned); });
        listen(host, 'keydown', e => {
            if (e.key === 'Escape') { e.preventDefault(); button.focus(); close(); }
        });
    });
    if (infoScopes.has(root)) return;
    infoScopes.add(root);
    const reposition = () => root.querySelectorAll('.ds-info[data-visible="true"]').forEach(host => placeInfo(host, doc));
    // Capture erreicht auch scrollende Karten und Dialoge.
    const scrolling = {
        addEventListener: (type, callback) => doc.addEventListener(type, callback, true),
        removeEventListener: (type, callback) => doc.removeEventListener(type, callback, true)
    };
    listen(scrolling, 'scroll', reposition);
    if (doc.defaultView?.addEventListener) listen(doc.defaultView, 'resize', reposition);
    listen(doc, 'click', e => {
        /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.ds-info')).forEach(host => {
            if (!host.contains(e.target)) infoHosts.get(host)?.();
        });
    });
}

/** Textsicheres Markup für die vorhandene Info-Popover-Bindung.
 *
 * @param {Document} doc
 * @param {string} label
 * @param {string} text
 * @param {{handbookAnchor?: string}} [options]
 * @returns {HTMLSpanElement} Hinweis mit Handbuchziel.
 */
export function createInfoPopover(doc, label, text, { handbookAnchor } = {}) {
    const host = doc.createElement('span'); host.className = 'ds-info';
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'ds-info-button';
    button.textContent = 'i'; button.setAttribute('aria-label', label); button.setAttribute('aria-expanded', 'false');
    const pop = doc.createElement('span'); pop.className = 'ds-info-pop'; pop.textContent = text;
    if (handbookAnchor) {
        const link = doc.createElement('a'); link.href = `Handbuch.html#${handbookAnchor}`; link.textContent = ' Mehr im Handbuch';
        pop.append(link);
    }
    host.append(button, pop);
    return host;
}
