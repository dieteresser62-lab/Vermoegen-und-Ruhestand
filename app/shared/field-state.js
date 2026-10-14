// Reine Darstellung: Aufrufer liefern Zustand und bereits feststehenden Grund.
export const FIELD_STATES = Object.freeze([
    'adopted', 'editable', 'inactive', 'empty', 'unrated', 'warning', 'error'
]);
const presentations = new WeakMap();
let reasonSequence = 0;

/** Werte, Sperren, Inputattribute und Speicher bleiben Eigentum des Aufrufers. */
export function setFieldState(field, state, reason = '') {
    if (!FIELD_STATES.includes(state)) throw new TypeError(`Ungültiger Feldzustand: ${state}`);
    if (typeof reason !== 'string' || (state !== 'editable' && !reason.trim())) {
        throw new TypeError('Der Feldzustand benötigt einen sichtbaren Grund.');
    }
    if (!field?.ownerDocument || !field.parentNode) throw new TypeError('Das Feld benötigt einen DOM-Elternknoten.');
    let presentation = presentations.get(field);
    if (!presentation) {
        const doc = field.ownerDocument;
        let id;
        do { id = `ds-field-reason-${++reasonSequence}`; } while (doc.getElementById(id));
        presentation = { id, node: null };
        presentations.set(field, presentation);
    }
    const { id } = presentation;
    if (field.getAttribute('data-field-state') !== state) field.setAttribute('data-field-state', state);
    const descriptions = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).filter(value => value !== id);
    if (reason.trim()) {
        if (!presentation.node) {
            presentation.node = field.ownerDocument.createElement('span');
            presentation.node.id = id;
            presentation.node.className = 'ds-field-reason';
        }
        const node = presentation.node;
        if (node.textContent !== reason) node.textContent = reason;
        if (node.getAttribute('data-field-state') !== state) node.setAttribute('data-field-state', state);
        // Einheitenrahmen enthält nur Wert und Einheit; Hinweise stehen darunter.
        const anchor = field.parentNode.classList?.contains('ds-unit-frame') ? field.parentNode : field;
        if (anchor.nextSibling !== node) anchor.parentNode.insertBefore(node, anchor.nextSibling);
        descriptions.push(id);
    } else {
        presentation.node?.remove();
        presentation.node = null;
    }
    const describedBy = descriptions.join(' ');
    if (describedBy) {
        if (field.getAttribute('aria-describedby') !== describedBy) field.setAttribute('aria-describedby', describedBy);
    } else if (field.hasAttribute('aria-describedby')) {
        field.removeAttribute('aria-describedby');
    }
    return presentation.node;
}
