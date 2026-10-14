import { escapeHtml } from './security-utils.js';

/** Textsicheres Markup für Renderer, die ihre Inhalte als HTML einsetzen. */
export function infoPopoverHtml(label, text) {
    return `<span class="ds-info"><button type="button" class="ds-info-button" aria-label="${escapeHtml(label)}" aria-expanded="false">i</button><span class="ds-info-pop" role="tooltip">${escapeHtml(text)}</span></span>`;
}

// Bindungen gehören den Hosts; entfernte Renderknoten werden nicht festgehalten.
const infoHosts = new WeakMap();
const infoScopes = new WeakSet();

export function bindInfoPopovers(doc = globalThis.document, { root = doc, listen = (node, type, callback) => node.addEventListener(type, callback) } = {}) {
    if (!doc?.querySelectorAll || !root?.querySelectorAll) return;
    root.querySelectorAll('.ds-info').forEach(host => {
        if (infoHosts.has(host)) return;
        const button = host.querySelector('.ds-info-button');
        if (!button) return;
        let pinned = false;
        const show = visible => {
            host.dataset.visible = String(visible);
            button.setAttribute('aria-expanded', String(visible));
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
    listen(doc, 'click', e => {
        root.querySelectorAll('.ds-info').forEach(host => {
            if (!host.contains(e.target)) infoHosts.get(host)?.();
        });
    });
}

/** Textsicheres Markup für die vorhandene Info-Popover-Bindung. */
export function createInfoPopover(doc, label, text) {
    const host = doc.createElement('span'); host.className = 'ds-info';
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'ds-info-button';
    button.textContent = 'i'; button.setAttribute('aria-label', label); button.setAttribute('aria-expanded', 'false');
    const pop = doc.createElement('span'); pop.className = 'ds-info-pop'; pop.textContent = text;
    host.append(button, pop);
    return host;
}
