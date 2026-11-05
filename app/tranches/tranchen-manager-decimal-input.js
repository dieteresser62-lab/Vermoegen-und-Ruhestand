// Nur DOM-Zahlenadapter: kanonische Records und Fachparser bleiben unverändert.
const moneyInputs = new Set(['profileTagesgeld', 'profileRenteMonatlich',
    'profileSparerPauschbetrag', 'profileHealthBucketInitialAmount', 'purchasePrice', 'currentPrice',
    'reconcileGrossProceeds', 'reconcileFees', 'reconcileRecommendedGross', 'reconcileInitialCashBalance', 'cashPostingBalance']);
/** @param {{id?: string}|null} field @returns {boolean} */
export const isMoneyInput = field => /^(?:home-(?:wert|mieteNetto|ortsueblicheMiete)|inheritance-min-\d+)$/.test(field?.id || '') || moneyInputs.has(field?.id) || /^(?:plannedInflow-\d+-amount|(?:income|expense)-\d+-(?:betrag|betragMonat))$/.test(field?.id || '');
// Gruppierte Anzeige eindeutig vom weiterhin erlaubten Dezimalpunkt unterscheiden.
const displays = new WeakMap();

/** @param {unknown} raw
 * @param {HTMLInputElement|HTMLSelectElement|null} [field]
 * @returns {string} */
export function canonicalDecimalInput(raw, field = null) {
    const text = String(raw ?? '').trim();
    const display = field && displays.get(field);
    if (display?.text === text) return display.canonical;
    if (!text) return '';
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) return 'NaN';
    const canonical = text.replace(',', '.');
    return Number.isFinite(Number(canonical)) ? canonical : 'NaN';
}

/** @param {unknown} raw
 * @param {HTMLInputElement|HTMLSelectElement|null} [field]
 * @returns {number} */
export function readDecimalInput(raw, field = null) {
    const value = canonicalDecimalInput(raw, field);
    return value === '' ? Number.NaN : Number(value);
}

// Keine Rundung: auch Preise und Bruchstücke behalten alle Stellen.
/** @param {unknown} value
 * @param {HTMLInputElement|HTMLSelectElement|null} [field]
 * @param {{editing?: boolean}} [options]
 * @returns {string} */
export function displayDecimalInput(value, field = null, { editing = false } = {}) {
    const canonical = canonicalDecimalInput(value);
    let text = String(value ?? '').replace('.', ',');
    if (isMoneyInput(field) && !editing && canonical !== '' && canonical !== 'NaN') {
        text = text.replace(/^([+-]?)(\d+)/, (_, sign, integer) => sign + integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
        displays.set(field, { text, canonical });
    } else if (field) displays.delete(field);
    return text;
}

/** @param {(EventTarget & Partial<HTMLInputElement>)|null} element
 * @returns {element is HTMLInputElement} */
export function isEditableDecimalInput(element) {
    return element?.tagName?.toLowerCase() === 'input'
        && element.type === 'text' && element.getAttribute('inputmode') === 'decimal'
        && !element.disabled && !element.readOnly;
}

const boundDocuments = new WeakSet();

// Delegiert auch an später erzeugte Dialogfelder. Darstellung löst keine Events aus.
/** @param {Document} [doc]
 * @returns {void} */
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
