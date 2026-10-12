// Bindungen gehören den Hosts; entfernte Renderknoten werden nicht festgehalten.
const infoHosts = new WeakMap();
const infoDocuments = new WeakSet();

export function bindInfoPopovers(doc = globalThis.document) {
    if (!doc?.querySelectorAll) return;
    doc.querySelectorAll('.ds-info').forEach(host => {
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
        host.addEventListener('mouseenter', () => show(true));
        host.addEventListener('mouseleave', () => { if (!pinned && !host.contains(doc.activeElement)) show(false); });
        host.addEventListener('focusin', () => show(true));
        host.addEventListener('focusout', e => { if (!host.contains(e.relatedTarget)) close(); });
        button.addEventListener('click', () => { pinned = !pinned; show(pinned); });
        host.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.preventDefault(); button.focus(); close(); }
        });
    });
    if (infoDocuments.has(doc)) return;
    infoDocuments.add(doc);
    doc.addEventListener('click', e => {
        doc.querySelectorAll('.ds-info').forEach(host => {
            if (!host.contains(e.target)) infoHosts.get(host)?.();
        });
    });
}

