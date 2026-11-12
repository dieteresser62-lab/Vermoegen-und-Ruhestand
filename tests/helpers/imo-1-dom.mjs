// Kleiner HTML-Nachbau für IMO-1: Parser, Selektoren, Ereignisse mit Bubbling, Fokus und Cursor.
// Nur was Renderer, Editor und Seitenkacheln benutzen.
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'path', 'circle', 'rect', 'col']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#039': "'", '#39': "'", nbsp: '\u00a0' };
const decode = text => text.replace(/&(amp|lt|gt|quot|#039|#39|nbsp);/g, (_, name) => ENTITIES[name]);
const dataAttr = key => 'data-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
export class FakeEvent {
    constructor(type, init = {}) { Object.assign(this, { bubbles: true, ...init, type }); this.defaultPrevented = false; }
    preventDefault() { this.defaultPrevented = true; }
}
function splitTop(text, separator) {
    const parts = []; let depth = 0, quote = '', current = '';
    for (const char of text) {
        if (quote) { if (char === quote) quote = ''; current += char; continue; }
        if (char === '"' || char === "'") quote = char;
        if ('([' .includes(char)) depth++;
        if (')]'.includes(char)) depth--;
        if (char === separator && !depth) { parts.push(current); current = ''; } else current += char;
    }
    return [...parts, current].map(part => part.trim()).filter(Boolean);
}
function matchCompound(el, compound) {
    const pattern = /^(?:[\w-]+|\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:(\^?=)"([^"]*)")?\]|:is\(([^)]*)\)/g;
    let consumed = 0;
    for (const [token, id, cls, attr, op, value, inner] of compound.matchAll(pattern)) {
        consumed += token.length;
        if (id !== undefined && el.id !== id) return false;
        if (cls !== undefined && !el.className.split(/\s+/).includes(cls)) return false;
        if (attr !== undefined) {
            const actual = el.getAttribute(attr);
            if (actual === null || (op === '=' && actual !== value) || (op === '^=' && !actual.startsWith(value))) return false;
        }
        if (inner !== undefined && !matchesSelector(el, inner)) return false;
        if (!id && !cls && !attr && !inner && token !== '*' && el.localName !== token) return false;
    }
    if (consumed !== compound.length) throw new Error('Selektor nicht unterstützt: ' + compound);
    return true;
}
function matchesSelector(el, selector) {
    return splitTop(selector, ',').some(complex => {
        const parts = splitTop(complex, ' ');
        if (!matchCompound(el, parts.at(-1))) return false;
        let index = parts.length - 2;
        for (let node = el.parentElement; node && index >= 0; node = node.parentElement) if (matchCompound(node, parts[index])) index--;
        return index < 0;
    });
}
class FakeElement {
    constructor(doc, tag, attrs = {}) {
        Object.assign(this, { ownerDocument: doc, localName: tag, tagName: tag.toUpperCase(), childNodes: [], parentNode: null, listeners: {}, style: {} });
        this.attrs = new Map(Object.entries(attrs));
        if (tag === 'input') this.rawValue = this.attrs.get('value') ?? '';
        this.dataset = new Proxy({}, {
            get: (_, key) => typeof key === 'string' ? this.attrs.get(dataAttr(key)) : undefined,
            set: (_, key, value) => { this.attrs.set(dataAttr(String(key)), String(value)); return true; },
            has: (_, key) => this.attrs.has(dataAttr(String(key))),
            deleteProperty: (_, key) => this.attrs.delete(dataAttr(String(key)))
        });
    }
    get value() { return this.rawValue ?? ''; }
    set value(text) { this.rawValue = String(text); this.selection = null; }
    get id() { return this.attrs.get('id') ?? ''; }
    get type() { return this.attrs.get('type') ?? (this.localName === 'input' ? 'text' : ''); }
    get readOnly() { return this.attrs.has('readonly'); }
    get className() { return this.attrs.get('class') ?? ''; }
    get classList() { return { contains: name => this.className.split(/\s+/).includes(name) }; }
    get children() { return this.childNodes.filter(child => child instanceof FakeElement); }
    get parentElement() { return this.parentNode instanceof FakeElement ? this.parentNode : null; }
    get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
    get textContent() { return this.childNodes.map(child => child instanceof FakeElement ? child.textContent : child.text ?? '').join(''); }
    set textContent(value) { this.childNodes = [{ text: String(value) }]; }
    set innerHTML(html) { this.childNodes = []; parseInto(this, html); }
    get innerHTML() { return this.childNodes.map(child => child instanceof FakeElement ? child.outerHTML : child.text ?? '').join(''); }
    get outerHTML() { return `<${this.localName}${[...this.attrs].map(([key, value]) => ` ${key}="${value}"`).join('')}>${this.innerHTML}</${this.localName}>`; }
    flag(name, on) { if (on) this.attrs.set(name, ''); else this.attrs.delete(name); }
    get hidden() { return this.attrs.has('hidden'); } set hidden(on) { this.flag('hidden', on); }
    get disabled() { return this.attrs.has('disabled'); } set disabled(on) { this.flag('disabled', on); }
    get open() { return this.attrs.has('open'); } set open(on) { this.flag('open', on); }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    hasAttribute(name) { return this.attrs.has(name); }
    removeAttribute(name) { this.attrs.delete(name); }
    appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; }
    contains(node) { for (let el = node; el; el = el.parentNode) if (el === this) return true; return false; }
    matches(selector) { return matchesSelector(this, selector); }
    closest(selector) { for (let el = this; el; el = el.parentElement) if (el.matches(selector)) return el; return null; }
    querySelectorAll(selector) { const walk = el => el.children.flatMap(child => [child, ...walk(child)]); return walk(this).filter(el => el.matches(selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    removeEventListener(type, handler) { this.listeners[type] = (this.listeners[type] || []).filter(fn => fn !== handler); }
    dispatchEvent(event) {
        event.target ||= this;
        for (let el = this; el; el = event.bubbles ? el.parentElement : null) (el.listeners[event.type] || []).forEach(fn => fn(event));
        if (event.bubbles) (this.ownerDocument.listeners[event.type] || []).forEach(fn => fn(event));
        return !event.defaultPrevented;
    }
    click() { this.focus(); this.dispatchEvent(new FakeEvent('click')); }
    focus() {
        const doc = this.ownerDocument, previous = doc.activeElement;
        if (!this.isConnected || previous === this) return;
        doc.activeElement = this;
        if (previous?.isConnected && previous !== doc.body) previous.dispatchEvent(new FakeEvent('focusout', { relatedTarget: this }));
        this.dispatchEvent(new FakeEvent('focusin'));
    }
    get selectionStart() { return this.localName === 'input' ? this.selection?.[0] ?? this.value.length : undefined; }
    get selectionEnd() { return this.localName === 'input' ? this.selection?.[1] ?? this.value.length : undefined; }
    setSelectionRange(start, end) { this.selection = [start, end]; }
    select() { this.selection = [0, this.value.length]; }
    scrollIntoView() { this.ownerDocument.scrolled = this; }
}
function parseInto(parent, html) {
    const stack = [parent];
    const pattern = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
    for (const [, close, tag, rawAttrs, selfClosing, text] of html.matchAll(pattern)) {
        if (close) { const index = stack.findLastIndex(el => el.localName === close.toLowerCase()); if (index > 0) stack.length = index; continue; }
        if (text !== undefined) { stack.at(-1).appendChild({ text: decode(text) }); continue; }
        if (!tag) continue;
        const attrs = Object.fromEntries([...(rawAttrs || '').matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
            .map(([, name, a, b, c]) => [name.toLowerCase(), decode(a ?? b ?? c ?? '')]));
        const el = stack.at(-1).appendChild(new FakeElement(parent.ownerDocument, tag.toLowerCase(), attrs));
        if (!selfClosing && !VOID.has(el.localName)) stack.push(el);
    }
}
export function createDocument(html) {
    const doc = { listeners: {}, defaultView: { Event: FakeEvent }, activeElement: null };
    doc.body = new FakeElement(doc, 'body'); doc.body.innerHTML = html; doc.activeElement = doc.body;
    doc.getElementById = id => doc.body.querySelectorAll('[id]').find(el => el.id === id) || null;
    doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
    doc.querySelector = selector => doc.body.querySelector(selector);
    doc.addEventListener = (type, handler) => (doc.listeners[type] ||= []).push(handler);
    doc.removeEventListener = () => {};
    return doc;
}
export const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
export const cells = row => row.children.map(cell => cell.textContent.replaceAll('\u00a0', ' ').trim());

