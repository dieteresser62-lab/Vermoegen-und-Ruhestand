import fs from 'node:fs';

const htmlContent = fs.readFileSync(new URL('../../Balance.html', import.meta.url), 'utf8');

// Gemeinsame Browsermechanik; keine Fachlogik und keine Assertions beim Import.
export class MockElement {
    constructor(id, tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.value = '';
        this.textContent = '';
        this.checked = false;
        this.style = { display: '' };
        this.dataset = {};
        this.classList = {
            _classes: new Set(),
            add: (...classes) => classes.forEach(c => this.classList._classes.add(c)),
            remove: (...classes) => classes.forEach(c => this.classList._classes.delete(c)),
            contains: (c) => this.classList._classes.has(c),
            toggle: (c, force) => { const active = force ?? !this.classList._classes.has(c); active ? this.classList._classes.add(c) : this.classList._classes.delete(c); return active; }
        };
        this.listeners = {};
        this.children = [];
        this.attributes = {};
    }

    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }

    setAttribute(name, value) {
        this.attributes[name] = value;
        if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
        if (name === 'class') {
            // rudimentary sync not strictly needed if valid classList usage
        }
    }

    getAttribute(name) {
        if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
        return this.attributes[name] || null;
    }

    hasAttribute(name) {
        if (name.startsWith('data-')) return this.getAttribute(name) !== null;
        return Object.hasOwn(this.attributes, name);
    }

    removeAttribute(name) {
        delete this.attributes[name];
        if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    }

    addEventListener(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    removeEventListener(event, callback) {
        this.listeners[event] = (this.listeners[event] || []).filter(fn => fn !== callback);
    }

    dispatchEvent(event) {
        event.target ||= this;
        event.currentTarget = this;
        if (this.listeners[event.type]) {
            this.listeners[event.type].forEach(cb => {
                try {
                    cb(event);
                } catch (e) {
                    throw e;
                }
            });
        }
    }

    focus() { document.activeElement = this; }

    get parentElement() { return this.parentNode; }
    get isConnected() { return this === this.ownerDocument?.body || Boolean(this.parentNode?.isConnected); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
    matches(selector) {
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        if (selector.startsWith('.')) return (this.className || '').split(' ').includes(selector.slice(1));
        const match = selector.match(/^(\w+)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/);
        return Boolean(match && (!match[1] || this.tagName.toLowerCase() === match[1])
            && (!match[2] || this.hasAttribute(match[2]) && (match[3] === undefined || this.getAttribute(match[2]) === match[3])));
    }
    showModal() { this.open = true; }
    close() { this.open = false; void this.fire('close'); }
    click() { if (!this.disabled) void this.fire('click'); }
    fire(type, fields = {}) {
        const event = { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...fields };
        return Promise.all((this.listeners[type] || []).map(handler => handler(event)));
    }

    querySelector(selector) { return new MockElement('dummy-child'); }
    querySelectorAll(selector) { return []; }

    // Child manipulation
    get nextSibling() {
        return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null;
    }

    insertBefore(child, next) {
        child.remove();
        const index = next ? this.children.indexOf(next) : this.children.length;
        if (index < 0) throw new Error('Unbekannter Nachbarknoten im DOM-Doppel');
        child.parentNode = this;
        this.children.splice(index, 0, child);
        return child;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
    }

    append(...children) {
        children.forEach(c => {
            if (c instanceof MockElement) c.parentNode = this;
        });
        this.children.push(...children);
    }

    replaceChildren(...children) {
        this.textContent = '';
        this.children = [];
        this.append(...children);
    }

    remove() {
        if (this.parentNode) {
            this.parentNode.children = this.parentNode.children.filter(c => c !== this);
            this.parentNode = null;
        }
    }
}

export class MockDocument {
    constructor() {
        this.elements = {};
        this.listeners = {};
        this.htmlIds = new Set([...htmlContent.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
        this.htmlIds.add('importFile'); // Synthetischer Legacyhandler-Test; Produktverweis führt zur Sicherungsseite.
        this.htmlIds.add('snapshotList'); // Synthetischer Servicehost.
        this.htmlIds.add('balanceInputs'); // Bestehender Delegationshost des Doppels.
        this.htmlIds.add('p1StartAlter'); // Bestehendes synthetisches Feld für den Inputevent.
        this.body = this.createElement('body');
        this.engineScript = this.createElement('script');
        this.engineScript.id = 'engine-script';
        this.engineScript.src = 'engine.js';
    }

    createElement(tagName) {
        const el = new MockElement('', tagName);
        el.ownerDocument = this;
        return el;
    }

    createElementNS(namespaceURI, tagName) {
        const el = this.createElement(tagName);
        el.namespaceURI = namespaceURI;
        return el;
    }

    createDocumentFragment() {
        return this.createElement('FRAGMENT');
    }

    createTextNode(text) {
        const el = this.createElement('TEXT_NODE');
        el.textContent = text;
        return el;
    }

    getElementById(id) {
        const find = node => node.id === id ? node : node.children.map(find).find(Boolean);
        const attached = find(this.body);
        if (attached) return attached;
        // Dynamische Hinweise werden im Baum gefunden; unbekannte IDs bleiben null.
        if (!this.htmlIds.has(id)) return null;
        if (!this.elements[id]) {
            this.elements[id] = this.createElement('div');
            this.elements[id].id = id;
            this.body.appendChild(this.elements[id]);
        }
        return this.elements[id];
    }

    querySelector(selector) {
        if (selector === '.form-column') {
            return this.getElementById('balanceInputs');
        }
        if (selector === 'script[src^="engine.js"]') {
            return this.engineScript;
        }
        // Return a dummy element
        return new MockElement('dummy-query');
    }

    querySelectorAll(selector) {
        if (selector === 'input, select') {
            // Auto-discover IDs from HTML content to populate dom.inputs
            const inputs = [];
            // Use [\s\S] to match across newlines inside the tag
            const regex = /<(?:input|select)[\s\S]+?id=["']([^"']+)["']/gi;
            let match;
            while ((match = regex.exec(htmlContent)) !== null) {
                const id = match[1];
                const lowerMatch = match[0].toLowerCase();
                const type = lowerMatch.includes('type="file"') ? 'file' : lowerMatch.includes('type="checkbox"') || lowerMatch.includes("type='checkbox'") ? 'checkbox' : 'text';
                const el = this.getElementById(id);
                el.type = type; // Set type hint
                inputs.push(el);
            }
            return inputs;
        }
        return [];
    }

    addEventListener(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    removeEventListener(event, callback) {
        this.listeners[event] = (this.listeners[event] || []).filter(fn => fn !== callback);
    }

    dispatchEvent(event) {
        if (this.listeners[event.type]) {
            this.listeners[event.type].forEach(cb => cb(event));
        }
    }
}

export class MockEvent {
    constructor(type) {
        this.type = type;
        this.target = null; // Will be set on dispatch
    }
}

/** Installation und vollständiger Rückbau der flüchtigen Browserumgebung. */
export function createBalancePageFixture({ storage, url }) {
    const keys = ['document', 'window', 'localStorage', 'sessionStorage', 'Event', 'confirm',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
    const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const native = { setTimeout, clearTimeout, setInterval, clearInterval };
    const timeouts = new Set(), intervals = new Set(), listeners = new Map();
    const doc = new MockDocument();
    const session = new Map();
    const win = { location: new URL(url), localStorage: storage,
        addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
        removeEventListener(type, handler) { listeners.get(type)?.delete(handler); }
    };
    doc.defaultView = win;
    Object.assign(globalThis, { document: doc, window: win, localStorage: storage, Event: MockEvent, confirm: () => true,
        sessionStorage: { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, String(value)), removeItem: key => session.delete(key) },
        setTimeout(fn, delay, ...args) {
            const id = native.setTimeout(() => { timeouts.delete(id); fn(...args); }, delay);
            timeouts.add(id); return id;
        },
        clearTimeout(id) { timeouts.delete(id); native.clearTimeout(id); },
        setInterval(fn, delay, ...args) { const id = native.setInterval(fn, delay, ...args); intervals.add(id); return id; },
        clearInterval(id) { intervals.delete(id); native.clearInterval(id); }
    });
    return { doc, win, restore() {
        timeouts.forEach(native.clearTimeout); intervals.forEach(native.clearInterval); listeners.clear();
        const clearListeners = node => { node.listeners = {}; node.children.forEach(clearListeners); };
        clearListeners(doc.body); doc.listeners = {};
        for (const [key, descriptor] of Object.entries(saved)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
        }
    } };
}
