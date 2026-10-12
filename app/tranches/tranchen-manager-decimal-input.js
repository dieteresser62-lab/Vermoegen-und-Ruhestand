// Nur DOM-Zahlenadapter: kanonische Records und Fachparser bleiben unverändert.
export function canonicalDecimalInput(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return '';
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) return 'NaN';
    const canonical = text.replace(',', '.');
    return Number.isFinite(Number(canonical)) ? canonical : 'NaN';
}

export function readDecimalInput(raw) {
    const value = canonicalDecimalInput(raw);
    return value === '' ? Number.NaN : Number(value);
}

// Keine Gruppierung oder Rundung: auch Bruchstücke behalten alle Stellen.
export function displayDecimalInput(value) {
    return String(value ?? '').replace('.', ',');
}

export function isEditableDecimalInput(element) {
    return element?.tagName?.toLowerCase() === 'input'
        && element.type === 'text' && element.getAttribute('inputmode') === 'decimal'
        && !element.disabled && !element.readOnly;
}

const boundDocuments = new WeakSet();

// Delegiert auch an später erzeugte Dialogfelder. Darstellung löst keine Events aus.
export function bindDecimalInputDisplay(doc = document) {
    if (boundDocuments.has(doc)) return;
    boundDocuments.add(doc);
    doc.addEventListener('focusout', event => {
        const field = event.target;
        if (!isEditableDecimalInput(field)) return;
        const canonical = canonicalDecimalInput(field.value);
        if (canonical === '' || canonical === 'NaN') return;
        field.value = displayDecimalInput(field.value);
    });
}
