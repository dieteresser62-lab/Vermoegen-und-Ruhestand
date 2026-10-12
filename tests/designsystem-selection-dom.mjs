import fs from 'node:fs';

// Kleines optionenbasiertes DOM: keine Observerzustellung, keine Setterevents.
class Element {
    constructor(doc, tag) {
        this.ownerDocument = doc;
        this.tagName = tag.toUpperCase();
        this.nodeType = 1;
        this.hidden = false;
        this.clientWidth = 180;
        this.className = '';
        this.classList = { contains: name => this.className.split(/\s+/).includes(name) };
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.listeners = {};
        this.dataset = {};
        this.style = {};
        this.id = '';
        this.textContent = '';
        this.checked = false;
        this.disabled = false;
        this.type = '';
        if (tag !== 'select') this.value = '';
    }
    get isConnected() {
        for (let node = this; node; node = node.parentNode) if (node === this.ownerDocument.body) return true;
        return false;
    }
    getClientRects() {
        for (let node = this; node; node = node.parentNode) if (node.hidden) return [];
        return this.clientWidth ? [{}] : [];
    }
    matches(selector) { return selector.split(/,\s*/).some(tag => tag.toUpperCase() === this.tagName); }
    querySelector(selector) { return this.querySelectorAll('*').find(node => node.matches(selector)) || null; }
    get parentElement() { return this.parentNode; }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
    get innerHTML() { return this._html || ''; }
    set innerHTML(value) { this.replaceChildren(); this._html = value; }
    appendChild(node) { return this.insertBefore(node, null); }
    insertBefore(node, next) {
        node.remove();
        const index = next ? this.children.indexOf(next) : this.children.length;
        this.children.splice(index, 0, node);
        node.parentNode = this;
        return node;
    }
    remove() {
        if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
        this.parentNode = null;
    }
    replaceChildren() { for (const node of [...this.children]) node.remove(); }
    insertAdjacentElement(position, node) { this.parentNode.insertBefore(node, this.nextSibling); }
    setAttribute(key, value) {
        this.attributes.set(key, String(value));
        if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    hasAttribute(key) { return this.attributes.has(key); }
    removeAttribute(key) { this.attributes.delete(key); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
    dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn({ target: this, ...event }); }
    closest(selector) {
        if (selector === '.form-group') return this.parentNode;
        for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node;
        return null;
    }
    querySelectorAll(selector) {
        const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        if (selector === '*') return all;
        if (selector === 'select[id]') return all.filter(n => n.tagName === 'SELECT' && n.id);
        return [];
    }
    // Reset schreibt unmittelbar Optionszustände, niemals Select-Setter.
    reset() {
        let cancelled = false;
        for (let node = this; node; node = node.parentNode) node.dispatchEvent({ type: 'reset', target: this, preventDefault() { cancelled = true; } });
        if (cancelled) return;
        for (const node of this.querySelectorAll('*')) {
            if (node.tagName === 'SELECT') {
                node.options.forEach(option => { option._selected = option.defaultSelected; });
                if (!node.selectedOptions.length && node.options.length) node.options[0]._selected = true;
            }
        }
    }
}

class Option extends Element {
    constructor(doc) { super(doc, 'option'); this._selected = false; this.defaultSelected = false; }
    get selected() { return this._selected; }
    set selected(value) {
        if (value && this.parentNode?.tagName === 'SELECT') this.parentNode.options.forEach(o => { o._selected = false; });
        this._selected = Boolean(value);
    }
}

export class SelectionSelect extends Element {
    constructor(doc) { super(doc, 'select'); }
    get options() { return this.children; }
    get selectedOptions() { return this.options.filter(o => o.selected); }
    get value() { return this.selectedOptions[0]?.value || ''; }
    set value(value) {
        const index = this.options.findIndex(o => o.value === String(value));
        this.options.forEach((o, i) => { o._selected = i === index; });
    }
    get selectedIndex() { return this.options.findIndex(o => o.selected); }
    set selectedIndex(index) {
        const integer = Number(index) >> 0;
        this.options.forEach((o, i) => { o._selected = i === integer; });
    }
    appendChild(option) {
        const selected = option.selected;
        super.appendChild(option);
        if (selected) this.options.forEach(o => { o._selected = o === option; });
        else if (this.options.length === 1) option._selected = true;
        return option;
    }
}

export function createSelectionDocument() {
    const doc = {
        createElement(tag) { return tag === 'select' ? new SelectionSelect(doc) : tag === 'option' ? new Option(doc) : new Element(doc, tag); },
        getElementById(id) { return doc.body.querySelectorAll('*').find(n => n.id === id) || null; },
        querySelectorAll(selector) { return doc.body.querySelectorAll(selector); }
    };
    doc.body = doc.createElement('body');
    installSelectionMeasurements(doc);
    return doc;
}

// Steuerbare Messungen: keine erfundene Geometrie für alte, unmessbare Mocks.
export function installSelectionMeasurements(doc) {
    const mutations = [], resizes = [], fontListeners = [], windowListeners = [], frames = [];
    const mediaListeners = [];
    doc.defaultView = {
        requestAnimationFrame(fn) { frames.push(fn); },
        matchMedia() { return { addEventListener(type, fn) { mediaListeners.push(fn); } }; },
        getComputedStyle: field => ({ font: `${field.fontSize || 16}px Testschrift`, fontSize: `${field.fontSize || 16}px`,
            paddingLeft: '10px', paddingRight: '10px', letterSpacing: '0px', appearance: 'auto', ...field.computedStyle }),
        MutationObserver: class {
            constructor(fn) { this.fn = fn; mutations.push(this); }
            observe(root, options) { this.root = root; this.options = options; }
            disconnect() { this.root = null; }
        },
        ResizeObserver: class {
            constructor(fn) { this.fn = fn; this.targets = new Set(); resizes.push(this); }
            observe(node) { this.targets.add(node); }
            unobserve(node) { this.targets.delete(node); }
        },
        addEventListener(type, fn) { windowListeners.push({ type, fn }); }
    };
    doc.fonts = { addEventListener(type, fn) { fontListeners.push(fn); } };
    const create = doc.createElement.bind(doc);
    doc.createElement = tag => {
        const node = create(tag);
        if (tag === 'canvas') node.getContext = () => ({ font: '', measureText(text) {
            return { width: text.length * (Number.parseFloat(this.font) || 16) / 2 };
        } });
        return node;
    };
    doc.measurements = {
        mutations, resizes, fontListeners, windowListeners, frames, mediaListeners,
        windowEvent(type) { windowListeners.filter(entry => entry.type === type).forEach(entry => entry.fn()); },
        mediaChange(matches) { mediaListeners.forEach(fn => fn({ matches })); },
        paint() { const pending = frames.splice(0); pending.forEach(fn => fn()); },
        mutation(records) { mutations.forEach(observer => { if (observer.root) observer.fn(records); }); },
        resize(node) { resizes.forEach(observer => { if (observer.targets.has(node)) observer.fn([{ target: node }]); }); },
        fontsLoaded() { fontListeners.forEach(fn => fn()); }
    };
}

export function addField(doc, id, value = '', options = null, parent = null) {
    const container = parent || doc.body.appendChild(doc.createElement('div'));
    const field = container.appendChild(doc.createElement(options ? 'select' : 'input'));
    field.id = id;
    for (const [optionValue, text] of options || []) {
        const option = doc.createElement('option'); option.value = String(optionValue); option.textContent = text;
        field.appendChild(option);
    }
    field.value = value;
    return field;
}

export function source(path) { return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'); }

// Tatsächliche Funktionskörper ohne Modulinitialisierung; Abhängigkeiten explizit injizieren.
export function functionSource(path, name) {
    const text = source(path);
    const start = text.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`Produktfunktion fehlt: ${name}`);
    const tail = text.slice(start);
    const next = tail.slice(1).search(/\n(?:export )?(?:async )?function /);
    return next < 0 ? tail : tail.slice(0, next + 1);
}

export function simulatorSelectOptions(id) {
    const html = source('Simulator.html');
    const select = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].find(m => m[1].includes(`id="${id}"`));
    if (!select) throw new Error(`Select fehlt: ${id}`);
    return [...select[2].matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)]
        .map(m => [m[1], m[2].trim()]);
}

export async function selectionVariant(mode) {
    const original = source('app/shared/designsystem-selection-text.js');
    const marker = 'syncSelectionText(this);';
    if (!original.includes(marker)) throw new Error('Settergegenprobe trifft Quelle nicht');
    const changed = mode === 'value-off' ? original.replace(marker, "if (property !== 'value') syncSelectionText(this);")
        : mode === 'index-off' ? original.replace(marker, "if (property !== 'selectedIndex') syncSelectionText(this);") : original;
    return import(`data:text/javascript;base64,${Buffer.from(changed).toString('base64')}`);
}
