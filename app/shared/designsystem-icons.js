/** Lokale Lucide-Schmucksymbole, im Dokument des Aufrufers erzeugt. */
const ICON_NAMES = new Set(['book-open', 'circle-help', 'check', 'triangle-alert',
    'house', 'scale', 'chart-no-axes-combined', 'wallet', 'landmark', 'panel-left-close', 'panel-left']);
const SVG_NS = 'http://www.w3.org/2000/svg';
// Lokales Lucide-copy (ISC): synchron für dynamische Buttons und HTML-Renderer.
// Nur konstantes Markup; weder Nutzerdaten noch ein asynchroner Symbolfetch.
export const EXAMPLE_EXPENSES_ICON_HTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-designsystem-icon="copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';

export function appendExampleExpensesIcon(button, doc) {
    const icon = doc.createElement('span');
    icon.innerHTML = EXAMPLE_EXPENSES_ICON_HTML;
    button.appendChild(icon);
}

export function exampleExpensesLabel(model, personName) {
    const year = model.expenses?.year ?? model.occasion?.previousYear;
    const month = model.expenses?.month ?? model.occasion?.previousMonth;
    const date = Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12
        ? new Date(year, month - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : 'Abschlussmonat';
    return `Beispielausgaben einspielen · ${date} · ${personName || 'alle Personen'}`;
}
const ELEMENTS = new Set(['svg', 'path', 'circle', 'line', 'polyline', 'polygon', 'rect', 'ellipse', 'g']);
const ATTRIBUTES = new Set([
    'class', 'xmlns', 'width', 'height', 'viewBox', 'fill', 'stroke',
    'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'cx', 'cy',
    'r', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'rx', 'ry', 'points'
]);

export async function createDesignsystemIcon(name, document, { fetch: load = globalThis.fetch } = {}) {
    if (!ICON_NAMES.has(name)) throw new TypeError('Unbekanntes lokales Symbol');
    const url = new URL(`../../assets/icons/lucide/${name}.svg`, import.meta.url);
    if (url.origin !== new URL(document.baseURI).origin) throw new TypeError('Fremde Symbolquelle');
    const response = await load(url.href, { mode: 'same-origin', redirect: 'error' });
    if (!response.ok) throw new Error('Lokales Symbol konnte nicht geladen werden');
    if (response.url && new URL(response.url).href !== url.href) throw new TypeError('Fremde Symbolantwort');
    const source = await response.text();
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new TypeError('Ungültiges Symbolformat');
    const parsed = new document.defaultView.DOMParser().parseFromString(source, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root.localName !== 'svg' || parsed.querySelector('parsererror')) throw new TypeError('Ungültiges SVG');
    for (const element of [root, ...root.querySelectorAll('*')]) {
        if (element.namespaceURI !== SVG_NS || !ELEMENTS.has(element.localName)) throw new TypeError('Ungültiges SVG-Element');
        for (const attribute of element.attributes) {
            if (attribute.name === 'xmlns' && attribute.value === SVG_NS) continue;
            if (!ATTRIBUTES.has(attribute.name) || /url\s*\(|https?:|data:|javascript:/i.test(attribute.value)) {
                throw new TypeError('Ungültiges SVG-Attribut');
            }
            if (['stroke', 'fill'].includes(attribute.name) && !['none', 'currentColor'].includes(attribute.value)) {
                throw new TypeError('Symbolfarbe muss currentColor verwenden');
            }
        }
    }
    const icon = document.importNode(root, true);
    icon.setAttribute('width', '20');
    icon.setAttribute('height', '20');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.setAttribute('data-designsystem-icon', name);
    return icon;
}
