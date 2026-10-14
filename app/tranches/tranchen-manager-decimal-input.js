// Nur DOM-Zahlenadapter: kanonische Records und Fachparser bleiben unverändert.
const moneyInputs = new Set(['profileTagesgeld', 'profileRenteMonatlich', 'profileSonstigeEinkuenfte',
    'profileSparerPauschbetrag', 'profileHealthBucketInitialAmount', 'purchasePrice', 'currentPrice',
    'reconcileGrossProceeds', 'reconcileFees', 'reconcileRecommendedGross', 'reconcileInitialCashBalance', 'cashPostingBalance']);
export const isMoneyInput = field => moneyInputs.has(field?.id);
// Gruppierte Anzeige eindeutig vom weiterhin erlaubten Dezimalpunkt unterscheiden.
const displays = new WeakMap();

export function canonicalDecimalInput(raw, field = null) {
    const text = String(raw ?? '').trim();
    const display = field && displays.get(field);
    if (display?.text === text) return display.canonical;
    if (!text) return '';
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) return 'NaN';
    const canonical = text.replace(',', '.');
    return Number.isFinite(Number(canonical)) ? canonical : 'NaN';
}

export function readDecimalInput(raw, field = null) {
    const value = canonicalDecimalInput(raw, field);
    return value === '' ? Number.NaN : Number(value);
}

// Keine Rundung: auch Preise und Bruchstücke behalten alle Stellen.
export function displayDecimalInput(value, field = null, { editing = false } = {}) {
    const canonical = canonicalDecimalInput(value);
    let text = String(value ?? '').replace('.', ',');
    if (isMoneyInput(field) && !editing && canonical !== '' && canonical !== 'NaN') {
        text = text.replace(/^([+-]?)(\d+)/, (_, sign, integer) => sign + integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
        displays.set(field, { text, canonical });
    } else if (field) displays.delete(field);
    return text;
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
    doc.addEventListener('focusin', event => {
        const field = event.target;
        if (!isEditableDecimalInput(field) || !isMoneyInput(field)) return;
        const canonical = canonicalDecimalInput(field.value, field);
        if (canonical === '' || canonical === 'NaN') return;
        field.value = displayDecimalInput(canonical, field, { editing: true });
        field.select?.();
    });
    doc.addEventListener('focusout', event => {
        const field = event.target;
        if (!isEditableDecimalInput(field) || field.hasAttribute?.('data-manager-plan-field')) return;
        const canonical = canonicalDecimalInput(field.value, field);
        if (canonical === '' || canonical === 'NaN') return;
        field.value = displayDecimalInput(canonical, field);
    });
}
