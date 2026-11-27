// Nur DOM-Zahlenadapter: kanonische Records und Fachparser bleiben unverändert.
const moneyInputs = new Set(['profileTagesgeld', 'profileRenteMonatlich',
    'profileSparerPauschbetrag', 'profileHealthBucketInitialAmount', 'purchasePrice', 'currentPrice',
    'reconcileGrossProceeds', 'reconcileFees', 'reconcileRecommendedGross', 'reconcileInitialCashBalance', 'cashPostingBalance']);
/** @param {{id?: string}|null} field @returns {boolean} */
export const isMoneyInput = field => /^(?:home-(?:wert|mieteNetto|ortsueblicheMiete)|inheritance-(?:min|monthly-rent|estate-costs)-\d+|managerCare(?:Cost[1-5]|MaxFloor|OwnExpenses|Allowance[2-5]|Heim(?:Care|Board|Invest)))$/.test(field?.id || '') || moneyInputs.has(field?.id) || /^(?:plannedInflow-\d+-amount|(?:income|expense)-\d+-(?:betrag|betragMonat))$/.test(field?.id || '');
// Gruppierte Anzeige eindeutig vom weiterhin erlaubten Dezimalpunkt unterscheiden.
const displays = new WeakMap();
// UR-2b: Kursfelder behalten den Punkt als Dezimalzeichen (Kurse mit drei Nachkommastellen).
const PRICE_INPUTS = new Set(['purchasePrice', 'currentPrice']);
/** „100000.00“ → „100000“, „16785.10“ → „16785.1“ (kanonischer Text ohne Nachkommanullen). @param {string} text */
const withoutTrailingZeros = text => { const zeros = /^([^eE]*\.\d*?)0+$/.exec(text); return zeros ? zeros[1].replace(/\.$/, '') : text; };
const GROUPED = /^([+-]?)([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d*))?$/;

/** UR-2b: Betragsfelder lesen deutsche Gruppierung: Punkte vor genau drei Ziffern sind Tausenderpunkte, das Komma ist das
 * Dezimalzeichen („2.088“ → 2088, „2.088,50“ → 2088.5). Ein einzelner Punkt mit ein oder zwei Ziffern bleibt Dezimalpunkt;
 * weitere Punkte oder Punkt und Komma gemischt sind uneindeutig und ungültig.
 *
 * @param {string} text Getrimmter Feldtext.
 * @returns {string|null} Kanonischer Text, 'NaN' oder null, wenn der bisherige Weg gilt.
 */
function canonicalGroupedMoney(text) {
    const grouped = GROUPED.exec(text);
    if (grouped) return `${grouped[1]}${grouped[2].replaceAll('.', '')}${grouped[3] ? `.${grouped[3]}` : ''}`;
    const dots = (text.match(/\./g) || []).length;
    return dots > 1 || dots === 1 && text.includes(',') ? 'NaN' : null;
}

/** @param {unknown} raw
 * @param {HTMLInputElement|HTMLSelectElement|null} [field]
 * @returns {string} */
export function canonicalDecimalInput(raw, field = null) {
    const text = String(raw ?? '').trim();
    const display = field && displays.get(field);
    if (display?.text === text) return display.canonical;
    if (!text) return '';
    if (isMoneyInput(field) && !PRICE_INPUTS.has(field.id)) {
        const grouped = canonicalGroupedMoney(text);
        // VN-4: Eine Cent-Anzeige („10.120,00“ nach dem Verlassen) ist derselbe Wert wie „10120“, keine neue Eingabe.
        if (grouped !== null) return withoutTrailingZeros(grouped);
    }
    // VK-3b (Gutachten VK3 Befund 5, Fable P3-5): Kursfelder lesen Tausenderpunkt mit Dezimalkomma wie die Betragsfelder („1.234,57“);
    // ein Punkt ohne Komma bleibt dort Dezimalpunkt (UR-2b).
    if (PRICE_INPUTS.has(/** @type {any} */ (field)?.id) && text.includes(',') && GROUPED.test(text)) return /** @type {string} */ (canonicalGroupedMoney(text));
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) return 'NaN';
    const canonical = text.replace(',', '.');
    return Number.isFinite(Number(canonical)) ? isMoneyInput(field) && !PRICE_INPUTS.has(/** @type {any} */ (field)?.id) ? withoutTrailingZeros(canonical) : canonical : 'NaN';
}

/** Eurobetrag wie die Betragsfelder der App (UR-2b, `canonicalGroupedMoney`), ohne Feldbindung; leer oder ungültig ergibt NaN.
 * Genutzt vom geführten Verkauf (Gebühren, Steuern, Gutschrift, Tagesgeld). @param {unknown} raw @returns {number} */
export function readMoneyText(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return Number.NaN;
    const grouped = canonicalGroupedMoney(text);
    return grouped === null ? readDecimalInput(text) : Number(grouped);
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
    if ((isMoneyInput(field) || field?.id === 'shares') && !editing && canonical !== '' && canonical !== 'NaN') {
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
        // VN-3 (Fable P3-1): Felder der geführten Abläufe formatiert der Dialog selbst (Stück „1.000“ bliebe sonst „1,000“).
        if (!isEditableDecimalInput(field) || field.hasAttribute?.('data-manager-plan-field') || field.closest?.('.sale-flow-dialog')) return;
        // Stück wie readMoneyText lesen, aber als Text formatieren: keine Rundung langer Bruchstücke.
        const canonical = field.id === 'shares'
            ? canonicalGroupedMoney(field.value.trim()) ?? canonicalDecimalInput(field.value)
            : canonicalDecimalInput(field.value, field);
        if (canonical === '' || canonical === 'NaN') return;
        field.value = displayDecimalInput(canonical, field);
    });
}
