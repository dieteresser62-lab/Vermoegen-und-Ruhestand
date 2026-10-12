// Nur Volltext anzeigen; keine Auswahl, Speicherung oder Optionsentscheidung.
const bound = new WeakSet();
const documents = new WeakMap();
const roots = new WeakMap();

function documentState(doc) {
    if (documents.has(doc)) return documents.get(doc);
    const state = { selects: new Set(), context: doc.createElement('canvas').getContext?.('2d') };
    const refresh = () => {
        for (const select of state.selects) {
            if (select.isConnected === false) {
                state.resize?.unobserve(select);
                state.selects.delete(select);
            } else syncSelectionText(select);
        }
    };
    const Resize = doc.defaultView?.ResizeObserver;
    if (Resize) state.resize = new Resize(entries => entries.forEach(({ target }) => {
        if (target.isConnected === false) {
            state.resize.unobserve(target);
            state.selects.delete(target);
        } else syncSelectionText(target);
    }));
    doc.fonts?.addEventListener?.('loadingdone', refresh);
    doc.fonts?.ready?.then(refresh);
    doc.defaultView?.addEventListener?.('resize', refresh);
    // Das Druckende kann noch vor der Bildschirm-Layoutwiederherstellung kommen.
    // Im nächsten Zeichenframe messen; mehrere Drucksignale teilen einen Nachlauf.
    let printRefreshPending = false;
    const afterPrint = () => {
        refresh();
        if (printRefreshPending || !doc.defaultView?.requestAnimationFrame) return;
        printRefreshPending = true;
        doc.defaultView.requestAnimationFrame(() => { printRefreshPending = false; refresh(); });
    };
    doc.defaultView?.addEventListener?.('afterprint', afterPrint);
    doc.defaultView?.matchMedia?.('print')?.addEventListener?.('change', event => {
        if (!event.matches) afterPrint();
    });
    documents.set(doc, state);
    return state;
}

// Canvas misst dieselbe Schrift ohne zusätzliche Layoutknoten. Der native
// Auswahlindikator benötigt unabhängig vom Textpadding einen eigenen Bereich.
function isTruncated(select, label, state) {
    const style = select.ownerDocument.defaultView?.getComputedStyle?.(select);
    const width = select.clientWidth;
    if (!style || !state.context || !width || !select.getClientRects?.().length) return false;
    const number = value => Number.parseFloat(value) || 0;
    state.context.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const rendered = style.textTransform === 'uppercase' ? label.toUpperCase()
        : style.textTransform === 'lowercase' ? label.toLowerCase() : label;
    const measured = state.context.measureText(rendered).width
        + Math.max(0, rendered.length - 1) * number(style.letterSpacing);
    const indicator = style.appearance === 'none' ? 0 : Math.max(20, number(style.fontSize));
    const available = width - number(style.paddingLeft) - number(style.paddingRight) - indicator;
    return Boolean(label) && measured > available;
}

// Nur die gebundene Instanz erweitern. Originalaccessoren behalten DOM-Semantik
// und Empfänger; einfache Datenfelder älterer DOM-freier Mocks bleiben unberührt.
function bindSelectionSetters(select) {
    for (const property of ['value', 'selectedIndex']) {
        let owner = select;
        let descriptor;
        while (owner && !descriptor) {
            descriptor = Object.getOwnPropertyDescriptor(owner, property);
            owner = Object.getPrototypeOf(owner);
        }
        if (!descriptor?.get || !descriptor?.set) continue;
        const { get, set, enumerable } = descriptor;
        Object.defineProperty(select, property, {
            configurable: true,
            enumerable,
            get() { return get.call(this); },
            set(value) {
                set.call(this, value);
                syncSelectionText(this);
            }
        });
    }
}

export function syncSelectionText(select) {
    const doc = select?.ownerDocument;
    if (!doc || !select.id || select.isConnected === false) return null;
    const targetId = `${select.id}-fulltext`;
    let text = doc.getElementById(targetId);
    if (!text) {
        text = doc.createElement('span');
        text.id = targetId;
        text.className = 'ds-selection-text';
        select.insertAdjacentElement?.('afterend', text);
        if (!text.parentNode) return null;
    }
    const state = documentState(doc);
    const selectedText = select.selectedOptions?.[0]?.textContent || '';
    if (text.textContent !== selectedText) text.textContent = selectedText;
    const described = new Set((select.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    const hidden = !isTruncated(select, selectedText, state);
    if (text.hidden !== hidden) text.hidden = hidden;
    if (text.hidden) described.delete(targetId);
    else described.add(targetId);
    const description = [...described].join(' ');
    if (description) {
        if (select.getAttribute('aria-describedby') !== description) select.setAttribute('aria-describedby', description);
    } else if (select.hasAttribute('aria-describedby')) select.removeAttribute('aria-describedby');
    if (!bound.has(select)) {
        bindSelectionSetters(select);
        select.addEventListener('change', () => syncSelectionText(select));
        bound.add(select);
    }
    if (!state.selects.has(select)) {
        state.selects.add(select);
        state.resize?.observe(select);
    }
    return text;
}


// Neu erzeugte Selects und Optionslisten ergänzen; keine Auswahlentscheidung.
export function observeSelectionText(root) {
    if (!root?.querySelectorAll) return null;
    if (roots.has(root)) return roots.get(root);
    const refresh = () => root.querySelectorAll('select[id]').forEach(syncSelectionText);
    refresh();
    // reset wird vor der nativen Rücksetzung ausgelöst. Erst die Microtask liest
    // die neuen Optionen; kein eigener Reset, Setter oder künstliches Ereignis.
    root.addEventListener?.('reset', () => queueMicrotask(refresh), true);
    const Observer = root.ownerDocument?.defaultView?.MutationObserver;
    const observer = Observer ? new Observer(records => {
        if (records.some(record => {
            if (record.target.classList?.contains('ds-selection-text') || record.target.parentElement?.classList?.contains('ds-selection-text')) return false;
            if (record.type === 'attributes' && ['class', 'style', 'hidden'].includes(record.attributeName)) return true;
            return record.target.closest?.('select') || record.target.parentElement?.closest('select') ||
                [...(record.addedNodes || [])].some(node => node.nodeType === 1 &&
                    (node.matches?.('select, option') || node.querySelector?.('select')));
        })) refresh();
    }) : null;
    observer?.observe(root, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['selected', 'class', 'style', 'hidden'] });
    roots.set(root, observer);
    return observer;
}
