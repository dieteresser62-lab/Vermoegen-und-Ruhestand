import fs from 'node:fs';
import { createDesignsystemIcon } from '../app/shared/designsystem-icons.js';
const svgSource = fs.readFileSync(new URL('../assets/icons/lucide/book-open.svg', import.meta.url), 'utf8');
const SVG_NS = 'http://www.w3.org/2000/svg';
// DOM-Grenzadapter für Node; den echten DOMParser und importNode prüft der Browserfall.
function element(name, attributes) {
    return {
        localName: name, namespaceURI: SVG_NS, attributes,
        setAttribute(name, value) {
            const attribute = this.attributes.find(a => a.name === name);
            if (attribute) attribute.value = value;
            else this.attributes.push({ name, value });
        },
        getAttribute(name) { return this.attributes.find(a => a.name === name)?.value; },
        querySelectorAll() { return this.children || []; }
    };
}
class ParserAdapter {
    parseFromString(source, mime) {
        assertEqual(mime, 'image/svg+xml', 'Parser verwendet XML statt HTML');
        const nodes = [...source.matchAll(/<([\w-]+)\b([^<>]*)>/g)].map(match => element(match[1], [...match[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map(a => ({ name: a[1], value: a[2] }))));
        const root = nodes[0] || element('parsererror', []);
        root.children = nodes.slice(1);
        return { documentElement: root, querySelector: () => root.localName === 'parsererror' ? root : null };
    }
}
function documentAdapter(baseURI = new URL('../index.html', import.meta.url).href) {
    return {
        baseURI, defaultView: { DOMParser: ParserAdapter },
        importNode(root, deep) {
            assertEqual(deep, true, 'SVG-Unterbaum wird mit übernommen');
            const result = element(root.localName, root.attributes.map(a => ({ ...a })));
            result.ownerDocument = this;
            result.children = root.children.map(child => ({ ...child, ownerDocument: this }));
            return result;
        }
    };
}
const response = (source = svgSource, options = {}) => ({ ok: true, text: async () => source, ...options });
async function fails(operation, label) {
    let failed = false;
    try { await operation(); } catch { failed = true; }
    assert(failed, label);
}
for (const doc of [documentAdapter(), documentAdapter(new URL('../Handbuch.html', import.meta.url).href)]) {
    let request;
    const icon = await createDesignsystemIcon('book-open', doc, { fetch: async (url, options) => {
        request = { url, options };
        return response();
    } });
    assertEqual(request.url, new URL('../assets/icons/lucide/book-open.svg', import.meta.url).href, 'Quelle relativ zum Modul, unabhängig von der Seite');
    assertEqual(request.options.mode, 'same-origin', 'Fetch erlaubt nur eigenen Ursprung');
    assertEqual(request.options.redirect, 'error', 'Keine Symbolweiterleitung');
    assert(icon.ownerDocument === doc && icon.children.every(child => child.ownerDocument === doc), 'SVG gehört vollständig zum Aufruferdokument');
    assertEqual(icon.getAttribute('stroke'), 'currentColor', 'Symbol erbt Textfarbe');
    assertEqual(icon.getAttribute('width'), '20', 'Feste Symbolbreite');
    assertEqual(icon.getAttribute('height'), '20', 'Feste Symbolhöhe');
    assertEqual(icon.getAttribute('aria-hidden'), 'true', 'Schmucksymbol ist verborgen für Screenreader');
    assertEqual(icon.getAttribute('focusable'), 'false', 'Kein zusätzlicher Fokuspunkt');
}
for (const name of ['../book-open', 'https://example.org/icon.svg', 'data:image/svg+xml,<svg/>', 'nonexistent']) {
    await fails(() => createDesignsystemIcon(name, documentAdapter(), { fetch: () => { throw new Error('Darf nicht laden'); } }), `Namensfreigabe verwirft ${name}`);
}
for (const name of ['circle-help', 'check', 'triangle-alert']) {
    const source = fs.readFileSync(new URL(`../assets/icons/lucide/${name}.svg`, import.meta.url), 'utf8');
    const icon = await createDesignsystemIcon(name, documentAdapter(), { fetch: async () => response(source) });
    assertEqual(icon.getAttribute('data-designsystem-icon'), name, `Freigegebenes lokales Symbol ${name}`);
}
await fails(() => createDesignsystemIcon('book-open', documentAdapter('https://example.org/index.html')), 'Fremder Dokumentursprung wird abgewiesen');
await fails(() => createDesignsystemIcon('book-open', documentAdapter(), { fetch: async () => response(svgSource, { url: 'https://example.org/icon.svg' }) }), 'Fremde Antwortquelle wird abgewiesen');
await fails(() => createDesignsystemIcon('book-open', documentAdapter(), { fetch: async () => response(svgSource, { ok: false }) }), 'Lokaler HTTP-Ladefehler');
await fails(() => createDesignsystemIcon('book-open', documentAdapter(), { fetch: async () => { throw new Error('offline'); } }), 'Netzwerkfehler wird dem Aufrufer übergeben');
for (const [source, label] of [
    ['kein SVG', 'Parserfehler'],
    [svgSource.replace('<path ', '<script '), 'Ausführbares SVG-Element'],
    [svgSource.replace('width="24"', 'onload="alert(1)"'), 'Ereignisattribute'],
    [svgSource.replace('stroke="currentColor"', 'stroke="#fff"'), 'Feste Fremdfarbe'],
    [svgSource.replace('stroke="currentColor"', 'stroke="url(https://example.org/pattern)"'), 'Fremde Paintquelle'],
    [svgSource.replace('<path ', '<image href="https://example.org/picture.svg" '), 'Fremdes Bild'],
    ['<!DOCTYPE svg>' + svgSource, 'DOCTYPE'],
    ['<!ENTITY example "remote">' + svgSource, 'XML-Entität']
]) await fails(() => createDesignsystemIcon('book-open', documentAdapter(), { fetch: async () => response(source) }), label);
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const frame = fs.readFileSync(new URL('../app/shared/suite-frame.js', import.meta.url), 'utf8');
function handbookIconErrors(html, loader) {
    const errors = [];
    if (!html.includes('src="app/shared/suite-frame.js"')) errors.push('Rahmenbindung');
    const link = html.match(/<a\b[^>]*href="Handbuch.html"[^>]*>([\s\S]*?)<\/a>/)?.[1] || '';
    if (!link.includes('data-suite-icon="book-open" aria-hidden="true"')) errors.push('Symbolhost');
    if (!link.includes('<span>Handbuch</span>')) errors.push('Linktext');
    if (!loader.includes('createDesignsystemIcon(host.dataset.suiteIcon, doc)')
        || !loader.includes('.then(icon => host.replaceChildren(icon))')) errors.push('SVG-Bindung');
    if (!loader.includes('.catch(() => {});')) errors.push('Ladefehler');
    if (/\p{Extended_Pictographic}/u.test(html)) errors.push('Emoji');
    return errors;
}
assertEqual(handbookIconErrors(index, frame).join(','), '', 'Übersicht lädt das lokale Handbuchsymbol im Rahmen und erhält seinen Linktext bei Ladefehlern');
for (const [html, loader, expected] of [
    [index.replace('src="app/shared/suite-frame.js"', ''), frame, 'Rahmenbindung'],
    [index.replace('data-suite-icon="book-open"', ''), frame, 'Symbolhost'],
    [index.replace('<span>Handbuch</span>', ''), frame, 'Linktext'],
    [index, frame.replace('host.replaceChildren(icon)', ''), 'SVG-Bindung'],
    [index, frame.replace('.catch(() => {});', ''), 'Ladefehler'],
    [index.replace('<span>Handbuch</span>', '<span>📖 Handbuch</span>'), frame, 'Emoji']
]) assert(handbookIconErrors(html, loader).includes(expected), `Gegenprobe erkennt ${expected}`);

for (const name of ['house', 'scale', 'chart-no-axes-combined', 'wallet', 'landmark', 'panel-left-close', 'panel-left']) {
    const source = fs.readFileSync(new URL(`../assets/icons/lucide/${name}.svg`, import.meta.url), 'utf8');
    const icon = await createDesignsystemIcon(name, documentAdapter(), { fetch: async () => response(source) });
    assertEqual(icon.getAttribute('data-designsystem-icon'), name, 'Rahmensymbol kommt aus der freigegebenen lokalen Quelle');
    assertEqual(icon.getAttribute('aria-hidden'), 'true', 'Rahmensymbol bleibt dekorativ');
}
