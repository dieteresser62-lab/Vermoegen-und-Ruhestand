// VN-1 Punkt 1: Abgleich eines sichtbaren Teilbaums mit einem neu gebauten, ohne gleichartige Knoten auszutauschen. So behalten
// Eingabefelder, Auswahllisten und Knöpfe Fokus, Cursor und Mausklick, während sich berechnete Werte an Ort und Stelle ändern.
// Die Ereignisse der vorhandenen Knoten bleiben. Wer diesen Abgleich nutzt, hält Werte deshalb nicht in Variablen vom Bauzeitpunkt,
// sondern im Entwurf oder in Attributen (etwa `data-copy` an „Kopieren“).

/** @param {Node} node */
const isElement = node => node.nodeType === 1;
/** @param {Element} node */
const tag = node => node.tagName.toLowerCase();

/** Gleichartig: gleicher Knotentyp und Tag, gleiche Kennung; bei Eingaben auch gleicher Typ, Name und Wert der Wahl.
 * @param {Node} a @param {Node} b */
function sameKind(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (!isElement(a)) return true;
    const left = /** @type {Element} */ (a), right = /** @type {Element} */ (b);
    if (tag(left) !== tag(right) || left.id !== right.id) return false;
    if (tag(left) !== 'input') return true;
    return ['type', 'name'].every(name => left.getAttribute(name) === right.getAttribute(name))
        && (!['radio', 'checkbox'].includes(/** @type {HTMLInputElement} */ (left).type) || left.getAttribute('value') === right.getAttribute('value'));
}

/** @param {Element} target @param {Element} source */
function syncAttributes(target, source) {
    for (const { name } of Array.from(target.attributes)) if (!source.hasAttribute(name)) target.removeAttribute(name);
    for (const { name, value } of Array.from(source.attributes)) if (target.getAttribute(name) !== value) target.setAttribute(name, value);
}

/** Formularzustand, den keine Attribute tragen. Das Feld mit dem Fokus behält seinen Text. @param {Element} target @param {Element} source */
function syncFormState(target, source) {
    const name = tag(target);
    const focused = target.ownerDocument?.activeElement === target;
    if (name === 'input') {
        const input = /** @type {HTMLInputElement} */ (target), next = /** @type {HTMLInputElement} */ (source);
        if (['radio', 'checkbox'].includes(input.type)) { if (input.checked !== next.checked) input.checked = next.checked; }
        else if (!focused && input.value !== next.value) input.value = next.value;
    } else if ((name === 'select' || name === 'textarea') && !focused) {
        const field = /** @type {HTMLSelectElement|HTMLTextAreaElement} */ (target), next = /** @type {HTMLSelectElement|HTMLTextAreaElement} */ (source);
        if (field.value !== next.value) field.value = next.value;
    }
}

/** Gleicht `target` an `source` an. Neue oder andersartige Knoten wandern aus `source` herüber; `source` ist danach verbraucht.
 * @param {Element} target sichtbarer Teilbaum @param {Element} source neu gebauter Teilbaum gleicher Art */
export function patchInPlace(target, source) {
    syncAttributes(target, source);
    const before = Array.from(target.childNodes), after = Array.from(source.childNodes);
    after.forEach((child, index) => {
        const old = before[index];
        if (!old) target.appendChild(child);
        else if (!sameKind(old, child)) target.replaceChild(child, old);
        else if (isElement(old)) patchInPlace(/** @type {Element} */ (old), /** @type {Element} */ (child));
        else if (old.nodeValue !== child.nodeValue) old.nodeValue = child.nodeValue;
    });
    before.slice(after.length).forEach(node => node.parentNode === target && target.removeChild(node));
    syncFormState(target, source);
}
